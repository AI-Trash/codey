use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
  collections::{HashMap, VecDeque},
  env, fs,
  io::Write,
  path::PathBuf,
  process::Stdio,
  sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
  },
  time::{SystemTime, UNIX_EPOCH},
};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};
use tokio::{
  io::{AsyncBufReadExt, BufReader},
  process::Command,
};

const MAX_LOG_LINES: usize = 2_000;
const DEFAULT_CONCURRENCY: usize = 2;
const MAX_CONCURRENCY: usize = 10;

const ALLOWED_FLOW_IDS: &[&str] = &[
  "chatgpt-register",
  "chatgpt-register-hosted-checkouts",
  "chatgpt-login",
  "chatgpt-team-trial",
  "chatgpt-team-trial-gopay",
  "chatgpt-invite",
  "codex-oauth",
  "android-healthcheck",
  "noop",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
  concurrency: usize,
  target: Option<String>,
  app_base_url: Option<String>,
}

impl Default for DesktopSettings {
  fn default() -> Self {
    Self {
      concurrency: DEFAULT_CONCURRENCY,
      target: None,
      app_base_url: None,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSnapshot {
  workspace_root: String,
  settings: DesktopSettings,
  tasks: Vec<DesktopTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum TaskStatus {
  Queued,
  Running,
  Passed,
  Failed,
  Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskLogLine {
  at: u64,
  stream: String,
  text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopTask {
  id: String,
  kind: String,
  flow_id: Option<String>,
  title: String,
  payload: Value,
  config: Value,
  status: TaskStatus,
  created_at: u64,
  started_at: Option<u64>,
  completed_at: Option<u64>,
  pid: Option<u32>,
  exit_code: Option<i32>,
  message: Option<String>,
  logs: Vec<TaskLogLine>,
  cancel_requested: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnqueueFlowTaskInput {
  flow_id: String,
  config: Value,
  title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDesktopSettingsInput {
  concurrency: Option<usize>,
  target: Option<String>,
  app_base_url: Option<String>,
}

#[derive(Clone)]
struct DesktopRuntime {
  inner: Arc<Mutex<DesktopInner>>,
  counter: Arc<AtomicU64>,
}

struct DesktopInner {
  workspace_root: PathBuf,
  settings: DesktopSettings,
  tasks: HashMap<String, DesktopTask>,
  order: VecDeque<String>,
}

impl DesktopRuntime {
  fn new(workspace_root: PathBuf) -> Self {
    let settings = read_settings(&workspace_root).unwrap_or_default();

    Self {
      inner: Arc::new(Mutex::new(DesktopInner {
        workspace_root,
        settings,
        tasks: HashMap::new(),
        order: VecDeque::new(),
      })),
      counter: Arc::new(AtomicU64::new(1)),
    }
  }

  fn snapshot(&self) -> DesktopSnapshot {
    let inner = self.inner.lock().expect("desktop state poisoned");
    let mut tasks = inner
      .order
      .iter()
      .filter_map(|task_id| inner.tasks.get(task_id))
      .cloned()
      .collect::<Vec<_>>();
    tasks.sort_by(|left, right| {
      task_sort_rank(left)
        .cmp(&task_sort_rank(right))
        .then_with(|| right.created_at.cmp(&left.created_at))
    });

    DesktopSnapshot {
      workspace_root: inner.workspace_root.display().to_string(),
      settings: inner.settings.clone(),
      tasks,
    }
  }

  fn enqueue(&self, task: DesktopTask) -> DesktopTask {
    let mut inner = self.inner.lock().expect("desktop state poisoned");
    inner.order.push_front(task.id.clone());
    inner.tasks.insert(task.id.clone(), task.clone());
    task
  }

  fn update_settings(&self, input: UpdateDesktopSettingsInput) -> Result<DesktopSettings, String> {
    let mut inner = self.inner.lock().expect("desktop state poisoned");

    if let Some(concurrency) = input.concurrency {
      inner.settings.concurrency = concurrency.clamp(1, MAX_CONCURRENCY);
    }
    if input.target.is_some() {
      inner.settings.target = normalize_optional_string(input.target);
    }
    if input.app_base_url.is_some() {
      inner.settings.app_base_url = normalize_optional_string(input.app_base_url);
    }

    write_settings(&inner.workspace_root, &inner.settings)?;
    Ok(inner.settings.clone())
  }

  fn clear_finished(&self) {
    let mut inner = self.inner.lock().expect("desktop state poisoned");
    let finished_ids = inner
      .tasks
      .iter()
      .filter_map(|(task_id, task)| is_finished(&task.status).then(|| task_id.clone()))
      .collect::<Vec<_>>();

    for task_id in finished_ids {
      inner.tasks.remove(&task_id);
      inner.order.retain(|entry| entry != &task_id);
    }
  }

  fn cancel_task(&self, task_id: &str) -> Option<DesktopTask> {
    let mut inner = self.inner.lock().expect("desktop state poisoned");
    let task = inner.tasks.get_mut(task_id)?;

    match task.status {
      TaskStatus::Queued => {
        task.status = TaskStatus::Canceled;
        task.completed_at = Some(now_ms());
        task.message = Some("Canceled before start".to_string());
      }
      TaskStatus::Running => {
        task.cancel_requested = true;
        task.message = Some("Cancel requested".to_string());
      }
      TaskStatus::Passed | TaskStatus::Failed | TaskStatus::Canceled => {}
    }

    Some(task.clone())
  }

  fn next_task_to_start(&self) -> Option<DesktopTask> {
    let mut inner = self.inner.lock().expect("desktop state poisoned");
    let running_count = inner
      .tasks
      .values()
      .filter(|task| task.status == TaskStatus::Running)
      .count();
    if running_count >= inner.settings.concurrency {
      return None;
    }

    let next_id = inner
      .order
      .iter()
      .rev()
      .find(|task_id| {
        inner
          .tasks
          .get(*task_id)
          .is_some_and(|task| task.status == TaskStatus::Queued)
      })?
      .clone();
    let task = inner.tasks.get_mut(&next_id)?;
    task.status = TaskStatus::Running;
    task.started_at = Some(now_ms());
    task.message = Some("Starting Codey Desktop automation host".to_string());
    Some(task.clone())
  }

  fn schedule(&self, app: AppHandle) {
    loop {
      let Some(task) = self.next_task_to_start() else {
        break;
      };
      emit_task_changed(&app, &task);

      let runtime = self.clone();
      let app_for_task = app.clone();
      tauri::async_runtime::spawn(async move {
        runtime.run_task(app_for_task, task.id).await;
      });
    }
  }

  async fn run_task(&self, app: AppHandle, task_id: String) {
    let (workspace_root, payload, app_base_url) = {
      let inner = self.inner.lock().expect("desktop state poisoned");
      let Some(task) = inner.tasks.get(&task_id) else {
        return;
      };
      (
        inner.workspace_root.clone(),
        task.payload.clone(),
        inner.settings.app_base_url.clone(),
      )
    };

    let host_path = match resolve_automation_host_path(&app, &workspace_root) {
      Ok(path) => path,
      Err(error) => {
        self.finish_task(&app, &task_id, TaskStatus::Failed, None, Some(error));
        self.schedule(app);
        return;
      }
    };
    let task_file = match write_task_payload(&workspace_root, &task_id, &payload) {
      Ok(path) => path,
      Err(error) => {
        self.finish_task(&app, &task_id, TaskStatus::Failed, None, Some(error));
        self.schedule(app);
        return;
      }
    };
    let node_path = match resolve_node_executable(&app) {
      Ok(path) => path,
      Err(error) => {
        self.finish_task(&app, &task_id, TaskStatus::Failed, None, Some(error));
        self.schedule(app);
        return;
      }
    };
    let mut command = Command::new(node_path);
    command
      .arg("--enable-source-maps")
      .arg(host_path)
      .arg("--taskFile")
      .arg(task_file)
      .current_dir(&workspace_root)
      .env("CODEY_WORKSPACE_ROOT", &workspace_root)
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

    if let Some(base_url) = app_base_url {
      command.env("CODEY_APP_BASE_URL", base_url);
    }

    let mut child = match command.spawn() {
      Ok(child) => child,
      Err(error) => {
        self.finish_task(
          &app,
          &task_id,
          TaskStatus::Failed,
          None,
          Some(format!(
            "Failed to start Codey Desktop automation host: {error}",
          )),
        );
        self.schedule(app);
        return;
      }
    };

    let pid = child.id();
    self.patch_task(&app, &task_id, |task| {
      task.pid = pid;
      task.message = Some(match pid {
        Some(value) => format!("Running with process {value}"),
        None => "Running".to_string(),
      });
    });

    if let Some(stdout) = child.stdout.take() {
      let runtime = self.clone();
      let app_for_stdout = app.clone();
      let task_for_stdout = task_id.clone();
      tauri::async_runtime::spawn(async move {
        read_host_stdout(app_for_stdout, runtime, task_for_stdout, stdout).await;
      });
    }

    if let Some(stderr) = child.stderr.take() {
      let runtime = self.clone();
      let app_for_stderr = app.clone();
      let task_for_stderr = task_id.clone();
      tauri::async_runtime::spawn(async move {
        read_process_lines(app_for_stderr, runtime, task_for_stderr, stderr, "stderr").await;
      });
    }

    let exit_status = child.wait().await;
    let exit_code = exit_status.as_ref().ok().and_then(|status| status.code());
    let canceled = self
      .read_task(&task_id)
      .is_some_and(|task| task.cancel_requested);
    let status = if canceled {
      TaskStatus::Canceled
    } else if exit_status.as_ref().is_ok_and(|status| status.success()) {
      TaskStatus::Passed
    } else {
      TaskStatus::Failed
    };
    let message = match &exit_status {
      Ok(status) if status.success() => Some("Completed".to_string()),
      Ok(status) => Some(format!("Exited with {status}")),
      Err(error) => Some(format!("Failed while waiting for process: {error}")),
    };

    self.finish_task(&app, &task_id, status, exit_code, message);
    self.schedule(app);
  }

  fn read_task(&self, task_id: &str) -> Option<DesktopTask> {
    let inner = self.inner.lock().expect("desktop state poisoned");
    inner.tasks.get(task_id).cloned()
  }

  fn patch_task<F>(&self, app: &AppHandle, task_id: &str, patch: F)
  where
    F: FnOnce(&mut DesktopTask),
  {
    let task = {
      let mut inner = self.inner.lock().expect("desktop state poisoned");
      let Some(task) = inner.tasks.get_mut(task_id) else {
        return;
      };
      patch(task);
      task.clone()
    };

    emit_task_changed(app, &task);
  }

  fn finish_task(
    &self,
    app: &AppHandle,
    task_id: &str,
    status: TaskStatus,
    exit_code: Option<i32>,
    message: Option<String>,
  ) {
    self.patch_task(app, task_id, |task| {
      task.status = status;
      task.completed_at = Some(now_ms());
      task.exit_code = exit_code;
      task.pid = None;
      task.message = message;
    });
  }

  fn append_log(&self, app: &AppHandle, task_id: &str, stream: &str, text: String) {
    let line = TaskLogLine {
      at: now_ms(),
      stream: stream.to_string(),
      text,
    };
    {
      let mut inner = self.inner.lock().expect("desktop state poisoned");
      let Some(task) = inner.tasks.get_mut(task_id) else {
        return;
      };
      task.logs.push(line.clone());
      if task.logs.len() > MAX_LOG_LINES {
        let overflow = task.logs.len() - MAX_LOG_LINES;
        task.logs.drain(0..overflow);
      }
    }

    let _ = app.emit(
      "task-log",
      serde_json::json!({
        "taskId": task_id,
        "line": line,
      }),
    );
  }

  fn apply_host_event(&self, app: &AppHandle, task_id: &str, event: DesktopHostEvent) {
    if let Some(message) = event.message.as_ref().filter(|message| !message.trim().is_empty()) {
      self.append_log(app, task_id, "event", message.to_string());
    }

    match event.event.as_str() {
      "host.ready" | "flow.started" | "flow.progress" | "flow.storage_state_loaded" => {
        if let Some(message) = event.message {
          self.patch_task(app, task_id, |task| {
            task.message = Some(message);
          });
        }
      }
      "flow.completed" => {
        self.patch_task(app, task_id, |task| {
          task.status = TaskStatus::Passed;
          task.completed_at = Some(now_ms());
          task.message = event.message;
          if let Some(data) = event.data {
            task.config = json!({
              "input": task.config,
              "result": data,
            });
          }
        });
      }
      "flow.failed" | "host.failed" => {
        self.patch_task(app, task_id, |task| {
          task.status = TaskStatus::Failed;
          task.completed_at = Some(now_ms());
          task.message = event.message;
        });
      }
      _ => {}
    }
  }
}

#[tauri::command]
fn get_desktop_state(runtime: State<'_, DesktopRuntime>) -> DesktopSnapshot {
  runtime.snapshot()
}

#[tauri::command]
fn enqueue_flow_task(
  app: AppHandle,
  runtime: State<'_, DesktopRuntime>,
  input: EnqueueFlowTaskInput,
) -> Result<DesktopTask, String> {
  let flow_id = input.flow_id.trim().to_string();
  if !ALLOWED_FLOW_IDS.contains(&flow_id.as_str()) {
    return Err(format!("Unsupported Codey flow: {flow_id}"));
  }

  let title = input.title.unwrap_or_else(|| flow_id.clone());
  let task_id = next_task_id(&runtime, "flow");
  let payload = json!({
    "taskId": task_id,
    "flowId": flow_id,
    "config": input.config,
  });
  let task = DesktopTask {
    id: task_id,
    kind: "flow".to_string(),
    flow_id: Some(flow_id),
    title,
    config: payload
      .get("config")
      .cloned()
      .unwrap_or(Value::Object(Default::default())),
    payload,
    status: TaskStatus::Queued,
    created_at: now_ms(),
    started_at: None,
    completed_at: None,
    pid: None,
    exit_code: None,
    message: Some("Queued".to_string()),
    logs: Vec::new(),
    cancel_requested: false,
  };

  let task = runtime.enqueue(task);
  emit_task_changed(&app, &task);
  runtime.schedule(app);
  Ok(task)
}

#[tauri::command]
async fn cancel_task(
  app: AppHandle,
  runtime: State<'_, DesktopRuntime>,
  task_id: String,
) -> Result<Option<DesktopTask>, String> {
  let task = runtime.cancel_task(&task_id);
  if let Some(task) = &task {
    emit_task_changed(&app, task);
    if let Some(pid) = task.pid {
      kill_process_tree(pid).await?;
    }
  }

  runtime.schedule(app);
  Ok(task)
}

#[tauri::command]
fn update_desktop_settings(
  app: AppHandle,
  runtime: State<'_, DesktopRuntime>,
  input: UpdateDesktopSettingsInput,
) -> Result<DesktopSettings, String> {
  let settings = runtime.update_settings(input)?;
  runtime.schedule(app);
  Ok(settings)
}

#[tauri::command]
fn clear_finished_tasks(runtime: State<'_, DesktopRuntime>) -> DesktopSnapshot {
  runtime.clear_finished();
  runtime.snapshot()
}

fn resolve_automation_host_path(
  app: &AppHandle,
  workspace_root: &PathBuf,
) -> Result<PathBuf, String> {
  let resource_path = app
    .path()
    .resolve(
      PathBuf::from("automation-host").join("automation-host.js"),
      BaseDirectory::Resource,
    )
    .map_err(|error| format!("Failed to resolve Codey Desktop resource path: {error}"))?;

  if resource_path.exists() {
    return Ok(resource_path);
  }

  let development_path = workspace_root
    .join("packages")
    .join("desktop")
    .join("dist-host")
    .join("automation-host.js");
  if development_path.exists() {
    return Ok(development_path);
  }

  Err(format!(
    "Codey Desktop automation host bundle was not found. Expected bundled resource at {} or development bundle at {}. Run pnpm --filter @codey/desktop run build:host before tauri dev, and ensure tauri.conf.json includes the dist-host resource for packaged builds.",
    resource_path.display(),
    development_path.display(),
  ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopHostEvent {
  kind: String,
  task_id: Option<String>,
  event: String,
  message: Option<String>,
  data: Option<Value>,
}

fn write_task_payload(
  workspace_root: &PathBuf,
  task_id: &str,
  payload: &Value,
) -> Result<PathBuf, String> {
  let task_dir = workspace_root.join(".codey").join("desktop-tasks");
  fs::create_dir_all(&task_dir)
    .map_err(|error| format!("Failed to create {}: {error}", task_dir.display()))?;
  let task_file = task_dir.join(format!("{task_id}.json"));
  let mut file = fs::File::create(&task_file)
    .map_err(|error| format!("Failed to create {}: {error}", task_file.display()))?;
  let content = serde_json::to_vec_pretty(payload)
    .map_err(|error| format!("Failed to serialize automation task payload: {error}"))?;
  file
    .write_all(&content)
    .map_err(|error| format!("Failed to write {}: {error}", task_file.display()))?;
  Ok(task_file)
}

async fn read_host_stdout<R>(
  app: AppHandle,
  runtime: DesktopRuntime,
  task_id: String,
  stream: R,
) where
  R: tokio::io::AsyncRead + Unpin,
{
  let mut lines = BufReader::new(stream).lines();
  loop {
    match lines.next_line().await {
      Ok(Some(line)) => match serde_json::from_str::<DesktopHostEvent>(&line) {
        Ok(event)
          if event.kind == "codey-desktop-event"
            && event
              .task_id
              .as_ref()
              .is_none_or(|event_task_id| event_task_id == &task_id) =>
        {
          runtime.apply_host_event(&app, &task_id, event);
        }
        _ => runtime.append_log(&app, &task_id, "stdout", line),
      },
      Ok(None) => break,
      Err(error) => {
        runtime.append_log(
          &app,
          &task_id,
          "system",
          format!("Failed to read stdout: {error}"),
        );
        break;
      }
    }
  }
}

async fn read_process_lines<R>(
  app: AppHandle,
  runtime: DesktopRuntime,
  task_id: String,
  stream: R,
  stream_name: &str,
) where
  R: tokio::io::AsyncRead + Unpin,
{
  let mut lines = BufReader::new(stream).lines();
  loop {
    match lines.next_line().await {
      Ok(Some(line)) => runtime.append_log(&app, &task_id, stream_name, line),
      Ok(None) => break,
      Err(error) => {
        runtime.append_log(
          &app,
          &task_id,
          "system",
          format!("Failed to read {stream_name}: {error}"),
        );
        break;
      }
    }
  }
}

fn emit_task_changed(app: &AppHandle, task: &DesktopTask) {
  let _ = app.emit("task-changed", task);
}

fn task_sort_rank(task: &DesktopTask) -> u8 {
  match task.status {
    TaskStatus::Running => 0,
    TaskStatus::Queued => 1,
    TaskStatus::Failed => 2,
    TaskStatus::Canceled => 3,
    TaskStatus::Passed => 4,
  }
}

fn is_finished(status: &TaskStatus) -> bool {
  matches!(
    status,
    TaskStatus::Passed | TaskStatus::Failed | TaskStatus::Canceled
  )
}

fn next_task_id(runtime: &DesktopRuntime, prefix: &str) -> String {
  let next = runtime.counter.fetch_add(1, Ordering::Relaxed);
  format!("{prefix}-{}-{next}", now_ms())
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
  value.and_then(|value| {
    let trimmed = value.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
  })
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or_default()
}

fn resolve_workspace_root() -> PathBuf {
  if let Some(path) = env::var_os("CODEY_WORKSPACE_ROOT").map(PathBuf::from) {
    return path;
  }

  if cfg!(debug_assertions) {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    return manifest_dir
      .ancestors()
      .nth(3)
      .map(PathBuf::from)
      .unwrap_or(manifest_dir);
  }

  env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn resolve_runtime_root(app: &AppHandle, workspace_root: &PathBuf) -> PathBuf {
  if let Some(path) = env::var_os("CODEY_DESKTOP_RUNTIME_ROOT").map(PathBuf::from) {
    return path;
  }

  if cfg!(debug_assertions) {
    return workspace_root.clone();
  }

  app
    .path()
    .app_data_dir()
    .unwrap_or_else(|_| workspace_root.clone())
}

fn settings_path(workspace_root: &PathBuf) -> PathBuf {
  workspace_root.join(".codey").join("desktop-settings.json")
}

fn read_settings(workspace_root: &PathBuf) -> Result<DesktopSettings, String> {
  let path = settings_path(workspace_root);
  if !path.exists() {
    return Ok(DesktopSettings::default());
  }

  let content = fs::read_to_string(&path)
    .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
  serde_json::from_str(&content)
    .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn write_settings(workspace_root: &PathBuf, settings: &DesktopSettings) -> Result<(), String> {
  let path = settings_path(workspace_root);
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
  }

  let content = serde_json::to_string_pretty(settings)
    .map_err(|error| format!("Failed to serialize desktop settings: {error}"))?;
  fs::write(&path, content)
    .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn resolve_node_executable(app: &AppHandle) -> Result<PathBuf, String> {
  if let Some(path) = env::var_os("CODEY_DESKTOP_NODE").or_else(|| env::var_os("NODE")) {
    return Ok(PathBuf::from(path));
  }

  let resource_name = if cfg!(windows) {
    "node.exe"
  } else {
    "node"
  };
  let resource_path = app
    .path()
    .resolve(
      PathBuf::from("runtime").join(resource_name),
      BaseDirectory::Resource,
    )
    .map_err(|error| format!("Failed to resolve Codey Desktop Node runtime resource: {error}"))?;

  if resource_path.exists() {
    return Ok(resource_path);
  }

  if cfg!(debug_assertions) {
    return Ok(PathBuf::from("node"));
  }

  Err(format!(
    "Codey Desktop Node runtime was not found at {}. Package a compatible Node runtime as a Tauri resource, or set CODEY_DESKTOP_NODE to an explicit executable path.",
    resource_path.display(),
  ))
}

async fn kill_process_tree(pid: u32) -> Result<(), String> {
  let status = if cfg!(windows) {
    Command::new("taskkill")
      .arg("/PID")
      .arg(pid.to_string())
      .arg("/T")
      .arg("/F")
      .status()
      .await
  } else {
    Command::new("kill")
      .arg("-TERM")
      .arg(pid.to_string())
      .status()
      .await
  }
  .map_err(|error| format!("Failed to stop process {pid}: {error}"))?;

  if status.success() {
    Ok(())
  } else {
    Err(format!("Process stop command exited with {status}"))
  }
}

pub fn run() {
  let workspace_root = resolve_workspace_root();

  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(move |app| {
      let runtime_root = resolve_runtime_root(app.handle(), &workspace_root);
      fs::create_dir_all(&runtime_root)?;
      app.manage(DesktopRuntime::new(runtime_root));
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_desktop_state,
      enqueue_flow_task,
      cancel_task,
      update_desktop_settings,
      clear_finished_tasks,
    ])
    .run(tauri::generate_context!())
    .expect("failed to run Codey Desktop");
}

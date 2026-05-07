use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use rustyscript::{Module, Runtime as DenoRuntime, RuntimeOptions};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    env, fs,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};
use tokio::{
    net::TcpStream,
    process::Command,
    sync::mpsc,
    time::{sleep, timeout},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error as WebSocketError, Message},
    MaybeTlsStream, WebSocketStream,
};
use url::Url;
use uuid::Uuid;

const MAX_LOG_LINES: usize = 2_000;
const DEFAULT_CONCURRENCY: usize = 2;
const MAX_CONCURRENCY: usize = 10;
const DEFAULT_APP_BASE_URL: &str = "http://localhost:3000";
const DEFAULT_CLI_NAME: &str = "Codey Desktop";
const DEFAULT_CLI_WS_PATH: &str = "/api/cli/ws";
const DEFAULT_OIDC_BASE_PATH: &str = "/oidc";
const DEFAULT_WEB_SCOPE: &str = "notifications:read verification:ingest";
const WEB_CLAIM_INTERVAL: Duration = Duration::from_millis(2_000);
const WEB_RECONNECT_DELAY: Duration = Duration::from_millis(2_000);
const WEB_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const REMOTE_TASK_HEARTBEAT_MS: u64 = 10_000;

type CodeyWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

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
#[serde(default, rename_all = "camelCase")]
struct DesktopSettings {
    concurrency: usize,
    target: Option<String>,
    app_base_url: Option<String>,
    app_client_id: Option<String>,
    app_client_secret: Option<String>,
    cli_name: Option<String>,
    cli_web_socket_path: Option<String>,
    oidc_issuer: Option<String>,
    oidc_base_path: Option<String>,
    token_endpoint_auth_method: Option<TokenEndpointAuthMethod>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            concurrency: DEFAULT_CONCURRENCY,
            target: None,
            app_base_url: None,
            app_client_id: None,
            app_client_secret: None,
            cli_name: Some(DEFAULT_CLI_NAME.to_string()),
            cli_web_socket_path: Some(DEFAULT_CLI_WS_PATH.to_string()),
            oidc_issuer: None,
            oidc_base_path: Some(DEFAULT_OIDC_BASE_PATH.to_string()),
            token_endpoint_auth_method: Some(TokenEndpointAuthMethod::ClientSecretBasic),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TokenEndpointAuthMethod {
    ClientSecretBasic,
    ClientSecretPost,
}

impl Default for TokenEndpointAuthMethod {
    fn default() -> Self {
        Self::ClientSecretBasic
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum WebConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebConnectionSnapshot {
    status: WebConnectionStatus,
    message: Option<String>,
    connection_id: Option<String>,
    worker_id: Option<String>,
    cli_name: Option<String>,
    target: Option<String>,
    browser_limit: Option<usize>,
    connected_at: Option<String>,
    last_error: Option<String>,
}

impl Default for WebConnectionSnapshot {
    fn default() -> Self {
        Self {
            status: WebConnectionStatus::Disconnected,
            message: Some("Disconnected".to_string()),
            connection_id: None,
            worker_id: None,
            cli_name: None,
            target: None,
            browser_limit: None,
            connected_at: None,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSnapshot {
    workspace_root: String,
    settings: DesktopSettings,
    web_connection: WebConnectionSnapshot,
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
    remote_task_id: Option<String>,
    remote_connection_id: Option<String>,
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
    #[serde(skip)]
    remote_final_reported: bool,
    #[serde(skip)]
    last_remote_heartbeat_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnqueueFlowTaskInput {
    flow_id: String,
    config: Value,
    title: Option<String>,
}

struct FlowTaskBuildInput {
    id: String,
    flow_id: String,
    title: String,
    config: Value,
    batch: Option<Value>,
    metadata: Option<Value>,
    external_services: Option<Value>,
    remote_connection_id: Option<String>,
    remote_task_id: Option<String>,
    message: Option<String>,
}

struct NormalizedClaimedFlowTaskPayload {
    remote_task_id: String,
    flow_id: String,
    config: Value,
    batch: Option<Value>,
    metadata: Option<Value>,
    external_services: Option<Value>,
}

#[derive(Debug, Clone)]
struct ClaimedFlowTask {
    id: String,
    title: Option<String>,
    body: Option<String>,
    payload: Value,
}

#[derive(Debug, Clone)]
struct WebClientConfig {
    base_url: String,
    client_id: String,
    client_secret: String,
    cli_name: String,
    target: Option<String>,
    worker_id: String,
    cli_web_socket_path: String,
    oidc_issuer: Option<String>,
    oidc_base_path: String,
    token_endpoint_auth_method: TokenEndpointAuthMethod,
}

#[derive(Debug, Deserialize)]
struct OidcDiscovery {
    token_endpoint: String,
}

#[derive(Debug, Deserialize)]
struct OidcTokenResponse {
    access_token: String,
    #[allow(dead_code)]
    token_type: Option<String>,
    #[allow(dead_code)]
    expires_in: Option<u64>,
    #[allow(dead_code)]
    scope: Option<String>,
}

#[derive(Debug, Clone)]
struct WebAuthToken {
    access_token: String,
}

#[derive(Debug, Clone)]
struct CliConnectionEvent {
    connection_id: String,
    worker_id: Option<String>,
    cli_name: Option<String>,
    target: Option<String>,
    browser_limit: Option<usize>,
    connected_at: Option<String>,
}

#[derive(Debug)]
struct ClaimResult {
    task: Option<ClaimedFlowTask>,
    browser_limit: Option<usize>,
}

#[derive(Debug, Clone)]
struct RemoteWebContext {
    base_url: String,
    access_token: String,
    connection_id: String,
}

#[derive(Debug, Clone)]
struct RemoteTaskReportContext {
    base_url: String,
    access_token: String,
    connection_id: String,
    remote_task_id: String,
}

#[derive(Debug, Clone)]
struct RemoteTaskStatusUpdate {
    status: String,
    message: Option<String>,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteTaskStatusResponse {
    #[serde(default)]
    stop_requested: bool,
    stop_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDesktopSettingsInput {
    concurrency: Option<usize>,
    target: Option<String>,
    app_base_url: Option<String>,
    app_client_id: Option<String>,
    app_client_secret: Option<String>,
    cli_name: Option<String>,
    cli_web_socket_path: Option<String>,
    oidc_issuer: Option<String>,
    oidc_base_path: Option<String>,
    token_endpoint_auth_method: Option<TokenEndpointAuthMethod>,
}

#[derive(Clone)]
struct DesktopRuntime {
    inner: Arc<Mutex<DesktopInner>>,
    counter: Arc<AtomicU64>,
}

struct DesktopInner {
    workspace_root: PathBuf,
    settings: DesktopSettings,
    web_connection: WebConnectionSnapshot,
    web_stop: Option<Arc<AtomicBool>>,
    web_access_token: Option<String>,
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
                web_connection: WebConnectionSnapshot::default(),
                web_stop: None,
                web_access_token: None,
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
            web_connection: inner.web_connection.clone(),
            tasks,
        }
    }

    fn enqueue(&self, task: DesktopTask) -> DesktopTask {
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        inner.order.push_front(task.id.clone());
        inner.tasks.insert(task.id.clone(), task.clone());
        task
    }

    fn enqueue_remote_task(
        &self,
        connection_id: &str,
        claimed_task: ClaimedFlowTask,
    ) -> Result<Option<DesktopTask>, String> {
        let payload = normalize_claimed_flow_task_payload(&claimed_task)?;
        let mut inner = self.inner.lock().expect("desktop state poisoned");

        if inner.tasks.contains_key(&claimed_task.id) {
            return Ok(None);
        }

        let title = claimed_task
            .title
            .or(claimed_task.body)
            .unwrap_or_else(|| payload.flow_id.clone());
        let task = build_flow_task(FlowTaskBuildInput {
            id: claimed_task.id,
            flow_id: payload.flow_id,
            title,
            config: payload.config,
            batch: payload.batch,
            metadata: payload.metadata,
            external_services: payload.external_services,
            remote_connection_id: Some(connection_id.to_string()),
            remote_task_id: Some(payload.remote_task_id),
            message: Some("Claimed from Codey Web".to_string()),
        });

        inner.order.push_front(task.id.clone());
        inner.tasks.insert(task.id.clone(), task.clone());
        Ok(Some(task))
    }

    fn update_settings(
        &self,
        input: UpdateDesktopSettingsInput,
    ) -> Result<DesktopSettings, String> {
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
        if input.app_client_id.is_some() {
            inner.settings.app_client_id = normalize_optional_string(input.app_client_id);
        }
        if input.app_client_secret.is_some() {
            inner.settings.app_client_secret = normalize_optional_string(input.app_client_secret);
        }
        if input.cli_name.is_some() {
            inner.settings.cli_name = normalize_optional_string(input.cli_name)
                .or_else(|| Some(DEFAULT_CLI_NAME.to_string()));
        }
        if input.cli_web_socket_path.is_some() {
            inner.settings.cli_web_socket_path =
                normalize_optional_string(input.cli_web_socket_path)
                    .or_else(|| Some(DEFAULT_CLI_WS_PATH.to_string()));
        }
        if input.oidc_issuer.is_some() {
            inner.settings.oidc_issuer = normalize_optional_string(input.oidc_issuer);
        }
        if input.oidc_base_path.is_some() {
            inner.settings.oidc_base_path = normalize_optional_string(input.oidc_base_path)
                .or_else(|| Some(DEFAULT_OIDC_BASE_PATH.to_string()));
        }
        if input.token_endpoint_auth_method.is_some() {
            inner.settings.token_endpoint_auth_method = input.token_endpoint_auth_method;
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

    fn has_claim_capacity(&self, browser_limit: Option<usize>) -> bool {
        let inner = self.inner.lock().expect("desktop state poisoned");
        let active_count = inner
            .tasks
            .values()
            .filter(|task| matches!(task.status, TaskStatus::Queued | TaskStatus::Running))
            .count();
        let limit = browser_limit
            .unwrap_or(inner.settings.concurrency)
            .min(inner.settings.concurrency)
            .max(1);
        active_count < limit
    }

    fn start_web_connection(&self, app: AppHandle) -> Result<WebConnectionSnapshot, String> {
        let config = self.resolve_web_client_config()?;
        let stop = Arc::new(AtomicBool::new(false));

        let snapshot = {
            let mut inner = self.inner.lock().expect("desktop state poisoned");
            if let Some(existing) = inner.web_stop.take() {
                existing.store(true, Ordering::Relaxed);
            }
            inner.web_stop = Some(stop.clone());
            inner.web_access_token = None;
            inner.web_connection = WebConnectionSnapshot {
                status: WebConnectionStatus::Connecting,
                message: Some(format!(
                    "Connecting to {} as {}",
                    config.base_url, config.cli_name
                )),
                connection_id: None,
                worker_id: Some(config.worker_id.clone()),
                cli_name: Some(config.cli_name.clone()),
                target: config.target.clone(),
                browser_limit: None,
                connected_at: None,
                last_error: None,
            };
            inner.web_connection.clone()
        };
        emit_web_connection_changed(&app, &snapshot);

        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            runtime.run_web_connection_loop(app, config, stop).await;
        });

        Ok(snapshot)
    }

    fn disconnect_web_connection(&self, app: &AppHandle) -> WebConnectionSnapshot {
        let snapshot = {
            let mut inner = self.inner.lock().expect("desktop state poisoned");
            if let Some(stop) = inner.web_stop.take() {
                stop.store(true, Ordering::Relaxed);
            }
            inner.web_access_token = None;
            inner.web_connection = WebConnectionSnapshot::default();
            inner.web_connection.clone()
        };
        emit_web_connection_changed(app, &snapshot);
        snapshot
    }

    fn resolve_web_client_config(&self) -> Result<WebClientConfig, String> {
        let (workspace_root, settings) = {
            let inner = self.inner.lock().expect("desktop state poisoned");
            (inner.workspace_root.clone(), inner.settings.clone())
        };

        let base_url = settings
            .app_base_url
            .clone()
            .unwrap_or_else(|| DEFAULT_APP_BASE_URL.to_string());
        let client_id = settings
            .app_client_id
            .clone()
            .ok_or_else(|| "Codey Web client id is required.".to_string())?;
        let client_secret = settings
            .app_client_secret
            .clone()
            .ok_or_else(|| "Codey Web client secret is required.".to_string())?;
        let cli_name = settings
            .cli_name
            .clone()
            .unwrap_or_else(|| DEFAULT_CLI_NAME.to_string());
        let target = settings.target.clone();
        let worker_id = resolve_desktop_worker_id(&workspace_root, &cli_name, target.as_deref())?;

        Ok(WebClientConfig {
            base_url,
            client_id,
            client_secret,
            cli_name,
            target,
            worker_id,
            cli_web_socket_path: settings
                .cli_web_socket_path
                .clone()
                .unwrap_or_else(|| DEFAULT_CLI_WS_PATH.to_string()),
            oidc_issuer: settings.oidc_issuer.clone(),
            oidc_base_path: settings
                .oidc_base_path
                .clone()
                .unwrap_or_else(|| DEFAULT_OIDC_BASE_PATH.to_string()),
            token_endpoint_auth_method: settings
                .token_endpoint_auth_method
                .clone()
                .unwrap_or_default(),
        })
    }

    async fn run_web_connection_loop(
        &self,
        app: AppHandle,
        config: WebClientConfig,
        stop: Arc<AtomicBool>,
    ) {
        while !stop.load(Ordering::Relaxed) {
            self.patch_web_connection(&app, &stop, |connection| {
                connection.status = WebConnectionStatus::Connecting;
                connection.message = Some(format!(
                    "Connecting to {} as {}",
                    config.base_url, config.cli_name
                ));
                connection.worker_id = Some(config.worker_id.clone());
                connection.cli_name = Some(config.cli_name.clone());
                connection.target = config.target.clone();
                connection.last_error = None;
            });

            match self.run_single_web_connection(&app, &config, &stop).await {
                Ok(()) => {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    self.patch_web_connection(&app, &stop, |connection| {
                        connection.status = WebConnectionStatus::Disconnected;
                        connection.message = Some("Codey Web connection closed.".to_string());
                        connection.connection_id = None;
                        connection.connected_at = None;
                    });
                }
                Err(error) => {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    {
                        let mut inner = self.inner.lock().expect("desktop state poisoned");
                        if !inner
                            .web_stop
                            .as_ref()
                            .is_some_and(|current| Arc::ptr_eq(current, &stop))
                        {
                            break;
                        }
                        inner.web_access_token = None;
                    }
                    self.patch_web_connection(&app, &stop, |connection| {
                        connection.status = WebConnectionStatus::Error;
                        connection.message = Some(error.clone());
                        connection.last_error = Some(error);
                        connection.connection_id = None;
                        connection.connected_at = None;
                    });
                }
            }

            sleep(WEB_RECONNECT_DELAY).await;
        }

        let snapshot = {
            let mut inner = self.inner.lock().expect("desktop state poisoned");
            if !inner
                .web_stop
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &stop))
            {
                return;
            }
            inner.web_stop = None;
            inner.web_access_token = None;
            inner.web_connection.status = WebConnectionStatus::Disconnected;
            inner.web_connection.message = Some("Disconnected".to_string());
            inner.web_connection.connection_id = None;
            inner.web_connection.connected_at = None;
            inner.web_connection.clone()
        };
        emit_web_connection_changed(&app, &snapshot);
    }

    async fn run_single_web_connection(
        &self,
        app: &AppHandle,
        config: &WebClientConfig,
        stop: &Arc<AtomicBool>,
    ) -> Result<(), String> {
        let token = exchange_codey_web_client_credentials(config).await?;
        {
            let mut inner = self.inner.lock().expect("desktop state poisoned");
            if !inner
                .web_stop
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, stop))
            {
                return Ok(());
            }
            inner.web_access_token = Some(token.access_token.clone());
        }

        let ws_url = build_cli_web_socket_url(config, &token.access_token)?;
        let (mut socket, _) = connect_async(ws_url.as_str())
            .await
            .map_err(|error| format!("Unable to open Codey WebSocket connection: {error}"))?;
        let connection = wait_for_cli_connection(&mut socket).await?;

        self.patch_web_connection(app, stop, |snapshot| {
            snapshot.status = WebConnectionStatus::Connected;
            snapshot.message = Some("Connected to Codey Web worker RPC.".to_string());
            snapshot.connection_id = Some(connection.connection_id.clone());
            snapshot.worker_id = connection
                .worker_id
                .clone()
                .or_else(|| Some(config.worker_id.clone()));
            snapshot.cli_name = connection
                .cli_name
                .clone()
                .or_else(|| Some(config.cli_name.clone()));
            snapshot.target = connection.target.clone().or_else(|| config.target.clone());
            snapshot.browser_limit = connection.browser_limit;
            snapshot.connected_at = connection.connected_at.clone();
            snapshot.last_error = None;
        });
        self.spawn_remote_runtime_state();

        let mut next_request_id = 1_u64;
        let mut browser_limit = connection.browser_limit;
        while !stop.load(Ordering::Relaxed) {
            while self.has_claim_capacity(browser_limit) && !stop.load(Ordering::Relaxed) {
                let claim_data =
                    send_ws_request(&mut socket, &mut next_request_id, "claim_task", None).await?;
                let claim = normalize_claim_result(&claim_data)?;
                if let Some(next_browser_limit) = claim.browser_limit {
                    browser_limit = Some(next_browser_limit);
                    self.patch_web_connection(app, stop, |snapshot| {
                        snapshot.browser_limit = Some(next_browser_limit);
                    });
                }

                let Some(task) = claim.task else {
                    break;
                };

                let remote_task_id = task.id.clone();
                match self.enqueue_remote_task(&connection.connection_id, task) {
                    Ok(Some(task)) => {
                        emit_task_changed(app, &task);
                        self.spawn_remote_task_status(
                            app,
                            &task.id,
                            "LEASED",
                            task.message.clone(),
                            None,
                            None,
                            false,
                            true,
                        );
                        self.spawn_remote_runtime_state();
                        self.schedule(app.clone());
                    }
                    Ok(None) => {}
                    Err(error) => {
                        self.spawn_remote_task_status_by_ids(
                            app,
                            &connection.connection_id,
                            &remote_task_id,
                            "FAILED",
                            Some(error.clone()),
                            None,
                            Some(error),
                        );
                    }
                }
            }

            sleep(WEB_CLAIM_INTERVAL).await;
        }

        let _ = socket.close(None).await;
        Ok(())
    }

    async fn run_task(&self, app: AppHandle, task_id: String) {
        let (workspace_root, payload, settings) = {
            let inner = self.inner.lock().expect("desktop state poisoned");
            let Some(task) = inner.tasks.get(&task_id) else {
                return;
            };
            (
                inner.workspace_root.clone(),
                task.payload.clone(),
                inner.settings.clone(),
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
        let (output_tx, output_rx) = mpsc::unbounded_channel();
        let output_reader = {
            let runtime = self.clone();
            let app_for_output = app.clone();
            let task_for_output = task_id.clone();
            tauri::async_runtime::spawn(async move {
                read_deno_host_output(app_for_output, runtime, task_for_output, output_rx).await;
            })
        };

        self.patch_task(&app, &task_id, |task| {
            task.pid = None;
            task.message = Some("Running in embedded Deno runtime".to_string());
        });
        self.spawn_remote_task_status(
            &app,
            &task_id,
            "RUNNING",
            Some("Running in embedded Deno runtime".to_string()),
            None,
            None,
            false,
            false,
        );
        self.spawn_remote_runtime_state();

        {
            let runtime = self.clone();
            let app_for_heartbeat = app.clone();
            let task_for_heartbeat = task_id.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    sleep(Duration::from_millis(REMOTE_TASK_HEARTBEAT_MS)).await;
                    let Some(task) = runtime.read_task(&task_for_heartbeat) else {
                        break;
                    };
                    if task.status != TaskStatus::Running {
                        break;
                    }
                    runtime.spawn_remote_task_status(
                        &app_for_heartbeat,
                        &task_for_heartbeat,
                        "RUNNING",
                        task.message,
                        None,
                        None,
                        false,
                        true,
                    );
                }
            });
        }

        let deno_result = tauri::async_runtime::spawn_blocking(move || {
            run_automation_host_with_deno(host_path, task_file, workspace_root, settings, output_tx)
        })
        .await;

        let _ = output_reader.await;
        let canceled = self
            .read_task(&task_id)
            .is_some_and(|task| task.cancel_requested);
        let (status, exit_code, message) = match deno_result {
            Ok(Ok(())) if canceled => (TaskStatus::Canceled, Some(0), Some("Canceled".to_string())),
            Ok(Ok(())) => (TaskStatus::Passed, Some(0), Some("Completed".to_string())),
            Ok(Err(error)) if canceled => {
                (TaskStatus::Canceled, Some(1), Some("Canceled".to_string()))
            }
            Ok(Err(error)) => (TaskStatus::Failed, Some(1), Some(error)),
            Err(error) => (
                TaskStatus::Failed,
                None,
                Some(format!("Embedded Deno runtime task failed: {error}")),
            ),
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
        let remote_status = remote_status_from_task_status(&status);
        self.patch_task(app, task_id, |task| {
            task.status = status;
            task.completed_at = Some(now_ms());
            task.exit_code = exit_code;
            task.pid = None;
            task.message = message;
        });
        if let Some(remote_status) = remote_status {
            let task = self.read_task(task_id);
            let result = task.as_ref().and_then(remote_result_for_task);
            let message = task.as_ref().and_then(|task| task.message.clone());
            let error = if remote_status == "FAILED" {
                message.clone()
            } else {
                None
            };
            self.spawn_remote_task_status(
                app,
                task_id,
                remote_status,
                message,
                result,
                error,
                true,
                false,
            );
            self.spawn_remote_runtime_state();
        }
    }

    fn patch_web_connection<F>(
        &self,
        app: &AppHandle,
        stop: &Arc<AtomicBool>,
        patch: F,
    ) -> Option<WebConnectionSnapshot>
    where
        F: FnOnce(&mut WebConnectionSnapshot),
    {
        let snapshot = {
            let mut inner = self.inner.lock().expect("desktop state poisoned");
            if !inner
                .web_stop
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, stop))
            {
                return None;
            }
            patch(&mut inner.web_connection);
            inner.web_connection.clone()
        };

        emit_web_connection_changed(app, &snapshot);
        Some(snapshot)
    }

    fn remote_task_context(
        &self,
        task_id: &str,
        final_report: bool,
        heartbeat: bool,
    ) -> Option<RemoteTaskReportContext> {
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        let base_url = inner
            .settings
            .app_base_url
            .clone()
            .unwrap_or_else(|| DEFAULT_APP_BASE_URL.to_string());
        let access_token = inner.web_access_token.clone()?;
        let task = inner.tasks.get_mut(task_id)?;
        let connection_id = task.remote_connection_id.clone()?;
        let remote_task_id = task.remote_task_id.clone()?;

        if final_report {
            if task.remote_final_reported {
                return None;
            }
            task.remote_final_reported = true;
        }

        if heartbeat {
            let now = now_ms();
            if task
                .last_remote_heartbeat_at
                .is_some_and(|last| now.saturating_sub(last) < REMOTE_TASK_HEARTBEAT_MS)
            {
                return None;
            }
            task.last_remote_heartbeat_at = Some(now);
        }

        Some(RemoteTaskReportContext {
            base_url,
            access_token,
            connection_id,
            remote_task_id,
        })
    }

    fn remote_web_context(&self) -> Option<RemoteWebContext> {
        let inner = self.inner.lock().expect("desktop state poisoned");
        Some(RemoteWebContext {
            base_url: inner
                .settings
                .app_base_url
                .clone()
                .unwrap_or_else(|| DEFAULT_APP_BASE_URL.to_string()),
            access_token: inner.web_access_token.clone()?,
            connection_id: inner.web_connection.connection_id.clone()?,
        })
    }

    fn build_runtime_state(&self) -> Value {
        let inner = self.inner.lock().expect("desktop state poisoned");
        let active = inner
            .tasks
            .values()
            .filter(|task| matches!(task.status, TaskStatus::Queued | TaskStatus::Running))
            .cloned()
            .collect::<Vec<_>>();
        let running_count = active
            .iter()
            .filter(|task| task.status == TaskStatus::Running)
            .count();
        let queued_count = active
            .iter()
            .filter(|task| task.status == TaskStatus::Queued)
            .count();
        let primary = active
            .iter()
            .find(|task| task.status == TaskStatus::Running)
            .or_else(|| active.first());

        if active.is_empty() {
            return json!({
              "runtimeFlowId": null,
              "runtimeTaskId": null,
              "runtimeFlowStatus": "listening",
              "runtimeFlowMessage": "Codey Desktop is listening for tasks.",
              "runtimeFlowStartedAt": null,
              "runtimeFlowCompletedAt": null,
              "storageStateIdentityIds": [],
              "storageStateEmails": [],
            });
        }

        let started_at = active
            .iter()
            .filter_map(|task| task.started_at.or(Some(task.created_at)))
            .min()
            .map(iso_timestamp_from_ms);
        let flow_id = if active.len() > 1 {
            Some("task-queue".to_string())
        } else {
            primary.and_then(|task| task.flow_id.clone())
        };
        let runtime_task_id = if active.len() == 1 {
            primary.map(|task| task.id.clone())
        } else {
            None
        };
        let message = format!(
            "{running_count} running, {queued_count} queued (browser limit {})",
            inner
                .web_connection
                .browser_limit
                .unwrap_or(inner.settings.concurrency)
        );

        json!({
          "runtimeFlowId": flow_id,
          "runtimeTaskId": runtime_task_id,
          "runtimeFlowStatus": "running",
          "runtimeFlowMessage": message,
          "runtimeFlowStartedAt": started_at,
          "runtimeFlowCompletedAt": null,
          "storageStateIdentityIds": [],
          "storageStateEmails": [],
        })
    }

    fn spawn_remote_runtime_state(&self) {
        let Some(context) = self.remote_web_context() else {
            return;
        };
        let state = self.build_runtime_state();

        tauri::async_runtime::spawn(async move {
            let _ = post_remote_runtime_state(context, state).await;
        });
    }

    fn spawn_remote_task_status(
        &self,
        app: &AppHandle,
        task_id: &str,
        status: &str,
        message: Option<String>,
        result: Option<Value>,
        error: Option<String>,
        final_report: bool,
        heartbeat: bool,
    ) {
        let Some(context) = self.remote_task_context(task_id, final_report, heartbeat) else {
            return;
        };
        self.spawn_remote_task_status_with_context(app, context, status, message, result, error);
    }

    fn spawn_remote_task_status_by_ids(
        &self,
        app: &AppHandle,
        connection_id: &str,
        remote_task_id: &str,
        status: &str,
        message: Option<String>,
        result: Option<Value>,
        error: Option<String>,
    ) {
        let Some(context) = self.remote_web_context() else {
            return;
        };
        self.spawn_remote_task_status_with_context(
            app,
            RemoteTaskReportContext {
                base_url: context.base_url,
                access_token: context.access_token,
                connection_id: connection_id.to_string(),
                remote_task_id: remote_task_id.to_string(),
            },
            status,
            message,
            result,
            error,
        );
    }

    fn spawn_remote_task_status_with_context(
        &self,
        app: &AppHandle,
        context: RemoteTaskReportContext,
        status: &str,
        message: Option<String>,
        result: Option<Value>,
        error: Option<String>,
    ) {
        let runtime = self.clone();
        let app = app.clone();
        let status = status.to_string();
        tauri::async_runtime::spawn(async move {
            match post_remote_task_status(
                context.clone(),
                RemoteTaskStatusUpdate {
                    status,
                    message,
                    result,
                    error,
                },
            )
            .await
            {
                Ok(response) => {
                    if response.stop_requested {
                        runtime
                            .handle_remote_stop_request(
                                &app,
                                &context.remote_task_id,
                                response.stop_reason,
                            )
                            .await;
                    }
                }
                Err(error) => {
                    runtime.append_log(
                        &app,
                        &context.remote_task_id,
                        "system",
                        format!("Failed to report task status to Codey Web: {error}"),
                    );
                }
            }
        });
    }

    async fn handle_remote_stop_request(
        &self,
        app: &AppHandle,
        task_id: &str,
        reason: Option<String>,
    ) {
        let task = self.cancel_task(task_id);
        if let Some(mut task) = task {
            let message = reason.unwrap_or_else(|| "Task stopped by Codey Web.".to_string());
            task.message = Some(message.clone());
            self.patch_task(app, task_id, |existing| {
                existing.message = Some(message.clone());
            });
            if let Some(pid) = task.pid {
                let _ = kill_process_tree(pid).await;
            }
            emit_task_changed(app, &task);
            self.spawn_remote_task_status(
                app,
                task_id,
                "CANCELED",
                Some(message),
                None,
                None,
                true,
                false,
            );
        }
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
        if let Some(message) = event
            .message
            .as_ref()
            .filter(|message| !message.trim().is_empty())
        {
            self.append_log(app, task_id, "event", message.to_string());
        }

        match event.event.as_str() {
            "host.ready" | "flow.started" | "flow.progress" | "flow.storage_state_loaded" => {
                if let Some(message) = event.message {
                    let message_for_report = message.clone();
                    self.patch_task(app, task_id, |task| {
                        task.message = Some(message);
                    });
                    self.spawn_remote_task_status(
                        app,
                        task_id,
                        "RUNNING",
                        Some(message_for_report),
                        None,
                        None,
                        false,
                        true,
                    );
                    self.spawn_remote_runtime_state();
                }
            }
            "flow.completed" => {
                let result = event.data.clone();
                let message = event.message.clone();
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
                self.spawn_remote_task_status(
                    app,
                    task_id,
                    "SUCCEEDED",
                    message,
                    result.and_then(normalize_result_record),
                    None,
                    true,
                    false,
                );
                self.spawn_remote_runtime_state();
            }
            "flow.failed" | "host.failed" => {
                let message = event.message.clone();
                self.patch_task(app, task_id, |task| {
                    task.status = TaskStatus::Failed;
                    task.completed_at = Some(now_ms());
                    task.message = event.message;
                });
                self.spawn_remote_task_status(
                    app,
                    task_id,
                    "FAILED",
                    message.clone(),
                    None,
                    message,
                    true,
                    false,
                );
                self.spawn_remote_runtime_state();
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
    let task = build_flow_task(FlowTaskBuildInput {
        id: task_id,
        flow_id,
        title,
        config: input.config,
        batch: None,
        metadata: None,
        external_services: None,
        remote_connection_id: None,
        remote_task_id: None,
        message: Some("Queued".to_string()),
    });

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

#[tauri::command]
fn connect_codey_web(
    app: AppHandle,
    runtime: State<'_, DesktopRuntime>,
) -> Result<WebConnectionSnapshot, String> {
    runtime.start_web_connection(app)
}

#[tauri::command]
fn disconnect_codey_web(
    app: AppHandle,
    runtime: State<'_, DesktopRuntime>,
) -> WebConnectionSnapshot {
    runtime.disconnect_web_connection(&app)
}

fn build_flow_task(input: FlowTaskBuildInput) -> DesktopTask {
    let mut payload = json!({
      "taskId": input.remote_task_id.clone().unwrap_or_else(|| input.id.clone()),
      "flowId": input.flow_id,
      "config": input.config,
    });

    if let Some(batch) = input.batch {
        payload["batch"] = batch;
    }
    if let Some(metadata) = input.metadata {
        payload["metadata"] = metadata;
    }
    if let Some(external_services) = input.external_services {
        payload["externalServices"] = external_services;
    }

    DesktopTask {
        id: input.id,
        kind: "flow".to_string(),
        flow_id: payload
            .get("flowId")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        remote_task_id: input.remote_task_id,
        remote_connection_id: input.remote_connection_id,
        title: input.title,
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
        message: input.message.or_else(|| Some("Queued".to_string())),
        logs: Vec::new(),
        cancel_requested: false,
        remote_final_reported: false,
        last_remote_heartbeat_at: None,
    }
}

fn normalize_claimed_flow_task_payload(
    task: &ClaimedFlowTask,
) -> Result<NormalizedClaimedFlowTaskPayload, String> {
    let Some(payload) = task.payload.as_object() else {
        return Err("Codey Web returned a flow task without an object payload.".to_string());
    };

    if payload.get("kind").and_then(Value::as_str) != Some("flow_task") {
        return Err("Codey Web returned a non-flow task payload.".to_string());
    }

    let flow_id = payload
        .get("flowId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Codey Web returned a flow task without flowId.".to_string())?
        .to_string();
    if !ALLOWED_FLOW_IDS.contains(&flow_id.as_str()) {
        return Err(format!("Unsupported Codey flow from Web: {flow_id}"));
    }

    let config = payload
        .get("config")
        .or_else(|| payload.get("options"))
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    Ok(NormalizedClaimedFlowTaskPayload {
        remote_task_id: task.id.clone(),
        flow_id,
        config,
        batch: payload
            .get("batch")
            .filter(|value| value.is_object())
            .cloned(),
        metadata: payload
            .get("metadata")
            .filter(|value| value.is_object())
            .cloned(),
        external_services: payload
            .get("externalServices")
            .filter(|value| value.is_object())
            .cloned(),
    })
}

fn set_host_env_if_present(
    env: &mut serde_json::Map<String, Value>,
    name: &str,
    value: Option<&String>,
) {
    if let Some(value) = value
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        env.insert(name.to_string(), Value::String(value.to_string()));
    }
}

fn token_endpoint_auth_method_env(value: &TokenEndpointAuthMethod) -> &'static str {
    match value {
        TokenEndpointAuthMethod::ClientSecretBasic => "client_secret_basic",
        TokenEndpointAuthMethod::ClientSecretPost => "client_secret_post",
    }
}

fn build_automation_host_env(
    workspace_root: &PathBuf,
    settings: &DesktopSettings,
) -> serde_json::Map<String, Value> {
    let mut env = serde_json::Map::new();
    env.insert(
        "CODEY_WORKSPACE_ROOT".to_string(),
        Value::String(workspace_root.display().to_string()),
    );
    set_host_env_if_present(
        &mut env,
        "CODEY_APP_BASE_URL",
        settings.app_base_url.as_ref(),
    );
    set_host_env_if_present(
        &mut env,
        "CODEY_APP_CLIENT_ID",
        settings.app_client_id.as_ref(),
    );
    set_host_env_if_present(
        &mut env,
        "CODEY_APP_CLIENT_SECRET",
        settings.app_client_secret.as_ref(),
    );
    set_host_env_if_present(
        &mut env,
        "CODEY_APP_CLI_WS_PATH",
        settings.cli_web_socket_path.as_ref(),
    );
    set_host_env_if_present(
        &mut env,
        "CODEY_APP_OIDC_ISSUER",
        settings.oidc_issuer.as_ref(),
    );
    set_host_env_if_present(
        &mut env,
        "CODEY_APP_OIDC_BASE_PATH",
        settings.oidc_base_path.as_ref(),
    );
    if let Some(method) = settings.token_endpoint_auth_method.as_ref() {
        env.insert(
            "CODEY_APP_TOKEN_ENDPOINT_AUTH_METHOD".to_string(),
            Value::String(token_endpoint_auth_method_env(method).to_string()),
        );
    }
    env
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
    file.write_all(&content)
        .map_err(|error| format!("Failed to write {}: {error}", task_file.display()))?;
    Ok(task_file)
}

#[derive(Debug)]
struct DenoHostOutputChunk {
    stream: &'static str,
    text: String,
}

#[derive(Default)]
struct LineAccumulator {
    pending: String,
}

impl LineAccumulator {
    fn push(&mut self, text: &str) -> Vec<String> {
        self.pending.push_str(text);
        let mut lines = Vec::new();

        while let Some(index) = self.pending.find('\n') {
            let mut line = self.pending.drain(..=index).collect::<String>();
            if line.ends_with('\n') {
                line.pop();
            }
            if line.ends_with('\r') {
                line.pop();
            }
            lines.push(line);
        }

        lines
    }

    fn finish(self) -> Option<String> {
        if self.pending.is_empty() {
            None
        } else {
            Some(self.pending)
        }
    }
}

fn handle_host_stdout_line(app: &AppHandle, runtime: &DesktopRuntime, task_id: &str, line: String) {
    match serde_json::from_str::<DesktopHostEvent>(&line) {
        Ok(event)
            if event.kind == "codey-desktop-event"
                && event
                    .task_id
                    .as_ref()
                    .is_none_or(|event_task_id| event_task_id == task_id) =>
        {
            runtime.apply_host_event(app, task_id, event);
        }
        _ => runtime.append_log(app, task_id, "stdout", line),
    }
}

fn handle_host_line(
    app: &AppHandle,
    runtime: &DesktopRuntime,
    task_id: &str,
    stream: &str,
    line: String,
) {
    if stream == "stdout" {
        handle_host_stdout_line(app, runtime, task_id, line);
    } else {
        runtime.append_log(app, task_id, stream, line);
    }
}

async fn read_deno_host_output(
    app: AppHandle,
    runtime: DesktopRuntime,
    task_id: String,
    mut output_rx: mpsc::UnboundedReceiver<DenoHostOutputChunk>,
) {
    let mut stdout = LineAccumulator::default();
    let mut stderr = LineAccumulator::default();

    while let Some(chunk) = output_rx.recv().await {
        let accumulator = if chunk.stream == "stdout" {
            &mut stdout
        } else {
            &mut stderr
        };
        for line in accumulator.push(&chunk.text) {
            handle_host_line(&app, &runtime, &task_id, chunk.stream, line);
        }
    }

    if let Some(line) = stdout.finish() {
        handle_host_stdout_line(&app, &runtime, &task_id, line);
    }
    if let Some(line) = stderr.finish() {
        runtime.append_log(&app, &task_id, "stderr", line);
    }
}

fn js_string(value: impl AsRef<str>) -> Result<String, String> {
    serde_json::to_string(value.as_ref())
        .map_err(|error| format!("Failed to encode JavaScript string: {error}"))
}

fn js_value(value: &Value) -> Result<String, String> {
    serde_json::to_string(value)
        .map_err(|error| format!("Failed to encode JavaScript value: {error}"))
}

fn build_deno_host_wrapper(
    host_url: &str,
    host_path: &str,
    task_file: &str,
    env: serde_json::Map<String, Value>,
) -> Result<String, String> {
    let host_url = js_string(host_url)?;
    let argv = js_value(&json!([
        "codey-desktop-deno",
        host_path,
        "--taskFile",
        task_file
    ]))?;
    let env = js_value(&Value::Object(env))?;

    Ok(format!(
        r#"
import process from "node:process";

const hostUrl = {host_url};
const argv = {argv};
const hostEnv = {env};
const textDecoder = new TextDecoder();

function chunkToString(chunk, encoding) {{
  if (typeof chunk === "string") {{
    return chunk;
  }}
  if (chunk instanceof Uint8Array) {{
    return textDecoder.decode(chunk);
  }}
  if (chunk && typeof chunk.toString === "function") {{
    return chunk.toString(typeof encoding === "string" ? encoding : undefined);
  }}
  return String(chunk ?? "");
}}

function patchWrite(stream, callbackName) {{
  Object.defineProperty(stream, "write", {{
    configurable: true,
    writable: true,
    value(chunk, encoding, callback) {{
      const done = typeof encoding === "function" ? encoding : callback;
      rustyscript.functions[callbackName](chunkToString(chunk, encoding));
      if (typeof done === "function") {{
        queueMicrotask(done);
      }}
      return true;
    }},
  }});
}}

Object.assign(process.env, hostEnv);
Object.defineProperty(process, "argv", {{
  configurable: true,
  writable: true,
  value: argv,
}});

patchWrite(process.stdout, "codeyDesktopStdout");
patchWrite(process.stderr, "codeyDesktopStderr");

await import(hostUrl);

const exitCode = Number(process.exitCode ?? 0);
if (exitCode !== 0) {{
  throw new Error(`Codey Desktop automation host exited with code ${{exitCode}}`);
}}
"#
    ))
}

fn send_deno_output(
    sender: &mpsc::UnboundedSender<DenoHostOutputChunk>,
    stream: &'static str,
    args: &[rustyscript::serde_json::Value],
) -> Result<rustyscript::serde_json::Value, rustyscript::Error> {
    let text = args
        .get(0)
        .and_then(rustyscript::serde_json::Value::as_str)
        .map(str::to_string)
        .or_else(|| args.get(0).map(ToString::to_string))
        .unwrap_or_default();
    let _ = sender.send(DenoHostOutputChunk { stream, text });
    Ok(rustyscript::serde_json::Value::Null)
}

fn run_automation_host_with_deno(
    host_path: PathBuf,
    task_file: PathBuf,
    workspace_root: PathBuf,
    settings: DesktopSettings,
    output_tx: mpsc::UnboundedSender<DenoHostOutputChunk>,
) -> Result<(), String> {
    let host_url = rustyscript::deno_core::ModuleSpecifier::from_file_path(&host_path)
        .map_err(|_| format!("Failed to convert {} to a file URL", host_path.display()))?
        .to_string();
    let host_path_string = host_path.display().to_string();
    let task_file_string = task_file.display().to_string();
    let env = build_automation_host_env(&workspace_root, &settings);
    let wrapper = build_deno_host_wrapper(&host_url, &host_path_string, &task_file_string, env)?;
    let module = Module::new("codey-desktop-deno-host.js", wrapper);
    let filesystem = Arc::new(rustyscript::extensions::deno_fs::RealFs);
    let resolver = Arc::new(rustyscript::RustyResolver::new(
        Some(workspace_root.clone()),
        filesystem.clone(),
    ));
    let mut options = RuntimeOptions::default();
    options.extension_options.node_resolver = resolver;
    options.extension_options.filesystem = filesystem;

    let mut runtime = DenoRuntime::new(options)
        .map_err(|error| format!("Failed to initialize embedded Deno runtime: {error}"))?;
    runtime.set_current_dir(&workspace_root).map_err(|error| {
        format!(
            "Failed to set embedded Deno runtime cwd to {}: {error}",
            workspace_root.display()
        )
    })?;

    {
        let sender = output_tx.clone();
        runtime
            .register_function("codeyDesktopStdout", move |args| {
                send_deno_output(&sender, "stdout", args)
            })
            .map_err(|error| format!("Failed to register Deno stdout bridge: {error}"))?;
    }
    {
        let sender = output_tx.clone();
        runtime
            .register_function("codeyDesktopStderr", move |args| {
                send_deno_output(&sender, "stderr", args)
            })
            .map_err(|error| format!("Failed to register Deno stderr bridge: {error}"))?;
    }

    runtime
        .load_module(&module)
        .map_err(|error| format!("Embedded Deno automation host failed: {error}"))?;

    Ok(())
}

fn emit_task_changed(app: &AppHandle, task: &DesktopTask) {
    let _ = app.emit("task-changed", task);
}

fn emit_web_connection_changed(app: &AppHandle, snapshot: &WebConnectionSnapshot) {
    let _ = app.emit("web-connection-changed", snapshot);
}

fn remote_status_from_task_status(status: &TaskStatus) -> Option<&'static str> {
    match status {
        TaskStatus::Queued => Some("LEASED"),
        TaskStatus::Running => Some("RUNNING"),
        TaskStatus::Passed => Some("SUCCEEDED"),
        TaskStatus::Failed => Some("FAILED"),
        TaskStatus::Canceled => Some("CANCELED"),
    }
}

fn normalize_result_record(value: Value) -> Option<Value> {
    value.is_object().then_some(value)
}

fn remote_result_for_task(task: &DesktopTask) -> Option<Value> {
    task.config
        .get("result")
        .cloned()
        .and_then(normalize_result_record)
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

fn iso_timestamp_from_ms(value: u64) -> String {
    DateTime::<Utc>::from(UNIX_EPOCH + Duration::from_millis(value)).to_rfc3339()
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

    app.path()
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

fn strip_trailing_slash(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn normalize_base_path(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "/" {
        return "/".to_string();
    }
    if trimmed.starts_with('/') {
        trimmed.trim_end_matches('/').to_string()
    } else {
        format!("/{}", trimmed.trim_end_matches('/'))
    }
}

fn join_url(base_url: &str, path: &str) -> Result<Url, String> {
    let base = Url::parse(&format!("{}/", strip_trailing_slash(base_url)))
        .map_err(|error| format!("Invalid Codey Web base URL: {error}"))?;
    if path == "/" {
        return Ok(base);
    }
    base.join(path.trim_start_matches('/'))
        .map_err(|error| format!("Unable to build Codey Web URL: {error}"))
}

fn resolve_oidc_issuer(config: &WebClientConfig) -> Result<Url, String> {
    let base_path = normalize_base_path(&config.oidc_base_path);
    if let Some(issuer) = config
        .oidc_issuer
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let parsed = Url::parse(issuer)
            .map_err(|error| format!("Invalid Codey OIDC issuer URL: {error}"))?;
        if base_path == "/" || parsed.path() != "/" {
            return Ok(parsed);
        }
        return join_url(parsed.as_str(), &base_path);
    }

    join_url(&config.base_url, &base_path)
}

fn build_oidc_discovery_url(config: &WebClientConfig) -> Result<Url, String> {
    resolve_oidc_issuer(config)?
        .join(".well-known/openid-configuration")
        .map_err(|error| format!("Unable to build OIDC discovery URL: {error}"))
}

async fn exchange_codey_web_client_credentials(
    config: &WebClientConfig,
) -> Result<WebAuthToken, String> {
    let discovery_url = build_oidc_discovery_url(config)?;
    let client = reqwest::Client::new();
    let discovery = client
        .get(discovery_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Unable to load Codey OIDC discovery: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Codey OIDC discovery failed: {error}"))?
        .json::<OidcDiscovery>()
        .await
        .map_err(|error| format!("Codey OIDC discovery returned invalid JSON: {error}"))?;

    let mut request = client
        .post(&discovery.token_endpoint)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        );
    let mut form = vec![
        ("grant_type", "client_credentials".to_string()),
        ("scope", DEFAULT_WEB_SCOPE.to_string()),
    ];

    match config.token_endpoint_auth_method {
        TokenEndpointAuthMethod::ClientSecretPost => {
            form.push(("client_id", config.client_id.clone()));
            form.push(("client_secret", config.client_secret.clone()));
        }
        TokenEndpointAuthMethod::ClientSecretBasic => {
            let encoded =
                BASE64_STANDARD.encode(format!("{}:{}", config.client_id, config.client_secret));
            request = request.header(reqwest::header::AUTHORIZATION, format!("Basic {encoded}"));
        }
    }

    let token = request
        .form(&form)
        .send()
        .await
        .map_err(|error| format!("Codey OIDC client credentials exchange failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Codey OIDC client credentials exchange failed: {error}"))?
        .json::<OidcTokenResponse>()
        .await
        .map_err(|error| format!("Codey OIDC token endpoint returned invalid JSON: {error}"))?;

    Ok(WebAuthToken {
        access_token: token.access_token,
    })
}

fn build_cli_web_socket_url(config: &WebClientConfig, access_token: &str) -> Result<Url, String> {
    let mut url = join_url(&config.base_url, &config.cli_web_socket_path)?;
    let scheme = match url.scheme() {
        "https" => "wss",
        "http" => "ws",
        other => {
            return Err(format!(
                "Unsupported Codey Web URL scheme for WebSocket: {other}"
            ))
        }
    };
    url.set_scheme(scheme)
        .map_err(|_| "Unable to switch Codey Web URL to WebSocket scheme.".to_string())?;
    url.query_pairs_mut()
        .append_pair("access_token", access_token)
        .append_pair("cliName", &config.cli_name)
        .append_pair("workerId", &config.worker_id)
        .append_pair("registeredFlows", &ALLOWED_FLOW_IDS.join(","));
    if let Some(target) = &config.target {
        url.query_pairs_mut().append_pair("target", target);
    }
    Ok(url)
}

async fn wait_for_cli_connection(
    socket: &mut CodeyWebSocket,
) -> Result<CliConnectionEvent, String> {
    loop {
        let message = next_ws_text(socket).await?;
        let payload: Value = serde_json::from_str(&message)
            .map_err(|error| format!("Codey WebSocket returned malformed JSON: {error}"))?;

        match payload.get("type").and_then(Value::as_str) {
            Some("cli_connection") => {
                let data = payload
                    .get("data")
                    .and_then(Value::as_object)
                    .ok_or_else(|| "Codey WebSocket cli_connection is missing data.".to_string())?;
                let connection_id = data
                    .get("connectionId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        "Codey WebSocket cli_connection is missing connectionId.".to_string()
                    })?
                    .to_string();
                return Ok(CliConnectionEvent {
                    connection_id,
                    worker_id: data
                        .get("workerId")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    cli_name: data
                        .get("cliName")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    target: data
                        .get("target")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    browser_limit: data
                        .get("browserLimit")
                        .and_then(Value::as_u64)
                        .and_then(|value| usize::try_from(value).ok()),
                    connected_at: data
                        .get("connectedAt")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                });
            }
            Some("keepalive") | Some("admin_notification") => {}
            Some("error") => return Err(normalize_ws_error(&payload)),
            _ => {}
        }
    }
}

async fn send_ws_request(
    socket: &mut CodeyWebSocket,
    next_request_id: &mut u64,
    action: &str,
    data: Option<Value>,
) -> Result<Value, String> {
    let request_id = next_request_id.to_string();
    *next_request_id += 1;
    let mut request = json!({
      "type": "request",
      "requestId": request_id,
      "action": action,
    });
    if let Some(data) = data {
        request["data"] = data;
    }
    socket
        .send(Message::Text(request.to_string().into()))
        .await
        .map_err(|error| format!("Unable to send Codey WebSocket request: {error}"))?;

    let response = timeout(WEB_REQUEST_TIMEOUT, async {
        loop {
            let message = next_ws_text(socket).await?;
            let payload: Value = serde_json::from_str(&message)
                .map_err(|error| format!("Codey WebSocket returned malformed JSON: {error}"))?;

            match payload.get("type").and_then(Value::as_str) {
                Some("response")
                    if payload.get("requestId").and_then(Value::as_str)
                        == Some(request_id.as_str()) =>
                {
                    if payload.get("ok").and_then(Value::as_bool) == Some(true) {
                        return Ok(payload.get("data").cloned().unwrap_or(Value::Null));
                    }
                    return Err(normalize_ws_error(&payload));
                }
                Some("error") => return Err(normalize_ws_error(&payload)),
                Some("keepalive") | Some("admin_notification") | Some("cli_connection") => {}
                _ => {}
            }
        }
    })
    .await
    .map_err(|_| format!("Codey WebSocket request timed out: {action}"))??;

    Ok(response)
}

async fn next_ws_text(socket: &mut CodeyWebSocket) -> Result<String, String> {
    loop {
        let Some(message) = socket.next().await else {
            return Err("Codey WebSocket connection closed.".to_string());
        };
        match message {
            Ok(Message::Text(text)) => return Ok(text.to_string()),
            Ok(Message::Binary(bytes)) => {
                return String::from_utf8(bytes.to_vec())
                    .map_err(|error| format!("Codey WebSocket returned non-UTF8 data: {error}"))
            }
            Ok(Message::Ping(bytes)) => socket
                .send(Message::Pong(bytes))
                .await
                .map_err(|error| format!("Unable to answer Codey WebSocket ping: {error}"))?,
            Ok(Message::Pong(_)) => {}
            Ok(Message::Frame(_)) => {}
            Ok(Message::Close(_)) => return Err("Codey WebSocket connection closed.".to_string()),
            Err(WebSocketError::ConnectionClosed) => {
                return Err("Codey WebSocket connection closed.".to_string())
            }
            Err(error) => return Err(format!("Codey WebSocket failed: {error}")),
        }
    }
}

fn normalize_ws_error(payload: &Value) -> String {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| "Codey WebSocket request failed.".to_string())
}

fn normalize_claim_result(value: &Value) -> Result<ClaimResult, String> {
    let browser_limit = value
        .get("browserLimit")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok());
    let Some(task_value) = value.get("task") else {
        return Ok(ClaimResult {
            task: None,
            browser_limit,
        });
    };
    if task_value.is_null() {
        return Ok(ClaimResult {
            task: None,
            browser_limit,
        });
    }
    let Some(task) = task_value.as_object() else {
        return Err("Codey WebSocket returned malformed task claim data.".to_string());
    };
    let id = task
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Codey WebSocket returned a claimed task without id.".to_string())?
        .to_string();

    Ok(ClaimResult {
        task: Some(ClaimedFlowTask {
            id,
            title: task
                .get("title")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            body: task
                .get("body")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            payload: task.get("payload").cloned().unwrap_or(Value::Null),
        }),
        browser_limit,
    })
}

async fn post_remote_runtime_state(context: RemoteWebContext, state: Value) -> Result<(), String> {
    let url = join_url(
        &context.base_url,
        &format!(
            "/api/cli/connections/{}/status",
            urlencoding_component(&context.connection_id)
        ),
    )?;
    post_codey_web_json::<Value>(&context.access_token, url, state).await?;
    Ok(())
}

async fn post_remote_task_status(
    context: RemoteTaskReportContext,
    update: RemoteTaskStatusUpdate,
) -> Result<RemoteTaskStatusResponse, String> {
    let url = join_url(
        &context.base_url,
        &format!(
            "/api/cli/connections/{}/tasks/{}/status",
            urlencoding_component(&context.connection_id),
            urlencoding_component(&context.remote_task_id)
        ),
    )?;
    let mut body = json!({
      "status": update.status,
    });
    if let Some(message) = update.message {
        body["message"] = Value::String(message);
    }
    if let Some(result) = update.result {
        if result.is_object() {
            body["result"] = result;
        }
    }
    if let Some(error) = update.error {
        body["error"] = Value::String(error);
    }

    post_codey_web_json(&context.access_token, url, body).await
}

async fn post_codey_web_json<T>(access_token: &str, url: Url, body: Value) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(access_token)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Unable to call Codey Web: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Unable to read Codey Web response: {error}"))?;
    if !status.is_success() {
        return Err(if text.trim().is_empty() {
            format!("Codey Web request failed with {status}")
        } else {
            text
        });
    }
    serde_json::from_str(&text).map_err(|error| format!("Codey Web returned invalid JSON: {error}"))
}

fn urlencoding_component(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn normalize_scope_segment(value: Option<&str>, fallback: &str) -> String {
    let source = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_ascii_lowercase();
    let mut slug = String::new();
    let mut previous_dash = false;
    for character in source.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            previous_dash = false;
        } else if !previous_dash {
            slug.push('-');
            previous_dash = true;
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

fn worker_id_path(workspace_root: &PathBuf, cli_name: &str, target: Option<&str>) -> PathBuf {
    workspace_root.join(".codey").join("workers").join(format!(
        "{}__{}.json",
        normalize_scope_segment(Some(cli_name), "codey-desktop"),
        normalize_scope_segment(target, "shared")
    ))
}

fn resolve_desktop_worker_id(
    workspace_root: &PathBuf,
    cli_name: &str,
    target: Option<&str>,
) -> Result<String, String> {
    let path = worker_id_path(workspace_root, cli_name, target);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
                if let Some(worker_id) = parsed
                    .get("workerId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Ok(worker_id.to_string());
                }
            }
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let worker_id = Uuid::new_v4().to_string();
    let content = serde_json::to_string_pretty(&json!({
      "version": 1,
      "workerId": worker_id,
      "cliName": cli_name.trim(),
      "target": target,
      "createdAt": Utc::now().to_rfc3339(),
    }))
    .map_err(|error| format!("Failed to serialize Codey Desktop worker id: {error}"))?;
    fs::write(&path, format!("{content}\n"))
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
    Ok(worker_id)
}

pub fn run() {
    let workspace_root = resolve_workspace_root();
    rustyscript::init_platform(4, true);

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
            connect_codey_web,
            disconnect_codey_web,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Codey Desktop");
}

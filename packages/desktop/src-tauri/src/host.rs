use rustyscript::{Module, Runtime as DenoRuntime, RuntimeOptions};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf, sync::Arc};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tokio::sync::mpsc;

use crate::*;
pub(crate) fn set_host_env_if_present(
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

pub(crate) fn token_endpoint_auth_method_env(value: &TokenEndpointAuthMethod) -> &'static str {
    match value {
        TokenEndpointAuthMethod::ClientSecretBasic => "client_secret_basic",
        TokenEndpointAuthMethod::ClientSecretPost => "client_secret_post",
    }
}

pub(crate) fn build_automation_host_env(
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

pub(crate) fn resolve_automation_host_path(
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
pub(crate) struct DesktopHostEvent {
    pub(crate) kind: String,
    pub(crate) task_id: Option<String>,
    pub(crate) event: String,
    pub(crate) message: Option<String>,
    pub(crate) data: Option<Value>,
}

pub(crate) fn write_task_payload(
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
pub(crate) struct DenoHostOutputChunk {
    pub(crate) stream: &'static str,
    pub(crate) text: String,
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

pub(crate) fn handle_host_stdout_line(
    app: &AppHandle,
    runtime: &DesktopRuntime,
    task_id: &str,
    line: String,
) {
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

pub(crate) fn handle_host_line(
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

pub(crate) async fn read_deno_host_output(
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

pub(crate) fn js_string(value: impl AsRef<str>) -> Result<String, String> {
    serde_json::to_string(value.as_ref())
        .map_err(|error| format!("Failed to encode JavaScript string: {error}"))
}

pub(crate) fn js_value(value: &Value) -> Result<String, String> {
    serde_json::to_string(value)
        .map_err(|error| format!("Failed to encode JavaScript value: {error}"))
}

pub(crate) fn build_deno_host_wrapper(
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

function isWritableStreamLike(value) {{
  return value !== null && (typeof value === "object" || typeof value === "function");
}}

function defineStreamProperty(stream, name, value) {{
  if (stream[name] === undefined) {{
    Object.defineProperty(stream, name, {{
      configurable: true,
      writable: true,
      value,
    }});
  }}
}}

function patchWrite(streamName, callbackName, fd) {{
  const existing = process[streamName];
  const stream = isWritableStreamLike(existing) ? existing : {{}};
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
  defineStreamProperty(stream, "fd", fd);
  defineStreamProperty(stream, "isTTY", false);
  defineStreamProperty(stream, "columns", 80);
  defineStreamProperty(stream, "rows", 24);
  Object.defineProperty(process, streamName, {{
    configurable: true,
    writable: true,
    value: stream,
  }});
}}

Object.assign(process.env, hostEnv);
Object.defineProperty(process, "argv", {{
  configurable: true,
  writable: true,
  value: argv,
}});

patchWrite("stdout", "codeyDesktopStdout", 1);
patchWrite("stderr", "codeyDesktopStderr", 2);

await import(hostUrl);

const exitCode = Number(process.exitCode ?? 0);
if (exitCode !== 0) {{
  throw new Error(`Codey Desktop automation host exited with code ${{exitCode}}`);
}}
"#
    ))
}

pub(crate) fn send_deno_output(
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

pub(crate) fn run_automation_host_with_deno(
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

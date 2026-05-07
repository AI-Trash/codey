mod app;
mod commands;
mod events;
mod host;
mod runtime;
mod tasks;
mod utils;
mod web;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::net::TcpStream;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
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

pub fn run() {
    app::run();
}

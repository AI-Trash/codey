use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message};
use url::Url;
use uuid::Uuid;

use crate::*;
pub(crate) fn strip_trailing_slash(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

pub(crate) fn normalize_base_path(value: &str) -> String {
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

pub(crate) fn join_url(base_url: &str, path: &str) -> Result<Url, String> {
    let base = Url::parse(&format!("{}/", strip_trailing_slash(base_url)))
        .map_err(|error| format!("Invalid Codey Web base URL: {error}"))?;
    if path == "/" {
        return Ok(base);
    }
    base.join(path.trim_start_matches('/'))
        .map_err(|error| format!("Unable to build Codey Web URL: {error}"))
}

pub(crate) fn resolve_oidc_issuer(config: &WebClientConfig) -> Result<Url, String> {
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

pub(crate) fn build_oidc_discovery_url(config: &WebClientConfig) -> Result<Url, String> {
    resolve_oidc_issuer(config)?
        .join(".well-known/openid-configuration")
        .map_err(|error| format!("Unable to build OIDC discovery URL: {error}"))
}

pub(crate) async fn exchange_codey_web_client_credentials(
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

pub(crate) fn build_cli_web_socket_url(
    config: &WebClientConfig,
    access_token: &str,
) -> Result<Url, String> {
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

pub(crate) async fn wait_for_cli_connection(
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

pub(crate) async fn send_ws_request(
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

pub(crate) async fn next_ws_text(socket: &mut CodeyWebSocket) -> Result<String, String> {
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

pub(crate) fn normalize_ws_error(payload: &Value) -> String {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| "Codey WebSocket request failed.".to_string())
}

pub(crate) fn normalize_claim_result(value: &Value) -> Result<ClaimResult, String> {
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

pub(crate) async fn post_remote_runtime_state(
    context: RemoteWebContext,
    state: Value,
) -> Result<(), String> {
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

pub(crate) async fn post_remote_task_status(
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

pub(crate) async fn post_codey_web_json<T>(
    access_token: &str,
    url: Url,
    body: Value,
) -> Result<T, String>
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

pub(crate) fn urlencoding_component(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub(crate) fn normalize_scope_segment(value: Option<&str>, fallback: &str) -> String {
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

pub(crate) fn worker_id_path(
    workspace_root: &PathBuf,
    cli_name: &str,
    target: Option<&str>,
) -> PathBuf {
    workspace_root.join(".codey").join("workers").join(format!(
        "{}__{}.json",
        normalize_scope_segment(Some(cli_name), "codey-desktop"),
        normalize_scope_segment(target, "shared")
    ))
}

pub(crate) fn resolve_desktop_worker_id(
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

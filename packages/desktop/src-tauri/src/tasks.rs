use serde_json::{json, Value};

use crate::{utils::now_ms, *};

fn parse_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::String(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            match normalized.as_str() {
                "1" | "true" | "yes" | "on" => Some(true),
                "0" | "false" | "no" | "off" => Some(false),
                _ => None,
            }
        }
        _ => None,
    }
}

fn normalize_number(value: &Value) -> Option<Value> {
    match value {
        Value::Number(number) => Some(Value::Number(number.clone())),
        Value::String(value) => value
            .trim()
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number),
        _ => None,
    }
}

fn normalize_string(value: &Value) -> Option<Value> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| Value::String(value.to_string()))
}

fn normalize_string_list(value: &Value) -> Option<Value> {
    let values = match value {
        Value::Array(values) => values
            .iter()
            .filter_map(|entry| entry.as_str())
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(|entry| Value::String(entry.to_string()))
            .collect::<Vec<_>>(),
        Value::String(value) => value
            .split([',', '\n'])
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(|entry| Value::String(entry.to_string()))
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };

    (!values.is_empty()).then_some(Value::Array(values))
}

fn normalize_config_value(key: &str, value: &Value) -> Option<Value> {
    match key {
        "headless"
        | "har"
        | "record"
        | "recordPageContent"
        | "restoreStorageState"
        | "chromeDefaultProfile"
        | "claimTrial"
        | "unlinkBeforeLink"
        | "hostedCheckoutReview"
        | "pruneUnmanagedWorkspaceMembers"
        | "authorizeUrlOnly"
        | "androidNoReset" => parse_bool(value).map(Value::Bool),
        "slowMo"
        | "verificationTimeoutMs"
        | "pollIntervalMs"
        | "workspaceIndex"
        | "redirectPort" => normalize_number(value),
        "hostedCheckoutCountry" | "inviteEmail" => normalize_string_list(value),
        _ => normalize_string(value).or_else(|| match value {
            Value::Bool(_) | Value::Number(_) | Value::Array(_) | Value::Object(_) => {
                Some(value.clone())
            }
            _ => None,
        }),
    }
}

fn apply_flow_config_defaults(flow_id: &str, config: &mut serde_json::Map<String, Value>) {
    if !config.contains_key("record")
        && config
            .get("chromeDefaultProfile")
            .and_then(parse_bool)
            .unwrap_or(false)
    {
        config.insert("record".to_string(), Value::Bool(true));
    }

    if !config.contains_key("record")
        && matches!(flow_id, "codex-oauth" | "chatgpt-team-trial-gopay")
        && config.get("har").and_then(parse_bool).unwrap_or(false)
    {
        config.insert("record".to_string(), Value::Bool(true));
    }

    if flow_id == "noop" {
        config.entry("har".to_string()).or_insert(Value::Bool(true));
        config
            .entry("record".to_string())
            .or_insert(Value::Bool(true));
    }
}

pub(crate) fn normalize_flow_config(flow_id: &str, value: Value) -> Value {
    let mut output = serde_json::Map::new();
    if let Value::Object(input) = value {
        for (key, value) in input {
            if let Some(value) = normalize_config_value(&key, &value) {
                output.insert(key, value);
            }
        }
    }
    apply_flow_config_defaults(flow_id, &mut output);
    Value::Object(output)
}

pub(crate) fn build_flow_task(input: FlowTaskBuildInput) -> DesktopTask {
    let config = normalize_flow_config(&input.flow_id, input.config);
    let mut payload = json!({
      "taskId": input.remote_task_id.clone().unwrap_or_else(|| input.id.clone()),
      "flowId": input.flow_id,
      "config": config,
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

pub(crate) fn normalize_claimed_flow_task_payload(
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

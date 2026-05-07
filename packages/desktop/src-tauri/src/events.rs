use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::*;
pub(crate) fn emit_task_changed(app: &AppHandle, task: &DesktopTask) {
    let _ = app.emit("task-changed", task);
}

pub(crate) fn emit_web_connection_changed(app: &AppHandle, snapshot: &WebConnectionSnapshot) {
    let _ = app.emit("web-connection-changed", snapshot);
}

pub(crate) fn remote_status_from_task_status(status: &TaskStatus) -> Option<&'static str> {
    match status {
        TaskStatus::Queued => Some("LEASED"),
        TaskStatus::Running => Some("RUNNING"),
        TaskStatus::Passed => Some("SUCCEEDED"),
        TaskStatus::Failed => Some("FAILED"),
        TaskStatus::Canceled => Some("CANCELED"),
    }
}

pub(crate) fn normalize_result_record(value: Value) -> Option<Value> {
    value.is_object().then_some(value)
}

pub(crate) fn remote_result_for_task(task: &DesktopTask) -> Option<Value> {
    task.config
        .get("result")
        .cloned()
        .and_then(normalize_result_record)
}

pub(crate) fn task_sort_rank(task: &DesktopTask) -> u8 {
    match task.status {
        TaskStatus::Running => 0,
        TaskStatus::Queued => 1,
        TaskStatus::Failed => 2,
        TaskStatus::Canceled => 3,
        TaskStatus::Passed => 4,
    }
}

pub(crate) fn is_finished(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Passed | TaskStatus::Failed | TaskStatus::Canceled
    )
}

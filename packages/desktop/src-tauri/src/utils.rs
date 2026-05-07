use chrono::{DateTime, Utc};
use std::{
    env, fs,
    path::PathBuf,
    sync::atomic::Ordering,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::*;
pub(crate) fn next_task_id(runtime: &DesktopRuntime, prefix: &str) -> String {
    let next = runtime.counter.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{next}", now_ms())
}

pub(crate) fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim().to_string();
        (!trimmed.is_empty()).then_some(trimmed)
    })
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

pub(crate) fn iso_timestamp_from_ms(value: u64) -> String {
    DateTime::<Utc>::from(UNIX_EPOCH + Duration::from_millis(value)).to_rfc3339()
}

pub(crate) fn resolve_workspace_root() -> PathBuf {
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

pub(crate) fn resolve_runtime_root(app: &AppHandle, workspace_root: &PathBuf) -> PathBuf {
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

pub(crate) fn settings_path(workspace_root: &PathBuf) -> PathBuf {
    workspace_root.join(".codey").join("desktop-settings.json")
}

pub(crate) fn read_settings(workspace_root: &PathBuf) -> Result<DesktopSettings, String> {
    let path = settings_path(workspace_root);
    if !path.exists() {
        return Ok(DesktopSettings::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

pub(crate) fn write_settings(
    workspace_root: &PathBuf,
    settings: &DesktopSettings,
) -> Result<(), String> {
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

pub(crate) async fn kill_process_tree(pid: u32) -> Result<(), String> {
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

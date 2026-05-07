use tauri::{AppHandle, State};

use crate::{events::emit_task_changed, tasks::build_flow_task, utils::*, *};
#[tauri::command]
pub(crate) fn get_desktop_state(runtime: State<'_, DesktopRuntime>) -> DesktopSnapshot {
    runtime.snapshot()
}

#[tauri::command]
pub(crate) fn enqueue_flow_task(
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
pub(crate) async fn cancel_task(
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
pub(crate) fn update_desktop_settings(
    app: AppHandle,
    runtime: State<'_, DesktopRuntime>,
    input: UpdateDesktopSettingsInput,
) -> Result<DesktopSettings, String> {
    let settings = runtime.update_settings(input)?;
    runtime.schedule(app);
    Ok(settings)
}

#[tauri::command]
pub(crate) fn clear_finished_tasks(runtime: State<'_, DesktopRuntime>) -> DesktopSnapshot {
    runtime.clear_finished();
    runtime.snapshot()
}

#[tauri::command]
pub(crate) fn connect_codey_web(
    app: AppHandle,
    runtime: State<'_, DesktopRuntime>,
) -> Result<WebConnectionSnapshot, String> {
    runtime.start_web_connection(app)
}

#[tauri::command]
pub(crate) fn disconnect_codey_web(
    app: AppHandle,
    runtime: State<'_, DesktopRuntime>,
) -> WebConnectionSnapshot {
    runtime.disconnect_web_connection(&app)
}

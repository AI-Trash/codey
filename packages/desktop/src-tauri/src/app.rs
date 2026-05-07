use std::fs;
use tauri::Manager;

use crate::{commands, utils::*, DesktopRuntime};
pub(crate) fn run() {
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
            commands::get_desktop_state,
            commands::enqueue_flow_task,
            commands::cancel_task,
            commands::update_desktop_settings,
            commands::clear_finished_tasks,
            commands::connect_codey_web,
            commands::disconnect_codey_web,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Codey Desktop");
}

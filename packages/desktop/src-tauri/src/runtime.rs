use serde_json::{json, Value};
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::{sync::mpsc, time::sleep};
use tokio_tungstenite::connect_async;

use crate::{events::*, host::*, tasks::*, utils::*, web::*, *};
impl DesktopRuntime {
    pub(crate) fn new(workspace_root: PathBuf) -> Self {
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

    pub(crate) fn snapshot(&self) -> DesktopSnapshot {
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

    pub(crate) fn enqueue(&self, task: DesktopTask) -> DesktopTask {
        let mut inner = self.inner.lock().expect("desktop state poisoned");
        inner.order.push_front(task.id.clone());
        inner.tasks.insert(task.id.clone(), task.clone());
        task
    }

    pub(crate) fn enqueue_remote_task(
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

    pub(crate) fn update_settings(
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

    pub(crate) fn clear_finished(&self) {
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

    pub(crate) fn cancel_task(&self, task_id: &str) -> Option<DesktopTask> {
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

    pub(crate) fn next_task_to_start(&self) -> Option<DesktopTask> {
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

    pub(crate) fn schedule(&self, app: AppHandle) {
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

    pub(crate) fn has_claim_capacity(&self, browser_limit: Option<usize>) -> bool {
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

    pub(crate) fn start_web_connection(
        &self,
        app: AppHandle,
    ) -> Result<WebConnectionSnapshot, String> {
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

    pub(crate) fn disconnect_web_connection(&self, app: &AppHandle) -> WebConnectionSnapshot {
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

    pub(crate) fn resolve_web_client_config(&self) -> Result<WebClientConfig, String> {
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

    pub(crate) async fn run_web_connection_loop(
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

    pub(crate) async fn run_single_web_connection(
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

    pub(crate) async fn run_task(&self, app: AppHandle, task_id: String) {
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

    pub(crate) fn read_task(&self, task_id: &str) -> Option<DesktopTask> {
        let inner = self.inner.lock().expect("desktop state poisoned");
        inner.tasks.get(task_id).cloned()
    }

    pub(crate) fn patch_task<F>(&self, app: &AppHandle, task_id: &str, patch: F)
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

    pub(crate) fn finish_task(
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

    pub(crate) fn patch_web_connection<F>(
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

    pub(crate) fn remote_task_context(
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

    pub(crate) fn remote_web_context(&self) -> Option<RemoteWebContext> {
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

    pub(crate) fn build_runtime_state(&self) -> Value {
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

    pub(crate) fn spawn_remote_runtime_state(&self) {
        let Some(context) = self.remote_web_context() else {
            return;
        };
        let state = self.build_runtime_state();

        tauri::async_runtime::spawn(async move {
            let _ = post_remote_runtime_state(context, state).await;
        });
    }

    pub(crate) fn spawn_remote_task_status(
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

    pub(crate) fn spawn_remote_task_status_by_ids(
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

    pub(crate) fn spawn_remote_task_status_with_context(
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

    pub(crate) async fn handle_remote_stop_request(
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

    pub(crate) fn append_log(&self, app: &AppHandle, task_id: &str, stream: &str, text: String) {
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

    pub(crate) fn apply_host_event(&self, app: &AppHandle, task_id: &str, event: DesktopHostEvent) {
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

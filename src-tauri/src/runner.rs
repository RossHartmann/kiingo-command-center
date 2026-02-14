use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use crate::adapters::claude::ClaudeAdapter;
use crate::adapters::codex::CodexAdapter;
use crate::adapters::ValidatedCommand;
use crate::adapters::compatibility::CompatibilityRegistry;
use crate::adapters::Adapter;
use crate::db::Database;
use crate::errors::{AppError, AppResult};
use crate::harness::capability_adjuster::apply_harness_capabilities;
use crate::harness::cli_allowlist::prepare_cli_allowlist;
use crate::harness::cli_missing::build_cli_missing_payload;
use crate::harness::line_buffer::LineBuffer;
use crate::harness::shell_prelude::prepare_shell_prelude;
use crate::harness::structured_output::{resolve_structured_output, validate_structured_output};
use crate::models::{
    AcceptedResponse, AppSettings, ArchiveConversationPayload, BindMetricToScreenPayload, BooleanResponse,
    CapabilitySnapshot, ConversationDetail, ConversationRecord, ConversationSummary, CreateConversationPayload,
    ExportResponse, ListConversationsFilters, ListRunsFilters, MetricDefinition, MetricRefreshResponse,
    MetricSnapshot, Profile, Provider, RenameConversationPayload, RerunResponse, RunDetail,
    RunMode, RunStatus, SaveMetricDefinitionPayload, SaveProfilePayload, SchedulerJob, ScreenMetricBinding,
    ScreenMetricView, SendConversationMessagePayload, StartInteractiveSessionResponse, StartRunPayload,
    StartRunResponse, StreamEnvelope, WorkspaceGrant,
};
use crate::policy::PolicyEngine;
use crate::redaction::Redactor;
use crate::scheduler::{ScheduledRun, Scheduler};
use crate::session::SessionManager;
use chrono::Utc;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild as ShellCommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::io::BufReader;
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::time::{timeout, Duration};
use uuid::Uuid;

static ANSI_ESCAPE_RE: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").expect("valid ansi escape regex")
});

const MAX_BUFFERED_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_BUFFERED_OUTPUT_LINES: usize = 4_000;
const MAX_RUNNER_LINE_LENGTH: usize = 100_000;
const MAX_STREAM_BUFFER_BYTES: usize = 2_000_000;
const DEFAULT_CODEX_MODEL: &str = "gpt-5.3-codex";
const DEFAULT_CLAUDE_MODEL: &str = "sonnet";

#[derive(Default)]
struct OutputBuffer {
    lines: VecDeque<String>,
    total_bytes: usize,
}

impl OutputBuffer {
    fn push(&mut self, line: String) {
        let line_len = line.len();
        self.lines.push_back(line);
        self.total_bytes = self.total_bytes.saturating_add(line_len);

        while self.lines.len() > MAX_BUFFERED_OUTPUT_LINES
            || self.total_bytes > MAX_BUFFERED_OUTPUT_BYTES
        {
            if let Some(removed) = self.lines.pop_front() {
                self.total_bytes = self.total_bytes.saturating_sub(removed.len());
            } else {
                break;
            }
        }
    }

    fn joined(&self) -> String {
        self.lines
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("\n")
    }
}

struct PendingRun {
    payload: StartRunPayload,
    capability: crate::models::CapabilityProfile,
    binary_path: String,
    execution_path: RunExecutionPath,
    session_input: Option<tokio::sync::mpsc::Receiver<String>>,
    harness_warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RunExecutionPath {
    ScopedShellAlias,
    VerifiedAbsolutePath,
}

struct ActiveChild {
    process: ActiveProcess,
    canceled: Arc<AtomicBool>,
}

#[derive(Default)]
struct SemanticStats {
    event_count: AtomicU64,
    tool_event_count: AtomicU64,
}

struct SemanticStateGuard {
    adapter: Arc<dyn Adapter>,
    run_id: String,
}

impl SemanticStateGuard {
    fn new(adapter: Arc<dyn Adapter>, run_id: String) -> Self {
        Self { adapter, run_id }
    }
}

impl Drop for SemanticStateGuard {
    fn drop(&mut self) {
        self.adapter.clear_semantic_state(&self.run_id);
    }
}

enum ActiveProcess {
    Tokio(Arc<Mutex<Child>>),
    #[allow(dead_code)]
    Shell(Arc<Mutex<Option<ShellCommandChild>>>),
    Pty(Arc<StdMutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>),
}

#[derive(Clone)]
pub struct RunnerCore {
    db: Arc<Database>,
    scheduler: Scheduler,
    policy: PolicyEngine,
    redactor: Arc<RwLock<Redactor>>,
    compatibility: CompatibilityRegistry,
    codex: Arc<dyn Adapter>,
    claude: Arc<dyn Adapter>,
    sessions: SessionManager,
    pending_runs: Arc<Mutex<HashMap<String, PendingRun>>>,
    run_payload_cache: Arc<Mutex<HashMap<String, StartRunPayload>>>,
    active_children: Arc<Mutex<HashMap<String, ActiveChild>>>,
    keyring_lock: Arc<Mutex<()>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    app_data_dir: PathBuf,
}

impl RunnerCore {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Arc<Self>> {
        let db_path = app_data_dir.join("state.sqlite");
        let db = Arc::new(Database::new(&db_path)?);
        let scheduler = Scheduler::new(2, 1, 512);

        let this = Arc::new(Self {
            db,
            scheduler: scheduler.clone(),
            policy: PolicyEngine::new(),
            redactor: Arc::new(RwLock::new(Redactor::new(true))),
            compatibility: CompatibilityRegistry::new(),
            codex: Arc::new(CodexAdapter::default()),
            claude: Arc::new(ClaudeAdapter::default()),
            sessions: SessionManager::new(),
            pending_runs: Arc::new(Mutex::new(HashMap::new())),
            run_payload_cache: Arc::new(Mutex::new(HashMap::new())),
            active_children: Arc::new(Mutex::new(HashMap::new())),
            keyring_lock: Arc::new(Mutex::new(())),
            app_handle: Arc::new(RwLock::new(None)),
            app_data_dir,
        });

        if let Err(error) = this.db.ensure_bootstrap_workspace_grant() {
            tracing::warn!(error = %error, "failed to create bootstrap workspace grant");
        }

        if let Ok(interrupted) = this.db.mark_orphan_runs_interrupted() {
            if interrupted > 0 {
                tracing::warn!(count = interrupted, "marked orphaned runs as interrupted on startup");
            }
        }

        let weak = Arc::downgrade(&this);
        scheduler.set_executor(Arc::new(move |run_id: String| {
            let weak = weak.clone();
            Box::pin(async move {
                if let Some(strong) = weak.upgrade() {
                    strong.execute_queued_run(run_id).await
                } else {
                    true
                }
            })
        }));

        Ok(this)
    }

    pub fn start_scheduler(&self) {
        self.scheduler.start();
    }

    pub async fn attach_app_handle(&self, app_handle: AppHandle) {
        let mut writer = self.app_handle.write().await;
        *writer = Some(app_handle);
    }

    pub async fn start_run(&self, payload: StartRunPayload) -> AppResult<StartRunResponse> {
        let run_id = self.queue_run(payload, false).await?.0;
        Ok(StartRunResponse { run_id })
    }

    pub async fn start_interactive_session(
        &self,
        mut payload: StartRunPayload,
    ) -> AppResult<StartInteractiveSessionResponse> {
        payload.mode = RunMode::Interactive;
        let (run_id, session_id) = self.queue_run(payload, true).await?;
        let session_id = session_id.ok_or_else(|| AppError::Internal("Session id missing".to_string()))?;
        Ok(StartInteractiveSessionResponse { run_id, session_id })
    }

    pub async fn queue_run(
        &self,
        payload: StartRunPayload,
        create_session: bool,
    ) -> AppResult<(String, Option<String>)> {
        let settings = self.db.get_settings()?;
        self.apply_runtime_settings(&settings).await;

        let mut effective_payload =
            self.normalize_payload_defaults(self.apply_profile_if_selected(payload)?);

        let configured_binary = match effective_payload.provider {
            Provider::Codex => settings.codex_path.clone(),
            Provider::Claude => settings.claude_path.clone(),
        };
        let (binary_path, execution_path) =
            self.resolve_binary_path(effective_payload.provider, &configured_binary, &settings)?;

        let capability = self
            .compatibility
            .detect_profile(effective_payload.provider, &binary_path)
            .await;

        let adjustment = apply_harness_capabilities(effective_payload.harness.clone(), &capability);
        effective_payload.harness = adjustment.harness;

        let snapshot = CapabilitySnapshot {
            id: Uuid::new_v4().to_string(),
            provider: effective_payload.provider,
            cli_version: capability.cli_version.clone(),
            profile: capability.clone(),
            detected_at: Utc::now(),
        };
        self.db.insert_capability_snapshot(&snapshot)?;

        let grants = self.db.list_workspace_grants()?;
        self.policy
            .validate(&effective_payload, &settings, &grants, &capability)?;
        self.adapter_for(effective_payload.provider).validate(&effective_payload)?;

        if !self.scheduler.has_capacity().await {
            return Err(AppError::Policy(
                "Queue is at capacity. Wait for active jobs to complete before enqueueing more runs."
                    .to_string(),
            ));
        }

        let run_id = Uuid::new_v4().to_string();
        let mut warnings = capability.disabled_reasons.clone();
        warnings.extend(adjustment.warnings.clone());
        let queue_priority = effective_payload.queue_priority.unwrap_or_default();
        let scheduled_at = effective_payload.scheduled_at.unwrap_or_else(Utc::now);
        let max_retries = effective_payload.max_retries.unwrap_or(0);
        let retry_backoff_ms = effective_payload.retry_backoff_ms.unwrap_or(1_000);

        self.db.insert_run(
            &run_id,
            effective_payload.provider,
            &effective_payload.prompt,
            effective_payload.model.as_deref(),
            effective_payload.mode,
            effective_payload.output_format.as_deref(),
            &effective_payload.cwd,
            queue_priority,
            effective_payload.profile_id.as_deref(),
            Some(&snapshot.id),
            &warnings,
        )?;
        self.db.insert_scheduler_job(
            &run_id,
            queue_priority,
            Some(scheduled_at),
            max_retries,
            retry_backoff_ms,
        )?;
        self.run_payload_cache
            .lock()
            .await
            .insert(run_id.clone(), effective_payload.clone());

        let (session_id, session_input) =
            if create_session || effective_payload.mode == RunMode::Interactive {
            let (session_id, receiver) = self.sessions.open_session(&run_id).await;
            (Some(session_id), Some(receiver))
        } else {
            (None, None)
        };

        let pending = PendingRun {
            payload: effective_payload.clone(),
            capability,
            binary_path,
            execution_path,
            session_input,
            harness_warnings: warnings,
        };
        self.pending_runs.lock().await.insert(run_id.clone(), pending);

        if let Err(error) = self
            .scheduler
            .enqueue(ScheduledRun {
                run_id: run_id.clone(),
                provider: effective_payload.provider,
                priority: queue_priority,
                queued_at: Utc::now(),
                not_before: scheduled_at,
            })
            .await
        {
            self.pending_runs.lock().await.remove(&run_id);
            self.run_payload_cache.lock().await.remove(&run_id);
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Failed, None, Some(&error));
            let _ = self.db.mark_job_finished(&run_id, true);
            return Err(AppError::Policy(error));
        }

        Ok((run_id, session_id))
    }

    pub async fn execute_queued_run(&self, run_id: String) -> bool {
        let pending = {
            let mut guard = self.pending_runs.lock().await;
            guard.remove(&run_id)
        };
        let Some(pending) = pending else {
            return true;
        };

        if let Err(error) = self.db.mark_job_running(&run_id) {
            tracing::error!(run_id = %run_id, error = %error, "failed to mark job running");
        }

        if let Err(error) = self.db.update_run_status(&run_id, RunStatus::Running, None, None) {
            tracing::error!(run_id = %run_id, error = %error, "failed to set run status");
        }

        let _ = self
            .emit_event(&run_id, "run.started", json!({ "provider": pending.payload.provider }))
            .await;
        let _ = self
            .emit_event(&run_id, "run.progress", json!({ "stage": "spawn_preparing" }))
            .await;

        for warning in &pending.harness_warnings {
            let _ = self.db.add_compatibility_warning(&run_id, warning);
            let _ = self
                .emit_event(
                    &run_id,
                    "run.compatibility_warning",
                    json!({ "message": warning }),
                )
                .await;
        }

        let settings = match self.db.get_settings() {
            Ok(settings) => settings,
            Err(error) => {
                let message = format!("Settings load failed: {}", error);
                if self
                    .schedule_retry_if_eligible(&run_id, &pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return false;
                }
                let _ = self
                    .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                    .await;
                return true;
            }
        };

        let adapter = self.adapter_for(pending.payload.provider);
        let mut command_spec = match adapter.build_command(
            &pending.payload,
            &pending.capability,
            &pending.binary_path,
        ) {
            Ok(spec) => spec,
            Err(error) => {
                let message = error.to_string();
                if self
                    .schedule_retry_if_eligible(&run_id, &pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return false;
                }
                let _ = self
                    .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                    .await;
                return true;
            }
        };

        let mut runtime_cleanup_paths = Vec::<String>::new();
        if let Some(harness) = &pending.payload.harness {
            if let Some(allowlist) = &harness.cli_allowlist {
                let runtime_dir = self.app_data_dir.join("runtime");
                match prepare_cli_allowlist(allowlist, &runtime_dir) {
                    Ok(prepared) => {
                        command_spec.env.extend(prepared.env);
                        if pending.payload.provider == Provider::Codex {
                            let bin_dir = prepared.bin_dir.to_string_lossy().to_string();
                            let already_added = command_spec
                                .args
                                .windows(2)
                                .any(|window| window[0] == "--add-dir" && window[1] == bin_dir);
                            if !already_added {
                                command_spec.args.push("--add-dir".to_string());
                                command_spec.args.push(bin_dir);
                            }
                        }
                        runtime_cleanup_paths.extend(
                            prepared
                                .cleanup_paths
                                .iter()
                                .map(|path| path.to_string_lossy().to_string()),
                        );
                        let _ = self
                            .emit_event(
                                &run_id,
                                "run.progress",
                                json!({
                                    "stage": "cli_allowlist_prepared",
                                    "binDir": prepared.bin_dir.to_string_lossy(),
                                    "commands": prepared.exposed_commands
                                }),
                            )
                            .await;
                    }
                    Err(error) => {
                        let message = format!("Failed to prepare CLI allowlist: {}", error);
                        let _ = self
                            .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                            .await;
                        return true;
                    }
                }
            }

            if let Some(shell_prelude) = &harness.shell_prelude {
                let runtime_dir = self.app_data_dir.join("runtime");
                match prepare_shell_prelude(shell_prelude, &runtime_dir) {
                    Ok(prepared) => {
                        command_spec.env.extend(prepared.env);
                        runtime_cleanup_paths.extend(
                            prepared
                                .cleanup_paths
                                .iter()
                                .map(|path| path.to_string_lossy().to_string()),
                        );
                        let _ = self
                            .emit_event(
                                &run_id,
                                "run.progress",
                                json!({
                                    "stage": "shell_prelude_prepared",
                                    "path": prepared.path.to_string_lossy()
                                }),
                            )
                            .await;
                    }
                    Err(error) => {
                        let message = format!("Failed to prepare shell prelude: {}", error);
                        let _ = self
                            .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                            .await;
                        return true;
                    }
                }
            }

            if let Some(process_env) = &harness.process_env {
                command_spec.env.extend(process_env.clone());
            }
        }

        command_spec
            .meta
            .cleanup_paths
            .extend(runtime_cleanup_paths);

        let audited_flags = match self.policy.validate_resolved_args(
            pending.payload.provider,
            &command_spec.args,
            &settings,
            &pending.capability,
        ) {
            Ok(flags) => flags,
            Err(error) => {
                let message = error.to_string();
                let _ = self
                    .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                    .await;
                return true;
            }
        };

        let _ = self
            .emit_event(
                &run_id,
                "run.policy_audit",
                json!({
                    "provider": pending.payload.provider,
                    "binary": command_spec.program.clone(),
                    "executionPath": match pending.execution_path {
                        RunExecutionPath::ScopedShellAlias => "scoped-shell-alias",
                        RunExecutionPath::VerifiedAbsolutePath => "verified-absolute-path"
                    },
                    "cwd": command_spec.cwd.clone(),
                    "flags": audited_flags,
                    "advancedPolicy": settings.allow_advanced_policy,
                    "profileId": pending.payload.profile_id.clone(),
                    "capabilityVersion": pending.capability.cli_version
                }),
            )
            .await;

        if pending.payload.mode == RunMode::Interactive {
            return self
                .execute_interactive_pty_run(run_id, pending, settings, adapter, command_spec)
                .await;
        }

        let execution = self
            .execute_noninteractive_tokio_run(
                run_id.clone(),
                &pending,
                &settings,
                adapter.clone(),
                &command_spec,
            )
            .await
            .map_err(|error| format!("Non-interactive execution failed: {}", error));

        match execution {
            Ok(result) => result,
            Err(message) => {
                if self
                    .schedule_retry_if_eligible(&run_id, &pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return false;
                }
                let _ = self
                    .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                    .await;
                true
            }
        }
    }

    async fn execute_interactive_pty_run(
        &self,
        run_id: String,
        mut pending: PendingRun,
        settings: AppSettings,
        adapter: Arc<dyn Adapter>,
        command_spec: ValidatedCommand,
    ) -> bool {
        let _semantic_guard = SemanticStateGuard::new(adapter.clone(), run_id.clone());
        let max_tool_result_lines = pending
            .payload
            .harness
            .as_ref()
            .and_then(|harness| harness.limits.as_ref())
            .and_then(|limits| limits.max_tool_result_lines);

        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => pair,
            Err(error) => {
                let _ = self
                    .fail_run(&run_id, None, &format!("Failed to open PTY: {}", error), true)
                    .await;
                return true;
            }
        };

        let mut builder = CommandBuilder::new(command_spec.program.clone());
        builder.args(command_spec.args.clone());
        builder.cwd(&command_spec.cwd);
        for (key, value) in &command_spec.env {
            builder.env(key, value);
        }
        if !command_spec.env.contains_key("TERM") {
            builder.env("TERM", "xterm-256color");
        }
        if !command_spec.env.contains_key("COLORTERM") {
            builder.env("COLORTERM", "truecolor");
        }

        let mut child = match pair.slave.spawn_command(builder) {
            Ok(child) => child,
            Err(error) => {
                let _ = self
                    .fail_run(
                        &run_id,
                        None,
                        &format!("Failed to spawn PTY process: {}", error),
                        true,
                    )
                    .await;
                return true;
            }
        };

        let killer = Arc::new(StdMutex::new(child.clone_killer()));
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let _ = self
                    .fail_run(
                        &run_id,
                        None,
                        &format!("Failed to open PTY reader: {}", error),
                        true,
                    )
                    .await;
                return true;
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                let _ = self
                    .fail_run(
                        &run_id,
                        None,
                        &format!("Failed to open PTY writer: {}", error),
                        true,
                    )
                    .await;
                return true;
            }
        };
        let writer = Arc::new(StdMutex::new(writer));

        let buffered_output = Arc::new(Mutex::new(OutputBuffer::default()));
        let canceled = Arc::new(AtomicBool::new(false));
        self.active_children.lock().await.insert(
            run_id.clone(),
            ActiveChild {
                process: ActiveProcess::Pty(killer.clone()),
                canceled: canceled.clone(),
            },
        );

        let (output_tx, mut output_rx) = tokio::sync::mpsc::unbounded_channel::<Result<String, String>>();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        let text = String::from_utf8_lossy(&buffer[..size]).to_string();
                        if output_tx.send(Ok(text)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = output_tx.send(Err(error.to_string()));
                        break;
                    }
                }
            }
        });

        let output_task = {
            let run_id = run_id.clone();
            let core = self.clone();
            let adapter = adapter.clone();
            let buffered_output = buffered_output.clone();
            tokio::spawn(async move {
                while let Some(chunk_result) = output_rx.recv().await {
                    match chunk_result {
                        Ok(chunk) => {
                            let text = sanitize_terminal_chunk(&chunk);
                            if text.is_empty() {
                                continue;
                            }
                            if let Ok(redacted) = core
                                .emit_redacted_stream(
                                    &run_id,
                                    "run.chunk.stdout",
                                    text,
                                    adapter.as_ref(),
                                    "stdout",
                                    max_tool_result_lines,
                                    None,
                                )
                                .await
                            {
                                buffered_output.lock().await.push(redacted);
                            }
                        }
                        Err(error) => {
                            let _ = core
                                .emit_event(
                                    &run_id,
                                    "run.progress",
                                    json!({ "stage": "pty_read_error", "message": error }),
                                )
                                .await;
                        }
                    }
                }
            })
        };

        if pending.payload.mode == RunMode::Interactive {
            if let Some(session_id) = self.sessions.session_id(&run_id).await {
                let _ = self
                    .emit_event(
                        &run_id,
                        "session.opened",
                        json!({ "session_id": session_id }),
                    )
                    .await;
            }
        }

        let initial_prompt = pending.payload.prompt.trim().to_string();
        if !initial_prompt.is_empty() {
            let writer = writer.clone();
            let initial_prompt_clone = initial_prompt.clone();
            let _ = tokio::task::spawn_blocking(move || -> AppResult<()> {
                let mut writer = writer
                    .lock()
                    .map_err(|_| AppError::Internal("PTY writer lock poisoned".to_string()))?;
                writer
                    .write_all(initial_prompt_clone.as_bytes())
                    .map_err(|error| AppError::Io(error.to_string()))?;
                writer
                    .write_all(b"\n")
                    .map_err(|error| AppError::Io(error.to_string()))?;
                writer.flush().map_err(|error| AppError::Io(error.to_string()))?;
                Ok(())
            })
            .await;
            let _ = self
                .emit_event(
                    &run_id,
                    "session.input_accepted",
                    json!({ "bytes": initial_prompt.len(), "kind": "initial_prompt" }),
                )
                .await;
        }

        let stdin_task = match pending.session_input.take() {
            Some(mut receiver) => {
                let run_id = run_id.clone();
                let core = self.clone();
                let writer = writer.clone();
                Some(tokio::spawn(async move {
                    while let Some(input) = receiver.recv().await {
                        let bytes = input.len();
                        let writer = writer.clone();
                        let write_result = tokio::task::spawn_blocking(move || -> AppResult<()> {
                            let mut writer = writer
                                .lock()
                                .map_err(|_| AppError::Internal("PTY writer lock poisoned".to_string()))?;
                            writer
                                .write_all(input.as_bytes())
                                .map_err(|error| AppError::Io(error.to_string()))?;
                            writer
                                .write_all(b"\n")
                                .map_err(|error| AppError::Io(error.to_string()))?;
                            writer.flush().map_err(|error| AppError::Io(error.to_string()))?;
                            Ok(())
                        })
                        .await;

                        match write_result {
                            Ok(Ok(())) => {
                                let _ = core
                                    .emit_event(
                                        &run_id,
                                        "session.input_accepted",
                                        json!({ "bytes": bytes }),
                                    )
                                    .await;
                            }
                            _ => break,
                        }
                    }
                }))
            }
            None => None,
        };

        let timeout_seconds = pending.payload.timeout_seconds.unwrap_or(300);
        let wait_task = tokio::task::spawn_blocking(move || child.wait());
        let wait_result = timeout(Duration::from_secs(timeout_seconds), wait_task).await;
        let status = match wait_result {
            Ok(joined) => match joined {
                Ok(Ok(status)) => status,
                Ok(Err(error)) => {
                    self.active_children.lock().await.remove(&run_id);
                    let message = format!("Process wait failed: {}", error);
                    let _ = self.fail_run(&run_id, None, &message, true).await;
                    return true;
                }
                Err(error) => {
                    self.active_children.lock().await.remove(&run_id);
                    let message = format!("Process wait join failed: {}", error);
                    let _ = self.fail_run(&run_id, None, &message, true).await;
                    return true;
                }
            },
            Err(_) => {
                canceled.store(true, Ordering::SeqCst);
                let _ = self
                    .terminate_active_process(ActiveProcess::Pty(killer.clone()))
                    .await;
                self.active_children.lock().await.remove(&run_id);
                let _ = self
                    .fail_run(&run_id, None, "Run timed out", true)
                    .await;
                return true;
            }
        };

        if let Some(task) = stdin_task {
            task.abort();
        }
        let _ = output_task.await;
        self.active_children.lock().await.remove(&run_id);

        let exit_code = i32::try_from(status.exit_code()).ok();
        let was_canceled = canceled.load(Ordering::SeqCst);
        let buffered_text = buffered_output.lock().await.joined();
        let summary = adapter.parse_final(exit_code, &buffered_text);
        let _ = self
            .db
            .insert_artifact(&run_id, "parsed_summary", "", &summary);
        let _ = self.persist_session_transcript_artifact(&run_id, &buffered_text);
        if settings.store_encrypted_raw_artifacts {
            let _ = self
                .persist_encrypted_raw_artifact(&run_id, &buffered_text)
                .await;
        }

        if was_canceled {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Canceled, exit_code, Some("Canceled by user"));
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.canceled", json!({ "exit_code": exit_code }))
                .await;
            let _ = self.touch_conversation_for_run(&run_id).await;
            let _ = self.emit_event(&run_id, "session.closed", json!({})).await;
            self.sessions.close_session(&run_id).await;
            return false;
        }

        if status.success() {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Completed, exit_code, None);
            let _ = self.db.mark_job_finished(&run_id, false);
            self.process_metric_run_if_applicable(&run_id, true, &buffered_text);
            let _ = self
                .emit_event(&run_id, "run.completed", json!({ "exit_code": exit_code }))
                .await;
            let _ = self.touch_conversation_for_run(&run_id).await;
            let _ = self.emit_event(&run_id, "session.closed", json!({})).await;
            self.sessions.close_session(&run_id).await;
            false
        } else {
            let error_message = format!("Process exited with {:?}", exit_code);
            if self
                .maybe_retry_without_resume(&run_id, &pending, &buffered_text, &error_message)
                .await
                .unwrap_or(false)
            {
                return false;
            }
            self.process_metric_run_if_applicable(&run_id, false, &buffered_text);
            let _ = self
                .fail_run(&run_id, exit_code, &error_message, true)
                .await;
            true
        }
    }

    #[allow(dead_code)]
    async fn execute_noninteractive_shell_run(
        &self,
        run_id: String,
        pending: &PendingRun,
        settings: &AppSettings,
        adapter: Arc<dyn Adapter>,
        command_spec: &ValidatedCommand,
    ) -> AppResult<bool> {
        let _semantic_guard = SemanticStateGuard::new(adapter.clone(), run_id.clone());
        let max_tool_result_lines = pending
            .payload
            .harness
            .as_ref()
            .and_then(|harness| harness.limits.as_ref())
            .and_then(|limits| limits.max_tool_result_lines);

        let app_handle = self
            .app_handle
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Internal("App handle unavailable".to_string()))?;

        let mut command = app_handle
            .shell()
            .command(&command_spec.program)
            .args(command_spec.args.clone())
            .current_dir(command_spec.cwd.clone());
        for (key, value) in &command_spec.env {
            command = command.env(key, value);
        }

        let (mut events, child) = command
            .spawn()
            .map_err(|error| AppError::Io(format!("shell spawn unavailable: {}", error)))?;
        let child_handle = Arc::new(Mutex::new(Some(child)));

        let buffered_output = Arc::new(Mutex::new(OutputBuffer::default()));
        let canceled = Arc::new(AtomicBool::new(false));

        self.active_children.lock().await.insert(
            run_id.clone(),
            ActiveChild {
                process: ActiveProcess::Shell(child_handle.clone()),
                canceled: canceled.clone(),
            },
        );

        let timeout_seconds = pending.payload.timeout_seconds.unwrap_or(300);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_seconds);
        let mut exit_code: Option<i32> = None;

        loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                canceled.store(true, Ordering::SeqCst);
                let _ = self
                    .terminate_active_process(ActiveProcess::Shell(child_handle.clone()))
                    .await;
                self.active_children.lock().await.remove(&run_id);
                let message = "Run timed out".to_string();
                if self
                    .schedule_retry_if_eligible(&run_id, pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return Ok(false);
                }
                let _ = self.fail_run(&run_id, None, &message, false).await;
                return Ok(true);
            }

            let remaining = deadline.saturating_duration_since(now);
            let next_event = timeout(remaining, events.recv()).await;
            match next_event {
                Ok(Some(CommandEvent::Stdout(bytes))) => {
                    let text = sanitize_terminal_chunk(&String::from_utf8_lossy(&bytes));
                    if !text.is_empty() {
                        if let Ok(redacted) = self
                            .emit_redacted_stream(
                                &run_id,
                                "run.chunk.stdout",
                                text,
                                adapter.as_ref(),
                                "stdout",
                                max_tool_result_lines,
                                None,
                            )
                            .await
                        {
                            buffered_output.lock().await.push(redacted);
                        }
                    }
                }
                Ok(Some(CommandEvent::Stderr(bytes))) => {
                    let text = sanitize_terminal_chunk(&String::from_utf8_lossy(&bytes));
                    if !text.is_empty() {
                        if let Ok(redacted) = self
                            .emit_redacted_stream(
                                &run_id,
                                "run.chunk.stderr",
                                text,
                                adapter.as_ref(),
                                "stderr",
                                max_tool_result_lines,
                                None,
                            )
                            .await
                        {
                            buffered_output.lock().await.push(redacted);
                        }
                    }
                }
                Ok(Some(CommandEvent::Error(message))) => {
                    let _ = self
                        .emit_event(
                            &run_id,
                            "run.progress",
                            json!({ "stage": "shell_error", "message": message }),
                        )
                        .await;
                }
                Ok(Some(CommandEvent::Terminated(payload))) => {
                    exit_code = payload.code;
                    break;
                }
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(_) => {
                    canceled.store(true, Ordering::SeqCst);
                    let _ = self
                        .terminate_active_process(ActiveProcess::Shell(child_handle.clone()))
                        .await;
                    self.active_children.lock().await.remove(&run_id);
                    let message = "Run timed out".to_string();
                    if self
                        .schedule_retry_if_eligible(&run_id, pending, &message)
                        .await
                        .unwrap_or(false)
                    {
                        return Ok(false);
                    }
                    let _ = self.fail_run(&run_id, None, &message, false).await;
                    return Ok(true);
                }
            }
        }

        self.active_children.lock().await.remove(&run_id);

        let was_canceled = canceled.load(Ordering::SeqCst);
        let buffered_text = buffered_output.lock().await.joined();
        let summary = adapter.parse_final(exit_code, &buffered_text);
        let _ = self
            .db
            .insert_artifact(&run_id, "parsed_summary", "", &summary);
        if settings.store_encrypted_raw_artifacts {
            let _ = self
                .persist_encrypted_raw_artifact(&run_id, &buffered_text)
                .await;
        }

        if was_canceled {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Canceled, exit_code, Some("Canceled by user"));
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.canceled", json!({ "exit_code": exit_code }))
                .await;
            let _ = self.touch_conversation_for_run(&run_id).await;
            return Ok(false);
        }

        if exit_code == Some(0) {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Completed, exit_code, None);
            let _ = self.db.mark_job_finished(&run_id, false);
            self.process_metric_run_if_applicable(&run_id, true, &buffered_text);
            let _ = self
                .emit_event(&run_id, "run.completed", json!({ "exit_code": exit_code }))
                .await;
            let _ = self.touch_conversation_for_run(&run_id).await;
            Ok(false)
        } else {
            let error_message = format!("Process exited with {:?}", exit_code);
            if self
                .maybe_retry_without_resume(&run_id, pending, &buffered_text, &error_message)
                .await
                .unwrap_or(false)
            {
                return Ok(false);
            }
            if self
                .schedule_retry_if_eligible(&run_id, pending, &error_message)
                .await
                .unwrap_or(false)
            {
                Ok(false)
            } else {
                self.process_metric_run_if_applicable(&run_id, false, &buffered_text);
                let _ = self
                    .fail_run(&run_id, exit_code, &error_message, false)
                    .await;
                Ok(true)
            }
        }
    }

    async fn execute_noninteractive_tokio_run(
        &self,
        run_id: String,
        pending: &PendingRun,
        settings: &AppSettings,
        adapter: Arc<dyn Adapter>,
        command_spec: &ValidatedCommand,
    ) -> AppResult<bool> {
        let _semantic_guard = SemanticStateGuard::new(adapter.clone(), run_id.clone());
        let max_tool_result_lines = pending
            .payload
            .harness
            .as_ref()
            .and_then(|harness| harness.limits.as_ref())
            .and_then(|limits| limits.max_tool_result_lines);
        let semantic_stats = Arc::new(SemanticStats::default());
        let run_started_at = tokio::time::Instant::now();

        let mut spawn_attempt = 0_u32;
        let mut child = loop {
            spawn_attempt = spawn_attempt.saturating_add(1);
            let mut command = Command::new(&command_spec.program);
            command
                .args(command_spec.args.clone())
                .current_dir(command_spec.cwd.clone())
                .stdin(if command_spec.stdin.is_some() {
                    Stdio::piped()
                } else {
                    Stdio::null()
                })
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            for (key, value) in &command_spec.env {
                command.env(key, value);
            }

            match command.spawn() {
                Ok(child) => break child,
                Err(error) => {
                    let retryable = matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied)
                        && spawn_attempt < 3;
                    if retryable {
                        let delay_ms = 200_u64.saturating_mul(2_u64.saturating_pow(spawn_attempt.saturating_sub(1)));
                        let _ = self
                            .emit_event(
                                &run_id,
                                "run.warning",
                                json!({
                                    "code": "SPAWN_RETRY",
                                    "attempt": spawn_attempt,
                                    "delayMs": delay_ms,
                                    "message": format!("Spawn failed ({}). Retrying...", error),
                                }),
                            )
                            .await;
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        continue;
                    }

                    if error.kind() == std::io::ErrorKind::NotFound {
                        if !Path::new(&command_spec.cwd).exists() {
                            let _ = self
                                .emit_event(
                                    &run_id,
                                    "run.cwd_missing",
                                    json!({
                                        "path": command_spec.cwd,
                                        "message": format!("Working directory not found: {}", command_spec.cwd)
                                    }),
                                )
                                .await;
                        } else if let Some(payload) =
                            build_cli_missing_payload(&error.to_string(), pending.payload.provider)
                        {
                            let _ = self.emit_event(&run_id, "run.cli_missing", payload).await;
                        }
                    }

                    return Err(AppError::Io(format!("failed to spawn process: {}", error)));
                }
            }
        };

        if let Some(stdin_payload) = command_spec.stdin.clone() {
            if let Some(mut stdin) = child.stdin.take() {
                use tokio::io::AsyncWriteExt;
                stdin
                    .write_all(stdin_payload.as_bytes())
                    .await
                    .map_err(|error| AppError::Io(format!("failed to write stdin: {}", error)))?;
                let _ = stdin.shutdown().await;
            }
        }

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let child_handle = Arc::new(Mutex::new(child));
        let buffered_output = Arc::new(Mutex::new(OutputBuffer::default()));
        let canceled = Arc::new(AtomicBool::new(false));
        let stdout_bytes = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let stderr_bytes = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let stdout_lines = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let stderr_lines = Arc::new(std::sync::atomic::AtomicU64::new(0));

        self.active_children.lock().await.insert(
            run_id.clone(),
            ActiveChild {
                process: ActiveProcess::Tokio(child_handle.clone()),
                canceled: canceled.clone(),
            },
        );

        let stdout_task = stdout.map(|stream| {
            let run_id = run_id.clone();
            let core = self.clone();
            let adapter = adapter.clone();
            let buffered_output = buffered_output.clone();
            let stdout_bytes = stdout_bytes.clone();
            let stdout_lines = stdout_lines.clone();
            let semantic_stats = semantic_stats.clone();
            let max_tool_result_lines = max_tool_result_lines;
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut reader = BufReader::new(stream);
                let mut chunk = vec![0_u8; 4096];
                let mut line_buffer = LineBuffer::new(Some(MAX_STREAM_BUFFER_BYTES));
                loop {
                    match reader.read(&mut chunk).await {
                        Ok(0) => break,
                        Ok(size) => {
                            stdout_bytes.fetch_add(size as u64, std::sync::atomic::Ordering::Relaxed);
                            let text = String::from_utf8_lossy(&chunk[..size]).to_string();
                            let lines = line_buffer.push(&text);
                            let overflowed = line_buffer.consume_overflowed_bytes();
                            if overflowed > 0 {
                                let _ = core
                                    .emit_event(
                                        &run_id,
                                        "run.warning",
                                        json!({
                                            "code": "BUFFER_TRIMMED",
                                            "stream": "stdout",
                                            "bytes": overflowed
                                        }),
                                    )
                                    .await;
                            }
                            for line in lines {
                                stdout_lines.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                let mut sanitized = sanitize_terminal_chunk(&line);
                                if sanitized.len() > MAX_RUNNER_LINE_LENGTH {
                                    sanitized.truncate(MAX_RUNNER_LINE_LENGTH);
                                    let _ = core
                                        .emit_event(
                                            &run_id,
                                            "run.warning",
                                            json!({
                                                "code": "LINE_TRUNCATED",
                                                "stream": "stdout",
                                                "maxLineLength": MAX_RUNNER_LINE_LENGTH
                                            }),
                                        )
                                        .await;
                                }
                                if sanitized.is_empty() {
                                    continue;
                                }
                                if let Ok(redacted) = core
                                    .emit_redacted_stream(
                                        &run_id,
                                        "run.chunk.stdout",
                                        sanitized,
                                        adapter.as_ref(),
                                        "stdout",
                                        max_tool_result_lines,
                                        Some(semantic_stats.clone()),
                                    )
                                    .await
                                {
                                    buffered_output.lock().await.push(redacted);
                                }
                            }
                        }
                        Err(error) => {
                            let _ = core
                                .emit_event(
                                    &run_id,
                                    "run.progress",
                                    json!({ "stage": "stdout_read_error", "message": error.to_string() }),
                                )
                                .await;
                            break;
                        }
                    }
                }
                let mut leftover = line_buffer.flush();
                if !leftover.trim().is_empty() {
                    if leftover.len() > MAX_RUNNER_LINE_LENGTH {
                        leftover.truncate(MAX_RUNNER_LINE_LENGTH);
                    }
                    let _ = core
                        .emit_redacted_stream(
                            &run_id,
                            "run.chunk.stdout",
                            sanitize_terminal_chunk(&leftover),
                            adapter.as_ref(),
                            "stdout",
                            max_tool_result_lines,
                            Some(semantic_stats.clone()),
                        )
                        .await;
                }
            })
        });

        let stderr_task = stderr.map(|stream| {
            let run_id = run_id.clone();
            let core = self.clone();
            let adapter = adapter.clone();
            let buffered_output = buffered_output.clone();
            let stderr_bytes = stderr_bytes.clone();
            let stderr_lines = stderr_lines.clone();
            let semantic_stats = semantic_stats.clone();
            let max_tool_result_lines = max_tool_result_lines;
            tokio::spawn(async move {
                use tokio::io::AsyncReadExt;
                let mut reader = BufReader::new(stream);
                let mut chunk = vec![0_u8; 4096];
                let mut line_buffer = LineBuffer::new(Some(MAX_STREAM_BUFFER_BYTES));
                loop {
                    match reader.read(&mut chunk).await {
                        Ok(0) => break,
                        Ok(size) => {
                            stderr_bytes.fetch_add(size as u64, std::sync::atomic::Ordering::Relaxed);
                            let text = String::from_utf8_lossy(&chunk[..size]).to_string();
                            let lines = line_buffer.push(&text);
                            let overflowed = line_buffer.consume_overflowed_bytes();
                            if overflowed > 0 {
                                let _ = core
                                    .emit_event(
                                        &run_id,
                                        "run.warning",
                                        json!({
                                            "code": "BUFFER_TRIMMED",
                                            "stream": "stderr",
                                            "bytes": overflowed
                                        }),
                                    )
                                    .await;
                            }
                            for line in lines {
                                stderr_lines.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                let mut sanitized = sanitize_terminal_chunk(&line);
                                if sanitized.len() > MAX_RUNNER_LINE_LENGTH {
                                    sanitized.truncate(MAX_RUNNER_LINE_LENGTH);
                                    let _ = core
                                        .emit_event(
                                            &run_id,
                                            "run.warning",
                                            json!({
                                                "code": "LINE_TRUNCATED",
                                                "stream": "stderr",
                                                "maxLineLength": MAX_RUNNER_LINE_LENGTH
                                            }),
                                        )
                                        .await;
                                }
                                if sanitized.is_empty() {
                                    continue;
                                }
                                if let Ok(redacted) = core
                                    .emit_redacted_stream(
                                        &run_id,
                                        "run.chunk.stderr",
                                        sanitized,
                                        adapter.as_ref(),
                                        "stderr",
                                        max_tool_result_lines,
                                        Some(semantic_stats.clone()),
                                    )
                                    .await
                                {
                                    buffered_output.lock().await.push(redacted);
                                }
                            }
                        }
                        Err(error) => {
                            let _ = core
                                .emit_event(
                                    &run_id,
                                    "run.progress",
                                    json!({ "stage": "stderr_read_error", "message": error.to_string() }),
                                )
                                .await;
                            break;
                        }
                    }
                }
                let mut leftover = line_buffer.flush();
                if !leftover.trim().is_empty() {
                    if leftover.len() > MAX_RUNNER_LINE_LENGTH {
                        leftover.truncate(MAX_RUNNER_LINE_LENGTH);
                    }
                    let _ = core
                        .emit_redacted_stream(
                            &run_id,
                            "run.chunk.stderr",
                            sanitize_terminal_chunk(&leftover),
                            adapter.as_ref(),
                            "stderr",
                            max_tool_result_lines,
                            Some(semantic_stats.clone()),
                        )
                        .await;
                }
            })
        });

        let timeout_seconds = pending.payload.timeout_seconds.unwrap_or(300);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_seconds);
        let exit_code = loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                canceled.store(true, Ordering::SeqCst);
                let _ = self
                    .terminate_active_process(ActiveProcess::Tokio(child_handle.clone()))
                    .await;
                self.active_children.lock().await.remove(&run_id);
                let message = "Run timed out".to_string();
                if self
                    .schedule_retry_if_eligible(&run_id, pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return Ok(false);
                }
                let _ = self.fail_run(&run_id, None, &message, false).await;
                return Ok(true);
            }

            let status = {
                let mut child = child_handle.lock().await;
                child
                    .try_wait()
                    .map_err(|error| AppError::Io(format!("failed to poll process status: {}", error)))?
            };
            if let Some(status) = status {
                break status.code();
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        };

        if let Some(task) = stdout_task {
            let _ = task.await;
        }
        if let Some(task) = stderr_task {
            let _ = task.await;
        }
        self.active_children.lock().await.remove(&run_id);

        let was_canceled = canceled.load(Ordering::SeqCst);
        let buffered_text = buffered_output.lock().await.joined();
        let summary = adapter.parse_final(exit_code, &buffered_text);
        let _ = self
            .db
            .insert_artifact(&run_id, "parsed_summary", "", &summary);

        if command_spec.meta.structured_output_schema.is_some() {
            let content = command_spec
                .meta
                .structured_output_path
                .as_ref()
                .and_then(|path| std::fs::read_to_string(path).ok());
            let fallback_text = summary
                .get("summary")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            let value = resolve_structured_output(content.as_deref(), Some(&fallback_text));
            let validation = validate_structured_output(
                value,
                command_spec.meta.structured_output_schema.as_ref(),
            );
            match (validation.error, validation.value) {
                (None, Some(value)) => {
                    let _ = self
                        .emit_event(
                            &run_id,
                            "run.structured_output",
                            json!({ "result": value }),
                        )
                        .await;
                }
                (Some(error), value) => {
                    let _ = self
                        .emit_event(
                            &run_id,
                            "run.structured_output_invalid",
                            json!({
                                "message": error,
                                "errors": validation.errors,
                                "value": value
                            }),
                        )
                        .await;
                }
                _ => {}
            }
        }

        if buffered_text.trim().is_empty() {
            let _ = self
                .emit_event(
                    &run_id,
                    "run.warning",
                    json!({
                        "code": "NO_TEXT_EMITTED",
                        "message": "CLI produced no text output."
                    }),
                )
                .await;
        }

        let duration_ms = run_started_at.elapsed().as_millis() as u64;
        let _ = self
            .emit_event(
                &run_id,
                "run.runner_metrics",
                json!({
                    "stdoutBytes": stdout_bytes.load(std::sync::atomic::Ordering::Relaxed),
                    "stderrBytes": stderr_bytes.load(std::sync::atomic::Ordering::Relaxed),
                    "stdoutLines": stdout_lines.load(std::sync::atomic::Ordering::Relaxed),
                    "stderrLines": stderr_lines.load(std::sync::atomic::Ordering::Relaxed),
                    "eventCount": semantic_stats.event_count.load(std::sync::atomic::Ordering::Relaxed),
                    "toolCalls": semantic_stats.tool_event_count.load(std::sync::atomic::Ordering::Relaxed),
                    "durationMs": duration_ms,
                }),
            )
            .await;
        let _ = self
            .emit_event(
                &run_id,
                "run.cli_exit",
                json!({
                    "code": exit_code,
                    "signal": serde_json::Value::Null,
                    "durationMs": duration_ms
                }),
            )
            .await;

        self.cleanup_runtime_paths(&command_spec.meta.cleanup_paths);
        if settings.store_encrypted_raw_artifacts {
            let _ = self
                .persist_encrypted_raw_artifact(&run_id, &buffered_text)
                .await;
        }

        if was_canceled {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Canceled, exit_code, Some("Canceled by user"));
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.canceled", json!({ "exit_code": exit_code }))
                .await;
            let _ = self.touch_conversation_for_run(&run_id).await;
            return Ok(false);
        }

        if exit_code == Some(0) {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Completed, exit_code, None);
            let _ = self.db.mark_job_finished(&run_id, false);
            self.process_metric_run_if_applicable(&run_id, true, &buffered_text);
            let _ = self
                .emit_event(&run_id, "run.completed", json!({ "exit_code": exit_code }))
                .await;
            let _ = self.touch_conversation_for_run(&run_id).await;
            Ok(false)
        } else {
            let error_message = format!("Process exited with {:?}", exit_code);
            if self
                .maybe_retry_without_resume(&run_id, pending, &buffered_text, &error_message)
                .await
                .unwrap_or(false)
            {
                return Ok(false);
            }
            if self
                .schedule_retry_if_eligible(&run_id, pending, &error_message)
                .await
                .unwrap_or(false)
            {
                Ok(false)
            } else {
                self.process_metric_run_if_applicable(&run_id, false, &buffered_text);
                let _ = self
                    .fail_run(&run_id, exit_code, &error_message, false)
                    .await;
                Ok(true)
            }
        }
    }

    pub async fn cancel_run(&self, run_id: &str) -> AppResult<BooleanResponse> {
        if self.pending_runs.lock().await.remove(run_id).is_some() {
            self.db
                .update_run_status(run_id, RunStatus::Canceled, None, Some("Canceled before execution"))?;
            self.db.mark_job_finished(run_id, false)?;
            self.emit_event(run_id, "run.canceled", json!({ "queued": true }))
                .await?;
            let _ = self.touch_conversation_for_run(run_id).await;
            return Ok(BooleanResponse { success: true });
        }

        let active = self.active_children.lock().await.remove(run_id);
        if let Some(active) = active {
            active.canceled.store(true, Ordering::SeqCst);
            let _ = self.terminate_active_process(active.process).await;

            self.db
                .update_run_status(run_id, RunStatus::Canceled, None, Some("Canceled by user"))?;
            self.db.mark_job_finished(run_id, false)?;
            self.emit_event(run_id, "run.canceled", json!({ "queued": false }))
                .await?;
            let _ = self.touch_conversation_for_run(run_id).await;
            self.sessions.close_session(run_id).await;
            return Ok(BooleanResponse { success: true });
        }

        Ok(BooleanResponse { success: false })
    }

    async fn terminate_then_kill(&self, child: &mut Child) -> AppResult<()> {
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;
            if let Some(pid) = child.id() {
                let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
            }
        }

        #[cfg(windows)]
        {
            if let Some(pid) = child.id() {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .spawn();
            }
        }

        if timeout(Duration::from_millis(1500), child.wait())
            .await
            .is_ok()
        {
            return Ok(());
        }

        let _ = child.start_kill();
        let _ = timeout(Duration::from_secs(2), child.wait()).await;
        Ok(())
    }

    async fn terminate_active_process(&self, process: ActiveProcess) -> AppResult<()> {
        match process {
            ActiveProcess::Tokio(child) => {
                let mut child = child.lock().await;
                self.terminate_then_kill(&mut child).await
            }
            ActiveProcess::Shell(child) => {
                let mut child = child.lock().await;
                if let Some(active) = child.take() {
                    let _ = active.kill();
                }
                Ok(())
            }
            ActiveProcess::Pty(killer) => {
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut killer) = killer.lock() {
                        let _ = killer.kill();
                    }
                })
                .await;
                Ok(())
            }
        }
    }

    pub async fn rerun(&self, run_id: &str, overrides: serde_json::Value) -> AppResult<RerunResponse> {
        let base = if let Some(payload) = self.run_payload_cache.lock().await.get(run_id).cloned() {
            payload
        } else {
            let run = self
                .db
                .get_run(run_id)?
                .ok_or_else(|| AppError::NotFound(format!("Run {} not found", run_id)))?;
            StartRunPayload {
                provider: run.provider,
                prompt: run.prompt,
                model: run.model,
                mode: run.mode,
                output_format: run.output_format,
                cwd: run.cwd,
                optional_flags: Default::default(),
                profile_id: run.profile_id,
                queue_priority: Some(run.queue_priority),
                timeout_seconds: Some(300),
                scheduled_at: None,
                max_retries: Some(0),
                retry_backoff_ms: Some(1_000),
            harness: None,
            }
        };

        let mut merged = serde_json::to_value(base)?;
        merge_json(&mut merged, overrides);
        let payload: StartRunPayload = serde_json::from_value(merged)?;

        let response = self.start_run(payload).await?;
        Ok(RerunResponse {
            new_run_id: response.run_id,
        })
    }

    pub async fn send_session_input(&self, run_id: &str, data: String) -> AppResult<AcceptedResponse> {
        match self.sessions.send_input(run_id, data).await {
            Ok(()) => Ok(AcceptedResponse { accepted: true }),
            Err(error) => {
                tracing::warn!(run_id = %run_id, error = %error, "session input rejected");
                let _ = self
                    .emit_event(
                        run_id,
                        "run.progress",
                        json!({
                            "stage": "session_input_rejected",
                            "severity": "warning",
                            "message": error.to_string()
                        }),
                    )
                    .await;
                Err(error)
            }
        }
    }

    pub async fn end_session(&self, run_id: &str) -> AppResult<BooleanResponse> {
        self.cancel_run(run_id).await
    }

    pub async fn resume_session(&self, run_id: &str) -> AppResult<StartInteractiveSessionResponse> {
        let run = self
            .db
            .get_run(run_id)?
            .ok_or_else(|| AppError::NotFound(format!("Run {} not found", run_id)))?;
        if run.mode != RunMode::Interactive {
            return Err(AppError::Policy("Run is not interactive".to_string()));
        }
        if let Some(snapshot_id) = run.capability_snapshot_id.as_deref() {
            if let Some(snapshot) = self.db.get_capability_snapshot_by_id(snapshot_id)? {
                if !snapshot.profile.supported_modes.contains(&RunMode::Interactive) {
                    return Err(AppError::Policy(format!(
                        "Interactive resume is disabled for CLI capability version {}",
                        snapshot.cli_version
                    )));
                }
            }
        }
        let session_id = self
            .sessions
            .session_id(run_id)
            .await
            .ok_or_else(|| AppError::NotFound("No active resumable session".to_string()))?;

        let replay = self
            .db
            .get_run_detail(run_id)?
            .map(|detail| {
                let mut lines = detail
                    .events
                    .into_iter()
                    .rev()
                    .filter_map(|event| {
                        if !matches!(event.event_type.as_str(), "run.chunk.stdout" | "run.chunk.stderr") {
                            return None;
                        }
                        event
                            .payload
                            .get("text")
                            .and_then(|value| value.as_str())
                            .map(ToString::to_string)
                    })
                    .take(50)
                    .collect::<Vec<_>>();
                lines.reverse();
                lines
            })
            .unwrap_or_default();

        self.emit_event(
            run_id,
            "run.progress",
            json!({
                "stage": "session_resumed",
                "sessionId": session_id,
                "replayLines": replay.len()
            }),
        )
        .await?;
        if !replay.is_empty() {
            for line in &replay {
                self.emit_event(
                    run_id,
                    "run.chunk.stdout",
                    json!({ "text": line, "replay": true }),
                )
                .await?;
            }
            self.emit_event(run_id, "run.progress", json!({ "stage": "session_replay_ready" }))
                .await?;
        }
        Ok(StartInteractiveSessionResponse {
            run_id: run_id.to_string(),
            session_id,
        })
    }

    pub fn get_run(&self, run_id: &str) -> AppResult<Option<RunDetail>> {
        self.db.get_run_detail(run_id)
    }

    pub fn list_runs(&self, filters: ListRunsFilters) -> AppResult<Vec<crate::models::RunRecord>> {
        self.db.list_runs(&filters)
    }

    pub fn create_conversation(&self, payload: CreateConversationPayload) -> AppResult<ConversationRecord> {
        let created = self
            .db
            .create_conversation(payload.provider, payload.title.as_deref(), payload.metadata.as_ref())?;
        let _ = self.emit_app_event(
            "conversation.created",
            json!({
                "conversationId": created.id,
                "provider": created.provider,
                "title": created.title,
                "updatedAt": created.updated_at
            }),
        );
        Ok(created)
    }

    pub fn list_conversations(&self, filters: ListConversationsFilters) -> AppResult<Vec<ConversationSummary>> {
        self.db.list_conversations(&filters)
    }

    pub fn get_conversation(&self, conversation_id: &str) -> AppResult<Option<ConversationDetail>> {
        self.db.get_conversation_detail(conversation_id)
    }

    pub fn rename_conversation(&self, payload: RenameConversationPayload) -> AppResult<Option<ConversationRecord>> {
        let renamed = self
            .db
            .rename_conversation(&payload.conversation_id, &payload.title)?;
        if let Some(conversation) = &renamed {
            let _ = self.emit_app_event(
                "conversation.renamed",
                json!({
                    "conversationId": conversation.id,
                    "provider": conversation.provider,
                    "title": conversation.title,
                    "updatedAt": conversation.updated_at
                }),
            );
        }
        Ok(renamed)
    }

    pub fn archive_conversation(&self, payload: ArchiveConversationPayload) -> AppResult<BooleanResponse> {
        let archived = payload.archived.unwrap_or(true);
        let success = self
            .db
            .archive_conversation(&payload.conversation_id, archived)?;
        if success {
            let details = self.db.get_conversation(&payload.conversation_id)?;
            let _ = self.emit_app_event(
                "conversation.archived",
                json!({
                    "conversationId": payload.conversation_id,
                    "archived": archived,
                    "provider": details.as_ref().map(|item| item.provider),
                    "updatedAt": details.as_ref().map(|item| item.updated_at),
                    "archivedAt": details.and_then(|item| item.archived_at)
                }),
            );
        }
        Ok(BooleanResponse { success })
    }

    pub async fn send_conversation_message(
        &self,
        payload: SendConversationMessagePayload,
    ) -> AppResult<StartRunResponse> {
        let conversation = self
            .db
            .get_conversation(&payload.conversation_id)?
            .ok_or_else(|| AppError::NotFound(format!("Conversation {} not found", payload.conversation_id)))?;
        if conversation.archived_at.is_some() {
            return Err(AppError::Policy("Cannot send message to archived conversation".to_string()));
        }

        let cwd = self.resolve_conversation_cwd(payload.cwd)?;
        let mut harness = payload.harness.unwrap_or_default();
        harness.resume_session_id = conversation.provider_session_id.clone();
        if harness.resume_session_id.is_none() {
            harness.continue_session = None;
        }

        let start_payload = StartRunPayload {
            provider: conversation.provider,
            prompt: payload.prompt,
            model: payload.model,
            mode: RunMode::NonInteractive,
            output_format: payload.output_format,
            cwd,
            optional_flags: payload.optional_flags.unwrap_or_default(),
            profile_id: payload.profile_id,
            queue_priority: payload.queue_priority,
            timeout_seconds: payload.timeout_seconds,
            scheduled_at: payload.scheduled_at,
            max_retries: payload.max_retries,
            retry_backoff_ms: payload.retry_backoff_ms,
            harness: Some(harness),
        };

        let run_id = self.queue_run(start_payload, false).await?.0;
        self.db
            .attach_run_to_conversation(&conversation.id, &run_id)?;
        let _ = self.emit_app_event(
            "conversation.message_sent",
            json!({
                "conversationId": conversation.id,
                "runId": run_id,
                "provider": conversation.provider
            }),
        );
        Ok(StartRunResponse { run_id })
    }

    pub fn list_profiles(&self) -> AppResult<Vec<Profile>> {
        self.db.list_profiles()
    }

    pub fn save_profile(&self, payload: SaveProfilePayload) -> AppResult<Profile> {
        self.db.save_profile(payload)
    }

    pub fn list_capabilities(&self) -> AppResult<Vec<CapabilitySnapshot>> {
        self.db.list_capability_snapshots()
    }

    pub async fn refresh_capabilities(&self) -> AppResult<Vec<CapabilitySnapshot>> {
        let settings = self.db.get_settings()?;
        let mut snapshots = Vec::with_capacity(2);
        for (provider, binary) in [
            (Provider::Codex, settings.codex_path.as_str()),
            (Provider::Claude, settings.claude_path.as_str()),
        ] {
            let profile = self.compatibility.detect_profile(provider, binary).await;
            let snapshot = CapabilitySnapshot {
                id: Uuid::new_v4().to_string(),
                provider,
                cli_version: profile.cli_version.clone(),
                profile,
                detected_at: Utc::now(),
            };
            self.db.insert_capability_snapshot(&snapshot)?;
            snapshots.push(snapshot);
        }
        Ok(snapshots)
    }

    pub fn list_queue_jobs(&self) -> AppResult<Vec<SchedulerJob>> {
        self.db.list_queue_jobs()
    }

    pub fn get_settings(&self) -> AppResult<AppSettings> {
        self.db.get_settings()
    }

    pub async fn update_settings(&self, settings: serde_json::Value) -> AppResult<AppSettings> {
        let updated = self.db.update_settings(settings)?;
        self.apply_runtime_settings(&updated).await;
        Ok(updated)
    }

    pub fn list_workspace_grants(&self) -> AppResult<Vec<WorkspaceGrant>> {
        self.db.list_workspace_grants()
    }

    pub fn grant_workspace(&self, path: &str) -> AppResult<WorkspaceGrant> {
        let canonical = canonicalize_absolute(path)?;
        self.db.grant_workspace(&canonical, "local-user")
    }

    pub fn export_run(&self, run_id: &str, format: &str) -> AppResult<ExportResponse> {
        let detail = self
            .db
            .get_run_detail(run_id)?
            .ok_or_else(|| AppError::NotFound(format!("Run {} not found", run_id)))?;

        let export_dir = self.app_data_dir.join("exports");
        std::fs::create_dir_all(&export_dir).map_err(|error| AppError::Io(error.to_string()))?;

        let format = match format {
            "md" | "json" | "txt" => format,
            _ => return Err(AppError::Io(format!("Unsupported export format {}", format))),
        };

        let safe_run_id = sanitize_filename_component(run_id);
        let output_path = export_dir.join(format!("{}.{}", safe_run_id, format));
        if !output_path.starts_with(&export_dir) {
            return Err(AppError::Io("Resolved export path escaped export directory".to_string()));
        }
        let contents = match format {
            "json" => serde_json::to_string_pretty(&detail)?,
            "md" => render_markdown_export(&detail),
            "txt" => render_text_export(&detail),
            _ => unreachable!(),
        };

        std::fs::write(&output_path, contents).map_err(|error| AppError::Io(error.to_string()))?;
        Ok(ExportResponse {
            path: output_path.to_string_lossy().to_string(),
        })
    }

    pub fn run_retention(&self) -> AppResult<()> {
        let settings = self.db.get_settings()?;
        self.db.run_retention_prune(&settings)
    }

    // ─── Metric Library ─────────────────────────────────────────────────────

    pub fn save_metric_definition(&self, payload: SaveMetricDefinitionPayload) -> AppResult<MetricDefinition> {
        self.db.save_metric_definition(payload)
    }

    pub fn get_metric_definition(&self, id: &str) -> AppResult<Option<MetricDefinition>> {
        self.db.get_metric_definition(id)
    }

    pub fn list_metric_definitions(&self, include_archived: bool) -> AppResult<Vec<MetricDefinition>> {
        self.db.list_metric_definitions(include_archived)
    }

    pub fn archive_metric_definition(&self, id: &str) -> AppResult<BooleanResponse> {
        let success = self.db.archive_metric_definition(id)?;
        Ok(BooleanResponse { success })
    }

    pub fn delete_metric_definition(&self, id: &str) -> AppResult<BooleanResponse> {
        let success = self.db.delete_metric_definition(id)?;
        Ok(BooleanResponse { success })
    }

    pub fn get_latest_metric_snapshot(&self, metric_id: &str) -> AppResult<Option<MetricSnapshot>> {
        self.db.get_latest_snapshot(metric_id)
    }

    pub fn list_metric_snapshots(&self, metric_id: &str, limit: Option<u32>) -> AppResult<Vec<MetricSnapshot>> {
        self.db.list_snapshots(metric_id, limit.unwrap_or(50))
    }

    pub fn bind_metric_to_screen(&self, payload: BindMetricToScreenPayload) -> AppResult<ScreenMetricBinding> {
        self.db.bind_metric_to_screen(&payload)
    }

    pub fn unbind_metric_from_screen(&self, screen_id: &str, metric_id: &str) -> AppResult<BooleanResponse> {
        let success = self.db.unbind_metric_from_screen(screen_id, metric_id)?;
        Ok(BooleanResponse { success })
    }

    pub fn reorder_screen_metrics(&self, screen_id: &str, metric_ids: &[String]) -> AppResult<BooleanResponse> {
        self.db.reorder_screen_metrics(screen_id, metric_ids)?;
        Ok(BooleanResponse { success: true })
    }

    pub fn get_screen_metrics(&self, screen_id: &str) -> AppResult<Vec<ScreenMetricView>> {
        self.db.list_screen_metrics(screen_id)
    }

    pub async fn refresh_metric(&self, metric_id: &str) -> AppResult<MetricRefreshResponse> {
        let definition = self.db.get_metric_definition(metric_id)?
            .ok_or_else(|| AppError::NotFound(format!("Metric definition not found: {}", metric_id)))?;

        if !definition.enabled || definition.archived_at.is_some() {
            return Err(AppError::Policy("Metric is disabled or archived".to_string()));
        }

        if self.db.has_pending_snapshot(metric_id)? {
            return Err(AppError::Policy("Refresh already in progress for this metric".to_string()));
        }

        let snapshot = self.db.insert_metric_snapshot(metric_id)?;

        let system_prompt = "You are a metrics data agent. Follow the instructions to retrieve data using available MCP tools. Fill the HTML template with actual values. Return JSON: { \"values\": { ... }, \"html\": \"...\" }".to_string();

        let user_prompt = format!(
            "# Metric: {name}\n\n## Instructions\n{instructions}\n\n## HTML Template\n{template}\n\nReturn your response as JSON with `values` and `html` keys.",
            name = definition.name,
            instructions = definition.instructions,
            template = if definition.template_html.is_empty() {
                "Create clean self-contained HTML to display the metric data.".to_string()
            } else {
                definition.template_html.clone()
            }
        );

        let grants = self.db.list_workspace_grants()?;
        let active_cwd = definition.cwd
            .clone()
            .or_else(|| grants.iter().find(|g| g.revoked_at.is_none()).map(|g| g.path.clone()))
            .unwrap_or_else(|| ".".to_string());

        let payload = StartRunPayload {
            provider: definition.provider,
            prompt: user_prompt,
            model: definition.model.clone(),
            mode: RunMode::NonInteractive,
            output_format: Some("json".to_string()),
            cwd: active_cwd,
            optional_flags: std::collections::BTreeMap::new(),
            profile_id: definition.profile_id.clone(),
            queue_priority: Some(-10),
            timeout_seconds: Some(120),
            scheduled_at: None,
            max_retries: Some(1),
            retry_backoff_ms: None,
            harness: Some(crate::models::HarnessRequestOptions {
                system_prompt: Some(system_prompt),
                tools: Some(vec![
                    crate::models::UnifiedTool::Mcp,
                    crate::models::UnifiedTool::WebFetch,
                    crate::models::UnifiedTool::WebSearch,
                ]),
                permissions: Some(crate::models::UnifiedPermission {
                    sandbox_mode: crate::models::SandboxMode::ReadOnly,
                    auto_approve: true,
                    network_access: true,
                    approval_policy: Some(crate::models::ApprovalPolicy::Never),
                }),
                ..Default::default()
            }),
        };

        let result = self.start_run(payload).await;
        match result {
            Ok(response) => {
                self.db.update_metric_snapshot_run_id(&snapshot.id, &response.run_id)?;
                Ok(MetricRefreshResponse {
                    metric_id: metric_id.to_string(),
                    snapshot_id: snapshot.id,
                    run_id: Some(response.run_id),
                })
            }
            Err(err) => {
                self.db.fail_metric_snapshot(&snapshot.id, &err.to_string())?;
                Err(err)
            }
        }
    }

    pub async fn refresh_screen_metrics(&self, screen_id: &str) -> AppResult<Vec<MetricRefreshResponse>> {
        let stale = self.db.find_stale_metrics_for_screen(screen_id)?;
        let mut results = Vec::new();
        for metric in stale {
            match self.refresh_metric(&metric.id).await {
                Ok(response) => results.push(response),
                Err(err) => {
                    tracing::warn!(metric_id = %metric.id, error = %err, "failed to refresh metric");
                }
            }
        }
        Ok(results)
    }

    pub async fn refresh_proactive_metrics(&self) -> AppResult<()> {
        let stale = self.db.find_proactive_stale_metrics()?;
        for metric in stale {
            if let Err(err) = self.refresh_metric(&metric.id).await {
                tracing::warn!(metric_id = %metric.id, error = %err, "proactive metric refresh failed");
            }
        }
        Ok(())
    }

    pub fn process_metric_run_if_applicable(
        &self,
        run_id: &str,
        success: bool,
        output_text: &str,
    ) {
        let snapshot = match self.db.find_snapshot_by_run_id(run_id) {
            Ok(Some(snap)) => snap,
            _ => return, // Not a metric run
        };

        let metric_id = snapshot.metric_id.clone();

        if !success {
            let _ = self.db.fail_metric_snapshot(&snapshot.id, "Run failed");
            let _ = self.emit_app_event("metric.snapshot_failed", json!({
                "metricId": metric_id,
                "snapshotId": snapshot.id,
                "error": "Run failed"
            }));
            return;
        }

        match parse_metric_output(output_text) {
            Ok((values, html)) => {
                let _ = self.db.complete_metric_snapshot(&snapshot.id, &values, &html);
                let _ = self.emit_app_event("metric.snapshot_completed", json!({
                    "metricId": metric_id,
                    "snapshotId": snapshot.id
                }));
            }
            Err(err) => {
                let msg = format!("Output parse error: {}", err);
                let _ = self.db.fail_metric_snapshot(&snapshot.id, &msg);
                let _ = self.emit_app_event("metric.snapshot_failed", json!({
                    "metricId": metric_id,
                    "snapshotId": snapshot.id,
                    "error": msg
                }));
            }
        }
    }

    pub async fn save_provider_token(&self, provider: Provider, token: String) -> AppResult<BooleanResponse> {
        let _guard = self.keyring_lock.lock().await;
        let entry = keyring::Entry::new("local-cli-command-center", provider.as_str())
            .map_err(|error| AppError::Io(error.to_string()))?;
        entry
            .set_password(&token)
            .map_err(|error| AppError::Io(error.to_string()))?;
        Ok(BooleanResponse { success: true })
    }

    pub async fn clear_provider_token(&self, provider: Provider) -> AppResult<BooleanResponse> {
        let _guard = self.keyring_lock.lock().await;
        let entry = keyring::Entry::new("local-cli-command-center", provider.as_str())
            .map_err(|error| AppError::Io(error.to_string()))?;
        match entry.delete_credential() {
            Ok(_) => Ok(BooleanResponse { success: true }),
            Err(keyring::Error::NoEntry) => Ok(BooleanResponse { success: true }),
            Err(error) => Err(AppError::Io(error.to_string())),
        }
    }

    pub async fn has_provider_token(&self, provider: Provider) -> AppResult<BooleanResponse> {
        let _guard = self.keyring_lock.lock().await;
        let entry = keyring::Entry::new("local-cli-command-center", provider.as_str())
            .map_err(|error| AppError::Io(error.to_string()))?;
        match entry.get_password() {
            Ok(value) => Ok(BooleanResponse {
                success: !value.is_empty(),
            }),
            Err(keyring::Error::NoEntry) => Ok(BooleanResponse { success: false }),
            Err(error) => Err(AppError::Io(error.to_string())),
        }
    }

    async fn maybe_retry_without_resume(
        &self,
        run_id: &str,
        pending: &PendingRun,
        buffered_text: &str,
        error_message: &str,
    ) -> AppResult<bool> {
        if pending.payload.mode != RunMode::NonInteractive {
            return Ok(false);
        }
        if !payload_has_resume_request(&pending.payload) {
            return Ok(false);
        }
        let Some(conversation_id) = self.db.find_conversation_id_by_run(run_id)? else {
            return Ok(false);
        };

        let corpus = format!("{}\n{}", error_message, buffered_text).to_ascii_lowercase();
        if !is_resume_invalid_failure(&corpus) {
            return Ok(false);
        }

        let Some(job) = self.db.get_queue_job(run_id)? else {
            return Ok(false);
        };
        if job.attempts > 1 {
            return Ok(false);
        }

        let mut retried_payload = pending.payload.clone();
        if let Some(harness) = retried_payload.harness.as_mut() {
            harness.resume_session_id = None;
            harness.continue_session = None;
        }

        self.db.clear_conversation_session_id(&conversation_id)?;
        let _ = self.emit_event(
            run_id,
            "run.warning",
            json!({
                "code": "session_resume_invalid",
                "message": "Stored session id was invalid. Retrying once without resume.",
                "conversationId": conversation_id
            }),
        )
        .await;
        let _ = self.emit_app_event(
            "conversation.session_updated",
            json!({
                "conversationId": conversation_id,
                "sessionId": serde_json::Value::Null
            }),
        );

        let retry_message = "retrying once without resume session id";
        let next_run_at = Utc::now() + chrono::Duration::milliseconds(100);
        self.db.mark_job_retry(run_id, next_run_at, retry_message)?;
        self.db
            .update_run_status(run_id, RunStatus::Queued, None, Some(retry_message))?;

        self.pending_runs.lock().await.insert(
            run_id.to_string(),
            PendingRun {
                payload: retried_payload,
                capability: pending.capability.clone(),
                binary_path: pending.binary_path.clone(),
                execution_path: pending.execution_path,
                session_input: None,
                harness_warnings: pending.harness_warnings.clone(),
            },
        );

        if let Err(error) = self
            .scheduler
            .enqueue(ScheduledRun {
                run_id: run_id.to_string(),
                provider: pending.payload.provider,
                priority: pending.payload.queue_priority.unwrap_or_default(),
                queued_at: Utc::now(),
                not_before: next_run_at,
            })
            .await
        {
            self.pending_runs.lock().await.remove(run_id);
            return Err(AppError::Policy(error));
        }

        self.emit_event(
            run_id,
            "run.progress",
            json!({
                "stage": "retry_scheduled",
                "reason": "session_resume_invalid",
                "nextRunAt": next_run_at
            }),
        )
        .await?;
        Ok(true)
    }

    async fn schedule_retry_if_eligible(
        &self,
        run_id: &str,
        pending: &PendingRun,
        message: &str,
    ) -> AppResult<bool> {
        if pending.payload.mode == RunMode::Interactive {
            return Ok(false);
        }

        let Some(job) = self.db.get_queue_job(run_id)? else {
            return Ok(false);
        };

        if job.max_retries == 0 {
            return Ok(false);
        }

        // attempts is incremented in mark_job_running; retries are permitted while attempts <= max_retries
        if job.attempts > job.max_retries {
            return Ok(false);
        }

        let shift = job.attempts.saturating_sub(1);
        let multiplier: u64 = 1_u64.checked_shl(shift).unwrap_or(u64::MAX);
        let delay_ms = job.retry_backoff_ms.saturating_mul(multiplier).max(100);
        let next_run_at = Utc::now()
            + chrono::Duration::milliseconds(
                i64::try_from(delay_ms).unwrap_or(i64::MAX.saturating_sub(1)),
            );

        self.db.mark_job_retry(run_id, next_run_at, message)?;
        self.db.update_run_status(
            run_id,
            RunStatus::Queued,
            None,
            Some(&format!(
                "retry scheduled (attempt {}/{}) after failure: {}",
                job.attempts, job.max_retries, message
            )),
        )?;

        self.pending_runs.lock().await.insert(
            run_id.to_string(),
            PendingRun {
                payload: pending.payload.clone(),
                capability: pending.capability.clone(),
                binary_path: pending.binary_path.clone(),
                execution_path: pending.execution_path,
                session_input: None,
                harness_warnings: pending.harness_warnings.clone(),
            },
        );

        if let Err(error) = self
            .scheduler
            .enqueue(ScheduledRun {
                run_id: run_id.to_string(),
                provider: pending.payload.provider,
                priority: pending.payload.queue_priority.unwrap_or_default(),
                queued_at: Utc::now(),
                not_before: next_run_at,
            })
            .await
        {
            self.pending_runs.lock().await.remove(run_id);
            return Err(AppError::Policy(error));
        }

        self.emit_event(
            run_id,
            "run.progress",
            json!({
                "stage": "retry_scheduled",
                "attempt": job.attempts,
                "maxRetries": job.max_retries,
                "nextRunAt": next_run_at,
                "message": message
            }),
        )
        .await?;

        Ok(true)
    }

    async fn fail_run(
        &self,
        run_id: &str,
        exit_code: Option<i32>,
        message: &str,
        close_session: bool,
    ) -> AppResult<()> {
        self.db
            .update_run_status(run_id, RunStatus::Failed, exit_code, Some(message))?;
        self.db.mark_job_finished(run_id, true)?;
        self.emit_event(
            run_id,
            "run.failed",
            json!({ "exit_code": exit_code, "message": message }),
        )
        .await?;
        let _ = self.touch_conversation_for_run(run_id).await;
        if close_session {
            self.emit_event(run_id, "session.closed", json!({})).await?;
            self.sessions.close_session(run_id).await;
        }
        Ok(())
    }

    fn adapter_for(&self, provider: Provider) -> Arc<dyn Adapter> {
        match provider {
            Provider::Codex => self.codex.clone(),
            Provider::Claude => self.claude.clone(),
        }
    }

    async fn emit_redacted_stream(
        &self,
        run_id: &str,
        event_type: &str,
        raw_line: String,
        adapter: &dyn Adapter,
        stream: &str,
        max_tool_result_lines: Option<u32>,
        semantic_stats: Option<Arc<SemanticStats>>,
    ) -> AppResult<String> {
        let redactor = self.redactor.read().await;
        let redacted = redactor.redact(&raw_line);
        let redacted_text = redacted.content;

        let payload = json!({
            "text": redacted_text,
            "redaction_count": redacted.redaction_count,
        });

        self.emit_event(run_id, event_type, payload).await?;

        if let Some(progress) = adapter.parse_chunk(stream, &redacted_text) {
            self.emit_event(run_id, "run.progress", progress).await?;
        }
        let semantic_events = adapter.parse_semantic_events(run_id, stream, &redacted_text);
        for semantic in semantic_events {
            let normalized = trim_semantic_tool_result(semantic, max_tool_result_lines);
            self.handle_conversation_semantic(run_id, &normalized).await?;
            if let Some(stats) = &semantic_stats {
                stats.event_count.fetch_add(1, Ordering::Relaxed);
                if is_tool_semantic_event(&normalized) {
                    stats.tool_event_count.fetch_add(1, Ordering::Relaxed);
                }
            }
            self.emit_event(run_id, "run.semantic", normalized).await?;
        }
        if let Some((severity, message)) = detect_diagnostic_line(&redacted_text) {
            self.emit_event(
                run_id,
                "run.progress",
                json!({
                    "stage": "stream_diagnostic",
                    "severity": severity,
                    "stream": stream,
                    "message": message
                }),
            )
            .await?;
        }

        Ok(redacted_text)
    }

    async fn emit_event(&self, run_id: &str, event_type: &str, payload: serde_json::Value) -> AppResult<()> {
        let event = self.db.insert_event(run_id, event_type, &payload)?;

        let envelope = StreamEnvelope {
            run_id: run_id.to_string(),
            r#type: event_type.to_string(),
            payload,
            timestamp: event.created_at,
            event_id: event.id,
            seq: event.seq,
        };

        let app = self.app_handle.read().await;
        if let Some(handle) = app.as_ref() {
            let _ = handle.emit("run_event", envelope);
        }

        Ok(())
    }

    fn emit_app_event(&self, event_type: &str, payload: serde_json::Value) -> AppResult<()> {
        let event_id = Uuid::new_v4().to_string();
        let envelope = StreamEnvelope {
            run_id: String::new(),
            r#type: event_type.to_string(),
            payload,
            timestamp: Utc::now(),
            event_id,
            seq: 0,
        };
        if let Ok(handle_opt) = self.app_handle.try_read() {
            if let Some(handle) = handle_opt.as_ref() {
                let _ = handle.emit("run_event", envelope);
            }
        }
        Ok(())
    }

    async fn handle_conversation_semantic(&self, run_id: &str, semantic: &serde_json::Value) -> AppResult<()> {
        let event_type = semantic.get("type").and_then(|value| value.as_str()).unwrap_or_default();
        if event_type != "session_complete" {
            return Ok(());
        }
        let session_id = semantic
            .get("sessionId")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        let Some(session_id) = session_id else {
            return Ok(());
        };
        let Some(conversation_id) = self.db.find_conversation_id_by_run(run_id)? else {
            return Ok(());
        };
        self.db
            .set_conversation_session_id(&conversation_id, &session_id)?;
        self.db.touch_conversation_updated_at(&conversation_id)?;
        let _ = self.emit_app_event(
            "conversation.session_updated",
            json!({
                "conversationId": conversation_id,
                "sessionId": session_id
            }),
        );
        Ok(())
    }

    async fn touch_conversation_for_run(&self, run_id: &str) -> AppResult<()> {
        let Some(conversation_id) = self.db.find_conversation_id_by_run(run_id)? else {
            return Ok(());
        };
        self.db.touch_conversation_updated_at(&conversation_id)?;
        let provider = self
            .db
            .get_conversation(&conversation_id)?
            .map(|conversation| conversation.provider);
        let _ = self.emit_app_event(
            "conversation.updated",
            json!({
                "conversationId": conversation_id,
                "provider": provider,
                "updatedAt": Utc::now()
            }),
        );
        Ok(())
    }

    fn resolve_conversation_cwd(&self, requested: Option<String>) -> AppResult<String> {
        if let Some(cwd) = requested.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
            return Ok(cwd);
        }
        let grants = self.db.list_workspace_grants()?;
        let active = grants
            .into_iter()
            .find(|grant| grant.revoked_at.is_none())
            .map(|grant| grant.path);
        active.ok_or_else(|| AppError::Policy("No workspace grant found. Configure one in Settings.".to_string()))
    }

    async fn apply_runtime_settings(&self, settings: &AppSettings) {
        let mut redactor = self.redactor.write().await;
        *redactor = Redactor::new(settings.redact_aggressive);
    }

    async fn get_or_create_artifact_key(&self) -> AppResult<[u8; 32]> {
        let _guard = self.keyring_lock.lock().await;
        let entry = keyring::Entry::new("local-cli-command-center", "artifact-encryption-key")
            .map_err(|error| AppError::Io(error.to_string()))?;

        if let Ok(value) = entry.get_password() {
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(|error| AppError::Io(error.to_string()))?;
            if decoded.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&decoded);
                return Ok(key);
            }
        }

        let key: [u8; 32] = rand::random();
        let encoded = base64::engine::general_purpose::STANDARD.encode(key);
        entry
            .set_password(&encoded)
            .map_err(|error| AppError::Io(error.to_string()))?;
        Ok(key)
    }

    async fn persist_encrypted_raw_artifact(&self, run_id: &str, content: &str) -> AppResult<()> {
        if content.is_empty() {
            return Ok(());
        }

        let key = self.get_or_create_artifact_key().await?;
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|error| AppError::Io(error.to_string()))?;
        let nonce_bytes: [u8; 12] = rand::random();
        let nonce = Nonce::from_slice(&nonce_bytes);
        let encrypted = cipher
            .encrypt(nonce, content.as_bytes())
            .map_err(|error| AppError::Io(error.to_string()))?;

        let artifact_dir = self.app_data_dir.join("artifacts");
        std::fs::create_dir_all(&artifact_dir).map_err(|error| AppError::Io(error.to_string()))?;
        let file_path = artifact_dir.join(format!("{}.enc.json", sanitize_filename_component(run_id)));
        let payload = serde_json::json!({
            "alg": "aes-256-gcm",
            "nonce": base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
            "ciphertext": base64::engine::general_purpose::STANDARD.encode(encrypted)
        });
        std::fs::write(&file_path, serde_json::to_vec_pretty(&payload)?)
            .map_err(|error| AppError::Io(error.to_string()))?;

        self.db.insert_artifact(
            run_id,
            "raw_encrypted",
            &file_path.to_string_lossy(),
            &serde_json::json!({
                "algorithm": "aes-256-gcm",
                "bytes": content.len()
            }),
        )?;
        Ok(())
    }

    fn persist_session_transcript_artifact(&self, run_id: &str, content: &str) -> AppResult<()> {
        if content.is_empty() {
            return Ok(());
        }

        let artifact_dir = self.app_data_dir.join("artifacts");
        std::fs::create_dir_all(&artifact_dir).map_err(|error| AppError::Io(error.to_string()))?;
        let file_path = artifact_dir.join(format!(
            "{}-session.txt",
            sanitize_filename_component(run_id)
        ));
        std::fs::write(&file_path, content).map_err(|error| AppError::Io(error.to_string()))?;

        self.db.insert_artifact(
            run_id,
            "session_transcript",
            &file_path.to_string_lossy(),
            &serde_json::json!({
                "bytes": content.len()
            }),
        )?;
        Ok(())
    }

    fn cleanup_runtime_paths(&self, paths: &[String]) {
        for path in paths {
            let candidate = Path::new(path);
            if candidate.is_dir() {
                let _ = std::fs::remove_dir_all(candidate);
            } else {
                let _ = std::fs::remove_file(candidate);
            }
        }
    }

    fn apply_profile_if_selected(&self, payload: StartRunPayload) -> AppResult<StartRunPayload> {
        let Some(profile_id) = payload.profile_id.clone() else {
            return Ok(payload);
        };

        let profile = self
            .db
            .get_profile_by_id(&profile_id)?
            .ok_or_else(|| AppError::NotFound(format!("Profile {} not found", profile_id)))?;
        if profile.provider != payload.provider {
            return Err(AppError::Policy(format!(
                "Profile '{}' targets provider '{}' but run requested '{}'",
                profile.name,
                profile.provider.as_str(),
                payload.provider.as_str()
            )));
        }

        if !profile.config.is_object() {
            return Err(AppError::Policy(format!(
                "Profile '{}' config must be a JSON object",
                profile.name
            )));
        }

        let mut merged = profile.config.clone();
        merge_json_skip_null(&mut merged, serde_json::to_value(payload)?);
        let payload: StartRunPayload = serde_json::from_value(merged)?;
        Ok(payload)
    }

    fn normalize_payload_defaults(&self, mut payload: StartRunPayload) -> StartRunPayload {
        payload.model = payload
            .model
            .and_then(|model| {
                let trimmed = model.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            });

        match payload.provider {
            Provider::Codex => match payload.model.as_deref() {
                Some(model) if is_known_bad_codex_model(model) => {
                    payload.model = Some(DEFAULT_CODEX_MODEL.to_string());
                }
                Some(_) => {}
                None => {
                    payload.model = Some(DEFAULT_CODEX_MODEL.to_string());
                }
            },
            Provider::Claude => {
                if payload.model.is_none() {
                    payload.model = Some(DEFAULT_CLAUDE_MODEL.to_string());
                }
            }
        }

        payload
    }

    fn resolve_binary_path(
        &self,
        provider: Provider,
        binary_path: &str,
        settings: &AppSettings,
    ) -> AppResult<(String, RunExecutionPath)> {
        let expected = match provider {
            Provider::Codex => "codex",
            Provider::Claude => "claude",
        };

        let candidate = Path::new(binary_path);
        if candidate.components().count() == 1 {
            if binary_path != expected {
                return Err(AppError::Policy(format!(
                    "Binary alias '{}' is not allowed for provider {}. Use '{}'.",
                    binary_path,
                    provider.as_str(),
                    expected
                )));
            }
            return Ok((expected.to_string(), RunExecutionPath::ScopedShellAlias));
        }

        if !candidate.is_absolute() {
            return Err(AppError::Policy(format!(
                "Binary path '{}' must be either '{}' alias or an absolute path",
                binary_path, expected
            )));
        }
        if !settings.allow_advanced_policy {
            return Err(AppError::Policy(
                "Absolute binary paths require advanced policy mode".to_string(),
            ));
        }

        let canonical = candidate.canonicalize().map_err(|error| {
            AppError::Policy(format!("Invalid binary path '{}': {}", binary_path, error))
        })?;
        if !canonical.is_file() {
            return Err(AppError::Policy(format!(
                "Binary path '{}' is not a file",
                binary_path
            )));
        }

        let basename = canonical
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if basename != expected {
            return Err(AppError::Policy(format!(
                "Binary path '{}' basename '{}' does not match provider expected '{}'",
                binary_path, basename, expected
            )));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = std::fs::metadata(&canonical)
                .map_err(|error| AppError::Policy(format!("Cannot read binary metadata: {}", error)))?;
            if metadata.permissions().mode() & 0o111 == 0 {
                return Err(AppError::Policy(format!(
                    "Binary path '{}' is not executable",
                    binary_path
                )));
            }
        }

        #[cfg(windows)]
        {
            let extension = canonical
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "exe" | "cmd" | "bat") {
                return Err(AppError::Policy(format!(
                    "Binary path '{}' must resolve to an .exe, .cmd, or .bat file",
                    binary_path
                )));
            }
        }

        Ok((
            canonical.to_string_lossy().to_string(),
            RunExecutionPath::VerifiedAbsolutePath,
        ))
    }
}

fn merge_json(target: &mut serde_json::Value, update: serde_json::Value) {
    match (target, update) {
        (serde_json::Value::Object(target_map), serde_json::Value::Object(update_map)) => {
            for (key, value) in update_map {
                merge_json(target_map.entry(key).or_insert(serde_json::Value::Null), value);
            }
        }
        (target, update) => {
            *target = update;
        }
    }
}

fn merge_json_skip_null(target: &mut serde_json::Value, update: serde_json::Value) {
    match (target, update) {
        (serde_json::Value::Object(target_map), serde_json::Value::Object(update_map)) => {
            for (key, value) in update_map {
                merge_json_skip_null(
                    target_map.entry(key).or_insert(serde_json::Value::Null),
                    value,
                );
            }
        }
        (_, serde_json::Value::Null) => {}
        (target, update) => {
            *target = update;
        }
    }
}

fn canonicalize_absolute(path: &str) -> AppResult<String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err(AppError::Policy(
            "Workspace grants require absolute paths".to_string(),
        ));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| AppError::Policy(format!("Unable to resolve workspace path: {}", error)))?;
    Ok(canonical.to_string_lossy().to_string())
}

fn sanitize_filename_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let candidate: String = out.trim_matches('_').chars().take(120).collect();
    if candidate.is_empty() {
        "run".to_string()
    } else {
        candidate
    }
}

fn sanitize_terminal_chunk(value: &str) -> String {
    let stripped = ANSI_ESCAPE_RE.replace_all(value, "");
    stripped.replace('\r', "")
}

fn detect_diagnostic_line(line: &str) -> Option<(&'static str, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.contains(" error") || lower.starts_with("error:") || lower.starts_with("fatal:") {
        return Some(("error", trimmed.to_string()));
    }
    if lower.contains(" warn") || lower.starts_with("warning:") || lower.starts_with("warn:") {
        return Some(("warning", trimmed.to_string()));
    }

    None
}

fn trim_tool_result(result: &str, max_lines: Option<u32>) -> String {
    let Some(max_lines) = max_lines else {
        return result.to_string();
    };
    if max_lines == 0 {
        return result.to_string();
    }
    let max_lines = max_lines as usize;
    let lines = result.split('\n').collect::<Vec<_>>();
    if lines.len() <= max_lines {
        return result.to_string();
    }
    let trimmed = lines[..max_lines].join("\n");
    format!(
        "{}\n... ({} more lines trimmed)",
        trimmed,
        lines.len().saturating_sub(max_lines)
    )
}

fn trim_semantic_tool_result(
    mut semantic: serde_json::Value,
    max_lines: Option<u32>,
) -> serde_json::Value {
    let event_type = semantic
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if event_type != "tool_result" && event_type != "tool_result_delta" {
        return semantic;
    }

    if let Some(result) = semantic
        .get("result")
        .and_then(|value| value.as_str())
        .map(|value| trim_tool_result(value, max_lines))
    {
        if let Some(obj) = semantic.as_object_mut() {
            obj.insert("result".to_string(), serde_json::Value::String(result));
        }
    } else if let Some(delta) = semantic
        .get("delta")
        .and_then(|value| value.as_str())
        .map(|value| trim_tool_result(value, max_lines))
    {
        if let Some(obj) = semantic.as_object_mut() {
            obj.insert("delta".to_string(), serde_json::Value::String(delta));
        }
    }

    semantic
}

fn is_tool_semantic_event(semantic: &serde_json::Value) -> bool {
    matches!(
        semantic.get("type").and_then(|value| value.as_str()),
        Some("tool_start" | "tool_result" | "tool_result_delta")
    )
}

fn is_known_bad_codex_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized.is_empty()
}

fn payload_has_resume_request(payload: &StartRunPayload) -> bool {
    payload
        .harness
        .as_ref()
        .map(|harness| {
            harness
                .resume_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some()
                || harness.continue_session == Some(true)
        })
        .unwrap_or(false)
}

fn is_resume_invalid_failure(text_lowercase: &str) -> bool {
    const MATCHERS: [&str; 7] = [
        "not_found: no active session for run",
        "no active session",
        "thread not found",
        "invalid session id",
        "could not resume",
        "session not found",
        "no active session for run",
    ];
    MATCHERS.iter().any(|matcher| text_lowercase.contains(matcher))
}

fn render_markdown_export(detail: &RunDetail) -> String {
    let mut out = String::new();
    out.push_str(&format!("# Run {}\n\n", detail.run.id));
    out.push_str(&format!("- provider: {:?}\n", detail.run.provider));
    out.push_str(&format!("- status: {:?}\n", detail.run.status));
    out.push_str(&format!("- prompt: {}\n\n", detail.run.prompt));
    out.push_str("## Events\n\n");
    for event in &detail.events {
        out.push_str(&format!(
            "- `{}` `{}` `{}`\n",
            event.created_at,
            event.event_type,
            event.payload
        ));
    }
    out
}

fn render_text_export(detail: &RunDetail) -> String {
    let mut out = String::new();
    out.push_str(&format!("Run {}\n", detail.run.id));
    out.push_str(&format!("Status: {:?}\n", detail.run.status));
    out.push_str(&format!("Prompt: {}\n", detail.run.prompt));
    out.push_str("\nEvents:\n");
    for event in &detail.events {
        out.push_str(&format!("{} | {} | {}\n", event.created_at, event.event_type, event.payload));
    }
    out
}

fn parse_metric_output(raw: &str) -> Result<(serde_json::Value, String), String> {
    // Strategy 1: Parse entire output as JSON
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) {
        if let (Some(values), Some(html)) = (parsed.get("values"), parsed.get("html")) {
            return Ok((values.clone(), html.as_str().unwrap_or_default().to_string()));
        }
    }

    // Strategy 2: Extract ```json ... ``` code block
    if let Some(start) = raw.find("```json") {
        let after = &raw[start + 7..];
        if let Some(end) = after.find("```") {
            let block = after[..end].trim();
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(block) {
                if let (Some(values), Some(html)) = (parsed.get("values"), parsed.get("html")) {
                    return Ok((values.clone(), html.as_str().unwrap_or_default().to_string()));
                }
            }
        }
    }

    // Strategy 3: Scan for first balanced {} containing "values" key
    if let Some(start) = raw.find('{') {
        let mut depth = 0i32;
        let bytes = raw.as_bytes();
        let mut in_string = false;
        let mut escape_next = false;
        for (i, &b) in bytes.iter().enumerate().skip(start) {
            if escape_next {
                escape_next = false;
                continue;
            }
            if b == b'\\' && in_string {
                escape_next = true;
                continue;
            }
            if b == b'"' {
                in_string = !in_string;
                continue;
            }
            if in_string {
                continue;
            }
            if b == b'{' {
                depth += 1;
            } else if b == b'}' {
                depth -= 1;
                if depth == 0 {
                    let candidate = &raw[start..=i];
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(candidate) {
                        if let (Some(values), Some(html)) = (parsed.get("values"), parsed.get("html")) {
                            return Ok((values.clone(), html.as_str().unwrap_or_default().to_string()));
                        }
                    }
                    break;
                }
            }
        }
    }

    Err("Could not parse metric output: no valid JSON with 'values' and 'html' keys found".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        detect_diagnostic_line, is_known_bad_codex_model, is_resume_invalid_failure, payload_has_resume_request,
        RunExecutionPath, RunnerCore,
        DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_MODEL,
    };
    use crate::models::{
        AppSettings, CreateConversationPayload, HarnessRequestOptions, Provider, RunMode, SaveProfilePayload,
        SendConversationMessagePayload, StartRunPayload,
    };
    use std::collections::BTreeMap;

    fn base_payload(provider: Provider) -> StartRunPayload {
        StartRunPayload {
            provider,
            prompt: "test prompt".to_string(),
            model: None,
            mode: RunMode::NonInteractive,
            output_format: Some("text".to_string()),
            cwd: std::env::temp_dir().to_string_lossy().to_string(),
            optional_flags: BTreeMap::new(),
            profile_id: None,
            queue_priority: Some(1),
            timeout_seconds: Some(300),
            scheduled_at: None,
            max_retries: Some(0),
            retry_backoff_ms: Some(1_000),
            harness: None,
        }
    }

    #[tokio::test]
    async fn profile_merge_applies_defaults_without_overwriting_with_nulls() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");

        let profile = runner
            .save_profile(SaveProfilePayload {
                id: None,
                name: "codex-defaults".to_string(),
                provider: Provider::Codex,
                config: serde_json::json!({
                    "model": "gpt-5",
                    "timeoutSeconds": 42,
                    "queuePriority": -2,
                    "optionalFlags": {
                        "json": true
                    }
                }),
            })
            .expect("save profile");

        let mut payload = base_payload(Provider::Codex);
        payload.profile_id = Some(profile.id);
        payload.queue_priority = Some(3);
        payload.timeout_seconds = None;

        let merged = runner
            .apply_profile_if_selected(payload)
            .expect("profile merge");
        assert_eq!(merged.model.as_deref(), Some("gpt-5"));
        assert_eq!(merged.timeout_seconds, Some(42));
        assert_eq!(merged.queue_priority, Some(3));
        assert_eq!(merged.optional_flags.get("json"), Some(&serde_json::json!(true)));
    }

    #[tokio::test]
    async fn profile_provider_mismatch_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");

        let profile = runner
            .save_profile(SaveProfilePayload {
                id: None,
                name: "claude-profile".to_string(),
                provider: Provider::Claude,
                config: serde_json::json!({ "model": "claude-sonnet" }),
            })
            .expect("save profile");

        let mut payload = base_payload(Provider::Codex);
        payload.profile_id = Some(profile.id);

        let result = runner.apply_profile_if_selected(payload);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn binary_alias_uses_scoped_shell_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let settings = AppSettings::default();

        let (path, mode) = runner
            .resolve_binary_path(Provider::Codex, "codex", &settings)
            .expect("resolve");
        assert_eq!(path, "codex");
        assert_eq!(mode, RunExecutionPath::ScopedShellAlias);
    }

    #[tokio::test]
    async fn absolute_binary_requires_advanced_policy_mode() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let settings = AppSettings::default();
        let absolute = std::env::temp_dir().join("codex");
        let absolute = absolute.to_string_lossy().to_string();

        let result = runner.resolve_binary_path(Provider::Codex, &absolute, &settings);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn verified_absolute_binary_path_is_allowed_in_advanced_mode() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let mut settings = AppSettings::default();
        settings.allow_advanced_policy = true;

        #[cfg(unix)]
        let binary = {
            use std::os::unix::fs::PermissionsExt;
            let path = dir.path().join("codex");
            std::fs::write(&path, "#!/usr/bin/env bash\nexit 0\n").expect("write binary");
            let mut perms = std::fs::metadata(&path).expect("metadata").permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms).expect("set perms");
            path
        };

        #[cfg(windows)]
        let binary = {
            let path = dir.path().join("codex.exe");
            std::fs::write(&path, "@echo off\r\nexit /B 0\r\n").expect("write binary");
            path
        };

        let binary_raw = binary.to_string_lossy().to_string();
        let (resolved, mode) = runner
            .resolve_binary_path(Provider::Codex, &binary_raw, &settings)
            .expect("resolve");

        assert_eq!(mode, RunExecutionPath::VerifiedAbsolutePath);
        assert_eq!(
            std::path::Path::new(&resolved),
            binary.canonicalize().expect("canonical").as_path()
        );
    }

    #[test]
    fn detects_warning_and_error_diagnostic_lines() {
        let warning = detect_diagnostic_line("Warning: model fell back");
        assert!(warning.is_some());
        assert_eq!(warning.expect("warning").0, "warning");

        let error = detect_diagnostic_line("ERROR: stream disconnected");
        assert!(error.is_some());
        assert_eq!(error.expect("error").0, "error");

        let none = detect_diagnostic_line("regular informational output");
        assert!(none.is_none());
    }

    #[tokio::test]
    async fn payload_defaults_apply_provider_models() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");

        let codex = runner.normalize_payload_defaults(base_payload(Provider::Codex));
        assert_eq!(codex.model.as_deref(), Some(DEFAULT_CODEX_MODEL));

        let claude = runner.normalize_payload_defaults(base_payload(Provider::Claude));
        assert_eq!(claude.model.as_deref(), Some(DEFAULT_CLAUDE_MODEL));
    }

    #[tokio::test]
    async fn explicit_codex_model_is_preserved() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let mut payload = base_payload(Provider::Codex);
        payload.model = Some("gpt-5.3-codex".to_string());

        let normalized = runner.normalize_payload_defaults(payload);
        assert_eq!(normalized.model.as_deref(), Some("gpt-5.3-codex"));
        assert!(!is_known_bad_codex_model("gpt-5.3-codex"));
        assert!(!is_known_bad_codex_model("gpt-5-codex"));
        assert!(is_known_bad_codex_model("   "));
    }

    #[tokio::test]
    async fn send_conversation_message_links_run_and_applies_stored_resume_session() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let cwd = dir.path().to_string_lossy().to_string();
        runner.grant_workspace(&cwd).expect("grant workspace");

        let conversation = runner
            .create_conversation(CreateConversationPayload {
                provider: Provider::Codex,
                title: Some("session continuity".to_string()),
                metadata: None,
            })
            .expect("create conversation");
        runner
            .db
            .set_conversation_session_id(&conversation.id, "thread-123")
            .expect("set session");

        let started = runner
            .send_conversation_message(SendConversationMessagePayload {
                conversation_id: conversation.id.clone(),
                prompt: "continue".to_string(),
                model: Some("gpt-5.3-codex".to_string()),
                output_format: Some("text".to_string()),
                cwd: Some(cwd),
                optional_flags: None,
                profile_id: None,
                queue_priority: Some(0),
                timeout_seconds: Some(120),
                scheduled_at: None,
                max_retries: Some(0),
                retry_backoff_ms: Some(500),
                harness: Some(HarnessRequestOptions {
                    continue_session: Some(true),
                    ..Default::default()
                }),
            })
            .await
            .expect("send message");

        let detail = runner
            .get_run(&started.run_id)
            .expect("get run")
            .expect("run exists");
        assert_eq!(detail.run.provider, Provider::Codex);
        assert_eq!(
            detail.run.conversation_id.as_deref(),
            Some(conversation.id.as_str())
        );

        let pending = runner.pending_runs.lock().await;
        let queued = pending.get(&started.run_id).expect("pending run");
        let resume_from_harness = queued
            .payload
            .harness
            .as_ref()
            .and_then(|harness| harness.resume_session_id.clone());
        let resume_warning = queued
            .harness_warnings
            .iter()
            .any(|warning| warning.to_ascii_lowercase().contains("resume"));
        assert!(
            resume_from_harness.as_deref() == Some("thread-123") || resume_warning,
            "expected resume session id to be forwarded or downgraded with an explicit warning"
        );
    }

    #[tokio::test]
    async fn send_conversation_message_rejects_archived_conversations() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let cwd = dir.path().to_string_lossy().to_string();
        runner.grant_workspace(&cwd).expect("grant workspace");

        let conversation = runner
            .create_conversation(CreateConversationPayload {
                provider: Provider::Claude,
                title: Some("archived".to_string()),
                metadata: None,
            })
            .expect("create conversation");
        runner
            .archive_conversation(crate::models::ArchiveConversationPayload {
                conversation_id: conversation.id.clone(),
                archived: Some(true),
            })
            .expect("archive");

        let result = runner
            .send_conversation_message(SendConversationMessagePayload {
                conversation_id: conversation.id,
                prompt: "should fail".to_string(),
                model: Some("sonnet".to_string()),
                output_format: Some("text".to_string()),
                cwd: Some(cwd),
                optional_flags: None,
                profile_id: None,
                queue_priority: Some(0),
                timeout_seconds: Some(60),
                scheduled_at: None,
                max_retries: Some(0),
                retry_backoff_ms: Some(500),
                harness: None,
            })
            .await;

        assert!(result.is_err());
    }

    #[test]
    fn detects_resume_invalid_failure_messages() {
        assert!(is_resume_invalid_failure("not_found: no active session for run abc"));
        assert!(is_resume_invalid_failure("invalid session id supplied"));
        assert!(is_resume_invalid_failure("thread not found"));
        assert!(!is_resume_invalid_failure("rate limit exceeded"));
    }

    #[test]
    fn detects_payload_resume_requests() {
        let mut payload = base_payload(Provider::Codex);
        assert!(!payload_has_resume_request(&payload));

        payload.harness = Some(crate::models::HarnessRequestOptions {
            resume_session_id: Some("abc".to_string()),
            ..Default::default()
        });
        assert!(payload_has_resume_request(&payload));

        payload.harness = Some(crate::models::HarnessRequestOptions {
            continue_session: Some(true),
            ..Default::default()
        });
        assert!(payload_has_resume_request(&payload));
    }
}

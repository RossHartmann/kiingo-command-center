mod adapters;
mod db;
mod errors;
mod harness;
mod models;
mod policy;
mod redaction;
mod runner;
mod scheduler;
mod session;

use crate::models::{
    AcceptedResponse, AppSettings, ArchiveConversationPayload, BindMetricToScreenPayload, BooleanResponse,
    CapabilitySnapshot, ConversationDetail, ConversationRecord, ConversationSummary, CreateConversationPayload,
    ExportResponse, ListConversationsFilters, ListRunsFilters, MetricDefinition, MetricRefreshResponse, MetricSnapshot,
    Profile, Provider, RenameConversationPayload, RerunResponse, RunDetail, SaveMetricDefinitionPayload,
    SaveProfilePayload, SchedulerJob, ScreenMetricBinding, ScreenMetricView, SendConversationMessagePayload,
    StartInteractiveSessionResponse, StartRunPayload, StartRunResponse, WorkspaceGrant,
};
use crate::runner::RunnerCore;
use std::path::Path;
use std::sync::Arc;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;

static LOG_GUARD: std::sync::OnceLock<WorkerGuard> = std::sync::OnceLock::new();

#[derive(Clone)]
struct AppState {
    runner: Arc<RunnerCore>,
}

#[tauri::command]
async fn start_run(state: tauri::State<'_, AppState>, payload: StartRunPayload) -> Result<StartRunResponse, String> {
    state.runner.start_run(payload).await.map_err(to_client_error)
}

#[tauri::command]
fn create_conversation(
    state: tauri::State<'_, AppState>,
    payload: CreateConversationPayload,
) -> Result<ConversationRecord, String> {
    state.runner.create_conversation(payload).map_err(to_client_error)
}

#[tauri::command]
fn list_conversations(
    state: tauri::State<'_, AppState>,
    filters: ListConversationsFilters,
) -> Result<Vec<ConversationSummary>, String> {
    state
        .runner
        .list_conversations(filters)
        .map_err(to_client_error)
}

#[tauri::command]
fn get_conversation(
    state: tauri::State<'_, AppState>,
    conversation_id: String,
) -> Result<Option<ConversationDetail>, String> {
    state
        .runner
        .get_conversation(&conversation_id)
        .map_err(to_client_error)
}

#[tauri::command]
async fn send_conversation_message(
    state: tauri::State<'_, AppState>,
    payload: SendConversationMessagePayload,
) -> Result<StartRunResponse, String> {
    state
        .runner
        .send_conversation_message(payload)
        .await
        .map_err(to_client_error)
}

#[tauri::command]
fn rename_conversation(
    state: tauri::State<'_, AppState>,
    payload: RenameConversationPayload,
) -> Result<Option<ConversationRecord>, String> {
    state
        .runner
        .rename_conversation(payload)
        .map_err(to_client_error)
}

#[tauri::command]
fn archive_conversation(
    state: tauri::State<'_, AppState>,
    payload: ArchiveConversationPayload,
) -> Result<BooleanResponse, String> {
    state
        .runner
        .archive_conversation(payload)
        .map_err(to_client_error)
}

#[tauri::command]
async fn cancel_run(state: tauri::State<'_, AppState>, run_id: String) -> Result<BooleanResponse, String> {
    state.runner.cancel_run(&run_id).await.map_err(to_client_error)
}

#[tauri::command]
fn get_run(state: tauri::State<'_, AppState>, run_id: String) -> Result<Option<RunDetail>, String> {
    state.runner.get_run(&run_id).map_err(to_client_error)
}

#[tauri::command]
fn list_runs(state: tauri::State<'_, AppState>, filters: ListRunsFilters) -> Result<Vec<crate::models::RunRecord>, String> {
    state.runner.list_runs(filters).map_err(to_client_error)
}

#[tauri::command]
async fn rerun(
    state: tauri::State<'_, AppState>,
    run_id: String,
    overrides: serde_json::Value,
) -> Result<RerunResponse, String> {
    state.runner.rerun(&run_id, overrides).await.map_err(to_client_error)
}

#[tauri::command]
async fn start_interactive_session(
    state: tauri::State<'_, AppState>,
    payload: StartRunPayload,
) -> Result<StartInteractiveSessionResponse, String> {
    state
        .runner
        .start_interactive_session(payload)
        .await
        .map_err(to_client_error)
}

#[tauri::command]
async fn send_session_input(
    state: tauri::State<'_, AppState>,
    run_id: String,
    data: String,
) -> Result<AcceptedResponse, String> {
    state
        .runner
        .send_session_input(&run_id, data)
        .await
        .map_err(to_client_error)
}

#[tauri::command]
async fn end_session(state: tauri::State<'_, AppState>, run_id: String) -> Result<BooleanResponse, String> {
    state.runner.end_session(&run_id).await.map_err(to_client_error)
}

#[tauri::command]
async fn resume_session(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<StartInteractiveSessionResponse, String> {
    state
        .runner
        .resume_session(&run_id)
        .await
        .map_err(to_client_error)
}

#[tauri::command]
fn list_capabilities(state: tauri::State<'_, AppState>) -> Result<Vec<CapabilitySnapshot>, String> {
    state.runner.list_capabilities().map_err(to_client_error)
}

#[tauri::command]
fn list_profiles(state: tauri::State<'_, AppState>) -> Result<Vec<Profile>, String> {
    state.runner.list_profiles().map_err(to_client_error)
}

#[tauri::command]
fn save_profile(state: tauri::State<'_, AppState>, payload: SaveProfilePayload) -> Result<Profile, String> {
    state.runner.save_profile(payload).map_err(to_client_error)
}

#[tauri::command]
fn list_queue_jobs(state: tauri::State<'_, AppState>) -> Result<Vec<SchedulerJob>, String> {
    state.runner.list_queue_jobs().map_err(to_client_error)
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    state.runner.get_settings().map_err(to_client_error)
}

#[tauri::command]
async fn update_settings(
    state: tauri::State<'_, AppState>,
    settings: serde_json::Value,
) -> Result<AppSettings, String> {
    state
        .runner
        .update_settings(settings)
        .await
        .map_err(to_client_error)
}

#[tauri::command]
fn list_workspace_grants(state: tauri::State<'_, AppState>) -> Result<Vec<WorkspaceGrant>, String> {
    state.runner.list_workspace_grants().map_err(to_client_error)
}

#[tauri::command]
fn grant_workspace(state: tauri::State<'_, AppState>, path: String) -> Result<WorkspaceGrant, String> {
    state.runner.grant_workspace(&path).map_err(to_client_error)
}

#[tauri::command]
fn export_run(
    state: tauri::State<'_, AppState>,
    run_id: String,
    format: String,
) -> Result<ExportResponse, String> {
    state.runner.export_run(&run_id, &format).map_err(to_client_error)
}

#[tauri::command]
async fn save_provider_token(
    state: tauri::State<'_, AppState>,
    provider: Provider,
    token: String,
) -> Result<BooleanResponse, String> {
    state
        .runner
        .save_provider_token(provider, token)
        .await
        .map_err(to_client_error)
}

#[tauri::command]
async fn clear_provider_token(
    state: tauri::State<'_, AppState>,
    provider: Provider,
) -> Result<BooleanResponse, String> {
    state
        .runner
        .clear_provider_token(provider)
        .await
        .map_err(to_client_error)
}

#[tauri::command]
async fn has_provider_token(
    state: tauri::State<'_, AppState>,
    provider: Provider,
) -> Result<BooleanResponse, String> {
    state
        .runner
        .has_provider_token(provider)
        .await
        .map_err(to_client_error)
}

// ─── Metric Commands ─────────────────────────────────────────────────────

#[tauri::command]
fn save_metric_definition(
    state: tauri::State<'_, AppState>,
    payload: SaveMetricDefinitionPayload,
) -> Result<MetricDefinition, String> {
    state.runner.save_metric_definition(payload).map_err(to_client_error)
}

#[tauri::command]
fn get_metric_definition(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Option<MetricDefinition>, String> {
    state.runner.get_metric_definition(&id).map_err(to_client_error)
}

#[tauri::command]
fn list_metric_definitions(
    state: tauri::State<'_, AppState>,
    include_archived: Option<bool>,
) -> Result<Vec<MetricDefinition>, String> {
    state.runner.list_metric_definitions(include_archived.unwrap_or(false)).map_err(to_client_error)
}

#[tauri::command]
fn archive_metric_definition(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<BooleanResponse, String> {
    state.runner.archive_metric_definition(&id).map_err(to_client_error)
}

#[tauri::command]
fn delete_metric_definition(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<BooleanResponse, String> {
    state.runner.delete_metric_definition(&id).map_err(to_client_error)
}

#[tauri::command]
fn get_latest_metric_snapshot(
    state: tauri::State<'_, AppState>,
    metric_id: String,
) -> Result<Option<MetricSnapshot>, String> {
    state.runner.get_latest_metric_snapshot(&metric_id).map_err(to_client_error)
}

#[tauri::command]
fn list_metric_snapshots(
    state: tauri::State<'_, AppState>,
    metric_id: String,
    limit: Option<u32>,
) -> Result<Vec<MetricSnapshot>, String> {
    state.runner.list_metric_snapshots(&metric_id, limit).map_err(to_client_error)
}

#[tauri::command]
fn bind_metric_to_screen(
    state: tauri::State<'_, AppState>,
    payload: BindMetricToScreenPayload,
) -> Result<ScreenMetricBinding, String> {
    state.runner.bind_metric_to_screen(payload).map_err(to_client_error)
}

#[tauri::command]
fn reorder_screen_metrics(
    state: tauri::State<'_, AppState>,
    screen_id: String,
    metric_ids: Vec<String>,
) -> Result<BooleanResponse, String> {
    state.runner.reorder_screen_metrics(&screen_id, &metric_ids).map_err(to_client_error)
}

#[tauri::command]
fn unbind_metric_from_screen(
    state: tauri::State<'_, AppState>,
    screen_id: String,
    metric_id: String,
) -> Result<BooleanResponse, String> {
    state.runner.unbind_metric_from_screen(&screen_id, &metric_id).map_err(to_client_error)
}

#[tauri::command]
fn get_screen_metrics(
    state: tauri::State<'_, AppState>,
    screen_id: String,
) -> Result<Vec<ScreenMetricView>, String> {
    state.runner.get_screen_metrics(&screen_id).map_err(to_client_error)
}

#[tauri::command]
async fn refresh_metric(
    state: tauri::State<'_, AppState>,
    metric_id: String,
) -> Result<MetricRefreshResponse, String> {
    state.runner.refresh_metric(&metric_id).await.map_err(to_client_error)
}

#[tauri::command]
async fn refresh_screen_metrics(
    state: tauri::State<'_, AppState>,
    screen_id: String,
) -> Result<Vec<MetricRefreshResponse>, String> {
    state.runner.refresh_screen_metrics(&screen_id).await.map_err(to_client_error)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
            std::fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
            init_tracing(&app_data_dir).map_err(|error| error.to_string())?;

            let runner = RunnerCore::new(app_data_dir).map_err(|error| error.to_string())?;
            let handle = app.handle().clone();

            tauri::async_runtime::spawn({
                let runner = runner.clone();
                async move {
                    runner.start_scheduler();
                }
            });

            tauri::async_runtime::spawn({
                let runner = runner.clone();
                async move {
                    runner.attach_app_handle(handle).await;
                }
            });

            tauri::async_runtime::spawn({
                let runner = runner.clone();
                async move {
                    if let Err(error) = runner.refresh_capabilities().await {
                        tracing::warn!(error = %error, "startup capability detection failed");
                    }
                }
            });

            tauri::async_runtime::spawn({
                let runner = runner.clone();
                async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
                    loop {
                        interval.tick().await;
                        if let Err(error) = runner.run_retention() {
                            tracing::warn!(error = %error, "retention maintenance failed");
                        }
                    }
                }
            });

            tauri::async_runtime::spawn({
                let runner = runner.clone();
                async move {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                    loop {
                        interval.tick().await;
                        if let Err(error) = runner.refresh_proactive_metrics().await {
                            tracing::warn!(error = %error, "proactive metric refresh failed");
                        }
                    }
                }
            });

            app.manage(AppState { runner });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_run,
            create_conversation,
            list_conversations,
            get_conversation,
            send_conversation_message,
            rename_conversation,
            archive_conversation,
            cancel_run,
            get_run,
            list_runs,
            rerun,
            start_interactive_session,
            send_session_input,
            end_session,
            resume_session,
            list_capabilities,
            list_profiles,
            save_profile,
            list_queue_jobs,
            get_settings,
            update_settings,
            list_workspace_grants,
            grant_workspace,
            export_run,
            save_provider_token,
            clear_provider_token,
            has_provider_token,
            save_metric_definition,
            get_metric_definition,
            list_metric_definitions,
            archive_metric_definition,
            delete_metric_definition,
            get_latest_metric_snapshot,
            list_metric_snapshots,
            bind_metric_to_screen,
            unbind_metric_from_screen,
            reorder_screen_metrics,
            get_screen_metrics,
            refresh_metric,
            refresh_screen_metrics
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}

fn init_tracing(app_data_dir: &Path) -> Result<(), String> {
    let log_dir = app_data_dir.join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    let file_appender = tracing_appender::rolling::daily(log_dir, "runner.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .json()
        .with_writer(non_blocking)
        .try_init()
        .map_err(|error| error.to_string())
}

fn to_client_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

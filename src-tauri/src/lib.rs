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
mod workspace;

use crate::models::{
    AcceptedResponse, AppSettings, ArchiveConversationPayload, BindMetricToScreenPayload, BooleanResponse,
    ArchiveAtomRequest, AtomRecord, AttentionUpdateRequest, AttentionUpdateResponse, BlockRecord,
    DeleteAtomRequest,
    ClassificationResult, ClassificationSource, CreateAtomRequest, CreateBlockInNotepadRequest,
    CapabilitySnapshot, ConversationDetail, ConversationRecord, ConversationSummary, CreateConversationPayload,
    DecisionGenerateRequest, DecisionGenerateResponse, ExportResponse, ListAtomsRequest, ListBlocksRequest, ListConversationsFilters,
    ListEventsRequest, ListPlacementsRequest, ListRunsFilters, MetricDefinition, MetricDiagnostics, MetricRefreshResponse, MetricSnapshot,
    NotepadViewDefinition, PageResponse, PlacementRecord, PlacementReorderRequest, Profile, Provider, RecurrenceInstance,
    RecurrenceSpawnRequest, RecurrenceSpawnResponse, RecurrenceTemplate, RenameConversationPayload, RerunResponse, RunDetail,
    SaveMetricDefinitionPayload, SaveNotepadViewRequest, SaveProfilePayload, SchedulerJob, ScreenMetricBinding, ScreenMetricView,
    SetTaskStatusRequest, TaskReopenRequest,
    SendConversationMessagePayload, StartInteractiveSessionResponse, StartRunPayload, StartRunResponse,
    UnbindMetricResponse, UpdateAtomRequest, UpdateScreenMetricLayoutPayload, WorkspaceCapabilities,
    WorkspaceEventRecord, WorkspaceGrant, WorkspaceHealth,
    GovernanceMeta, RuleDefinition, RuleEvaluateRequest, RuleEvaluationResult, RuleMutationPayload, JobDefinition,
    JobMutationPayload, JobRunRecord, DecisionMutationPayload, DecisionPrompt, NotificationDeliveryRecord,
    NotificationMessage, NotificationMutationPayload, ProjectionCheckpoint, ProjectionDefinition,
    ProjectionMutationPayload, ProjectionRebuildResponse, RegistryEntry, RegistryMutationPayload,
    RegistrySuggestionsResponse, SemanticChunk, SemanticReindexResponse, SemanticSearchRequest,
    SemanticSearchResponse, GovernancePoliciesResponse, FeatureFlag, WorkspaceCapabilitySnapshot, MigrationPlan,
    MigrationRun, WorkSessionCancelRequest, WorkSessionEndRequest, WorkSessionNoteRequest, WorkSessionRecord,
    WorkSessionStartRequest, WorkspaceMutationPayload, ConditionCancelRequest, ConditionFollowupRequest,
    ConditionRecord, ConditionResolveRequest, ConditionSetDateRequest, ConditionSetPersonRequest,
    ConditionSetTaskRequest, ListConditionsRequest, ObsidianTaskSyncResult,
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
fn get_metric_diagnostics(
    state: tauri::State<'_, AppState>,
    metric_id: String,
) -> Result<MetricDiagnostics, String> {
    state.runner.get_metric_diagnostics(&metric_id).map_err(to_client_error)
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
fn update_screen_metric_layout(
    state: tauri::State<'_, AppState>,
    payload: UpdateScreenMetricLayoutPayload,
) -> Result<BooleanResponse, String> {
    state.runner.update_screen_metric_layout(&payload.screen_id, &payload.layouts).map_err(to_client_error)
}

#[tauri::command]
fn unbind_metric_from_screen(
    state: tauri::State<'_, AppState>,
    binding_id: String,
) -> Result<UnbindMetricResponse, String> {
    state.runner.unbind_metric_from_screen(&binding_id).map_err(to_client_error)
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

// ─── Workspace Commands ──────────────────────────────────────────────────

#[tauri::command]
fn workspace_capabilities_get(state: tauri::State<'_, AppState>) -> Result<WorkspaceCapabilities, String> {
    state.runner.workspace_capabilities_get().map_err(to_client_error)
}

#[tauri::command]
fn workspace_health_get(state: tauri::State<'_, AppState>) -> Result<WorkspaceHealth, String> {
    state.runner.workspace_health_get().map_err(to_client_error)
}

#[tauri::command]
async fn obsidian_tasks_sync(state: tauri::State<'_, AppState>) -> Result<ObsidianTaskSyncResult, String> {
    let runner = state.runner.clone();
    match tauri::async_runtime::spawn_blocking(move || runner.obsidian_tasks_sync()).await {
        Ok(result) => result.map_err(to_client_error),
        Err(error) => Err(to_client_error(error)),
    }
}

#[tauri::command]
fn atoms_list(
    state: tauri::State<'_, AppState>,
    request: ListAtomsRequest,
) -> Result<PageResponse<AtomRecord>, String> {
    state.runner.atoms_list(request).map_err(to_client_error)
}

#[tauri::command]
fn atom_get(state: tauri::State<'_, AppState>, atom_id: String) -> Result<Option<AtomRecord>, String> {
    state.runner.atom_get(&atom_id).map_err(to_client_error)
}

#[tauri::command]
fn atom_create(state: tauri::State<'_, AppState>, payload: CreateAtomRequest) -> Result<AtomRecord, String> {
    state.runner.atom_create(payload).map_err(to_client_error)
}

#[tauri::command]
fn atom_update(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    payload: UpdateAtomRequest,
) -> Result<AtomRecord, String> {
    state.runner.atom_update(&atom_id, payload).map_err(to_client_error)
}

#[tauri::command]
fn task_status_set(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    payload: SetTaskStatusRequest,
) -> Result<AtomRecord, String> {
    state.runner.task_status_set(&atom_id, payload).map_err(to_client_error)
}

#[tauri::command]
fn task_complete(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    expected_revision: i64,
    idempotency_key: Option<String>,
) -> Result<AtomRecord, String> {
    state
        .runner
        .task_complete(&atom_id, expected_revision, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn task_reopen(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    payload: TaskReopenRequest,
) -> Result<AtomRecord, String> {
    state.runner.task_reopen(&atom_id, payload).map_err(to_client_error)
}

#[tauri::command]
fn atom_archive(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    payload: ArchiveAtomRequest,
) -> Result<AtomRecord, String> {
    state.runner.atom_archive(&atom_id, payload).map_err(to_client_error)
}

#[tauri::command]
fn atom_delete(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    payload: DeleteAtomRequest,
) -> Result<BooleanResponse, String> {
    state.runner.atom_delete(&atom_id, payload).map_err(to_client_error)
}

#[tauri::command]
fn atom_unarchive(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    expected_revision: i64,
    idempotency_key: Option<String>,
) -> Result<AtomRecord, String> {
    state
        .runner
        .atom_unarchive(&atom_id, expected_revision, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn notepads_list(state: tauri::State<'_, AppState>) -> Result<Vec<NotepadViewDefinition>, String> {
    state.runner.notepads_list().map_err(to_client_error)
}

#[tauri::command]
fn notepad_get(
    state: tauri::State<'_, AppState>,
    notepad_id: String,
) -> Result<Option<NotepadViewDefinition>, String> {
    state.runner.notepad_get(&notepad_id).map_err(to_client_error)
}

#[tauri::command]
fn notepad_save(
    state: tauri::State<'_, AppState>,
    payload: SaveNotepadViewRequest,
) -> Result<NotepadViewDefinition, String> {
    state.runner.notepad_save(payload).map_err(to_client_error)
}

#[tauri::command]
fn notepad_delete(
    state: tauri::State<'_, AppState>,
    notepad_id: String,
    idempotency_key: Option<String>,
) -> Result<BooleanResponse, String> {
    state
        .runner
        .notepad_delete(&notepad_id, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn notepad_atoms_list(
    state: tauri::State<'_, AppState>,
    notepad_id: String,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<AtomRecord>, String> {
    state
        .runner
        .notepad_atoms_list(&notepad_id, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn notepad_block_create(
    state: tauri::State<'_, AppState>,
    request: CreateBlockInNotepadRequest,
) -> Result<BlockRecord, String> {
    state
        .runner
        .notepad_block_create(request)
        .map_err(to_client_error)
}

#[tauri::command]
fn blocks_list(
    state: tauri::State<'_, AppState>,
    request: ListBlocksRequest,
) -> Result<PageResponse<BlockRecord>, String> {
    state.runner.blocks_list(request).map_err(to_client_error)
}

#[tauri::command]
fn block_get(state: tauri::State<'_, AppState>, block_id: String) -> Result<Option<BlockRecord>, String> {
    state.runner.block_get(&block_id).map_err(to_client_error)
}

#[tauri::command]
fn placements_list(
    state: tauri::State<'_, AppState>,
    request: ListPlacementsRequest,
) -> Result<PageResponse<PlacementRecord>, String> {
    state.runner.placements_list(request).map_err(to_client_error)
}

#[tauri::command]
fn placement_save(
    state: tauri::State<'_, AppState>,
    placement: WorkspaceMutationPayload,
) -> Result<PlacementRecord, String> {
    state.runner.placement_save(placement).map_err(to_client_error)
}

#[tauri::command]
fn placement_delete(
    state: tauri::State<'_, AppState>,
    placement_id: String,
    idempotency_key: Option<String>,
) -> Result<BooleanResponse, String> {
    state
        .runner
        .placement_delete(&placement_id, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn placements_reorder(
    state: tauri::State<'_, AppState>,
    view_id: String,
    request: PlacementReorderRequest,
) -> Result<Vec<PlacementRecord>, String> {
    state
        .runner
        .placements_reorder(&view_id, request)
        .map_err(to_client_error)
}

#[tauri::command]
fn conditions_list(
    state: tauri::State<'_, AppState>,
    request: ListConditionsRequest,
) -> Result<PageResponse<ConditionRecord>, String> {
    state.runner.conditions_list(request).map_err(to_client_error)
}

#[tauri::command]
fn condition_get(
    state: tauri::State<'_, AppState>,
    condition_id: String,
) -> Result<Option<ConditionRecord>, String> {
    state
        .runner
        .condition_get(&condition_id)
        .map_err(to_client_error)
}

#[tauri::command]
fn condition_set_date(
    state: tauri::State<'_, AppState>,
    request: ConditionSetDateRequest,
) -> Result<ConditionRecord, String> {
    state
        .runner
        .condition_set_date(request)
        .map_err(to_client_error)
}

#[tauri::command]
fn condition_set_person(
    state: tauri::State<'_, AppState>,
    request: ConditionSetPersonRequest,
) -> Result<ConditionRecord, String> {
    state
        .runner
        .condition_set_person(request)
        .map_err(to_client_error)
}

#[tauri::command]
fn condition_set_task(
    state: tauri::State<'_, AppState>,
    request: ConditionSetTaskRequest,
) -> Result<ConditionRecord, String> {
    state
        .runner
        .condition_set_task(request)
        .map_err(to_client_error)
}

#[tauri::command]
fn condition_followup_log(
    state: tauri::State<'_, AppState>,
    condition_id: String,
    request: ConditionFollowupRequest,
) -> Result<ConditionRecord, String> {
    state
        .runner
        .condition_followup_log(&condition_id, request)
        .map_err(to_client_error)
}

#[tauri::command]
fn condition_resolve(
    state: tauri::State<'_, AppState>,
    condition_id: String,
    request: ConditionResolveRequest,
) -> Result<ConditionRecord, String> {
    state
        .runner
        .condition_resolve(&condition_id, request)
        .map_err(to_client_error)
}

#[tauri::command]
fn condition_cancel(
    state: tauri::State<'_, AppState>,
    condition_id: String,
    request: ConditionCancelRequest,
) -> Result<ConditionRecord, String> {
    state
        .runner
        .condition_cancel(&condition_id, request)
        .map_err(to_client_error)
}

#[tauri::command]
fn events_list(
    state: tauri::State<'_, AppState>,
    request: ListEventsRequest,
) -> Result<PageResponse<WorkspaceEventRecord>, String> {
    state.runner.events_list(request).map_err(to_client_error)
}

#[tauri::command]
fn atom_events_list(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<WorkspaceEventRecord>, String> {
    state
        .runner
        .atom_events_list(&atom_id, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn classification_preview(
    state: tauri::State<'_, AppState>,
    raw_text: String,
) -> Result<ClassificationResult, String> {
    state.runner.classification_preview(raw_text).map_err(to_client_error)
}

#[tauri::command]
fn atom_classify(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    source: ClassificationSource,
    force_facet: Option<String>,
    idempotency_key: Option<String>,
) -> Result<AtomRecord, String> {
    state
        .runner
        .atom_classify(&atom_id, source, force_facet, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn rules_list(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
    cursor: Option<String>,
    enabled: Option<bool>,
) -> Result<PageResponse<RuleDefinition>, String> {
    state
        .runner
        .rules_list(limit, cursor, enabled)
        .map_err(to_client_error)
}

#[tauri::command]
fn rule_get(state: tauri::State<'_, AppState>, rule_id: String) -> Result<Option<RuleDefinition>, String> {
    state.runner.rule_get(&rule_id).map_err(to_client_error)
}

#[tauri::command]
fn rule_save(state: tauri::State<'_, AppState>, rule: RuleMutationPayload) -> Result<RuleDefinition, String> {
    state.runner.rule_save(rule).map_err(to_client_error)
}

#[tauri::command]
fn rule_update(
    state: tauri::State<'_, AppState>,
    rule_id: String,
    patch: RuleMutationPayload,
) -> Result<RuleDefinition, String> {
    state
        .runner
        .rule_update(&rule_id, patch)
        .map_err(to_client_error)
}

#[tauri::command]
fn rule_evaluate(
    state: tauri::State<'_, AppState>,
    rule_id: String,
    input: RuleEvaluateRequest,
) -> Result<RuleEvaluationResult, String> {
    state
        .runner
        .rule_evaluate(&rule_id, input)
        .map_err(to_client_error)
}

#[tauri::command]
fn jobs_list(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
    cursor: Option<String>,
    enabled: Option<bool>,
) -> Result<PageResponse<JobDefinition>, String> {
    state
        .runner
        .jobs_list(limit, cursor, enabled)
        .map_err(to_client_error)
}

#[tauri::command]
fn job_get(state: tauri::State<'_, AppState>, job_id: String) -> Result<Option<JobDefinition>, String> {
    state.runner.job_get(&job_id).map_err(to_client_error)
}

#[tauri::command]
fn job_save(state: tauri::State<'_, AppState>, job: JobMutationPayload) -> Result<JobDefinition, String> {
    state.runner.job_save(job).map_err(to_client_error)
}

#[tauri::command]
fn job_update(
    state: tauri::State<'_, AppState>,
    job_id: String,
    patch: JobMutationPayload,
) -> Result<JobDefinition, String> {
    state
        .runner
        .job_update(&job_id, patch)
        .map_err(to_client_error)
}

#[tauri::command]
fn job_run(
    state: tauri::State<'_, AppState>,
    job_id: String,
    payload: Option<serde_json::Value>,
    idempotency_key: Option<String>,
) -> Result<JobRunRecord, String> {
    state
        .runner
        .job_run(&job_id, payload, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn job_runs_list(
    state: tauri::State<'_, AppState>,
    job_id: Option<String>,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<JobRunRecord>, String> {
    state
        .runner
        .job_runs_list(job_id, status, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn job_run_get(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<Option<JobRunRecord>, String> {
    state.runner.job_run_get(&run_id).map_err(to_client_error)
}

#[tauri::command]
fn decisions_list(
    state: tauri::State<'_, AppState>,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<DecisionPrompt>, String> {
    state
        .runner
        .decisions_list(status, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn decision_create(
    state: tauri::State<'_, AppState>,
    prompt: DecisionMutationPayload,
) -> Result<DecisionPrompt, String> {
    state.runner.decision_create(prompt).map_err(to_client_error)
}

#[tauri::command]
fn decision_get(
    state: tauri::State<'_, AppState>,
    decision_id: String,
) -> Result<Option<DecisionPrompt>, String> {
    state.runner.decision_get(&decision_id).map_err(to_client_error)
}

#[tauri::command]
fn decision_resolve(
    state: tauri::State<'_, AppState>,
    decision_id: String,
    option_id: String,
    notes: Option<String>,
    idempotency_key: Option<String>,
) -> Result<DecisionPrompt, String> {
    state
        .runner
        .decision_resolve(&decision_id, option_id, notes, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn decision_snooze(
    state: tauri::State<'_, AppState>,
    decision_id: String,
    snoozed_until: Option<chrono::DateTime<chrono::Utc>>,
    idempotency_key: Option<String>,
) -> Result<DecisionPrompt, String> {
    state
        .runner
        .decision_snooze(&decision_id, snoozed_until, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn decision_dismiss(
    state: tauri::State<'_, AppState>,
    decision_id: String,
    reason: Option<String>,
    idempotency_key: Option<String>,
) -> Result<DecisionPrompt, String> {
    state
        .runner
        .decision_dismiss(&decision_id, reason, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn work_sessions_list(
    state: tauri::State<'_, AppState>,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<WorkSessionRecord>, String> {
    state
        .runner
        .work_sessions_list(status, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn work_session_get(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Option<WorkSessionRecord>, String> {
    state.runner.work_session_get(&session_id).map_err(to_client_error)
}

#[tauri::command]
fn work_session_start(
    state: tauri::State<'_, AppState>,
    request: WorkSessionStartRequest,
) -> Result<WorkSessionRecord, String> {
    state.runner.work_session_start(request).map_err(to_client_error)
}

#[tauri::command]
fn work_session_note(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request: WorkSessionNoteRequest,
) -> Result<WorkSessionRecord, String> {
    state
        .runner
        .work_session_note(&session_id, request)
        .map_err(to_client_error)
}

#[tauri::command]
fn work_session_end(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request: WorkSessionEndRequest,
) -> Result<WorkSessionRecord, String> {
    state
        .runner
        .work_session_end(&session_id, request)
        .map_err(to_client_error)
}

#[tauri::command]
fn work_session_cancel(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request: WorkSessionCancelRequest,
) -> Result<WorkSessionRecord, String> {
    state
        .runner
        .work_session_cancel(&session_id, request)
        .map_err(to_client_error)
}

#[tauri::command]
fn recurrence_templates_list(
    state: tauri::State<'_, AppState>,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<RecurrenceTemplate>, String> {
    state
        .runner
        .recurrence_templates_list(status, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn recurrence_template_get(
    state: tauri::State<'_, AppState>,
    template_id: String,
) -> Result<Option<RecurrenceTemplate>, String> {
    state
        .runner
        .recurrence_template_get(&template_id)
        .map_err(to_client_error)
}

#[tauri::command]
fn recurrence_template_save(
    state: tauri::State<'_, AppState>,
    payload: WorkspaceMutationPayload,
) -> Result<RecurrenceTemplate, String> {
    state.runner.recurrence_template_save(payload).map_err(to_client_error)
}

#[tauri::command]
fn recurrence_template_update(
    state: tauri::State<'_, AppState>,
    template_id: String,
    payload: WorkspaceMutationPayload,
) -> Result<RecurrenceTemplate, String> {
    state
        .runner
        .recurrence_template_update(&template_id, payload)
        .map_err(to_client_error)
}

#[tauri::command]
fn recurrence_instances_list(
    state: tauri::State<'_, AppState>,
    template_id: Option<String>,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<RecurrenceInstance>, String> {
    state
        .runner
        .recurrence_instances_list(template_id, status, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn recurrence_spawn(
    state: tauri::State<'_, AppState>,
    request: RecurrenceSpawnRequest,
) -> Result<RecurrenceSpawnResponse, String> {
    state.runner.recurrence_spawn(request).map_err(to_client_error)
}

#[tauri::command]
fn system_apply_attention_update(
    state: tauri::State<'_, AppState>,
    request: AttentionUpdateRequest,
) -> Result<AttentionUpdateResponse, String> {
    state
        .runner
        .system_apply_attention_update(request)
        .map_err(to_client_error)
}

#[tauri::command]
fn system_generate_decision_cards(
    state: tauri::State<'_, AppState>,
    request: DecisionGenerateRequest,
) -> Result<DecisionGenerateResponse, String> {
    state
        .runner
        .system_generate_decision_cards(request)
        .map_err(to_client_error)
}

#[tauri::command]
fn notification_channels_list(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    state
        .runner
        .notification_channels_list()
        .map_err(to_client_error)
}

#[tauri::command]
fn notification_send(
    state: tauri::State<'_, AppState>,
    message: NotificationMutationPayload,
) -> Result<NotificationMessage, String> {
    state.runner.notification_send(message).map_err(to_client_error)
}

#[tauri::command]
fn notification_deliveries_list(
    state: tauri::State<'_, AppState>,
    status: Option<String>,
    channel: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<NotificationDeliveryRecord>, String> {
    state
        .runner
        .notification_deliveries_list(status, channel, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn projections_list(
    state: tauri::State<'_, AppState>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<ProjectionDefinition>, String> {
    state
        .runner
        .projections_list(limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn projection_get(
    state: tauri::State<'_, AppState>,
    projection_id: String,
) -> Result<Option<ProjectionDefinition>, String> {
    state
        .runner
        .projection_get(&projection_id)
        .map_err(to_client_error)
}

#[tauri::command]
fn projection_save(
    state: tauri::State<'_, AppState>,
    projection: ProjectionMutationPayload,
) -> Result<ProjectionDefinition, String> {
    state
        .runner
        .projection_save(projection)
        .map_err(to_client_error)
}

#[tauri::command]
fn projection_checkpoint_get(
    state: tauri::State<'_, AppState>,
    projection_id: String,
) -> Result<ProjectionCheckpoint, String> {
    state
        .runner
        .projection_checkpoint_get(&projection_id)
        .map_err(to_client_error)
}

#[tauri::command]
fn projection_refresh(
    state: tauri::State<'_, AppState>,
    projection_id: String,
    mode: Option<String>,
    idempotency_key: Option<String>,
) -> Result<ProjectionCheckpoint, String> {
    state
        .runner
        .projection_refresh(&projection_id, mode, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn projection_rebuild(
    state: tauri::State<'_, AppState>,
    projection_ids: Option<Vec<String>>,
    idempotency_key: Option<String>,
) -> Result<ProjectionRebuildResponse, String> {
    state
        .runner
        .projection_rebuild(projection_ids, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn registry_entries_list(
    state: tauri::State<'_, AppState>,
    kind: Option<String>,
    status: Option<String>,
    search: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<PageResponse<RegistryEntry>, String> {
    state
        .runner
        .registry_entries_list(kind, status, search, limit, cursor)
        .map_err(to_client_error)
}

#[tauri::command]
fn registry_entry_get(
    state: tauri::State<'_, AppState>,
    entry_id: String,
) -> Result<Option<RegistryEntry>, String> {
    state
        .runner
        .registry_entry_get(&entry_id)
        .map_err(to_client_error)
}

#[tauri::command]
fn registry_entry_save(
    state: tauri::State<'_, AppState>,
    entry: RegistryMutationPayload,
) -> Result<RegistryEntry, String> {
    state
        .runner
        .registry_entry_save(entry)
        .map_err(to_client_error)
}

#[tauri::command]
fn registry_entry_update(
    state: tauri::State<'_, AppState>,
    entry_id: String,
    patch: RegistryMutationPayload,
) -> Result<RegistryEntry, String> {
    state
        .runner
        .registry_entry_update(&entry_id, patch)
        .map_err(to_client_error)
}

#[tauri::command]
fn registry_entry_delete(
    state: tauri::State<'_, AppState>,
    entry_id: String,
    idempotency_key: Option<String>,
) -> Result<BooleanResponse, String> {
    state
        .runner
        .registry_entry_delete(&entry_id, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn registry_suggestions_list(
    state: tauri::State<'_, AppState>,
    text: String,
    kind: Option<String>,
) -> Result<RegistrySuggestionsResponse, String> {
    state
        .runner
        .registry_suggestions_list(text, kind)
        .map_err(to_client_error)
}

#[tauri::command]
fn semantic_search(
    state: tauri::State<'_, AppState>,
    request: SemanticSearchRequest,
) -> Result<SemanticSearchResponse, String> {
    state
        .runner
        .semantic_search(request)
        .map_err(to_client_error)
}

#[tauri::command]
fn semantic_reindex(
    state: tauri::State<'_, AppState>,
    atom_ids: Option<Vec<String>>,
    idempotency_key: Option<String>,
) -> Result<SemanticReindexResponse, String> {
    state
        .runner
        .semantic_reindex(atom_ids, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn semantic_chunk_get(
    state: tauri::State<'_, AppState>,
    chunk_id: String,
) -> Result<Option<SemanticChunk>, String> {
    state
        .runner
        .semantic_chunk_get(&chunk_id)
        .map_err(to_client_error)
}

#[tauri::command]
fn governance_policies_get(state: tauri::State<'_, AppState>) -> Result<GovernancePoliciesResponse, String> {
    state
        .runner
        .governance_policies_get()
        .map_err(to_client_error)
}

#[tauri::command]
fn atom_governance_update(
    state: tauri::State<'_, AppState>,
    atom_id: String,
    expected_revision: i64,
    governance: GovernanceMeta,
    idempotency_key: Option<String>,
) -> Result<AtomRecord, String> {
    state
        .runner
        .atom_governance_update(&atom_id, expected_revision, governance, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn feature_flags_list(state: tauri::State<'_, AppState>) -> Result<Vec<FeatureFlag>, String> {
    state
        .runner
        .feature_flags_list()
        .map_err(to_client_error)
}

#[tauri::command]
fn feature_flag_update(
    state: tauri::State<'_, AppState>,
    key: String,
    enabled: bool,
    rollout_percent: Option<u32>,
    idempotency_key: Option<String>,
) -> Result<FeatureFlag, String> {
    state
        .runner
        .feature_flag_update(&key, enabled, rollout_percent, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn capability_snapshot_get(state: tauri::State<'_, AppState>) -> Result<WorkspaceCapabilitySnapshot, String> {
    state
        .runner
        .capability_snapshot_get()
        .map_err(to_client_error)
}

#[tauri::command]
fn migration_plan_create(
    state: tauri::State<'_, AppState>,
    domain: String,
    from_version: i32,
    to_version: i32,
    dry_run: bool,
    idempotency_key: Option<String>,
) -> Result<MigrationPlan, String> {
    state
        .runner
        .migration_plan_create(domain, from_version, to_version, dry_run, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn migration_run_start(
    state: tauri::State<'_, AppState>,
    plan_id: String,
    idempotency_key: Option<String>,
) -> Result<MigrationRun, String> {
    state
        .runner
        .migration_run_start(&plan_id, idempotency_key)
        .map_err(to_client_error)
}

#[tauri::command]
fn migration_run_get(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<Option<MigrationRun>, String> {
    state
        .runner
        .migration_run_get(&run_id)
        .map_err(to_client_error)
}

#[tauri::command]
fn migration_run_rollback(
    state: tauri::State<'_, AppState>,
    run_id: String,
    reason: Option<String>,
    idempotency_key: Option<String>,
) -> Result<MigrationRun, String> {
    state
        .runner
        .migration_run_rollback(&run_id, reason, idempotency_key)
        .map_err(to_client_error)
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
            get_metric_diagnostics,
            bind_metric_to_screen,
            unbind_metric_from_screen,
            reorder_screen_metrics,
            update_screen_metric_layout,
            get_screen_metrics,
            refresh_metric,
            refresh_screen_metrics,
            workspace_capabilities_get,
            workspace_health_get,
            obsidian_tasks_sync,
            atoms_list,
            atom_get,
            atom_create,
            atom_update,
            task_status_set,
            task_complete,
            task_reopen,
            atom_archive,
            atom_delete,
            atom_unarchive,
            notepads_list,
            notepad_get,
            notepad_save,
            notepad_delete,
            notepad_atoms_list,
            notepad_block_create,
            blocks_list,
            block_get,
            placements_list,
            placement_save,
            placement_delete,
            placements_reorder,
            conditions_list,
            condition_get,
            condition_set_date,
            condition_set_person,
            condition_set_task,
            condition_followup_log,
            condition_resolve,
            condition_cancel,
            events_list,
            atom_events_list,
            classification_preview,
            atom_classify,
            rules_list,
            rule_get,
            rule_save,
            rule_update,
            rule_evaluate,
            jobs_list,
            job_get,
            job_save,
            job_update,
            job_run,
            job_runs_list,
            job_run_get,
            decisions_list,
            decision_create,
            decision_get,
            decision_resolve,
            decision_snooze,
            decision_dismiss,
            work_sessions_list,
            work_session_get,
            work_session_start,
            work_session_note,
            work_session_end,
            work_session_cancel,
            recurrence_templates_list,
            recurrence_template_get,
            recurrence_template_save,
            recurrence_template_update,
            recurrence_instances_list,
            recurrence_spawn,
            system_apply_attention_update,
            system_generate_decision_cards,
            notification_channels_list,
            notification_send,
            notification_deliveries_list,
            projections_list,
            projection_get,
            projection_save,
            projection_checkpoint_get,
            projection_refresh,
            projection_rebuild,
            registry_entries_list,
            registry_entry_get,
            registry_entry_save,
            registry_entry_update,
            registry_entry_delete,
            registry_suggestions_list,
            semantic_search,
            semantic_reindex,
            semantic_chunk_get,
            governance_policies_get,
            atom_governance_update,
            feature_flags_list,
            feature_flag_update,
            capability_snapshot_get,
            migration_plan_create,
            migration_run_start,
            migration_run_get,
            migration_run_rollback
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

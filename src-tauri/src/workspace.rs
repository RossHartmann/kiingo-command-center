use crate::errors::{AppError, AppResult};
use crate::models::{
    ArchiveAtomRequest, AtomFacets, AtomRecord, AtomRelations, BodyPatch, BooleanResponse,
    BlockRecord, CreateBlockInNotepadRequest,
    ClassificationResult, ClassificationSource, CreateAtomRequest, EncryptionScope, FacetKind,
    DeleteAtomRequest,
    ConditionCancelRequest, ConditionFollowupRequest, ConditionRecord, ConditionResolveRequest,
    ConditionSetDateRequest, ConditionSetPersonRequest, ConditionSetTaskRequest, GovernanceMeta, ListAtomsRequest,
    ListBlocksRequest, ListConditionsRequest, ListEventsRequest, ListPlacementsRequest, NotepadFilter,
    NotepadSort, NotepadViewDefinition, PageResponse, PlacementRecord, PlacementReorderRequest,
    SaveNotepadViewRequest, SensitivityLevel, SetTaskStatusRequest, TaskFacet, TaskReopenRequest,
    TaskStatus, UpdateAtomRequest, WorkspaceCapabilities, WorkspaceEventRecord, WorkspaceHealth,
    AtomRelationsPatch, AttentionUpdateRequest, AttentionUpdateResponse, DecisionGenerateRequest,
    DecisionGenerateResponse, DecisionMutationPayload, DecisionPrompt, FeatureFlag, GovernancePoliciesResponse,
    JobDefinition, JobMutationPayload, JobRunRecord, MigrationPlan, MigrationRun, NotificationDeliveryRecord,
    NotificationMessage, NotificationMutationPayload, ProjectionCheckpoint, ProjectionDefinition,
    ProjectionMutationPayload, ProjectionRebuildResponse, RegistryEntry, RegistryMutationPayload,
    RecurrenceInstance, RecurrenceSpawnRequest, RecurrenceSpawnResponse, RecurrenceTemplate,
    RegistrySuggestionsResponse, RuleDefinition, RuleEvaluateRequest, RuleEvaluationResult, RuleMutationPayload,
    SemanticChunk, SemanticReindexResponse, SemanticSearchHit, SemanticSearchRequest, SemanticSearchResponse,
    WorkSessionCancelRequest, WorkSessionEndRequest, WorkSessionNoteRequest, WorkSessionRecord,
    WorkSessionStartRequest, WorkspaceCapabilitySnapshot, WorkspaceMutationPayload, ObsidianTaskSyncResult,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc, Weekday};
use once_cell::sync::Lazy;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::cmp::Ordering;
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::Mutex;
use std::time::Duration;
use wait_timeout::ChildExt;
use uuid::Uuid;

const ROOT_DIRS: &[&str] = &[
    "atoms/active",
    "atoms/done",
    "atoms/archive",
    "blocks/active",
    "blocks/completed",
    "blocks/archived",
    "placements/by-view",
    "conditions/active",
    "conditions/history",
    "notepads",
    "events",
    "threads",
    "categories",
    "sessions/work",
    "recurrence/templates",
    "recurrence/instances",
    "prompts/pending",
    "prompts/resolved",
    "rules/definitions",
    "jobs/schedules",
    "jobs/runs",
    "projections/manifests",
    "projections/snapshots",
    "semantic/index",
    "semantic/chunks",
    "governance",
    "migrations/schema",
    "migrations/projections",
    "migrations/rules",
    "migrations/plans",
    "migrations/runs",
    "bases",
    "idempotency",
    "notifications/messages",
    "notifications/deliveries",
    "registry",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdempotencyRecord {
    payload: Value,
    result: Value,
    created_at: DateTime<Utc>,
}

const OBSIDIAN_CLI_TIMEOUT_MS: u64 = 5_000;
static MARKDOWN_TASK_RE: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"^\s*[-*]\s+\[( |x|X)\]\s+(.+?)\s*$").expect("valid markdown task regex")
});
static OBSIDIAN_CLI_WRITE_CIRCUIT_OPEN: AtomicBool = AtomicBool::new(false);
static CLI_WRITE_SUPPRESSION_DEPTH: AtomicUsize = AtomicUsize::new(0);
static OBSIDIAN_CLI_WRITE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

struct CliWriteSuppressionGuard;

impl Drop for CliWriteSuppressionGuard {
    fn drop(&mut self) {
        CLI_WRITE_SUPPRESSION_DEPTH.fetch_sub(1, AtomicOrdering::SeqCst);
    }
}

fn suppress_obsidian_cli_writes() -> CliWriteSuppressionGuard {
    CLI_WRITE_SUPPRESSION_DEPTH.fetch_add(1, AtomicOrdering::SeqCst);
    CliWriteSuppressionGuard
}

fn obsidian_cli_writes_suppressed() -> bool {
    CLI_WRITE_SUPPRESSION_DEPTH.load(AtomicOrdering::SeqCst) > 0
}

pub fn capabilities(root: &Path) -> AppResult<WorkspaceCapabilities> {
    ensure_topology(root)?;
    Ok(WorkspaceCapabilities {
        obsidian_cli_available: detect_obsidian_cli(),
        base_query_available: false,
        selected_vault: detect_obsidian_vault_name().or_else(|| Some(root.to_string_lossy().to_string())),
        supported_commands: vec![
            "workspace_capabilities_get".to_string(),
            "workspace_health_get".to_string(),
            "obsidian_tasks_sync".to_string(),
            "atoms_list".to_string(),
            "atom_get".to_string(),
            "atom_create".to_string(),
            "atom_update".to_string(),
            "task_status_set".to_string(),
            "atom_archive".to_string(),
            "atom_delete".to_string(),
            "atom_unarchive".to_string(),
            "task_complete".to_string(),
            "task_reopen".to_string(),
            "notepads_list".to_string(),
            "notepad_get".to_string(),
            "notepad_save".to_string(),
            "notepad_delete".to_string(),
            "notepad_atoms_list".to_string(),
            "notepad_block_create".to_string(),
            "blocks_list".to_string(),
            "block_get".to_string(),
            "placements_list".to_string(),
            "placement_save".to_string(),
            "placement_delete".to_string(),
            "placements_reorder".to_string(),
            "conditions_list".to_string(),
            "condition_get".to_string(),
            "condition_set_date".to_string(),
            "condition_set_person".to_string(),
            "condition_set_task".to_string(),
            "condition_followup_log".to_string(),
            "condition_resolve".to_string(),
            "condition_cancel".to_string(),
            "events_list".to_string(),
            "atom_events_list".to_string(),
            "classification_preview".to_string(),
            "atom_classify".to_string(),
            "work_sessions_list".to_string(),
            "work_session_get".to_string(),
            "work_session_start".to_string(),
            "work_session_note".to_string(),
            "work_session_end".to_string(),
            "work_session_cancel".to_string(),
            "recurrence_templates_list".to_string(),
            "recurrence_template_get".to_string(),
            "recurrence_template_save".to_string(),
            "recurrence_template_update".to_string(),
            "recurrence_instances_list".to_string(),
            "recurrence_spawn".to_string(),
            "system_apply_attention_update".to_string(),
            "system_generate_decision_cards".to_string(),
            "rules_list".to_string(),
            "rule_get".to_string(),
            "rule_save".to_string(),
            "rule_update".to_string(),
            "rule_evaluate".to_string(),
            "jobs_list".to_string(),
            "job_get".to_string(),
            "job_save".to_string(),
            "job_update".to_string(),
            "job_run".to_string(),
            "job_runs_list".to_string(),
            "job_run_get".to_string(),
            "decisions_list".to_string(),
            "decision_create".to_string(),
            "decision_get".to_string(),
            "decision_resolve".to_string(),
            "decision_snooze".to_string(),
            "decision_dismiss".to_string(),
            "notification_channels_list".to_string(),
            "notification_send".to_string(),
            "notification_deliveries_list".to_string(),
            "projections_list".to_string(),
            "projection_get".to_string(),
            "projection_save".to_string(),
            "projection_checkpoint_get".to_string(),
            "projection_refresh".to_string(),
            "projection_rebuild".to_string(),
            "registry_entries_list".to_string(),
            "registry_entry_get".to_string(),
            "registry_entry_save".to_string(),
            "registry_entry_update".to_string(),
            "registry_entry_delete".to_string(),
            "registry_suggestions_list".to_string(),
            "semantic_search".to_string(),
            "semantic_reindex".to_string(),
            "semantic_chunk_get".to_string(),
            "governance_policies_get".to_string(),
            "atom_governance_update".to_string(),
            "feature_flags_list".to_string(),
            "feature_flag_update".to_string(),
            "capability_snapshot_get".to_string(),
            "migration_plan_create".to_string(),
            "migration_run_start".to_string(),
            "migration_run_get".to_string(),
            "migration_run_rollback".to_string(),
        ],
    })
}

pub fn detect_obsidian_command_center_root() -> Option<PathBuf> {
    let vault_path = detect_obsidian_vault_path()?;
    Some(vault_path.join("command-center"))
}

pub fn health(root: &Path) -> AppResult<WorkspaceHealth> {
    ensure_topology(root)?;
    let last = latest_event_timestamp(root)?;
    Ok(WorkspaceHealth {
        adapter_healthy: true,
        vault_accessible: root.is_dir(),
        last_successful_command_at: last,
        message: None,
    })
}

#[derive(Debug, Clone)]
struct ImportedObsidianTask {
    source_ref: String,
    raw_text: String,
    title: String,
    status: TaskStatus,
}

pub fn obsidian_tasks_sync(root: &Path) -> AppResult<ObsidianTaskSyncResult> {
    ensure_topology(root)?;
    let vault_root = detect_obsidian_vault_path().ok_or_else(|| {
        AppError::Policy(
            "Obsidian vault path unavailable. Ensure Obsidian is configured with an open/default vault.".to_string(),
        )
    })?;
    obsidian_tasks_sync_for_vault(root, &vault_root)
}

fn obsidian_tasks_sync_for_vault(root: &Path, vault_root: &Path) -> AppResult<ObsidianTaskSyncResult> {
    let _suppress_cli_writes = suppress_obsidian_cli_writes();
    let (candidates, scanned_files) = collect_importable_obsidian_tasks(root, vault_root)?;
    let discovered_tasks = candidates.len();
    let now = Utc::now();

    let atoms = load_all_atoms(root)?;
    let mut imported_by_source: HashMap<String, AtomRecord> = HashMap::new();
    let mut existing_ids: HashSet<String> = HashSet::new();
    for atom in atoms {
        existing_ids.insert(atom.id.clone());
        if atom.governance.origin == "imported" {
            if let Some(source_ref) = atom.governance.source_ref.clone() {
                if source_ref.starts_with("obsidian:") {
                    imported_by_source.insert(source_ref, atom);
                }
            }
        }
    }

    let mut created_atoms = 0usize;
    let mut updated_atoms = 0usize;
    let mut unchanged_atoms = 0usize;
    let mut archived_atoms = 0usize;
    let mut seen_sources = HashSet::new();

    for candidate in candidates {
        seen_sources.insert(candidate.source_ref.clone());
        if let Some(mut atom) = imported_by_source.remove(&candidate.source_ref) {
            let previous_status = atom_status(&atom);
            let changed = apply_imported_task_candidate(&mut atom, &candidate, now);
            if changed {
                atom.revision += 1;
                atom.updated_at = now;
                write_atom(root, Some(previous_status), &atom)?;
                let block = upsert_block_from_atom(root, &atom)?;
                let _ = ensure_placement_for_view(root, &block.id, "now", None)?;
                updated_atoms += 1;
            } else {
                unchanged_atoms += 1;
            }
            existing_ids.insert(atom.id.clone());
            continue;
        }

        let atom_id = next_imported_atom_id(&candidate.source_ref, &existing_ids);
        existing_ids.insert(atom_id.clone());
        let atom = AtomRecord {
            id: atom_id.clone(),
            schema_version: 1,
            created_at: now,
            updated_at: now,
            raw_text: candidate.raw_text.clone(),
            capture_source: crate::models::CaptureSource::Import,
            facets: vec![FacetKind::Task],
            facet_data: AtomFacets {
                task: Some(TaskFacet {
                    title: candidate.title.clone(),
                    status: candidate.status,
                    priority: 3,
                    completed_at: if candidate.status == TaskStatus::Done {
                        Some(now)
                    } else {
                        None
                    },
                    ..TaskFacet::default()
                }),
                ..AtomFacets::default()
            },
            relations: AtomRelations::default(),
            governance: GovernanceMeta {
                origin: "imported".to_string(),
                source_ref: Some(candidate.source_ref.clone()),
                ..default_governance()
            },
            body: None,
            revision: 1,
            archived_at: None,
        };
        write_atom(root, None, &atom)?;
        append_event(
            root,
            build_event(
                "atom.created",
                Some(&atom.id),
                json!({"atom": atom.clone(), "importedFrom": candidate.source_ref}),
            ),
        )?;
        let block = upsert_block_from_atom(root, &atom)?;
        let _ = ensure_placement_for_view(root, &block.id, "now", None)?;
        created_atoms += 1;
    }

    for mut atom in imported_by_source.into_values() {
        if seen_sources.contains(atom.governance.source_ref.as_deref().unwrap_or_default()) {
            continue;
        }
        if atom.archived_at.is_some()
            && atom
                .facet_data
                .task
                .as_ref()
                .map(|task| task.status == TaskStatus::Archived)
                .unwrap_or(false)
        {
            continue;
        }
        let previous_status = atom_status(&atom);
        upsert_task_facet(&mut atom);
        if let Some(task) = atom.facet_data.task.as_mut() {
            task.status = TaskStatus::Archived;
        }
        atom.archived_at = Some(now);
        atom.revision += 1;
        atom.updated_at = now;
        write_atom(root, Some(previous_status), &atom)?;
        append_event(
            root,
            build_event(
                "atom.archived",
                Some(&atom.id),
                json!({"reason": "obsidian_task_removed"}),
            ),
        )?;
        let _ = upsert_block_from_atom(root, &atom)?;
        archived_atoms += 1;
    }

    let result = ObsidianTaskSyncResult {
        vault_path: vault_root.to_string_lossy().to_string(),
        scanned_files,
        discovered_tasks,
        created_atoms,
        updated_atoms,
        unchanged_atoms,
        archived_atoms,
    };
    append_event(
        root,
        build_event(
            "obsidian.tasks.synced",
            None,
            json!({
                "vaultPath": result.vault_path,
                "scannedFiles": result.scanned_files,
                "discoveredTasks": result.discovered_tasks,
                "createdAtoms": result.created_atoms,
                "updatedAtoms": result.updated_atoms,
                "unchangedAtoms": result.unchanged_atoms,
                "archivedAtoms": result.archived_atoms
            }),
        ),
    )?;

    Ok(result)
}

fn apply_imported_task_candidate(
    atom: &mut AtomRecord,
    candidate: &ImportedObsidianTask,
    now: DateTime<Utc>,
) -> bool {
    let mut changed = false;
    if atom.raw_text != candidate.raw_text {
        atom.raw_text = candidate.raw_text.clone();
        changed = true;
    }
    if atom.capture_source != crate::models::CaptureSource::Import {
        atom.capture_source = crate::models::CaptureSource::Import;
        changed = true;
    }
    if !atom.facets.contains(&FacetKind::Task) {
        atom.facets.push(FacetKind::Task);
        changed = true;
    }
    if atom.governance.origin != "imported" {
        atom.governance.origin = "imported".to_string();
        changed = true;
    }
    if atom.governance.source_ref.as_deref() != Some(candidate.source_ref.as_str()) {
        atom.governance.source_ref = Some(candidate.source_ref.clone());
        changed = true;
    }
    upsert_task_facet(atom);
    if let Some(task) = atom.facet_data.task.as_mut() {
        if task.title != candidate.title {
            task.title = candidate.title.clone();
            changed = true;
        }
        if task.status != candidate.status {
            task.status = candidate.status;
            changed = true;
        }
        if candidate.status == TaskStatus::Done {
            if task.completed_at.is_none() {
                task.completed_at = Some(now);
                changed = true;
            }
        } else if task.completed_at.is_some() {
            task.completed_at = None;
            changed = true;
        }
    }
    if candidate.status == TaskStatus::Archived {
        if atom.archived_at.is_none() {
            atom.archived_at = Some(now);
            changed = true;
        }
    } else if atom.archived_at.is_some() {
        atom.archived_at = None;
        changed = true;
    }
    changed
}

fn next_imported_atom_id(source_ref: &str, existing_ids: &HashSet<String>) -> String {
    let base = format!("atom_import_{:016x}", stable_hash_64(source_ref));
    if !existing_ids.contains(&base) {
        return base;
    }
    let mut idx = 1usize;
    loop {
        let candidate = format!("{}_{}", base, idx);
        if !existing_ids.contains(&candidate) {
            return candidate;
        }
        idx += 1;
    }
}

fn stable_hash_64(input: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn collect_importable_obsidian_tasks(
    command_center_root: &Path,
    vault_root: &Path,
) -> AppResult<(Vec<ImportedObsidianTask>, usize)> {
    let mut scanned_files = 0usize;
    let mut tasks = Vec::new();
    if !command_center_root.is_dir() {
        return Ok((tasks, scanned_files));
    }
    let mut stack = vec![command_center_root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|error| AppError::Io(error.to_string()))? {
            let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default();
                if name.eq_ignore_ascii_case(".obsidian") || name.eq_ignore_ascii_case(".git") {
                    continue;
                }
                if is_command_center_system_path(command_center_root, &path) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|value| value.to_str()) != Some("md") {
                continue;
            }
            if is_command_center_system_path(command_center_root, &path) {
                continue;
            }

            scanned_files += 1;
            let content = match fs::read_to_string(&path) {
                Ok(value) => value,
                Err(error) => {
                    tracing::warn!(path = %path.to_string_lossy(), error = %error, "skipping unreadable vault note during task sync");
                    continue;
                }
            };
            let rel = path
                .strip_prefix(vault_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            parse_importable_tasks_from_markdown(&rel, &content, &mut tasks);
        }
    }

    Ok((tasks, scanned_files))
}

fn is_command_center_system_path(command_center_root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(command_center_root) else {
        return false;
    };
    let Some(first) = rel.components().next() else {
        return false;
    };
    let first = first.as_os_str().to_string_lossy();
    matches!(
        first.as_ref(),
        "atoms"
            | "blocks"
            | "placements"
            | "conditions"
            | "notepads"
            | "events"
            | "threads"
            | "categories"
            | "sessions"
            | "recurrence"
            | "prompts"
            | "rules"
            | "jobs"
            | "projections"
            | "semantic"
            | "governance"
            | "migrations"
            | "bases"
            | "idempotency"
            | "notifications"
            | "registry"
    )
}

fn parse_importable_tasks_from_markdown(
    rel_path: &str,
    content: &str,
    out: &mut Vec<ImportedObsidianTask>,
) {
    let mut lines = content.lines().enumerate();
    let mut in_frontmatter = false;
    if let Some((_, first_line)) = lines.next() {
        if first_line.trim() == "---" {
            in_frontmatter = true;
        } else {
            parse_importable_task_line(rel_path, 1, first_line, out);
        }
    }

    for (index, line) in lines {
        let line_no = index + 1;
        if in_frontmatter {
            let trimmed = line.trim();
            if trimmed == "---" || trimmed == "..." {
                in_frontmatter = false;
            }
            continue;
        }
        parse_importable_task_line(rel_path, line_no, line, out);
    }
}

fn parse_importable_task_line(
    rel_path: &str,
    line_no: usize,
    line: &str,
    out: &mut Vec<ImportedObsidianTask>,
) {
    let Some(captures) = MARKDOWN_TASK_RE.captures(line) else {
        return;
    };
    let marker = captures.get(1).map(|value| value.as_str()).unwrap_or(" ");
    let text = captures
        .get(2)
        .map(|value| value.as_str().trim())
        .unwrap_or_default();
    if text.is_empty() {
        return;
    }
    let done = marker.eq_ignore_ascii_case("x");
    let raw_text = if done {
        format!("- [x] {}", text)
    } else {
        format!("- [ ] {}", text)
    };
    out.push(ImportedObsidianTask {
        source_ref: format!("obsidian:{}#L{}", rel_path, line_no),
        raw_text: raw_text.clone(),
        title: derive_title(&raw_text),
        status: if done { TaskStatus::Done } else { TaskStatus::Todo },
    });
}

pub fn atoms_list(root: &Path, request: ListAtomsRequest) -> AppResult<PageResponse<AtomRecord>> {
    ensure_topology(root)?;

    let mut atoms = load_all_atoms(root)?;
    apply_atom_filter(&mut atoms, request.filter.as_ref());
    sort_atoms(&mut atoms, request.sort.as_ref());

    paginate(atoms, request.limit, request.cursor)
}

pub fn atom_get(root: &Path, atom_id: &str) -> AppResult<Option<AtomRecord>> {
    ensure_topology(root)?;
    let Some(path) = find_atom_path(root, atom_id)? else {
        return Ok(None);
    };
    read_atom_file(root, &path).map(Some)
}

pub fn atom_create(root: &Path, request: CreateAtomRequest) -> AppResult<AtomRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(root, "atom.create", key.as_deref(), &request, || atom_create_inner(root, request.clone()))
}

pub fn atom_update(root: &Path, atom_id: &str, request: UpdateAtomRequest) -> AppResult<AtomRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "atom.update",
        key.as_deref(),
        &json!({"atomId": atom_id, "request": &request}),
        || atom_update_inner(root, atom_id, request.clone()),
    )
}

pub fn atom_archive(root: &Path, atom_id: &str, request: ArchiveAtomRequest) -> AppResult<AtomRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "atom.archive",
        key.as_deref(),
        &json!({"atomId": atom_id, "request": &request}),
        || atom_archive_inner(root, atom_id, request.clone()),
    )
}

pub fn atom_delete(root: &Path, atom_id: &str, request: DeleteAtomRequest) -> AppResult<BooleanResponse> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "atom.delete",
        key.as_deref(),
        &json!({"atomId": atom_id, "request": &request}),
        || atom_delete_inner(root, atom_id, request.clone()),
    )
}

pub fn atom_unarchive(
    root: &Path,
    atom_id: &str,
    expected_revision: i64,
    idempotency_key: Option<String>,
) -> AppResult<AtomRecord> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "atom.unarchive",
        key.as_deref(),
        &json!({"atomId": atom_id, "expectedRevision": expected_revision}),
        || atom_unarchive_inner(root, atom_id, expected_revision),
    )
}

fn atom_unarchive_inner(root: &Path, atom_id: &str, expected_revision: i64) -> AppResult<AtomRecord> {
    let mut atom = get_required_atom(root, atom_id)?;
    assert_revision(&atom, expected_revision)?;

    let previous_status = atom_status(&atom);
    let now = Utc::now();

    atom.archived_at = None;
    upsert_task_facet(&mut atom);
    if let Some(task) = atom.facet_data.task.as_mut() {
        if task.status == TaskStatus::Archived {
            task.status = TaskStatus::Todo;
        }
    }
    atom.revision += 1;
    atom.updated_at = now;

    write_atom(root, Some(previous_status), &atom)?;
    append_event(root, build_event("atom.updated", Some(&atom.id), json!({"atom": atom.clone()})))?;
    let _ = upsert_block_from_atom(root, &atom)?;

    Ok(atom)
}

fn atom_delete_inner(root: &Path, atom_id: &str, request: DeleteAtomRequest) -> AppResult<BooleanResponse> {
    let atom = get_required_atom(root, atom_id)?;
    assert_revision(&atom, request.expected_revision)?;
    if atom.archived_at.is_none() {
        return Err(AppError::Policy(
            "POLICY_DENIED: atom_delete requires atom to be archived".to_string(),
        ));
    }
    if !atom_has_no_meaningful_content(&atom) {
        return Err(AppError::Policy(
            "POLICY_DENIED: atom_delete only permits archived atoms with no text/body content".to_string(),
        ));
    }

    let mut block_ids: HashSet<String> = load_all_blocks(root)?
        .into_iter()
        .filter(|block| block.atom_id.as_deref() == Some(atom_id))
        .map(|block| block.id)
        .collect();
    if block_ids.is_empty() {
        block_ids.insert(block_id_for_atom(atom_id));
    }

    let placements: Vec<PlacementRecord> = list_json_entities(root, "placements/by-view")?
        .into_iter()
        .map(|value| deserialize_entity(value, "placement"))
        .collect::<AppResult<Vec<_>>>()?;
    for placement in placements
        .iter()
        .filter(|placement| block_ids.contains(&placement.block_id))
    {
        let path = json_entity_path(root, "placements/by-view", &placement.id);
        if path.exists() {
            fs::remove_file(&path).map_err(|error| AppError::Io(error.to_string()))?;
            append_event(
                root,
                build_event(
                    "placement.deleted",
                    None,
                    json!({"placementId": placement.id, "previous": placement}),
                ),
            )?;
        }
    }

    for block_id in block_ids {
        for rel in ["blocks/active", "blocks/completed", "blocks/archived"] {
            let path = json_entity_path(root, rel, &block_id);
            if path.exists() {
                fs::remove_file(path).map_err(|error| AppError::Io(error.to_string()))?;
            }
        }
    }

    if let Some(path) = find_atom_path(root, atom_id)? {
        if path.exists() {
            fs::remove_file(path).map_err(|error| AppError::Io(error.to_string()))?;
        }
    } else {
        return Ok(BooleanResponse { success: false });
    }

    append_event(
        root,
        build_event(
            "atom.deleted",
            Some(atom_id),
            json!({"reason": request.reason}),
        ),
    )?;

    Ok(BooleanResponse { success: true })
}

pub fn task_status_set(root: &Path, atom_id: &str, request: SetTaskStatusRequest) -> AppResult<AtomRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "task.status_set",
        key.as_deref(),
        &json!({"atomId": atom_id, "request": &request}),
        || task_status_set_inner(root, atom_id, request.clone()),
    )
}

pub fn task_complete(
    root: &Path,
    atom_id: &str,
    expected_revision: i64,
    idempotency_key: Option<String>,
) -> AppResult<AtomRecord> {
    task_status_set(
        root,
        atom_id,
        SetTaskStatusRequest {
            expected_revision,
            idempotency_key,
            status: TaskStatus::Done,
            reason: None,
        },
    )
}

pub fn task_reopen(root: &Path, atom_id: &str, request: TaskReopenRequest) -> AppResult<AtomRecord> {
    task_status_set(
        root,
        atom_id,
        SetTaskStatusRequest {
            expected_revision: request.expected_revision,
            idempotency_key: request.idempotency_key,
            status: request.status.unwrap_or(TaskStatus::Todo),
            reason: Some("reopen".to_string()),
        },
    )
}

pub fn notepads_list(root: &Path) -> AppResult<Vec<NotepadViewDefinition>> {
    ensure_topology(root)?;
    ensure_now_notepad(root)?;

    let mut items = Vec::new();
    for entry in fs::read_dir(root.join("notepads")).map_err(|error| AppError::Io(error.to_string()))? {
        let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
        let path = entry.path();
        if !is_workspace_doc_file(&path) {
            continue;
        }
        match read_notepad_file(root, &path) {
            Ok(value) => items.push(value),
            Err(error) => {
                tracing::warn!(path = %path.to_string_lossy(), error = %error, "skipping malformed notepad file");
            }
        }
    }

    if !items.iter().any(|item| item.id == "now") {
        let now = default_now_notepad(Utc::now());
        write_notepad_file(root, &notepad_path(root, "now"), &now)?;
        items.push(now);
    }

    items.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    Ok(items)
}

pub fn notepad_get(root: &Path, notepad_id: &str) -> AppResult<Option<NotepadViewDefinition>> {
    ensure_topology(root)?;
    ensure_now_notepad(root)?;

    let path = resolve_notepad_path(root, notepad_id);
    if !path.exists() {
        return Ok(None);
    }
    read_notepad_file(root, &path).map(Some)
}

pub fn notepad_save(root: &Path, request: SaveNotepadViewRequest) -> AppResult<NotepadViewDefinition> {
    ensure_topology(root)?;
    ensure_now_notepad(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(root, "notepad.save", key.as_deref(), &request, || {
        notepad_save_inner(root, request.clone())
    })
}

pub fn notepad_delete(
    root: &Path,
    notepad_id: &str,
    idempotency_key: Option<String>,
) -> AppResult<BooleanResponse> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "notepad.delete",
        key.as_deref(),
        &json!({"notepadId": notepad_id}),
        || {
            if notepad_id == "now" {
                return Err(AppError::Policy("Cannot delete system notepad 'now'".to_string()));
            }

            let path = resolve_notepad_path(root, notepad_id);
            if !path.exists() {
                return Ok(BooleanResponse { success: false });
            }

            fs::remove_file(path).map_err(|error| AppError::Io(error.to_string()))?;
            Ok(BooleanResponse { success: true })
        },
    )
}

pub fn notepad_atoms_list(
    root: &Path,
    notepad_id: &str,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<AtomRecord>> {
    ensure_topology(root)?;

    let notepad = notepad_get(root, notepad_id)?
        .ok_or_else(|| AppError::NotFound(format!("Notepad '{}' not found", notepad_id)))?;

    // Keep placement-backed views and filter-backed views in sync by ensuring every
    // current membership atom has a placement in this view.
    let mut membership_atoms = load_all_atoms(root)?;
    apply_atom_filter(&mut membership_atoms, Some(&notepad.filters));
    sort_atoms(&mut membership_atoms, Some(&notepad.sorts));

    backfill_blocks_from_atoms(root)?;
    let all_blocks = load_all_blocks(root)?;
    let mut block_id_by_atom_id: HashMap<String, String> = HashMap::new();
    for block in all_blocks {
        if let Some(atom_id) = block.atom_id {
            block_id_by_atom_id.insert(atom_id, block.id);
        }
    }

    let mut existing_block_ids: HashSet<String> = load_placements_for_view(root, notepad_id)?
        .into_iter()
        .map(|placement| placement.block_id)
        .collect();

    for atom in &membership_atoms {
        let block_id = if let Some(existing) = block_id_by_atom_id.get(&atom.id) {
            existing.clone()
        } else {
            let block = upsert_block_from_atom(root, atom)?;
            block_id_by_atom_id.insert(atom.id.clone(), block.id.clone());
            block.id
        };
        if existing_block_ids.contains(&block_id) {
            continue;
        }
        let placement = ensure_placement_for_view(root, &block_id, notepad_id, None)?;
        existing_block_ids.insert(placement.block_id);
    }

    let placements = load_placements_for_view(root, notepad_id)?;
    if !placements.is_empty() {
        let mut ranked: Vec<(usize, AtomRecord)> = Vec::new();
        for (index, placement) in placements.into_iter().enumerate() {
            let Some(block) = find_block(root, &placement.block_id)? else {
                continue;
            };
            let Some(atom_id) = block.atom_id else {
                continue;
            };
            let Some(atom) = atom_get(root, &atom_id)? else {
                continue;
            };
            ranked.push((index, atom));
        }
        let mut atoms = ranked.into_iter().map(|(_, atom)| atom).collect::<Vec<_>>();
        apply_atom_filter(&mut atoms, Some(&notepad.filters));
        return paginate(atoms, limit, cursor);
    }

    atoms_list(
        root,
        ListAtomsRequest {
            limit,
            cursor,
            filter: Some(notepad.filters),
            sort: Some(notepad.sorts),
        },
    )
}

pub fn notepad_block_create(
    root: &Path,
    request: CreateBlockInNotepadRequest,
) -> AppResult<BlockRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "notepad.block.create",
        key.as_deref(),
        &request,
        || notepad_block_create_inner(root, request.clone()),
    )
}

fn notepad_block_create_inner(
    root: &Path,
    request: CreateBlockInNotepadRequest,
) -> AppResult<BlockRecord> {
    let notepad = notepad_get(root, &request.notepad_id)?
        .ok_or_else(|| AppError::NotFound(format!("Notepad '{}' not found", request.notepad_id)))?;
    let capture_defaults = notepad.capture_defaults.clone().unwrap_or_default();

    let mut initial_facets = capture_defaults
        .initial_facets
        .clone()
        .unwrap_or_else(|| vec![FacetKind::Task]);
    if initial_facets.is_empty() {
        initial_facets.push(FacetKind::Task);
    }

    let task_status = capture_defaults.task_status.unwrap_or(TaskStatus::Todo);
    let task_priority = capture_defaults.task_priority.unwrap_or(3).clamp(1, 5);

    let task_facet = if initial_facets.contains(&FacetKind::Task) {
        Some(TaskFacet {
            title: derive_title(&request.raw_text),
            status: task_status,
            priority: task_priority,
            commitment_level: capture_defaults.commitment_level,
            attention_layer: capture_defaults.attention_layer,
            ..TaskFacet::default()
        })
    } else {
        None
    };

    let facet_data = AtomFacets {
        task: task_facet,
        meta: Some(crate::models::MetaFacet {
            labels: capture_defaults.labels.clone(),
            categories: capture_defaults.categories.clone(),
        }),
        ..AtomFacets::default()
    };

    let atom = atom_create_inner(
        root,
        CreateAtomRequest {
            raw_text: request.raw_text,
            body: request.body,
            capture_source: request.capture_source.unwrap_or_default(),
            initial_facets: Some(initial_facets),
            facet_data: Some(facet_data),
            relations: Some(AtomRelations {
                thread_ids: capture_defaults.thread_ids.unwrap_or_default(),
                ..AtomRelations::default()
            }),
            governance: None,
            idempotency_key: None,
        },
    )?;
    let block = upsert_block_from_atom(root, &atom)?;
    let _ = ensure_placement_for_view(root, &block.id, &notepad.id, None)?;
    Ok(block)
}

pub fn blocks_list(root: &Path, request: ListBlocksRequest) -> AppResult<PageResponse<BlockRecord>> {
    ensure_topology(root)?;
    backfill_blocks_from_atoms(root)?;
    let mut blocks = load_all_blocks(root)?;

    if let Some(atom_id) = request.atom_id.as_ref() {
        blocks.retain(|block| block.atom_id.as_deref() == Some(atom_id.as_str()));
    }
    if let Some(lifecycle) = request.lifecycle.as_ref() {
        blocks.retain(|block| block.lifecycle.eq_ignore_ascii_case(lifecycle));
    }
    if let Some(query) = request.text_query.as_ref().map(|value| value.to_ascii_lowercase()) {
        blocks.retain(|block| block.text.to_ascii_lowercase().contains(&query));
    }
    if let Some(notepad_id) = request.notepad_id.as_ref() {
        let ids: HashSet<String> = load_placements_for_view(root, notepad_id)?
            .into_iter()
            .map(|placement| placement.block_id)
            .collect();
        blocks.retain(|block| ids.contains(&block.id));
    }

    blocks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    paginate(blocks, request.limit, request.cursor)
}

pub fn block_get(root: &Path, block_id: &str) -> AppResult<Option<BlockRecord>> {
    ensure_topology(root)?;
    backfill_blocks_from_atoms(root)?;
    find_block(root, block_id)
}

pub fn placements_list(
    root: &Path,
    request: ListPlacementsRequest,
) -> AppResult<PageResponse<PlacementRecord>> {
    ensure_topology(root)?;
    let mut placements: Vec<PlacementRecord> = list_json_entities(root, "placements/by-view")?
        .into_iter()
        .map(|value| deserialize_entity(value, "placement"))
        .collect::<AppResult<Vec<_>>>()?;

    if let Some(view_id) = request.view_id.as_ref() {
        placements.retain(|placement| placement.view_id == *view_id);
    }
    if let Some(block_id) = request.block_id.as_ref() {
        placements.retain(|placement| placement.block_id == *block_id);
    }

    placements.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| a.order_key.cmp(&b.order_key))
            .then_with(|| a.id.cmp(&b.id))
    });
    paginate(placements, request.limit, request.cursor)
}

pub fn placement_save(root: &Path, placement: WorkspaceMutationPayload) -> AppResult<PlacementRecord> {
    ensure_topology(root)?;
    let mut placement = mutation_payload_to_value(placement);
    let idempotency_key = extract_required_idempotency_key(&mut placement, "placement.save")?;
    let expected_revision = pop_expected_revision(&mut placement);
    let payload = json!({"placement": placement, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "placement.save",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let object = get_object_mut(&mut placement)?;
            let view_id = object
                .get("viewId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Policy("VALIDATION_ERROR: placement viewId required".to_string()))?;
            let block_id = object
                .get("blockId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Policy("VALIDATION_ERROR: placement blockId required".to_string()))?;
            if !resolve_notepad_path(root, view_id).exists() {
                return Err(AppError::NotFound(format!("Notepad '{}' not found", view_id)));
            }
            if find_block(root, block_id)?.is_none() {
                return Err(AppError::NotFound(format!("Block '{}' not found", block_id)));
            }
            object
                .entry("schemaVersion".to_string())
                .or_insert_with(|| Value::from(1));
            object
                .entry("orderKey".to_string())
                .or_insert_with(|| Value::String(new_order_key(9_999)));
            object
                .entry("pinned".to_string())
                .or_insert_with(|| Value::Bool(false));
            let saved = upsert_json_entity(
                root,
                "placements/by-view",
                "placement",
                placement.clone(),
                expected_revision,
            )?;
            append_event(
                root,
                build_event("placement.saved", None, saved.clone()),
            )?;
            deserialize_entity(saved, "placement")
        },
    )
}

pub fn placement_delete(
    root: &Path,
    placement_id: &str,
    idempotency_key: Option<String>,
) -> AppResult<BooleanResponse> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "placement.delete",
        key.as_deref(),
        &json!({"placementId": placement_id}),
        || {
            let existing = get_json_entity(root, "placements/by-view", placement_id)?;
            let path = json_entity_path(root, "placements/by-view", placement_id);
            if !path.exists() {
                return Ok(BooleanResponse { success: false });
            }
            fs::remove_file(path).map_err(|error| AppError::Io(error.to_string()))?;
            append_event(
                root,
                build_event(
                    "placement.deleted",
                    None,
                    json!({"placementId": placement_id, "previous": existing}),
                ),
            )?;
            Ok(BooleanResponse { success: true })
        },
    )
}

pub fn placements_reorder(
    root: &Path,
    view_id: &str,
    request: PlacementReorderRequest,
) -> AppResult<Vec<PlacementRecord>> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "placements.reorder",
        key.as_deref(),
        &json!({
            "viewId": view_id,
            "orderedPlacementIds": request.ordered_placement_ids,
            "expectedRevisions": request.expected_revisions
        }),
        || placements_reorder_inner(root, view_id, request.clone()),
    )
}

fn placements_reorder_inner(
    root: &Path,
    view_id: &str,
    request: PlacementReorderRequest,
) -> AppResult<Vec<PlacementRecord>> {
    let mut by_id: HashMap<String, PlacementRecord> = load_placements_for_view(root, view_id)?
        .into_iter()
        .map(|placement| (placement.id.clone(), placement))
        .collect();

    if by_id.is_empty() {
        return Ok(Vec::new());
    }
    if request.ordered_placement_ids.len() != by_id.len() {
        return Err(AppError::Policy(
            "VALIDATION_ERROR: placement reorder requires a full ordered placement id list".to_string(),
        ));
    }

    let expected_map: HashMap<String, i64> = request
        .expected_revisions
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter_map(|(index, revision)| {
            request
                .ordered_placement_ids
                .get(index)
                .map(|placement_id| (placement_id.clone(), revision))
        })
        .collect();

    let mut updated: Vec<PlacementRecord> = Vec::new();
    for (index, placement_id) in request.ordered_placement_ids.iter().enumerate() {
        let existing = by_id.remove(placement_id).ok_or_else(|| {
            AppError::Policy(format!(
                "VALIDATION_ERROR: placement '{}' is not in view '{}'",
                placement_id, view_id
            ))
        })?;
        if let Some(expected) = expected_map.get(placement_id) {
            if existing.revision != *expected {
                return Err(conflict_payload_error(
                    "placement",
                    *expected,
                    existing.revision,
                    &existing,
                ));
            }
        }

        let patch = json!({
            "orderKey": new_order_key(index as i64),
        });
        let saved = patch_json_entity(
            root,
            "placements/by-view",
            "placement",
            placement_id,
            patch,
            Some(existing.revision),
        )?;
        updated.push(deserialize_entity(saved, "placement")?);
    }
    updated.sort_by(|a, b| a.order_key.cmp(&b.order_key));
    append_event(
        root,
        build_event(
            "placement.reordered",
            None,
            json!({"viewId": view_id, "placementIds": request.ordered_placement_ids}),
        ),
    )?;
    Ok(updated)
}

pub fn conditions_list(
    root: &Path,
    request: ListConditionsRequest,
) -> AppResult<PageResponse<ConditionRecord>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "conditions/active")?;
    items.extend(list_json_entities(root, "conditions/history")?);
    if let Some(atom_id) = request.atom_id.as_ref() {
        items.retain(|item| item.get("atomId").and_then(Value::as_str) == Some(atom_id.as_str()));
    }
    if let Some(status) = request.status.as_ref() {
        items.retain(|item| item.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    if let Some(mode) = request.mode.as_ref() {
        items.retain(|item| item.get("mode").and_then(Value::as_str) == Some(mode.as_str()));
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, request.limit, request.cursor)?;
    deserialize_page(page, "condition")
}

pub fn condition_get(root: &Path, condition_id: &str) -> AppResult<Option<ConditionRecord>> {
    ensure_topology(root)?;
    if let Some(value) = get_json_entity(root, "conditions/active", condition_id)? {
        return deserialize_optional_entity(Some(value), "condition");
    }
    let value = get_json_entity(root, "conditions/history", condition_id)?;
    deserialize_optional_entity(value, "condition")
}

pub fn condition_set_date(root: &Path, request: ConditionSetDateRequest) -> AppResult<ConditionRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(root, "condition.set_date", key.as_deref(), &request, || {
        let condition = json!({
            "id": condition_id_for_atom_mode(&request.atom_id, "date"),
            "schemaVersion": 1,
            "atomId": request.atom_id,
            "status": "active",
            "mode": "date",
            "blockedUntil": request.until_at,
        });
        let saved = upsert_json_entity(root, "conditions/active", "condition", condition, None)?;
        if let Some(atom) = atom_get(root, saved.get("atomId").and_then(Value::as_str).unwrap_or_default())? {
            apply_blocking_to_atom(
                root,
                &atom.id,
                "date",
                saved.get("blockedUntil").and_then(Value::as_str).map(|value| value.to_string()),
                None,
                None,
                None,
            )?;
        }
        append_event(
            root,
            build_event("condition.set", saved.get("atomId").and_then(Value::as_str), saved.clone()),
        )?;
        deserialize_entity(saved, "condition")
    })
}

pub fn condition_set_person(root: &Path, request: ConditionSetPersonRequest) -> AppResult<ConditionRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(root, "condition.set_person", key.as_deref(), &request, || {
        let now = Utc::now();
        let cadence = request.cadence_days.max(1);
        let condition = json!({
            "id": condition_id_for_atom_mode(&request.atom_id, "person"),
            "schemaVersion": 1,
            "atomId": request.atom_id,
            "status": "active",
            "mode": "person",
            "waitingOnPerson": request.waiting_on_person,
            "waitingCadenceDays": cadence,
            "lastFollowupAt": now,
            "nextFollowupAt": now + chrono::Duration::days(i64::from(cadence)),
        });
        let saved = upsert_json_entity(root, "conditions/active", "condition", condition, None)?;
        if let Some(atom) = atom_get(root, saved.get("atomId").and_then(Value::as_str).unwrap_or_default())? {
            apply_blocking_to_atom(
                root,
                &atom.id,
                "person",
                None,
                saved.get("waitingOnPerson").and_then(Value::as_str).map(|value| value.to_string()),
                Some(cadence),
                None,
            )?;
        }
        append_event(
            root,
            build_event("condition.set", saved.get("atomId").and_then(Value::as_str), saved.clone()),
        )?;
        deserialize_entity(saved, "condition")
    })
}

pub fn condition_set_task(root: &Path, request: ConditionSetTaskRequest) -> AppResult<ConditionRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(root, "condition.set_task", key.as_deref(), &request, || {
        let condition = json!({
            "id": condition_id_for_atom_mode(&request.atom_id, "task"),
            "schemaVersion": 1,
            "atomId": request.atom_id,
            "status": "active",
            "mode": "task",
            "blockerAtomId": request.blocker_atom_id,
        });
        let saved = upsert_json_entity(root, "conditions/active", "condition", condition, None)?;
        if let Some(atom) = atom_get(root, saved.get("atomId").and_then(Value::as_str).unwrap_or_default())? {
            apply_blocking_to_atom(
                root,
                &atom.id,
                "task",
                None,
                None,
                None,
                Some(request.blocker_atom_id.clone()),
            )?;
        }
        append_event(
            root,
            build_event("condition.set", saved.get("atomId").and_then(Value::as_str), saved.clone()),
        )?;
        deserialize_entity(saved, "condition")
    })
}

pub fn condition_followup_log(
    root: &Path,
    condition_id: &str,
    request: ConditionFollowupRequest,
) -> AppResult<ConditionRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "condition.followup_log",
        key.as_deref(),
        &json!({"conditionId": condition_id, "request": request}),
        || {
            let mut condition = get_json_entity(root, "conditions/active", condition_id)?
                .ok_or_else(|| AppError::NotFound(format!("Condition '{}' not found", condition_id)))?;
            let current_revision = condition.get("revision").and_then(Value::as_i64).unwrap_or(0);
            if current_revision != request.expected_revision {
                return Err(conflict_payload_error(
                    "condition",
                    request.expected_revision,
                    current_revision,
                    &condition,
                ));
            }
            if condition.get("mode").and_then(Value::as_str) != Some("person") {
                return Err(AppError::Policy(
                    "VALIDATION_ERROR: followup can only be logged on person conditions".to_string(),
                ));
            }
            let now = request.followed_up_at.unwrap_or_else(Utc::now);
            let cadence_days = condition
                .get("waitingCadenceDays")
                .and_then(Value::as_i64)
                .unwrap_or(7);
            let obj = get_object_mut(&mut condition)?;
            obj.insert("lastFollowupAt".to_string(), Value::String(now.to_rfc3339()));
            obj.insert(
                "nextFollowupAt".to_string(),
                Value::String((now + chrono::Duration::days(cadence_days)).to_rfc3339()),
            );
            bump_json_revision(obj, Utc::now());
            write_json_file(&json_entity_path(root, "conditions/active", condition_id), &condition)?;
            append_event(
                root,
                build_event(
                    "condition.followup_logged",
                    condition.get("atomId").and_then(Value::as_str),
                    json!({"conditionId": condition_id, "followedUpAt": now}),
                ),
            )?;
            deserialize_entity(condition, "condition")
        },
    )
}

pub fn condition_resolve(
    root: &Path,
    condition_id: &str,
    request: ConditionResolveRequest,
) -> AppResult<ConditionRecord> {
    transition_condition(root, condition_id, request.expected_revision, "satisfied", None, request.idempotency_key)
}

pub fn condition_cancel(
    root: &Path,
    condition_id: &str,
    request: ConditionCancelRequest,
) -> AppResult<ConditionRecord> {
    transition_condition(
        root,
        condition_id,
        request.expected_revision,
        "cancelled",
        request.reason,
        request.idempotency_key,
    )
}

fn transition_condition(
    root: &Path,
    condition_id: &str,
    expected_revision: i64,
    target_status: &str,
    reason: Option<String>,
    idempotency_key: Option<String>,
) -> AppResult<ConditionRecord> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        &format!("condition.{}", target_status),
        key.as_deref(),
        &json!({"conditionId": condition_id, "expectedRevision": expected_revision, "reason": reason}),
        || {
            let mut condition = get_json_entity(root, "conditions/active", condition_id)?
                .ok_or_else(|| AppError::NotFound(format!("Condition '{}' not found", condition_id)))?;
            let current_revision = condition.get("revision").and_then(Value::as_i64).unwrap_or(0);
            if current_revision != expected_revision {
                return Err(conflict_payload_error(
                    "condition",
                    expected_revision,
                    current_revision,
                    &condition,
                ));
            }
            let now = Utc::now();
            let atom_id = condition
                .get("atomId")
                .and_then(Value::as_str)
                .map(|value| value.to_string());
            let obj = get_object_mut(&mut condition)?;
            obj.insert("status".to_string(), Value::String(target_status.to_string()));
            if target_status == "cancelled" {
                obj.insert("canceledAt".to_string(), Value::String(now.to_rfc3339()));
            } else {
                obj.insert("resolvedAt".to_string(), Value::String(now.to_rfc3339()));
            }
            if let Some(reason) = reason {
                obj.insert("reason".to_string(), Value::String(reason));
            }
            bump_json_revision(obj, now);
            let target = json_entity_path(root, "conditions/history", condition_id);
            write_json_file(&target, &condition)?;
            let active = json_entity_path(root, "conditions/active", condition_id);
            if active.exists() {
                let _ = fs::remove_file(active);
            }

            if let Some(atom_id) = atom_id {
                clear_blocking_from_atom_if_unblocked(root, &atom_id)?;
            }

            append_event(
                root,
                build_event(
                    "condition.transitioned",
                    condition.get("atomId").and_then(Value::as_str),
                    json!({"conditionId": condition_id, "status": target_status}),
                ),
            )?;
            deserialize_entity(condition, "condition")
        },
    )
}

pub fn events_list(root: &Path, request: ListEventsRequest) -> AppResult<PageResponse<WorkspaceEventRecord>> {
    ensure_topology(root)?;

    let mut events = load_all_events(root)?;
    events.retain(|event| matches_event_filter(event, &request));
    events.sort_by(|a, b| b.occurred_at.cmp(&a.occurred_at));

    paginate(events, request.limit, request.cursor)
}

pub fn atom_events_list(
    root: &Path,
    atom_id: &str,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<WorkspaceEventRecord>> {
    events_list(
        root,
        ListEventsRequest {
            limit,
            cursor,
            atom_id: Some(atom_id.to_string()),
            ..ListEventsRequest::default()
        },
    )
}

pub fn classification_preview(raw_text: &str) -> ClassificationResult {
    classify_text(raw_text)
}

pub fn atom_classify(
    root: &Path,
    atom_id: &str,
    source: ClassificationSource,
    force_facet: Option<String>,
    idempotency_key: Option<String>,
) -> AppResult<AtomRecord> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "atom.classify",
        key.as_deref(),
        &json!({"atomId": atom_id, "source": source, "forceFacet": force_facet}),
        || atom_classify_inner(root, atom_id, source, force_facet),
    )
}

fn atom_classify_inner(
    root: &Path,
    atom_id: &str,
    source: ClassificationSource,
    force_facet: Option<String>,
) -> AppResult<AtomRecord> {
    let mut atom = get_required_atom(root, atom_id)?;
    let previous_status = atom_status(&atom);
    let result = if let Some(force) = force_facet {
        ClassificationResult {
            primary_facet: force,
            confidence: 1.0,
            source,
            reasoning: Some("manual override".to_string()),
        }
    } else {
        let mut next = classify_text(&atom.raw_text);
        next.source = source;
        next
    };

    match result.primary_facet.as_str() {
        "task" => {
            if !atom.facets.contains(&FacetKind::Task) {
                atom.facets.push(FacetKind::Task);
            }
            if atom.facet_data.task.is_none() {
                atom.facet_data.task = Some(TaskFacet {
                    title: derive_title(&atom.raw_text),
                    status: TaskStatus::Todo,
                    priority: 3,
                    ..TaskFacet::default()
                });
            }
        }
        "note" => {
            if !atom.facets.contains(&FacetKind::Note) {
                atom.facets.push(FacetKind::Note);
            }
        }
        "meta" => {
            if !atom.facets.contains(&FacetKind::Meta) {
                atom.facets.push(FacetKind::Meta);
            }
        }
        _ => {}
    }

    atom.revision += 1;
    atom.updated_at = Utc::now();
    write_atom(root, Some(previous_status), &atom)?;

    append_event(
        root,
        build_event("atom.classified", Some(&atom.id), json!({"result": result})),
    )?;

    Ok(atom)
}

fn atom_create_inner(root: &Path, request: CreateAtomRequest) -> AppResult<AtomRecord> {
    let CreateAtomRequest {
        raw_text,
        capture_source,
        initial_facets,
        facet_data,
        relations,
        governance,
        idempotency_key: _,
        body,
    } = request;

    let now = Utc::now();
    let classification = classify_text(&raw_text);
    let mut facets = initial_facets.unwrap_or_else(|| {
        if classification.primary_facet == "task" {
            vec![FacetKind::Task]
        } else {
            vec![FacetKind::Note]
        }
    });

    if facets.is_empty() {
        facets.push(FacetKind::Task);
    }

    let mut facet_data = facet_data.unwrap_or_default();
    if facets.contains(&FacetKind::Task) && facet_data.task.is_none() {
        let title = derive_title(&raw_text);
        facet_data.task = Some(TaskFacet {
            title,
            status: TaskStatus::Todo,
            priority: 3,
            ..TaskFacet::default()
        });
    }

    let id = new_atom_id(now);
    let atom = AtomRecord {
        id: id.clone(),
        schema_version: 1,
        created_at: now,
        updated_at: now,
        raw_text,
        capture_source,
        facets,
        facet_data,
        relations: normalize_relations(relations.unwrap_or_default()),
        governance: governance.unwrap_or_else(default_governance),
        body,
        revision: 1,
        archived_at: None,
    };

    write_atom(root, None, &atom)?;
    append_event(root, build_event("atom.created", Some(&atom.id), json!({"atom": atom.clone()})))?;
    let block = upsert_block_from_atom(root, &atom)?;
    let _ = ensure_placement_for_view(root, &block.id, "now", None)?;
    Ok(atom)
}

fn atom_update_inner(root: &Path, atom_id: &str, request: UpdateAtomRequest) -> AppResult<AtomRecord> {
    let mut atom = get_required_atom(root, atom_id)?;
    assert_revision(&atom, request.expected_revision)?;

    let previous_status = atom_status(&atom);

    if let Some(raw_text) = request.raw_text {
        atom.raw_text = raw_text;
    }
    if let Some(facet_patch) = request.facet_data_patch {
        atom.facet_data = merge_atom_facets(atom.facet_data, facet_patch);
    }
    if let Some(relations_patch) = request.relations_patch {
        atom.relations = merge_atom_relations(atom.relations, relations_patch);
    }
    if request.clear_parent_id.unwrap_or(false) {
        atom.relations.parent_id = None;
    }
    if let Some(body_patch) = request.body_patch {
        atom.body = apply_body_patch(atom.body, body_patch);
    }

    atom.revision += 1;
    atom.updated_at = Utc::now();

    write_atom(root, Some(previous_status), &atom)?;
    append_event(
        root,
        build_event(
            "atom.updated",
            Some(&atom.id),
            json!({"beforeRevision": request.expected_revision, "atom": atom.clone()}),
        ),
    )?;
    let _ = upsert_block_from_atom(root, &atom)?;

    Ok(atom)
}

fn atom_archive_inner(root: &Path, atom_id: &str, request: ArchiveAtomRequest) -> AppResult<AtomRecord> {
    let mut atom = get_required_atom(root, atom_id)?;
    assert_revision(&atom, request.expected_revision)?;

    let previous_status = atom_status(&atom);
    let now = Utc::now();

    atom.archived_at = Some(now);
    upsert_task_facet(&mut atom);
    if let Some(task) = atom.facet_data.task.as_mut() {
        task.status = TaskStatus::Archived;
    }
    atom.revision += 1;
    atom.updated_at = now;

    write_atom(root, Some(previous_status), &atom)?;
    append_event(
        root,
        build_event(
            "atom.archived",
            Some(&atom.id),
            json!({"archivedAt": now, "reason": request.reason}),
        ),
    )?;
    let _ = upsert_block_from_atom(root, &atom)?;

    Ok(atom)
}

fn task_status_set_inner(root: &Path, atom_id: &str, request: SetTaskStatusRequest) -> AppResult<AtomRecord> {
    let mut atom = get_required_atom(root, atom_id)?;
    assert_revision(&atom, request.expected_revision)?;

    let previous_status = atom_status(&atom);
    upsert_task_facet(&mut atom);

    let now = Utc::now();
    let from_status;
    {
        let task = atom.facet_data.task.as_mut().expect("task facet exists");
        from_status = task.status;
        task.status = request.status;
        if request.status == TaskStatus::Done {
            task.completed_at = Some(now);
        }
    }

    if request.status == TaskStatus::Archived {
        atom.archived_at = Some(now);
    } else if atom.archived_at.is_some() {
        atom.archived_at = None;
    }

    atom.revision += 1;
    atom.updated_at = now;

    write_atom(root, Some(previous_status), &atom)?;
    append_event(
        root,
        build_event(
            "task.status_changed",
            Some(&atom.id),
            json!({"from": from_status.as_str(), "to": request.status.as_str(), "reason": request.reason}),
        ),
    )?;
    if request.status == TaskStatus::Done {
        append_event(
            root,
            build_event("task.completed", Some(&atom.id), json!({"completedAt": now})),
        )?;
    }
    let _ = upsert_block_from_atom(root, &atom)?;

    Ok(atom)
}

fn notepad_save_inner(root: &Path, request: SaveNotepadViewRequest) -> AppResult<NotepadViewDefinition> {
    let SaveNotepadViewRequest {
        expected_revision,
        idempotency_key: _,
        definition: input,
    } = request;

    let now = Utc::now();
    let path = notepad_path(root, &input.id);

    let existing: Option<NotepadViewDefinition> = if path.exists() {
        read_notepad_file(root, &path).ok()
    } else {
        None
    };

    if let Some(expected) = expected_revision {
        let actual = existing.as_ref().map(|value| value.revision).unwrap_or(0);
        if actual != expected {
            let latest = existing
                .as_ref()
                .map(|value| serde_json::to_value(value).unwrap_or(Value::Null))
                .unwrap_or(Value::Null);
            return Err(AppError::Policy(format!(
                "CONFLICT: {}",
                json!({
                    "code": "CONFLICT",
                    "entity": "notepad",
                    "expectedRevision": expected,
                    "actualRevision": actual,
                    "latest": latest
                })
            )));
        }
    }

    let created_at = existing.as_ref().map(|value| value.created_at).unwrap_or(now);
    let revision = existing.as_ref().map(|value| value.revision + 1).unwrap_or(1);

    let id = input.id.clone();
    let definition = NotepadViewDefinition {
        id,
        schema_version: if input.schema_version <= 0 { 1 } else { input.schema_version },
        name: input.name,
        description: input.description,
        is_system: input.is_system || input.id == "now",
        filters: input.filters,
        sorts: input.sorts,
        capture_defaults: input.capture_defaults,
        layout_mode: if input.layout_mode.is_empty() {
            "list".to_string()
        } else {
            input.layout_mode
        },
        created_at,
        updated_at: now,
        revision,
    };

    write_notepad_file(root, &path, &definition)?;
    Ok(definition)
}

fn ensure_topology(root: &Path) -> AppResult<()> {
    if !root.exists() {
        fs::create_dir_all(root).map_err(|error| AppError::Io(error.to_string()))?;
    }
    for rel in ROOT_DIRS {
        let dir = root.join(rel);
        if !dir.exists() {
            fs::create_dir_all(dir).map_err(|error| AppError::Io(error.to_string()))?;
        }
    }

    let retention_file = root.join("governance/retention-policies.md");
    if !retention_file.exists() {
        fs::write(
            &retention_file,
            "# Retention Policies\n\n- default-internal: keep active until archived, then retain 365 days.\n",
        )
        .map_err(|error| AppError::Io(error.to_string()))?;
    }

    let sensitivity_file = root.join("governance/sensitivity-defaults.md");
    if !sensitivity_file.exists() {
        fs::write(
            &sensitivity_file,
            "# Sensitivity Defaults\n\nDefault sensitivity: internal\n",
        )
        .map_err(|error| AppError::Io(error.to_string()))?;
    }

    Ok(())
}

fn detect_obsidian_cli() -> bool {
    resolve_binary("obsidian").is_some()
}

fn default_governance() -> GovernanceMeta {
    GovernanceMeta {
        sensitivity: SensitivityLevel::Internal,
        retention_policy_id: None,
        origin: "user_input".to_string(),
        source_ref: None,
        encryption_scope: EncryptionScope::None,
        allowed_agent_scopes: None,
    }
}

fn normalize_relations(mut relations: AtomRelations) -> AtomRelations {
    if relations.thread_ids.is_empty() {
        relations.thread_ids = Vec::new();
    }
    relations
}

fn derive_title(raw_text: &str) -> String {
    let first = raw_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Untitled task")
        .trim();
    first
        .trim_start_matches("- [ ]")
        .trim_start_matches("- [x]")
        .trim_start_matches(['-', '*'])
        .trim()
        .chars()
        .take(120)
        .collect::<String>()
}

fn classify_text(raw_text: &str) -> ClassificationResult {
    let trimmed = raw_text.trim();
    let task_like = trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.starts_with("- [ ]")
        || trimmed.starts_with("- [x]");

    if task_like {
        ClassificationResult {
            primary_facet: "task".to_string(),
            confidence: 0.88,
            source: ClassificationSource::Heuristic,
            reasoning: Some("task marker prefix detected".to_string()),
        }
    } else if trimmed.starts_with('#') || trimmed.starts_with('>') {
        ClassificationResult {
            primary_facet: "note".to_string(),
            confidence: 0.72,
            source: ClassificationSource::Heuristic,
            reasoning: Some("note-like structure detected".to_string()),
        }
    } else {
        ClassificationResult {
            primary_facet: "meta".to_string(),
            confidence: 0.55,
            source: ClassificationSource::Heuristic,
            reasoning: Some("default freeform classification".to_string()),
        }
    }
}

fn apply_body_patch(existing: Option<String>, patch: BodyPatch) -> Option<String> {
    match patch.mode.as_str() {
        "replace" => Some(patch.value),
        "append" => {
            let mut base = existing.unwrap_or_default();
            if !base.is_empty() {
                base.push('\n');
            }
            base.push_str(&patch.value);
            Some(base)
        }
        "prepend" => {
            let mut next = patch.value;
            if let Some(current) = existing {
                if !next.is_empty() {
                    next.push('\n');
                }
                next.push_str(&current);
            }
            Some(next)
        }
        _ => existing,
    }
}

fn merge_atom_facets(existing: AtomFacets, patch: AtomFacets) -> AtomFacets {
    AtomFacets {
        task: patch.task.or(existing.task),
        note: patch.note.or(existing.note),
        meta: patch.meta.or(existing.meta),
        attention: patch.attention.or(existing.attention),
        commitment: patch.commitment.or(existing.commitment),
        blocking: patch.blocking.or(existing.blocking),
        recurrence: patch.recurrence.or(existing.recurrence),
        energy: patch.energy.or(existing.energy),
        agent: patch.agent.or(existing.agent),
    }
}

fn merge_atom_relations(existing: AtomRelations, patch: AtomRelationsPatch) -> AtomRelations {
    AtomRelations {
        parent_id: patch.parent_id.or(existing.parent_id),
        blocked_by_atom_id: patch.blocked_by_atom_id.or(existing.blocked_by_atom_id),
        thread_ids: patch.thread_ids.unwrap_or(existing.thread_ids),
        derived_from_atom_id: patch.derived_from_atom_id.or(existing.derived_from_atom_id),
    }
}

fn with_idempotency<T, P, F>(
    root: &Path,
    operation: &str,
    key: Option<&str>,
    payload: &P,
    f: F,
) -> AppResult<T>
where
    T: Serialize + DeserializeOwned,
    P: Serialize,
    F: FnOnce() -> AppResult<T>,
{
    let raw_key = require_idempotency_key(key, operation)?;

    let safe_operation = sanitize_component(operation);
    let safe_key = sanitize_component(raw_key);
    let path = root
        .join("idempotency")
        .join(safe_operation)
        .join(format!("{}.json", safe_key));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Io(error.to_string()))?;
    }

    let payload_value = serde_json::to_value(payload)?;
    if path.exists() {
        let record: IdempotencyRecord = read_json_file(&path)?;
        if record.payload != payload_value {
            return Err(AppError::Policy(format!(
                "IDEMPOTENCY_CONFLICT: key '{}' reused with a different payload",
                raw_key
            )));
        }
        let result: T = serde_json::from_value(record.result)?;
        return Ok(result);
    }

    let result = f()?;
    let record = IdempotencyRecord {
        payload: payload_value,
        result: serde_json::to_value(&result)?,
        created_at: Utc::now(),
    };
    write_json_file(&path, &record)?;
    Ok(result)
}

fn require_idempotency_key<'a>(key: Option<&'a str>, operation: &str) -> AppResult<&'a str> {
    key.map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::Policy(format!(
                "IDEMPOTENCY_REQUIRED: operation '{}' requires idempotencyKey",
                operation
            ))
        })
}

fn extract_required_idempotency_key(payload: &mut Value, operation: &str) -> AppResult<String> {
    let object = payload.as_object_mut().ok_or_else(|| {
        AppError::Policy(format!(
            "IDEMPOTENCY_REQUIRED: operation '{}' requires idempotencyKey",
            operation
        ))
    })?;
    let idempotency = object
        .remove("idempotencyKey")
        .and_then(|value| value.as_str().map(|value| value.to_string()))
        .ok_or_else(|| {
            AppError::Policy(format!(
                "IDEMPOTENCY_REQUIRED: operation '{}' requires idempotencyKey",
                operation
            ))
        })?;
    if idempotency.trim().is_empty() {
        return Err(AppError::Policy(format!(
            "IDEMPOTENCY_REQUIRED: operation '{}' requires idempotencyKey",
            operation
        )));
    }
    Ok(idempotency)
}

fn conflict_payload_error<T: Serialize>(
    entity_kind: &str,
    expected_revision: i64,
    actual_revision: i64,
    latest: &T,
) -> AppError {
    let latest_value = serde_json::to_value(latest).unwrap_or(Value::Null);
    let payload = json!({
        "code": "CONFLICT",
        "entity": entity_kind,
        "expectedRevision": expected_revision,
        "actualRevision": actual_revision,
        "latest": latest_value
    });
    AppError::Policy(format!("CONFLICT: {}", payload))
}

fn upsert_task_facet(atom: &mut AtomRecord) {
    if !atom.facets.contains(&FacetKind::Task) {
        atom.facets.push(FacetKind::Task);
    }
    if atom.facet_data.task.is_none() {
        atom.facet_data.task = Some(TaskFacet {
            title: derive_title(&atom.raw_text),
            status: TaskStatus::Todo,
            priority: 3,
            ..TaskFacet::default()
        });
    }
}

fn atom_status(atom: &AtomRecord) -> TaskStatus {
    if let Some(task) = atom.facet_data.task.as_ref() {
        return task.status;
    }
    if atom.archived_at.is_some() {
        return TaskStatus::Archived;
    }
    TaskStatus::Todo
}

fn atom_has_no_meaningful_content(atom: &AtomRecord) -> bool {
    atom.raw_text.trim().is_empty()
        && atom
            .body
            .as_deref()
            .map(|body| body.trim().is_empty())
            .unwrap_or(true)
}

fn status_rel_dir(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Done => "atoms/done",
        TaskStatus::Archived => "atoms/archive",
        _ => "atoms/active",
    }
}

fn atom_path(root: &Path, atom_id: &str, status: TaskStatus) -> PathBuf {
    root.join(status_rel_dir(status)).join(format!("{}.md", sanitize_component(atom_id)))
}

fn notepad_path(root: &Path, notepad_id: &str) -> PathBuf {
    root.join("notepads").join(format!("{}.md", sanitize_component(notepad_id)))
}

fn resolve_notepad_path(root: &Path, notepad_id: &str) -> PathBuf {
    let primary = notepad_path(root, notepad_id);
    if primary.exists() {
        return primary;
    }
    let legacy = root.join("notepads").join(format!("{}.json", sanitize_component(notepad_id)));
    if legacy.exists() {
        return legacy;
    }
    primary
}

fn is_workspace_doc_file(path: &Path) -> bool {
    matches!(path.extension().and_then(|value| value.to_str()), Some("json" | "md"))
}

fn sanitize_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let cleaned = out.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "item".to_string()
    } else {
        cleaned
    }
}

fn new_atom_id(now: DateTime<Utc>) -> String {
    let short = Uuid::new_v4().simple().to_string();
    format!(
        "atom_{}_{}_{}",
        now.format("%Y%m%d"),
        now.format("%H%M%S"),
        &short[..4]
    )
}

fn write_json_file<T: serde::Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Io(error.to_string()))?;
    }
    let rendered = serde_json::to_string_pretty(value)?;
    if try_obsidian_cli_write_or_fail(path, &rendered)? {
        return Ok(());
    }
    fs::write(path, rendered).map_err(|error| AppError::Io(error.to_string()))
}

fn read_json_file<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let bytes = fs::read(path).map_err(|error| AppError::Io(error.to_string()))?;
    serde_json::from_slice(&bytes).map_err(AppError::from)
}

fn read_markdown_frontmatter(_root: &Path, path: &Path) -> AppResult<(Value, String)> {
    let content = fs::read_to_string(path).map_err(|error| AppError::Io(error.to_string()))?;
    let Some(rest) = content.strip_prefix("---\n") else {
        return Err(AppError::Policy(format!(
            "Malformed markdown frontmatter file (missing opening delimiter): {}",
            path.to_string_lossy()
        )));
    };
    let Some(split_at) = rest.find("\n---\n") else {
        return Err(AppError::Policy(format!(
            "Malformed markdown frontmatter file (missing closing delimiter): {}",
            path.to_string_lossy()
        )));
    };
    let frontmatter = &rest[..split_at];
    let body = rest[(split_at + 5)..].to_string();

    let metadata: Value = match serde_json::from_str(frontmatter) {
        Ok(value) => value,
        Err(_) => {
            let yaml_value: serde_yaml::Value = serde_yaml::from_str(frontmatter)
                .map_err(|error| AppError::Policy(format!("Invalid frontmatter in {}: {}", path.to_string_lossy(), error)))?;
            serde_json::to_value(yaml_value)?
        }
    };

    Ok((metadata, body))
}

fn write_markdown_frontmatter(_root: &Path, path: &Path, metadata: &Value, body: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Io(error.to_string()))?;
    }

    let metadata_yaml = serde_yaml::to_string(metadata).map_err(|error| AppError::Internal(error.to_string()))?;
    let rendered = format!("---\n{}---\n\n{}", metadata_yaml, body);
    if try_obsidian_cli_write_or_fail(path, &rendered)? {
        return Ok(());
    }

    fs::write(path, rendered).map_err(|error| AppError::Io(error.to_string()))
}

fn try_obsidian_cli_write_or_fail(path: &Path, content: &str) -> AppResult<bool> {
    if obsidian_cli_writes_suppressed() {
        return Ok(false);
    }
    let Some(root) = detect_obsidian_command_center_root() else {
        return Ok(false);
    };
    if !path.starts_with(&root) {
        return Ok(false);
    }
    if try_obsidian_cli_write(&root, path, content) {
        return Ok(true);
    }
    tracing::warn!(
        path = %path.to_string_lossy(),
        "obsidian CLI write unavailable; falling back to direct filesystem write"
    );
    Ok(false)
}

fn read_atom_file(root: &Path, path: &Path) -> AppResult<AtomRecord> {
    match path.extension().and_then(|value| value.to_str()) {
        Some("json") => read_json_file(path),
        Some("md") => {
            let (metadata, body) = read_markdown_frontmatter(root, path)?;
            let mut atom: AtomRecord = serde_json::from_value(metadata)?;
            if !body.trim().is_empty() {
                atom.body = Some(body);
            }
            Ok(atom)
        }
        _ => Err(AppError::Policy(format!(
            "Unsupported atom file extension: {}",
            path.to_string_lossy()
        ))),
    }
}

fn write_atom_file(root: &Path, path: &Path, atom: &AtomRecord) -> AppResult<()> {
    let metadata = serde_json::to_value(atom)?;
    let body = atom.body.clone().unwrap_or_default();
    write_markdown_frontmatter(root, path, &metadata, &body)
}

fn read_notepad_file(root: &Path, path: &Path) -> AppResult<NotepadViewDefinition> {
    match path.extension().and_then(|value| value.to_str()) {
        Some("json") => read_json_file(path),
        Some("md") => {
            let (metadata, _) = read_markdown_frontmatter(root, path)?;
            let notepad: NotepadViewDefinition = serde_json::from_value(metadata)?;
            Ok(notepad)
        }
        _ => Err(AppError::Policy(format!(
            "Unsupported notepad file extension: {}",
            path.to_string_lossy()
        ))),
    }
}

fn write_notepad_file(root: &Path, path: &Path, definition: &NotepadViewDefinition) -> AppResult<()> {
    let metadata = serde_json::to_value(definition)?;
    write_markdown_frontmatter(root, path, &metadata, "")
}

fn try_obsidian_cli_write(root: &Path, path: &Path, content: &str) -> bool {
    if OBSIDIAN_CLI_WRITE_CIRCUIT_OPEN.load(AtomicOrdering::Relaxed) {
        return false;
    }
    let _write_lock = OBSIDIAN_CLI_WRITE_LOCK.lock().ok();
    if OBSIDIAN_CLI_WRITE_CIRCUIT_OPEN.load(AtomicOrdering::Relaxed) {
        return false;
    }

    let Some(vault_name) = detect_obsidian_vault_name() else {
        OBSIDIAN_CLI_WRITE_CIRCUIT_OPEN.store(true, AtomicOrdering::Relaxed);
        tracing::warn!("obsidian CLI write disabled for process: unable to resolve vault name");
        return false;
    };

    if !obsidian_cli_can_target_vault(root, &vault_name) {
        OBSIDIAN_CLI_WRITE_CIRCUIT_OPEN.store(true, AtomicOrdering::Relaxed);
        tracing::warn!(
            vault = %vault_name,
            "obsidian CLI write disabled for process: vault not targetable"
        );
        return false;
    }

    let rel_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let before = fs::read_to_string(path).ok();
    let args = vec![
        format!("vault={}", vault_name),
        "create".to_string(),
        format!("path={}", rel_path),
        format!("content={}", encode_obsidian_cli_content(content)),
        "overwrite".to_string(),
    ];
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    if run_obsidian_cli_status("obsidian", &arg_refs, root)
        && obsidian_cli_write_applied(path, content, before.as_deref())
    {
        return true;
    }

    OBSIDIAN_CLI_WRITE_CIRCUIT_OPEN.store(true, AtomicOrdering::Relaxed);
    tracing::warn!(
        path = %path.to_string_lossy(),
        vault = %vault_name,
        "obsidian CLI write failed; disabling CLI writes for this app process"
    );
    false
}

fn obsidian_cli_can_target_vault(root: &Path, vault_name: &str) -> bool {
    let args = [
        format!("vault={}", vault_name),
        "vault".to_string(),
        "active".to_string(),
        "key=path".to_string(),
    ];
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_obsidian_cli_status("obsidian", &arg_refs, root)
}

fn encode_obsidian_cli_content(content: &str) -> String {
    normalize_newlines(content)
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
}

fn normalize_newlines(input: &str) -> String {
    input.replace("\r\n", "\n").replace('\r', "\n")
}

fn obsidian_cli_write_applied(path: &Path, expected_content: &str, previous_content: Option<&str>) -> bool {
    let Ok(actual_content) = fs::read_to_string(path) else {
        return false;
    };
    let actual = normalize_newlines(&actual_content);
    let expected = normalize_newlines(expected_content);
    if actual == expected {
        return true;
    }
    if let Some(previous) = previous_content {
        return normalize_newlines(previous) != actual && actual.ends_with(&expected);
    }
    false
}

fn run_obsidian_cli_status(bin: &str, args: &[&str], root: &Path) -> bool {
    let mut command = prepare_obsidian_command(bin, root);
    let mut child = match command.args(args).stdout(Stdio::null()).stderr(Stdio::piped()).spawn() {
        Ok(child) => child,
        Err(error) => {
            tracing::warn!(binary = %bin, error = %error, "obsidian command spawn failed");
            return false;
        }
    };

    let timeout = Duration::from_millis(OBSIDIAN_CLI_TIMEOUT_MS);
    match child.wait_timeout(timeout) {
        Ok(Some(status)) => {
            if status.success() {
                return true;
            }
            let stderr = child
                .stderr
                .take()
                .and_then(|mut stream| {
                    let mut buffer = Vec::new();
                    stream.read_to_end(&mut buffer).ok()?;
                    String::from_utf8(buffer).ok()
                })
                .unwrap_or_default();
            tracing::warn!(
                binary = %bin,
                status = ?status.code(),
                args = ?args,
                stderr = %stderr.trim(),
                "obsidian command failed"
            );
            false
        }
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            tracing::warn!(binary = %bin, args = ?args, "obsidian command timed out");
            false
        }
        Err(error) => {
            tracing::warn!(binary = %bin, error = %error, "obsidian command wait failed");
            false
        }
    }
}

fn prepare_obsidian_command(bin: &str, root: &Path) -> std::process::Command {
    const FALLBACK_PATH: &str =
        "/Applications/Obsidian.app/Contents/MacOS:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    let path = match std::env::var("PATH") {
        Ok(existing) if !existing.trim().is_empty() => format!("{}:{}", FALLBACK_PATH, existing),
        _ => FALLBACK_PATH.to_string(),
    };
    let executable = resolve_binary(bin).unwrap_or_else(|| PathBuf::from(bin));
    let mut command = std::process::Command::new(executable);
    command.current_dir(root).env("PATH", path);
    command
}

fn resolve_binary(bin: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(bin);
    if candidate.is_absolute() {
        return candidate.is_file().then_some(candidate);
    }
    const FALLBACK_PATH: &str =
        "/Applications/Obsidian.app/Contents/MacOS:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    let path = match std::env::var("PATH") {
        Ok(existing) if !existing.trim().is_empty() => format!("{}:{}", FALLBACK_PATH, existing),
        _ => FALLBACK_PATH.to_string(),
    };
    for dir in path.split(':').filter(|value| !value.is_empty()) {
        let probe = Path::new(dir).join(bin);
        if probe.is_file() {
            return Some(probe);
        }
    }
    None
}

fn detect_obsidian_vault_path() -> Option<PathBuf> {
    if let Some(path) = detect_obsidian_vault_path_from_config() {
        return Some(path);
    }
    if let Some(path) = std::env::var_os("OBSIDIAN_VAULT_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.is_absolute() {
            return Some(candidate);
        }
    }
    if let Some(path) = std::env::var_os("COMMAND_CENTER_OBSIDIAN_VAULT_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.is_absolute() {
            return Some(candidate);
        }
    }
    None
}

fn detect_obsidian_vault_name() -> Option<String> {
    let path = detect_obsidian_vault_path()?;
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
}

fn detect_obsidian_vault_path_from_config() -> Option<PathBuf> {
    let mut config_candidates = Vec::new();
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USER")
                .map(PathBuf::from)
                .map(|user| PathBuf::from("/Users").join(user))
        });
    if let Some(home) = home {
        config_candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("obsidian")
                .join("obsidian.json"),
        );
        config_candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("Obsidian")
                .join("obsidian.json"),
        );
        config_candidates.push(home.join(".config").join("obsidian").join("obsidian.json"));
    }
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        config_candidates.push(PathBuf::from(xdg).join("obsidian").join("obsidian.json"));
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        config_candidates.push(PathBuf::from(app_data).join("obsidian").join("obsidian.json"));
    }

    for config in config_candidates {
        let bytes = match fs::read(&config) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let parsed: Value = match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Some(vaults) = parsed.get("vaults").and_then(Value::as_object) else {
            continue;
        };
        let mut selected: Option<(bool, i64, PathBuf)> = None;
        for vault in vaults.values() {
            let Some(path_str) = vault.get("path").and_then(Value::as_str) else {
                continue;
            };
            let vault_path = PathBuf::from(path_str);
            if !vault_path.is_absolute() {
                continue;
            }
            let ts = vault.get("ts").and_then(Value::as_i64).unwrap_or(0);
            let is_open = vault.get("open").and_then(Value::as_bool).unwrap_or(false);
            match selected {
                Some((selected_open, selected_ts, _))
                    if (is_open as i32, ts) <= (selected_open as i32, selected_ts) => {}
                _ => selected = Some((is_open, ts, vault_path)),
            }
        }
        if let Some((_, _, path)) = selected {
            return Some(path);
        }
    }
    None
}

fn find_atom_path(root: &Path, atom_id: &str) -> AppResult<Option<PathBuf>> {
    let safe_id = sanitize_component(atom_id);
    for rel in ["atoms/active", "atoms/done", "atoms/archive"] {
        let md_path = root.join(rel).join(format!("{}.md", safe_id));
        if md_path.exists() {
            return Ok(Some(md_path));
        }
        let json_path = root.join(rel).join(format!("{}.json", safe_id));
        if json_path.exists() {
            return Ok(Some(json_path));
        }
    }

    for rel in ["atoms/active", "atoms/done", "atoms/archive"] {
        let dir = root.join(rel);
        for entry in fs::read_dir(&dir).map_err(|error| AppError::Io(error.to_string()))? {
            let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
            let path = entry.path();
            if !is_workspace_doc_file(&path) {
                continue;
            }
            if let Ok(atom) = read_atom_file(root, &path) {
                if atom.id == atom_id {
                    return Ok(Some(path));
                }
            }
        }
    }

    Ok(None)
}

fn get_required_atom(root: &Path, atom_id: &str) -> AppResult<AtomRecord> {
    let path = find_atom_path(root, atom_id)?
        .ok_or_else(|| AppError::NotFound(format!("Atom '{}' not found", atom_id)))?;
    read_atom_file(root, &path)
}

fn write_atom(root: &Path, previous_status: Option<TaskStatus>, atom: &AtomRecord) -> AppResult<()> {
    let current_status = atom_status(atom);
    let next_path = atom_path(root, &atom.id, current_status);

    write_atom_file(root, &next_path, atom)?;

    let previous = if let Some(status) = previous_status {
        Some(atom_path(root, &atom.id, status))
    } else {
        find_atom_path(root, &atom.id)?
    };

    if let Some(previous_path) = previous {
        if previous_path != next_path && previous_path.exists() {
            let _ = fs::remove_file(previous_path);
        }
    }

    Ok(())
}

fn assert_revision(atom: &AtomRecord, expected: i64) -> AppResult<()> {
    if atom.revision != expected {
        return Err(conflict_payload_error(
            "atom",
            expected,
            atom.revision,
            atom,
        ));
    }
    Ok(())
}

fn load_all_atoms(root: &Path) -> AppResult<Vec<AtomRecord>> {
    let mut atoms = Vec::new();
    for rel in ["atoms/active", "atoms/done", "atoms/archive"] {
        let dir = root.join(rel);
        for entry in fs::read_dir(&dir).map_err(|error| AppError::Io(error.to_string()))? {
            let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
            let path = entry.path();
            if !is_workspace_doc_file(&path) {
                continue;
            }
            match read_atom_file(root, &path) {
                Ok(atom) => atoms.push(atom),
                Err(error) => {
                    tracing::warn!(path = %path.to_string_lossy(), error = %error, "skipping malformed atom file");
                }
            }
        }
    }
    Ok(atoms)
}

fn load_all_blocks(root: &Path) -> AppResult<Vec<BlockRecord>> {
    let mut blocks = Vec::new();
    for rel in ["blocks/active", "blocks/completed", "blocks/archived"] {
        for value in list_json_entities(root, rel)? {
            match deserialize_entity::<BlockRecord>(value, "block") {
                Ok(block) => blocks.push(block),
                Err(error) => {
                    tracing::warn!(error = %error, "skipping malformed block file");
                }
            }
        }
    }
    Ok(blocks)
}

fn find_block(root: &Path, block_id: &str) -> AppResult<Option<BlockRecord>> {
    for rel in ["blocks/active", "blocks/completed", "blocks/archived"] {
        if let Some(value) = get_json_entity(root, rel, block_id)? {
            return deserialize_optional_entity(Some(value), "block");
        }
    }
    Ok(None)
}

fn block_kind_from_atom(atom: &AtomRecord) -> String {
    if atom.facets.contains(&FacetKind::Task) {
        "task".to_string()
    } else if atom.facets.contains(&FacetKind::Note) {
        "note".to_string()
    } else if atom.facets.contains(&FacetKind::Meta) {
        "meta".to_string()
    } else {
        "unknown".to_string()
    }
}

fn block_lifecycle_from_atom(atom: &AtomRecord) -> String {
    if atom.archived_at.is_some()
        || atom
            .facet_data
            .task
            .as_ref()
            .map(|task| task.status == TaskStatus::Archived)
            .unwrap_or(false)
    {
        return "archived".to_string();
    }
    if atom
        .facet_data
        .task
        .as_ref()
        .map(|task| task.status == TaskStatus::Done)
        .unwrap_or(false)
    {
        return "completed".to_string();
    }
    "active".to_string()
}

fn block_id_for_atom(atom_id: &str) -> String {
    format!("blk_{}", sanitize_component(atom_id))
}

fn atom_to_block_record(atom: &AtomRecord) -> BlockRecord {
    let lifecycle = block_lifecycle_from_atom(atom);
    let task = atom.facet_data.task.as_ref();
    let meta = atom.facet_data.meta.as_ref();
    BlockRecord {
        id: block_id_for_atom(&atom.id),
        schema_version: 1,
        atom_id: Some(atom.id.clone()),
        text: atom.raw_text.clone(),
        kind: block_kind_from_atom(atom),
        lifecycle,
        parent_block_id: atom
            .relations
            .parent_id
            .as_ref()
            .map(|parent| block_id_for_atom(parent)),
        thread_ids: atom.relations.thread_ids.clone(),
        labels: meta.and_then(|value| value.labels.clone()).unwrap_or_default(),
        categories: meta
            .and_then(|value| value.categories.clone())
            .unwrap_or_default(),
        task_status: task.map(|value| value.status),
        priority: task.map(|value| value.priority),
        attention_layer: task.and_then(|value| value.attention_layer),
        commitment_level: task.and_then(|value| value.commitment_level),
        completed_at: task.and_then(|value| value.completed_at),
        archived_at: atom.archived_at,
        created_at: atom.created_at,
        updated_at: atom.updated_at,
        revision: atom.revision,
    }
}

fn block_rel_dir_for_lifecycle(lifecycle: &str) -> &'static str {
    match lifecycle.to_ascii_lowercase().as_str() {
        "completed" => "blocks/completed",
        "archived" => "blocks/archived",
        _ => "blocks/active",
    }
}

fn upsert_block_from_atom(root: &Path, atom: &AtomRecord) -> AppResult<BlockRecord> {
    let mut block = atom_to_block_record(atom);
    if let Some(existing) = find_block(root, &block.id)? {
        block.created_at = existing.created_at;
        block.revision = existing.revision + 1;
        if block.updated_at <= existing.updated_at {
            block.updated_at = Utc::now();
        }
    }

    let target_rel = block_rel_dir_for_lifecycle(&block.lifecycle);
    let target_path = json_entity_path(root, target_rel, &block.id);

    for rel in ["blocks/active", "blocks/completed", "blocks/archived"] {
        if rel == target_rel {
            continue;
        }
        let stale = json_entity_path(root, rel, &block.id);
        if stale.exists() {
            let _ = fs::remove_file(stale);
        }
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Io(error.to_string()))?;
    }
    write_json_file(&target_path, &block)?;
    Ok(block)
}

fn backfill_blocks_from_atoms(root: &Path) -> AppResult<()> {
    for atom in load_all_atoms(root)? {
        let _ = upsert_block_from_atom(root, &atom)?;
    }
    Ok(())
}

fn load_placements_for_view(root: &Path, view_id: &str) -> AppResult<Vec<PlacementRecord>> {
    let mut placements: Vec<PlacementRecord> = list_json_entities(root, "placements/by-view")?
        .into_iter()
        .filter_map(|value| deserialize_entity::<PlacementRecord>(value, "placement").ok())
        .filter(|placement| placement.view_id == view_id)
        .collect();
    placements.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| a.order_key.cmp(&b.order_key))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(placements)
}

fn ensure_placement_for_view(
    root: &Path,
    block_id: &str,
    view_id: &str,
    parent_placement_id: Option<String>,
) -> AppResult<PlacementRecord> {
    let existing = load_placements_for_view(root, view_id)?
        .into_iter()
        .find(|placement| placement.block_id == block_id);
    if let Some(existing) = existing {
        return Ok(existing);
    }

    let next_index = load_placements_for_view(root, view_id)?.len() as i64;
    let placement_value = json!({
        "id": format!("placement_{}", Uuid::new_v4().simple()),
        "schemaVersion": 1,
        "viewId": view_id,
        "blockId": block_id,
        "parentPlacementId": parent_placement_id,
        "orderKey": new_order_key(next_index),
        "pinned": false
    });
    let saved = upsert_json_entity(root, "placements/by-view", "placement", placement_value, None)?;
    deserialize_entity(saved, "placement")
}

fn new_order_key(index: i64) -> String {
    format!(
        "{:08}-{}",
        index.max(0),
        Uuid::new_v4().simple()
    )
}

fn condition_id_for_atom_mode(atom_id: &str, mode: &str) -> String {
    format!(
        "condition_{}_{}",
        sanitize_component(atom_id),
        sanitize_component(mode)
    )
}

fn apply_blocking_to_atom(
    root: &Path,
    atom_id: &str,
    mode: &str,
    blocked_until: Option<String>,
    waiting_on_person: Option<String>,
    waiting_cadence_days: Option<i32>,
    blocked_by_atom_id: Option<String>,
) -> AppResult<()> {
    let mut atom = get_required_atom(root, atom_id)?;
    let previous_status = atom_status(&atom);
    upsert_task_facet(&mut atom);
    if let Some(task) = atom.facet_data.task.as_mut() {
        task.status = TaskStatus::Blocked;
    }
    atom.facet_data.blocking = Some(crate::models::BlockingFacet {
        mode: mode.to_string(),
        blocked_until: blocked_until
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok().map(|value| value.with_timezone(&Utc))),
        waiting_on_person,
        waiting_cadence_days,
        blocked_by_atom_id,
        last_followup_at: None,
        followup_count: None,
    });
    atom.updated_at = Utc::now();
    atom.revision += 1;
    write_atom(root, Some(previous_status), &atom)?;
    let _ = upsert_block_from_atom(root, &atom)?;
    Ok(())
}

fn clear_blocking_from_atom_if_unblocked(root: &Path, atom_id: &str) -> AppResult<()> {
    let active = list_json_entities(root, "conditions/active")?;
    let has_active = active.iter().any(|condition| {
        condition.get("atomId").and_then(Value::as_str) == Some(atom_id)
            && condition.get("status").and_then(Value::as_str) == Some("active")
    });
    if has_active {
        return Ok(());
    }

    let mut atom = get_required_atom(root, atom_id)?;
    if atom.facet_data.blocking.is_none() {
        return Ok(());
    }
    let previous_status = atom_status(&atom);
    atom.facet_data.blocking = None;
    if let Some(task) = atom.facet_data.task.as_mut() {
        if task.status == TaskStatus::Blocked {
            task.status = TaskStatus::Todo;
        }
    }
    atom.updated_at = Utc::now();
    atom.revision += 1;
    write_atom(root, Some(previous_status), &atom)?;
    let _ = upsert_block_from_atom(root, &atom)?;
    Ok(())
}

fn apply_atom_filter(atoms: &mut Vec<AtomRecord>, filter: Option<&NotepadFilter>) {
    let Some(filter) = filter else {
        atoms.retain(|atom| atom.archived_at.is_none());
        return;
    };

    let include_archived = filter.include_archived.unwrap_or(false);
    let statuses = filter.statuses.clone();
    let thread_ids = filter.thread_ids.clone();
    let labels = filter.labels.clone();
    let categories = filter.categories.clone();
    let text_query = filter.text_query.as_ref().map(|value| value.to_ascii_lowercase());
    let attention_layers = filter.attention_layers.clone();
    let commitment_levels = filter.commitment_levels.clone();
    let due_from = filter.due_from.as_deref().and_then(parse_filter_date);
    let due_to = filter.due_to.as_deref().and_then(parse_filter_date);

    atoms.retain(|atom| {
        if !include_archived && atom.archived_at.is_some() {
            return false;
        }

        if let Some(facet) = filter.facet {
            if !atom.facets.contains(&facet) {
                return false;
            }
        }

        if let Some(expected) = statuses.as_ref() {
            let Some(task) = atom.facet_data.task.as_ref() else {
                return false;
            };
            if !expected.contains(&task.status) {
                return false;
            }
        }

        if let Some(parent_id) = filter.parent_id.as_ref() {
            if atom.relations.parent_id.as_ref() != Some(parent_id) {
                return false;
            }
        }

        if let Some(expected_thread_ids) = thread_ids.as_ref() {
            let expected_set: HashSet<&String> = expected_thread_ids.iter().collect();
            let matches = atom
                .relations
                .thread_ids
                .iter()
                .any(|thread_id| expected_set.contains(thread_id));
            if !matches {
                return false;
            }
        }

        if let Some(expected_labels) = labels.as_ref() {
            let expected_set: HashSet<String> = expected_labels
                .iter()
                .map(|value| value.to_ascii_lowercase())
                .collect();
            let actual_labels = atom
                .facet_data
                .meta
                .as_ref()
                .and_then(|meta| meta.labels.clone())
                .unwrap_or_default();
            let matches = actual_labels
                .iter()
                .any(|label| expected_set.contains(&label.to_ascii_lowercase()));
            if !matches {
                return false;
            }
        }

        if let Some(expected_categories) = categories.as_ref() {
            let expected_set: HashSet<String> = expected_categories
                .iter()
                .map(|value| value.to_ascii_lowercase())
                .collect();
            let actual_categories = atom
                .facet_data
                .meta
                .as_ref()
                .and_then(|meta| meta.categories.clone())
                .unwrap_or_default();
            let matches = actual_categories
                .iter()
                .any(|category| expected_set.contains(&category.to_ascii_lowercase()));
            if !matches {
                return false;
            }
        }

        if let Some(expected_layers) = attention_layers.as_ref() {
            let actual_layer = atom
                .facet_data
                .task
                .as_ref()
                .and_then(|task| task.attention_layer)
                .or_else(|| atom.facet_data.attention.as_ref().map(|attention| attention.layer));
            let Some(actual_layer) = actual_layer else {
                return false;
            };
            if !expected_layers.contains(&actual_layer) {
                return false;
            }
        }

        if let Some(expected_levels) = commitment_levels.as_ref() {
            let actual_level = atom
                .facet_data
                .task
                .as_ref()
                .and_then(|task| task.commitment_level)
                .or_else(|| atom.facet_data.commitment.as_ref().map(|commitment| commitment.level));
            let Some(actual_level) = actual_level else {
                return false;
            };
            if !expected_levels.contains(&actual_level) {
                return false;
            }
        }

        if due_from.is_some() || due_to.is_some() {
            let due = atom
                .facet_data
                .task
                .as_ref()
                .and_then(|task| {
                    task.hard_due_at
                        .as_ref()
                        .or(task.soft_due_at.as_ref())
                        .map(|value| value.date_naive())
                });
            let Some(due) = due else {
                return false;
            };
            if let Some(from) = due_from {
                if due < from {
                    return false;
                }
            }
            if let Some(to) = due_to {
                if due > to {
                    return false;
                }
            }
        }

        if let Some(query) = text_query.as_ref() {
            let mut haystacks = vec![atom.raw_text.to_ascii_lowercase()];
            if let Some(body) = atom.body.as_ref() {
                haystacks.push(body.to_ascii_lowercase());
            }
            if let Some(task) = atom.facet_data.task.as_ref() {
                haystacks.push(task.title.to_ascii_lowercase());
            }
            if !haystacks.iter().any(|value| value.contains(query)) {
                return false;
            }
        }

        true
    });
}

fn sort_atoms(atoms: &mut [AtomRecord], sort: Option<&Vec<NotepadSort>>) {
    let sorts = sort.filter(|entries| !entries.is_empty());
    atoms.sort_by(|a, b| compare_atoms(a, b, sorts));
}

fn compare_atoms(a: &AtomRecord, b: &AtomRecord, sorts: Option<&Vec<NotepadSort>>) -> Ordering {
    if let Some(sorts) = sorts {
        for sort in sorts {
            let ordering = match sort.field.as_str() {
                "createdAt" => a.created_at.cmp(&b.created_at),
                "updatedAt" => a.updated_at.cmp(&b.updated_at),
                "priority" => a
                    .facet_data
                    .task
                    .as_ref()
                    .map(|task| task.priority)
                    .unwrap_or(99)
                    .cmp(&b.facet_data.task.as_ref().map(|task| task.priority).unwrap_or(99)),
                "softDueAt" => compare_optional_datetime(
                    a.facet_data
                        .task
                        .as_ref()
                        .and_then(|task| task.soft_due_at.as_ref().map(DateTime::<Utc>::timestamp)),
                    b.facet_data
                        .task
                        .as_ref()
                        .and_then(|task| task.soft_due_at.as_ref().map(DateTime::<Utc>::timestamp)),
                ),
                "hardDueAt" => compare_optional_datetime(
                    a.facet_data
                        .task
                        .as_ref()
                        .and_then(|task| task.hard_due_at.as_ref().map(DateTime::<Utc>::timestamp)),
                    b.facet_data
                        .task
                        .as_ref()
                        .and_then(|task| task.hard_due_at.as_ref().map(DateTime::<Utc>::timestamp)),
                ),
                "attentionLayer" => attention_rank(a)
                    .cmp(&attention_rank(b)),
                "title" => a
                    .facet_data
                    .task
                    .as_ref()
                    .map(|task| task.title.as_str())
                    .unwrap_or("")
                    .cmp(
                        &b.facet_data
                            .task
                            .as_ref()
                            .map(|task| task.title.as_str())
                            .unwrap_or(""),
                    ),
                _ => Ordering::Equal,
            };

            let ordering = if sort.direction.eq_ignore_ascii_case("desc") {
                ordering.reverse()
            } else {
                ordering
            };

            if ordering != Ordering::Equal {
                return ordering;
            }
        }
    }

    b.updated_at.cmp(&a.updated_at)
}

fn compare_optional_datetime(a: Option<i64>, b: Option<i64>) -> Ordering {
    (a.is_none(), a).cmp(&(b.is_none(), b))
}

fn attention_rank(atom: &AtomRecord) -> i32 {
    let layer = atom
        .facet_data
        .task
        .as_ref()
        .and_then(|task| task.attention_layer)
        .or_else(|| atom.facet_data.attention.as_ref().map(|attention| attention.layer));
    match layer {
        Some(crate::models::AttentionLayer::L3) => 0,
        Some(crate::models::AttentionLayer::Ram) => 1,
        Some(crate::models::AttentionLayer::Short) => 2,
        Some(crate::models::AttentionLayer::Long) => 3,
        Some(crate::models::AttentionLayer::Archive) => 4,
        None => 99,
    }
}

fn parse_filter_date(input: &str) -> Option<NaiveDate> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .ok()
        .or_else(|| {
            DateTime::parse_from_rfc3339(trimmed)
                .ok()
                .map(|value| value.with_timezone(&Utc).date_naive())
        })
}

fn paginate<T>(items: Vec<T>, limit: Option<u32>, cursor: Option<String>) -> AppResult<PageResponse<T>> {
    let total = items.len();
    let offset = parse_cursor(cursor)?;
    let page_size = limit.unwrap_or(100).clamp(1, 500) as usize;

    let mut iter = items.into_iter().skip(offset);
    let page_items: Vec<T> = (&mut iter).take(page_size).collect();
    let consumed = offset + page_items.len();
    let next_cursor = if consumed < total {
        Some(consumed.to_string())
    } else {
        None
    };

    Ok(PageResponse {
        items: page_items,
        next_cursor,
        total_approx: Some(total as u64),
    })
}

fn parse_cursor(cursor: Option<String>) -> AppResult<usize> {
    let Some(value) = cursor else {
        return Ok(0);
    };
    value
        .parse::<usize>()
        .map_err(|_| AppError::Policy(format!("Invalid cursor '{}': expected numeric offset", value)))
}

fn append_event(root: &Path, event: WorkspaceEventRecord) -> AppResult<()> {
    ensure_topology(root)?;
    let date = event.occurred_at.format("%Y-%m-%d").to_string();
    let path = root.join("events").join(format!("{}.ndjson", date));

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| AppError::Io(error.to_string()))?;

    let line = serde_json::to_string(&event)?;
    writeln!(file, "{}", line).map_err(|error| AppError::Io(error.to_string()))
}

fn build_event(event_type: &str, atom_id: Option<&str>, payload: Value) -> WorkspaceEventRecord {
    WorkspaceEventRecord {
        id: format!("evt_{}", Uuid::new_v4().simple()),
        r#type: event_type.to_string(),
        occurred_at: Utc::now(),
        actor: "user".to_string(),
        actor_id: None,
        atom_id: atom_id.map(|value| value.to_string()),
        payload,
    }
}

fn load_all_events(root: &Path) -> AppResult<Vec<WorkspaceEventRecord>> {
    let mut events = Vec::new();
    let dir = root.join("events");

    for entry in fs::read_dir(dir).map_err(|error| AppError::Io(error.to_string()))? {
        let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("ndjson") {
            continue;
        }

        let file = File::open(&path).map_err(|error| AppError::Io(error.to_string()))?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.map_err(|error| AppError::Io(error.to_string()))?;
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<WorkspaceEventRecord>(&line) {
                Ok(event) => events.push(event),
                Err(error) => {
                    tracing::warn!(path = %path.to_string_lossy(), error = %error, "skipping malformed event line");
                }
            }
        }
    }

    Ok(events)
}

fn matches_event_filter(event: &WorkspaceEventRecord, filter: &ListEventsRequest) -> bool {
    if let Some(event_type) = filter.r#type.as_ref() {
        if &event.r#type != event_type {
            return false;
        }
    }
    if let Some(atom_id) = filter.atom_id.as_ref() {
        if event.atom_id.as_ref() != Some(atom_id) {
            return false;
        }
    }
    if let Some(from) = filter.from {
        if event.occurred_at < from {
            return false;
        }
    }
    if let Some(to) = filter.to {
        if event.occurred_at > to {
            return false;
        }
    }
    true
}

fn latest_event_timestamp(root: &Path) -> AppResult<Option<DateTime<Utc>>> {
    let events = load_all_events(root)?;
    Ok(events.into_iter().map(|event| event.occurred_at).max())
}

fn ensure_now_notepad(root: &Path) -> AppResult<()> {
    let path = notepad_path(root, "now");
    let legacy = root.join("notepads").join("now.json");
    if path.exists() || legacy.exists() {
        return Ok(());
    }

    let definition = default_now_notepad(Utc::now());

    write_notepad_file(root, &path, &definition)
}

fn default_now_notepad(now: DateTime<Utc>) -> NotepadViewDefinition {
    NotepadViewDefinition {
        id: "now".to_string(),
        schema_version: 1,
        name: "Now".to_string(),
        description: Some("System default view for active work".to_string()),
        is_system: true,
        filters: NotepadFilter {
            facet: Some(FacetKind::Task),
            statuses: Some(vec![TaskStatus::Todo, TaskStatus::Doing, TaskStatus::Blocked]),
            include_archived: Some(false),
            ..NotepadFilter::default()
        },
        sorts: vec![NotepadSort {
            field: "priority".to_string(),
            direction: "asc".to_string(),
        }],
        capture_defaults: Some(crate::models::NotepadCaptureDefaults {
            initial_facets: Some(vec![FacetKind::Task]),
            task_status: Some(TaskStatus::Todo),
            task_priority: Some(3),
            ..crate::models::NotepadCaptureDefaults::default()
        }),
        layout_mode: "list".to_string(),
        created_at: now,
        updated_at: now,
        revision: 1,
    }
}

fn mutation_payload_to_value(payload: WorkspaceMutationPayload) -> Value {
    payload.into_value()
}

fn deserialize_entity<T: DeserializeOwned>(value: Value, entity: &str) -> AppResult<T> {
    serde_json::from_value(value).map_err(|error| {
        AppError::Internal(format!(
            "failed to deserialize {} payload: {}",
            entity, error
        ))
    })
}

fn deserialize_optional_entity<T: DeserializeOwned>(
    value: Option<Value>,
    entity: &str,
) -> AppResult<Option<T>> {
    value.map(|inner| deserialize_entity(inner, entity)).transpose()
}

fn deserialize_page<T: DeserializeOwned>(
    page: PageResponse<Value>,
    entity: &str,
) -> AppResult<PageResponse<T>> {
    let mut items = Vec::with_capacity(page.items.len());
    for item in page.items {
        items.push(deserialize_entity(item, entity)?);
    }
    Ok(PageResponse {
        items,
        next_cursor: page.next_cursor,
        total_approx: page.total_approx,
    })
}

pub fn rules_list(
    root: &Path,
    limit: Option<u32>,
    cursor: Option<String>,
    enabled: Option<bool>,
) -> AppResult<PageResponse<RuleDefinition>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "rules/definitions")?;
    if let Some(enabled) = enabled {
        items.retain(|item| item.get("enabled").and_then(Value::as_bool) == Some(enabled));
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "rule")
}

pub fn rule_get(root: &Path, rule_id: &str) -> AppResult<Option<RuleDefinition>> {
    ensure_topology(root)?;
    let item = get_json_entity(root, "rules/definitions", rule_id)?;
    deserialize_optional_entity(item, "rule")
}

pub fn rule_save(root: &Path, rule: RuleMutationPayload) -> AppResult<RuleDefinition> {
    ensure_topology(root)?;
    let mut rule = mutation_payload_to_value(rule);
    let idempotency_key = extract_required_idempotency_key(&mut rule, "rule.save")?;
    let expected_revision = pop_expected_revision(&mut rule);
    let payload = json!({"rule": rule, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "rule.save",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let saved = upsert_json_entity(root, "rules/definitions", "rule", rule.clone(), expected_revision)?;
            deserialize_entity(saved, "rule")
        },
    )
}

pub fn rule_update(
    root: &Path,
    rule_id: &str,
    patch: RuleMutationPayload,
) -> AppResult<RuleDefinition> {
    ensure_topology(root)?;
    let mut patch = mutation_payload_to_value(patch);
    let idempotency_key = extract_required_idempotency_key(&mut patch, "rule.update")?;
    let expected_revision = pop_expected_revision(&mut patch);
    let payload = json!({"ruleId": rule_id, "patch": patch, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "rule.update",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let saved = patch_json_entity(
                root,
                "rules/definitions",
                "rule",
                rule_id,
                patch.clone(),
                expected_revision,
            )?;
            deserialize_entity(saved, "rule")
        },
    )
}

pub fn rule_evaluate(
    root: &Path,
    rule_id: &str,
    input: RuleEvaluateRequest,
) -> AppResult<RuleEvaluationResult> {
    ensure_topology(root)?;
    let mut input = serde_json::to_value(input)?;
    let idempotency_key = extract_required_idempotency_key(&mut input, "rule.evaluate")?;
    with_idempotency(
        root,
        "rule.evaluate",
        Some(idempotency_key.as_str()),
        &json!({"ruleId": rule_id, "input": input}),
        || rule_evaluate_inner(root, rule_id, input.clone()),
    )
}

fn rule_evaluate_inner(
    root: &Path,
    rule_id: &str,
    input: Value,
) -> AppResult<RuleEvaluationResult> {
    let Some(rule) = get_json_entity(root, "rules/definitions", rule_id)? else {
        return Err(AppError::NotFound(format!("Rule '{}' not found", rule_id)));
    };
    let context = input.get("context").cloned().unwrap_or(input);
    let conditions = rule
        .get("conditions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut traces = Vec::new();
    let mut matched = true;
    for condition in &conditions {
        let passed = evaluate_rule_condition(&context, condition);
        traces.push(json!({
            "condition": condition,
            "passed": passed
        }));
        if !passed {
            matched = false;
        }
    }

    let result = RuleEvaluationResult {
        rule_id: rule_id.to_string(),
        matched,
        evaluated_at: Utc::now(),
        trace: traces,
    };
    append_event(
        root,
        build_event(
            "rule.evaluated",
            None,
            json!({
                "ruleId": rule_id,
                "matched": matched
            }),
        ),
    )?;
    Ok(result)
}

pub fn jobs_list(
    root: &Path,
    limit: Option<u32>,
    cursor: Option<String>,
    enabled: Option<bool>,
) -> AppResult<PageResponse<JobDefinition>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "jobs/schedules")?;
    if let Some(enabled) = enabled {
        items.retain(|item| item.get("enabled").and_then(Value::as_bool) == Some(enabled));
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "job")
}

pub fn job_get(root: &Path, job_id: &str) -> AppResult<Option<JobDefinition>> {
    ensure_topology(root)?;
    let item = get_json_entity(root, "jobs/schedules", job_id)?;
    deserialize_optional_entity(item, "job")
}

pub fn job_save(root: &Path, job: JobMutationPayload) -> AppResult<JobDefinition> {
    ensure_topology(root)?;
    let mut job = mutation_payload_to_value(job);
    let idempotency_key = extract_required_idempotency_key(&mut job, "job.save")?;
    let expected_revision = pop_expected_revision(&mut job);
    let payload = json!({"job": job, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "job.save",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let saved = upsert_json_entity(root, "jobs/schedules", "job", job.clone(), expected_revision)?;
            deserialize_entity(saved, "job")
        },
    )
}

pub fn job_update(
    root: &Path,
    job_id: &str,
    patch: JobMutationPayload,
) -> AppResult<JobDefinition> {
    ensure_topology(root)?;
    let mut patch = mutation_payload_to_value(patch);
    let idempotency_key = extract_required_idempotency_key(&mut patch, "job.update")?;
    let expected_revision = pop_expected_revision(&mut patch);
    let payload = json!({"jobId": job_id, "patch": patch, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "job.update",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let saved = patch_json_entity(
                root,
                "jobs/schedules",
                "job",
                job_id,
                patch.clone(),
                expected_revision,
            )?;
            deserialize_entity(saved, "job")
        },
    )
}

pub fn job_run(
    root: &Path,
    job_id: &str,
    payload: Option<Value>,
    idempotency_key: Option<String>,
) -> AppResult<JobRunRecord> {
    ensure_topology(root)?;
    let Some(job) = job_get(root, job_id)? else {
        return Err(AppError::NotFound(format!("Job '{}' not found", job_id)));
    };
    let key = idempotency_key.clone();
    let key_for_record = key.clone();
    with_idempotency(
        root,
        "job.run",
        key.as_deref(),
        &json!({"jobId": job_id, "payload": payload, "idempotencyKey": idempotency_key}),
        || {
            let now = Utc::now();
            let run_id = format!("jobrun_{}", Uuid::new_v4().simple());
            let run = json!({
                "id": run_id,
                "jobId": job_id,
                "status": "succeeded",
                "trigger": "manual",
                "attempt": 1,
                "startedAt": now,
                "finishedAt": now,
                "idempotencyKey": key_for_record.clone().unwrap_or_else(|| format!("generated_{}", Uuid::new_v4().simple())),
                "payload": payload,
                "jobSnapshot": job
            });
            upsert_json_entity(root, "jobs/runs", "jobrun", run, None)
                .and_then(|saved| {
                    append_event(
                        root,
                        build_event(
                            "job.run.started",
                            None,
                            json!({"jobRunId": saved.get("id"), "jobId": job_id}),
                        ),
                    )?;
                    append_event(
                        root,
                        build_event(
                            "job.run.completed",
                            None,
                            json!({"jobRunId": saved.get("id"), "jobId": job_id}),
                        ),
                    )?;
                    deserialize_entity(saved, "job run")
                })
        },
    )
}

pub fn job_runs_list(
    root: &Path,
    job_id: Option<String>,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<JobRunRecord>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "jobs/runs")?;
    if let Some(job_id) = job_id.as_ref() {
        items.retain(|item| item.get("jobId").and_then(Value::as_str) == Some(job_id.as_str()));
    }
    if let Some(status) = status.as_ref() {
        items.retain(|item| item.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "job run")
}

pub fn job_run_get(root: &Path, run_id: &str) -> AppResult<Option<JobRunRecord>> {
    ensure_topology(root)?;
    let item = get_json_entity(root, "jobs/runs", run_id)?;
    deserialize_optional_entity(item, "job run")
}

pub fn decisions_list(
    root: &Path,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<DecisionPrompt>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "prompts/pending")?;
    items.extend(list_json_entities(root, "prompts/resolved")?);
    if let Some(status) = status.as_ref() {
        items.retain(|item| item.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "decision")
}

pub fn decision_create(root: &Path, prompt: DecisionMutationPayload) -> AppResult<DecisionPrompt> {
    ensure_topology(root)?;
    let mut prompt = mutation_payload_to_value(prompt);
    let idempotency_key = extract_required_idempotency_key(&mut prompt, "decision.create")?;
    let expected_revision = pop_expected_revision(&mut prompt);
    let payload = json!({"prompt": prompt, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "decision.create",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let mut saved = upsert_json_entity(root, "prompts/pending", "decision", prompt.clone(), expected_revision)?;
            if let Some(obj) = saved.as_object_mut() {
                if !obj.contains_key("status") {
                    obj.insert("status".to_string(), Value::String("pending".to_string()));
                }
            }
            let id = saved.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
            write_json_file(&json_entity_path(root, "prompts/pending", &id), &saved)?;
            append_event(
                root,
                build_event("decision.created", None, json!({"decisionId": id})),
            )?;
            deserialize_entity(saved, "decision")
        },
    )
}

pub fn decision_get(root: &Path, decision_id: &str) -> AppResult<Option<DecisionPrompt>> {
    ensure_topology(root)?;
    if let Some(value) = get_json_entity(root, "prompts/pending", decision_id)? {
        return deserialize_optional_entity(Some(value), "decision");
    }
    let value = get_json_entity(root, "prompts/resolved", decision_id)?;
    deserialize_optional_entity(value, "decision")
}

pub fn decision_resolve(
    root: &Path,
    decision_id: &str,
    option_id: String,
    notes: Option<String>,
    idempotency_key: Option<String>,
) -> AppResult<DecisionPrompt> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "decision.resolve",
        key.as_deref(),
        &json!({"decisionId": decision_id, "optionId": option_id, "notes": notes}),
        || {
            let (mut decision, current_path) = load_required_decision(root, decision_id)?;
            let obj = get_object_mut(&mut decision)?;
            let now = Utc::now();
            obj.insert("status".to_string(), Value::String("resolved".to_string()));
            obj.insert("resolvedOptionId".to_string(), Value::String(option_id.clone()));
            if let Some(notes) = notes.clone() {
                obj.insert("resolutionNotes".to_string(), Value::String(notes));
            }
            obj.insert("resolvedAt".to_string(), Value::String(now.to_rfc3339()));
            bump_json_revision(obj, now);

            let target = json_entity_path(root, "prompts/resolved", decision_id);
            write_json_file(&target, &decision)?;
            if current_path != target && current_path.exists() {
                let _ = fs::remove_file(current_path);
            }
            append_event(
                root,
                build_event(
                    "decision.resolved",
                    None,
                    json!({"decisionId": decision_id, "optionId": option_id}),
                ),
            )?;
            deserialize_entity(decision, "decision")
        },
    )
}

pub fn decision_snooze(
    root: &Path,
    decision_id: &str,
    snoozed_until: Option<DateTime<Utc>>,
    idempotency_key: Option<String>,
) -> AppResult<DecisionPrompt> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "decision.snooze",
        key.as_deref(),
        &json!({"decisionId": decision_id, "snoozedUntil": snoozed_until}),
        || {
            let (mut decision, path) = load_required_decision(root, decision_id)?;
            let obj = get_object_mut(&mut decision)?;
            let now = Utc::now();
            obj.insert("status".to_string(), Value::String("snoozed".to_string()));
            if let Some(until) = snoozed_until {
                obj.insert("snoozedUntil".to_string(), Value::String(until.to_rfc3339()));
            } else {
                obj.remove("snoozedUntil");
            }
            bump_json_revision(obj, now);
            write_json_file(&path, &decision)?;
            deserialize_entity(decision, "decision")
        },
    )
}

pub fn decision_dismiss(
    root: &Path,
    decision_id: &str,
    reason: Option<String>,
    idempotency_key: Option<String>,
) -> AppResult<DecisionPrompt> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "decision.dismiss",
        key.as_deref(),
        &json!({"decisionId": decision_id, "reason": reason}),
        || {
            let (mut decision, current_path) = load_required_decision(root, decision_id)?;
            let obj = get_object_mut(&mut decision)?;
            let now = Utc::now();
            obj.insert("status".to_string(), Value::String("dismissed".to_string()));
            if let Some(reason) = reason.clone() {
                obj.insert("resolutionNotes".to_string(), Value::String(reason));
            }
            obj.insert("resolvedAt".to_string(), Value::String(now.to_rfc3339()));
            bump_json_revision(obj, now);

            let target = json_entity_path(root, "prompts/resolved", decision_id);
            write_json_file(&target, &decision)?;
            if current_path != target && current_path.exists() {
                let _ = fs::remove_file(current_path);
            }
            deserialize_entity(decision, "decision")
        },
    )
}

pub fn work_sessions_list(
    root: &Path,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<WorkSessionRecord>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "sessions/work")?;
    if let Some(status) = status.as_ref() {
        items.retain(|item| item.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "work session")
}

pub fn work_session_get(root: &Path, session_id: &str) -> AppResult<Option<WorkSessionRecord>> {
    ensure_topology(root)?;
    let item = get_json_entity(root, "sessions/work", session_id)?;
    deserialize_optional_entity(item, "work session")
}

pub fn work_session_start(root: &Path, request: WorkSessionStartRequest) -> AppResult<WorkSessionRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(root, "work.session.start", key.as_deref(), &request, || {
        let now = Utc::now();
        let session = json!({
            "id": format!("ws_{}", Uuid::new_v4().simple()),
            "status": "running",
            "focusBlockIds": request.focus_block_ids.clone().unwrap_or_default(),
            "startedAt": now,
            "notes": request.note.clone().map(|note| vec![note]).unwrap_or_default(),
        });
        let saved = upsert_json_entity(root, "sessions/work", "work_session", session, None)?;
        append_event(
            root,
            build_event("work.session.started", None, json!({"sessionId": saved.get("id")})),
        )?;
        deserialize_entity(saved, "work session")
    })
}

pub fn work_session_note(
    root: &Path,
    session_id: &str,
    request: WorkSessionNoteRequest,
) -> AppResult<WorkSessionRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "work.session.note",
        key.as_deref(),
        &json!({"sessionId": session_id, "request": request}),
        || {
            let mut session = get_json_entity(root, "sessions/work", session_id)?
                .ok_or_else(|| AppError::NotFound(format!("Work session '{}' not found", session_id)))?;
            let current_revision = session.get("revision").and_then(Value::as_i64).unwrap_or(0);
            if current_revision != request.expected_revision {
                return Err(conflict_payload_error(
                    "work_session",
                    request.expected_revision,
                    current_revision,
                    &session,
                ));
            }

            let obj = get_object_mut(&mut session)?;
            let notes = obj
                .entry("notes".to_string())
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Value::Array(items) = notes {
                items.push(Value::String(request.note.clone()));
            }
            bump_json_revision(obj, Utc::now());
            write_json_file(&json_entity_path(root, "sessions/work", session_id), &session)?;
            append_event(
                root,
                build_event(
                    "work.session.noted",
                    None,
                    json!({"sessionId": session_id, "note": request.note}),
                ),
            )?;
            deserialize_entity(session, "work session")
        },
    )
}

pub fn work_session_end(
    root: &Path,
    session_id: &str,
    request: WorkSessionEndRequest,
) -> AppResult<WorkSessionRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "work.session.end",
        key.as_deref(),
        &json!({"sessionId": session_id, "request": request}),
        || {
            let mut patch = json!({
                "status": "ended",
                "endedAt": Utc::now()
            });
            if let Some(summary_note) = request.summary_note.clone() {
                patch["summaryNote"] = Value::String(summary_note);
            }
            let saved = patch_json_entity(
                root,
                "sessions/work",
                "work_session",
                session_id,
                patch,
                Some(request.expected_revision),
            )?;
            append_event(
                root,
                build_event("work.session.ended", None, json!({"sessionId": session_id})),
            )?;
            deserialize_entity(saved, "work session")
        },
    )
}

pub fn work_session_cancel(
    root: &Path,
    session_id: &str,
    request: WorkSessionCancelRequest,
) -> AppResult<WorkSessionRecord> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "work.session.cancel",
        key.as_deref(),
        &json!({"sessionId": session_id, "request": request}),
        || {
            let mut patch = json!({
                "status": "canceled",
                "canceledAt": Utc::now()
            });
            if let Some(reason) = request.reason.clone() {
                patch["summaryNote"] = Value::String(reason);
            }
            let saved = patch_json_entity(
                root,
                "sessions/work",
                "work_session",
                session_id,
                patch,
                Some(request.expected_revision),
            )?;
            append_event(
                root,
                build_event(
                    "work.session.canceled",
                    None,
                    json!({"sessionId": session_id}),
                ),
            )?;
            deserialize_entity(saved, "work session")
        },
    )
}

pub fn recurrence_templates_list(
    root: &Path,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<RecurrenceTemplate>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "recurrence/templates")?;
    if let Some(status) = status.as_ref() {
        items.retain(|item| item.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "recurrence template")
}

pub fn recurrence_template_get(
    root: &Path,
    template_id: &str,
) -> AppResult<Option<RecurrenceTemplate>> {
    ensure_topology(root)?;
    let value = get_json_entity(root, "recurrence/templates", template_id)?;
    deserialize_optional_entity(value, "recurrence template")
}

pub fn recurrence_template_save(
    root: &Path,
    template: WorkspaceMutationPayload,
) -> AppResult<RecurrenceTemplate> {
    ensure_topology(root)?;
    let mut template = mutation_payload_to_value(template);
    let idempotency_key = extract_required_idempotency_key(&mut template, "recurrence.template.save")?;
    let expected_revision = pop_expected_revision(&mut template);
    with_idempotency(
        root,
        "recurrence.template.save",
        Some(idempotency_key.as_str()),
        &json!({"template": template, "expectedRevision": expected_revision}),
        || {
            let obj = get_object_mut(&mut template)?;
            obj.entry("schemaVersion".to_string())
                .or_insert_with(|| Value::from(1));
            obj.entry("status".to_string())
                .or_insert_with(|| Value::String("active".to_string()));
            obj.entry("frequency".to_string())
                .or_insert_with(|| Value::String("daily".to_string()));
            obj.entry("interval".to_string())
                .or_insert_with(|| Value::from(1));
            obj.entry("titleTemplate".to_string())
                .or_insert_with(|| Value::String("Recurring item".to_string()));
            obj.entry("rawTextTemplate".to_string())
                .or_insert_with(|| Value::String("- [ ] Recurring item".to_string()));
            let saved = upsert_json_entity(
                root,
                "recurrence/templates",
                "recurrence_template",
                template.clone(),
                expected_revision,
            )?;
            deserialize_entity(saved, "recurrence template")
        },
    )
}

pub fn recurrence_template_update(
    root: &Path,
    template_id: &str,
    patch: WorkspaceMutationPayload,
) -> AppResult<RecurrenceTemplate> {
    ensure_topology(root)?;
    let mut patch = mutation_payload_to_value(patch);
    let idempotency_key = extract_required_idempotency_key(&mut patch, "recurrence.template.update")?;
    let expected_revision = pop_expected_revision(&mut patch);
    with_idempotency(
        root,
        "recurrence.template.update",
        Some(idempotency_key.as_str()),
        &json!({"templateId": template_id, "patch": patch, "expectedRevision": expected_revision}),
        || {
            let saved = patch_json_entity(
                root,
                "recurrence/templates",
                "recurrence_template",
                template_id,
                patch.clone(),
                expected_revision,
            )?;
            deserialize_entity(saved, "recurrence template")
        },
    )
}

pub fn recurrence_instances_list(
    root: &Path,
    template_id: Option<String>,
    status: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<RecurrenceInstance>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "recurrence/instances")?;
    if let Some(template_id) = template_id.as_ref() {
        items.retain(|item| item.get("templateId").and_then(Value::as_str) == Some(template_id.as_str()));
    }
    if let Some(status) = status.as_ref() {
        items.retain(|item| item.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "recurrence instance")
}

pub fn recurrence_spawn(
    root: &Path,
    request: RecurrenceSpawnRequest,
) -> AppResult<RecurrenceSpawnResponse> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(root, "recurrence.spawn", key.as_deref(), &request, || {
        recurrence_spawn_inner(root, request.clone())
    })
}

fn recurrence_spawn_inner(root: &Path, request: RecurrenceSpawnRequest) -> AppResult<RecurrenceSpawnResponse> {
    let now = request.now.unwrap_or_else(Utc::now);
    let allowed_ids: Option<HashSet<String>> = request.template_ids.map(|ids| ids.into_iter().collect());
    let templates = recurrence_templates_list(root, Some("active".to_string()), Some(500), None)?.items;
    let mut spawned_instance_ids = Vec::new();
    let mut touched_template_ids = Vec::new();

    for template in templates {
        if let Some(allowed) = allowed_ids.as_ref() {
            if !allowed.contains(&template.id) {
                continue;
            }
        }
        let next_run_at = template.next_run_at.unwrap_or(template.created_at);
        if next_run_at > now {
            continue;
        }
        let interval_next = next_recurrence_run(&template, next_run_at);
        if now > interval_next {
            let _ = upsert_system_decision(
                root,
                format!("recurrence-missed-cycle-{}", template.id),
                format!("Missed recurrence cycle: {}", template.title_template),
                "One or more recurrence cycles were missed. Decide whether to backfill or skip.".to_string(),
                Vec::new(),
            )?;
        }

        let capture = CreateBlockInNotepadRequest {
            notepad_id: template.default_notepad_id.clone().unwrap_or_else(|| "now".to_string()),
            raw_text: if template.raw_text_template.trim().is_empty() {
                template.title_template.clone()
            } else {
                template.raw_text_template.clone()
            },
            body: None,
            capture_source: Some(crate::models::CaptureSource::Agent),
            idempotency_key: None,
        };
        let block = notepad_block_create_inner(root, capture)?;
        let instance_value = json!({
            "id": format!("recurrence_instance_{}", Uuid::new_v4().simple()),
            "templateId": template.id,
            "status": "spawned",
            "scheduledFor": next_run_at,
            "spawnedAt": now,
            "atomId": block.atom_id,
            "blockId": block.id,
        });
        let instance = upsert_json_entity(root, "recurrence/instances", "recurrence_instance", instance_value, None)?;
        if let Some(id) = instance.get("id").and_then(Value::as_str) {
            spawned_instance_ids.push(id.to_string());
        }
        touched_template_ids.push(template.id.clone());

        let next_run = next_recurrence_run(&template, next_run_at);
        let _ = patch_json_entity(
            root,
            "recurrence/templates",
            "recurrence_template",
            &template.id,
            json!({
                "lastSpawnedAt": now,
                "nextRunAt": next_run
            }),
            Some(template.revision),
        )?;
    }

    Ok(RecurrenceSpawnResponse {
        accepted: true,
        spawned_instance_ids,
        touched_template_ids,
    })
}

pub fn system_apply_attention_update(
    root: &Path,
    request: AttentionUpdateRequest,
) -> AppResult<AttentionUpdateResponse> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "system.apply_attention_update",
        key.as_deref(),
        &request,
        || system_apply_attention_update_inner(root, request.clone()),
    )
}

fn system_apply_attention_update_inner(
    root: &Path,
    request: AttentionUpdateRequest,
) -> AppResult<AttentionUpdateResponse> {
    let now = request.now.unwrap_or_else(Utc::now);
    let mut atoms = load_all_atoms(root)?;
    let active_conditions = load_active_conditions_by_atom(root)?;
    let mut updated_atom_ids = Vec::new();
    let mut candidates: Vec<(String, f64, bool, crate::models::AttentionLayer, Option<String>)> = Vec::new();

    for atom in &atoms {
        if atom.archived_at.is_some() {
            continue;
        }
        let Some(task) = atom.facet_data.task.as_ref() else {
            continue;
        };
        if matches!(task.status, TaskStatus::Done | TaskStatus::Archived) {
            continue;
        }
        let condition = active_conditions
            .get(&atom.id)
            .and_then(|items| items.first());
        let hidden_reason = condition.map(|entry| format!("condition:{}", entry.mode));
        let heat = compute_heat_score(atom, now);
        let mut next_layer = derive_attention_layer(task, heat, now);
        let is_hidden = hidden_reason.is_some();
        if is_hidden {
            next_layer = crate::models::AttentionLayer::Long;
        }
        candidates.push((atom.id.clone(), heat, is_hidden, next_layer, hidden_reason));
    }

    let mut visible = candidates
        .iter()
        .filter(|(_, _, hidden, _, _)| !hidden)
        .map(|(id, heat, _, _, _)| (id.clone(), *heat))
        .collect::<Vec<_>>();
    visible.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));

    let l3_allowed = visible
        .iter()
        .take(3)
        .map(|(id, _)| id.clone())
        .collect::<HashSet<_>>();
    let ram_allowed = visible
        .iter()
        .skip(3)
        .take(18)
        .map(|(id, _)| id.clone())
        .collect::<HashSet<_>>();

    for atom in atoms.iter_mut() {
        let Some(task) = atom.facet_data.task.as_ref() else {
            continue;
        };
        let Some((_, heat, hidden, mut layer, hidden_reason)) = candidates
            .iter()
            .find(|(atom_id, _, _, _, _)| atom_id == &atom.id)
            .cloned()
        else {
            continue;
        };

        if !hidden {
            if l3_allowed.contains(&atom.id) {
                layer = crate::models::AttentionLayer::L3;
            } else if ram_allowed.contains(&atom.id) {
                layer = crate::models::AttentionLayer::Ram;
            } else if layer == crate::models::AttentionLayer::L3 || layer == crate::models::AttentionLayer::Ram {
                layer = crate::models::AttentionLayer::Short;
            }
        }

        let current_layer = task.attention_layer;
        if current_layer != Some(layer) && should_preserve_dwell(atom, layer, now) {
            continue;
        }

        let mut changed = false;
        if let Some(task_mut) = atom.facet_data.task.as_mut() {
            if task_mut.attention_layer != Some(layer) {
                task_mut.attention_layer = Some(layer);
                changed = true;
            }
        }

        let mut attention = atom.facet_data.attention.clone().unwrap_or_default();
        if attention.layer != layer {
            attention.layer = layer;
            attention.last_promoted_at = Some(now);
            changed = true;
        }
        if attention.heat_score != Some(heat) {
            attention.heat_score = Some(heat);
            changed = true;
        }
        if attention.dwell_started_at.is_none() || changed {
            attention.dwell_started_at = Some(now);
        }
        attention.hidden_reason = hidden_reason;
        atom.facet_data.attention = Some(attention);

        if changed {
            let previous_status = atom_status(atom);
            atom.updated_at = Utc::now();
            atom.revision += 1;
            write_atom(root, Some(previous_status), atom)?;
            let _ = upsert_block_from_atom(root, atom)?;
            updated_atom_ids.push(atom.id.clone());
        }
    }

    let mut decision_ids = Vec::new();
    let l3_atoms: Vec<&AtomRecord> = atoms
        .iter()
        .filter(|atom| {
            atom.facet_data
                .task
                .as_ref()
                .and_then(|task| task.attention_layer)
                == Some(crate::models::AttentionLayer::L3)
        })
        .collect();
    if l3_atoms.len() > 3 {
        let atom_ids = l3_atoms
            .iter()
            .map(|atom| atom.id.clone())
            .collect::<Vec<_>>();
        let decision_id = upsert_system_decision(
            root,
            "attention-l3-overflow".to_string(),
            "L3 overflow detected".to_string(),
            "More than 3 tasks are currently in L3. Choose tasks to keep hot.".to_string(),
            atom_ids,
        )?;
        decision_ids.push(decision_id);
    }

    Ok(AttentionUpdateResponse {
        accepted: true,
        updated_atom_ids,
        decision_ids,
    })
}

pub fn system_generate_decision_cards(
    root: &Path,
    request: DecisionGenerateRequest,
) -> AppResult<DecisionGenerateResponse> {
    ensure_topology(root)?;
    let key = request.idempotency_key.clone();
    with_idempotency(
        root,
        "system.generate_decision_cards",
        key.as_deref(),
        &request,
        || system_generate_decision_cards_inner(root, request.clone()),
    )
}

fn system_generate_decision_cards_inner(
    root: &Path,
    request: DecisionGenerateRequest,
) -> AppResult<DecisionGenerateResponse> {
    let now = request.now.unwrap_or_else(Utc::now);
    let atoms = load_all_atoms(root)?;
    let mut created_or_updated_ids = Vec::new();

    for atom in atoms {
        let Some(task) = atom.facet_data.task.as_ref() else {
            continue;
        };
        if matches!(task.status, TaskStatus::Done | TaskStatus::Archived) {
            continue;
        }

        if let Some(hard_due_at) = task.hard_due_at {
            if hard_due_at < now {
                let decision_id = upsert_system_decision(
                    root,
                    format!("overdue-hard-due-{}", atom.id),
                    format!("Overdue task: {}", task.title),
                    "Hard due date has passed. Choose whether to do now, reschedule, or de-scope.".to_string(),
                    vec![atom.id.clone()],
                )?;
                created_or_updated_ids.push(decision_id);
            }
        }

        if task.status == TaskStatus::Blocked && atom.facet_data.blocking.is_none() {
            let decision_id = upsert_system_decision(
                root,
                format!("blocked-missing-condition-{}", atom.id),
                format!("Blocked task missing condition: {}", task.title),
                "Task is blocked but no explicit unblock condition is set.".to_string(),
                vec![atom.id.clone()],
            )?;
            created_or_updated_ids.push(decision_id);
        }
    }

    created_or_updated_ids.sort();
    created_or_updated_ids.dedup();
    Ok(DecisionGenerateResponse {
        accepted: true,
        created_or_updated_ids,
    })
}

pub fn notification_channels_list(root: &Path) -> AppResult<Vec<String>> {
    ensure_topology(root)?;
    Ok(vec!["in_app".to_string()])
}

pub fn notification_send(
    root: &Path,
    message: NotificationMutationPayload,
) -> AppResult<NotificationMessage> {
    ensure_topology(root)?;
    let mut message = mutation_payload_to_value(message);
    let idempotency_key = extract_required_idempotency_key(&mut message, "notification.send")?;
    with_idempotency(
        root,
        "notification.send",
        Some(idempotency_key.as_str()),
        &message,
        || {
            let mut saved = upsert_json_entity(root, "notifications/messages", "message", message.clone(), None)?;
            let message_id = saved
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if let Some(obj) = saved.as_object_mut() {
                obj.entry("channel".to_string())
                    .or_insert_with(|| Value::String("in_app".to_string()));
                obj.entry("priority".to_string()).or_insert_with(|| Value::from(3));
                write_json_file(&json_entity_path(root, "notifications/messages", &message_id), &saved)?;
            }

            let delivery = json!({
                "id": format!("delivery_{}", Uuid::new_v4().simple()),
                "messageId": message_id,
                "status": "delivered",
                "attemptedAt": Utc::now(),
                "providerMessageId": format!("inapp_{}", Uuid::new_v4().simple()),
            });
            let _ = upsert_json_entity(root, "notifications/deliveries", "delivery", delivery, None)?;
            append_event(
                root,
                build_event(
                    "notification.sent",
                    None,
                    json!({
                        "messageId": saved.get("id"),
                        "channel": saved.get("channel").cloned().unwrap_or(Value::String("in_app".to_string()))
                    }),
                ),
            )?;
            deserialize_entity(saved, "notification message")
        },
    )
}

pub fn notification_deliveries_list(
    root: &Path,
    status: Option<String>,
    channel: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<NotificationDeliveryRecord>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "notifications/deliveries")?;
    if let Some(status) = status.as_ref() {
        items.retain(|item| item.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    if let Some(channel) = channel.as_ref() {
        let messages = list_json_entities(root, "notifications/messages")?;
        let allowed_ids: HashSet<String> = messages
            .into_iter()
            .filter(|message| message.get("channel").and_then(Value::as_str) == Some(channel.as_str()))
            .filter_map(|message| message.get("id").and_then(Value::as_str).map(|value| value.to_string()))
            .collect();
        items.retain(|item| {
            item.get("messageId")
                .and_then(Value::as_str)
                .map(|id| allowed_ids.contains(id))
                .unwrap_or(false)
        });
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "notification delivery")
}

pub fn projections_list(
    root: &Path,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<ProjectionDefinition>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "projections/manifests")?;
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "projection")
}

pub fn projection_get(root: &Path, projection_id: &str) -> AppResult<Option<ProjectionDefinition>> {
    ensure_topology(root)?;
    let item = get_json_entity(root, "projections/manifests", projection_id)?;
    deserialize_optional_entity(item, "projection")
}

pub fn projection_save(
    root: &Path,
    projection: ProjectionMutationPayload,
) -> AppResult<ProjectionDefinition> {
    ensure_topology(root)?;
    let mut projection = mutation_payload_to_value(projection);
    let idempotency_key = extract_required_idempotency_key(&mut projection, "projection.save")?;
    let expected_revision = pop_expected_revision(&mut projection);
    let payload = json!({"projection": projection, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "projection.save",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let saved = upsert_json_entity(
                root,
                "projections/manifests",
                "projection",
                projection.clone(),
                expected_revision,
            )?;
            deserialize_entity(saved, "projection")
        },
    )
}

pub fn projection_checkpoint_get(root: &Path, projection_id: &str) -> AppResult<ProjectionCheckpoint> {
    ensure_topology(root)?;
    let path = json_entity_path(root, "projections/snapshots", projection_id);
    if path.exists() {
        let value = read_json_file(&path)?;
        return deserialize_entity(value, "projection checkpoint");
    }
    deserialize_entity(
        json!({
        "projectionId": projection_id,
        "status": "healthy"
    }),
        "projection checkpoint",
    )
}

pub fn projection_refresh(
    root: &Path,
    projection_id: &str,
    mode: Option<String>,
    idempotency_key: Option<String>,
) -> AppResult<ProjectionCheckpoint> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "projection.refresh",
        key.as_deref(),
        &json!({"projectionId": projection_id, "mode": mode}),
        || {
            let checkpoint = json!({
                "projectionId": projection_id,
                "lastEventCursor": latest_event_timestamp(root)?.map(|ts| ts.to_rfc3339()),
                "lastRebuiltAt": Utc::now(),
                "status": "healthy",
                "mode": mode.clone().unwrap_or_else(|| "incremental".to_string())
            });
            let saved = upsert_json_entity(
                root,
                "projections/snapshots",
                "checkpoint",
                checkpoint,
                None,
            )?;
            append_event(
                root,
                build_event(
                    "projection.refreshed",
                    None,
                    json!({"projectionId": projection_id}),
                ),
            )?;
            deserialize_entity(saved, "projection checkpoint")
        },
    )
}

pub fn projection_rebuild(
    root: &Path,
    projection_ids: Option<Vec<String>>,
    idempotency_key: Option<String>,
) -> AppResult<ProjectionRebuildResponse> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "projection.rebuild",
        key.as_deref(),
        &json!({"projectionIds": projection_ids}),
        || {
            let targets = if let Some(ids) = projection_ids.clone() {
                ids
            } else {
                list_json_entities(root, "projections/manifests")?
                    .into_iter()
                    .filter_map(|value| value.get("id").and_then(Value::as_str).map(|value| value.to_string()))
                    .collect()
            };
            let mut job_run_ids = Vec::new();
            for projection_id in targets {
                let run = json!({
                    "id": format!("jobrun_{}", Uuid::new_v4().simple()),
                    "jobId": format!("projection.rebuild.{}", projection_id),
                    "status": "succeeded",
                    "trigger": "manual",
                    "attempt": 1,
                    "startedAt": Utc::now(),
                    "finishedAt": Utc::now(),
                    "idempotencyKey": format!("projection_rebuild_{}", projection_id),
                });
                let saved = upsert_json_entity(root, "jobs/runs", "jobrun", run, None)?;
                if let Some(run_id) = saved.get("id").and_then(Value::as_str) {
                    job_run_ids.push(run_id.to_string());
                }
                let _ = projection_refresh(
                    root,
                    &projection_id,
                    Some("full".to_string()),
                    Some(format!("projection-refresh-{}", projection_id)),
                )?;
            }
            deserialize_entity(json!({
                "accepted": true,
                "jobRunIds": job_run_ids
            }), "projection rebuild response")
        },
    )
}

pub fn registry_entries_list(
    root: &Path,
    kind: Option<String>,
    status: Option<String>,
    search: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> AppResult<PageResponse<RegistryEntry>> {
    ensure_topology(root)?;
    let mut items = list_json_entities(root, "registry")?;
    if let Some(kind) = kind.as_ref() {
        items.retain(|item| item.get("kind").and_then(Value::as_str) == Some(kind.as_str()));
    }
    if let Some(status) = status.as_ref() {
        items.retain(|item| item.get("status").and_then(Value::as_str) == Some(status.as_str()));
    }
    if let Some(search) = search.as_ref() {
        let needle = search.to_ascii_lowercase();
        items.retain(|item| {
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_ascii_lowercase();
            let aliases = item
                .get("aliases")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|value| value.to_ascii_lowercase())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            name.contains(&needle) || aliases.iter().any(|value| value.contains(&needle))
        });
    }
    sort_json_by_updated_at_desc(&mut items);
    let page = paginate(items, limit, cursor)?;
    deserialize_page(page, "registry entry")
}

pub fn registry_entry_get(root: &Path, entry_id: &str) -> AppResult<Option<RegistryEntry>> {
    ensure_topology(root)?;
    let item = get_json_entity(root, "registry", entry_id)?;
    deserialize_optional_entity(item, "registry entry")
}

pub fn registry_entry_save(
    root: &Path,
    entry: RegistryMutationPayload,
) -> AppResult<RegistryEntry> {
    ensure_topology(root)?;
    let mut entry = mutation_payload_to_value(entry);
    let idempotency_key = extract_required_idempotency_key(&mut entry, "registry.entry.save")?;
    let expected_revision = pop_expected_revision(&mut entry);
    validate_registry_uniqueness(root, &entry, entry.get("id").and_then(Value::as_str))?;
    let payload = json!({"entry": entry, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "registry.entry.save",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let saved = upsert_json_entity(root, "registry", "registry", entry.clone(), expected_revision)?;
            deserialize_entity(saved, "registry entry")
        },
    )
}

pub fn registry_entry_update(
    root: &Path,
    entry_id: &str,
    patch: RegistryMutationPayload,
) -> AppResult<RegistryEntry> {
    ensure_topology(root)?;
    let mut patch = mutation_payload_to_value(patch);
    let idempotency_key = extract_required_idempotency_key(&mut patch, "registry.entry.update")?;
    let expected_revision = pop_expected_revision(&mut patch);
    let mut existing = get_json_entity(root, "registry", entry_id)?
        .ok_or_else(|| AppError::NotFound(format!("registry '{}' not found", entry_id)))?;
    merge_json_values(&mut existing, patch.clone());
    validate_registry_uniqueness(root, &existing, Some(entry_id))?;
    let payload = json!({"entryId": entry_id, "patch": patch, "expectedRevision": expected_revision});
    with_idempotency(
        root,
        "registry.entry.update",
        Some(idempotency_key.as_str()),
        &payload,
        || {
            let saved = patch_json_entity(
                root,
                "registry",
                "registry",
                entry_id,
                patch.clone(),
                expected_revision,
            )?;
            deserialize_entity(saved, "registry entry")
        },
    )
}

pub fn registry_entry_delete(
    root: &Path,
    entry_id: &str,
    idempotency_key: Option<String>,
) -> AppResult<BooleanResponse> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "registry.entry.delete",
        key.as_deref(),
        &json!({"entryId": entry_id}),
        || {
            let path = json_entity_path(root, "registry", entry_id);
            if !path.exists() {
                return Ok(BooleanResponse { success: false });
            }
            fs::remove_file(path).map_err(|error| AppError::Io(error.to_string()))?;
            Ok(BooleanResponse { success: true })
        },
    )
}

pub fn registry_suggestions_list(
    root: &Path,
    text: String,
    kind: Option<String>,
) -> AppResult<RegistrySuggestionsResponse> {
    let entries = registry_entries_list(root, kind, Some("active".to_string()), None, Some(100), None)?;
    let needle = text.to_ascii_lowercase();
    let mut suggestions = BTreeSet::new();
    for item in entries.items {
        if item.name.to_ascii_lowercase().contains(&needle) {
            suggestions.insert(item.name.clone());
        }
        for alias in item.aliases {
            if alias.to_ascii_lowercase().contains(&needle) {
                suggestions.insert(alias);
            }
        }
    }
    Ok(RegistrySuggestionsResponse {
        suggestions: suggestions.into_iter().collect::<Vec<_>>(),
    })
}

pub fn semantic_search(root: &Path, request: SemanticSearchRequest) -> AppResult<SemanticSearchResponse> {
    ensure_topology(root)?;
    let query = request.query.trim().to_ascii_lowercase();
    let top_k = request.top_k.clamp(1, 100) as usize;
    let mut hits = Vec::new();
    if !query.is_empty() {
        for chunk in list_json_entities(root, "semantic/chunks")? {
            let text = chunk.get("text").and_then(Value::as_str).unwrap_or_default();
            let lowered = text.to_ascii_lowercase();
            if lowered.contains(&query) {
                let score = lexical_score(&lowered, &query);
                hits.push(SemanticSearchHit {
                    atom_id: chunk
                        .get("atomId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    chunk_id: chunk
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    score,
                    snippet: text.chars().take(200).collect::<String>(),
                });
            }
        }
    }

    if hits.is_empty() && !query.is_empty() {
        for atom in load_all_atoms(root)? {
            let mut text = atom.raw_text.clone();
            if let Some(body) = atom.body {
                text.push('\n');
                text.push_str(&body);
            }
            let lowered = text.to_ascii_lowercase();
            if lowered.contains(&query) {
                hits.push(SemanticSearchHit {
                    atom_id: atom.id,
                    chunk_id: format!("lexical_{}", Uuid::new_v4().simple()),
                    score: lexical_score(&lowered, &query),
                    snippet: text.chars().take(200).collect::<String>(),
                });
            }
        }
    }

    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
    hits.truncate(top_k);
    Ok(SemanticSearchResponse { hits })
}

pub fn semantic_reindex(
    root: &Path,
    atom_ids: Option<Vec<String>>,
    idempotency_key: Option<String>,
) -> AppResult<SemanticReindexResponse> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "semantic.reindex",
        key.as_deref(),
        &json!({"atomIds": atom_ids}),
        || semantic_reindex_inner(root, atom_ids.clone()),
    )
}

fn semantic_reindex_inner(
    root: &Path,
    atom_ids: Option<Vec<String>>,
) -> AppResult<SemanticReindexResponse> {
    let atoms = load_all_atoms(root)?;
    let scoped_atom_ids: Option<HashSet<String>> = atom_ids.map(|ids| ids.into_iter().collect());
    let selected: Vec<AtomRecord> = atoms
        .into_iter()
        .filter(|atom| {
            scoped_atom_ids
                .as_ref()
                .map(|allowed| allowed.contains(&atom.id))
                .unwrap_or(true)
        })
        .collect();

    let chunk_dir = root.join("semantic/chunks");
    for entry in fs::read_dir(&chunk_dir).map_err(|error| AppError::Io(error.to_string()))? {
        let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        let should_remove = if let Some(allowed) = scoped_atom_ids.as_ref() {
            match read_json_file::<Value>(&path) {
                Ok(value) => value
                    .get("atomId")
                    .and_then(Value::as_str)
                    .map(|atom_id| allowed.contains(atom_id))
                    .unwrap_or(false),
                Err(error) => {
                    tracing::warn!(path = %path.to_string_lossy(), error = %error, "failed reading existing semantic chunk; removing as safe fallback");
                    true
                }
            }
        } else {
            true
        };

        if should_remove {
            let _ = fs::remove_file(path);
        }
    }

    for atom in selected {
        let mut text = atom.raw_text.clone();
        if let Some(body) = atom.body.clone() {
            text.push('\n');
            text.push_str(&body);
        }
        let chunks = chunk_text(&text, 420);
        for (index, chunk_text) in chunks.into_iter().enumerate() {
            let hash = deterministic_hash(&chunk_text);
            let chunk = json!({
                "id": format!("chunk_{}", Uuid::new_v4().simple()),
                "atomId": atom.id,
                "chunkIndex": index,
                "text": chunk_text,
                "hash": hash,
                "updatedAt": Utc::now(),
            });
            let _ = upsert_json_entity(root, "semantic/chunks", "chunk", chunk, None)?;
        }
    }

    let persisted_chunks = list_json_entities(root, "semantic/chunks")?;
    let persisted_ids: Vec<String> = persisted_chunks
        .iter()
        .filter_map(|chunk| chunk.get("id").and_then(Value::as_str).map(|value| value.to_string()))
        .collect();
    let index = json!({
        "id": "semantic-index",
        "updatedAt": Utc::now(),
        "chunkIds": persisted_ids
    });
    let _ = upsert_json_entity(root, "semantic/index", "semantic-index", index, None)?;
    Ok(SemanticReindexResponse {
        accepted: true,
        job_run_id: format!("jobrun_{}", Uuid::new_v4().simple()),
    })
}

pub fn semantic_chunk_get(root: &Path, chunk_id: &str) -> AppResult<Option<SemanticChunk>> {
    ensure_topology(root)?;
    let value = get_json_entity(root, "semantic/chunks", chunk_id)?;
    deserialize_optional_entity(value, "semantic chunk")
}

pub fn governance_policies_get(root: &Path) -> AppResult<GovernancePoliciesResponse> {
    ensure_topology(root)?;
    let retention_file = root.join("governance/retention-policies.md");
    let sensitivity_file = root.join("governance/sensitivity-defaults.md");

    let retention_contents = fs::read_to_string(&retention_file).unwrap_or_default();
    let retention_policies: Vec<Value> = retention_contents
        .lines()
        .filter(|line| line.trim_start().starts_with("- "))
        .map(|line| line.trim_start_matches("- ").trim())
        .filter(|line| !line.is_empty())
        .map(|line| json!({"name": line, "id": sanitize_component(line)}))
        .collect();

    let default_sensitivity = fs::read_to_string(&sensitivity_file)
        .ok()
        .and_then(|text| {
            text.lines().find_map(|line| {
                line.strip_prefix("Default sensitivity:")
                    .map(|value| value.trim().to_ascii_lowercase())
            })
        })
        .unwrap_or_else(|| "internal".to_string());

    deserialize_entity(json!({
        "retentionPolicies": retention_policies,
        "defaultSensitivity": default_sensitivity
    }), "governance policies")
}

pub fn atom_governance_update(
    root: &Path,
    atom_id: &str,
    expected_revision: i64,
    governance: GovernanceMeta,
    idempotency_key: Option<String>,
) -> AppResult<AtomRecord> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "atom.governance.update",
        key.as_deref(),
        &json!({
            "atomId": atom_id,
            "expectedRevision": expected_revision,
            "governance": governance
        }),
        || {
            let mut atom = get_required_atom(root, atom_id)?;
            assert_revision(&atom, expected_revision)?;
            let previous_status = atom_status(&atom);
            atom.governance = governance.clone();
            atom.revision += 1;
            atom.updated_at = Utc::now();
            write_atom(root, Some(previous_status), &atom)?;
            append_event(
                root,
                build_event(
                    "governance.retention_applied",
                    Some(&atom.id),
                    json!({"atomId": atom.id, "policyId": atom.governance.retention_policy_id}),
                ),
            )?;
            Ok(atom)
        },
    )
}

pub fn feature_flags_list(root: &Path) -> AppResult<Vec<FeatureFlag>> {
    ensure_topology(root)?;
    let path = root.join("governance/feature-flags.json");
    if path.exists() {
        let values: Vec<Value> = read_json_file(&path)?;
        return values
            .into_iter()
            .map(|value| deserialize_entity(value, "feature flag"))
            .collect();
    }
    let defaults = default_feature_flags();
    write_json_file(&path, &defaults)?;
    defaults
        .into_iter()
        .map(|value| deserialize_entity(value, "feature flag"))
        .collect()
}

pub fn feature_flag_update(
    root: &Path,
    key: &str,
    enabled: bool,
    rollout_percent: Option<u32>,
    idempotency_key: Option<String>,
) -> AppResult<FeatureFlag> {
    ensure_topology(root)?;
    let key_idempotency = idempotency_key.clone();
    with_idempotency(
        root,
        "feature.flag.update",
        key_idempotency.as_deref(),
        &json!({
            "key": key,
            "enabled": enabled,
            "rolloutPercent": rollout_percent
        }),
        || {
            let mut flags = feature_flags_list(root)?;
            let now = Utc::now();
            if let Some(existing) = flags.iter_mut().find(|flag| flag.key == key) {
                existing.enabled = enabled;
                existing.rollout_percent = rollout_percent;
                existing.updated_at = now;
            } else {
                flags.push(FeatureFlag {
                    key: key.to_string(),
                    enabled,
                    rollout_percent,
                    updated_at: now,
                });
            }
            write_json_file(&root.join("governance/feature-flags.json"), &flags)?;
            let flag = flags
                .into_iter()
                .find(|flag| flag.key == key)
                .ok_or_else(|| AppError::Internal("feature flag update failed".to_string()))?;
            Ok(flag)
        },
    )
}

pub fn capability_snapshot_get(root: &Path) -> AppResult<WorkspaceCapabilitySnapshot> {
    ensure_topology(root)?;
    let capabilities = capabilities(root)?;
    let feature_flags = feature_flags_list(root)?;
    let semantic_available = fs::read_dir(root.join("semantic/chunks"))
        .map_err(|error| AppError::Io(error.to_string()))?
        .flatten()
        .any(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("json"));
    deserialize_entity(json!({
        "capturedAt": Utc::now(),
        "obsidianCliAvailable": capabilities.obsidian_cli_available,
        "baseQueryAvailable": capabilities.base_query_available,
        "semanticAvailable": semantic_available,
        "notificationChannels": ["in_app"],
        "featureFlags": feature_flags
    }), "workspace capability snapshot")
}

pub fn migration_plan_create(
    root: &Path,
    domain: String,
    from_version: i32,
    to_version: i32,
    dry_run: bool,
    idempotency_key: Option<String>,
) -> AppResult<MigrationPlan> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "migration.plan.create",
        key.as_deref(),
        &json!({
            "domain": domain,
            "fromVersion": from_version,
            "toVersion": to_version,
            "dryRun": dry_run
        }),
        || {
            let Some(canonical_domain) = canonical_migration_domain(&domain) else {
                return Err(AppError::Policy(format!(
                    "VALIDATION_ERROR: unsupported migration domain '{}'",
                    domain
                )));
            };
            if to_version <= from_version {
                return Err(AppError::Policy(
                    "VALIDATION_ERROR: toVersion must be greater than fromVersion".to_string(),
                ));
            }
            if from_version < 0 {
                return Err(AppError::Policy(
                    "VALIDATION_ERROR: fromVersion must be non-negative".to_string(),
                ));
            }
            let steps = migration_steps_for_domain(canonical_domain);
            let plan = json!({
                "id": format!("migration_plan_{}", Uuid::new_v4().simple()),
                "domain": canonical_domain,
                "fromVersion": from_version,
                "toVersion": to_version,
                "dryRun": dry_run,
                "steps": steps,
                "createdAt": Utc::now()
            });
            let saved = upsert_json_entity(root, "migrations/plans", "migration_plan", plan, None)?;
            deserialize_entity(saved, "migration plan")
        },
    )
}

pub fn migration_run_start(
    root: &Path,
    plan_id: &str,
    idempotency_key: Option<String>,
) -> AppResult<MigrationRun> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "migration.run.start",
        key.as_deref(),
        &json!({"planId": plan_id}),
        || {
            let Some(plan) = get_json_entity(root, "migrations/plans", plan_id)? else {
                return Err(AppError::NotFound(format!("Migration plan '{}' not found", plan_id)));
            };
            let domain = plan
                .get("domain")
                .and_then(Value::as_str)
                .unwrap_or("schema")
                .to_string();
            let dry_run = plan.get("dryRun").and_then(Value::as_bool).unwrap_or(false);

            let now = Utc::now();
            let (status, logs, error_message) = execute_migration_plan(root, &domain, dry_run)?;
            let run = json!({
                "id": format!("migration_run_{}", Uuid::new_v4().simple()),
                "planId": plan_id,
                "status": status,
                "startedAt": now,
                "finishedAt": now,
                "logs": logs,
                "errorMessage": error_message,
                "planSnapshot": plan
            });
            let saved = upsert_json_entity(root, "migrations/runs", "migration_run", run, None)?;
            append_event(
                root,
                build_event(
                    "migration.run.started",
                    None,
                    json!({"runId": saved.get("id"), "domain": domain}),
                ),
            )?;
            let completed_event = if saved.get("status").and_then(Value::as_str) == Some("succeeded") {
                "migration.run.completed"
            } else {
                "migration.run.failed"
            };
            append_event(
                root,
                build_event(
                    completed_event,
                    None,
                    json!({"runId": saved.get("id"), "domain": domain}),
                ),
            )?;
            deserialize_entity(saved, "migration run")
        },
    )
}

pub fn migration_run_get(root: &Path, run_id: &str) -> AppResult<Option<MigrationRun>> {
    ensure_topology(root)?;
    let value = get_json_entity(root, "migrations/runs", run_id)?;
    deserialize_optional_entity(value, "migration run")
}

pub fn migration_run_rollback(
    root: &Path,
    run_id: &str,
    reason: Option<String>,
    idempotency_key: Option<String>,
) -> AppResult<MigrationRun> {
    ensure_topology(root)?;
    let key = idempotency_key.clone();
    with_idempotency(
        root,
        "migration.run.rollback",
        key.as_deref(),
        &json!({"runId": run_id, "reason": reason}),
        || {
            let mut patch = json!({
                "status": "rolled_back",
                "finishedAt": Utc::now(),
            });
            if let Some(reason) = reason.clone() {
                patch["errorMessage"] = Value::String(reason);
            }
            let saved = patch_json_entity(root, "migrations/runs", "migration_run", run_id, patch, None)?;
            deserialize_entity(saved, "migration run")
        },
    )
}

fn evaluate_rule_condition(context: &Value, condition: &Value) -> bool {
    let Some(field) = condition.get("field").and_then(Value::as_str) else {
        return false;
    };
    let op = condition.get("op").and_then(Value::as_str).unwrap_or("eq");
    let expected = condition.get("value");
    let actual = lookup_by_path(context, field);
    match op {
        "eq" => actual == expected,
        "neq" => actual != expected,
        "in" => expected
            .and_then(Value::as_array)
            .map(|values| values.iter().any(|value| Some(value) == actual))
            .unwrap_or(false),
        "nin" => expected
            .and_then(Value::as_array)
            .map(|values| values.iter().all(|value| Some(value) != actual))
            .unwrap_or(false),
        "gt" => compare_json_numbers(actual, expected, |a, b| a > b),
        "gte" => compare_json_numbers(actual, expected, |a, b| a >= b),
        "lt" => compare_json_numbers(actual, expected, |a, b| a < b),
        "lte" => compare_json_numbers(actual, expected, |a, b| a <= b),
        "exists" => actual.is_some(),
        "contains" => actual
            .and_then(Value::as_str)
            .zip(expected.and_then(Value::as_str))
            .map(|(actual, expected)| actual.contains(expected))
            .unwrap_or(false),
        "matches" => actual
            .and_then(Value::as_str)
            .zip(expected.and_then(Value::as_str))
            .and_then(|(actual, pattern)| regex::Regex::new(pattern).ok().map(|regex| regex.is_match(actual)))
            .unwrap_or(false),
        _ => false,
    }
}

fn canonical_migration_domain(domain: &str) -> Option<&'static str> {
    match domain.trim().to_ascii_lowercase().as_str() {
        "schema" => Some("schema"),
        "projection" | "projections" => Some("projection"),
        "rule" | "rules" => Some("rule"),
        _ => None,
    }
}

fn migration_steps_for_domain(domain: &str) -> Vec<String> {
    match canonical_migration_domain(domain) {
        Some("schema") => vec![
            "validate migration boundaries".to_string(),
            "backfill deterministic blocks from atoms".to_string(),
            "materialize placements for notepad memberships".to_string(),
            "validate atom-to-block and placement integrity".to_string(),
            "record migration summary counters".to_string(),
        ],
        Some("projection") => vec![
            "validate projection manifests".to_string(),
            "verify snapshot/checkpoint consistency".to_string(),
            "record projection migration summary".to_string(),
        ],
        Some("rule") => vec![
            "validate rule definitions".to_string(),
            "verify scheduler bindings".to_string(),
            "record rule migration summary".to_string(),
        ],
        _ => vec!["validate migration domain".to_string()],
    }
}

fn execute_migration_plan(
    root: &Path,
    domain: &str,
    dry_run: bool,
) -> AppResult<(String, Vec<String>, Option<String>)> {
    let Some(canonical_domain) = canonical_migration_domain(domain) else {
        return Ok((
            "failed".to_string(),
            vec![format!("unsupported migration domain: {}", domain)],
            Some(format!("unsupported migration domain '{}'", domain)),
        ));
    };

    let mut logs = vec![format!(
        "starting migration domain={} dryRun={}",
        canonical_domain, dry_run
    )];

    let outcome = match canonical_domain {
        "schema" => execute_schema_migration(root, dry_run),
        "projection" => execute_projection_migration(root, dry_run),
        "rule" => execute_rule_migration(root, dry_run),
        _ => Err(AppError::Policy(format!(
            "unsupported migration domain '{}'",
            canonical_domain
        ))),
    };

    match outcome {
        Ok(mut details) => {
            logs.append(&mut details);
            Ok(("succeeded".to_string(), logs, None))
        }
        Err(error) => {
            logs.push(format!("failed: {}", error));
            Ok(("failed".to_string(), logs, Some(error.to_string())))
        }
    }
}

fn list_notepads_for_migration(root: &Path, dry_run: bool) -> AppResult<Vec<NotepadViewDefinition>> {
    if !dry_run {
        return notepads_list(root);
    }

    let mut items = Vec::new();
    for entry in fs::read_dir(root.join("notepads")).map_err(|error| AppError::Io(error.to_string()))? {
        let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
        let path = entry.path();
        if !is_workspace_doc_file(&path) {
            continue;
        }
        match read_notepad_file(root, &path) {
            Ok(value) => items.push(value),
            Err(error) => {
                tracing::warn!(path = %path.to_string_lossy(), error = %error, "skipping malformed notepad file during migration dry-run");
            }
        }
    }

    if !items.iter().any(|item| item.id == "now") {
        items.push(default_now_notepad(Utc::now()));
    }
    Ok(items)
}

fn execute_schema_migration(root: &Path, dry_run: bool) -> AppResult<Vec<String>> {
    ensure_topology(root)?;
    let atoms = load_all_atoms(root)?;
    let atom_count = atoms.len();
    let atom_ids: HashSet<String> = atoms.iter().map(|atom| atom.id.clone()).collect();
    let notepads = list_notepads_for_migration(root, dry_run)?;

    let mut logs = vec![
        format!("atoms scanned: {}", atom_count),
        format!("notepads scanned: {}", notepads.len()),
    ];

    let mut migrated_blocks = 0usize;
    let mut missing_parent_conflicts = 0usize;

    for atom in &atoms {
        let parent_missing = atom
            .relations
            .parent_id
            .as_ref()
            .map(|parent_id| !atom_ids.contains(parent_id))
            .unwrap_or(false);

        if !dry_run {
            let mut block = upsert_block_from_atom(root, atom)?;
            if parent_missing && block.parent_block_id.is_some() {
                block.parent_block_id = None;
                block.updated_at = Utc::now();
                block.revision += 1;
                write_json_file(
                    &json_entity_path(root, block_rel_dir_for_lifecycle(&block.lifecycle), &block.id),
                    &block,
                )?;
            }
        }

        migrated_blocks += 1;
        if parent_missing {
            missing_parent_conflicts += 1;
        }
    }

    let mut placements_created = 0usize;
    let mut placements_existing = 0usize;

    for notepad in &notepads {
        let mut scoped_atoms = atoms.clone();
        apply_atom_filter(&mut scoped_atoms, Some(&notepad.filters));
        sort_atoms(&mut scoped_atoms, Some(&notepad.sorts));

        let mut existing_ids: HashSet<String> = load_placements_for_view(root, &notepad.id)?
            .into_iter()
            .map(|placement| placement.block_id)
            .collect();

        for atom in scoped_atoms {
            let block_id = block_id_for_atom(&atom.id);
            if existing_ids.contains(&block_id) {
                placements_existing += 1;
                continue;
            }

            placements_created += 1;
            if !dry_run {
                let placement = ensure_placement_for_view(root, &block_id, &notepad.id, None)?;
                existing_ids.insert(placement.block_id);
            }
        }
    }

    let mapped_atoms = if dry_run {
        atom_count
    } else {
        let blocks = load_all_blocks(root)?;
        let mapped_ids: HashSet<String> = blocks
            .into_iter()
            .filter_map(|block| block.atom_id)
            .collect();
        atoms.iter().filter(|atom| mapped_ids.contains(&atom.id)).count()
    };

    let unmapped_atoms = atom_count.saturating_sub(mapped_atoms);
    logs.push(format!("blocks migrated: {}", migrated_blocks));
    logs.push(format!(
        "placements existing={} created={}",
        placements_existing, placements_created
    ));
    logs.push(format!(
        "migration conflicts: missing_parent={}",
        missing_parent_conflicts
    ));
    logs.push(format!(
        "validation atomToBlock mapped={} unmapped={}",
        mapped_atoms, unmapped_atoms
    ));

    if !dry_run {
        append_event(
            root,
            build_event(
                "migration.schema.backfilled",
                None,
                json!({
                    "atomsScanned": atom_count,
                    "blocksMigrated": migrated_blocks,
                    "placementsCreated": placements_created,
                    "missingParentConflicts": missing_parent_conflicts,
                    "unmappedAtoms": unmapped_atoms
                }),
            ),
        )?;
    }

    if unmapped_atoms > 0 {
        return Err(AppError::Policy(format!(
            "MIGRATION_VALIDATION_FAILED: {} atoms did not map to blocks",
            unmapped_atoms
        )));
    }

    Ok(logs)
}

fn execute_projection_migration(root: &Path, dry_run: bool) -> AppResult<Vec<String>> {
    ensure_topology(root)?;
    let manifests = list_json_entities(root, "projections/manifests")?;
    let snapshots = list_json_entities(root, "projections/snapshots")?;

    let logs = vec![
        format!("projection manifests: {}", manifests.len()),
        format!("projection snapshots: {}", snapshots.len()),
        format!("projection migration dryRun={}", dry_run),
    ];
    Ok(logs)
}

fn execute_rule_migration(root: &Path, dry_run: bool) -> AppResult<Vec<String>> {
    ensure_topology(root)?;
    let rules = list_json_entities(root, "rules/definitions")?;
    let jobs = list_json_entities(root, "jobs/schedules")?;

    let logs = vec![
        format!("rules scanned: {}", rules.len()),
        format!("scheduled jobs scanned: {}", jobs.len()),
        format!("rule migration dryRun={}", dry_run),
    ];
    Ok(logs)
}

fn derive_attention_layer(task: &TaskFacet, heat: f64, now: DateTime<Utc>) -> crate::models::AttentionLayer {
    if task.status == TaskStatus::Doing || task.hard_due_at.map(|due| due <= now).unwrap_or(false) {
        return crate::models::AttentionLayer::L3;
    }
    if task.snoozed_until.map(|until| until > now).unwrap_or(false) {
        return crate::models::AttentionLayer::Long;
    }
    if heat >= 85.0 {
        return crate::models::AttentionLayer::L3;
    }
    if heat >= 60.0 {
        return crate::models::AttentionLayer::Ram;
    }
    if heat >= 35.0 {
        return crate::models::AttentionLayer::Short;
    }
    crate::models::AttentionLayer::Long
}

fn compute_heat_score(atom: &AtomRecord, now: DateTime<Utc>) -> f64 {
    let Some(task) = atom.facet_data.task.as_ref() else {
        return 0.0;
    };
    let mut heat = match task.priority {
        1 => 85.0,
        2 => 72.0,
        3 => 56.0,
        4 => 42.0,
        _ => 30.0,
    };
    if task.status == TaskStatus::Doing {
        heat += 20.0;
    }
    if task.commitment_level == Some(crate::models::CommitmentLevel::Hard) {
        heat += 10.0;
    }
    if let Some(dread) = task.dread_level {
        heat += f64::from(dread.max(0)) * 2.0;
    }
    if let Some(hard_due_at) = task.hard_due_at {
        let hours_until = (hard_due_at - now).num_hours();
        if hours_until <= 0 {
            heat += 30.0;
        } else if hours_until <= 24 {
            heat += 16.0;
        } else if hours_until <= 72 {
            heat += 8.0;
        }
    } else if let Some(soft_due_at) = task.soft_due_at {
        let hours_until = (soft_due_at - now).num_hours();
        if hours_until <= 24 {
            heat += 8.0;
        } else if hours_until <= 72 {
            heat += 4.0;
        }
    }

    if let Some(attention) = atom.facet_data.attention.as_ref() {
        if let Some(previous_heat) = attention.heat_score {
            // Apply soft decay from last known heat so stale items drift down over time.
            let decay_hours = atom
                .updated_at
                .signed_duration_since(atom.created_at)
                .num_hours()
                .max(1) as f64;
            let decayed = previous_heat * (0.995_f64.powf(decay_hours.min(120.0)));
            heat = (heat * 0.65) + (decayed * 0.35);
        }
    }

    heat.clamp(0.0, 100.0)
}

fn should_preserve_dwell(atom: &AtomRecord, next_layer: crate::models::AttentionLayer, now: DateTime<Utc>) -> bool {
    let Some(current_layer) = atom.facet_data.task.as_ref().and_then(|task| task.attention_layer) else {
        return false;
    };
    if current_layer == next_layer {
        return false;
    }
    let Some(attention) = atom.facet_data.attention.as_ref() else {
        return false;
    };
    let Some(dwell_started_at) = attention.dwell_started_at else {
        return false;
    };
    let dwell_minutes = (now - dwell_started_at).num_minutes();
    if dwell_minutes >= 90 {
        return false;
    }
    let task = atom.facet_data.task.as_ref();
    let urgent = task
        .and_then(|item| item.hard_due_at)
        .map(|due| due <= now)
        .unwrap_or(false)
        || task
            .map(|item| item.status == TaskStatus::Doing || item.priority <= 1)
            .unwrap_or(false);
    !urgent
}

fn load_active_conditions_by_atom(root: &Path) -> AppResult<HashMap<String, Vec<ConditionRecord>>> {
    let mut map: HashMap<String, Vec<ConditionRecord>> = HashMap::new();
    for value in list_json_entities(root, "conditions/active")? {
        if let Ok(condition) = deserialize_entity::<ConditionRecord>(value, "condition") {
            if condition.status == "active" {
                map.entry(condition.atom_id.clone()).or_default().push(condition);
            }
        }
    }
    Ok(map)
}

fn upsert_system_decision(
    root: &Path,
    dedupe_key: String,
    title: String,
    body: String,
    atom_ids: Vec<String>,
) -> AppResult<String> {
    let pending = list_json_entities(root, "prompts/pending")?;
    for existing in pending {
        if existing
            .get("dedupeKey")
            .and_then(Value::as_str)
            .map(|value| value == dedupe_key.as_str())
            .unwrap_or(false)
        {
            let decision_id = existing
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Internal("existing decision missing id".to_string()))?;
            let now = Utc::now();
            let next_escalation = existing
                .get("escalationLevel")
                .and_then(Value::as_i64)
                .unwrap_or(0)
                + 1;
            let next_notify_count = existing
                .get("notifyCount")
                .and_then(Value::as_i64)
                .unwrap_or(0)
                + 1;
            let mut merged_atom_ids = existing
                .get("atomIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|value| value.to_string())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            merged_atom_ids.extend(atom_ids);
            merged_atom_ids.sort();
            merged_atom_ids.dedup();
            let _ = patch_json_entity(
                root,
                "prompts/pending",
                "decision",
                decision_id,
                json!({
                    "status": "pending",
                    "title": title,
                    "body": body,
                    "atomIds": merged_atom_ids,
                    "escalationLevel": next_escalation,
                    "notifyCount": next_notify_count,
                    "lastNotifiedAt": now,
                }),
                existing.get("revision").and_then(Value::as_i64),
            )?;
            return Ok(decision_id.to_string());
        }
    }

    let decision = json!({
        "id": format!("decision_{}", Uuid::new_v4().simple()),
        "schemaVersion": 1,
        "type": "force_decision",
        "status": "pending",
        "priority": 2,
        "title": title,
        "body": body,
        "atomIds": atom_ids,
        "options": [
            {"id":"do_now","label":"Do now","actionKind":"task.do_now"},
            {"id":"reschedule","label":"Reschedule","actionKind":"task.reschedule"},
            {"id":"de_scope","label":"De-scope","actionKind":"task.de_scope"}
        ],
        "dedupeKey": dedupe_key,
        "escalationLevel": 0,
        "notifyCount": 1,
        "lastNotifiedAt": Utc::now(),
    });
    let saved = upsert_json_entity(root, "prompts/pending", "decision", decision, None)?;
    let decision_id = saved
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Internal("created decision missing id".to_string()))?
        .to_string();
    append_event(
        root,
        build_event(
            "decision.created",
            None,
            json!({"decisionId": decision_id, "dedupeKey": dedupe_key}),
        ),
    )?;
    Ok(decision_id)
}

fn next_recurrence_run(template: &RecurrenceTemplate, from: DateTime<Utc>) -> DateTime<Utc> {
    let interval = i64::from(template.interval.max(1));
    match template.frequency.to_ascii_lowercase().as_str() {
        "daily" => from + chrono::Duration::days(interval),
        "weekly" => {
            let by_days = parse_weekday_list(&template.by_day);
            if by_days.is_empty() {
                return from + chrono::Duration::weeks(interval);
            }
            let max_probe_days = 14 * interval.max(1);
            for offset in 1..=max_probe_days {
                let candidate = from + chrono::Duration::days(offset);
                if by_days.contains(&candidate.weekday()) {
                    return candidate;
                }
            }
            from + chrono::Duration::weeks(interval)
        }
        "monthly" => from + chrono::Duration::days(30 * interval),
        _ => from + chrono::Duration::days(interval),
    }
}

fn parse_weekday_list(items: &[String]) -> HashSet<Weekday> {
    items
        .iter()
        .filter_map(|item| parse_weekday(item))
        .collect::<HashSet<_>>()
}

fn parse_weekday(value: &str) -> Option<Weekday> {
    match value.trim().to_ascii_lowercase().as_str() {
        "mon" | "monday" => Some(Weekday::Mon),
        "tue" | "tues" | "tuesday" => Some(Weekday::Tue),
        "wed" | "wednesday" => Some(Weekday::Wed),
        "thu" | "thurs" | "thursday" => Some(Weekday::Thu),
        "fri" | "friday" => Some(Weekday::Fri),
        "sat" | "saturday" => Some(Weekday::Sat),
        "sun" | "sunday" => Some(Weekday::Sun),
        _ => None,
    }
}

fn compare_json_numbers<F>(actual: Option<&Value>, expected: Option<&Value>, compare: F) -> bool
where
    F: Fn(f64, f64) -> bool,
{
    let Some(actual) = actual.and_then(Value::as_f64) else {
        return false;
    };
    let Some(expected) = expected.and_then(Value::as_f64) else {
        return false;
    };
    compare(actual, expected)
}

fn lookup_by_path<'a>(value: &'a Value, field: &str) -> Option<&'a Value> {
    let mut current = value;
    for segment in field.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn lexical_score(text: &str, query: &str) -> f64 {
    if query.is_empty() {
        return 0.0;
    }
    let count = text.matches(query).count() as f64;
    let normalized = if text.is_empty() {
        0.0
    } else {
        (query.len() as f64 / text.len() as f64).min(1.0)
    };
    count + normalized
}

fn deterministic_hash(input: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn chunk_text(input: &str, target_size: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for word in input.split_whitespace() {
        if current.len() + word.len() + 1 > target_size && !current.is_empty() {
            chunks.push(current);
            current = String::new();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    if chunks.is_empty() {
        chunks.push(String::new());
    }
    chunks
}

fn pop_expected_revision(value: &mut Value) -> Option<i64> {
    value
        .as_object_mut()
        .and_then(|object| object.remove("expectedRevision"))
        .and_then(|value| value.as_i64())
}

fn json_entity_path(root: &Path, rel_dir: &str, entity_id: &str) -> PathBuf {
    root.join(rel_dir)
        .join(format!("{}.json", sanitize_component(entity_id)))
}

fn list_json_entities(root: &Path, rel_dir: &str) -> AppResult<Vec<Value>> {
    let mut items = Vec::new();
    let dir = root.join(rel_dir);
    for entry in fs::read_dir(&dir).map_err(|error| AppError::Io(error.to_string()))? {
        let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        match read_json_file::<Value>(&path) {
            Ok(value) => items.push(value),
            Err(error) => {
                tracing::warn!(path = %path.to_string_lossy(), error = %error, "skipping malformed json entity");
            }
        }
    }
    Ok(items)
}

fn get_json_entity(root: &Path, rel_dir: &str, entity_id: &str) -> AppResult<Option<Value>> {
    let direct = json_entity_path(root, rel_dir, entity_id);
    if direct.exists() {
        return read_json_file(&direct).map(Some);
    }
    for value in list_json_entities(root, rel_dir)? {
        if value.get("id").and_then(Value::as_str) == Some(entity_id) {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

fn upsert_json_entity(
    root: &Path,
    rel_dir: &str,
    id_prefix: &str,
    mut value: Value,
    expected_revision: Option<i64>,
) -> AppResult<Value> {
    let object = get_object_mut(&mut value)?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("{}_{}", id_prefix, Uuid::new_v4().simple()));
    let path = json_entity_path(root, rel_dir, &id);
    let existing = if path.exists() {
        Some(read_json_file::<Value>(&path)?)
    } else {
        None
    };
    let actual_revision = existing
        .as_ref()
        .and_then(|existing| existing.get("revision"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if let Some(expected_revision) = expected_revision {
        if expected_revision != actual_revision {
            return Err(AppError::Policy(format!(
                "CONFLICT: {}",
                json!({
                    "code": "CONFLICT",
                    "entity": id_prefix,
                    "expectedRevision": expected_revision,
                    "actualRevision": actual_revision,
                    "latest": existing.unwrap_or(Value::Null)
                })
            )));
        }
    }

    let now = Utc::now();
    object.insert("id".to_string(), Value::String(id.clone()));
    object.insert(
        "createdAt".to_string(),
        existing
            .as_ref()
            .and_then(|existing| existing.get("createdAt").cloned())
            .unwrap_or_else(|| Value::String(now.to_rfc3339())),
    );
    object.insert("updatedAt".to_string(), Value::String(now.to_rfc3339()));
    object.insert("revision".to_string(), Value::from(actual_revision + 1));

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Io(error.to_string()))?;
    }
    write_json_file(&path, &value)?;
    Ok(value)
}

fn patch_json_entity(
    root: &Path,
    rel_dir: &str,
    id_prefix: &str,
    entity_id: &str,
    patch: Value,
    expected_revision: Option<i64>,
) -> AppResult<Value> {
    let path = json_entity_path(root, rel_dir, entity_id);
    let mut base = if path.exists() {
        read_json_file::<Value>(&path)?
    } else if let Some(existing) = get_json_entity(root, rel_dir, entity_id)? {
        existing
    } else {
        return Err(AppError::NotFound(format!(
            "{} '{}' not found",
            id_prefix, entity_id
        )));
    };
    if let Some(expected_revision) = expected_revision {
        let actual_revision = base.get("revision").and_then(Value::as_i64).unwrap_or(0);
        if expected_revision != actual_revision {
            return Err(AppError::Policy(format!(
                "CONFLICT: {}",
                json!({
                    "code": "CONFLICT",
                    "entity": id_prefix,
                    "expectedRevision": expected_revision,
                    "actualRevision": actual_revision,
                    "latest": base
                })
            )));
        }
    }

    merge_json_values(&mut base, patch);
    let obj = get_object_mut(&mut base)?;
    obj.insert("id".to_string(), Value::String(entity_id.to_string()));
    bump_json_revision(obj, Utc::now());
    write_json_file(&path, &base)?;
    Ok(base)
}

fn merge_json_values(base: &mut Value, patch: Value) {
    match (base, patch) {
        (Value::Object(base_object), Value::Object(patch_object)) => {
            for (key, patch_value) in patch_object {
                match base_object.get_mut(&key) {
                    Some(base_value @ Value::Object(_)) if patch_value.is_object() => {
                        merge_json_values(base_value, patch_value);
                    }
                    _ => {
                        base_object.insert(key, patch_value);
                    }
                }
            }
        }
        (base_value, patch_value) => {
            *base_value = patch_value;
        }
    }
}

fn bump_json_revision(object: &mut Map<String, Value>, now: DateTime<Utc>) {
    let revision = object
        .get("revision")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        + 1;
    object.insert("revision".to_string(), Value::from(revision));
    object.insert("updatedAt".to_string(), Value::String(now.to_rfc3339()));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::String(now.to_rfc3339()));
}

fn get_object_mut(value: &mut Value) -> AppResult<&mut Map<String, Value>> {
    value.as_object_mut().ok_or_else(|| {
        AppError::Policy("Expected object payload for workspace entity operation".to_string())
    })
}

fn sort_json_by_updated_at_desc(items: &mut [Value]) {
    items.sort_by(|a, b| {
        let a_updated = a.get("updatedAt").and_then(Value::as_str).unwrap_or_default();
        let b_updated = b.get("updatedAt").and_then(Value::as_str).unwrap_or_default();
        b_updated.cmp(a_updated)
    });
}

fn load_required_decision(root: &Path, decision_id: &str) -> AppResult<(Value, PathBuf)> {
    let pending = json_entity_path(root, "prompts/pending", decision_id);
    if pending.exists() {
        return Ok((read_json_file(&pending)?, pending));
    }
    let resolved = json_entity_path(root, "prompts/resolved", decision_id);
    if resolved.exists() {
        return Ok((read_json_file(&resolved)?, resolved));
    }
    Err(AppError::NotFound(format!(
        "Decision '{}' not found",
        decision_id
    )))
}

fn validate_registry_uniqueness(root: &Path, candidate: &Value, current_id: Option<&str>) -> AppResult<()> {
    let candidate_id = current_id
        .map(|value| value.to_string())
        .or_else(|| candidate.get("id").and_then(Value::as_str).map(|value| value.to_string()));
    let candidate_kind = candidate
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("thread")
        .to_ascii_lowercase();
    let candidate_name = candidate
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let candidate_aliases: Vec<String> = candidate
        .get("aliases")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if candidate_name.is_empty() {
        return Err(AppError::Policy(
            "VALIDATION_ERROR: registry entry name cannot be empty".to_string(),
        ));
    }

    let mut seen = HashSet::new();
    for alias in &candidate_aliases {
        if alias == &candidate_name {
            return Err(AppError::Policy(
                "VALIDATION_ERROR: registry alias cannot match the entry name".to_string(),
            ));
        }
        if !seen.insert(alias.clone()) {
            return Err(AppError::Policy(
                "VALIDATION_ERROR: registry aliases must be unique".to_string(),
            ));
        }
    }

    let existing_entries = list_json_entities(root, "registry")?;
    for existing in existing_entries {
        let existing_id = existing.get("id").and_then(Value::as_str);
        if existing_id == candidate_id.as_deref() {
            continue;
        }
        let existing_kind = existing
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("thread")
            .to_ascii_lowercase();
        if existing_kind != candidate_kind {
            continue;
        }

        let existing_name = existing
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let existing_aliases: HashSet<String> = existing
            .get("aliases")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|value| value.trim().to_ascii_lowercase())
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_default();

        let name_conflict = candidate_name == existing_name || existing_aliases.contains(&candidate_name);
        let alias_conflict = candidate_aliases
            .iter()
            .any(|alias| alias == &existing_name || existing_aliases.contains(alias));
        if name_conflict || alias_conflict {
            return Err(AppError::Policy(format!(
                "CONFLICT: {}",
                json!({
                    "code": "CONFLICT",
                    "entity": "registry",
                    "reason": "name_or_alias_not_unique",
                    "latest": existing
                })
            )));
        }
    }
    Ok(())
}

fn default_feature_flags() -> Vec<Value> {
    let now = Utc::now().to_rfc3339();
    [
        "workspace.blocks_v2",
        "workspace.placements_v2",
        "workspace.capture_policy_v2",
        "workspace.rules_engine",
        "workspace.scheduler",
        "workspace.decision_queue",
        "workspace.notifications",
        "workspace.projections",
        "workspace.registry",
        "workspace.semantic_index",
        "workspace.decay_engine",
        "workspace.focus_sessions_v2",
        "workspace.recurrence",
        "workspace.recurrence_v2",
        "workspace.agent_handoff",
        "workspace.notepad_ui_v2",
    ]
    .iter()
    .map(|key| {
        json!({
            "key": key,
            "enabled": *key == "workspace.notepad_ui_v2",
            "updatedAt": now
        })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp workspace root")
    }

    fn sample_create_request() -> CreateAtomRequest {
        CreateAtomRequest {
            raw_text: "- [ ] Write integration tests".to_string(),
            capture_source: crate::models::CaptureSource::Ui,
            initial_facets: Some(vec![FacetKind::Task]),
            facet_data: None,
            relations: None,
            governance: None,
            idempotency_key: Some("sample-create-key".to_string()),
            body: Some("Context body".to_string()),
        }
    }

    fn mutation_with_key(value: Value, key: &str) -> WorkspaceMutationPayload {
        let mut payload: WorkspaceMutationPayload =
            serde_json::from_value(value).expect("mutation payload");
        payload.idempotency_key = Some(key.to_string());
        payload
    }

    #[test]
    fn atom_markdown_roundtrip_works() {
        let root = temp_root();
        let atom = atom_create(root.path(), sample_create_request()).expect("atom created");
        let path = atom_path(root.path(), &atom.id, TaskStatus::Todo);
        assert!(path.exists());
        assert_eq!(path.extension().and_then(|v| v.to_str()), Some("md"));

        let loaded = atom_get(root.path(), &atom.id)
            .expect("atom get")
            .expect("atom exists");
        assert_eq!(loaded.id, atom.id);
        assert_eq!(loaded.body.as_deref().map(str::trim), Some("Context body"));
    }

    #[test]
    fn idempotency_replays_and_detects_payload_conflict() {
        let root = temp_root();
        let mut request = sample_create_request();
        request.idempotency_key = Some("same-key".to_string());

        let first = atom_create(root.path(), request.clone()).expect("first create");
        let second = atom_create(root.path(), request).expect("idempotent replay");
        assert_eq!(first.id, second.id);

        let mut changed = sample_create_request();
        changed.raw_text = "- [ ] Different payload".to_string();
        changed.idempotency_key = Some("same-key".to_string());
        let error = atom_create(root.path(), changed).expect_err("must reject conflicting payload");
        assert!(error.to_string().contains("IDEMPOTENCY_CONFLICT"));
    }

    #[test]
    fn malformed_files_are_skipped_in_list_operations() {
        let root = temp_root();
        ensure_topology(root.path()).expect("topology");

        fs::write(
            root.path().join("atoms/active/bad.md"),
            "---\nid: bad\nrevision: nope\n---\n",
        )
        .expect("write malformed atom");
        fs::write(
            root.path().join("notepads/bad.md"),
            "---\nid: bad\nrevision: nope\n---\n",
        )
        .expect("write malformed notepad");
        fs::write(root.path().join("events/2026-02-15.ndjson"), "{bad json}\n").expect("write malformed events");

        let atoms = atoms_list(root.path(), ListAtomsRequest::default()).expect("atoms list");
        let notepads = notepads_list(root.path()).expect("notepads list");
        let events = events_list(root.path(), ListEventsRequest::default()).expect("events list");

        assert!(atoms.items.is_empty());
        assert!(notepads.iter().any(|value| value.id == "now"));
        assert!(events.items.is_empty());
    }

    #[test]
    fn condition_lifecycle_updates_atom_blocking_state() {
        let root = temp_root();
        let atom = atom_create(root.path(), sample_create_request()).expect("atom created");

        let condition = condition_set_person(
            root.path(),
            ConditionSetPersonRequest {
                atom_id: atom.id.clone(),
                waiting_on_person: "Sam".to_string(),
                cadence_days: 3,
                idempotency_key: Some("condition-person-key".to_string()),
            },
        )
        .expect("condition set person");
        assert_eq!(condition.status, "active");
        assert_eq!(condition.mode, "person");

        let blocked = atom_get(root.path(), &atom.id)
            .expect("atom get")
            .expect("atom exists");
        assert_eq!(
            blocked
                .facet_data
                .task
                .as_ref()
                .map(|task| task.status),
            Some(TaskStatus::Blocked)
        );
        assert_eq!(
            blocked
                .facet_data
                .blocking
                .as_ref()
                .and_then(|blocking| blocking.waiting_on_person.as_ref())
                .map(String::as_str),
            Some("Sam")
        );

        let followed_up = condition_followup_log(
            root.path(),
            &condition.id,
            ConditionFollowupRequest {
                expected_revision: condition.revision,
                followed_up_at: None,
                idempotency_key: Some("condition-followup-key".to_string()),
            },
        )
        .expect("condition followup");
        assert!(followed_up.last_followup_at.is_some());
        assert!(followed_up.next_followup_at.is_some());

        let resolved = condition_resolve(
            root.path(),
            &condition.id,
            ConditionResolveRequest {
                expected_revision: followed_up.revision,
                idempotency_key: Some("condition-resolve-key".to_string()),
            },
        )
        .expect("condition resolve");
        assert_eq!(resolved.status, "satisfied");

        let active = conditions_list(
            root.path(),
            ListConditionsRequest {
                status: Some("active".to_string()),
                ..ListConditionsRequest::default()
            },
        )
        .expect("active conditions");
        assert!(active.items.is_empty());

        let after = atom_get(root.path(), &atom.id)
            .expect("atom get after")
            .expect("atom exists");
        assert!(after.facet_data.blocking.is_none());
        assert_eq!(
            after.facet_data.task.as_ref().map(|task| task.status),
            Some(TaskStatus::Todo)
        );
    }

    #[test]
    fn schema_migration_backfills_placements_for_matching_notepads() {
        let root = temp_root();
        let atom = atom_create(root.path(), sample_create_request()).expect("atom created");

        let _focus = notepad_save(
            root.path(),
            SaveNotepadViewRequest {
                expected_revision: None,
                idempotency_key: Some("focus-notepad-key".to_string()),
                definition: crate::models::NotepadViewDefinitionInput {
                    id: "focus".to_string(),
                    schema_version: 1,
                    name: "Focus".to_string(),
                    description: Some("Focused tasks".to_string()),
                    is_system: false,
                    filters: NotepadFilter {
                        facet: Some(FacetKind::Task),
                        statuses: Some(vec![TaskStatus::Todo, TaskStatus::Doing, TaskStatus::Blocked]),
                        include_archived: Some(false),
                        ..NotepadFilter::default()
                    },
                    sorts: vec![NotepadSort {
                        field: "priority".to_string(),
                        direction: "asc".to_string(),
                    }],
                    capture_defaults: None,
                    layout_mode: "list".to_string(),
                },
            },
        )
        .expect("focus notepad saved");

        let plan = migration_plan_create(
            root.path(),
            "schema".to_string(),
            1,
            2,
            false,
            Some("schema-migration-plan-key".to_string()),
        )
        .expect("migration plan create");

        let run = migration_run_start(root.path(), &plan.id, Some("schema-migration-run-key".to_string()))
            .expect("migration run start");
        assert_eq!(run.status, "succeeded");
        assert!(run.logs.iter().any(|line| line.contains("blocks migrated")));

        let block_id = block_id_for_atom(&atom.id);
        let focus = placements_list(
            root.path(),
            ListPlacementsRequest {
                view_id: Some("focus".to_string()),
                ..ListPlacementsRequest::default()
            },
        )
        .expect("focus placements");
        assert!(focus.items.iter().any(|placement| placement.block_id == block_id));
    }

    #[test]
    fn notepad_atoms_list_materializes_missing_placements_for_membership_atoms() {
        let root = temp_root();
        let atom = atom_create(root.path(), sample_create_request()).expect("atom created");

        let _focus = notepad_save(
            root.path(),
            SaveNotepadViewRequest {
                expected_revision: None,
                idempotency_key: Some("focus-materialize-notepad-key".to_string()),
                definition: crate::models::NotepadViewDefinitionInput {
                    id: "focus".to_string(),
                    schema_version: 1,
                    name: "Focus".to_string(),
                    description: Some("Materialize placements from membership".to_string()),
                    is_system: false,
                    filters: NotepadFilter {
                        facet: Some(FacetKind::Task),
                        statuses: Some(vec![TaskStatus::Todo, TaskStatus::Doing, TaskStatus::Blocked]),
                        include_archived: Some(false),
                        ..NotepadFilter::default()
                    },
                    sorts: vec![NotepadSort {
                        field: "updatedAt".to_string(),
                        direction: "desc".to_string(),
                    }],
                    capture_defaults: None,
                    layout_mode: "list".to_string(),
                },
            },
        )
        .expect("focus notepad saved");

        let before = placements_list(
            root.path(),
            ListPlacementsRequest {
                view_id: Some("focus".to_string()),
                ..ListPlacementsRequest::default()
            },
        )
        .expect("placements before materialization");
        assert!(before.items.is_empty());

        let listed = notepad_atoms_list(root.path(), "focus", Some(50), None).expect("notepad atoms list");
        assert!(listed.items.iter().any(|item| item.id == atom.id));

        let after = placements_list(
            root.path(),
            ListPlacementsRequest {
                view_id: Some("focus".to_string()),
                ..ListPlacementsRequest::default()
            },
        )
        .expect("placements after materialization");
        assert_eq!(after.items.len(), 1);
    }

    #[test]
    fn placement_save_accepts_legacy_now_json_notepad_path() {
        let root = temp_root();
        ensure_topology(root.path()).expect("topology");

        let now_definition = default_now_notepad(Utc::now());
        let legacy_now_path = root.path().join("notepads").join("now.json");
        write_notepad_file(root.path(), &legacy_now_path, &now_definition).expect("write legacy now notepad");
        let markdown_now_path = notepad_path(root.path(), "now");
        if markdown_now_path.exists() {
            fs::remove_file(markdown_now_path).expect("remove markdown now");
        }

        let atom = atom_create(root.path(), sample_create_request()).expect("atom created");
        let block_id = block_id_for_atom(&atom.id);
        let placement = placement_save(
            root.path(),
            mutation_with_key(
                json!({
                    "viewId": "now",
                    "blockId": block_id
                }),
                "legacy-now-placement-save-key",
            ),
        )
        .expect("placement save should work with legacy now.json");

        assert_eq!(placement.view_id, "now");
        assert_eq!(placement.block_id, block_id);
    }

    #[test]
    fn atom_delete_prunes_empty_archived_atom_and_related_placements() {
        let root = temp_root();
        let atom = atom_create(
            root.path(),
            CreateAtomRequest {
                raw_text: "".to_string(),
                body: Some("".to_string()),
                idempotency_key: Some("empty-atom-create-key".to_string()),
                ..sample_create_request()
            },
        )
        .expect("atom created");
        let archived = atom_archive(
            root.path(),
            &atom.id,
            ArchiveAtomRequest {
                expected_revision: atom.revision,
                idempotency_key: Some("empty-atom-archive-key".to_string()),
                reason: Some("test".to_string()),
            },
        )
        .expect("atom archived");

        let delete = atom_delete(
            root.path(),
            &archived.id,
            DeleteAtomRequest {
                expected_revision: archived.revision,
                idempotency_key: Some("empty-atom-delete-key".to_string()),
                reason: Some("test".to_string()),
            },
        )
        .expect("atom deleted");
        assert!(delete.success);

        let after_atom = atom_get(root.path(), &archived.id).expect("atom get after delete");
        assert!(after_atom.is_none());

        let block_id = block_id_for_atom(&archived.id);
        let after_placements = placements_list(
            root.path(),
            ListPlacementsRequest {
                block_id: Some(block_id.clone()),
                ..ListPlacementsRequest::default()
            },
        )
        .expect("placements after delete");
        assert!(after_placements.items.is_empty());
        assert!(find_block(root.path(), &block_id).expect("find block").is_none());
    }

    #[test]
    fn atom_delete_rejects_non_empty_archived_atom() {
        let root = temp_root();
        let atom = atom_create(root.path(), sample_create_request()).expect("atom created");
        let archived = atom_archive(
            root.path(),
            &atom.id,
            ArchiveAtomRequest {
                expected_revision: atom.revision,
                idempotency_key: Some("nonempty-atom-archive-key".to_string()),
                reason: Some("test".to_string()),
            },
        )
        .expect("atom archived");

        let error = atom_delete(
            root.path(),
            &archived.id,
            DeleteAtomRequest {
                expected_revision: archived.revision,
                idempotency_key: Some("nonempty-atom-delete-key".to_string()),
                reason: Some("test".to_string()),
            },
        )
        .expect_err("non-empty archived atom must be rejected");

        assert!(error
            .to_string()
            .contains("POLICY_DENIED: atom_delete only permits archived atoms with no text/body content"));
    }

    #[test]
    fn obsidian_task_sync_imports_and_archives_removed_tasks() {
        let vault = temp_root();
        let command_center_root = vault.path().join("command-center");
        ensure_topology(&command_center_root).expect("topology");
        fs::create_dir_all(command_center_root.join("tasks")).expect("create tasks folder");

        fs::write(
            vault.path().join("inbox.md"),
            "---\ntitle: Outside Vault Root\n---\n\n- [ ] should stay out of sync\n",
        )
        .expect("write outside note");
        fs::write(
            command_center_root.join("tasks").join("inbox.md"),
            "---\ntitle: Inbox\n---\n\n- [ ] call client\n- [x] shipped release\n",
        )
        .expect("write command-center inbox");
        fs::write(
            command_center_root.join("atoms/active/system.md"),
            "- [ ] system-managed task should be ignored\n",
        )
        .expect("write system-managed atom");

        let first = obsidian_tasks_sync_for_vault(&command_center_root, vault.path()).expect("first sync");
        assert_eq!(first.discovered_tasks, 2);
        assert_eq!(first.created_atoms, 2);

        let first_page = atoms_list(
            &command_center_root,
            ListAtomsRequest {
                limit: Some(200),
                cursor: None,
                filter: Some(NotepadFilter {
                    facet: Some(FacetKind::Task),
                    include_archived: Some(true),
                    ..NotepadFilter::default()
                }),
                sort: None,
            },
        )
        .expect("atoms list");
        assert!(first_page.items.iter().any(|atom| atom.raw_text.contains("call client")));
        assert!(first_page.items.iter().any(|atom| atom.raw_text.contains("shipped release")));
        assert!(!first_page.items.iter().any(|atom| atom.raw_text.contains("should stay out of sync")));
        assert!(!first_page.items.iter().any(|atom| atom.raw_text.contains("system-managed task")));

        fs::write(
            command_center_root.join("tasks").join("inbox.md"),
            "- [x] call client\n",
        )
        .expect("rewrite inbox");
        let second = obsidian_tasks_sync_for_vault(&command_center_root, vault.path()).expect("second sync");
        assert_eq!(second.discovered_tasks, 1);
        assert!(second.updated_atoms + second.created_atoms >= 1);
        assert!(second.archived_atoms >= 1);

        let second_page = atoms_list(
            &command_center_root,
            ListAtomsRequest {
                limit: Some(200),
                cursor: None,
                filter: Some(NotepadFilter {
                    facet: Some(FacetKind::Task),
                    include_archived: Some(true),
                    ..NotepadFilter::default()
                }),
                sort: None,
            },
        )
        .expect("atoms list after second sync");
        let call = second_page
            .items
            .iter()
            .find(|atom| atom.raw_text.contains("call client"))
            .expect("call task");
        assert_eq!(
            call.facet_data.task.as_ref().map(|task| task.status),
            Some(TaskStatus::Done)
        );
    }

    #[test]
    fn obsidian_cli_content_encoding_escapes_multiline_payloads() {
        let encoded = encode_obsidian_cli_content("line one\nline\\two\tend");
        assert_eq!(encoded, "line one\\nline\\\\two\\tend");
    }

    #[test]
    fn obsidian_cli_write_applied_requires_content_change() {
        let root = temp_root();
        let path = root.path().join("note.md");
        fs::write(&path, "before").expect("write before");

        assert!(!obsidian_cli_write_applied(&path, "after", Some("before")));

        fs::write(&path, "after").expect("write after");
        assert!(obsidian_cli_write_applied(&path, "after", Some("before")));
    }

    #[test]
    fn advanced_workspace_commands_smoke_test() {
        let root = temp_root();
        let atom = atom_create(root.path(), sample_create_request()).expect("atom created");

        let rule = rule_save(
            root.path(),
            mutation_with_key(json!({
                "name": "Rule",
                "enabled": true,
                "scope": "system",
                "trigger": {"kind": "manual"},
                "conditions": [{"field": "a", "op": "eq", "value": 1}],
                "actions": []
            }), "rule-save-key"),
        )
        .expect("rule saved");
        let rule_id = rule.id.as_str();
        let eval = rule_evaluate(
            root.path(),
            rule_id,
            RuleEvaluateRequest {
                context: Some(json!({"a": 1})),
                idempotency_key: Some("rule-eval-key".to_string()),
            },
        )
        .expect("rule evaluate");
        assert!(eval.matched);

        let job = job_save(
            root.path(),
            mutation_with_key(json!({
                "type": "triage.enqueue",
                "enabled": true,
                "schedule": {"kind":"manual"},
                "timeoutMs": 1000,
                "maxRetries": 0,
                "retryBackoffMs": 1000
            }), "job-save-key"),
        )
        .expect("job saved");
        let job_id = job.id.as_str();
        let run = job_run(
            root.path(),
            job_id,
            Some(json!({"hello": "world"})),
            Some("job-run-key".to_string()),
        )
        .expect("job run");
        assert!(!run.id.is_empty());

        let decision = decision_create(
            root.path(),
            mutation_with_key(json!({
                "title": "Choose",
                "body": "pick one",
                "atomIds": [atom.id],
                "options": [{"id":"opt_1","label":"Do it","actionKind":"task.do_now"}]
            }), "decision-create-key"),
        )
        .expect("decision create");
        let decision_id = decision.id.as_str();
        let resolved = decision_resolve(
            root.path(),
            decision_id,
            "opt_1".to_string(),
            None,
            Some("decision-key".to_string()),
        )
        .expect("decision resolve");
        assert_eq!(resolved.status, "resolved");

        let message = notification_send(
            root.path(),
            mutation_with_key(
                json!({"title":"Heads up","body":"Something changed","recipient":"in-app"}),
                "notification-send-key",
            ),
        )
        .expect("notification send");
        assert!(!message.id.is_empty());

        let projection = projection_save(
            root.path(),
            mutation_with_key(
                json!({"type":"tasks.list","enabled":true,"refreshMode":"manual","versionTag":"v1"}),
                "projection-save-key",
            ),
        )
        .expect("projection save");
        let projection_id = projection.id.as_str();
        let checkpoint = projection_refresh(
            root.path(),
            projection_id,
            Some("full".to_string()),
            Some("projection-refresh-key".to_string()),
        )
        .expect("projection refresh");
        assert_eq!(checkpoint.projection_id, projection_id);

        let registry = registry_entry_save(
            root.path(),
            mutation_with_key(
                json!({"kind":"thread","name":"Thread A","aliases":["thread-a"],"status":"active","parentIds":[]}),
                "registry-save-key",
            ),
        )
        .expect("registry save");
        assert!(!registry.id.is_empty());

        let _ = semantic_reindex(root.path(), None, Some("semantic-reindex-key".to_string()))
            .expect("semantic reindex");
        let search = semantic_search(
            root.path(),
            SemanticSearchRequest {
                query: "integration".to_string(),
                top_k: 5,
                filters: None,
            },
        )
        .expect("semantic search");
        assert!(!search.hits.is_empty());

        let gov = governance_policies_get(root.path()).expect("governance policies");
        assert!(!gov.default_sensitivity.is_empty());

        let updated_atom = atom_governance_update(
            root.path(),
            &atom.id,
            atom.revision,
            GovernanceMeta {
                sensitivity: SensitivityLevel::Confidential,
                retention_policy_id: Some("default-internal".to_string()),
                origin: "user_input".to_string(),
                source_ref: None,
                encryption_scope: EncryptionScope::None,
                allowed_agent_scopes: None,
            },
            Some("atom-governance-key".to_string()),
        )
        .expect("atom governance update");
        assert_eq!(updated_atom.governance.sensitivity, SensitivityLevel::Confidential);

        let flags = feature_flags_list(root.path()).expect("feature flags");
        assert!(!flags.is_empty());
        let snapshot = capability_snapshot_get(root.path()).expect("cap snapshot");
        assert!(!snapshot.feature_flags.is_empty());

        let plan = migration_plan_create(
            root.path(),
            "schema".to_string(),
            1,
            2,
            true,
            Some("migration-plan-key".to_string()),
        )
        .expect("migration plan");
        let run = migration_run_start(root.path(), &plan.id, Some("migration-run-key".to_string()))
            .expect("migration run start");
        let rolled = migration_run_rollback(
            root.path(),
            &run.id,
            Some("test rollback".to_string()),
            Some("migration-rollback-key".to_string()),
        )
        .expect("migration rollback");
        assert_eq!(rolled.status, "rolled_back");
    }
}

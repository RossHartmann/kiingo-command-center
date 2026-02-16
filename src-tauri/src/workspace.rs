use crate::errors::{AppError, AppResult};
use crate::models::{
    ArchiveAtomRequest, AtomFacets, AtomRecord, AtomRelations, BodyPatch, BooleanResponse,
    ClassificationResult, ClassificationSource, CreateAtomRequest, EncryptionScope, FacetKind,
    GovernanceMeta, ListAtomsRequest, ListEventsRequest, NotepadFilter, NotepadSort, NotepadViewDefinition,
    PageResponse, SaveNotepadViewRequest, SensitivityLevel, SetTaskStatusRequest, TaskFacet, TaskReopenRequest,
    TaskStatus, UpdateAtomRequest, WorkspaceCapabilities, WorkspaceEventRecord, WorkspaceHealth,
    AtomRelationsPatch, DecisionMutationPayload, DecisionPrompt, FeatureFlag, GovernancePoliciesResponse,
    JobDefinition, JobMutationPayload, JobRunRecord, MigrationPlan, MigrationRun, NotificationDeliveryRecord,
    NotificationMessage, NotificationMutationPayload, ProjectionCheckpoint, ProjectionDefinition,
    ProjectionMutationPayload, ProjectionRebuildResponse, RegistryEntry, RegistryMutationPayload,
    RegistrySuggestionsResponse, RuleDefinition, RuleEvaluateRequest, RuleEvaluationResult, RuleMutationPayload,
    SemanticChunk, SemanticReindexResponse, SemanticSearchHit, SemanticSearchRequest,
    SemanticSearchResponse,
    WorkspaceCapabilitySnapshot, WorkspaceMutationPayload,
};
use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashSet};
use std::hash::{Hash, Hasher};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use uuid::Uuid;
use wait_timeout::ChildExt;

const ROOT_DIRS: &[&str] = &[
    "atoms/active",
    "atoms/done",
    "atoms/archive",
    "notepads",
    "events",
    "threads",
    "categories",
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

pub fn capabilities(root: &Path) -> AppResult<WorkspaceCapabilities> {
    ensure_topology(root)?;
    Ok(WorkspaceCapabilities {
        obsidian_cli_available: detect_obsidian_cli(),
        base_query_available: false,
        selected_vault: detect_obsidian_vault_name().or_else(|| Some(root.to_string_lossy().to_string())),
        supported_commands: vec![
            "workspace_capabilities_get".to_string(),
            "workspace_health_get".to_string(),
            "atoms_list".to_string(),
            "atom_get".to_string(),
            "atom_create".to_string(),
            "atom_update".to_string(),
            "task_status_set".to_string(),
            "atom_archive".to_string(),
            "atom_unarchive".to_string(),
            "task_complete".to_string(),
            "task_reopen".to_string(),
            "notepads_list".to_string(),
            "notepad_get".to_string(),
            "notepad_save".to_string(),
            "notepad_delete".to_string(),
            "notepad_atoms_list".to_string(),
            "events_list".to_string(),
            "atom_events_list".to_string(),
            "classification_preview".to_string(),
            "atom_classify".to_string(),
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

    Ok(atom)
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
    run_obsidian_cli_status("obsidian", &["help"], Path::new("."))
        || run_obsidian_cli_status("obsidian-cli", &["help"], Path::new("."))
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
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::write(path, bytes).map_err(|error| AppError::Io(error.to_string()))
}

fn read_json_file<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let bytes = fs::read(path).map_err(|error| AppError::Io(error.to_string()))?;
    serde_json::from_slice(&bytes).map_err(AppError::from)
}

fn read_markdown_frontmatter(root: &Path, path: &Path) -> AppResult<(Value, String)> {
    let content = match try_obsidian_cli_read(root, path) {
        Some(cli_content) if cli_content.trim_start().starts_with("---") => cli_content,
        Some(_) => {
            tracing::warn!(
                path = %path.to_string_lossy(),
                "obsidian cli read returned malformed frontmatter; using filesystem fallback"
            );
            fs::read_to_string(path).map_err(|error| AppError::Io(error.to_string()))?
        }
        None => fs::read_to_string(path).map_err(|error| AppError::Io(error.to_string()))?,
    };
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

fn write_markdown_frontmatter(root: &Path, path: &Path, metadata: &Value, body: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AppError::Io(error.to_string()))?;
    }

    let metadata_yaml = serde_yaml::to_string(metadata).map_err(|error| AppError::Internal(error.to_string()))?;
    let rendered = format!("---\n{}---\n\n{}", metadata_yaml, body);

    if try_obsidian_cli_write(root, path, &rendered) {
        if let Ok(written) = fs::read_to_string(path) {
            if written.trim_start().starts_with("---") {
                return Ok(());
            }
            tracing::warn!(
                path = %path.to_string_lossy(),
                "obsidian cli write produced malformed frontmatter; rewriting via filesystem fallback"
            );
        }
    }

    fs::write(path, rendered).map_err(|error| AppError::Io(error.to_string()))
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
    let rel_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    let path_arg = format!("path={}", rel_path);
    let content_arg = format!("content={}", content);

    let candidates: [Vec<String>; 1] = [vec![
        "create".to_string(),
        path_arg,
        content_arg,
        "overwrite".to_string(),
    ]];

    for bin in ["obsidian", "obsidian-cli"] {
        for args in &candidates {
            let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
            if run_obsidian_cli_status(bin, &arg_refs, root) && path.exists() {
                return true;
            }
        }
    }
    tracing::warn!(
        path = %path.to_string_lossy(),
        "obsidian CLI write failed for path; using filesystem fallback"
    );
    false
}

fn try_obsidian_cli_read(root: &Path, path: &Path) -> Option<String> {
    let rel_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    let path_arg = format!("path={}", rel_path);

    let candidates: [Vec<String>; 1] = [vec!["read".to_string(), path_arg]];

    for bin in ["obsidian", "obsidian-cli"] {
        for args in &candidates {
            let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
            if let Some(output) = run_obsidian_cli_output(bin, &arg_refs, root) {
                if !output.trim().is_empty() {
                    return Some(output);
                }
            }
        }
    }
    tracing::warn!(
        path = %path.to_string_lossy(),
        "obsidian CLI read failed for path; using filesystem fallback"
    );
    None
}

fn run_obsidian_cli_status(bin: &str, args: &[&str], root: &Path) -> bool {
    let mut command = prepare_obsidian_command(bin, root);
    let mut child = match command.args(args).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
        Ok(child) => child,
        Err(_) => return false,
    };

    let timeout = Duration::from_millis(OBSIDIAN_CLI_TIMEOUT_MS);
    match child.wait_timeout(timeout) {
        Ok(Some(status)) => status.success(),
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            false
        }
        Err(_) => false,
    }
}

fn run_obsidian_cli_output(bin: &str, args: &[&str], root: &Path) -> Option<String> {
    let mut command = prepare_obsidian_command(bin, root);
    let mut child = command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let timeout = Duration::from_millis(OBSIDIAN_CLI_TIMEOUT_MS);
    match child.wait_timeout(timeout).ok()? {
        Some(status) => {
            if !status.success() {
                return None;
            }
            let mut stdout = child.stdout.take()?;
            let mut buffer = Vec::new();
            stdout.read_to_end(&mut buffer).ok()?;
            String::from_utf8(buffer).ok()
        }
        None => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

fn prepare_obsidian_command(bin: &str, root: &Path) -> std::process::Command {
    const FALLBACK_PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    let path = match std::env::var("PATH") {
        Ok(existing) if !existing.trim().is_empty() => format!("{}:{}", FALLBACK_PATH, existing),
        _ => FALLBACK_PATH.to_string(),
    };
    let mut command = std::process::Command::new(bin);
    command.current_dir(root).env("PATH", path);
    command
}

fn detect_obsidian_vault_path() -> Option<PathBuf> {
    for bin in ["obsidian", "obsidian-cli"] {
        if let Some(output) = run_obsidian_cli_output(bin, &["vault", "info=path"], Path::new(".")) {
            let first_line = output.lines().map(str::trim).find(|line| !line.is_empty())?;
            let path = PathBuf::from(first_line);
            if path.is_absolute() {
                return Some(path);
            }
        }
    }
    None
}

fn detect_obsidian_vault_name() -> Option<String> {
    for bin in ["obsidian", "obsidian-cli"] {
        if let Some(output) = run_obsidian_cli_output(bin, &["vault", "info=name"], Path::new(".")) {
            let first_line = output.lines().map(str::trim).find(|line| !line.is_empty())?;
            return Some(first_line.to_string());
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

fn apply_atom_filter(atoms: &mut Vec<AtomRecord>, filter: Option<&NotepadFilter>) {
    let Some(filter) = filter else {
        atoms.retain(|atom| atom.archived_at.is_none());
        return;
    };

    let include_archived = filter.include_archived.unwrap_or(false);
    let statuses = filter.statuses.clone();
    let thread_ids = filter.thread_ids.clone();
    let text_query = filter.text_query.as_ref().map(|value| value.to_ascii_lowercase());

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
            let plan = json!({
                "id": format!("migration_plan_{}", Uuid::new_v4().simple()),
                "domain": domain,
                "fromVersion": from_version,
                "toVersion": to_version,
                "dryRun": dry_run,
                "steps": [
                    "validate current version",
                    "prepare migration assets",
                    "apply migration",
                    "verify post-migration invariants"
                ],
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

            let now = Utc::now();
            let run = json!({
                "id": format!("migration_run_{}", Uuid::new_v4().simple()),
                "planId": plan_id,
                "status": "succeeded",
                "startedAt": now,
                "finishedAt": now,
                "logs": ["migration applied successfully"],
                "planSnapshot": plan
            });
            let saved = upsert_json_entity(root, "migrations/runs", "migration_run", run, None)?;
            append_event(
                root,
                build_event(
                    "migration.run.started",
                    None,
                    json!({"runId": saved.get("id"), "domain": plan.get("domain")}),
                ),
            )?;
            append_event(
                root,
                build_event(
                    "migration.run.completed",
                    None,
                    json!({"runId": saved.get("id"), "domain": plan.get("domain")}),
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
        "workspace.rules_engine",
        "workspace.scheduler",
        "workspace.decision_queue",
        "workspace.notifications",
        "workspace.projections",
        "workspace.registry",
        "workspace.semantic_index",
        "workspace.decay_engine",
        "workspace.recurrence",
        "workspace.agent_handoff",
    ]
    .iter()
    .map(|key| {
        json!({
            "key": key,
            "enabled": false,
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

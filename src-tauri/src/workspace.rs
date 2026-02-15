use crate::errors::{AppError, AppResult};
use crate::models::{
    ArchiveAtomRequest, AtomFacets, AtomRecord, AtomRelations, BodyPatch, BooleanResponse,
    ClassificationResult, ClassificationSource, CreateAtomRequest, EncryptionScope, FacetKind,
    GovernanceMeta, ListAtomsRequest, ListEventsRequest, NotepadFilter, NotepadSort, NotepadViewDefinition,
    NotepadViewDefinitionInput, PageResponse, SaveNotepadViewRequest, SensitivityLevel, SetTaskStatusRequest,
    TaskFacet, TaskReopenRequest, TaskStatus, UpdateAtomRequest, WorkspaceCapabilities, WorkspaceEventRecord,
    WorkspaceHealth,
};
use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

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
    "bases",
];

pub fn capabilities(root: &Path) -> AppResult<WorkspaceCapabilities> {
    ensure_topology(root)?;
    Ok(WorkspaceCapabilities {
        obsidian_cli_available: detect_obsidian_cli(),
        base_query_available: false,
        selected_vault: Some(root.to_string_lossy().to_string()),
        supported_commands: vec![
            "atoms_list".to_string(),
            "atom_get".to_string(),
            "atom_create".to_string(),
            "atom_update".to_string(),
            "task_status_set".to_string(),
            "atom_archive".to_string(),
            "atom_unarchive".to_string(),
            "notepads_list".to_string(),
            "notepad_save".to_string(),
            "events_list".to_string(),
        ],
    })
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
    read_json_file(&path).map(Some)
}

pub fn atom_create(root: &Path, request: CreateAtomRequest) -> AppResult<AtomRecord> {
    ensure_topology(root)?;

    let CreateAtomRequest {
        raw_text,
        capture_source,
        initial_facets,
        facet_data,
        relations,
        governance,
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

pub fn atom_update(root: &Path, atom_id: &str, request: UpdateAtomRequest) -> AppResult<AtomRecord> {
    ensure_topology(root)?;

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
        atom.relations = normalize_relations(relations_patch);
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

pub fn atom_archive(root: &Path, atom_id: &str, request: ArchiveAtomRequest) -> AppResult<AtomRecord> {
    ensure_topology(root)?;

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

pub fn atom_unarchive(root: &Path, atom_id: &str, expected_revision: i64) -> AppResult<AtomRecord> {
    ensure_topology(root)?;

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

pub fn task_complete(root: &Path, atom_id: &str, expected_revision: i64) -> AppResult<AtomRecord> {
    task_status_set(
        root,
        atom_id,
        SetTaskStatusRequest {
            expected_revision,
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
        if !is_json_file(&path) {
            continue;
        }
        let value: NotepadViewDefinition = read_json_file(&path)?;
        items.push(value);
    }

    items.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    Ok(items)
}

pub fn notepad_get(root: &Path, notepad_id: &str) -> AppResult<Option<NotepadViewDefinition>> {
    ensure_topology(root)?;
    ensure_now_notepad(root)?;

    let path = notepad_path(root, notepad_id);
    if !path.exists() {
        return Ok(None);
    }
    read_json_file(&path).map(Some)
}

pub fn notepad_save(root: &Path, request: SaveNotepadViewRequest) -> AppResult<NotepadViewDefinition> {
    ensure_topology(root)?;
    ensure_now_notepad(root)?;

    let input: NotepadViewDefinitionInput = request.definition;
    let now = Utc::now();
    let path = notepad_path(root, &input.id);

    let existing: Option<NotepadViewDefinition> = if path.exists() {
        Some(read_json_file(&path)?)
    } else {
        None
    };

    if let Some(expected) = request.expected_revision {
        let actual = existing.as_ref().map(|value| value.revision).unwrap_or(0);
        if actual != expected {
            return Err(AppError::Policy(format!(
                "CONFLICT: expected revision {} but found {}",
                expected, actual
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

    write_json_file(&path, &definition)?;
    Ok(definition)
}

pub fn notepad_delete(root: &Path, notepad_id: &str) -> AppResult<BooleanResponse> {
    ensure_topology(root)?;
    if notepad_id == "now" {
        return Err(AppError::Policy("Cannot delete system notepad 'now'".to_string()));
    }

    let path = notepad_path(root, notepad_id);
    if !path.exists() {
        return Ok(BooleanResponse { success: false });
    }

    fs::remove_file(path).map_err(|error| AppError::Io(error.to_string()))?;
    Ok(BooleanResponse { success: true })
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
) -> AppResult<AtomRecord> {
    ensure_topology(root)?;

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
    std::process::Command::new("obsidian")
        .arg("--help")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
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
    root.join(status_rel_dir(status)).join(format!("{}.json", sanitize_component(atom_id)))
}

fn notepad_path(root: &Path, notepad_id: &str) -> PathBuf {
    root.join("notepads").join(format!("{}.json", sanitize_component(notepad_id)))
}

fn is_json_file(path: &Path) -> bool {
    path.extension().and_then(|value| value.to_str()) == Some("json")
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

fn find_atom_path(root: &Path, atom_id: &str) -> AppResult<Option<PathBuf>> {
    let safe_id = sanitize_component(atom_id);
    for rel in ["atoms/active", "atoms/done", "atoms/archive"] {
        let path = root.join(rel).join(format!("{}.json", safe_id));
        if path.exists() {
            return Ok(Some(path));
        }
    }

    for rel in ["atoms/active", "atoms/done", "atoms/archive"] {
        let dir = root.join(rel);
        for entry in fs::read_dir(&dir).map_err(|error| AppError::Io(error.to_string()))? {
            let entry = entry.map_err(|error| AppError::Io(error.to_string()))?;
            let path = entry.path();
            if !is_json_file(&path) {
                continue;
            }
            let atom: AtomRecord = read_json_file(&path)?;
            if atom.id == atom_id {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

fn get_required_atom(root: &Path, atom_id: &str) -> AppResult<AtomRecord> {
    let path = find_atom_path(root, atom_id)?
        .ok_or_else(|| AppError::NotFound(format!("Atom '{}' not found", atom_id)))?;
    read_json_file(&path)
}

fn write_atom(root: &Path, previous_status: Option<TaskStatus>, atom: &AtomRecord) -> AppResult<()> {
    let current_status = atom_status(atom);
    let next_path = atom_path(root, &atom.id, current_status);

    write_json_file(&next_path, atom)?;

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
        return Err(AppError::Policy(format!(
            "CONFLICT: expected revision {} but found {}",
            expected, atom.revision
        )));
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
            if !is_json_file(&path) {
                continue;
            }
            let atom: AtomRecord = read_json_file(&path)?;
            atoms.push(atom);
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

        let file = File::open(path).map_err(|error| AppError::Io(error.to_string()))?;
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.map_err(|error| AppError::Io(error.to_string()))?;
            if line.trim().is_empty() {
                continue;
            }
            let event: WorkspaceEventRecord = serde_json::from_str(&line)?;
            events.push(event);
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
    if path.exists() {
        return Ok(());
    }

    let now = Utc::now();
    let definition = NotepadViewDefinition {
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
    };

    write_json_file(&path, &definition)
}

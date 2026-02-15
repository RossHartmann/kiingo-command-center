# Workspace Foundation Plan (Tasks -> Notepad Platform)

Date: 2026-02-15  
Status: Draft (updated for long-term platform extensibility)

## 1. Purpose

Build a new sidebar section, `The Workspace`, starting with a `Tasks` page, while laying a foundation that can evolve into the full notepad-first system vision (capture, classification, attention layers, triage, focus, and agent support).

## 2. Goals

1. Store workspace data in Obsidian (not SQLite as system of record).
2. Use Obsidian CLI for read/write operations from Kiingo Command Center.
3. Make the architecture modular, testable, and backend-agnostic.
4. Support future expansion from tasks to mixed content ("rambling", notes, meta, task atoms).
5. Support structured querying through Bases without creating write-path lock-in.

## 3. Non-Goals for Initial Build

1. Real-time two-way sync with no eventual consistency.
2. Full automation of decay, triage, recurrence, and behavior coaching.
3. Building every future concept now (focus engine, confession flow, energy model, etc.).

## 4. Core Design Principles

1. Capture first, structure second.
2. One canonical identity per captured unit.
3. Views are projections, not containers.
4. Event log over implicit state for auditability.
5. Obsidian is source of truth; app cache is disposable.
6. Prefer additive schema evolution over breaking migrations.

## 5. Key Foundational Decisions

1. Move from a `Task-only` model to an `Atom + Facets` model.
2. Every captured item is an `Atom`; task behavior is a `TaskFacet` on that atom.
3. Keep stable IDs independent of path, line position, and display order.
4. Represent notepads as saved views over atoms, not physical buckets.
5. Store relationships explicitly (parent/subtask, blocked-by, derived-from, thread membership).
6. Add append-only event logging from day one.
7. Reserve future fields now (attention, commitment, dread, due windows, snooze).
8. Use Bases as a query/projection layer; canonical writes remain file/property based.
9. Introduce a pluggable rules engine contract now (evaluation only in V1, enforcement later).
10. Introduce scheduler/job contracts now for recurring sweeps and triage boundaries.
11. Model interventions as first-class decision prompts with explicit resolution states.
12. Add projection pipeline contracts now so future UX layers read from materialized views.
13. Add capability flags and migrations now so advanced features can roll out safely.

## 6. Information Architecture (Obsidian Vault)

```text
command-center/
  atoms/
    active/
    done/
    archive/
  notepads/
    now.md
    <notepad-id>.md
  threads/
    <thread-id>.md
  categories/
    <category-id>.md
  prompts/
    pending/
    resolved/
  rules/
    definitions/
  jobs/
    schedules/
    runs/
  projections/
    manifests/
    snapshots/
  events/
    2026-02-15.ndjson
  semantic/
    index/
    chunks/
  governance/
    retention-policies.md
    sensitivity-defaults.md
  migrations/
    schema/
    projections/
    rules/
  bases/
    atoms.base
    tasks.base
    events.base
```

Notes:

1. `atoms/*` holds the canonical object files.
2. `notepads/*` stores view definitions, not task containers.
3. `events/*` stores append-only lifecycle logs for analytics and future "history" UX.
4. `tasks.base` is a projection of atoms where `facets` includes `task` and `task.status != archived`.
5. `prompts/*` stores force-decision queue state.
6. `jobs/*` stores job definitions and run history for sweep/triage automation.
7. `projections/*` stores materialized view manifests and checkpoints.
8. `semantic/*` stores retrieval index artifacts decoupled from canonical atom files.

## 7. Domain Model

## 7.1 Atom (core object)

Required fields:

1. `id` (stable, globally unique)
2. `schema_version`
3. `created_at`
4. `updated_at`
5. `raw_text`
6. `capture_source` (ui/manual/import/agent)
7. `facets` (enabled facet list)

## 7.2 Facets (extensible overlays)

Initial facets:

1. `TaskFacet`
2. `NoteFacet`
3. `MetaFacet`

Reserved future facets:

1. `AttentionFacet`
2. `CommitmentFacet`
3. `BlockingFacet`
4. `RecurrenceFacet`
5. `EnergyFacet`
6. `AgentFacet`

## 7.3 TaskFacet (initial)

Suggested fields:

1. `title`
2. `status` (`todo|doing|blocked|done|archived`)
3. `priority` (`1..5`)
4. `soft_due_at` (optional)
5. `hard_due_at` (optional)
6. `snoozed_until` (optional)
7. `commitment_level` (`soft|hard`) (optional now, active later)
8. `attention_layer` (`l3|ram|short|long|archive`) (optional now, active later)
9. `dread_level` (`0|1|2|3`) (optional now, active later)

## 7.4 Relationships

Store as explicit references on atoms:

1. `parent_id` (single)
2. `subtask_ids` (derived or materialized)
3. `blocked_by_atom_id` (optional)
4. `thread_ids` (0..n)
5. `derived_from_atom_id` (optional; supports decomposition lineage)

## 7.5 Notepad View Definition

Each notepad file holds a saved query definition:

1. `id`
2. `name`
3. `filters` (facet type, status, thread, due window, attention layer)
4. `sort`
5. `layout_mode` (`outline|list|focus`) (future-compatible)

Default `now` notepad:

1. System-defined view biased toward active/recent atoms.

## 8. Canonical File Schema (Atom Markdown)

Example:

```yaml
---
id: atom_20260215_173001_ab12
schema_version: 1
created_at: 2026-02-15T17:30:01Z
updated_at: 2026-02-15T17:30:01Z
capture_source: ui
facets: [task]

task:
  title: Draft Q2 launch narrative
  status: todo
  priority: 2
  soft_due_at:
  hard_due_at:
  snoozed_until:
  commitment_level: soft
  attention_layer: ram
  dread_level: 1

relations:
  parent_id:
  blocked_by_atom_id:
  thread_ids: [thread_kiingo]
  derived_from_atom_id:
---

## Body

Optional notes, subtasks, and context.
```

## 9. Classification and Capture Contract

V1 rule:

1. Tasks page primarily creates atoms with `TaskFacet`.

Foundation now (for future notepad vision):

1. Add classifier interface now, use deterministic heuristics first.
2. Preserve all raw capture text even if classification is uncertain.
3. Record classification confidence and source (`manual|heuristic|llm`).
4. Allow manual override at all times; overrides are logged as events.

Heuristic baseline:

1. Lines matching task syntax (`-`, `*`, `- [ ]`) default to task.
2. Headings, quotes, and freeform paragraphs default to note/meta.
3. No destructive reclassification without user confirmation.

## 10. Event Log Foundation

Store append-only events in NDJSON files by day.

Event types:

1. `atom.created`
2. `atom.updated`
3. `atom.classified`
4. `task.status_changed`
5. `task.completed`
6. `atom.archived`
7. `relation.linked`
8. `relation.unlinked`
9. `notepad.view_opened`
10. `triage.prompted` (future)

Why now:

1. Supports future "history and logging" requirements.
2. Enables behavior loops and analytics without schema rewrites.
3. Keeps audits and migration logic tractable.

## 11. Obsidian CLI Strategy

## 11.1 Read path

1. Primary: `base:query` when base exists and query succeeds.
2. Fallback: file scan with `files` + `read`.
3. Metadata lookup: `property:read` when efficient.

## 11.2 Write path

1. Create atom file with `create`.
2. Update metadata with `property:set` when possible.
3. Update body with `append` or controlled overwrite strategy.
4. Move lifecycle state with `move` between `active/done/archive`.
5. Record lifecycle events via append to daily event file.

## 11.3 Command guardrails

1. Strict allowlist for supported CLI commands.
2. No raw shell interpolation from UI strings.
3. Enforce vault and root path constraints.
4. Timeouts, retries, and normalized error mapping.

## 12. System Modules and Boundaries

## 12.1 Frontend (React)

1. `Workspace` nav group and `Tasks` screen now.
2. UI is adapter-free (no CLI assumptions).
3. Talks to typed app actions and domain DTOs only.

## 12.2 App State Layer

Add domain-first actions:

1. `listAtoms(query)`
2. `createAtom(input)`
3. `updateAtom(id, patch)`
4. `setTaskStatus(atomId, status)`
5. `archiveAtom(atomId)`
6. `listNotepads()`
7. `saveNotepadView(definition)`

## 12.3 Tauri Command Layer (Rust)

1. `workspace_atoms.rs`
2. `workspace_tasks.rs`
3. `workspace_notepads.rs`
4. `workspace_events.rs`

Commands should be explicit and small:

1. `atoms_list`
2. `atom_create`
3. `atom_update`
4. `task_status_set`
5. `atom_archive`
6. `notepad_views_list`
7. `notepad_view_save`

## 12.4 Domain Services (Rust)

1. `AtomService`
2. `TaskService`
3. `ClassificationService`
4. `NotepadViewService`
5. `EventService`
6. `RuleEngineService`
7. `JobSchedulerService`
8. `DecisionQueueService`
9. `ProjectionService`
10. `RegistryService`
11. `SemanticIndexService`
12. `NotificationService`
13. `MigrationService`

## 12.5 Storage Ports/Adapters

Port interfaces:

1. `AtomRepository`
2. `NotepadRepository`
3. `EventRepository`
4. `QueryRepository`
5. `RuleRepository`
6. `JobRepository`
7. `DecisionRepository`
8. `ProjectionRepository`
9. `RegistryRepository`
10. `SemanticRepository`
11. `NotificationRepository`
12. `MigrationRepository`

Adapters:

1. `ObsidianCliAdapter` (primary)
2. `InMemoryAdapter` (tests)
3. future adapters (SQLite, API, cloud sync)

## 13. Sidebar and Routing Changes (Immediate)

1. Add nav group `workspace` in `src/components/Sidebar/navigationConfig.ts`.
2. Add screen `tasks` to `src/state/appState.tsx` screen union.
3. Add `tasks` screen metadata in `SCREEN_META`.
4. Route in `src/App.tsx` for `TasksScreen`.

## 14. Error Model and UX States

User-facing states:

1. Obsidian CLI not found.
2. Vault not found or not selected.
3. Base unavailable (automatic fallback to file scan).
4. Parse failure on malformed atom file.
5. Write conflict or timeout.

UX behavior:

1. Keep failures local to action; do not wipe page state.
2. Offer retry and fallback path.
3. Log diagnostics with redaction.

## 15. Performance Guardrails

1. Pagination and lazy loading for atom lists.
2. Small in-memory cache with short TTL.
3. Incremental refresh by `updated_at`.
4. Keep hot datasets in `active`; archive aggressively.
5. Avoid full vault scans on each render.

## 16. Security and Safety Guardrails

1. Command allowlist and validated arguments only.
2. Vault and root path restrictions (`command-center/*`).
3. Input normalization and escaping at adapter boundary.
4. No secret leakage in logs.
5. Optional feature flag to disable write operations in restricted mode.
6. Enforce governance policy checks before read, write, notify, and agent access paths.
7. Emit immutable audit events for privileged actions (migration, governance, feature-flag changes).

## 17. Testing Strategy

Unit tests:

1. frontmatter parse/serialize roundtrips
2. facet merge and validation
3. classification heuristics
4. relation integrity checks
5. event serialization
6. rule evaluation determinism, priority ordering, and cooldown behavior
7. idempotency and conflict payload generation
8. projection reducer correctness from event stream

Integration tests (mocked CLI):

1. atom create/list/update/archive
2. task status transitions
3. base query success + fallback behavior
4. notepad view save/load
5. corrupted file resilience
6. scheduler job idempotency, retry, and timeout handling
7. decision queue resolution flow with event + notification emission
8. projection checkpoint rebuild and incremental refresh
9. migration dry-run, apply, and rollback safety

UI tests:

1. tasks screen loading/error/empty states
2. CRUD interactions dispatch correct actions
3. filter and sort behavior
4. decision prompt queue and resolve/snooze interactions
5. conflict resolution UX on concurrent edits

## 18. Incremental Rollout Plan

Phase 0 - Foundation contracts

1. Finalize atom schema and repository interfaces.
2. Finalize error taxonomy, idempotency semantics, and conflict payloads.
3. Finalize rule/job/decision/projection/registry contracts and interfaces.
4. Land routing and empty tasks shell.

Phase 1 - Tasks V1 (metadata-first)

1. Create/list/update/complete/archive task atoms.
2. Store in Obsidian via CLI adapter.
3. Add governance metadata on atoms.
4. Add basic filters (status, priority, due).
5. Emit canonical events for all mutations.

Phase 2 - Notepad view foundation

1. Add saved notepad view definitions.
2. Add default `Now` view semantics.
3. Add thread metadata and filtering.
4. Add thread/category registry entries and alias lookup.

Phase 3 - Decision and scheduler foundation

1. Implement decision queue CRUD and resolution actions.
2. Implement scheduler/job definitions and manual run support.
3. Implement notification channel abstraction and in-app channel first.

Phase 4 - Capture expansion

1. Support mixed atom capture (task/note/meta).
2. Add classifier interface with heuristic implementation.
3. Preserve raw input and decomposition lineage.
4. Log classifier decisions as events.

Phase 5 - Projections and semantic groundwork

1. Implement projection definitions and checkpoints.
2. Build initial task and waiting projections.
3. Add semantic chunking and search interface behind feature flag.

Phase 6 - Attention and commitment engine

1. activate attention layers
2. activate commitment levels
3. introduce boundary prompts and decay events
4. run boundary rules through rules engine + decision queue

Phase 7 - Advanced behavior and agent workflows

1. blocking and waiting mechanics
2. recurrence templates and instance handling
3. focus mode and agent handoff hooks

Phase 8 - Migration and rollout safety

1. Add feature flag management endpoints and policy.
2. Add schema/projection/rule migration plan + run + rollback flow.
3. Validate safe rollout with canary flags and dry-run migrations.

## 19. Open Questions

1. Canonical vault in production (`Core (OneDrive)` or user-selectable)?
2. Event retention policy for `events/*.ndjson`?
3. Should atom body editing be in V1 or deferred?
4. Should `atoms.base` and `tasks.base` be auto-created if missing?
5. How strict should classification be before asking for user confirmation?
6. What is the initial rule set shipped enabled by default?
7. What are quiet-hour defaults and escalation policies for notifications?
8. Which semantic provider/model should be first (or remain disabled initially)?
9. What merge policy should apply per mutable field group?
10. What is the production migration approval policy (who can apply/rollback)?

## 20. Recommended Immediate Scope (Do Now)

1. Implement `Tasks` with atom schema (not legacy task-only schema).
2. Add relationship and reserved fields now, even if unused in UI.
3. Add event logging now.
4. Add governance fields now (`sensitivity`, `origin`, `retentionPolicyId`).
5. Add rule/job/decision/projection interfaces now (implementation can be staged).
6. Keep Bases optional and fallback-capable.
7. Keep APIs domain-first (`Atom`/`Facet`), not storage-first.

This keeps V1 simple while preserving a clean path to the full notepad platform vision.

## 21. Exact TypeScript Interfaces (Proposed Canonical Contracts)

Notes:

1. Internal TypeScript uses `camelCase`.
2. Wire and file formats may use `snake_case`; adapters handle mapping.
3. These interfaces are intended for `src/lib/types.ts` and API DTO typing.

```ts
// ===== Shared primitives =====
export type IsoDateTime = string; // RFC3339/ISO8601 UTC preferred
export type IsoDate = string;     // YYYY-MM-DD
export type EntityId = string;    // ex: atom_20260215_173001_ab12

export type FacetKind =
  | "task"
  | "note"
  | "meta"
  | "attention"
  | "commitment"
  | "blocking"
  | "recurrence"
  | "energy"
  | "agent";

export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "archived";
export type CommitmentLevel = "soft" | "hard";
export type AttentionLayer = "l3" | "ram" | "short" | "long" | "archive";
export type CaptureSource = "ui" | "manual" | "import" | "agent";
export type ClassificationSource = "manual" | "heuristic" | "llm";

// ===== Facets =====
export interface TaskFacet {
  title: string;
  status: TaskStatus;
  priority: 1 | 2 | 3 | 4 | 5;
  softDueAt?: IsoDateTime;
  hardDueAt?: IsoDateTime;
  snoozedUntil?: IsoDateTime;
  commitmentLevel?: CommitmentLevel;
  attentionLayer?: AttentionLayer;
  dreadLevel?: 0 | 1 | 2 | 3;
  assignee?: string;
  estimateMinutes?: number;
  completedAt?: IsoDateTime;
}

export interface NoteFacet {
  kind?: "freeform" | "journal" | "context" | "commentary";
}

export interface MetaFacet {
  labels?: string[];
  categories?: string[];
}

export interface AttentionFacet {
  layer: AttentionLayer;
  lastPromotedAt?: IsoDateTime;
  decayEligibleAt?: IsoDateTime;
}

export interface CommitmentFacet {
  level: CommitmentLevel;
  rationale?: string;
  mustReviewBy?: IsoDateTime;
}

export interface BlockingFacet {
  mode: "date" | "person" | "task";
  blockedUntil?: IsoDateTime;
  waitingOnPerson?: string;
  waitingCadenceDays?: number;
  blockedByAtomId?: EntityId;
  lastFollowupAt?: IsoDateTime;
  followupCount?: number;
}

export interface RecurrenceFacet {
  templateId: EntityId;
  frequency: "daily" | "weekly" | "monthly" | "custom";
  interval?: number;
  byDay?: string[]; // ["MO","TU"]
  instanceIndex?: number;
}

export interface EnergyFacet {
  dreadLevel?: 0 | 1 | 2 | 3;
  lastCapacityMatch?: "full" | "normal" | "low";
}

export interface AgentFacet {
  conversationId?: string;
  workflowId?: string;
  lastAgentActionAt?: IsoDateTime;
}

export interface AtomFacets {
  task?: TaskFacet;
  note?: NoteFacet;
  meta?: MetaFacet;
  attention?: AttentionFacet;
  commitment?: CommitmentFacet;
  blocking?: BlockingFacet;
  recurrence?: RecurrenceFacet;
  energy?: EnergyFacet;
  agent?: AgentFacet;
}

// ===== Relations =====
export interface AtomRelations {
  parentId?: EntityId;
  blockedByAtomId?: EntityId;
  threadIds: EntityId[];
  derivedFromAtomId?: EntityId;
}

export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted";
export type EncryptionScope = "none" | "vault" | "field";

export interface GovernanceMeta {
  sensitivity: SensitivityLevel;
  retentionPolicyId?: EntityId;
  origin:
    | "user_input"
    | "system_generated"
    | "agent_generated"
    | "imported"
    | "synced";
  sourceRef?: string;
  encryptionScope: EncryptionScope;
  allowedAgentScopes?: string[]; // ex: ["read", "summarize"], omit => default policy
}

// ===== Atom =====
export interface AtomRecord {
  id: EntityId;
  schemaVersion: number; // start at 1
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  rawText: string;
  captureSource: CaptureSource;
  facets: FacetKind[]; // enabled facets
  facetData: AtomFacets;
  relations: AtomRelations;
  governance: GovernanceMeta;
  body?: string;
  revision: number; // optimistic concurrency
  archivedAt?: IsoDateTime;
}

// ===== Classification =====
export interface ClassificationResult {
  primaryFacet: "task" | "note" | "meta";
  confidence: number; // 0..1
  source: ClassificationSource;
  reasoning?: string;
}

// ===== Notepad views =====
export interface NotepadFilter {
  facet?: FacetKind;
  statuses?: TaskStatus[];
  threadIds?: EntityId[];
  parentId?: EntityId;
  attentionLayers?: AttentionLayer[];
  commitmentLevels?: CommitmentLevel[];
  dueFrom?: IsoDate;
  dueTo?: IsoDate;
  textQuery?: string;
  includeArchived?: boolean;
}

export interface NotepadSort {
  field:
    | "createdAt"
    | "updatedAt"
    | "priority"
    | "softDueAt"
    | "hardDueAt"
    | "attentionLayer"
    | "title";
  direction: "asc" | "desc";
}

export interface NotepadViewDefinition {
  id: EntityId;
  schemaVersion: number;
  name: string;
  description?: string;
  isSystem: boolean; // true for NOW
  filters: NotepadFilter;
  sorts: NotepadSort[];
  layoutMode: "outline" | "list" | "focus";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

// ===== Events =====
export type WorkspaceEventType =
  | "atom.created"
  | "atom.updated"
  | "atom.classified"
  | "task.status_changed"
  | "task.completed"
  | "atom.archived"
  | "relation.linked"
  | "relation.unlinked"
  | "notepad.view_opened"
  | "triage.prompted"
  | "rule.evaluated"
  | "job.run.started"
  | "job.run.completed"
  | "job.run.failed"
  | "decision.created"
  | "decision.resolved"
  | "notification.sent"
  | "notification.failed"
  | "projection.refreshed"
  | "projection.failed"
  | "registry.updated"
  | "governance.retention_applied"
  | "migration.run.started"
  | "migration.run.completed"
  | "migration.run.failed";

export interface WorkspaceEventBase<TType extends WorkspaceEventType, TPayload> {
  id: EntityId;
  type: TType;
  occurredAt: IsoDateTime;
  actor: "user" | "system" | "agent";
  actorId?: string;
  atomId?: EntityId;
  payload: TPayload;
}

export type AtomCreatedEvent = WorkspaceEventBase<"atom.created", { atom: AtomRecord }>;
export type AtomUpdatedEvent = WorkspaceEventBase<"atom.updated", { beforeRevision: number; atom: AtomRecord }>;
export type AtomClassifiedEvent = WorkspaceEventBase<"atom.classified", { result: ClassificationResult }>;
export type TaskStatusChangedEvent = WorkspaceEventBase<
  "task.status_changed",
  { from: TaskStatus; to: TaskStatus; reason?: string }
>;
export type TaskCompletedEvent = WorkspaceEventBase<"task.completed", { completedAt: IsoDateTime }>;
export type AtomArchivedEvent = WorkspaceEventBase<"atom.archived", { archivedAt: IsoDateTime; reason?: string }>;
export type RelationLinkedEvent = WorkspaceEventBase<
  "relation.linked",
  { relation: "parent" | "blocked_by" | "thread" | "derived_from"; targetId: EntityId }
>;
export type RelationUnlinkedEvent = WorkspaceEventBase<
  "relation.unlinked",
  { relation: "parent" | "blocked_by" | "thread" | "derived_from"; targetId: EntityId }
>;
export type NotepadViewOpenedEvent = WorkspaceEventBase<"notepad.view_opened", { notepadId: EntityId }>;
export type TriagePromptedEvent = WorkspaceEventBase<"triage.prompted", { promptId: string; atomIds: EntityId[] }>;
export type RuleEvaluatedEvent = WorkspaceEventBase<"rule.evaluated", { ruleId: EntityId; matched: boolean }>;
export type JobRunStartedEvent = WorkspaceEventBase<"job.run.started", { jobRunId: EntityId; jobId: EntityId }>;
export type JobRunCompletedEvent = WorkspaceEventBase<"job.run.completed", { jobRunId: EntityId; jobId: EntityId }>;
export type JobRunFailedEvent = WorkspaceEventBase<
  "job.run.failed",
  { jobRunId: EntityId; jobId: EntityId; errorCode?: string }
>;
export type DecisionCreatedEvent = WorkspaceEventBase<"decision.created", { decisionId: EntityId; type: DecisionPromptType }>;
export type DecisionResolvedEvent = WorkspaceEventBase<"decision.resolved", { decisionId: EntityId; optionId: string }>;
export type NotificationSentEvent = WorkspaceEventBase<
  "notification.sent",
  { messageId: EntityId; channel: NotificationChannel }
>;
export type NotificationFailedEvent = WorkspaceEventBase<
  "notification.failed",
  { messageId: EntityId; channel: NotificationChannel; errorCode?: string }
>;
export type ProjectionRefreshedEvent = WorkspaceEventBase<
  "projection.refreshed",
  { projectionId: EntityId; checkpoint?: string }
>;
export type ProjectionFailedEvent = WorkspaceEventBase<
  "projection.failed",
  { projectionId: EntityId; errorMessage?: string }
>;
export type RegistryUpdatedEvent = WorkspaceEventBase<"registry.updated", { entryId: EntityId; kind: RegistryEntryKind }>;
export type GovernanceRetentionAppliedEvent = WorkspaceEventBase<
  "governance.retention_applied",
  { atomId: EntityId; policyId?: EntityId }
>;
export type MigrationRunStartedEvent = WorkspaceEventBase<
  "migration.run.started",
  { runId: EntityId; domain: MigrationDomain }
>;
export type MigrationRunCompletedEvent = WorkspaceEventBase<
  "migration.run.completed",
  { runId: EntityId; domain: MigrationDomain }
>;
export type MigrationRunFailedEvent = WorkspaceEventBase<
  "migration.run.failed",
  { runId: EntityId; domain: MigrationDomain; errorMessage?: string }
>;

export type WorkspaceEvent =
  | AtomCreatedEvent
  | AtomUpdatedEvent
  | AtomClassifiedEvent
  | TaskStatusChangedEvent
  | TaskCompletedEvent
  | AtomArchivedEvent
  | RelationLinkedEvent
  | RelationUnlinkedEvent
  | NotepadViewOpenedEvent
  | TriagePromptedEvent
  | RuleEvaluatedEvent
  | JobRunStartedEvent
  | JobRunCompletedEvent
  | JobRunFailedEvent
  | DecisionCreatedEvent
  | DecisionResolvedEvent
  | NotificationSentEvent
  | NotificationFailedEvent
  | ProjectionRefreshedEvent
  | ProjectionFailedEvent
  | RegistryUpdatedEvent
  | GovernanceRetentionAppliedEvent
  | MigrationRunStartedEvent
  | MigrationRunCompletedEvent
  | MigrationRunFailedEvent;

// ===== API DTOs =====
export interface PageRequest {
  limit?: number;
  cursor?: string;
}

export interface PageResponse<T> {
  items: T[];
  nextCursor?: string;
  totalApprox?: number;
}

export interface ListAtomsRequest extends PageRequest {
  filter?: NotepadFilter;
  sort?: NotepadSort[];
}

export interface CreateAtomRequest {
  rawText: string;
  captureSource: CaptureSource;
  initialFacets?: FacetKind[];
  facetData?: Partial<AtomFacets>;
  relations?: Partial<AtomRelations>;
  body?: string;
}

export interface UpdateAtomRequest {
  expectedRevision: number;
  rawText?: string;
  facetDataPatch?: Partial<AtomFacets>;
  relationsPatch?: Partial<AtomRelations>;
  bodyPatch?: { mode: "replace" | "append" | "prepend"; value: string };
}

export interface SetTaskStatusRequest {
  expectedRevision: number;
  status: TaskStatus;
  reason?: string;
}

export interface ArchiveAtomRequest {
  expectedRevision: number;
  reason?: string;
}

export interface SaveNotepadViewRequest {
  expectedRevision?: number; // required for updates
  definition: Omit<NotepadViewDefinition, "createdAt" | "updatedAt" | "revision">;
}
```

### 21.1 Rules Engine, Jobs, Decisions, Projections, Registry, Semantic, and Migrations

```ts
// ===== Rules engine =====
export type RuleScope = "atom" | "task" | "thread" | "notepad" | "system";
export type RuleTriggerKind = "event" | "schedule" | "manual";

export interface RuleTrigger {
  kind: RuleTriggerKind;
  eventTypes?: WorkspaceEventType[];
  scheduleId?: EntityId;
}

export interface RuleCondition {
  field: string; // JSON path style, ex: "facetData.task.status"
  op:
    | "eq"
    | "neq"
    | "in"
    | "nin"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "exists"
    | "contains"
    | "matches";
  value?: unknown;
}

export type RuleActionKind =
  | "enqueue_decision_prompt"
  | "enqueue_job"
  | "emit_notification"
  | "set_field"
  | "add_relation"
  | "add_tag"
  | "record_event";

export interface RuleAction {
  kind: RuleActionKind;
  params: Record<string, unknown>;
}

export interface RuleDefinition {
  id: EntityId;
  schemaVersion: number;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number; // higher runs first
  scope: RuleScope;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
  cooldownMs?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export interface RuleEvaluationContext {
  now: IsoDateTime;
  event?: WorkspaceEvent;
  atom?: AtomRecord;
  capabilities?: CapabilitySnapshot;
}

export interface RuleEvaluationResult {
  ruleId: EntityId;
  matched: boolean;
  actions: RuleAction[];
  diagnostics?: string[];
}

// ===== Jobs / scheduler =====
export type JobType =
  | "sweep.classification"
  | "sweep.decay"
  | "sweep.boundary"
  | "triage.enqueue"
  | "recurrence.spawn"
  | "followup.enqueue"
  | "projection.refresh"
  | "semantic.reindex";

export type JobSchedule =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "weekly"; byDay: string[]; hour: number; minute: number; tz: string }
  | { kind: "manual" };

export interface JobDefinition {
  id: EntityId;
  schemaVersion: number;
  type: JobType;
  enabled: boolean;
  schedule: JobSchedule;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  dedupeWindowMs?: number;
  payloadTemplate?: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "skipped";

export interface JobRunRecord {
  id: EntityId;
  jobId: EntityId;
  status: JobRunStatus;
  trigger: "schedule" | "manual" | "rule";
  attempt: number;
  startedAt?: IsoDateTime;
  finishedAt?: IsoDateTime;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

// ===== Decision queue / interventions =====
export type DecisionPromptType =
  | "force_decision"
  | "boundary_crossing"
  | "stale_hard_commitment"
  | "blocked_followup"
  | "thread_staleness"
  | "confession";

export type DecisionPromptStatus = "pending" | "snoozed" | "resolved" | "expired" | "dismissed";

export interface DecisionOption {
  id: string;
  label: string;
  actionKind:
    | "task.do_now"
    | "task.snooze"
    | "task.drop"
    | "task.recommit"
    | "task.reschedule"
    | "task.cancel_commitment"
    | "task.unblock"
    | "task.archive"
    | "confession.create_blocker";
  payload?: Record<string, unknown>;
}

export interface DecisionPrompt {
  id: EntityId;
  schemaVersion: number;
  type: DecisionPromptType;
  status: DecisionPromptStatus;
  priority: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  atomIds: EntityId[];
  options: DecisionOption[];
  dueAt?: IsoDateTime;
  snoozedUntil?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  resolvedAt?: IsoDateTime;
  resolvedOptionId?: string;
  resolutionNotes?: string;
  revision: number;
}

// ===== Notifications =====
export type NotificationChannel = "in_app" | "push" | "email" | "sms" | "webhook";
export type NotificationStatus = "queued" | "sent" | "delivered" | "failed" | "suppressed";

export interface NotificationMessage {
  id: EntityId;
  channel: NotificationChannel;
  recipient: string;
  title: string;
  body: string;
  ctaUrl?: string;
  priority: 1 | 2 | 3 | 4 | 5;
  dedupeKey?: string;
  scheduledFor?: IsoDateTime;
  relatedAtomIds?: EntityId[];
  relatedPromptId?: EntityId;
}

export interface NotificationDeliveryRecord {
  id: EntityId;
  messageId: EntityId;
  status: NotificationStatus;
  attemptedAt: IsoDateTime;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

// ===== Concurrency and conflict =====
export interface WriteMeta {
  expectedRevision: number;
  idempotencyKey: string;
  clientMutationId?: string;
  actor: "user" | "system" | "agent";
}

export interface ConflictErrorPayload {
  entity: "atom" | "notepad" | "rule" | "job" | "prompt";
  entityId: EntityId;
  expectedRevision: number;
  actualRevision: number;
  latest?: unknown;
}

export interface MergePolicy {
  mode: "reject" | "field_level_merge" | "last_write_wins";
  mergeableFields?: string[];
}

// ===== Projections =====
export type ProjectionType =
  | "tasks.list"
  | "tasks.waiting"
  | "focus.queue"
  | "today.a_list"
  | "thread.health"
  | "history.daily";

export interface ProjectionDefinition {
  id: EntityId;
  schemaVersion: number;
  type: ProjectionType;
  source: "atoms+events";
  enabled: boolean;
  refreshMode: "event_driven" | "scheduled" | "manual";
  scheduleId?: EntityId;
  outputPath?: string;
  versionTag: string;
  revision: number;
}

export interface ProjectionCheckpoint {
  projectionId: EntityId;
  lastEventCursor?: string;
  lastRebuiltAt?: IsoDateTime;
  status: "healthy" | "lagging" | "failed";
  errorMessage?: string;
}

// ===== Thread and category registry =====
export type RegistryEntryKind = "thread" | "category";
export type RegistryEntryStatus = "active" | "stale" | "retired";

export interface RegistryEntry {
  id: EntityId;
  schemaVersion: number;
  kind: RegistryEntryKind;
  name: string;
  aliases: string[];
  status: RegistryEntryStatus;
  parentIds: EntityId[];
  attentionFloor?: AttentionLayer;
  attentionCeiling?: AttentionLayer;
  metadata?: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastActivityAt?: IsoDateTime;
  revision: number;
}

// ===== Semantic index =====
export interface SemanticChunk {
  id: EntityId;
  atomId: EntityId;
  chunkIndex: number;
  text: string;
  hash: string;
  updatedAt: IsoDateTime;
}

export interface EmbeddingVectorRef {
  chunkId: EntityId;
  model: string;
  dimensions: number;
  storageKey: string;
  createdAt: IsoDateTime;
}

export interface SemanticSearchRequest {
  query: string;
  topK: number;
  filters?: NotepadFilter;
}

export interface SemanticSearchHit {
  atomId: EntityId;
  chunkId: EntityId;
  score: number;
  snippet: string;
}

// ===== Feature flags and migrations =====
export type FeatureFlagKey =
  | "workspace.rules_engine"
  | "workspace.scheduler"
  | "workspace.decision_queue"
  | "workspace.notifications"
  | "workspace.projections"
  | "workspace.registry"
  | "workspace.semantic_index"
  | "workspace.decay_engine"
  | "workspace.recurrence"
  | "workspace.agent_handoff";

export interface FeatureFlag {
  key: FeatureFlagKey;
  enabled: boolean;
  rolloutPercent?: number;
  updatedAt: IsoDateTime;
}

export interface CapabilitySnapshot {
  capturedAt: IsoDateTime;
  obsidianCliAvailable: boolean;
  baseQueryAvailable: boolean;
  semanticAvailable: boolean;
  notificationChannels: NotificationChannel[];
  featureFlags: FeatureFlag[];
}

export type MigrationDomain = "schema" | "projection" | "rule";
export type MigrationStatus = "pending" | "running" | "succeeded" | "failed" | "rolled_back";

export interface MigrationPlan {
  id: EntityId;
  domain: MigrationDomain;
  fromVersion: number;
  toVersion: number;
  dryRun: boolean;
  steps: string[];
  createdAt: IsoDateTime;
}

export interface MigrationRun {
  id: EntityId;
  planId: EntityId;
  status: MigrationStatus;
  startedAt: IsoDateTime;
  finishedAt?: IsoDateTime;
  logs: string[];
  errorMessage?: string;
}
```

## 22. REST API Interface (Versioned)

Base path:

1. `/api/workspace/v1`

Response envelopes:

```ts
export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiError {
  ok: false;
  error: {
    code:
      | "VALIDATION_ERROR"
      | "NOT_FOUND"
      | "CONFLICT"
      | "IDEMPOTENCY_CONFLICT"
      | "OBSIDIAN_UNAVAILABLE"
      | "OBSIDIAN_TIMEOUT"
      | "VAULT_NOT_FOUND"
      | "BASE_QUERY_FAILED"
      | "RULE_EVAL_FAILED"
      | "JOB_FAILED"
      | "DECISION_INVALID"
      | "PROJECTION_STALE"
      | "REGISTRY_NOT_FOUND"
      | "SEMANTIC_UNAVAILABLE"
      | "GOVERNANCE_VIOLATION"
      | "MIGRATION_FAILED"
      | "INTERNAL_ERROR";
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
}
```

Headers:

1. `X-Workspace-Vault` optional vault override.
2. `If-Match-Revision` optional concurrency guard (alternative to body field).
3. `Idempotency-Key` required for mutating endpoints in production mode.

## 22.1 Capability and Health

1. `GET /capabilities`
   - returns: CLI availability, supported commands, base-query availability, selected vault.
2. `GET /health`
   - returns: adapter health, vault access, last successful command timestamp.

## 22.2 Atoms

1. `GET /atoms`
   - query params: `limit`, `cursor`, plus filter params mirroring `NotepadFilter`.
   - returns: `ApiSuccess<PageResponse<AtomRecord>>`
2. `POST /atoms`
   - body: `CreateAtomRequest`
   - returns: `ApiSuccess<AtomRecord>`
3. `GET /atoms/{atomId}`
   - returns: `ApiSuccess<AtomRecord>`
4. `PATCH /atoms/{atomId}`
   - body: `UpdateAtomRequest`
   - returns: `ApiSuccess<AtomRecord>`
5. `POST /atoms/{atomId}/archive`
   - body: `ArchiveAtomRequest`
   - returns: `ApiSuccess<AtomRecord>`
6. `POST /atoms/{atomId}/unarchive`
   - body: `{ expectedRevision: number }`
   - returns: `ApiSuccess<AtomRecord>`

## 22.3 Task-focused operations

1. `POST /tasks/{atomId}/status`
   - body: `SetTaskStatusRequest`
   - returns: `ApiSuccess<AtomRecord>`
2. `POST /tasks/{atomId}/complete`
   - body: `{ expectedRevision: number }`
   - effect: status -> `done`, `completedAt` set
   - returns: `ApiSuccess<AtomRecord>`
3. `POST /tasks/{atomId}/reopen`
   - body: `{ expectedRevision: number; status?: "todo" | "doing" | "blocked" }`
   - returns: `ApiSuccess<AtomRecord>`

## 22.4 Notepad views

1. `GET /notepads`
   - returns: `ApiSuccess<NotepadViewDefinition[]>`
2. `POST /notepads`
   - body: `SaveNotepadViewRequest`
   - returns: `ApiSuccess<NotepadViewDefinition>`
3. `GET /notepads/{notepadId}`
   - returns: `ApiSuccess<NotepadViewDefinition>`
4. `PATCH /notepads/{notepadId}`
   - body: `SaveNotepadViewRequest`
   - returns: `ApiSuccess<NotepadViewDefinition>`
5. `DELETE /notepads/{notepadId}`
   - returns: `ApiSuccess<{ deleted: true }>`
6. `GET /notepads/{notepadId}/atoms`
   - query params: pagination only; filters come from saved view definition
   - returns: `ApiSuccess<PageResponse<AtomRecord>>`

## 22.5 Events

1. `GET /events`
   - query params: `type`, `atomId`, `from`, `to`, `limit`, `cursor`
   - returns: `ApiSuccess<PageResponse<WorkspaceEvent>>`
2. `GET /atoms/{atomId}/events`
   - returns: `ApiSuccess<PageResponse<WorkspaceEvent>>`
3. `GET /events/stream` (optional phase)
   - server-sent events for live UI updates.

## 22.6 Classification (foundation endpoint)

1. `POST /classification/preview`
   - body: `{ rawText: string }`
   - returns: `ApiSuccess<ClassificationResult>`
2. `POST /atoms/{atomId}/classify`
   - body: `{ source: ClassificationSource; forceFacet?: "task" | "note" | "meta" }`
   - returns: `ApiSuccess<AtomRecord>`

## 22.7 Error and status conventions

1. `400` for validation failures.
2. `404` for unknown atom/notepad.
3. `409` for revision conflicts.
4. `424` when Obsidian dependency fails (`OBSIDIAN_UNAVAILABLE`, `VAULT_NOT_FOUND`).
5. `500` for unhandled internal failures.

## 22.8 Rules engine

1. `GET /rules`
   - returns: `ApiSuccess<RuleDefinition[]>`
2. `POST /rules`
   - body: `RuleDefinition` (without timestamps/revision)
   - returns: `ApiSuccess<RuleDefinition>`
3. `GET /rules/{ruleId}`
   - returns: `ApiSuccess<RuleDefinition>`
4. `PATCH /rules/{ruleId}`
   - body: partial `RuleDefinition` + `expectedRevision`
   - returns: `ApiSuccess<RuleDefinition>`
5. `POST /rules/{ruleId}/evaluate`
   - body: `{ event?: WorkspaceEvent; atomId?: EntityId }`
   - returns: `ApiSuccess<RuleEvaluationResult>`

## 22.9 Jobs and scheduler

1. `GET /jobs`
   - returns: `ApiSuccess<JobDefinition[]>`
2. `POST /jobs`
   - body: `JobDefinition` (without timestamps/revision)
   - returns: `ApiSuccess<JobDefinition>`
3. `PATCH /jobs/{jobId}`
   - body: partial `JobDefinition` + `expectedRevision`
   - returns: `ApiSuccess<JobDefinition>`
4. `POST /jobs/{jobId}/run`
   - body: `{ trigger: "manual"; payload?: Record<string, unknown> }`
   - returns: `ApiSuccess<JobRunRecord>`
5. `GET /jobs/{jobId}/runs`
   - query params: pagination
   - returns: `ApiSuccess<PageResponse<JobRunRecord>>`
6. `GET /job-runs/{runId}`
   - returns: `ApiSuccess<JobRunRecord>`

## 22.10 Decision queue and interventions

1. `GET /decisions`
   - query params: `status`, `type`, `priority`, `limit`, `cursor`
   - returns: `ApiSuccess<PageResponse<DecisionPrompt>>`
2. `POST /decisions`
   - body: `DecisionPrompt` (without timestamps/revision)
   - returns: `ApiSuccess<DecisionPrompt>`
3. `GET /decisions/{decisionId}`
   - returns: `ApiSuccess<DecisionPrompt>`
4. `POST /decisions/{decisionId}/resolve`
   - body: `{ expectedRevision: number; optionId: string; notes?: string }`
   - returns: `ApiSuccess<DecisionPrompt>`
5. `POST /decisions/{decisionId}/snooze`
   - body: `{ expectedRevision: number; until: IsoDateTime }`
   - returns: `ApiSuccess<DecisionPrompt>`
6. `POST /decisions/{decisionId}/dismiss`
   - body: `{ expectedRevision: number; reason?: string }`
   - returns: `ApiSuccess<DecisionPrompt>`

## 22.11 Notifications

1. `GET /notifications/channels`
   - returns: `ApiSuccess<{ channels: NotificationChannel[] }>`
2. `POST /notifications/send`
   - body: `NotificationMessage`
   - returns: `ApiSuccess<NotificationDeliveryRecord>`
3. `GET /notifications/deliveries`
   - query params: `status`, `channel`, `limit`, `cursor`
   - returns: `ApiSuccess<PageResponse<NotificationDeliveryRecord>>`

## 22.12 Projections

1. `GET /projections`
   - returns: `ApiSuccess<ProjectionDefinition[]>`
2. `POST /projections`
   - body: `ProjectionDefinition` (without revision)
   - returns: `ApiSuccess<ProjectionDefinition>`
3. `GET /projections/{projectionId}/checkpoint`
   - returns: `ApiSuccess<ProjectionCheckpoint>`
4. `POST /projections/{projectionId}/refresh`
   - body: `{ mode: "incremental" | "full" }`
   - returns: `ApiSuccess<ProjectionCheckpoint>`
5. `POST /projections/rebuild`
   - body: `{ projectionIds?: EntityId[] }`
   - returns: `ApiSuccess<{ accepted: true; jobRunIds: EntityId[] }>`

## 22.13 Thread and category registry

1. `GET /registry/entries`
   - query params: `kind`, `status`, `search`
   - returns: `ApiSuccess<RegistryEntry[]>`
2. `POST /registry/entries`
   - body: `RegistryEntry` (without timestamps/revision)
   - returns: `ApiSuccess<RegistryEntry>`
3. `PATCH /registry/entries/{entryId}`
   - body: partial `RegistryEntry` + `expectedRevision`
   - returns: `ApiSuccess<RegistryEntry>`
4. `DELETE /registry/entries/{entryId}`
   - returns: `ApiSuccess<{ deleted: true }>`
5. `GET /registry/suggestions`
   - query params: `text`, `kind`
   - returns: `ApiSuccess<{ suggestions: string[] }>`

## 22.14 Semantic index

1. `POST /semantic/search`
   - body: `SemanticSearchRequest`
   - returns: `ApiSuccess<{ hits: SemanticSearchHit[] }>`
2. `POST /semantic/reindex`
   - body: `{ atomIds?: EntityId[] }`
   - returns: `ApiSuccess<{ accepted: true; jobRunId: EntityId }>`
3. `GET /semantic/chunks/{chunkId}`
   - returns: `ApiSuccess<SemanticChunk>`

## 22.15 Governance

1. `GET /governance/policies`
   - returns: `ApiSuccess<{ retentionPolicies: Record<string, unknown>[]; defaultSensitivity: SensitivityLevel }>`
2. `POST /atoms/{atomId}/governance`
   - body: `{ expectedRevision: number; governance: GovernanceMeta }`
   - returns: `ApiSuccess<AtomRecord>`

## 22.16 Feature flags and capabilities

1. `GET /features`
   - returns: `ApiSuccess<FeatureFlag[]>`
2. `PATCH /features/{key}`
   - body: `{ enabled: boolean; rolloutPercent?: number }`
   - returns: `ApiSuccess<FeatureFlag>`
3. `GET /capability-snapshot`
   - returns: `ApiSuccess<CapabilitySnapshot>`

## 22.17 Migrations

1. `POST /migrations/plan`
   - body: `{ domain: MigrationDomain; fromVersion: number; toVersion: number; dryRun: boolean }`
   - returns: `ApiSuccess<MigrationPlan>`
2. `POST /migrations/run`
   - body: `{ planId: EntityId }`
   - returns: `ApiSuccess<MigrationRun>`
3. `GET /migrations/runs/{runId}`
   - returns: `ApiSuccess<MigrationRun>`
4. `POST /migrations/runs/{runId}/rollback`
   - body: `{ reason?: string }`
   - returns: `ApiSuccess<MigrationRun>`

## 23. Tauri Command Parity (for current desktop architecture)

Even if no HTTP server is exposed in desktop mode, keep 1:1 parity between REST contracts and Tauri commands.

Tauri command names:

1. `workspace_capabilities_get`
2. `workspace_health_get`
3. `atoms_list`
4. `atom_get`
5. `atom_create`
6. `atom_update`
7. `atom_archive`
8. `atom_unarchive`
9. `task_status_set`
10. `task_complete`
11. `task_reopen`
12. `notepads_list`
13. `notepad_get`
14. `notepad_save`
15. `notepad_delete`
16. `notepad_atoms_list`
17. `events_list`
18. `atom_events_list`
19. `classification_preview`
20. `atom_classify`
21. `rules_list`
22. `rule_get`
23. `rule_save`
24. `rule_update`
25. `rule_evaluate`
26. `jobs_list`
27. `job_get`
28. `job_save`
29. `job_update`
30. `job_run`
31. `job_runs_list`
32. `job_run_get`
33. `decisions_list`
34. `decision_create`
35. `decision_get`
36. `decision_resolve`
37. `decision_snooze`
38. `decision_dismiss`
39. `notification_channels_list`
40. `notification_send`
41. `notification_deliveries_list`
42. `projections_list`
43. `projection_get`
44. `projection_save`
45. `projection_checkpoint_get`
46. `projection_refresh`
47. `projection_rebuild`
48. `registry_entries_list`
49. `registry_entry_get`
50. `registry_entry_save`
51. `registry_entry_update`
52. `registry_entry_delete`
53. `registry_suggestions_list`
54. `semantic_search`
55. `semantic_reindex`
56. `semantic_chunk_get`
57. `governance_policies_get`
58. `atom_governance_update`
59. `feature_flags_list`
60. `feature_flag_update`
61. `capability_snapshot_get`
62. `migration_plan_create`
63. `migration_run_start`
64. `migration_run_get`
65. `migration_run_rollback`

This ensures:

1. desktop IPC and future REST stay contract-compatible.
2. frontend can remain transport-agnostic.
3. migration to service mode later is low-risk.

## 24. Expansion Foundations (Operational Design)

## 24.1 Rules engine execution model

1. Rules evaluate in deterministic order: descending `priority`, then ascending `id`.
2. Rules are pure by default: evaluation computes proposed actions first, then action executor applies them.
3. A rule run emits a trace event with inputs, matched conditions, and applied actions.
4. Cooldown keys are scoped by `(ruleId, atomId|system)` to prevent repeated prompt spam.
5. Hard guardrail: one rule run cannot recursively trigger itself more than once per transaction.
6. Initial enforcement mode:
   - V1: suggest + enqueue prompt/job/notification only.
   - Later: allow direct mutation actions under feature flag.

## 24.2 Scheduler and job runtime

1. Scheduler supports interval, weekly, and manual schedules.
2. All job runs require `idempotencyKey`; duplicate submissions return existing run.
3. Concurrency rule:
   - only one active run per `jobId` unless job is marked `parallelSafe`.
4. Retry policy uses exponential backoff bounded by `maxRetries`.
5. Timeouts mark run `failed` with `JOB_FAILED`, then route through retry policy.
6. Every run writes a `job.run.*` event for observability and projection repair.

## 24.3 Decision queue lifecycle

1. Prompt lifecycle: `pending -> snoozed -> pending -> resolved|dismissed|expired`.
2. Decision prompt IDs are stable; option IDs are immutable.
3. Resolve operations are idempotent by `(decisionId, idempotencyKey)`.
4. Prompt dedupe key:
   - `(type, atomIds hash, window bucket)` prevents repeated near-identical prompts.
5. Escalation policy:
   - overdue `pending` prompts increase priority and trigger notification routing.
6. Confession flow support:
   - `confession.create_blocker` option must create a new atom and link via `derived_from`.

## 24.4 Notification orchestration

1. Notification pipeline:
   - produce message -> policy check -> channel adapter -> delivery record.
2. Dedupe uses `dedupeKey + channel + recipient`.
3. Quiet-hours and channel preference policy must run before send.
4. In-app channel is required in V1; external channels are optional adapters.
5. Delivery outcomes emit events so missed nudges can be audited.

## 24.5 Conflict and concurrency semantics

1. Mutations require both `expectedRevision` and `idempotencyKey`.
2. Revision mismatch returns `409 CONFLICT` with latest entity snapshot.
3. Idempotency collision with different payload returns `409 IDEMPOTENCY_CONFLICT`.
4. Merge policies:
   - default `reject`.
   - optional `field_level_merge` for safe fields (`body append`, tags, non-overlapping relations).
5. Conflict UIs must offer reload + reapply strategy, never silent overwrite.

## 24.6 Projection pipeline semantics

1. Projections are derived, never canonical.
2. Each projection has:
   - definition version
   - checkpoint cursor
   - health status.
3. Incremental refresh consumes events after checkpoint.
4. Full rebuild replays complete atom + event history.
5. On reducer errors, projection status becomes `failed`; consumers fall back to direct query.

## 24.7 Thread and category registry semantics

1. Registry entry names are unique per kind after case-folding.
2. Aliases are globally unique within each kind.
3. Entries can be `stale` without deleting relationships.
4. Retirement preserves historical event references but removes future assignment.
5. Attention floor/ceiling conflicts resolve as:
   - highest floor wins, lowest ceiling wins, and floor dominates if impossible.

## 24.8 Semantic index semantics

1. Semantic index is eventually consistent and always optional.
2. Canonical search fallback:
   - if semantic unavailable, use lexical query path.
3. Chunking strategy:
   - deterministic chunk boundaries by token window + overlap.
4. Reindex triggers:
   - atom create/update/archive
   - migration changing chunking rules.
5. Embedding provider/model version is stored for reproducibility.

## 24.9 Governance and retention semantics

1. Every atom carries governance metadata.
2. Sensitivity defaults apply at create time and can be tightened later.
3. Retention policies run through scheduled jobs and emit `governance.retention_applied` events.
4. Agent access to atoms must check `allowedAgentScopes` and sensitivity policy.
5. Governance violations are hard errors, not warnings.

## 24.10 Feature flags and migration semantics

1. Advanced modules are gated by feature flags with optional rollout percentages.
2. Flags are evaluated server-side in capability snapshots; frontend reads effective capability.
3. Migration flow:
   - plan (dry-run optional)
   - run
   - verify
   - optional rollback.
4. No destructive migration runs without prior successful dry-run in production mode.
5. Migration runs are serialized per domain (`schema`, `projection`, `rule`).

## 24.11 Daily sweep reference flow (foundation behavior)

1. Scheduler starts `sweep.boundary`.
2. Job queries candidate atoms via projection or fallback query.
3. Rules engine evaluates candidates and emits decision prompts.
4. Decision queue stores prompts; notifier sends in-app nudges.
5. User resolves prompts; resolver mutates atoms with revision checks.
6. Mutations emit events; projections refresh incrementally.
7. Health service exposes lag/errors for monitoring and recovery.

## 25. Maintainability Hardening (Required Foundation)

This section is normative. Treat these as implementation requirements, not optional guidance.

## 25.1 Repository and module boundaries

Target structure (TypeScript):

```text
src/workspace/
  domain/
    models/
    invariants/
    services/
  application/
    usecases/
    ports/
    dto/
  infrastructure/
    tauri/
    adapters/
    mappers/
  ui/
    screens/
    components/
    state/
```

Target structure (Rust):

```text
src-tauri/src/workspace/
  domain/
  application/
  infrastructure/
  api/
```

Boundary rules:

1. `ui -> application -> domain` only; UI cannot import infrastructure modules.
2. Domain contains no I/O and no framework-specific types.
3. Application uses interfaces/ports; infrastructure provides adapters.
4. Tauri command handlers are thin transport wrappers only.
5. Shared contracts live in one canonical location; no duplicated DTO definitions.

## 25.2 Architectural Decision Records (ADR) policy

1. Add `docs/adr/` with sequential ADRs (`ADR-0001-...md`).
2. Required ADR topics before implementation:
   - Atom schema lock (v1)
   - rules engine execution semantics
   - scheduler idempotency strategy
   - projection refresh strategy
   - migration safety policy
3. Any change to public contracts, persistence schema, rule runtime, or migration policy requires a new ADR.
4. PRs touching these areas must reference an ADR.

## 25.3 Invariants and contract guarantees

Core invariants:

1. Atom `id` is immutable and globally unique.
2. Atom `revision` increases monotonically on every mutation.
3. Events are append-only and never hard-mutated.
4. Projections are disposable and fully rebuildable from canonical sources.
5. Rules are side-effect free during evaluation; side effects occur only in action executor.
6. All mutating operations require idempotency keys.
7. All writes are constrained to approved vault root paths.

Enforcement:

1. Add invariant assertions in domain services.
2. Add property-based tests for ID/revision/event invariants.
3. Add startup checks for required folder topology and writable paths.

## 25.4 Versioning and compatibility policy

1. API path is versioned (`/api/workspace/v1`).
2. Contract changes within `v1` must be additive only.
3. Field lifecycle states:
   - `active`
   - `deprecated`
   - `removed` (only on major version).
4. Deprecation process:
   - mark deprecated in docs/contracts
   - emit warning telemetry
   - keep support for minimum two release cycles.
5. Tauri command names are stable; breaking rename requires compatibility shim for two cycles.

## 25.5 Testing and quality gates (CI)

Required CI gates per PR touching workspace modules:

1. Type check + lint + format checks.
2. Unit tests for domain/application layers.
3. Contract tests for REST/Tauri parity.
4. Adapter integration tests with mocked Obsidian CLI.
5. Migration dry-run test if schema/projection/rule changes are present.
6. Snapshot tests for JSON schemas and API examples.

Minimum thresholds:

1. Domain/application test coverage >= 85%.
2. No file in domain/application layer exceeds 400 lines without ADR exception.
3. No function in domain/application layer exceeds agreed complexity threshold.

## 25.6 Observability baseline

Required metrics:

1. Obsidian command success rate, p95 latency, and timeout count.
2. Mutation conflict rate (`CONFLICT`, `IDEMPOTENCY_CONFLICT`).
3. Job queue depth, job success/failure rate, retry counts.
4. Decision prompt backlog size and median time-to-resolution.
5. Projection lag and rebuild duration.

Required logs:

1. Structured logs with requestId, actor, entityId, operation, outcome.
2. No raw sensitive content in logs.
3. Governance/audit actions logged immutably.

Required health checks:

1. vault access check
2. CLI capability check
3. projection checkpoint staleness check
4. scheduler heartbeat check

## 25.7 Runbooks and operational recovery

Add `docs/runbooks/workspace/` with at least:

1. Obsidian CLI unavailable
2. Vault path mismatch
3. Projection corruption / lag recovery
4. Decision queue backlog recovery
5. Failed migration rollback
6. Notification delivery outage

Each runbook must contain:

1. symptoms
2. diagnostics
3. safe mitigation
4. rollback path
5. post-incident follow-up checklist

## 25.8 Ownership and code stewardship

1. Assign module owners for:
   - domain contracts
   - Obsidian adapter
   - scheduler/rules
   - projection pipeline
   - migration tooling
2. Require owner review on changes to owned modules.
3. Rotate secondary owner quarterly to reduce key-person risk.
4. Maintain a `docs/workspace-ownership.md` map.

## 25.9 Documentation and onboarding requirements

Required docs:

1. `docs/workspace-architecture.md` (C4-style summary)
2. `docs/workspace-contracts.md` (TS + REST + Tauri canonical references)
3. `docs/workspace-data-dictionary.md` (field definitions and semantics)
4. `docs/workspace-migrations.md` (how to plan, dry-run, apply, rollback)
5. `docs/workspace-local-dev.md` (dev setup, fixtures, test commands)

Rule:

1. Any contract change PR must update relevant docs in the same PR.

## 25.10 Security and privacy-by-design defaults

1. Default atom sensitivity is `internal`.
2. Notification channels must enforce governance policy before send.
3. Agent operations require explicit scope check on every request.
4. Security-sensitive changes require threat review notes in PR description.

## 26. Phase Exit Criteria (Definition of Done)

A phase is complete only if all exit criteria are satisfied.

## 26.1 Phase 0 exit criteria

1. Core interfaces compile in TS and Rust.
2. ADRs for schema/runtime/migration policy are merged.
3. Contract tests for DTO serialization pass.

## 26.2 Phase 1 exit criteria

1. End-to-end atom task CRUD works against Obsidian adapter.
2. Revision/idempotency conflicts are handled deterministically.
3. Event emission for all mutations is validated.

## 26.3 Phase 2 exit criteria

1. Saved notepad views load/apply correctly.
2. Registry assignment and alias resolution works.
3. Projection fallback path remains functional.

## 26.4 Phase 3 exit criteria

1. Scheduler manual run and recurring run both verified.
2. Decision queue actions mutate state and emit events.
3. In-app notifications deliver and dedupe correctly.

## 26.5 Phase 4 exit criteria

1. Mixed capture classification can be overridden and audited.
2. Decomposition preserves lineage links.
3. No raw capture loss across reclassification paths.

## 26.6 Phase 5 exit criteria

1. At least two production projections are healthy and rebuildable.
2. Projection lag alerting is active.
3. Semantic search fallback to lexical path is verified.

## 26.7 Phase 6+ exit criteria

1. Rules-driven boundary prompts are deterministic and rate-limited.
2. Migration dry-run + apply + rollback flow is validated in staging.
3. Feature flags support safe canary rollout and disable-on-failure.

## 27. Lock-in Decisions for Initial Implementation

To reduce drift and re-litigation, start with these defaults:

1. Vault is user-configurable with a default of `Core (OneDrive)` if present.
2. `atoms.base` and `tasks.base` are auto-created if missing, with idempotent bootstrap.
3. Body editing is enabled in V1 with append/prepend + guarded replace mode.
4. Merge policy defaults to `reject`; field-level merge opt-ins are explicit.
5. Semantic index is off by default behind feature flag.
6. External notifications are off by default; in-app channel only in first rollout.

## 28. Codebase Grounding Addendum (Mandatory Before Implementation)

This section maps the proposed workspace architecture to the current repository so we avoid duplicate infrastructure.

## 28.1 Current assets to reuse

Frontend and state:

1. `src/state/appState.tsx` already provides global reducer/action architecture and event subscription loop.
2. `src/lib/tauriClient.ts` already defines the transport boundary for Tauri commands and local mock fallback.
3. `src/lib/types.ts` is the canonical frontend contract surface for API DTOs.
4. `src/App.tsx` and `src/components/Sidebar/navigationConfig.ts` already provide screen routing + sidebar extensibility.

Backend and runtime:

1. `src-tauri/src/lib.rs` already defines Tauri command handlers and startup task wiring.
2. `src-tauri/src/runner.rs` already centralizes business orchestration and event emission.
3. `src-tauri/src/scheduler.rs` already implements queueing, concurrency limits, retries, and delayed execution semantics.
4. `src-tauri/src/models.rs` already defines backend serialized contract types.
5. `src-tauri/src/db/schema.sql` already includes durable tables for settings, jobs, events, and profiles.

## 28.2 Reuse/extend/new decisions

Use this as the implementation decision matrix.

1. Transport boundary
   - Decision: `extend existing`.
   - Reuse `src/lib/tauriClient.ts` and add workspace methods there.
   - Do not create a second frontend transport client.

2. Global app state
   - Decision: `extend existing`.
   - Add workspace slice/actions in `src/state/appState.tsx`.
   - Do not create a parallel store for workspace features.

3. Event bus and envelopes
   - Decision: `extend existing`.
   - Reuse `run_event` channel + `StreamEnvelope` pattern, adding workspace event types.
   - Do not create a second event channel unless ADR-approved.

4. Scheduler runtime
   - Decision: `extend existing`.
   - Reuse `src-tauri/src/scheduler.rs` as the single scheduling runtime.
   - Add job categories/types for workspace sweeps instead of new scheduler service.

5. Backend orchestration
   - Decision: `extend existing`.
   - Keep `RunnerCore` (`src-tauri/src/runner.rs`) as orchestration root and add workspace modules behind it.
   - Do not add a competing orchestration root.

6. Persisted settings and capabilities
   - Decision: `extend existing`.
   - Reuse settings patterns and `update_settings/get_settings` command style.
   - Workspace-specific settings should piggyback on current settings model/migrations.

7. DB persistence
   - Decision: `hybrid`.
   - Canonical workspace data remains in Obsidian files as planned.
   - Reuse SQLite only for local runtime concerns (checkpoints, queue state, caches, feature flags, run logs).

8. REST compatibility
   - Decision: `design for parity`.
   - Keep REST contracts as canonical spec while implementing via Tauri IPC now.
   - Do not build an in-app HTTP server unless future deployment mode requires it.

## 28.3 Duplication guardrails (must enforce)

1. Exactly one scheduler runtime: `src-tauri/src/scheduler.rs`.
2. Exactly one frontend command gateway: `src/lib/tauriClient.ts`.
3. Exactly one global app state store: `src/state/appState.tsx`.
4. Exactly one event envelope root type: `StreamEnvelope` (or versioned successor via ADR).
5. Exactly one place for command registration: `src-tauri/src/lib.rs`.
6. Exactly one canonical shared contract package per language (`src/lib/types.ts` and `src-tauri/src/models.rs`).

## 28.4 Gap matrix from current codebase

Implement these as deltas, not replacements.

1. Sidebar and route
   - Existing: nav config + screen switch architecture.
   - Gap: `workspace` group and `tasks` screen ID.
   - Action: extend existing configs only.

2. Workspace domain contracts
   - Existing: run/conversation/metric contracts in TS and Rust.
   - Gap: atom/notepad/rule/job/decision/projection/governance contracts.
   - Action: add new contract blocks to existing type modules.

3. Tauri command surface
   - Existing: mature command list in `src-tauri/src/lib.rs`.
   - Gap: workspace command handlers and wiring.
   - Action: add new commands adjacent to existing patterns.

4. Runner orchestration
   - Existing: `RunnerCore` queueing, eventing, capability refresh, retention.
   - Gap: workspace use-cases and adapters.
   - Action: add workspace service modules and invoke from RunnerCore.

5. Scheduler jobs
   - Existing: run queue and retry model with per-provider/global concurrency.
   - Gap: scheduled workspace sweeps and projection refresh jobs.
   - Action: extend job model and executor mapping, not scheduler replacement.

6. Event model
   - Existing: `run_event` stream and persistence of run events.
   - Gap: workspace event taxonomy and consumer reducers.
   - Action: add workspace event types to current envelope/reducer flow.

7. Local mock/dev mode
   - Existing: rich mock store in `src/lib/tauriClient.ts` for non-Tauri.
   - Gap: workspace mock fixtures and operations.
   - Action: extend mock store with workspace entities for frontend development.

8. Data migrations
   - Existing: SQL schema and bootstrapping patterns.
   - Gap: workspace feature flags/checkpoints/migration metadata persistence.
   - Action: add SQL migrations and migration runner hooks in current style.

## 28.5 Concrete “extend-first” implementation sequence

1. Add workspace types in `src/lib/types.ts` and mirrored Rust models in `src-tauri/src/models.rs`.
2. Add Tauri commands in `src-tauri/src/lib.rs` with thin wrappers, following existing command style.
3. Add RunnerCore workspace methods in `src-tauri/src/runner.rs`, reusing current error/event patterns.
4. Add tauri client methods in `src/lib/tauriClient.ts`, including mock mode behavior.
5. Extend app state in `src/state/appState.tsx` (actions, reducer cases, refresh integration).
6. Add sidebar + route integration in `src/components/Sidebar/navigationConfig.ts` and `src/App.tsx`.
7. Add `TasksScreen` and iterate UI on top of existing shared component and banner patterns.

## 28.6 Pre-merge grounding checklist (required for workspace PRs)

1. PR includes explicit `reuse/extend/new` notes for touched modules.
2. PR confirms no parallel scheduler/state/transport/event system introduced.
3. PR links relevant ADR when changing envelope, command naming, or shared contracts.
4. PR updates docs when contracts change.
5. PR passes contract parity tests (`types.ts` <-> `models.rs` mapping checks).

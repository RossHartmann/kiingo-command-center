# Project Context Feature Completion Plan

Date: 2026-02-19
Status: Draft implementation plan

## 1. Goal

Deliver the remaining project/notepad split features so the model is fully usable in daily workflows, with explicit project context, manageable label taxonomy, and safe rollout for existing users.

Features in scope:

1. Label registry UI (taxonomy management)
2. Project -> views association panel (multi-view project contexts)
3. Task <-> project context chips (context visibility in Tasks)
4. Capture defaults on project create/edit (projects are operational, not just labels)
5. Migration backfill trigger (explicit path for existing users)

## 2. Spec Grounding

Primary anchors used:

1. Notepads are views/lenses over a shared pool:
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/original-idea/notepad.md` (Notepads: views, not containers; Ctrl+O switching)
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md` (Why notepads are views)
2. Capture defaults are first-class behavior for context views:
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md` (view capture defaults)
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-golden-flows.md` (GF-04, GF-05)
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/algorithms/notetaker-algorithms.md` (3.3 category-notepad capture defaults)
3. Unified label model, synonyms, graph taxonomy, and manage-categories surface:
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md` (labels, synonyms, taxonomy graph, manage categories UI)
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-golden-flows.md` (GF-20 manage category graph)
4. Context should be visible and operable in task workflows:
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md` (metadata inspection, context-aware organization)

Note on migrations: the spec does not define a specific "project backfill trigger" flow; this is a required rollout addition for compatibility with existing workspaces.

## 3. Current Baseline (Confirmed in Code)

1. Project model exists with `viewIds`, `defaultViewId`, and `captureDefaults` in both TS and Rust.
   - `src/lib/types.ts`
   - `src-tauri/src/models.rs`
   - `src-tauri/src/workspace.rs`
2. Project CRUD/open APIs already exist.
   - `src/lib/tauriClient.ts`
   - `src-tauri/src/workspace.rs`
3. Registry CRUD APIs exist, but there is no dedicated taxonomy management screen.
   - `src/lib/tauriClient.ts`
   - UI usage today is mostly helper-level in `src/screens/NotepadScreen.tsx`
4. Projects UI currently supports only basic create/edit (name/kind/labels/default view), not full view association management or capture defaults editing.
   - `src/screens/ProjectsScreen.tsx`
   - `src/components/projects/ProjectListSidebar.tsx`
5. Tasks UI shows raw labels/categories text, but not resolved project context chips.
   - `src/screens/TasksScreen.tsx`
6. Project backfill exists only as implicit auto-backfill (`ensure_projects_backfilled`), not an explicit user trigger/report.
   - `src-tauri/src/workspace.rs`
   - No migration UI currently calls migration APIs

## 4. Implementation Plan by Feature

## 4.1 Feature 1: Label Registry UI

Outcome: Users can discover, create, rename, alias, and organize labels (category/thread/north_star) with visible taxonomy.

Frontend work:

1. Add a dedicated label registry surface and route entry from Workspace navigation.
2. Create `src/screens/LabelRegistryScreen.tsx` with:
   - search/filter by kind and status
   - table/list of labels with aliases and parent relationships
   - create/edit/delete/retire actions
3. Add reusable editor components:
   - `src/components/labels/LabelEditorPanel.tsx`
   - `src/components/labels/LabelPicker.tsx`
4. Add graph-aware controls:
   - parent assignment and "also under" editing
   - include-descendants preview helper for downstream view filters

Backend/API work:

1. Reuse existing registry commands (`registry_entries_list/get/save/update/delete`).
2. Harden validation to prevent taxonomy cycles on `parentIds` updates.
3. Keep alias uniqueness checks and canonical-name conflict checks enforced.

Acceptance criteria:

1. User can manage labels and aliases without leaving app context.
2. Parent-child label relationships are editable and cycle-safe.
3. Project and notepad forms can consume canonical label selections from the registry UI.

## 4.2 Feature 2: Project -> Views Association Panel

Outcome: A project can manage multiple associated notepad views, with explicit default-view routing.

Frontend work:

1. Add an association panel to `src/screens/ProjectsScreen.tsx` project detail area.
2. Panel capabilities:
   - list associated views
   - add/remove view associations
   - set one default view
   - optionally create a new manual/computed view and attach it immediately
3. Replace free-text or implicit behavior with explicit view management in project edit flow.

Backend/API work:

1. Continue using `project_views_list` and `project_save` for persistence.
2. Add a dedicated helper command for safer association updates (single mutation path):
   - `project_associations_save` (projectId, defaultViewId, viewIds, expectedRevision, idempotencyKey)
3. Optional but recommended consistency sync:
   - when associated, write `scopeProjectId` and `displayRole` on notepad definitions

Acceptance criteria:

1. A project can be linked to multiple views.
2. Default view is always one of associated views.
3. Opening a project routes to the configured default view deterministically.

## 4.3 Feature 3: Task <-> Project Context Chips

Outcome: Tasks screen makes project context visible so users can immediately see "what context am I in" and jump there.

Frontend work:

1. Load project and registry data in `src/screens/TasksScreen.tsx`.
2. Add `src/lib/projectContextResolver.ts` to compute matching projects per atom:
   - match by project `labelIds` against task thread IDs and resolved label names/aliases
   - score by overlap strength
   - cap visible chips per task (for noise control)
3. Render project chips in task cards (compact and expanded states).
4. Clicking a chip opens project default view (same path as project open in Projects/Omni).

Backend/API work:

1. Reuse existing `projects_list`, `project_open`, and registry APIs.
2. No new persistence required for first pass.

Acceptance criteria:

1. Tasks with matching project context show project chips.
2. Chips are stable for the same task metadata.
3. Chip click opens project context quickly and correctly.

## 4.4 Feature 4: Capture Defaults on Project Create/Edit

Outcome: Project creation/editing includes real capture behavior so projects encode operational defaults.

Frontend work:

1. Expand create/edit forms in:
   - `src/components/projects/ProjectListSidebar.tsx`
   - `src/screens/ProjectsScreen.tsx`
2. Add editable fields for project capture defaults:
   - labels/categories
   - thread IDs
   - default task status
   - default task priority
3. For `label_project`, prefill capture-default labels from selected project labels with user override.
4. Add "Apply defaults to associated views" action for one-time propagation to selected notepads.

Capture application behavior:

1. Extend project-open event payload to carry `projectId` when opening a notepad via project.
2. In Notepad screen, track active project context for the current session.
3. Extend `notepadBlockCreate` request with optional `projectId`.
4. In Rust `notepad_block_create_inner`, merge capture defaults:
   - set-valued fields: union of notepad and project defaults
   - scalar fields (`taskStatus`, `taskPriority`): notepad override first, then project, then system default

Acceptance criteria:

1. Project forms can create/update `captureDefaults` directly.
2. Captures made in a project-opened context apply project defaults predictably.
3. Existing non-project capture flows remain unchanged.

## 4.5 Feature 5: Migration Backfill Trigger

Outcome: Existing users have a visible, controllable, and auditable way to backfill projects from legacy notepad state.

Backend/API work:

1. Extend migration domain support to include `project` / `projects`.
   - update canonical domain parsing
   - add project migration steps in `migration_steps_for_domain`
   - add `execute_project_migration`
2. `execute_project_migration` behavior:
   - dry run: count notepads, existing projects, derived candidates, conflicts
   - apply: create missing derived projects with deterministic IDs and `source=migrated_derived`
   - idempotent: repeated runs do not duplicate
3. Emit migration events/logs for auditability.

Frontend work:

1. Add migration controls to Projects screen:
   - "Dry Run Backfill"
   - "Run Backfill"
   - show summary logs/results from migration run
2. Use existing migration APIs:
   - `migrationPlanCreate`
   - `migrationRunStart`
   - `migrationRunGet`

Acceptance criteria:

1. User can trigger dry-run and apply backfill from UI.
2. Results clearly show what changed.
3. Running backfill multiple times is safe and no-op after convergence.

## 5. Delivery Phases

## Phase 0: Contracts and Safety

1. Add `project` migration domain support (TS + Rust).
2. Add cycle validation for label taxonomy edges.
3. Add/confirm feature flags:
   - `workspace.projects_v1`
   - `workspace.project_default_views`
   - `workspace.project_context_chips_v1` (new)
   - `workspace.label_registry_ui_v1` (new)

## Phase 1: Registry + Project Form Upgrades

1. Ship label registry screen and shared label picker.
2. Replace project label CSV reliance with canonical selection.
3. Add project capture-default fields in create/edit forms.

## Phase 2: Project View Associations

1. Ship project association panel.
2. Add robust association save path and default-view enforcement.
3. Add optional scope sync to notepad definitions.

## Phase 3: Task Context Chips

1. Ship resolver and chips in Tasks cards.
2. Add jump-to-project action from chips.
3. Validate chip stability/performance on medium data sets.

## Phase 4: Explicit Backfill UX

1. Ship migration trigger controls in Projects.
2. Add dry-run/apply summary rendering.
3. Keep implicit backfill for compatibility, but prefer explicit migration path in UI copy.

## 6. Testing Plan

Rust unit/integration tests:

1. Registry parent cycle prevention rejects invalid updates.
2. Project association update keeps default view valid.
3. Project capture-default merge logic works as specified.
4. Project migration dry-run/apply are idempotent and deterministic.

Frontend tests:

1. Label registry CRUD and alias search behavior.
2. Project association panel add/remove/default flows.
3. Tasks project-chip resolver correctness for labels + thread matches.
4. Project create/edit capture defaults persist and rehydrate correctly.
5. Migration trigger UI handles success/failure paths and log rendering.

Manual QA checklist:

1. Start from pre-project workspace and run project backfill.
2. Create a label project with two views and verify project open routing.
3. Capture new tasks from project-opened notepad and verify defaults.
4. Confirm tasks show project chips and chip navigation is correct.

## 7. Risks and Mitigations

1. Risk: label taxonomy UI increases complexity.
   - Mitigation: start with list-plus-relationships first, defer advanced graph visuals.
2. Risk: project-task mapping ambiguity when labels are alias-heavy.
   - Mitigation: resolve via canonical registry IDs/names and deterministic scoring.
3. Risk: capture-default merging surprises users.
   - Mitigation: explicit merge rule, visible helper text, and "Apply to views" one-time action.
4. Risk: migration confusion for users already auto-backfilled.
   - Mitigation: dry-run summaries and idempotent no-op messaging.

## 8. Definition of Done

1. All five requested features are shipped behind flags and verified.
2. Projects are visibly multi-view, context-rich, and operational for capture.
3. Tasks clearly show project context chips with direct navigation.
4. Existing users can run explicit backfill and inspect results safely.
5. No regression in existing notepad/task workflows.

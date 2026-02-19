# Project vs Notepad Concept Separation Plan

Date: 2026-02-19  
Status: Draft (architecture + migration plan)

## 1. Purpose

Split the currently conflated concepts of "Project" and "Notepad" into independent concepts aligned with spec intent:

1. Notepad = view/lens over shared block pool (filters + sort + capture defaults).
2. Project = user-level work context that can be represented by labels/threads and/or a curated workspace.

## 2. Spec Grounding

Primary spec anchors:

1. Notepads are views, not containers:
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/original-idea/notepad.md:293`
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md:102`
2. Labels are unified ontology (category/thread/north star):
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md:191`
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md:201`
3. Open Notepad by category/multi-category:
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/original-idea/notepad.md:216`
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-golden-flows.md:142`
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/algorithms/notetaker-algorithms.md:384`

## 3. Current Coupling (What Must Be Untangled)

Current UI/behavior uses "Project" language for Notepads:

1. Sidebar uses label "Projects" for `screenId=notepad`.
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/components/Sidebar/navigationConfig.ts:124`
2. Notepad toolbar uses "Active project", "Project controls", "New project", etc.
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadToolbar.tsx:164`
3. Tasks copy says "Tasks across your projects" and "Open Projects" while data is notepad/block based.
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/TasksScreen.tsx:790`
4. Omni search result type is still `project` for notepad entities.
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/components/OmniSearch.tsx:27`

Net: "Project" is currently a label for `NotepadViewDefinition`, not an independent domain object.

## 4. Target Domain Model

## 4.1 Canonical entities

1. `Block` and `Atom`: unchanged as shared source-of-truth content pool.
2. `Label`: unchanged unified ontology (`category`, `thread`, `north_star`).
3. `NotepadView` (existing): saved lens over blocks.
4. `Project` (new): work context object that references labels and default views.

## 4.2 Project archetypes

1. `label_project`
   - Backed by one or more label IDs (category/thread).
   - Default behavior: open a computed notepad view over those labels.
2. `workspace_project`
   - Curated/manual arrangement surface (manual placements, project board/workpad semantics).
   - May still carry label defaults, but primary identity is project workspace.

## 4.3 Notepad roles after split

1. `inbox_notepad` (system NOW).
2. `computed_notepad` (filter-driven category/thread/multi-label views).
3. `manual_notepad` (curated placement order, project workpad style).

Notepads remain implementation of "how to look at/work with blocks"; Projects become "what context am I working in."

## 5. Schema and Contract Changes

## 5.1 New `ProjectDefinition` contract

Add new object:

1. `id`, `name`, `description`, `status`.
2. `kind`: `label_project | workspace_project`.
3. `labelIds`: primary labels representing the project.
4. `defaultViewId`: default notepad to open for the project.
5. `viewIds`: optional set of associated notepads.
6. `captureDefaults`: optional metadata for project-scoped capture.
7. timestamps + revision.

## 5.2 Notepad contract refinement

Keep `NotepadViewDefinition`, but add semantic fields:

1. `viewKind`: `inbox | computed | manual`.
2. `scopeProjectId?`: optional link when this view belongs to a project.
3. `displayRole?`: `default_project_view | alt_project_view | freeform`.

## 5.3 API additions

Add project APIs in client + Tauri:

1. `projects_list/get/save/update/delete`.
2. `project_open(projectId)` returning resolved `defaultViewId`.
3. `project_views_list(projectId)`.

No removal of notepad APIs in initial phases.

## 6. UX and IA Changes

## 6.1 Navigation split

Move from one "Projects" screen to explicit separation:

1. `Projects` screen (project contexts).
2. `Notepads` screen (views/lenses management), or sub-panel within workspace.

Minimum transition path:

1. Keep current screen route `notepad`, but relabel as `Notepads` first.
2. Add `Projects` route backed by `ProjectDefinition`.
3. Let `Projects -> Open` resolve to a notepad view.

## 6.2 Command palette split

Separate actions:

1. `Open Project` (context object).
2. `Open Notepad` (view object/category flow).

No shared result type that implies project==notepad.

## 6.3 Copy/terminology hardening

Change UI copy by domain:

1. Notepad UI: "Active notepad", "Notepad controls", "Create notepad view".
2. Projects UI: "Active project", "Project context", "Open default view".
3. Tasks UI: "Tasks across workspace" and optional project chips derived from project labels.

## 7. Migration Strategy

## Phase M0: Non-breaking terminology decouple

1. Rename current UI strings from project -> notepad where object is `NotepadViewDefinition`.
2. Keep route IDs stable initially (`notepad`) to avoid breakage.

## Phase M1: Project shadow model (derived)

1. Introduce `ProjectDefinition` storage + APIs.
2. Auto-generate derived projects from existing non-system notepads:
   - if notepad has category/label filters -> create `label_project`.
   - else create `workspace_project` with `defaultViewId=notepad.id`.
3. Mark as `source=migrated_derived` for auditability.

## Phase M2: Promote projects to first-class

1. Add Projects screen CRUD and open behavior.
2. Notepad CRUD remains independent.
3. Allow associating many views to one project.

## Phase M3: Decouple flows

1. Notepad creation no longer implies project creation.
2. Project creation flow can create:
   - label-backed computed default view, or
   - manual workspace default view.
3. Tasks references project contexts via project-label mapping, not notepad identity.

## Phase M4: Cleanup

1. Remove legacy assumptions from Omni search and Tasks copy.
2. Remove compatibility code that treats notepad as project.
3. Enforce explicit type paths in code (`ProjectDefinition` vs `NotepadViewDefinition`).

## 8. Execution Plan (Engineering)

## 8.1 Backend/Data

1. Add `ProjectDefinition` model in TS + Rust.
2. Add persisted project storage path and CRUD commands.
3. Add migration command that backfills projects from existing notepads.
4. Add integrity checks:
   - `defaultViewId` exists.
   - linked labels exist.

## 8.2 Frontend

1. Add project APIs to `tauriClient`.
2. Create `ProjectsScreen` (true project list/context actions).
3. Refactor current `NotepadScreen` labels/copy to notepad semantics only.
4. Refactor Omni search result union:
   - `project` results from `projects_list`
   - `notepad` results from `notepads_list`
5. Update Tasks header/copy and optional project metadata rendering.

## 8.3 Feature flags

1. `workspace.projects_v1` (new ProjectDefinition APIs + UI).
2. `workspace.notepad_project_split_ui` (copy/nav split).
3. `workspace.project_default_views` (project->view open behavior).

## 9. Testing and Acceptance

## 9.1 Automated tests

1. Migration tests:
   - existing notepads generate valid derived projects.
2. API tests:
   - project CRUD, project open, project-view association.
3. UI tests:
   - Omni search opens project vs notepad correctly.
   - Notepad CRUD does not mutate project objects unless explicitly linked.
4. Regression tests:
   - existing notepad/category flows still work.

## 9.2 Acceptance criteria

1. A project can exist without creating a new notepad immediately.
2. A notepad can exist without being a project.
3. Multiple notepads can belong to one project.
4. One notepad can be freeform and belong to no project.
5. Tasks screen no longer assumes project==notepad.

## 10. Risks and Mitigations

1. Risk: user confusion during terminology change.
   - Mitigation: staged copy updates + inline tooltips ("Projects are contexts; Notepads are views").
2. Risk: migration creates noisy/duplicated projects.
   - Mitigation: deterministic IDs + dry-run report + rollback.
3. Risk: old commands still dispatch notepad IDs as "project IDs".
   - Mitigation: typed event split and compile-time union separation.

## 11. Open Decisions

1. Should `Project` remain purely compositional over labels/views, or support project-only metadata/state not present on labels?
2. Should `workspace_project` be represented as a new view kind only, or a separate workspace object with dedicated commands?
3. Should sidebar default to `Projects` or `Notepads` after split?

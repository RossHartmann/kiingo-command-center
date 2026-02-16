# Dynalist-Style Notepad Screen Implementation Plan

Date: 2026-02-16
Status: Draft
Owner: Workspace/Notetaker

## 1. Purpose

Implement a new notepad screen under `The Workspace` that behaves like a Dynalist-style outliner:

1. Tree-first editing with inline text editing per node.
2. Stable object identity per line (`Block`) independent of placement/order.
3. Notepad as `View + Capture Policy`, not as a container.
4. Obsidian-backed persistence and CLI-aware write path.

This plan is grounded in:

1. `/Users/rosshartmann/Projects/kiingo/docs/spec/original-idea/notepad.md`
2. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md`
3. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-golden-flows.md`
4. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-state-machines.md`
5. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/algorithms/notetaker-algorithms.md`

## 2. Core Product Decisions

## 2.1 UI stack

Use:

1. `@headless-tree/react` for outliner/tree mechanics.
2. `lexical` for inline row editing.

Rationale:

1. Headless tree gives keyboard-first, reorder/indent primitives without forcing visual styling.
2. Lexical gives robust inline editor behavior for each node while keeping control in our React app.
3. This combination maps closest to Dynalist behavior while staying maintainable in our codebase.

## 2.2 Domain semantics (locked)

1. `Block` is canonical identity for each line.
2. `Placement` controls where/how that block appears in a notepad view.
3. `Notepad` stores filters/sorts/capture defaults and render mode.
4. Deleting a row in a view removes placement first; lifecycle transition is policy-driven if last placement.
5. Capture remains frictionless: new rows are created quickly, classification and deeper organization can follow.

## 3. Current Baseline in This Repo

## 3.1 What already exists

1. Workspace models for `BlockRecord`, `PlacementRecord`, `NotepadViewDefinition`, conditions, work sessions, decisions, recurrence in `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/types.ts`.
2. Tauri commands for:
   - notepads, blocks, placements, notepad block create
   - attention update and decision generation
   - condition/work session/recurrence systems
   in `/Users/rosshartmann/Projects/kiingo-command-center/src-tauri/src/lib.rs` and `/Users/rosshartmann/Projects/kiingo-command-center/src-tauri/src/workspace.rs`.
3. Existing tasks screen and workspace state plumbing in:
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/TasksScreen.tsx`
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/state/appState.tsx`
4. Sidebar `The Workspace` group already exists with `Tasks` item in `/Users/rosshartmann/Projects/kiingo-command-center/src/components/Sidebar/navigationConfig.ts`.

## 3.2 Gaps for true Dynalist-like notepad UX

1. No dedicated Notepad outliner screen yet (tree + inline editor).
2. No row-level keyboard behavior implementation (`Enter`, `Tab`, `Shift+Tab`, `Cmd/Ctrl+Shift+Arrow` reorder, etc.).
3. No explicit row operation service tying block mutation + placement mutation + selection semantics.
4. No inline-editor-focused reconciliation layer between Lexical state and persisted block text.
5. No complete end-to-end command palette flow for opening category/multi-category notepads from the workspace UI.

## 4. Scope and Non-Goals

## 4.1 In scope

1. New `Notepad` screen under `The Workspace`.
2. Dynalist-like outliner interactions for one active notepad at a time.
3. View switching and creation for NOW and named notepads.
4. Inline row editing with stable block identity.
5. Placement-aware drag/reorder/indent/outdent.
6. Migration and compatibility path from current Tasks-first usage.

## 4.2 Out of scope for this plan execution

1. Full sweep patch review UI.
2. Full semantic retrieval UI.
3. Multi-user real-time collaboration editing.

## 5. Target Architecture

## 5.1 Frontend modules

Add:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadTree.tsx`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadRow.tsx`
4. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/InlineBlockEditor.tsx`
5. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadToolbar.tsx`
6. `/Users/rosshartmann/Projects/kiingo-command-center/src/state/notepadState.ts` (or extend app state with a focused slice)

## 5.2 Data services

Add a focused notepad service layer (TS utility module) that wraps:

1. `notepadGet`, `notepadsList`, `notepadSave`
2. `blocksList`, `placementsList`, `notepadBlockCreate`
3. `placementSave`, `placementDelete`, `placementsReorder`
4. `atomUpdate` for block text updates (via `block.atomId`)

This layer owns reconciliation logic from backend records to UI tree nodes.

## 5.3 Backend command deltas

Leverage current commands first; add only where required:

1. Add/confirm command for explicit parent-child changes when indent/outdent updates canonical hierarchy.
2. Add/confirm command for delete-row semantics:
   - remove placement
   - if last placement, archive/complete based on block/task semantics.
3. Add helper command for move block between notepads in one mutation (optional for V1, can be composed in frontend).

## 6. Interaction Contract (Dynalist-like)

## 6.1 Core keyboard behaviors

1. `Enter` on focused row: create sibling row below, focus it.
2. `Shift+Enter`: line break inside current row editor.
3. `Tab`: indent current row under previous visible sibling (when valid).
4. `Shift+Tab`: outdent row one level.
5. `Cmd/Ctrl+Shift+ArrowUp/Down`: reorder row among siblings.
6. `Cmd/Ctrl+C`, `Cmd/Ctrl+X`, `Cmd/Ctrl+V`:
   - copy/cut/paste placement semantics, preserving block identity where required by policy.
7. `Backspace` on empty row:
   - remove placement (not hard delete), then apply last-placement lifecycle rule.
8. `Cmd/Ctrl+.` or context menu:
   - quick actions (status, priority, due, block condition, move to notepad).

## 6.2 Rendering behaviors

1. Collapse/expand triangles per row.
2. Virtualized rendering for large trees.
3. Hover metadata (created/updated, labels, placements, status).
4. Pinned rows and placement order support.

## 6.3 Capture policy behavior

When creating rows in a notepad:

1. Apply `captureDefaults` from the active notepad.
2. Default row kind/task facet according to notepad policy.
3. For category notepads, apply category label automatically.

## 6.4 Spec-locked row mutation semantics

These behaviors are now locked from the additional spec pass and must be implemented as invariants:

1. `Delete line`/empty-row `Backspace` does not hard-delete content.
2. First operation is always `DeletePlacement` on current view placement.
3. If that was the last placement for the block:
   - confirmed `task` kind -> complete task (not delete)
   - non-task kind -> archive block/atom
4. `Ctrl/Cmd+X` + paste must preserve underlying block/task identity and metadata.
5. Indent/outdent updates canonical parent/subtask relation, not just visual indentation.
6. Move between notepads is placement-based and does not change identity.
7. Move vs copy is explicit:
   - move: create destination placement + delete source placement
   - copy: create destination placement only
8. Checkbox subtasks support dual path:
   - immediate child block creation, or
   - remain inline until explicit extract/sweep promotion.

## 6.5 Canonical hierarchy vs placement hierarchy

To avoid ambiguity:

1. Canonical structure is block/atom parent relation (`parentId` lineage).
2. Notepad-local order and nesting overlays are placement graph (`parentPlacementId` + `orderKey`).
3. `Tab`/`Shift+Tab` in editable/manual notepads:
   - update canonical parent relation
   - update placement parent/order to match visible tree.
4. In computed/filtered notepads, hierarchy-changing actions are guarded:
   - reorder allowed
   - indent/outdent only when parent candidate is unambiguous.

## 6.6 Notepad-Task integration contract

Tasks must be a projection over the same underlying block/atom system, never a parallel model.

Projection rules:

1. Source set: blocks/atoms with task facet or task kind.
2. Active section:
   - `todo`, `doing`
3. Waiting section:
   - `blocked` tasks with active DATE/PERSON/TASK condition
   - show primary overlay reason precedence: PERSON > TASK > DATE
4. Done section:
   - status `done` / lifecycle `completed` (visible through end-of-day policy window)
5. Archived:
   - excluded by default
   - searchable/filterable only when `includeArchived=true`

Consistency rules:

1. Task screen state changes must use the same underlying commands as notepad row actions.
2. A row edited on Notepad must reflect immediately on Tasks projection after refresh.
3. A status change on Tasks must reflect immediately on corresponding notepad row.
4. No task mutation endpoint should bypass placement/lifecycle invariants.

## 6.7 Attention/conditions and default algorithm constants

Behavior lock:

1. Active condition means NON-ACTIONABLE and exits attention buckets (`HIDDEN` operational state).
2. Hidden tasks remain accountable via Decision Cards (follow-up, due pressure, overflow/boundary cards).
3. Caps enforced with Decision Cards, not by blocking capture.

V1 default parameters (from spec appendix):

1. L3 cap: 3
2. RAM cap: 20
3. Hard commitment cap: 7
4. L3 max dwell without work signal: 2 hours
5. RAM max dwell without meaningful signal: 24 hours
6. Short-term drift horizon: 7-14 days
7. Long-term auto-archive eligibility for soft commitments: 45-90 days
8. Hard due max pressure: +10
9. Soft due max pressure: +3
10. Cluster influence cap: +3 heat points

## 6.8 Command-level implementation map

Map each critical UI action to concrete backend command usage:

1. Create row in active notepad:
   - `notepad_block_create`
2. Edit row text:
   - resolve `block.atomId`, then `atom_update`
3. Reorder rows in same notepad:
   - `placements_reorder`
4. Indent/outdent:
   - `atom_update` (`relationsPatch.parentId`) + `placement_save` or `placements_reorder`
5. Move row to another notepad:
   - `placement_save` (destination) + optional `placement_delete` (source for move mode)
6. Delete row (empty backspace/delete line):
   - `placement_delete`
   - if last placement:
     - task kind -> `task_complete` or `task_status_set(done)`
     - non-task kind -> `atom_archive`
7. Set task status/priority/metadata:
   - `task_status_set` and `atom_update` facet patch
8. Set or resolve condition (snooze/waiting/blocked):
   - `condition_set_date` / `condition_set_person` / `condition_set_task`
   - `condition_resolve` / `condition_cancel`

## 7. Data Model Mapping for Screen

UI row view model must contain:

1. `placementId`
2. `blockId`
3. `atomId`
4. `parentPlacementId`
5. `orderKey`
6. `depth`
7. `text`
8. `collapsed`
9. `status/priority/attention/commitment` summary fields

Rules:

1. Primary ordering uses placement graph + `orderKey`.
2. Canonical hierarchy changes update atom/block parent references.
3. Placement-only moves do not alter canonical parent unless user action is hierarchy-changing.

## 8. Implementation Workstreams

## WS-1: Routing and Navigation

1. Add new screen id `notepad` to `/Users/rosshartmann/Projects/kiingo-command-center/src/state/appState.tsx`.
2. Add `Notepad` item under `The Workspace` in `/Users/rosshartmann/Projects/kiingo-command-center/src/components/Sidebar/navigationConfig.ts`.
3. Wire route rendering in `/Users/rosshartmann/Projects/kiingo-command-center/src/App.tsx`.

Exit criteria:

1. User can open Notepad screen from sidebar.

## WS-2: Notepad bootstrap and state

1. Implement initial load:
   - list notepads
   - open `now` by default
   - load placements + blocks for selected notepad
2. Add explicit loading/error states isolated to Notepad screen.
3. Keep app startup non-blocking.

Exit criteria:

1. Notepad screen reliably loads `now` view without freezing app.

## WS-3: Tree rendering foundation

1. Integrate `@headless-tree/react`.
2. Build flattened-to-tree projection from placements.
3. Support selection, expansion, and keyboard navigation.

Exit criteria:

1. User can navigate all rows from keyboard with consistent focus behavior.

## WS-4: Inline editor integration

1. Integrate Lexical inline editing per active row.
2. Debounced persistence from editor text to `atomUpdate`.
3. Conflict-safe update handling (`expectedRevision` mismatch path).

Exit criteria:

1. Inline edits are durable, fast, and do not lose cursor/focus unexpectedly.

## WS-5: Row operations

1. Create sibling/child/outdent operations.
2. Reorder siblings and persist `orderKey` updates.
3. Move between notepads with placement create/delete semantics.
4. Implement remove-row (placement delete + lifecycle rule).

Exit criteria:

1. All core Dynalist row operations work end-to-end with persistence.

## WS-6: Notepad management and capture policies

1. Add notepad picker and quick switcher.
2. Add create/edit notepad modal for filters/sorts/capture defaults.
3. Support category/multi-category notepad creation from UI.

Exit criteria:

1. User can create category-driven notepads and capture directly into them.

## WS-7: Attention and metadata overlays

1. Surface status/priority/attention/conditions inline.
2. Add quick command actions to set block conditions and task state.
3. Respect hidden/non-actionable overlays for blocked/snoozed tasks.

Exit criteria:

1. Row metadata and action affordances match notetaker flow expectations.

## WS-8: Telemetry and diagnostics

1. Add structured logs for:
   - notepad load
   - row operation failures
   - revision conflicts
2. Add error messages that are local and actionable.
3. Add simple health indicators for workspace/Obsidian capability state.

Exit criteria:

1. Failures can be diagnosed without user guesswork.

## 9. Migration Plan

## 9.1 Data migration assumptions

1. Existing atoms remain canonical and are not rewritten destructively.
2. Existing blocks/placements are reused/backfilled where missing.
3. Existing `Tasks` data should appear in `now` notepad projection.

## 9.2 Compatibility window

1. Keep `Tasks` screen operational during rollout.
2. `Tasks` becomes a projection over notepad/block state.
3. Hide/deprecate old task-only interactions after notepad parity is reached.

## 9.3 Migration steps

1. Validate placement coverage for atoms in `now`.
2. Backfill missing placements deterministically.
3. Run integrity check:
   - every placement references existing block
   - every block with `atomId` references existing atom
4. Enable `Notepad` screen by flag/capability gate.
5. Migrate default workspace entry to `Notepad` once stable.

## 10. Reliability and Performance Requirements

1. No blocking sync on global app startup.
2. Render target: responsive interaction with at least 5k visible rows in a notepad.
3. Debounced writes and batched reorder updates.
4. Retry-safe operations with idempotency keys for mutating calls.

## 11. Test Strategy

## 11.1 Frontend unit tests

1. Tree projection and depth calculations.
2. Keyboard operation reducers.
3. Editor-to-persist reconciliation logic.
4. Delete/backspace decision table:
   - not-last-placement
   - last-placement + task
   - last-placement + non-task
5. Move vs copy semantics for placements.
6. Overlay precedence rendering: PERSON > TASK > DATE.

## 11.2 Integration tests (Tauri commands)

1. Notepad load with placements.
2. Create/edit/reorder/indent/outdent persistence.
3. Move row between notepads preserving block identity.
4. Last-placement delete lifecycle behavior.
5. Task screen projection parity against notepad mutations.
6. Condition activation hides from attention buckets and re-entry on resolution.
7. Category notepad capture defaults apply labels on create.
8. Hybrid pinning render order contract:
   - pinned first
   - computed results excluding pinned IDs.

## 11.3 E2E tests

1. Open app -> Notepad -> create nested rows -> reorder -> move -> reload -> state preserved.
2. Category notepad creation and capture-default auto-labeling.
3. Conflict case (stale revision) shows recoverable UI.
4. Cross-surface parity:
   - mark done from Notepad, verify Tasks
   - reopen from Tasks, verify Notepad.
5. Waiting flow:
   - set waiting-on-person
   - verify waiting section and hidden attention placement.

## 12. Rollout Plan

## Phase A: Hidden foundation

1. Land Notepad screen and tree/editor infra behind feature flag.
2. Validate with local and staging vault snapshots.

## Phase B: Dual-surface

1. Expose Notepad and Tasks side-by-side.
2. Collect stability/performance signals.

## Phase C: Default switch

1. Make Notepad default under `The Workspace`.
2. Keep Tasks as derived view.

## Phase D: Cleanup

1. Remove obsolete task-only code paths after stability window.

## 13. Risks and Mitigations

1. Risk: editor-tree focus bugs and lost cursor state.
   Mitigation: single-source focus manager, strict keyboard integration tests.
2. Risk: placement/hierarchy drift.
   Mitigation: invariant checks and mutation helper functions in one service layer.
3. Risk: performance degradation on large notepads.
   Mitigation: virtualization, memoized selectors, batched updates.
4. Risk: confusion between move/copy/delete semantics.
   Mitigation: explicit UX copy and undo affordance for destructive row actions.
5. Risk: spec interpretation drift between original idea and formal state machines.
   Mitigation: treat state-machine invariants as implementation source of truth, record deviations explicitly in code comments/tests.

## 14. Foundational Fit Against Spec

This plan aligns with the core notetaker spec direction:

1. Notepad-first interface with outliner as primary input.
2. Stable line identity and view overlays via block/placement.
3. Capture policy-aware notepads (especially category notepads).
4. Eventful, reviewable, non-silent mutation patterns.

It avoids overkill by sequencing:

1. First ship high-fidelity outliner + persistence correctness.
2. Then layer richer attention, decision, and sweep UX incrementally.

## 15. Definition of Done

1. User can use Notepad screen as a Dynalist-style daily driver.
2. Tree and inline editing operations are reliable and persisted.
3. Identity is preserved across reorder/move/cut/paste flows.
4. Category notepads and capture defaults work from UI.
5. Tasks page is no longer foundational; it is a projection.

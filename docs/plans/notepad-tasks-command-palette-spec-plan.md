# Notepad + Tasks Spec Plan: Command Palette, Labels, Inline Tags, Category Views, Context Menu

Date: 2026-02-19  
Status: Draft implementation plan

## 1. Purpose

Define a concrete implementation plan for the five requested behaviors, grounded in the notepad/notetaker specs and mapped to current `kiingo-command-center` Projects and Tasks page behavior:

1. Command palette (`Ctrl+O`) for quick notepad switching/opening.
2. Labels/categories system for tagging blocks.
3. Inline `#tag` syntax while typing.
4. Category notepads as views (filter by label, auto-tag on capture).
5. Right-click context menu for quick metadata access.

## 2. Spec Inputs Used

Primary references:

1. `/Users/rosshartmann/Projects/kiingo/docs/spec/original-idea/notepad.md`
2. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md`
3. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-golden-flows.md`
4. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-state-machines.md`
5. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/algorithms/notetaker-algorithms.md`

Key requirement anchors:

1. `Ctrl+O` notepad switching: `notepad.md:319`.
2. Open Notepad by category flow: `notetaker-concepts.md:606-626`, `notetaker-golden-flows.md` GF-04/GF-05.
3. Inline hashtag syntax example: `notepad.md:282`.
4. Notepad as view/filter (not container): `notepad.md:295+`.
5. Right-click metadata modification: `notetaker-concepts.md:58-59`.

## 3. Current Implementation Snapshot

### 3.1 Projects page (`NotepadScreen`) currently does

1. Renders outline-first project/notepad workspace and block rows.
2. Uses `OMNI_OPEN_PROJECT` event to activate a notepad selected from command palette.
3. Supports notepad create/edit with category fields and category capture defaults.
4. Uses saved filters/capture defaults to load and create rows.

Current code anchors:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx:553`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx:575`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx:2165`
4. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx:2180`

### 3.2 Tasks page (`TasksScreen`) currently does

1. Treats Tasks as a projection over project rows.
2. Splits by status or attention mode.
3. Derives project label from `facetData.meta.categories`.
4. Offers quick navigation back to Projects page.

Current code anchors:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/TasksScreen.tsx:102`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/TasksScreen.tsx:783`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/TasksScreen.tsx:820`

### 3.3 Command palette (`Ctrl+O`) currently does

1. Opens/closes on `Ctrl/Cmd+O`.
2. Searches pages, metrics, and projects (notepads).
3. Selecting a project switches to Projects screen and dispatches `OMNI_OPEN_PROJECT`.
4. Does not provide dedicated “Open Notepad” category-first flow yet.

Current code anchors:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/OmniSearch.tsx:105`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/OmniSearch.tsx:141`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/OmniSearch.tsx:272`
4. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/OmniSearch.tsx:286`

### 3.4 Existing data contract coverage

Already present in types/filtering:

1. Notepad filters include `threadIds`, `labels`, `categories`.
2. Notepad capture defaults include `threadIds`, `labels`, `categories`.
3. Atom filtering in client applies label/category/thread matching.

Current code anchors:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/types.ts:599`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/types.ts:626`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/tauriClient.ts:1551`

## 4. Requirement Gap Matrix

| Requirement | Spec intent | Current status | Gap |
|---|---|---|---|
| `Ctrl+O` quick notepad switching | Command palette opens notepads quickly and supports category-based open/create | Partial | Existing palette can open saved projects but lacks explicit category-first Open Notepad flow (with synonyms and create-on-the-spot). |
| Labels/categories system | Unified label model (categories/threads/north stars), label graph, synonyms | Partial | UI + workflows still category-string-centric. No complete label registry management UX in this screen flow. |
| Inline `#tag` syntax | Frictionless tagging while typing | Missing | No inline hashtag extraction/apply pipeline in editor paths. |
| Category notepads as views + auto-tag | Open category/multi-category views and auto-apply capture defaults | Partial | Core model supports categories/capture defaults; command flow and explicit OR/AND multi-category UX is incomplete. |
| Right-click metadata context menu | Fast metadata changes from row context menu | Missing | No row `onContextMenu` handling/menu surface in `NotepadRow` currently. |

## 5. Implementation Plan

### 5.1 Workstream A: Command Palette “Open Notepad” mode

Goal: align `Ctrl+O` behavior with GF-04/GF-05.

Implementation:

1. Add explicit palette action group `Open Notepad`.
2. In that group, search label/category registry (name + synonyms).
3. Allow inline create when no exact label exists.
4. Support single category open and multi-category open.
5. Prompt/select filter mode `OR`/`AND` for multi-category.
6. Upsert/open a category notepad view with `captureDefaults` = selected labels.

Code touchpoints:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/OmniSearch.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/tauriClient.ts`
4. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/types.ts`

Acceptance criteria:

1. `Ctrl+O` then “Open Notepad” can open/create category views without leaving keyboard.
2. Selecting category `X` opens a view filtered to `X` and new captures get `X`.
3. Selecting `[A,B]` applies chosen AND/OR filter and capture defaults `[A,B]`.

### 5.2 Workstream B: Unified labels/categories/thread model exposure

Goal: expose spec’s unified label model while preserving existing category behavior.

Implementation:

1. Introduce/confirm label registry APIs in app layer:
   - create label
   - rename label
   - add synonym
   - alias/merge
   - add parent-child edge with cycle check
2. Map current category editing UI to registry-backed labels.
3. Keep backwards compatibility for existing category arrays by read/write adapter.
4. Add “include descendants” option for category notepad filters.

Code touchpoints:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/types.ts`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/tauriClient.ts`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
4. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadToolbar.tsx`

Acceptance criteria:

1. Category/thread labels resolve through one registry identity path.
2. Synonyms are searchable in palette and resolve to canonical label ID.
3. Existing projects with `filters.categories` continue to load correctly.

### 5.3 Workstream C: Inline `#tag` capture/apply pipeline

Goal: add frictionless tagging while typing in block editor.

Implementation:

1. Add parser utility for inline hashtag tokens that:
   - supports `#single` and optionally quoted/phrase tags if required by UX decision
   - ignores code spans/URLs
   - normalizes case and punctuation
2. Add editor commit path hook:
   - on row create/split/blur, extract hashtags
   - resolve/create labels
   - apply confirmed labels/categories to block metadata
3. Decide render strategy:
   - keep literal `#tag` text, or
   - strip token from display text after assignment (feature-flagged decision)
4. Add de-duplication so repeated tags do not re-apply noisily.

Code touchpoints:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/InlineBlockEditor.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/tauriClient.ts`
4. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/types.ts`

Acceptance criteria:

1. Typing `Call Sarah #kiingo` assigns `kiingo` label to the block.
2. Tag assignment is reflected in Projects filters and Tasks projection labels.
3. No duplicate labels on repeated edits with unchanged tags.

### 5.4 Workstream D: Category notepads as first-class saved views

Goal: complete view semantics from spec (view filter + capture policy).

Implementation:

1. Extend notepad definition for category view metadata:
   - selected label IDs
   - filter mode AND/OR
   - include descendants
2. Ensure notepad create/edit supports multi-category selection UI.
3. Ensure capture defaults always apply for creates performed within active notepad.
4. Surface current view criteria clearly in toolbar/header.

Code touchpoints:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/types.ts`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadToolbar.tsx`

Acceptance criteria:

1. Category notepad definitions are persisted and reusable.
2. Reopening the same category selection resolves to same saved view or deterministic upsert behavior.
3. New rows in category views are auto-labeled from capture defaults.

### 5.5 Workstream E: Right-click context menu for metadata actions

Goal: provide low-friction metadata operations on row objects.

Implementation:

1. Add row-level `onContextMenu` handler in `NotepadRow`.
2. Add accessible context menu component with keyboard fallback.
3. Include actions:
   - add/remove labels
   - assign thread/category
   - set blocking mode (date/person/task)
   - set commitment level
   - quick attention move (pin hot / cool off)
4. Route actions through existing mutation pipeline used by inspector actions.

Code touchpoints:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadRow.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/styles.css`

Acceptance criteria:

1. Right-clicking a row opens metadata menu at pointer location.
2. All menu actions are also keyboard reachable.
3. Metadata edits update row pills/inspector/tasks projection without full reload.

### 5.6 Workstream F: Tasks page alignment after metadata improvements

Goal: keep Tasks projection consistent with new label/tag flows.

Implementation:

1. Expand task card metadata rendering beyond category strings where useful.
2. Add filters/chips for label/thread where available.
3. Validate projection refresh behavior after inline-tag and context-menu updates.

Code touchpoints:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/TasksScreen.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/tauriClient.ts`

Acceptance criteria:

1. Tasks page reflects updated labels/tags from Projects editing workflows.
2. No regression in status/attention switching and projection refresh.

## 6. Phased Delivery

### Phase 0: Contracts + flags

1. Finalize label registry contracts and view schema additions.
2. Add feature flags:
   - `workspace.notepad_open_notepad_v2`
   - `workspace.inline_tags`
   - `workspace.notepad_context_menu`
3. Add migration adapters for legacy category-only views.

Exit criteria:

1. No schema/read regressions for existing projects.
2. New contracts compile and pass baseline tests.

### Phase 1: Command palette + category view upsert

1. Implement Open Notepad mode in `Ctrl+O` palette.
2. Implement category/multi-category open with OR/AND.
3. Ensure capture defaults are written on created/upserted view.

Exit criteria:

1. GF-04/GF-05 happy-paths work end-to-end.

### Phase 2: Inline `#tag` tagging

1. Implement parser + apply flow.
2. Handle normalization/dedupe and label resolution.
3. Add tests for parsing and idempotent assignment.

Exit criteria:

1. Inline hashtag flow works on create/split/edit without regressions.

### Phase 3: Right-click metadata menu

1. Implement row context menu and action wiring.
2. Add keyboard-equivalent command path.
3. Add accessibility checks for focus/ARIA/escape behavior.

Exit criteria:

1. Metadata edits are faster than inspector path and reliable.

### Phase 4: Tasks projection polish + cleanup

1. Update Tasks UI for richer labels/thread context as needed.
2. Add telemetry and docs updates.
3. Remove dead compatibility shims only after migration window.

Exit criteria:

1. Projects + Tasks metadata semantics are consistent.

## 7. Testing Plan

Unit tests:

1. Tag parser edge cases (`#tag`, punctuation, repeats, invalid tokens).
2. View upsert logic for single/multi-category + AND/OR.
3. Label resolver/synonym mapping.

Integration tests:

1. `Ctrl+O` open category notepad, capture line, verify label assignment.
2. Open multi-category view, capture, verify all defaults applied.
3. Right-click metadata updates reflect in row pills and tasks projection.

Manual QA checklist:

1. Start from legacy category project and verify no data loss.
2. Verify keyboard-only path for palette and context menu actions.
3. Verify Tasks page projections after inline tag edits.

## 8. Risks and Mitigations

1. Risk: category strings and canonical label IDs diverge.
   - Mitigation: enforce canonical IDs in persistence; keep strings as display aliases only.
2. Risk: inline parser causes noisy label creation.
   - Mitigation: strict normalization + reuse-first resolver + optional confirmation threshold.
3. Risk: context menu duplicates inspector logic and drifts.
   - Mitigation: shared action handlers and test coverage around mutation commands.

## 9. Open Decisions

1. Should inline `#tag` text remain in block text after assignment, or be transformed into chips?
2. Should multi-category view upsert always reuse deterministic IDs or allow ad-hoc temporary views?
3. Should tasks page expose thread chips by default or behind disclosure?

## 10. Definition of Done

1. All five requested capabilities are implemented behind flags and validated by tests.
2. Legacy category-only projects remain functional without manual migration.
3. Projects page, Tasks page, and `Ctrl+O` palette share one consistent label/view model.

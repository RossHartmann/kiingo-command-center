# Dynalist-Style Navigation and Interaction Plan

Date: 2026-02-16
Status: Completed for code + automated validation (manual QA pending)
Owner: Workspace/Notetaker

## 1. Purpose

Define a comprehensive, implementation-ready plan for Dynalist-like keyboard navigation and row interaction semantics in Notepad so the experience feels natural, fast, and predictable for daily use.

This plan is specifically focused on navigation and interaction behavior (not broad platform architecture).

## 2. Inputs and Context

This plan is grounded in:

1. Existing product intent and UX notes in:
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/original-idea/notepad.md`
2. Notetaker concepts and flows in:
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md`
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-golden-flows.md`
   - `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-state-machines.md`
3. Current Notepad implementation in:
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadTree.tsx`
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadRow.tsx`
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/InlineBlockEditor.tsx`

## 3. Scope

## 3.1 In scope

1. Keyboard navigation model (edit mode + navigation mode).
2. Row creation/deletion/indent/outdent/reorder semantics.
3. Focus and selection lifecycle rules after every mutation.
4. Arrow-key behavior for single-line and multi-line rows.
5. Collapse/expand navigation behavior.
6. Deterministic clipboard/move behavior at row level.
7. Testing and rollout plan for navigation parity.

## 3.2 Out of scope

1. New persistence model redesign.
2. Sweep/review UI and semantic orchestration.
3. Mobile/touch gesture parity.

## 4. Success Criteria

The plan is complete when all of the following are true:

1. A keyboard-only user can create, navigate, restructure, and complete rows without needing pointer interaction.
2. Focus never disappears after any mutation.
3. Up/down movement feels continuous and spatially consistent.
4. Delete/create actions preserve identity and lifecycle rules already defined for blocks/placements.
5. All core interactions are covered by deterministic tests and pass in CI.

## 5. Conceptual Model (How Dynalist Feels)

## 5.1 Primary principles

1. One active row at all times.
2. One text caret at all times while editing.
3. Tree structure drives navigation; text caret movement is local.
4. Key behavior must be mode-aware and boundary-aware.
5. Spatial continuity is preserved after every action.

## 5.2 Mode model

The UI operates in two explicit modes:

1. `Navigation mode`:
   - Row selected.
   - No active text caret in row editor.
   - Arrow keys primarily move between visible rows and structural states.
2. `Edit mode`:
   - Textarea focused in selected row.
   - Arrow keys first attempt intra-row caret movement.
   - Row-to-row movement occurs when caret reaches line boundaries.

Mode transitions:

1. `Enter` in navigation mode -> edit mode (focus row editor).
2. Pointer click in editor -> edit mode.
3. `Esc` in edit mode -> navigation mode (keep same selected row).
4. Structural commands do not clear selection.

## 6. Interaction Contract (Normative)

The following behavior is normative and should be treated as an invariant contract.

## 6.1 Up/Down arrows

In edit mode:

1. `ArrowUp`:
   - If caret has a visual line above in current row text: move caret within row.
   - Else: move focus to previous visible row and place caret naturally (prefer end-of-line/closest column strategy).
2. `ArrowDown`:
   - If caret has a visual line below in current row text: move caret within row.
   - Else: move focus to next visible row and place caret naturally.

In navigation mode:

1. `ArrowUp` selects previous visible row.
2. `ArrowDown` selects next visible row.

## 6.2 Left/Right arrows

In edit mode:

1. `ArrowLeft` and `ArrowRight` are text-caret movement.

In navigation mode:

1. `ArrowRight` on collapsed row expands row.
2. `ArrowRight` on expanded row may move to first child (recommended behavior).
3. `ArrowLeft` on expanded row collapses row.
4. `ArrowLeft` on collapsed row moves selection to parent row.

## 6.3 Enter and Shift+Enter

1. `Enter` in edit mode creates a new sibling row directly below current row and focuses new row editor.
2. `Enter` in navigation mode enters edit mode on selected row.
3. `Shift+Enter` inserts newline in current row text without structural mutation.

## 6.4 Backspace

1. `Backspace` in edit mode with non-empty row text is normal text deletion.
2. `Backspace` in edit mode on empty row:
   - delete current placement (not hard delete block identity).
   - apply existing last-placement lifecycle semantics.
   - move focus to nearest row (prefer previous for list-typing flow).
3. `Backspace` in navigation mode on selected empty row follows same structural delete semantics.

## 6.5 Tab and Shift+Tab

1. `Tab` indents selected row under previous visible sibling when valid.
2. `Shift+Tab` outdents selected row one level when valid.
3. Selection remains on moved row after operation.
4. Editor focus is retained when command invoked from edit mode.

## 6.6 Reorder shortcuts

1. `Cmd/Ctrl+Shift+ArrowUp` moves row up among siblings.
2. `Cmd/Ctrl+Shift+ArrowDown` moves row down among siblings.
3. Optional parity alias: `Cmd/Ctrl+ArrowUp/ArrowDown` may trigger same behavior.
4. Reorder keeps subtree attached.

## 6.7 Copy/Cut/Paste semantics

1. `Cmd/Ctrl+C` copies selected row identity reference (placement-aware behavior).
2. `Cmd/Ctrl+X` cuts selected placement (identity-preserving move semantics).
3. `Cmd/Ctrl+V` pastes after selected row using existing move/copy policy.
4. Pasting never silently creates duplicate identity when operation intent is move.

## 6.8 Quick actions

1. `Cmd/Ctrl+.` opens quick actions for selected row.
2. Opening/closing quick actions does not lose selection.

## 7. Visibility and Tree Traversal Rules

## 7.1 Visible-row traversal

1. Keyboard navigation traverses only visible rows.
2. Hidden descendants of collapsed rows are skipped.
3. Selection cannot remain on a hidden row.

## 7.2 Collapse/expand invariants

1. If collapsing a row while a descendant is selected, selection moves to collapsed ancestor.
2. Expand/collapse does not mutate row text.
3. Collapse state is per-row and persists within session state.

## 7.3 Virtualization invariants

1. Selection and focus logic cannot rely on currently rendered subset only.
2. If selected row is virtualized out, next selection action must still resolve correctly.
3. Auto-scroll must bring newly selected row into viewport.

## 8. Focus Management Contract

## 8.1 Focus source of truth

1. `selectedPlacementId` is canonical row selection state.
2. Editor focus is a derived ephemeral state.
3. Pending-focus refs can be used for post-mutation row targeting.

## 8.2 Post-mutation focus policy

1. After create: focus created row editor.
2. After delete: focus fallback row editor if triggered from edit mode, else keep navigation focus.
3. After indent/outdent/reorder: keep same row selected and visible.
4. After move across notepads: destination row selected and focused.

## 8.3 Blur and autosave

1. Draft save must flush before destructive row mutation.
2. Blur-triggered save cannot clobber newly selected row state.
3. Revision conflict recovery must preserve or restore clear selection.

## 9. Edge Case Decision Table

## 9.1 Arrow navigation edge cases

1. Top row + `ArrowUp`:
   - no movement; remain on top row.
2. Bottom row + `ArrowDown`:
   - no movement; remain on bottom row.
3. Multi-line row with caret in middle line:
   - intra-row caret move only.
4. Text selection range present:
   - arrows operate on text selection, not row navigation, unless explicit override desired.

## 9.2 Deletion edge cases

1. Deleting last visible row in notepad:
   - selection becomes undefined.
   - show empty-state prompt.
2. Deleting row with descendants:
   - behavior must be explicit and tested:
     - either remove subtree placements, or
     - reparent children.
   - no implicit orphaning.
3. Deleting row with unresolved conditions:
   - keep lifecycle semantics consistent with current backend behavior.

## 9.3 Reorder/indent edge cases

1. Indent when no previous sibling:
   - no-op.
2. Outdent at root:
   - no-op.
3. Reorder first row up or last row down among siblings:
   - no-op.

## 10. Implementation Workstreams

## WS-1: Centralize keyboard dispatch

1. Extract row-key handling into a dedicated helper module (for testability).
2. Keep mode-aware logic in one place with explicit preconditions.
3. Preserve existing hooks but reduce ad hoc branching in screen component.

Target files:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
2. New helper, recommended:
   - `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/keyboardContract.ts`

## WS-2: Complete mode model

1. Add explicit mode state (`navigation` vs `edit`) in Notepad UI state.
2. Wire `Esc` and `Enter` mode transitions.
3. Ensure mode transitions are idempotent.

Target files:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/state/notepadState.ts`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`

## WS-3: Arrow traversal parity

1. Keep current up/down boundary logic in edit mode.
2. Add left/right navigation mode behavior for expand/collapse/parent-child traversal.
3. Add column-preservation strategy when moving between rows (optional but recommended).

Target files:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadTree.tsx`

## WS-4: Structural operation stability

1. Harden create/delete/indent/outdent/reorder to always preserve selection.
2. Ensure every operation flushes pending draft safely where required.
3. Normalize fallback selection behavior across all mutation paths.

Target files:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`

## WS-5: Scroll and viewport continuity

1. Add `ensureRowVisible` helper for selected row transitions.
2. Avoid jump-scroll by minimal-scroll strategy.
3. Ensure virtualized rows re-focus correctly when re-entering viewport.

Target files:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadTree.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`

## WS-6: Shortcut parity and discoverability

1. Standardize supported shortcut set.
2. Keep legacy aliases where helpful.
3. Add keyboard help cheat sheet in Notepad toolbar/help popover.

Target files:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/NotepadToolbar.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/styles.css`

## 11. Test Plan

## 11.1 Unit tests (required)

1. Key dispatch contract tests (mode + key + cursor context + expected command).
2. Arrow boundary tests for single-line and multi-line text.
3. Fallback selection tests after delete.
4. No-op boundary tests for indent/outdent/reorder.

Recommended new test files:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/keyboardContract.test.ts`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/components/notepad/treeData.test.ts` (extend)

## 11.2 Integration tests (required)

1. `Enter` repeat flow creates sequential siblings and keeps edit focus.
2. Empty-row `Backspace` removes placement and shifts focus predictably.
3. Up/down arrows traverse rows naturally in both modes.
4. Collapse while child selected moves selection to parent.
5. Reorder shortcuts move row and preserve subtree.

## 11.3 Manual QA script (required)

1. Start with 20-row mixed-depth tree.
2. Navigate all rows using keyboard only.
3. Perform create/delete/indent/outdent/reorder without pointer.
4. Reload screen and verify structural persistence.
5. Repeat on large dataset (500+ rows) to verify virtualization continuity.

## 12. Observability and Diagnostics

1. Add debug-scoped instrumentation for keyboard events and resolved actions.
2. Track operation latency for create/delete/reorder/indent/outdent.
3. Track focus-loss incidents (no selected row after mutation where row exists).
4. Add lightweight error banners for failed mutations with actionable text.

## 13. Rollout Plan

## Phase A: Contract hardening behind flag

1. Implement keyboard contract module + tests.
2. Keep behavior gated by `workspace.notepad_ui_v2` (already present).

## Phase B: Default keyboard parity in Notepad

1. Enable full arrow and structural semantics for internal use.
2. Validate with manual QA script and integration tests.

## Phase C: Stabilization

1. Fix all focus discontinuities and boundary bugs.
2. Add docs/help overlay and finalize shortcut contract.

## 14. Risks and Mitigations

1. Risk: Focus race conditions due to async mutations.
   - Mitigation: pending-focus single source of truth + post-mutation revalidation.
2. Risk: Virtualization hides selected row and breaks focus.
   - Mitigation: explicit ensure-visible routine + resilient row lookup by ID.
3. Risk: Mode confusion for users.
   - Mitigation: subtle UI affordance for edit mode and consistent `Esc` behavior.
4. Risk: Shortcut conflicts across OS/browser.
   - Mitigation: normalize modifier detection and document supported variants.

## 15. Definition of Done

This plan is complete when:

1. Notepad supports deterministic Dynalist-style navigation for core keyboard paths.
2. Focus and selection behavior remain stable across all row mutations.
3. Tests cover keyboard contract and pass reliably.
4. Manual QA script passes on both small and large trees.
5. Shortcut behavior is documented in-product and in developer docs.

## 16. Execution Checklist (Single Worktree, No PR Splits)

Execution assumptions:

1. All changes land in the current worktree.
2. No branch-per-workstream or PR-per-workstream slicing is required.
3. Validation still happens incrementally after each checkpoint.

## 16.1 Stage 0 - Baseline and guardrails

- [x] Confirm current baseline behavior on Notepad and write down known gaps.
- [x] Capture a keyboard behavior snapshot (current keymap and outcomes) in this doc or a local note.
- [x] Run baseline checks and record pass/fail:
- [x] `npm run lint`
- [x] `npm run test`
- [x] Confirm feature flag state for `workspace.notepad_ui_v2`.

Done when:

1. Baseline regressions are known before deeper refactor begins.
2. A before/after comparison can be made objectively.

## 16.2 Stage 1 - Keyboard contract extraction

- [x] Create `keyboardContract.ts` with pure decision helpers for:
- [x] mode transitions
- [x] row navigation commands
- [x] structural mutation commands
- [x] no-op boundary outcomes
- [x] Add `keyboardContract.test.ts` with explicit mode/key/precondition matrix tests.
- [x] Replace ad hoc key branching in `NotepadScreen.tsx` with contract-driven dispatch.

Done when:

1. Keyboard outcomes are determined by testable pure helpers.
2. `NotepadScreen.tsx` keydown handlers primarily map inputs to contract actions.

## 16.3 Stage 2 - Explicit mode model

- [x] Add explicit `navigation` vs `edit` mode in notepad UI state.
- [x] Implement `Esc` to exit edit mode without dropping row selection.
- [x] Implement `Enter` in navigation mode to focus editor for selected row.
- [x] Ensure pointer focus enters edit mode deterministically.

Done when:

1. Mode is explicit, not inferred indirectly from DOM focus only.
2. Core mode transitions are deterministic and covered by tests.

## 16.4 Stage 3 - Arrow semantics parity

- [x] Enforce edit-mode boundary-aware up/down:
- [x] intra-row caret move when line exists above/below
- [x] row-to-row movement at boundaries
- [x] Implement navigation-mode left/right behaviors:
- [x] right expands; right on expanded can move to first child
- [x] left collapses; left on collapsed moves to parent
- [x] Add row-to-row caret placement strategy (end-of-line initially; optional column memory follow-up).

Done when:

1. Arrow behavior is predictable in both modes.
2. Traversal operates only on visible rows.

## 16.5 Stage 4 - Structural mutation stability

- [x] Verify/standardize `Enter` create-sibling flow from edit mode.
- [x] Verify/standardize empty-row `Backspace` delete flow with lifecycle invariants.
- [x] Standardize focus fallback policy after delete (prefer previous for typing flow).
- [x] Keep selection pinned to moved row after indent/outdent/reorder.
- [x] Ensure pending drafts flush before destructive operations.

Done when:

1. Create/delete/restructure operations never lose selection or focus context.
2. Lifecycle semantics remain correct on last-placement removal.

## 16.6 Stage 5 - Collapse, visibility, and virtualization continuity

- [x] Implement/verify selection re-anchor when collapsing ancestor of selected descendant.
- [x] Add `ensureRowVisible` helper for all selection-changing commands.
- [x] Ensure virtualization does not break target-row editor focusing after mutations.
- [x] Add tests for traversal with collapsed branches and virtualized row windows.

Done when:

1. Navigation does not strand focus on hidden/non-rendered rows.
2. Selection remains visible after keyboard movement and mutations.

## 16.7 Stage 6 - Shortcut parity and UX discoverability

- [x] Normalize supported reorder aliases (`Cmd/Ctrl+Shift+Arrow`, optional `Cmd/Ctrl+Arrow`).
- [x] Keep clipboard shortcuts behavior consistent in edit vs navigation contexts.
- [x] Add keyboard cheat sheet/help surface in Notepad toolbar.
- [x] Add concise in-app copy for destructive behavior (`Backspace` on empty row).

Done when:

1. Shortcut set is stable, documented, and discoverable.
2. No hidden shortcut behavior surprises remain.

## 16.8 Stage 7 - Comprehensive testing and QA

- [x] Unit tests for keyboard contract matrix.
- [x] Integration tests for:
- [x] repeated `Enter` flow
- [x] empty-row `Backspace`
- [x] up/down navigation across rows and multiline boundaries
- [x] collapse-parent while child selected
- [x] sibling reorder with subtree preservation
- [ ] Manual QA pass (20-row mixed tree + 500+ row large tree).
- [x] Regression run:
- [x] `npm run lint`
- [x] `npm run test`

Done when:

1. All automated checks pass.
2. Manual QA script completes without focus/navigation anomalies. (Pending)

## 16.9 Stage 8 - Stabilization and completion

- [x] Resolve all discovered edge-case defects from QA.
- [x] Remove temporary debug instrumentation if added.
- [x] Re-run full regression checks.
- [x] Update this plan with completion notes and any deviations from contract.

Done when:

1. Navigation behavior is stable and matches contract.
2. Plan status can be marked complete for execution scope.

## 16.10 Suggested execution order for this worktree

1. Stage 0 -> Stage 1 -> Stage 2
2. Stage 3 -> Stage 4
3. Stage 5 -> Stage 6
4. Stage 7 -> Stage 8

## 16.11 Progress tracking table

Use this during execution in the same worktree:

| Stage | Owner | Status | Started | Completed | Notes |
|------|------|------|------|------|------|
| 0 | Codex | done | 2026-02-16 | 2026-02-16 | Baseline checks completed. |
| 1 | Codex | done | 2026-02-16 | 2026-02-16 | Keyboard contract extracted and tested. |
| 2 | Codex | done | 2026-02-16 | 2026-02-16 | Explicit interaction mode added to UI state. |
| 3 | Codex | done | 2026-02-16 | 2026-02-16 | Arrow semantics implemented for edit + navigation contexts. |
| 4 | Codex | done | 2026-02-16 | 2026-02-16 | Structural mutation focus/selection stability hardened. |
| 5 | Codex | done | 2026-02-16 | 2026-02-16 | Visibility continuity and collapse re-anchor implemented. |
| 6 | Codex | done | 2026-02-16 | 2026-02-16 | Shortcut help and mode indicator added to toolbar. |
| 7 | Codex | done (automated) | 2026-02-16 | 2026-02-16 | Full lint + test validation passed; manual QA still pending. |
| 8 | Codex | done | 2026-02-16 | 2026-02-16 | Stabilization pass complete. |

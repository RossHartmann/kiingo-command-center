# Notetaker Spec Alignment and Migration Plan

Date: 2026-02-16  
Status: Draft (comprehensive alignment + migration plan)

## 1. Purpose

Define a complete plan to close foundational gaps between the notetaker spec and the current `kiingo-command-center` implementation, including a safe migration from the current Atom-centric model to a Block + Placement + Notepad-capture-policy architecture.

This plan is intended to:

1. Correct architectural drift early.
2. Preserve existing user data.
3. Deliver the spec's core behavior incrementally behind flags.
4. Keep Obsidian as the source of truth and Obsidian CLI as the write/read path.

## 2. Scope and Inputs

### 2.1 Spec sources used for alignment

1. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md`
2. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-golden-flows.md`
3. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-state-machines.md`
4. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/algorithms/notetaker-algorithms.md`

Note: there is no `/docs/spec/notepad` directory; `notetaker` appears to be the intended module.

### 2.2 In scope

1. Domain model parity for Blocks, Placements, Notepads, Labels, Conditions, Attention, Decision Cards, Sweeps, Work Sessions, and Recurrence.
2. Command/event surface parity for core state machines.
3. Data migration from current files to v2 structures.
4. UI migration from task-list-first to notepad-first foundation.
5. Observability, testing, and rollback.

### 2.3 Out of scope

1. Replacing Obsidian as source of truth.
2. Adding external system sync (Asana, calendar) in this migration.
3. Full team-collaboration permissions model.

## 3. Foundational Gap Summary

## 3.1 P0 gap: Missing Block + Placement core

1. Spec requires line-level stable Block identity and placement overlays.
2. Current implementation persists `AtomRecord` only and has no placement entity/commands.
3. Impact: multi-view notepads, per-view ordering, move-without-identity-loss, and outliner semantics cannot be implemented correctly.

## 3.2 P1 gap: Notepad capture policy missing

1. Spec requires Notepad = View + Capture Policy (capture defaults).
2. Current notepads are filter/sort/layout definitions only.
3. Impact: "open category notepad and capture directly into context" is not actually supported by domain contracts.

## 3.3 P1 gap: Attention model is mostly schema-only

1. Spec requires heat/decay/bucketing/dwell/pressure with decision-card enforcement.
2. Current code has fields for attention and commitment, but no operational attention engine.
3. Impact: top-level product differentiator is absent.

## 3.4 P1 gap: Decision cards are CRUD, not generated enforcement

1. Spec requires system-generated, deduped, escalating decision cards.
2. Current code supports manual create/resolve/snooze/dismiss only.
3. Impact: no bounded-attention enforcement loop.

## 3.5 P1 gap: Contract drift in filter/sort behavior

1. Filter fields for attention/commitment/due ranges exist in contracts.
2. Backend filtering logic does not apply those fields.
3. Sort contracts include due/attention fields but backend comparator does not.
4. Impact: API appears richer than behavior, causing silent correctness bugs.

## 3.6 P2 gap: Work sessions/focus and recurrence not implemented as systems

1. Spec defines dedicated state machines and commands.
2. Current workspace backend has no work-session lifecycle commands and no recurrence lifecycle runtime.
3. Impact: strongest attention signals and repeated obligation workflows are missing.

## 3.7 P2 gap: UI is task-list-first, not notepad-first

1. Current navigation and screen design centers on task CRUD.
2. Spec centers on outliner notepads and multiple views over shared objects.
3. Impact: UI does not expose the intended interaction model.

## 4. Target End State (Architecture)

## 4.1 Canonical object model

1. `Block`
  - Stable ID, text, kind, lifecycle, canonical parent, labels, conditions, commitment/due metadata, attention metadata.
2. `Atom`
  - Provenance/capture unit, references one or more blocks, retains original capture context.
3. `Placement`
  - `block_id` in `view_id` with `order_key`, optional parent placement, pinning semantics.
4. `NotepadView`
  - Filter + sort + render mode + capture defaults + options.
5. `Label/RegistryEntry`
  - Typed (`category`, `thread`, `north_star`) with aliases and graph edges.
6. `DecisionCard`
  - Durable pending/snoozed/resolved/superseded object with dedupe key and escalation metadata.
7. `Patch`
  - Sweep output, risk tiered, reviewable, apply/reject states.
8. `WorkSession`
  - Start/note/end lifecycle with links to blocks.
9. `RecurrenceTemplate/Instance`
  - Spawned instances with missed-cycle decision hooks.

## 4.2 Obsidian filesystem v2 layout

```text
command-center/
  blocks/
    active/
    completed/
    archived/
  atoms/
    active/
    archived/
  placements/
    by-view/
  notepads/
    now.md
    <view-id>.md
  labels/
    registry/
    edges/
  conditions/
    active/
    history/
  sessions/
    work/
  decisions/
    pending/
    resolved/
  sweeps/
    patches/
    runs/
  recurrence/
    templates/
    instances/
  events/
    YYYY-MM-DD.ndjson
  semantic/
    index/
    chunks/
  governance/
    retention-policies.md
    sensitivity-defaults.md
  migrations/
    plans/
    runs/
```

## 4.3 Command parity target

Adopt the minimum command set from spec state machines (CreateBlock, SetBlockParent, placement commands, condition commands, attention actions, work sessions, sweep patch review, recurrence lifecycle, system ticks).

Any command not built immediately must be explicitly represented as:

1. Not implemented but reserved with error code.
2. Behind feature flag with no-op disabled behavior.
3. Tracked as an explicit milestone blocker.

## 4.4 Event model target

All state transitions append events with stable event types and payload contracts. No silent mutation paths.

## 5. Migration Strategy (Data + API + UX)

## 5.1 Migration principles

1. Additive and reversible until cutover.
2. Deterministic and idempotent transforms.
3. Dual-read/dual-write period for verification.
4. Feature-flagged rollout.
5. No destructive mutation of legacy files before validation passes.

## 5.2 Migration phases

### Phase 0: Preflight and safety rails

1. Add migration lock and runbook.
2. Add full backup command for `command-center` root.
3. Add preflight validator (vault path, required folders, malformed file checks).
4. Freeze schema contracts for migration window.

Exit criteria:

1. Backup produced and verifiable.
2. Preflight returns clean baseline or explicit blocking report.

### Phase 1: Introduce v2 schema and adapters

1. Add v2 domain structs (`BlockRecord`, `PlacementRecord`, capture defaults).
2. Add v2 folders in topology creation.
3. Add read adapters that can hydrate from v1 while writing v2.
4. Add event type extensions for new commands.

Exit criteria:

1. App reads legacy data unchanged.
2. New v2 files can be created behind feature flag.

### Phase 2: Backfill data (v1 -> v2)

Mapping rules:

1. Each existing Atom produces at least one root Block.
2. Root block text = atom raw text; body remains atom body/provenance.
3. Parent relations become canonical block parent edges where possible.
4. Existing notepads become views.
5. For each atom included in notepad query membership, create placement rows/materialized files.
6. Archive/done status maps to block lifecycle.
7. Thread/category metadata maps to label assignments in registry.

Backfill mechanics:

1. Deterministic IDs to prevent duplicate block creation on rerun.
2. Write migration run log with counters and conflicts.
3. Emit migration events for observability.

Exit criteria:

1. 100% of atoms mapped to at least one block.
2. Zero unhandled migration conflicts.
3. Validation report compares v1 and v2 counts and critical fields.

### Phase 3: Dual-read and dual-write

1. All mutations write both legacy and v2 representations.
2. Reads remain v1-default with v2 shadow verification.
3. Mismatch logger records divergence and blocks cutover on threshold breach.

Exit criteria:

1. Divergence rate below threshold over sustained usage window.
2. Performance overhead acceptable.

### Phase 4: Cutover

1. Switch primary reads to v2.
2. Keep legacy writes optional for short grace period.
3. Enable notepad-first UI paths by default.

Exit criteria:

1. Chat/tasks/notepad operations healthy in production-like environment.
2. No Sev-1 or Sev-2 data integrity issues in soak window.

### Phase 5: Legacy decommission

1. Disable dual-write.
2. Remove dead code paths and legacy transforms.
3. Archive migration artifacts and finalize docs.

Exit criteria:

1. v2-only operation stable.
2. Rollback path documented and time-bounded.

## 5.3 Rollback strategy

1. Phase 0-3: full rollback by toggling feature flags and restoring backup.
2. Phase 4: rollback via read-path revert to v1 and replay from event log where needed.
3. Phase 5: no instant rollback; requires restore from backup snapshot.

## 6. Workstreams

## 6.1 WS-1: Block + Placement foundation

Deliverables:

1. New models and serde contracts for blocks and placements.
2. CRUD + move + reorder commands for placements.
3. Last-placement policy handlers.
4. Compatibility reads from existing atom files.

Tests:

1. Unit tests for placement ordering and parent invariants.
2. Migration tests for deterministic ID mapping.

## 6.2 WS-2: Notepad capture policy + category notepads

Deliverables:

1. Extend `NotepadViewDefinition` with capture defaults.
2. Add create-block-in-view command path.
3. Apply capture defaults (confirmed labels) on create.
4. Add category and multi-category open flows.

Tests:

1. Create block in category notepad auto-applies expected labels.
2. View filters and capture defaults remain independent and explicit.

## 6.3 WS-3: Labels and ontology graph

Deliverables:

1. Finalize registry kind taxonomy (`category`, `thread`, `north_star`).
2. Add alias and parent-edge validation (DAG enforcement).
3. Add label assignment/removal commands.
4. Add notepad open by category lookup with alias resolution.

Tests:

1. Alias conflict and cycle detection.
2. Descendant-inclusive filters for category views.

## 6.4 WS-4: Attention engine (heat/decay/bucket)

Deliverables:

1. Heat signal ingestion from command/event stream.
2. Decay recomputation job.
3. Bucket assignment with dwell and caps.
4. Blocking overlay behavior that removes tasks from attention buckets.

Tests:

1. Deterministic transitions under synthetic event sequences.
2. Boundary and cap behavior generates expected interventions.

## 6.5 WS-5: Decision-card generation engine

Deliverables:

1. `SystemGenerateDecisionCards` rule set implementation.
2. Dedupe key enforcement.
3. Escalation and notification-delivery cadence metadata.
4. Resolution actions mapped to concrete commands.

Tests:

1. Dedupe under repeated scans.
2. Escalation increments and suppression rules.
3. Resolution closes loops and emits events.

## 6.6 WS-6: Sweep + Patch lifecycle

Deliverables:

1. Sweep runner and pass pipeline scaffolding.
2. Patch persistence with risk tiers.
3. Accept/reject flows and atomic patch application.
4. Audit traces for every generated/accepted/rejected patch.

Tests:

1. High-risk patches never auto-apply.
2. Accept subset/hunk flows produce correct final state.

## 6.7 WS-7: Work sessions and focus queue

Deliverables:

1. Work session command set (`start`, `note`, `end`, `cancel`).
2. Session storage and links to blocks.
3. Focus queue projection seeded by attention/due/commitment.
4. Work-session events as highest-confidence heat signals.

Tests:

1. Session lifecycle invariants.
2. Session signal impact on heat/bucket assignment.

## 6.8 WS-8: Recurrence lifecycle

Deliverables:

1. Recurrence template CRUD.
2. Spawn engine job and instance lifecycle.
3. Missed-cycle decision-card generation.
4. Retire/update template flows.

Tests:

1. Spawn timing and idempotency.
2. Missed cycle detection and decision creation.

## 6.9 WS-9: API parity and contract hardening

Deliverables:

1. Ensure declared filter/sort contract behavior matches runtime behavior.
2. Add explicit unsupported errors for not-yet-enabled commands.
3. Version contracts and introduce compatibility matrix.

Tests:

1. Contract tests for each request field currently exposed in types.
2. Consumer tests for backward compatibility.

## 6.10 WS-10: UI migration to notepad-first

Deliverables:

1. Add Notepads screen(s) and outliner interaction model.
2. Keep Tasks as a derived/projection view, not the primary data model.
3. Add category-notepad open flow and capture experience.
4. Add decision queue, focus mode, and recurrence surfaces incrementally.

Tests:

1. E2E flows for capture, move, block, focus, and decisions.

## 6.11 WS-11: Migration implementation and tooling

Deliverables:

1. Migration plan/run command implementations wired to v2 transforms.
2. Validation tooling (counts, referential integrity, hash checks).
3. Dry-run and replay support.

Tests:

1. Repeated migration runs are idempotent.
2. Rollback and restore playbooks are tested.

## 6.12 WS-12: Observability and operations

Deliverables:

1. Structured logs for migration and system jobs.
2. Metrics:
  - migration progress
  - divergence rate (dual-read/write)
  - decision-card generation/resolution rates
  - sweep patch acceptance rate
3. Health checks for workspace runtime subsystems.

Tests:

1. Alerting thresholds and failure-mode simulations.

## 7. Detailed Migration Mapping Rules

## 7.1 Atom -> Block mapping

1. Generate deterministic `block_id` from `atom_id` and root ordinal.
2. Root block text from `atom.raw_text`.
3. Map task metadata from `atom.facet_data.task`.
4. Map status:
  - `done` -> block `COMPLETED`
  - `archived` -> block `ARCHIVED`
  - otherwise `ACTIVE`

## 7.2 Atom relations -> block hierarchy

1. `parent_id` maps to parent block edge when parent exists.
2. `blocked_by_atom_id` maps to task condition of type `TASK`.
3. `thread_ids` maps to label assignments (`thread` kind).

## 7.3 Notepad -> View + Placement mapping

1. For each existing notepad definition, create/upgrade v2 view object.
2. Query current atom membership and create placements per matching root block.
3. Preserve notepad sort mode in placement order where explicit order does not exist.

## 7.4 Backfill conflict policy

1. Missing parents: attach as root and log conflict.
2. Invalid references: preserve source data in migration note payload.
3. Malformed documents: skip + emit hard warning + include in report.

## 8. Testing Strategy

## 8.1 Unit tests

1. Placement ordering and hierarchy.
2. Label graph validation.
3. Attention transitions.
4. Decision dedupe/escalation.
5. Recurrence spawn logic.

## 8.2 Integration tests

1. End-to-end command/event flow for each state machine.
2. Obsidian CLI read/write path with filesystem fallback behavior explicitly tested.
3. Migration dry-run and apply-run comparisons.

## 8.3 End-to-end UX tests

1. Capture in NOW.
2. Open category notepad and capture with defaults.
3. Move block across notepads with identity preserved.
4. Start and end focus session.
5. Resolve generated decision cards.

## 8.4 Non-functional tests

1. Performance under large vault sizes.
2. Recovery from malformed file subsets.
3. Concurrency and idempotency under repeated commands.

## 9. Rollout Plan

## 9.1 Feature flags

1. `workspace.blocks_v2`
2. `workspace.placements_v2`
3. `workspace.capture_policy_v2`
4. `workspace.attention_engine_v2`
5. `workspace.decision_engine_v2`
6. `workspace.sweeps_v2`
7. `workspace.focus_sessions_v2`
8. `workspace.recurrence_v2`
9. `workspace.notepad_ui_v2`

## 9.2 Rollout order

1. Internal dev -> local soak.
2. Staging vault shadow mode.
3. Gradual enablement by subsystem.
4. Full cutover after migration and divergence checks pass.

## 9.3 Gate conditions for release

1. Migration validation passes.
2. Contract tests green.
3. No critical divergence in dual-write window.
4. Runbooks approved.

## 10. Risks and Mitigations

1. Risk: migration data corruption.
   Mitigation: pre-migration backup, deterministic mapping, dry-run required.
2. Risk: contract/UI mismatch persists.
   Mitigation: contract conformance tests and fail-fast unsupported responses.
3. Risk: Obsidian CLI availability variance.
   Mitigation: startup capability checks, explicit degraded-mode errors, PATH hardening.
4. Risk: performance regression with full-vault scans.
   Mitigation: index incremental updates and bounded projection refresh.
5. Risk: rollout complexity.
   Mitigation: strict feature-flag sequencing and measurable phase exits.

## 11. Milestones and Exit Criteria

## 11.1 M0 - Spec contract lock

1. Finalized v2 object and command contracts.
2. Approved mapping and migration invariants.

## 11.2 M1 - V2 storage and adapters ready

1. Blocks/placements models merged.
2. Legacy compatibility read path verified.

## 11.3 M2 - Migration engine ready

1. Dry-run and apply-run implemented.
2. Validation reports and rollback scripts complete.

## 11.4 M3 - Attention + decision loop operational

1. Heat/decay engine active behind flag.
2. System-generated decision cards working with dedupe/escalation.

## 11.5 M4 - Focus and recurrence operational

1. Work sessions influence attention.
2. Recurrence lifecycle active with missed-cycle cards.

## 11.6 M5 - Notepad-first UI and cutover

1. Notepad-first capture flow available and stable.
2. Tasks becomes a projection, not the domain anchor.

## 11.7 M6 - Cleanup and stabilization

1. Legacy-only code removed.
2. Runbooks and docs complete.
3. Post-cutover metrics stable.

## 12. Immediate Execution Order (Recommended)

1. Lock v2 contracts and migration mapping.
2. Implement Block + Placement domain and storage.
3. Implement migration tooling and run dry-runs on representative vault snapshots.
4. Add notepad capture defaults and category-open capture flow.
5. Implement attention + decision system jobs.
6. Implement work sessions and recurrence.
7. Migrate UI to notepad-first, then cut over and deprecate legacy paths.

## 13. Definition of Done (Program Level)

1. Core architectural mismatches (Blocks/Placements/Capture Policy/Attention/Decision automation) are closed.
2. Migration is repeatable, validated, and reversible up to cutover.
3. API contracts and behavior are aligned (no declared-but-ignored fields).
4. Notepad-first experience is primary and stable.
5. Obsidian remains source of truth with reliable CLI-based operations.

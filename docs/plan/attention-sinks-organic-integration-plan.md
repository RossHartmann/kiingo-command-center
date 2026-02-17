# Attention Sinks and Organic Guidance Integration Plan

Date: 2026-02-17  
Status: Draft (comprehensive implementation plan)

## 1. Purpose

Implement the notetaker spec's attention model so the app behaves like an "attention OS" instead of a static task list:

1. Frictionless capture remains primary.
2. Attention is treated as scarce and bounded.
3. Drift and tradeoffs are enforced via Decision Cards.
4. Guidance feels organic, contextual, and helpful rather than noisy.

## 2. Inputs and Sources

Primary sources:

1. `/Users/rosshartmann/Projects/kiingo/docs/spec/original-idea/notepad.md`
2. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/concepts/notetaker-concepts.md`
3. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/algorithms/notetaker-algorithms.md`
4. `/Users/rosshartmann/Projects/kiingo/docs/spec/notetaker/flows/notetaker-golden-flows.md`

Current implementation references:

1. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/NotepadScreen.tsx`
2. `/Users/rosshartmann/Projects/kiingo-command-center/src/screens/TasksScreen.tsx`
3. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/types.ts`
4. `/Users/rosshartmann/Projects/kiingo-command-center/src/lib/tauriClient.ts`
5. `/Users/rosshartmann/Projects/kiingo-command-center/src/state/appState.tsx`

## 2.1 Implementation Alignment (Spec -> Code Reuse Map)

| Spec capability | Existing code to reuse first | Reuse-first rule |
| --- | --- | --- |
| Attention layer and heat data | `TaskFacet.attentionLayer`, `AttentionFacet` in `/src/lib/types.ts` | Extend existing facets only if required. Do not create parallel "attention state" interfaces in UI files. |
| Decision queue lifecycle | `DecisionPrompt`, `DecisionPromptType`, `DecisionPromptStatus`, `DecisionOption` in `/src/lib/types.ts`; `decisionsList`, `decisionCreate`, `decisionResolve`, `decisionSnooze`, `decisionDismiss` in `/src/lib/tauriClient.ts` | Use existing decision APIs as the single mutation/read path. Do not add a second decision store in screen state. |
| Focus/work signal capture | `WorkSessionRecord` and `workSessionStart/note/end/cancel` in `/src/lib/tauriClient.ts` | Reuse work sessions as the strongest signal source. Do not invent separate focus-session persistence. |
| Attention compute entrypoint | `systemApplyAttentionUpdate` in `/src/lib/tauriClient.ts` | Enhance this command; do not create a new competing attention-update endpoint. |
| Decision generation entrypoint | `systemGenerateDecisionCards` in `/src/lib/tauriClient.ts` | Add trigger coverage and dedupe here; do not generate cards ad hoc in UI components. |
| Scheduler jobs | `JobType` already includes `sweep.decay`, `sweep.boundary`, `triage.enqueue`, `followup.enqueue` in `/src/lib/types.ts` and job APIs in `/src/lib/tauriClient.ts` | Reuse existing job model and APIs; no new scheduler model. |
| Attention projections | `ProjectionType` already includes `tasks.waiting`, `focus.queue`, `today.a_list`, `history.daily` in `/src/lib/types.ts`; projection APIs in `/src/lib/tauriClient.ts` | Build on existing projection contracts; avoid custom per-screen recomputation where projection exists. |
| Feature-flag rollout | `workspace.decay_engine`, `workspace.decision_queue`, `workspace.focus_sessions_v2`, `workspace.projections` in `/src/lib/types.ts` and `/src/lib/tauriClient.ts` | Gate new behavior with existing flag keys; do not introduce duplicate flags with overlapping meaning. |
| Notepad/Tasks UX shells | Existing progressive disclosure patterns in `/src/screens/NotepadScreen.tsx`, `/src/components/notepad/NotepadToolbar.tsx`, `/src/screens/TasksScreen.tsx` | Extend existing cards/disclosures rather than introducing parallel "advanced" panes. |
| Canonical workspace atom cache | `loadWorkspaceAtoms` and related actions in `/src/state/appState.tsx` | Keep one source of truth for atoms; avoid independent per-screen atom caches for new attention logic. |

## 2.2 Current Integration Gaps (Code-grounded)

1. Decision and work-session APIs exist but are not yet consumed by `TasksScreen` or `NotepadScreen`; integration needs to happen in those existing screens.
2. `systemApplyAttentionUpdate` currently uses a priority/status heuristic and does not yet apply heat, dwell, cap pressure, or blocked exclusion.
3. `systemGenerateDecisionCards` currently covers overdue hard due tasks only and lacks overflow/boundary/follow-up trigger coverage.
4. Projection contracts exist for `tasks.waiting` and `focus.queue`, but Tasks/Notepad still mostly compute display groupings directly from atom lists.
5. Job types for decay/boundary/triage/follow-up exist, but the decision/attention loop is not yet wired end-to-end through job runs.

## 2.3 No-Duplicate Guardrails (Must Hold During Implementation)

1. Do not add alternate domain types for attention/decisions/work sessions in screen-local files; extend `/src/lib/types.ts` contracts.
2. Do not create alternate API wrappers for decision or work-session actions; use `/src/lib/tauriClient.ts` functions directly.
3. Do not implement permanent bucket assignment logic in React components; keep assignment and cap enforcement in `systemApplyAttentionUpdate`.
4. Do not implement permanent decision generation logic in React components; keep triggering/dedupe in `systemGenerateDecisionCards`.
5. Do not add a second cache of workspace atoms/decisions in global state; if shared selectors are needed, derive from existing `appState` and API reads.
6. If a new UI capability is needed on both Tasks and Notepad, create one reusable component (for example `DecisionQueuePanel`) instead of duplicating JSX in each screen.
7. Any new feature flag must map to a single behavior boundary; if existing flags already cover the boundary, reuse them.
8. Every new plan item must point to one existing file/function to extend before adding new files.

## 2.4 Reuse-first Delivery Sequence (Pre-implementation)

1. Audit and enumerate reusable contracts in `/src/lib/types.ts` before adding any new type.
2. Extend engine entrypoints in `/src/lib/tauriClient.ts` (`systemApplyAttentionUpdate`, `systemGenerateDecisionCards`) before touching UI.
3. Wire existing decision/work-session APIs into `/src/screens/TasksScreen.tsx` and `/src/screens/NotepadScreen.tsx`.
4. Only after reuse seams are exhausted, add new shared UI components under `/src/components/`.
5. Run a duplication check (`rg`) for any new concept names before finalizing each phase.

## 3. What "Attention Sinks" Means in This Product

"Attention sinks" are the persistent, low-friction surfaces where the system captures and guides cognitive load:

1. L3 Hot threads (max 3).
2. RAM warm strip (max 15-20).
3. Waiting/Blocked universe with follow-up cadence.
4. Boundary drift queue (items about to decay).
5. Decision Queue (forced tradeoff inbox).
6. Focus Session queue (what to do now).

The sink concept must be:

1. Always available.
2. Lightweight by default.
3. Actionable in one click.
4. Explaining why each item is surfaced.

## 4. Non-Negotiable Behavioral Invariants from Spec

1. Capture is never blocked by attention constraints.
2. Viewing alone does not promote attention.
3. Work signals are strongest for promotion/stability.
4. Blocked tasks leave normal attention buckets.
5. Caps are enforced via Decision Cards, not silent hard blocks.
6. Drift proceeds if decisions are ignored.
7. Hard commitments cannot silently die; they require explicit decisions.
8. Notifications deliver Decision Cards, not random raw pings.

## 5. Current State Assessment

## 5.1 What exists

1. Schema fields for attention, decisions, work sessions, blocking, recurrence in `/src/lib/types.ts`.
2. CRUD for decisions and work sessions in `/src/lib/tauriClient.ts`.
3. Basic `systemApplyAttentionUpdate` and `systemGenerateDecisionCards` functions in `/src/lib/tauriClient.ts`.
4. Notepad and Tasks pages with strong keyboard/outliner behavior and progressive disclosure controls.

## 5.2 Gaps

1. Attention assignment is simplistic (priority/status driven), not heat + dwell + pressure.
2. No L3/RAM cap enforcement logic with durable decision dedupe.
3. Decision generation is limited to hard-due overdue checks.
4. No dedicated Decision Queue UI.
5. No Focus Mode UI integrated with work sessions and suggested queue.
6. No "why surfaced" transparency in Tasks/Notepad.
7. No drift boundary preview surface.
8. No metric-backed tuning loop for attention behavior.

## 6. Target End State

## 6.1 Product outcome

1. User opens Notepad and captures freely.
2. System continuously computes effective attention placement.
3. Overflow, drift, waiting followups, and hard-commitment boundaries create Decision Cards.
4. User resolves tradeoffs in a dedicated queue with minimal friction.
5. Focus sessions convert intention into work signals and keep the model honest.

## 6.2 Platform outcome

1. Attention engine and decision engine are deterministic and testable.
2. Surfaces are projection-driven and reusable across screens.
3. Behavior can be tuned via config without structural rewrites.

## 7. Architecture and State Model

## 7.1 Effective heat model

Compute:

1. `base_heat` from decayed prior heat.
2. `signal_delta` from meaningful events.
3. `due_pressure` from soft/hard due proximity.
4. `commitment_pressure` for hard commitments near boundary.
5. `cluster_influence` with strict cap to avoid zombie clusters.

Then:

1. `effective_heat = base_heat + signal_delta + due_pressure + commitment_pressure + capped_cluster_influence`.
2. Derive candidate bucket from thresholds.
3. Apply dwell constraints and blocked exclusion.
4. Apply caps by creating decision cards and temporary overflow states.

## 7.2 Attention buckets

1. `l3` hot (max 3).
2. `ram` warm (max 15-20).
3. `short`.
4. `long`.
5. `archive`.

`l1` is derived support steps for `l3`, not a general bucket.

## 7.3 Decision card lifecycle

1. `pending`.
2. `snoozed`.
3. `resolved`.
4. `dismissed` or `expired`.

Each card requires:

1. Type.
2. Dedupe key.
3. Priority.
4. Target atom ids.
5. Action options with typed outcomes.

## 8. Decision Card Types to Implement

P0:

1. `L3_OVERFLOW`.
2. `RAM_OVERFLOW`.
3. `BOUNDARY_DRIFT_REVIEW`.
4. `WAITING_FOLLOWUP`.
5. `OVERDUE_HARD_DUE`.
6. `HARD_COMMITMENT_REVIEW`.

P1:

1. `HARD_COMMITMENT_OVERFLOW`.
2. `RECURRENCE_MISSED`.
3. `NORTH_STAR_STALE`.
4. `CONFESSION_SUGGESTION`.

## 9. Organic UX Design Strategy

Design rules:

1. Do not interrupt capture with modal prompts.
2. Show one primary recommendation and optional "More".
3. Keep prompts anchored to user context (task, notepad, day boundary).
4. Explain each recommendation with "why now".
5. Prefer one-click actions.
6. Preserve keyboard-first flow.
7. Use progressive disclosure for advanced choices.

Copy rules:

1. Use specific options: "Do now", "Snooze", "Let drift", "Recommit", "Reschedule".
2. Use reason strings: "L3 has 5 tasks; choose 3 hot threads."
3. Avoid generic alarm language.

## 10. UI Work by Surface

## 10.1 Notepad page

1. Add compact "Attention rail" above outline with L3 and RAM counts.
2. Add "Drifting soon" chip with item count and open-queue action.
3. Add row-level metadata pill for attention layer and last work signal.
4. Add quick action `Make Hot` with overflow guard behavior.
5. Add optional "Why this row is hot/cooling" inline disclosure.

## 10.2 Tasks page

1. Replace static columns with attention-aware groupings toggle.
2. Add Decision Queue panel at top.
3. Add Waiting follow-up rail distinct from active execution tasks.
4. Add due-pressure and commitment badges in `More` disclosure.

## 10.3 New Decision Queue screen/component

1. Dedicated list of pending/snoozed cards.
2. Card details:
   1. trigger reason.
   2. affected tasks.
   3. ranked suggestions.
3. One-click resolution actions.
4. Keyboard shortcuts for fast triage.

## 10.4 Focus Mode

1. Start focus session from L3 task or queue recommendation.
2. Show suggested queue order.
3. Quick notes and progress logging.
4. End session summary that emits strong signal.

## 11. Backend and Engine Work

## 11.1 Attention engine

Enhance `systemApplyAttentionUpdate`:

1. Read and update heat/dwell fields.
2. Apply signal model from events and work sessions.
3. Handle blocked exclusions and waiting universe.
4. Return both updated atoms and triggered decision ids.

## 11.2 Decision generation engine

Enhance `systemGenerateDecisionCards`:

1. Evaluate all P0 triggers every tick/job run.
2. Deduplicate with deterministic keys.
3. Set priorities and due windows.
4. Update existing cards instead of duplicating.

## 11.3 Follow-up and sweep jobs

Add/enable scheduled jobs:

1. `sweep.decay`.
2. `sweep.boundary`.
3. `triage.enqueue`.
4. `followup.enqueue`.

## 11.4 Projection outputs

Materialize projections for:

1. `focus.queue`.
2. `tasks.waiting`.
3. `today.a_list`.
4. `history.daily`.

## 12. Data Model and Contract Changes

## 12.1 Type-level updates

1. Add explicit decision prompt types for overflow/drift/followup categories if needed.
2. Add fields for decision dedupe key and trigger metadata.
3. Add signal metadata on work session events.

## 12.2 Storage/migration

1. Backfill missing attention fields on active tasks.
2. Initialize default heat and dwell values safely.
3. Introduce migration journal entries for reproducibility.

## 13. Progressive Rollout and Feature Flags

Flags:

1. `workspace.decay_engine`.
2. `workspace.decision_queue`.
3. `workspace.focus_sessions_v2`.
4. `workspace.projections`.

Rollout phases:

1. Internal dev: engines only, no UI exposure.
2. Dogfood: decision queue visible, passive recommendations.
3. Partial user rollout: queue actions enabled.
4. Full rollout: focus suggestions + weekly tuning cadence.

## 14. Testing Strategy

## 14.1 Unit tests

1. Heat decay and threshold transitions.
2. Dwell rule enforcement.
3. Decision dedupe generation rules.
4. Waiting follow-up cadence logic.

## 14.2 Integration tests

1. Capture -> RAM insertion.
2. Overflow -> decision creation -> resolution -> bucket correction.
3. Drift boundary prompt -> ignore -> automatic demotion.
4. Hard commitment boundary -> forced decision path.
5. Focus session -> strong signal -> stability in L3.

## 14.3 UI tests

1. Decision queue actions from keyboard and pointer.
2. Progressive disclosure behavior on Notepad/Tasks.
3. "Why surfaced" transparency copy accuracy.
4. No capture interruption regressions.

## 15. Observability and Success Metrics

Operational metrics:

1. Decision cards created/day by type.
2. Decision resolution latency.
3. L3 overflow frequency.
4. RAM overflow frequency.
5. Drift reversal rate.
6. Waiting follow-up completion rate.

Outcome metrics:

1. Focus session starts/day.
2. Work session completion rate.
3. Share of tasks with work signals before completion.
4. Backlog stale ratio over time.
5. User-perceived usefulness of prompts.

Guardrails:

1. Cap card generation per day/user.
2. Suppress duplicate prompts within cooldown windows.
3. Monitor unresolved pending-card age.

## 16. Risks and Mitigations

Risk: prompt fatigue.  
Mitigation: dedupe, rate limits, severity priority, snooze support.

Risk: over-aggressive drift feels punitive.  
Mitigation: transparent reasons, adjustable thresholds, dry-run telemetry.

Risk: noisy suggestions degrade trust.  
Mitigation: strict signal weighting, explainability, model tuning.

Risk: complex UI harms notepad simplicity.  
Mitigation: progressive disclosure, compact rails, keyboard-first defaults.

Risk: mismatch between mock and Tauri backends.  
Mitigation: integration tests against both paths and contract parity checks.

## 17. Comprehensive Execution Checklist

## 17.0 Grounding and dedupe preflight

1. Build a traceability grid for each planned feature: spec requirement -> existing file/function -> extension approach.
2. Confirm no duplicate type names for attention/decision/session concepts outside `/src/lib/types.ts`.
3. Confirm no duplicate API wrappers for decisions/work sessions outside `/src/lib/tauriClient.ts`.
4. Confirm each new UI element is either added to existing screens/components or extracted once as a shared component.
5. Add a PR checklist item requiring a `rg`-based duplicate-name scan before merge.

## 17.1 Phase A - Engine foundation

1. Extend `systemApplyAttentionUpdate` with effective heat calculation (no new attention endpoint).
2. Implement dwell and drift transitions within existing attention fields (`AttentionFacet`/`TaskFacet.attentionLayer`).
3. Implement blocked/waiting exclusion from normal buckets, reusing existing condition/task state.
4. Implement cap checks and overflow states with decision-id outputs from the existing attention update response.
5. Add deterministic decision dedupe keys on existing decision records.

## 17.2 Phase B - Decision workflows

1. Extend `systemGenerateDecisionCards` for the full P0 trigger set (no UI-side card generation logic).
2. Implement decision option handlers via existing `decisionResolve`/`decisionSnooze`/`decisionDismiss` pathways.
3. Add queue ordering by severity and urgency in one shared selector/component.
4. Add snooze/dismiss/reopen consistency checks against existing decision statuses.

## 17.3 Phase C - UI integration

1. Add one shared Decision Queue component and consume it in existing screen shells.
2. Integrate queue into `/src/screens/TasksScreen.tsx` (reusing current progressive disclosure pattern).
3. Add attention rails to `/src/screens/NotepadScreen.tsx` (no parallel notepad surface).
4. Add "why surfaced" inline details by extending existing row/card metadata areas.
5. Add quick actions (`Make Hot`, `Let Drift`, `Snooze`) mapped to existing API commands.

## 17.4 Phase D - Focus mode

1. Implement focus entry points from L3/decision cards using existing Tasks/Notepad navigation surfaces first.
2. Add suggestion queue assembly from `focus.queue` projection and atom data.
3. Add session notes and summary UX on top of existing work-session APIs.
4. Wire work signals back into `systemApplyAttentionUpdate`.

## 17.5 Phase E - Observability and hardening

1. Add telemetry events and dashboards.
2. Add rate limit and dedupe safeguards.
3. Add replayable integration fixtures for decision generation.
4. Run tuning experiments on caps and thresholds.

## 17.6 Phase F - Rollout

1. Ship behind flags.
2. Dogfood with weekly review.
3. Gradually expand rollout cohort.
4. Promote defaults once stability and usefulness targets are met.

## 18. Definition of Done

1. Attention layer placement follows spec invariants.
2. Overflow and drift are enforced through Decision Cards.
3. Decision queue is actionable and low-friction.
4. Focus sessions influence attention as strongest signal.
5. Capture flow remains uninterrupted and keyboard-first.
6. Metrics show reduced stale clutter and improved execution behavior.

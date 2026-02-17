import { describe, expect, it } from "vitest";
import {
  atomCreate,
  conditionSetPerson,
  atomUpdate,
  atomsList,
  createConversation,
  decisionResolve,
  decisionsList,
  featureFlagUpdate,
  grantWorkspace,
  getConversation,
  jobRun,
  jobsList,
  listConversations,
  listRuns,
  projectionCheckpointGet,
  projectionRefresh,
  projectionsList,
  registryEntrySave,
  listWorkspaceGrants,
  sendConversationMessage,
  startRun,
  systemApplyAttentionUpdate,
  systemGenerateDecisionCards,
  workSessionCancel,
  workSessionEnd,
  workSessionStart
} from "./tauriClient";

describe("tauriClient mock fallback", () => {
  it("creates queued runs without tauri", async () => {
    const result = await startRun({
      provider: "codex",
      prompt: "hello",
      model: undefined,
      mode: "non-interactive",
      outputFormat: "text",
      cwd: "/tmp",
      optionalFlags: {},
      profileId: "profile-123",
      queuePriority: 0,
      timeoutSeconds: 30
    });

    expect(result.runId).toBeTruthy();
    const runs = await listRuns({ limit: 20, offset: 0 });
    const created = runs.find((run) => run.id === result.runId);
    expect(created?.profileId).toBe("profile-123");
  });

  it("stores workspace grants", async () => {
    const before = await listWorkspaceGrants();
    const grant = await grantWorkspace("/tmp");
    const after = await listWorkspaceGrants();

    expect(grant.path).toBe("/tmp");
    expect(after.length).toBeGreaterThanOrEqual(before.length);
  });

  it("filters runs by provider and date window", async () => {
    await startRun({
      provider: "claude",
      prompt: "date-filter",
      mode: "non-interactive",
      outputFormat: "text",
      cwd: "/tmp",
      optionalFlags: {},
      timeoutSeconds: 30
    });

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const filtered = await listRuns({ provider: "claude", dateFrom: from, dateTo: to, limit: 20, offset: 0 });
    expect(filtered.some((run) => run.provider === "claude" && run.prompt === "date-filter")).toBe(true);
  });

  it("creates conversation and links sent runs in mock mode", async () => {
    await grantWorkspace("/tmp");
    const conversation = await createConversation({ provider: "codex", title: "conversation test" });
    const sent = await sendConversationMessage({
      conversationId: conversation.id,
      prompt: "hello from conversation",
      outputFormat: "text"
    });
    const detail = await getConversation(conversation.id);
    expect(sent.runId).toBeTruthy();
    expect(detail?.runs.some((run) => run.id === sent.runId)).toBe(true);
    const listed = await listConversations({ provider: "codex", includeArchived: false, limit: 20, offset: 0 });
    expect(listed.some((item) => item.id === conversation.id)).toBe(true);
  });

  it("supports label/category filters and clearParentId relation patch", async () => {
    const parent = await atomCreate({
      rawText: "Parent node for relation clear test",
      captureSource: "ui",
      initialFacets: ["task"],
      facetData: {
        task: { title: "Parent", status: "todo", priority: 3 }
      }
    });

    const child = await atomCreate({
      rawText: "Child node for relation clear test",
      captureSource: "ui",
      initialFacets: ["task"],
      facetData: {
        task: { title: "Child", status: "todo", priority: 3 },
        meta: { labels: ["alpha"], categories: ["project-x"] }
      },
      relations: { parentId: parent.id, threadIds: [] }
    });

    const filtered = await atomsList({
      limit: 200,
      filter: {
        labels: ["alpha"],
        categories: ["project-x"],
        includeArchived: true
      }
    });
    expect(filtered.items.some((atom) => atom.id === child.id)).toBe(true);

    const cleared = await atomUpdate(child.id, {
      expectedRevision: child.revision,
      clearParentId: true
    });
    expect(cleared.relations.parentId).toBeUndefined();
  });

  it("applies attention layers from work signals and due pressure", async () => {
    const urgent = await atomCreate({
      rawText: "Urgent hard due test",
      captureSource: "ui",
      initialFacets: ["task"],
      facetData: {
        task: {
          title: "Urgent due",
          status: "todo",
          priority: 3,
          hardDueAt: new Date(Date.now() - 60_000).toISOString()
        }
      }
    });
    const focusTarget = await atomCreate({
      rawText: "Focus signal task",
      captureSource: "ui",
      initialFacets: ["task"],
      facetData: {
        task: { title: "Focus signal task", status: "todo", priority: 3 }
      }
    });
    const session = await workSessionStart({ focusBlockIds: [`blk_${focusTarget.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`] });
    await workSessionEnd(session.id, { expectedRevision: session.revision, summaryNote: "done" });

    const result = await systemApplyAttentionUpdate();
    expect(result.accepted).toBe(true);
    expect(result.updatedAtomIds.length).toBeGreaterThan(0);

    const refreshed = await atomsList({ filter: { includeArchived: true } });
    const urgentRefreshed = refreshed.items.find((item) => item.id === urgent.id);
    const focusRefreshed = refreshed.items.find((item) => item.id === focusTarget.id);
    expect(urgentRefreshed?.facetData.task?.attentionLayer).toBe("l3");
    expect(["l3", "ram"]).toContain(focusRefreshed?.facetData.task?.attentionLayer);
  });

  it("generates and resolves decision cards that mutate task state", async () => {
    const overdue = await atomCreate({
      rawText: "Overdue decision task",
      captureSource: "ui",
      initialFacets: ["task"],
      facetData: {
        task: {
          title: "Overdue decision task",
          status: "todo",
          priority: 2,
          hardDueAt: new Date(Date.now() - 5 * 60_000).toISOString()
        }
      }
    });

    const waiting = await atomCreate({
      rawText: "Waiting follow-up task",
      captureSource: "ui",
      initialFacets: ["task"],
      facetData: {
        task: { title: "Waiting follow-up task", status: "todo", priority: 3 }
      }
    });
    await conditionSetPerson({
      atomId: waiting.id,
      waitingOnPerson: "Alex",
      cadenceDays: 1
    });

    const generated = await systemGenerateDecisionCards();
    expect(generated.accepted).toBe(true);
    expect(generated.createdOrUpdatedIds.length).toBeGreaterThan(0);

    const queue = await decisionsList({ status: "pending", limit: 200 });
    const overdueDecision = queue.items.find((decision) => decision.atomIds.includes(overdue.id));
    expect(overdueDecision).toBeTruthy();
    if (!overdueDecision) return;

    const doNowOption = overdueDecision.options.find((option) => option.actionKind === "task.do_now");
    expect(doNowOption).toBeTruthy();
    if (!doNowOption) return;

    await decisionResolve(overdueDecision.id, doNowOption.id, "resolve from test");

    const postResolve = await atomsList({ filter: { includeArchived: true } });
    const overdueAfter = postResolve.items.find((item) => item.id === overdue.id);
    expect(overdueAfter?.facetData.task?.status).toBe("doing");
  });

  it("scopes overflow decision actions to payload atom ids instead of mutating the full set", async () => {
    await featureFlagUpdate("workspace.decay_engine", { enabled: true });
    await featureFlagUpdate("workspace.decision_queue", { enabled: true });

    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const atom = await atomCreate({
        rawText: `Overflow candidate ${index}`,
        captureSource: "ui",
        initialFacets: ["task"],
        facetData: {
          task: {
            title: `Overflow candidate ${index}`,
            status: "doing",
            priority: 1,
            attentionLayer: "l3"
          },
          attention: {
            layer: "l3",
            heatScore: 12 - index,
            lastSignalAt: new Date().toISOString()
          }
        }
      });
      created.push(atom.id);
    }

    await systemGenerateDecisionCards();
    const queue = await decisionsList({ status: "pending", limit: 300 });
    const overflowDecision = queue.items.find((decision) => decision.type === "l3_overflow" && created.every((id) => decision.atomIds.includes(id)));
    expect(overflowDecision).toBeTruthy();
    if (!overflowDecision) return;
    const snoozeOption = overflowDecision.options.find((option) => option.id === "snooze_extras");
    expect(snoozeOption).toBeTruthy();
    if (!snoozeOption) return;

    await decisionResolve(overflowDecision.id, snoozeOption.id);

    const refreshed = await atomsList({ filter: { includeArchived: true }, limit: 500 });
    const targetIds = Array.isArray(snoozeOption.payload?.atomIds)
      ? snoozeOption.payload.atomIds.filter((value): value is string => typeof value === "string")
      : [];
    const createdTargets = targetIds.filter((id) => created.includes(id));
    expect(createdTargets.length).toBeGreaterThan(0);
    const untouchedIds = created.filter((id) => !createdTargets.includes(id));
    for (const atomId of createdTargets) {
      const atom = refreshed.items.find((item) => item.id === atomId);
      expect(atom?.facetData.task?.status).toBe("todo");
      expect(typeof atom?.facetData.task?.snoozedUntil).toBe("string");
    }
    for (const atomId of untouchedIds) {
      const atom = refreshed.items.find((item) => item.id === atomId);
      expect(atom?.facetData.task?.status).toBe("doing");
    }
    const allSnoozedIds = refreshed.items
      .filter((item) => created.includes(item.id))
      .filter((item) => typeof item.facetData.task?.snoozedUntil === "string")
      .map((item) => item.id);
    expect(allSnoozedIds.length).toBeLessThan(created.length);
  });

  it("restores task status when a focus session is canceled", async () => {
    const task = await atomCreate({
      rawText: "Focus cancel status restore",
      captureSource: "ui",
      initialFacets: ["task"],
      facetData: {
        task: { title: "Focus cancel status restore", status: "todo", priority: 3 }
      }
    });
    const session = await workSessionStart({ focusBlockIds: [`blk_${task.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`] });

    let refreshed = await atomsList({ filter: { includeArchived: true }, limit: 300 });
    let target = refreshed.items.find((item) => item.id === task.id);
    expect(target?.facetData.task?.status).toBe("doing");

    await workSessionCancel(session.id, { expectedRevision: session.revision, reason: "cancel for test" });
    refreshed = await atomsList({ filter: { includeArchived: true }, limit: 300 });
    target = refreshed.items.find((item) => item.id === task.id);
    expect(target?.facetData.task?.status).toBe("todo");
  });

  it("respects feature flags for attention and decision engines", async () => {
    await featureFlagUpdate("workspace.decay_engine", { enabled: false });
    await featureFlagUpdate("workspace.decision_queue", { enabled: false });

    const attentionResult = await systemApplyAttentionUpdate();
    const decisionResult = await systemGenerateDecisionCards();
    expect(attentionResult.accepted).toBe(false);
    expect(decisionResult.accepted).toBe(false);

    await featureFlagUpdate("workspace.decay_engine", { enabled: true });
    await featureFlagUpdate("workspace.decision_queue", { enabled: true });
  });

  it("materializes projection previews and runs scheduler jobs against engines", async () => {
    await featureFlagUpdate("workspace.projections", { enabled: true });
    await featureFlagUpdate("workspace.scheduler", { enabled: true });
    await featureFlagUpdate("workspace.decay_engine", { enabled: true });
    await featureFlagUpdate("workspace.decision_queue", { enabled: true });

    const projections = await projectionsList({ limit: 50 });
    expect(projections.items.some((projection) => projection.type === "tasks.waiting")).toBe(true);
    expect(projections.items.some((projection) => projection.type === "focus.queue")).toBe(true);

    const focusProjection = projections.items.find((projection) => projection.type === "focus.queue");
    expect(focusProjection).toBeTruthy();
    if (!focusProjection) return;
    await projectionRefresh(focusProjection.id, "full");
    const checkpoint = await projectionCheckpointGet(focusProjection.id);
    expect(checkpoint.status).toBe("healthy");
    expect(checkpoint.preview).toBeTruthy();
    const previewItems = checkpoint.preview?.items;
    expect(Array.isArray(previewItems)).toBe(true);

    const jobs = await jobsList({ limit: 50 });
    const triageJob = jobs.items.find((job) => job.type === "triage.enqueue");
    expect(triageJob).toBeTruthy();
    if (!triageJob) return;
    const run = await jobRun(triageJob.id, { now: new Date().toISOString() });
    expect(["succeeded", "skipped"]).toContain(run.status);
  });

  it("generates P1 decision cards for hard commitment overflow, recurrence miss, north-star stale, and confession", async () => {
    await featureFlagUpdate("workspace.decision_queue", { enabled: true });

    const hardCommitmentIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const atom = await atomCreate({
        rawText: `Hard commitment ${index}`,
        captureSource: "ui",
        initialFacets: ["task"],
        facetData: {
          task: {
            title: `Hard commitment ${index}`,
            status: "todo",
            priority: 2,
            commitmentLevel: "hard",
            attentionLayer: "l3"
          }
        }
      });
      hardCommitmentIds.push(atom.id);
    }

    await atomCreate({
      rawText: "Recurring overdue",
      captureSource: "ui",
      initialFacets: ["task", "recurrence"],
      facetData: {
        task: {
          title: "Recurring overdue",
          status: "todo",
          priority: 2,
          softDueAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
        },
        recurrence: {
          templateId: "template-itest",
          frequency: "daily"
        }
      }
    });

    await atomCreate({
      rawText: "High dread stale task",
      captureSource: "ui",
      initialFacets: ["task", "energy"],
      facetData: {
        task: {
          title: "High dread stale task",
          status: "todo",
          priority: 3,
          dreadLevel: 3
        },
        energy: {
          dreadLevel: 3
        },
        attention: {
          layer: "short",
          lastSignalAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
        }
      }
    });

    await registryEntrySave({
      id: `north-star-${Date.now()}`,
      kind: "north_star",
      name: "Revenue North Star",
      aliases: ["revenue-ns"],
      status: "active",
      lastActivityAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    });

    await systemGenerateDecisionCards();
    const queue = await decisionsList({ status: "pending", limit: 500 });
    expect(queue.items.some((decision) => decision.type === "hard_commitment_overflow")).toBe(true);
    expect(queue.items.some((decision) => decision.type === "recurrence_missed")).toBe(true);
    expect(queue.items.some((decision) => decision.type === "north_star_stale")).toBe(true);
    expect(queue.items.some((decision) => decision.type === "confession_suggestion")).toBe(true);
  });
});

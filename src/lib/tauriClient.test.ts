import { describe, expect, it } from "vitest";
import {
  atomCreate,
  atomUpdate,
  atomsList,
  createConversation,
  grantWorkspace,
  getConversation,
  listConversations,
  listRuns,
  listWorkspaceGrants,
  sendConversationMessage,
  startRun
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
});

import { describe, expect, it } from "vitest";
import { grantWorkspace, listRuns, listWorkspaceGrants, startRun } from "./tauriClient";

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
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DecisionPrompt } from "../../lib/types";
import { DecisionQueuePanel } from "./DecisionQueuePanel";

function buildDecision(id: string, title: string, priority: 1 | 2 | 3 | 4 | 5): DecisionPrompt {
  const now = new Date().toISOString();
  return {
    id,
    schemaVersion: 1,
    type: "force_decision",
    status: "pending",
    priority,
    title,
    body: `${title} body`,
    atomIds: [],
    options: [
      { id: "do_now", label: "Do now", actionKind: "task.do_now" },
      { id: "snooze", label: "Snooze", actionKind: "task.snooze" }
    ],
    createdAt: now,
    updatedAt: now,
    revision: 1
  };
}

describe("DecisionQueuePanel", () => {
  it("supports keyboard triage actions", () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const onSnooze = vi.fn().mockResolvedValue(undefined);
    const onDismiss = vi.fn().mockResolvedValue(undefined);

    render(
      <DecisionQueuePanel
        decisions={[
          buildDecision("decision-a", "Decision A", 1),
          buildDecision("decision-b", "Decision B", 2)
        ]}
        onResolve={onResolve}
        onSnooze={onSnooze}
        onDismiss={onDismiss}
      />
    );

    const queue = screen.getByLabelText("Decision queue");
    queue.focus();

    fireEvent.keyDown(queue, { key: "ArrowDown" });
    fireEvent.keyDown(queue, { key: "Enter" });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve.mock.calls[0][0].id).toBe("decision-b");
    expect(onResolve.mock.calls[0][1]).toBe("do_now");

    fireEvent.keyDown(queue, { key: "s" });
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(onSnooze.mock.calls[0][0].id).toBe("decision-b");

    fireEvent.keyDown(queue, { key: "d" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss.mock.calls[0][0].id).toBe("decision-b");
  });
});

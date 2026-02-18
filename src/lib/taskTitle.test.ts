import { describe, expect, it } from "vitest";
import { deriveTaskTitle, taskDisplayTitle } from "./taskTitle";

describe("taskTitle helpers", () => {
  it("derives title from first non-empty line and strips task markers", () => {
    expect(deriveTaskTitle("\n- [ ] Ship release notes\nsecond line")).toBe("Ship release notes");
  });

  it("derives display title from raw text", () => {
    const atom = {
      id: "a2",
      rawText: "- [ ] Recruit speakers"
    };
    expect(taskDisplayTitle(atom as Parameters<typeof taskDisplayTitle>[0])).toBe("Recruit speakers");
  });

  it("returns fallback when no title data is available", () => {
    const atom = {
      id: "a3",
      rawText: "   \n"
    };
    expect(taskDisplayTitle(atom as Parameters<typeof taskDisplayTitle>[0], "Untitled")).toBe("Untitled");
  });
});

import { describe, expect, it } from "vitest";
import { initialNotepadUiState, notepadUiReducer } from "./notepadState";

describe("notepadUiReducer", () => {
  it("tracks selection and collapsed state", () => {
    let state = initialNotepadUiState;
    expect(state.interactionMode).toBe("navigation");
    state = notepadUiReducer(state, { type: "set_selected_placement", placementId: "p-1" });
    expect(state.selectedPlacementId).toBe("p-1");

    state = notepadUiReducer(state, { type: "toggle_collapsed", placementId: "p-1" });
    expect(state.collapsedByPlacement["p-1"]).toBe(true);

    state = notepadUiReducer(state, { type: "toggle_collapsed", placementId: "p-1" });
    expect(state.collapsedByPlacement["p-1"]).toBe(false);

    state = notepadUiReducer(state, { type: "set_row_collapsed", placementId: "p-1", collapsed: true });
    expect(state.collapsedByPlacement["p-1"]).toBe(true);
  });

  it("sets and clears drafts", () => {
    let state = initialNotepadUiState;
    state = notepadUiReducer(state, { type: "set_draft", placementId: "p-1", draft: "hello" });
    expect(state.draftsByPlacement["p-1"]).toBe("hello");

    state = notepadUiReducer(state, { type: "clear_draft", placementId: "p-1" });
    expect(state.draftsByPlacement["p-1"]).toBeUndefined();
  });

  it("tracks clipboard and quick action state", () => {
    let state = initialNotepadUiState;
    state = notepadUiReducer(state, {
      type: "set_clipboard",
      clipboard: {
        blockId: "b-1",
        sourcePlacementId: "p-1",
        sourceViewId: "now",
        mode: "copy"
      }
    });
    expect(state.clipboard?.blockId).toBe("b-1");

    state = notepadUiReducer(state, { type: "set_quick_actions_open", open: true });
    expect(state.quickActionsOpen).toBe(true);

    state = notepadUiReducer(state, { type: "set_interaction_mode", mode: "edit" });
    expect(state.interactionMode).toBe("edit");

    state = notepadUiReducer(state, { type: "set_active_notepad", notepadId: "focus" });
    expect(state.interactionMode).toBe("navigation");
  });
});

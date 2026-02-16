import { useReducer } from "react";
import type { ClipboardRow } from "../components/notepad/types";
import type { NotepadInteractionMode } from "../components/notepad/keyboardContract";

interface NotepadUiState {
  activeNotepadId: string;
  selectedPlacementId?: string;
  interactionMode: NotepadInteractionMode;
  collapsedByPlacement: Record<string, boolean>;
  draftsByPlacement: Record<string, string>;
  clipboard: ClipboardRow | null;
  quickActionsOpen: boolean;
}

type NotepadUiAction =
  | { type: "set_active_notepad"; notepadId: string }
  | { type: "set_selected_placement"; placementId?: string }
  | { type: "toggle_collapsed"; placementId: string }
  | { type: "set_row_collapsed"; placementId: string; collapsed: boolean }
  | { type: "set_collapsed"; collapsedByPlacement: Record<string, boolean> }
  | { type: "set_interaction_mode"; mode: NotepadInteractionMode }
  | { type: "set_draft"; placementId: string; draft: string }
  | { type: "clear_draft"; placementId: string }
  | { type: "set_clipboard"; clipboard: ClipboardRow | null }
  | { type: "set_quick_actions_open"; open: boolean };

const initialNotepadUiState: NotepadUiState = {
  activeNotepadId: "now",
  selectedPlacementId: undefined,
  interactionMode: "navigation",
  collapsedByPlacement: {},
  draftsByPlacement: {},
  clipboard: null,
  quickActionsOpen: false
};

function reducer(state: NotepadUiState, action: NotepadUiAction): NotepadUiState {
  switch (action.type) {
    case "set_active_notepad":
      return {
        ...state,
        activeNotepadId: action.notepadId,
        interactionMode: "navigation"
      };
    case "set_selected_placement":
      return { ...state, selectedPlacementId: action.placementId };
    case "toggle_collapsed":
      return {
        ...state,
        collapsedByPlacement: {
          ...state.collapsedByPlacement,
          [action.placementId]: !state.collapsedByPlacement[action.placementId]
        }
      };
    case "set_row_collapsed":
      return {
        ...state,
        collapsedByPlacement: {
          ...state.collapsedByPlacement,
          [action.placementId]: action.collapsed
        }
      };
    case "set_collapsed":
      return { ...state, collapsedByPlacement: action.collapsedByPlacement };
    case "set_interaction_mode":
      return { ...state, interactionMode: action.mode };
    case "set_draft":
      return {
        ...state,
        draftsByPlacement: {
          ...state.draftsByPlacement,
          [action.placementId]: action.draft
        }
      };
    case "clear_draft": {
      const next = { ...state.draftsByPlacement };
      delete next[action.placementId];
      return { ...state, draftsByPlacement: next };
    }
    case "set_clipboard":
      return { ...state, clipboard: action.clipboard };
    case "set_quick_actions_open":
      return { ...state, quickActionsOpen: action.open };
    default:
      return state;
  }
}

export function useNotepadUiState() {
  return useReducer(reducer, initialNotepadUiState);
}

export { initialNotepadUiState, reducer as notepadUiReducer };
export type { NotepadUiState, NotepadUiAction };

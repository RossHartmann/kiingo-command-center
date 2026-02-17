import type { AtomRecord, BlockRecord, ConditionRecord, PlacementRecord } from "../../lib/types";

export type OverlayMode = "person" | "task" | "date";

export interface FlatRow {
  placement: PlacementRecord;
  block: BlockRecord;
  atom?: AtomRecord;
  depth: number;
  hasChildren: boolean;
  descendantCount: number;
  collapsed: boolean;
  effectiveParentPlacementId?: string;
  overlay?: ConditionRecord;
}

export interface TreeData {
  flatRows: FlatRow[];
  rowByPlacementId: Record<string, FlatRow>;
  effectiveParentByPlacementId: Record<string, string | undefined>;
  childrenByParentKey: Record<string, string[]>;
  orderedPlacementIds: string[];
}

export interface ClipboardRow {
  blockId: string;
  sourcePlacementId: string;
  sourceViewId: string;
  mode: "copy" | "cut";
}

export const ROOT_KEY = "__root__";

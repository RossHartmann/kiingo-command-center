import type { AtomRecord } from "./types";

export function deriveTaskTitle(rawText: string): string {
  const first = rawText
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim();
  if (!first) {
    return "";
  }
  return first.replace(/^- \[[ xX]\]\s*/, "").replace(/^[-*]\s*/, "").trim().slice(0, 120);
}

export function taskDisplayTitle(
  atom: Pick<AtomRecord, "id" | "rawText">,
  fallback = "Untitled task"
): string {
  const derived = deriveTaskTitle(atom.rawText);
  if (derived.length > 0) {
    return derived;
  }
  return fallback;
}

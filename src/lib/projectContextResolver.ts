import type { AtomRecord, ProjectDefinition, RegistryEntry } from "./types";

export interface ProjectContextMatch {
  project: ProjectDefinition;
  matchedLabelIds: string[];
  score: number;
}

function buildRegistryAliasMap(entries: RegistryEntry[]): Map<string, string> {
  const aliasToId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.status !== "active") {
      continue;
    }
    aliasToId.set(entry.name.toLowerCase(), entry.id);
    for (const alias of entry.aliases) {
      const trimmed = alias.trim().toLowerCase();
      if (trimmed.length === 0) continue;
      aliasToId.set(trimmed, entry.id);
    }
  }
  return aliasToId;
}

export function resolveProjectContexts(
  atom: AtomRecord,
  projects: ProjectDefinition[],
  registryEntries: RegistryEntry[],
  max = 3
): ProjectContextMatch[] {
  if (projects.length === 0) {
    return [];
  }

  const aliasToId = buildRegistryAliasMap(registryEntries);
  const candidateIds = new Set<string>();
  for (const threadId of atom.relations.threadIds ?? []) {
    if (threadId.trim().length > 0) {
      candidateIds.add(threadId);
    }
  }
  for (const label of atom.facetData.meta?.labels ?? []) {
    const resolved = aliasToId.get(label.trim().toLowerCase());
    if (resolved) {
      candidateIds.add(resolved);
    }
  }
  for (const category of atom.facetData.meta?.categories ?? []) {
    const resolved = aliasToId.get(category.trim().toLowerCase());
    if (resolved) {
      candidateIds.add(resolved);
    }
  }

  if (candidateIds.size === 0) {
    return [];
  }

  const matches: ProjectContextMatch[] = [];
  for (const project of projects) {
    if (project.status !== "active" || project.labelIds.length === 0) {
      continue;
    }
    const matchedLabelIds = project.labelIds.filter((labelId) => candidateIds.has(labelId));
    if (matchedLabelIds.length === 0) {
      continue;
    }
    matches.push({
      project,
      matchedLabelIds,
      score: matchedLabelIds.length
    });
  }

  matches.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.project.name.localeCompare(b.project.name);
  });
  return matches.slice(0, Math.max(1, max));
}

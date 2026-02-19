import type { Screen } from "../../state/appState";
import type { NavOrderConfig } from "../../lib/types";

export interface NavItem {
  /** Screen ID for leaf items, or a unique string key for sub-group parents */
  id: string;
  label: string;
  icon: string;
  children?: NavItem[];
}

export interface NavGroup {
  id: string;
  label: string;
  icon: string;
  defaultExpanded?: boolean;
  items: NavItem[];
}

export const NAVIGATION: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "\u25A3",
    defaultExpanded: true,
    items: [{ id: "dashboard", label: "Dashboard", icon: "\u2302" }]
  },
  {
    id: "clients",
    label: "Clients",
    icon: "\u2731",
    defaultExpanded: true,
    items: [
      { id: "client-roi", label: "Client ROI", icon: "\u2736" },
      { id: "client-journey", label: "Client Journey", icon: "\u2794" },
      { id: "client-health", label: "Client Health", icon: "\u2665" }
    ]
  },
  {
    id: "path1",
    label: "Path 1: Augmentation",
    icon: "\u2191",
    items: [
      { id: "path1-bootcamps", label: "Bootcamps", icon: "\u2615" },
      { id: "path1-champions", label: "Champion Groups", icon: "\u2691" },
      { id: "path1-accelerator", label: "Accelerator", icon: "\u26A1" }
    ]
  },
  {
    id: "path2",
    label: "Path 2: AI Resources",
    icon: "\u2699",
    items: [
      { id: "path2-pipeline", label: "Agent Pipeline", icon: "\u25B7" },
      { id: "path2-deployed", label: "Deployed Agents", icon: "\u2713" },
      { id: "path2-fde", label: "FDE Utilization", icon: "\u2318" }
    ]
  },
  {
    id: "business",
    label: "Business",
    icon: "\u2197",
    items: [
      { id: "revenue", label: "Revenue", icon: "\u25C9" },
      { id: "growth", label: "Growth", icon: "\u2605" },
      { id: "efficiency", label: "Efficiency", icon: "\u2637" },
      { id: "pipeline", label: "Pipeline", icon: "\u25CE" },
      { id: "leads-gtm", label: "Leads & GTM", icon: "\u2709" }
    ]
  },
  {
    id: "departments",
    label: "Departments",
    icon: "\u2630",
    items: [
      {
        id: "sub:sales", label: "Sales", icon: "\u2197",
        children: [
          { id: "dept-sales", label: "Sales Dashboard", icon: "\u2197" },
          { id: "discovery-calls", label: "Discovery Calls", icon: "\u260E" },
          { id: "follow-up-calls", label: "Follow-up Calls", icon: "\u21BB" },
          { id: "sales-followup", label: "Follow-Up", icon: "\u2691" }
        ]
      },
      { id: "dept-marketing", label: "Marketing", icon: "\u2709" },
      { id: "dept-engineering", label: "Engineering", icon: "\u2318" },
      {
        id: "sub:operations", label: "Operations", icon: "\u2699",
        children: [
          { id: "dept-operations", label: "Ops Dashboard", icon: "\u2699" },
          { id: "ops-followup", label: "Follow-Up", icon: "\u2691" }
        ]
      }
    ]
  },
  {
    id: "team",
    label: "Team",
    icon: "\u2603",
    items: [
      { id: "team-scorecard", label: "Scorecard", icon: "\u2610" },
      { id: "team-rocks", label: "Rocks", icon: "\u25B2" },
      {
        id: "sub:principles", label: "Principles", icon: "\u2696",
        children: [
          { id: "coo-principles", label: "COO Principles", icon: "\u2699" },
          { id: "cmo-principles", label: "CMO Principles", icon: "\u2709" },
          { id: "cro-principles", label: "CRO Principles", icon: "\u2197" },
          { id: "cto-principles", label: "CTO Principles", icon: "\u2318" },
          { id: "cfo-principles", label: "CFO Principles", icon: "\u25C9" },
          { id: "cpo-principles", label: "CPO Principles", icon: "\u25A3" },
          { id: "cco-principles", label: "CCO Principles", icon: "\u2665" },
          { id: "chro-principles", label: "CHRO Principles", icon: "\u2603" }
        ]
      }
    ]
  },
  {
    id: "workspace",
    label: "The Workspace",
    icon: "\u270E",
    defaultExpanded: true,
    items: [
      { id: "projects", label: "Projects", icon: "\u25C8" },
      { id: "notepad", label: "Notepads", icon: "\u270E" },
      { id: "tasks", label: "Tasks", icon: "\u2611" }
    ]
  },
  {
    id: "ai-agent",
    label: "AI Agent",
    icon: "\u2726",
    defaultExpanded: true,
    items: [
      { id: "chat", label: "Chat", icon: "\u2709" },
      { id: "composer", label: "Composer", icon: "\u270E" },
      { id: "live", label: "Live Run", icon: "\u25B6" },
      { id: "history", label: "History", icon: "\u29D6" },
      { id: "queue", label: "Queue", icon: "\u2630" }
    ]
  },
  {
    id: "ceo-training",
    label: "CEO Training Ground",
    icon: "\u2691",
    items: [
      { id: "ceo-training", label: "Training Ground", icon: "\u2691" },
      { id: "ceo-principles", label: "Principles", icon: "\u2696" }
    ]
  },
  {
    id: "system",
    label: "System",
    icon: "\u2388",
    items: [
      { id: "settings", label: "Settings", icon: "\u2699" },
      { id: "profiles", label: "Profiles", icon: "\u2603" },
      { id: "compatibility", label: "Compatibility", icon: "\u2713" },
      { id: "metric-admin", label: "Metrics", icon: "\u25C8" }
    ]
  }
];

export interface ScreenMeta {
  title: string;
  description: string;
  group: string;
}

export const SCREEN_META: Record<Screen, ScreenMeta> = {
  dashboard: { title: "Dashboard", description: "North star metrics and company-wide KPIs", group: "overview" },

  "client-roi": { title: "Client ROI", description: "10x ROI tracking per client and aggregate trends", group: "clients" },
  "client-journey": { title: "Client Journey", description: "Strategy session to bootcamp to champion to AI resources", group: "clients" },
  "client-health": { title: "Client Health", description: "Retention, expansion, satisfaction, and churn risk", group: "clients" },

  "path1-bootcamps": { title: "Bootcamps", description: "Enrollment, graduation, and 30-day implementation rate", group: "path1" },
  "path1-champions": { title: "Champion Groups", description: "Seats, retention, active Momentum Cycles, and documented outcomes", group: "path1" },
  "path1-accelerator": { title: "Accelerator", description: "Seats, retention, and engagement trends", group: "path1" },

  "path2-pipeline": { title: "Agent Pipeline", description: "Discovery, scoping, build, and deploy funnel", group: "path2" },
  "path2-deployed": { title: "Deployed Agents", description: "Performance, uptime, and per-agent ROI", group: "path2" },
  "path2-fde": { title: "FDE Utilization", description: "Capacity, active engagements, and client satisfaction", group: "path2" },

  revenue: { title: "Revenue", description: "MRR breakdown by offering, trending toward targets", group: "business" },
  growth: { title: "Growth", description: "Acquisition, retention, and expansion metrics", group: "business" },
  efficiency: { title: "Efficiency", description: "Burn rate, unit economics, and margins", group: "business" },
  pipeline: { title: "Pipeline", description: "Sales opportunities, conversion rates, and deal velocity", group: "business" },
  "leads-gtm": { title: "Leads & GTM", description: "Volume by channel: Vistage, events, partnerships, digital", group: "business" },

  "dept-sales": { title: "Sales Dashboard", description: "Quota attainment, deal velocity, and pipeline health", group: "departments" },
  "discovery-calls": { title: "Discovery Calls", description: "Track and analyze sales discovery call pipeline and outcomes", group: "departments" },
  "follow-up-calls": { title: "Follow-up Calls", description: "Track and analyze sales follow-up call activity and conversion", group: "departments" },
  "sales-followup": { title: "Follow-Up", description: "Pipeline follow-up health snapshot and daily trends", group: "departments" },
  "dept-marketing": { title: "Marketing", description: "Brand reach, proof amplification, and campaign ROI", group: "departments" },
  "dept-engineering": { title: "Engineering", description: "Velocity, reliability, and delivery cadence", group: "departments" },
  "dept-operations": { title: "Operations", description: "Bootcamp delivery, program ops, and capacity", group: "departments" },
  "ops-followup": { title: "Ops Follow-Up", description: "Operations pipeline follow-up health and trends", group: "departments" },

  "team-scorecard": { title: "Scorecard", description: "Company scorecard with owner-level accountability metrics", group: "team" },
  "team-rocks": { title: "Rocks", description: "Quarterly priorities and progress", group: "team" },
  "coo-principles": { title: "COO Principles", description: "Operational principles for execution leadership", group: "team" },
  "cmo-principles": { title: "CMO Principles", description: "Marketing principles for revenue-driven growth", group: "team" },
  "cro-principles": { title: "CRO Principles", description: "Revenue leadership principles for predictable growth", group: "team" },
  "cto-principles": { title: "CTO Principles", description: "Technology leadership principles for engineering excellence", group: "team" },
  "cfo-principles": { title: "CFO Principles", description: "Financial leadership principles for capital stewardship", group: "team" },
  "cpo-principles": { title: "CPO Principles", description: "Product leadership principles for user-centered impact", group: "team" },
  "cco-principles": { title: "CCO Principles", description: "Customer success principles for retention and expansion", group: "team" },
  "chro-principles": { title: "CHRO Principles", description: "People leadership principles for culture and talent", group: "team" },

  projects: { title: "Projects", description: "Project contexts mapped to default notepad views", group: "workspace" },
  notepad: { title: "Notepads", description: "Dynalist-style notepad views over shared workspace blocks", group: "workspace" },
  tasks: { title: "Tasks", description: "Task projection across the workspace", group: "workspace" },

  chat: { title: "Chat", description: "AI coding assistant chat", group: "ai-agent" },
  composer: { title: "Composer", description: "Compose and launch runs", group: "ai-agent" },
  live: { title: "Live Run", description: "Monitor running sessions", group: "ai-agent" },
  history: { title: "History", description: "Past runs and results", group: "ai-agent" },
  queue: { title: "Queue", description: "Scheduled and queued jobs", group: "ai-agent" },

  "ceo-training": { title: "CEO Training Ground", description: "CEO-focused training scenarios and simulations", group: "ceo-training" },
  "ceo-principles": { title: "CEO Principles", description: "Core operating principles and decision frameworks", group: "ceo-training" },

  settings: { title: "Settings", description: "Workspace and app configuration", group: "system" },
  profiles: { title: "Profiles", description: "Manage provider profiles", group: "system" },
  compatibility: { title: "Compatibility", description: "Provider compatibility checks", group: "system" },
  "metric-admin": { title: "Metrics", description: "Define, bind, and manage dashboard metrics", group: "system" }
};

function itemContainsScreen(item: NavItem, screen: Screen): boolean {
  if (item.id === screen) return true;
  if (item.children) return item.children.some((child) => itemContainsScreen(child, screen));
  return false;
}

export function findGroupForScreen(screen: Screen): string | undefined {
  for (const group of NAVIGATION) {
    if (group.items.some((item) => itemContainsScreen(item, screen))) {
      return group.id;
    }
  }
  return undefined;
}

/** Find the sub-group item ID that contains the given screen, if any */
export function findSubGroupForScreen(screen: Screen): string | undefined {
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      if (item.children && item.children.some((child) => child.id === screen)) {
        return item.id;
      }
    }
  }
  return undefined;
}

/** Reorder children within sub-group items using itemOrder keyed by the sub-group's id */
function reorderChildren(group: NavGroup, order: NavOrderConfig): NavGroup {
  const items = group.items.map((item) => {
    if (!item.children) return item;
    const childOrder = order.itemOrder[item.id];
    if (!childOrder || childOrder.length === 0) return item;
    const childMap = new Map(item.children.map((c) => [c.id, c]));
    const ordered: NavItem[] = [];
    for (const id of childOrder) {
      const child = childMap.get(id);
      if (child) {
        ordered.push(child);
        childMap.delete(id);
      }
    }
    for (const child of childMap.values()) {
      ordered.push(child);
    }
    return { ...item, children: ordered };
  });
  return { ...group, items };
}

export function applyNavOrder(order: NavOrderConfig | undefined): NavGroup[] {
  if (!order) {
    return NAVIGATION;
  }

  const groupMap = new Map<string, NavGroup>();
  for (const group of NAVIGATION) {
    groupMap.set(group.id, group);
  }

  // Reorder items within each group (and children within sub-groups)
  const reorderedGroups = new Map<string, NavGroup>();
  for (const [groupId, group] of groupMap) {
    const itemOrder = order.itemOrder[groupId];
    if (!itemOrder || itemOrder.length === 0) {
      reorderedGroups.set(groupId, reorderChildren(group, order));
      continue;
    }
    const itemMap = new Map(group.items.map((item) => [item.id, item]));
    const ordered: NavItem[] = [];
    for (const id of itemOrder) {
      const item = itemMap.get(id);
      if (item) {
        ordered.push(item);
        itemMap.delete(id);
      }
    }
    // Append any items not in the stored order (new items added after order was saved)
    for (const item of itemMap.values()) {
      ordered.push(item);
    }
    reorderedGroups.set(groupId, reorderChildren({ ...group, items: ordered }, order));
  }

  // Reorder groups
  if (!order.groupOrder || order.groupOrder.length === 0) {
    return [...reorderedGroups.values()];
  }

  const result: NavGroup[] = [];
  for (const groupId of order.groupOrder) {
    const group = reorderedGroups.get(groupId);
    if (group) {
      result.push(group);
      reorderedGroups.delete(groupId);
    }
  }
  // Append any groups not in the stored order
  for (const group of reorderedGroups.values()) {
    result.push(group);
  }
  return result;
}

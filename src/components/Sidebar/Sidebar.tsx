import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppActions, useAppState, type Screen } from "../../state/appState";
import { ThemeSwitcher } from "../../ThemeSwitcher";
import { NAVIGATION, applyNavOrder, findGroupForScreen, findSubGroupForScreen, type NavGroup, type NavItem } from "./navigationConfig";
import type { NavOrderConfig } from "../../lib/types";

const COLLAPSED_KEY = "sidebar-collapsed-groups";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw) {
      return new Set(JSON.parse(raw) as string[]);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function persistCollapsed(collapsed: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Sortable wrapper for a leaf nav item
// ---------------------------------------------------------------------------
function SortableItem({
  item,
  isActive,
  onNavigate,
  nested
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate: (screen: Screen) => void;
  nested?: boolean;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      className={`sidebar-item${isActive ? " active" : ""}${nested ? " nested" : ""}`}
      onClick={() => onNavigate(item.id as Screen)}
      {...attributes}
    >
      <span className="sidebar-drag-handle" {...listeners}>{"\u2261"}</span>
      <span className="sidebar-item-icon">{item.icon}</span>
      <span>{item.label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sortable sub-group (an item with children)
// ---------------------------------------------------------------------------
function SortableSubGroup({
  item,
  activeScreen,
  isSubCollapsed,
  onToggleSubGroup,
  onNavigate,
  onChildReorder
}: {
  item: NavItem;
  activeScreen: Screen;
  isSubCollapsed: boolean;
  onToggleSubGroup: (id: string) => void;
  onNavigate: (screen: Screen) => void;
  onChildReorder: (subGroupId: string, oldIndex: number, newIndex: number) => void;
}): JSX.Element {
  const children = item.children!;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined
  };

  const hasActive = children.some((child) => child.id === activeScreen);
  const childIds = useMemo(() => children.map((c) => c.id), [children]);

  const childSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleChildDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = children.findIndex((c) => c.id === active.id);
    const newIndex = children.findIndex((c) => c.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      onChildReorder(item.id, oldIndex, newIndex);
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="sidebar-subgroup" {...attributes}>
      <button
        type="button"
        className={`sidebar-subgroup-header${hasActive ? " has-active" : ""}`}
        onClick={() => onToggleSubGroup(item.id)}
      >
        <span className="sidebar-drag-handle" {...listeners}>{"\u2261"}</span>
        <span className="sidebar-item-icon">{item.icon}</span>
        <span className="sidebar-subgroup-label">{item.label}</span>
        <span className={`sidebar-subgroup-chevron${isSubCollapsed ? "" : " open"}`}>{"\u203A"}</span>
      </button>
      {!isSubCollapsed && (
        <DndContext
          sensors={childSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleChildDragEnd}
        >
          <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
            <div className="sidebar-subgroup-items">
              {children.map((child) => (
                <SortableItem
                  key={child.id}
                  item={child}
                  isActive={child.id === activeScreen}
                  onNavigate={onNavigate}
                  nested
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable wrapper for a nav group
// ---------------------------------------------------------------------------
function SortableGroup({
  group,
  isCollapsed,
  collapsed,
  activeScreen,
  onToggle,
  onToggleSubGroup,
  onNavigate,
  onItemReorder,
  onChildReorder
}: {
  group: NavGroup;
  isCollapsed: boolean;
  collapsed: Set<string>;
  activeScreen: Screen;
  onToggle: (id: string) => void;
  onToggleSubGroup: (id: string) => void;
  onNavigate: (screen: Screen) => void;
  onItemReorder: (groupId: string, oldIndex: number, newIndex: number) => void;
  onChildReorder: (subGroupId: string, oldIndex: number, newIndex: number) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined
  };

  const hasActive = group.items.some((item) =>
    item.id === activeScreen || (item.children && item.children.some((c) => c.id === activeScreen))
  );
  const itemIds = useMemo(() => group.items.map((item) => item.id), [group.items]);

  const itemSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleItemDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = group.items.findIndex((item) => item.id === active.id);
    const newIndex = group.items.findIndex((item) => item.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      onItemReorder(group.id, oldIndex, newIndex);
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="sidebar-group" {...attributes}>
      <button
        type="button"
        className={`sidebar-group-header${hasActive ? " has-active" : ""}`}
        onClick={() => onToggle(group.id)}
      >
        <span className="sidebar-drag-handle" {...listeners}>{"\u2261"}</span>
        <span className="sidebar-group-icon">{group.icon}</span>
        <span className="sidebar-group-label">{group.label}</span>
        <span className={`sidebar-chevron${isCollapsed ? "" : " open"}`}>{"\u203A"}</span>
      </button>
      {!isCollapsed && (
        <DndContext
          sensors={itemSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleItemDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="sidebar-group-items">
              {group.items.map((item) =>
                item.children ? (
                  <SortableSubGroup
                    key={item.id}
                    item={item}
                    activeScreen={activeScreen}
                    isSubCollapsed={collapsed.has(item.id)}
                    onToggleSubGroup={onToggleSubGroup}
                    onNavigate={onNavigate}
                    onChildReorder={onChildReorder}
                  />
                ) : (
                  <SortableItem
                    key={item.id}
                    item={item}
                    isActive={item.id === activeScreen}
                    onNavigate={onNavigate}
                  />
                )
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main sidebar
// ---------------------------------------------------------------------------
interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const stored = loadCollapsed();
    const initial = new Set(stored);
    for (const group of NAVIGATION) {
      if (group.defaultExpanded && !stored.has(group.id)) {
        initial.delete(group.id);
      }
    }
    return initial;
  });

  const navOrder = state.settings?.navOrder;
  const orderedNav = useMemo(() => applyNavOrder(navOrder), [navOrder]);
  const groupIds = useMemo(() => orderedNav.map((g) => g.id), [orderedNav]);

  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const draggingGroup = useMemo(
    () => (draggingGroupId ? orderedNav.find((g) => g.id === draggingGroupId) ?? null : null),
    [draggingGroupId, orderedNav]
  );

  // Auto-expand the group (and sub-group) containing the active screen
  useEffect(() => {
    const activeGroup = findGroupForScreen(state.selectedScreen);
    const activeSubGroup = findSubGroupForScreen(state.selectedScreen);
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      if (activeGroup && next.has(activeGroup)) {
        next.delete(activeGroup);
        changed = true;
      }
      if (activeSubGroup && next.has(activeSubGroup)) {
        next.delete(activeSubGroup);
        changed = true;
      }
      if (changed) {
        persistCollapsed(next);
        return next;
      }
      return prev;
    });
  }, [state.selectedScreen]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      persistCollapsed(next);
      return next;
    });
  }, []);

  function navigate(screen: Screen): void {
    actions.selectScreen(screen);
    onMobileClose();
  }

  // Persist the full nav order from the current groups array
  function saveNavOrder(groups: NavGroup[]): void {
    const groupOrder = groups.map((g) => g.id);
    const itemOrder: Record<string, string[]> = {};
    for (const group of groups) {
      itemOrder[group.id] = group.items.map((item) => item.id);
      // Also persist child orders for sub-groups
      for (const item of group.items) {
        if (item.children) {
          itemOrder[item.id] = item.children.map((c) => c.id);
        }
      }
    }
    const order: NavOrderConfig = { groupOrder, itemOrder };
    void actions.updateSettings({ navOrder: order });
  }

  // --- Group-level DnD ---
  const groupSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleGroupDragStart(event: DragStartEvent): void {
    setDraggingGroupId(event.active.id as string);
  }

  function handleGroupDragEnd(event: DragEndEvent): void {
    setDraggingGroupId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedNav.findIndex((g) => g.id === active.id);
    const newIndex = orderedNav.findIndex((g) => g.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove([...orderedNav], oldIndex, newIndex);
      saveNavOrder(reordered);
    }
  }

  // --- Item-level reorder callback (called from within SortableGroup) ---
  function handleItemReorder(groupId: string, oldIndex: number, newIndex: number): void {
    const groups = orderedNav.map((g) =>
      g.id === groupId ? { ...g, items: arrayMove([...g.items], oldIndex, newIndex) } : g
    );
    saveNavOrder(groups);
  }

  // --- Sub-group child reorder callback ---
  function handleChildReorder(subGroupId: string, oldIndex: number, newIndex: number): void {
    const groups = orderedNav.map((g) => ({
      ...g,
      items: g.items.map((item) =>
        item.id === subGroupId && item.children
          ? { ...item, children: arrayMove([...item.children], oldIndex, newIndex) }
          : item
      )
    }));
    saveNavOrder(groups);
  }

  return (
    <>
      {mobileOpen && <div className="sidebar-overlay" onClick={onMobileClose} />}
      <aside className={`sidebar${mobileOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-header">
          <span className="sidebar-logo">{"K"}</span>
          <span className="sidebar-brand">Kiingo</span>
        </div>

        <nav className="sidebar-nav">
          <DndContext
            sensors={groupSensors}
            collisionDetection={closestCenter}
            onDragStart={handleGroupDragStart}
            onDragEnd={handleGroupDragEnd}
          >
            <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
              {orderedNav.map((group) => (
                <SortableGroup
                  key={group.id}
                  group={group}
                  isCollapsed={collapsed.has(group.id)}
                  collapsed={collapsed}
                  activeScreen={state.selectedScreen}
                  onToggle={toggleGroup}
                  onToggleSubGroup={toggleGroup}
                  onNavigate={navigate}
                  onItemReorder={handleItemReorder}
                  onChildReorder={handleChildReorder}
                />
              ))}
            </SortableContext>
            <DragOverlay>
              {draggingGroup ? (
                <div className="sidebar-group drag-overlay">
                  <div className="sidebar-group-header">
                    <span className="sidebar-drag-handle">{"\u2261"}</span>
                    <span className="sidebar-group-icon">{draggingGroup.icon}</span>
                    <span className="sidebar-group-label">{draggingGroup.label}</span>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </nav>

        <div className="sidebar-footer">
          <ThemeSwitcher />
        </div>
      </aside>
    </>
  );
}

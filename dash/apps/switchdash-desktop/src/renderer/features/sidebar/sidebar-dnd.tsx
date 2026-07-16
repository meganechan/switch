import {
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Drag-to-reorder plumbing for the grouped sidebar views.
 *
 * Every draggable carries a composite id `${containerId}~~${itemId}`. The
 * container id identifies the sibling set an item belongs to (e.g. the
 * top-level agents, the top-level rooms, or one group's sessions); reordering
 * is restricted to within a container so a drag can only change order, never
 * move an item into a different section.
 */
const SEP = '~~';

export function makeDndId(containerId: string, itemId: string): string {
  return `${containerId}${SEP}${itemId}`;
}

export function parseDndId(dndId: string): { containerId: string; itemId: string } | null {
  const idx = dndId.indexOf(SEP);
  if (idx === -1) return null;
  return { containerId: dndId.slice(0, idx), itemId: dndId.slice(idx + SEP.length) };
}

/**
 * Collision detection that only considers droppables in the same container as
 * the active item, so a drag can only land among its own siblings.
 */
const sameContainerCollision: CollisionDetection = (args) => {
  const active = parseDndId(String(args.active.id));
  if (!active) return [];
  const droppableContainers = args.droppableContainers.filter((container) => {
    const parsed = parseDndId(String(container.id));
    return parsed?.containerId === active.containerId;
  });
  return closestCenter({ ...args, droppableContainers });
};

/**
 * Build the props for the grouped views' single `DndContext`. `containers` maps
 * each container id to its current ordered item ids (populated during render);
 * on drop, the within-container `arrayMove` result is handed to `onReorder`.
 */
export function useSidebarDnd(
  containers: Record<string, string[]>,
  onReorder: (containerId: string, orderedItemIds: string[]) => void
) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = parseDndId(String(active.id));
    const to = parseDndId(String(over.id));
    if (!from || !to || from.containerId !== to.containerId) return;
    const ids = containers[from.containerId];
    if (!ids) return;
    const oldIndex = ids.indexOf(from.itemId);
    const newIndex = ids.indexOf(to.itemId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    onReorder(from.containerId, arrayMove(ids, oldIndex, newIndex));
  }

  return { sensors, collisionDetection: sameContainerCollision, onDragEnd };
}

function useSortableRow(id: string) {
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    position: 'relative',
    zIndex: isDragging ? 1 : undefined,
  };
  return { setNodeRef, style, listeners };
}

/**
 * A leaf draggable: the whole row is the drag handle. Use for rows with no
 * nested draggables (sessions).
 */
export function SortableLeaf({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, style, listeners } = useSortableRow(id);
  return (
    <div ref={setNodeRef} style={style} {...listeners}>
      {children}
    </div>
  );
}

/**
 * A branch draggable: only `header` is the drag handle, while `children`
 * (nested rows, which may be draggable in their own container) move with it but
 * do not start the branch's drag. Use for section rows (agents, rooms).
 */
export function SortableBranch({
  id,
  header,
  children,
}: {
  id: string;
  header: ReactNode;
  children?: ReactNode;
}) {
  const { setNodeRef, style, listeners } = useSortableRow(id);
  return (
    <div ref={setNodeRef} style={style}>
      <div {...listeners}>{header}</div>
      {children}
    </div>
  );
}

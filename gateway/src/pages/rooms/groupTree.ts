// Shared helpers for the room-group tree, used by the rooms list, the room
// detail group picker, the groups manager, and the room graph colouring.
//
// Generic over any node carrying {id, name, color, parent_group_id} so both
// RoomGroupDetail (gateway CRUD) and RoomGraphGroup (graph payload) work.

export interface GroupNode {
  id: string;
  name: string;
  color: string | null;
  parent_group_id: string | null;
}

// A calm, reasonably distinct palette for groups without an explicit colour.
// Deterministically assigned by top-level ancestor id so a branch keeps one hue.
const PALETTE = [
  "#7EB6FF",
  "#7FD1A4",
  "#B69EE6",
  "#F2B880",
  "#E58F8F",
  "#6FD0D6",
  "#D4A5C7",
  "#C7D47E",
];

export function buildGroupIndex<T extends GroupNode>(groups: T[]): Map<string, T> {
  const byId = new Map<string, T>();
  for (const g of groups) byId.set(g.id, g);
  return byId;
}

/** Root-first chain including the group itself. Guards against cycles. */
export function ancestorChain<T extends GroupNode>(
  groupId: string,
  byId: Map<string, T>,
): T[] {
  const chain: T[] = [];
  const seen = new Set<string>();
  let cur: string | null = groupId;
  while (cur && !seen.has(cur)) {
    const g = byId.get(cur);
    if (!g) break;
    chain.push(g);
    seen.add(cur);
    cur = g.parent_group_id;
  }
  return chain.reverse();
}

export function topAncestor<T extends GroupNode>(
  groupId: string,
  byId: Map<string, T>,
): T | null {
  return ancestorChain(groupId, byId)[0] ?? null;
}

/** Human-readable path for a group, e.g. "Parent / Child / Leaf". */
export function groupPathName<T extends GroupNode>(
  groupId: string,
  byId: Map<string, T>,
): string {
  const chain = ancestorChain(groupId, byId);
  if (chain.length === 0) return "";
  return chain.map((g) => g.name).join(" / ");
}

/** 0 for a top-level group, 1 for its children, etc. */
export function groupDepth<T extends GroupNode>(
  groupId: string,
  byId: Map<string, T>,
): number {
  return Math.max(0, ancestorChain(groupId, byId).length - 1);
}

function paletteColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * Effective colour for a group: the nearest explicit colour walking from the
 * group up to the root, else a deterministic palette colour keyed on the
 * top-level ancestor (so a whole branch shares a hue by default).
 */
export function effectiveColor<T extends GroupNode>(
  groupId: string,
  byId: Map<string, T>,
): string {
  const chain = ancestorChain(groupId, byId); // root → group
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = chain[i].color;
    if (c) return c;
  }
  return paletteColor(chain[0]?.id ?? groupId);
}

/**
 * Colour keyed strictly on the top-level ancestor — used by the graph so an
 * entire branch shares one hue regardless of per-subgroup colours.
 */
export function branchColor<T extends GroupNode>(
  groupId: string,
  byId: Map<string, T>,
): string {
  const top = topAncestor(groupId, byId);
  return top ? effectiveColor(top.id, byId) : paletteColor(groupId);
}

/**
 * Groups sorted into depth-first tree order (parents before children, siblings
 * by name), each annotated with its depth — handy for indented selects/lists.
 */
export function flattenTree<T extends GroupNode>(
  groups: T[],
): Array<{ group: T; depth: number }> {
  const byParent = new Map<string | null, T[]>();
  for (const g of groups) {
    const arr = byParent.get(g.parent_group_id) ?? [];
    arr.push(g);
    byParent.set(g.parent_group_id, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  const out: Array<{ group: T; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const g of byParent.get(parentId) ?? []) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({ group: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  // Defensive: surface any groups orphaned by a dangling parent ref.
  for (const g of groups) {
    if (!seen.has(g.id)) out.push({ group: g, depth: 0 });
  }
  return out;
}

import { CHILD_SLOT_SELECTOR, SELF_PLACING_PARENTS } from '../../tools/nested-blocks';

/**
 * What the home-slot rule needs to know about a block. `holder` is optional
 * because saver unit fixtures pass partial stubs.
 */
export interface HomeSlotBlock {
  holder: Element | undefined;
  name: string;
  parentId: string | null;
}

/**
 * Where a child of some parent belongs in the DOM.
 * - `slot`: directly in this child slot.
 * - `root`: directly in the editor's working area.
 * - `self-placing`: a table/database places it (per cell / per view).
 * - `unassessable`: an ancestor on the walk has no holder.
 */
export type HomeSlot =
  | { kind: 'slot'; slot: Element }
  | { kind: 'root' }
  | { kind: 'self-placing' }
  | { kind: 'unassessable' };

/**
 * The home of a child of `parentId`: the child slot of the nearest ancestor
 * (from `parentId` up) that owns one. A slotless block's children sit flat
 * after it, in that same slot. A missing ancestor or a parent cycle reads as root.
 *
 * `querySelector` finds the ancestor's OWN slot: any deeper slot lives inside it,
 * so it comes later in document order.
 * @param parentId - the (prospective) parent id
 * @param getBlock - block lookup by id
 */
export const resolveHomeSlot = (
  parentId: string | null,
  getBlock: (id: string) => HomeSlotBlock | undefined
): HomeSlot => {
  const walk = (cursor: string | null, visited: Set<string>): HomeSlot => {
    if (cursor === null || visited.has(cursor)) {
      return { kind: 'root' };
    }
    visited.add(cursor);

    const ancestor = getBlock(cursor);

    if (ancestor === undefined) {
      return { kind: 'root' };
    }

    if (ancestor.holder === undefined) {
      return { kind: 'unassessable' };
    }

    if (SELF_PLACING_PARENTS.has(ancestor.name)) {
      return { kind: 'self-placing' };
    }

    const slot = ancestor.holder.querySelector(CHILD_SLOT_SELECTOR);

    return slot !== null ? { kind: 'slot', slot } : walk(ancestor.parentId, visited);
  };

  return walk(parentId, new Set<string>());
};

/**
 * The home slot element BlockHierarchy mounts into, or null for root and for
 * blocks a table/database places. A DIRECT table/database parent still returns
 * its first slot (its first cell). placeBlock never moves a block between a
 * table's cells; only setBlockParent uses this slot, for a holder that is in
 * none of the table's cells.
 * @param parentId - the (prospective) parent id
 * @param getBlock - block lookup by id
 */
export const homeSlotElement = (
  parentId: string | null,
  getBlock: (id: string) => HomeSlotBlock | undefined
): Element | null => {
  const parent = parentId !== null ? getBlock(parentId) : undefined;

  if (parent?.holder !== undefined && SELF_PLACING_PARENTS.has(parent.name)) {
    return parent.holder.querySelector(CHILD_SLOT_SELECTOR);
  }

  const home = resolveHomeSlot(parentId, getBlock);

  return home.kind === 'slot' ? home.slot : null;
};

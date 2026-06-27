import type { BlockToolData } from '../../types/tools';

/** A plain, serializable view of one block in the tree. */
export interface BlockNode {
  id: string;
  type: string;
  parentId: string | null;
  contentIds: readonly string[];
}

/** Where to place a block among its siblings. */
export type InsertPosition = 'start' | 'end' | { before: string } | { after: string };

export interface InsertSpec {
  type?: string;
  data?: BlockToolData;
  parentId?: string | null;
  position?: InsertPosition;
}

export type MoveTarget = { before: string } | { after: string } | { toIndex: number };

export interface UseBlocksApi {
  getById(id: string): BlockNode | null;
  getChildren(parentId: string | null): BlockNode[];
  insert(spec?: InsertSpec): BlockNode | null;
  move(id: string, target: MoveTarget): void;
  nest(id: string, parentId: string): void;
  unnest(id: string): void;
  remove(id: string): void;
  transact(fn: () => void): void;
}

/** The minimal slice of editor.blocks that the snapshot helpers read. */
export interface BlocksReader {
  getBlocksCount(): number;
  getBlockByIndex(index: number): { id: string; name: string; parentId: string | null } | undefined;
}

/**
 * Enumerate the editor's blocks once into BlockNode records, in flat order,
 * deriving each node's contentIds from the children that name it as parent.
 */
export const snapshotNodes = (reader: BlocksReader): BlockNode[] => {
  const flat: Array<{ id: string; type: string; parentId: string | null }> = [];
  const count = reader.getBlocksCount();

  for (let i = 0; i < count; i++) {
    const b = reader.getBlockByIndex(i);

    if (b === undefined) {
      continue;
    }
    flat.push({ id: b.id, type: b.name, parentId: b.parentId });
  }

  const childrenByParent = new Map<string, string[]>();

  for (const b of flat) {
    if (b.parentId === null) {
      continue;
    }
    const bucket = childrenByParent.get(b.parentId) ?? [];

    bucket.push(b.id);
    childrenByParent.set(b.parentId, bucket);
  }

  return flat.map((b) => ({
    id: b.id,
    type: b.type,
    parentId: b.parentId,
    contentIds: childrenByParent.get(b.id) ?? [],
  }));
};

/** BlocksReader plus id→flat-index lookup. */
export interface IndexReader extends BlocksReader {
  getBlockIndex(id: string): number | undefined;
}

/** Flat indices of a parent's direct children, ascending. Empty if none. */
const childFlatIndices = (reader: IndexReader, parentId: string): number[] => {
  const out: number[] = [];
  const count = reader.getBlocksCount();

  for (let i = 0; i < count; i++) {
    const b = reader.getBlockByIndex(i);

    if (b !== undefined && b.parentId === parentId) {
      out.push(i);
    }
  }

  return out;
};

/** Map of block id -> parentId, in flat order. */
const parentMap = (reader: IndexReader): Map<string, string | null> => {
  const map = new Map<string, string | null>();
  const count = reader.getBlocksCount();

  for (let i = 0; i < count; i++) {
    const b = reader.getBlockByIndex(i);

    if (b !== undefined) {
      map.set(b.id, b.parentId);
    }
  }

  return map;
};

/** True if `id` descends from `ancestorId` via the parentId chain. */
const isDescendantOf = (
  parentOf: Map<string, string | null>,
  id: string,
  ancestorId: string
): boolean => {
  let current = parentOf.get(id) ?? null;

  while (current !== null) {
    if (current === ancestorId) {
      return true;
    }
    current = parentOf.get(current) ?? null;
  }

  return false;
};

/** The flat index at which a new block should be inserted. */
export const resolveInsertIndex = (
  reader: IndexReader,
  parentId: string | null,
  position: InsertPosition
): number => {
  if (typeof position === 'object') {
    const ref = 'before' in position ? position.before : position.after;
    const refIndex = reader.getBlockIndex(ref);

    if (refIndex === undefined) {
      return reader.getBlocksCount();
    }

    return 'before' in position ? refIndex : refIndex + 1;
  }

  if (parentId === null) {
    return position === 'start' ? 0 : reader.getBlocksCount();
  }

  const parentIndex = reader.getBlockIndex(parentId);

  if (parentIndex === undefined) {
    return reader.getBlocksCount();
  }

  if (position === 'start') {
    const childIndices = childFlatIndices(reader, parentId);

    return childIndices.length === 0 ? parentIndex + 1 : childIndices[0];
  }

  // 'end': insert after the parent's last descendant. In flat (DFS) order,
  // a parent's descendants are contiguous immediately after it.
  const parentOf = parentMap(reader);
  const count = reader.getBlocksCount();
  let last = parentIndex;

  for (let i = parentIndex + 1; i < count; i++) {
    const b = reader.getBlockByIndex(i);

    if (b === undefined || !isDescendantOf(parentOf, b.id, parentId)) {
      break;
    }
    last = i;
  }

  return last + 1;
};

/** The flat toIndex for editor.blocks.move. */
export const resolveMoveIndex = (reader: IndexReader, target: MoveTarget): number => {
  if ('toIndex' in target) {
    return target.toIndex;
  }

  const ref = 'before' in target ? target.before : target.after;
  const refIndex = reader.getBlockIndex(ref);

  if (refIndex === undefined) {
    return reader.getBlocksCount();
  }

  return 'before' in target ? refIndex : refIndex + 1;
};

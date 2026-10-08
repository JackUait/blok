import type { PlacementRefusalReason } from '../../../types/agent';
import type { DocSnapshot } from './snapshot';

export interface ContainerFacts {
  accepts: boolean;
  allow?: string[];
  deny?: string[];
  ownedByTool: boolean;
}

export interface PlacementTree {
  parentOf(id: string): string | null;
  typeOf(id: string): string;
  cellOf(id: string, asParent: boolean): unknown;
  containerFacts(id: string): ContainerFacts;
  restrictedInCell(type: string): boolean;
}

export type RefusalReason = PlacementRefusalReason | 'COLUMN_BOUNDARY';

export interface Refusal {
  reason: RefusalReason;
  message: string;
  allowed?: string[];
}

const nameOf = (parentId: string | null): string => parentId === null ? 'the root' : `"${parentId}"`;

const isColumnPart = (type: string): boolean => type === 'column' || type === 'column_list';

const isUnder = (tree: PlacementTree, id: string, ancestorId: string): boolean => {
  const walk = (cursor: string | null, seen: Set<string>): boolean => {
    if (cursor === null || seen.has(cursor)) {
      return false;
    }

    return cursor === ancestorId || walk(tree.parentOf(cursor), seen.add(cursor));
  };

  return walk(tree.parentOf(id), new Set<string>());
};

export const satisfiesChildTools = (
  allow: string[] | undefined,
  deny: string[] | undefined,
  type: string
): boolean => {
  if (deny?.includes(type) === true) {
    return false;
  }

  return !Array.isArray(allow) || allow.length === 0 || allow.includes(type);
};

export const checkChildType = (
  tree: PlacementTree,
  parentId: string | null,
  type: string
): Refusal | null => {
  if (parentId === null) {
    return null;
  }

  const facts = tree.containerFacts(parentId);

  if (!facts.accepts) {
    return { reason: 'TAKES_NO_CHILDREN', message: `${nameOf(parentId)} takes no children` };
  }
  if (!satisfiesChildTools(facts.allow, facts.deny, type)) {
    return {
      reason: 'CHILD_NOT_ALLOWED',
      message: `${nameOf(parentId)} does not allow "${type}" children`,
      ...(facts.allow !== undefined && facts.allow.length > 0 && { allowed: [...facts.allow] }),
    };
  }
  if (tree.cellOf(parentId, true) !== null && tree.restrictedInCell(type)) {
    return { reason: 'RESTRICTED_IN_CELL', message: `"${type}" is not allowed inside a table cell` };
  }

  return null;
};

export const checkMove = (
  tree: PlacementTree,
  blockId: string,
  parentId: string | null,
  refId: string | undefined,
  options: { allowColumnMoves?: boolean } = {}
): Refusal | null => {
  if (parentId !== null && (parentId === blockId || isUnder(tree, parentId, blockId))) {
    return { reason: 'OWN_SUBTREE', message: `cannot move "${blockId}" inside its own subtree` };
  }

  // One table parent can contain several cells.
  const parentCell = parentId === null ? null : tree.cellOf(parentId, true);
  const targetCell = refId === undefined ? parentCell : tree.cellOf(refId, false);

  if (tree.cellOf(blockId, false) !== targetCell) {
    return { reason: 'TABLE_CELL_BOUNDARY', message: `cannot move "${blockId}" into, out of or between table cells` };
  }

  const oldParentId = tree.parentOf(blockId);

  if (parentId === oldParentId) {
    return null;
  }

  const type = tree.typeOf(blockId);
  const facts = parentId === null ? undefined : tree.containerFacts(parentId);

  if (facts !== undefined && !facts.accepts) {
    return { reason: 'TAKES_NO_CHILDREN', message: `${nameOf(parentId)} takes no children` };
  }
  if (facts?.ownedByTool === true) {
    return { reason: 'OWNS_CHILDREN', message: `${nameOf(parentId)} owns its children` };
  }
  if (oldParentId !== null && tree.containerFacts(oldParentId).ownedByTool) {
    return { reason: 'OWNS_CHILDREN', message: `"${oldParentId}" owns its children; "${blockId}" cannot leave it` };
  }
  if (options.allowColumnMoves !== true
    && (isColumnPart(oldParentId === null ? '' : tree.typeOf(oldParentId))
      || isColumnPart(parentId === null ? '' : tree.typeOf(parentId)))) {
    return { reason: 'COLUMN_BOUNDARY', message: `cannot move "${blockId}" into or out of a column` };
  }
  if (facts !== undefined && !satisfiesChildTools(facts.allow, facts.deny, type)) {
    return {
      reason: 'CHILD_NOT_ALLOWED',
      message: `${nameOf(parentId)} does not allow "${type}" children`,
      ...(facts.allow !== undefined && facts.allow.length > 0 && { allowed: [...facts.allow] }),
    };
  }
  if (parentId !== null && tree.cellOf(parentId, true) !== null && tree.restrictedInCell(type)) {
    return { reason: 'RESTRICTED_IN_CELL', message: `"${type}" is not allowed inside a table cell` };
  }

  return null;
};

const OPEN: ContainerFacts = { accepts: true, ownedByTool: false };

export const snapshotTree = (
  snapshot: DocSnapshot,
  factsOf: (type: string) => (ContainerFacts & { restrictedInTableCell: boolean }) | undefined
): PlacementTree => ({
  parentOf: id => snapshot.parentOf(id),
  typeOf: id => snapshot.get(id)?.type ?? '',
  cellOf: id => {
    const cell = snapshot.cellOf(id);

    return cell === null ? null : `${cell.tableId}:${cell.row}:${cell.col}`;
  },
  containerFacts: id => factsOf(snapshot.get(id)?.type ?? '') ?? OPEN,
  restrictedInCell: type => factsOf(type)?.restrictedInTableCell === true,
});

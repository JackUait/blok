/**
 * `insertAt` / `moveTo` for the adapter tests' fake editors.
 *
 * Positions resolve through core's own `resolvePlacement`, so a fake cannot
 * drift from core's placement rules. The fake supplies only the flat
 * primitives: a positional insert, a raw flat move (no parent heal) and a
 * parent setter.
 */
import type { Block } from '../../../src/components/block';
import {
  BlockPlacementError,
  findBlock,
  isUnder,
  resolvePlacement,
  type BlockTree,
} from '../../../src/components/modules/api/block-placement';
import type { BlockPosition, InsertAtOptions, MoveToTarget } from '../../../types/api';

/** The fields of a block the placement rules read. */
export interface FakeBlock {
  id: string;
  name: string;
  parentId: string | null;
}

export interface FakePlacementDeps {
  /** The live flat block array. */
  blocks: () => FakeBlock[];
  /** Create a block at a flat index (or replace the block there) and return it. */
  insert: (type: string | undefined, data: unknown, index: number, id: string | undefined, replace: boolean) => { id: string };
  /** Flat move in post-removal index space, with no parent change. */
  moveFlat: (toIndex: number, fromIndex: number) => void;
  /** Set a block's parent. */
  setParent: (id: string, parentId: string | null) => void;
  /** Called after every successful change. */
  notify?: () => void;
}

const refOf = (position: BlockPosition): string | null => {
  if (typeof position !== 'object') {
    return null;
  }

  return 'before' in position ? position.before : position.after;
};

/**
 * Build `insertAt` / `moveTo` over a fake editor's flat primitives.
 * @param deps - the fake's primitives
 */
export const fakePlacement = (deps: FakePlacementDeps): {
  insertAt: (type?: string, data?: unknown, options?: InsertAtOptions) => { id: string };
  moveTo: (id: string, target: MoveToTarget) => void;
} => {
  const tree = (): BlockTree => ({
    // The placement helpers read only id, name and parentId.
    blocks: deps.blocks() as unknown as Block[],
    getBlockById: (id: string) => deps.blocks().find(block => block.id === id) as unknown as Block | undefined,
  });
  const indexOf = (id: string): number => deps.blocks().findIndex(block => block.id === id);
  const parentOf = (id: string): string | null => deps.blocks().find(block => block.id === id)?.parentId ?? null;

  const insertAt = (type?: string, data?: unknown, options: InsertAtOptions = {}): { id: string } => {
    if (options.replace !== undefined) {
      if (options.parentId !== undefined || options.position !== undefined) {
        throw new BlockPlacementError('replace cannot be combined with parentId or position');
      }

      const target = findBlock(tree(), options.replace);
      const parentId = target.parentId;
      const created = deps.insert(type, data ?? {}, indexOf(target.id), options.id, true);

      if (parentOf(created.id) !== parentId) {
        deps.setParent(created.id, parentId);
      }
      deps.notify?.();

      return created;
    }

    const placement = resolvePlacement(tree(), options.parentId, options.position ?? 'end');
    const created = deps.insert(type, data ?? {}, placement.index, options.id, false);

    if (parentOf(created.id) !== placement.parentId) {
      deps.setParent(created.id, placement.parentId);
    }
    deps.notify?.();

    return created;
  };

  const moveTo = (id: string, target: MoveToTarget): void => {
    const current = tree();
    const block = findBlock(current, id);

    if (refOf(target.position) === id) {
      throw new BlockPlacementError(`cannot place "${id}" relative to itself`);
    }

    const placement = resolvePlacement(current, target.parentId, target.position);
    const parent = placement.parentId === null ? undefined : findBlock(current, placement.parentId, 'parent block');

    if (parent !== undefined && (parent === block || isUnder(current, parent, block.id))) {
      throw new BlockPlacementError(`cannot move "${id}" inside its own subtree`);
    }

    const oldParent = block.parentId === null ? undefined : current.getBlockById(block.parentId);
    const isColumnPart = (candidate: Block | undefined): boolean =>
      candidate?.name === 'column' || candidate?.name === 'column_list';

    if (placement.parentId !== block.parentId && (isColumnPart(oldParent) || isColumnPart(parent))) {
      throw new BlockPlacementError(`cannot move "${id}" into or out of a column`);
    }

    const descendants = current.blocks.filter(candidate => isUnder(current, candidate, id)).map(candidate => candidate.id);
    const from = indexOf(id);
    const end = from + descendants.length;

    if (placement.index <= from || placement.index > end + 1) {
      deps.moveFlat(from < placement.index ? placement.index - 1 : placement.index, from);

      descendants.forEach((memberId, k) => {
        const anchor = indexOf(k === 0 ? id : descendants[k - 1]);
        const memberFrom = indexOf(memberId);

        if (memberFrom !== anchor + 1) {
          deps.moveFlat(memberFrom < anchor ? anchor : anchor + 1, memberFrom);
        }
      });
    }

    if (placement.parentId !== parentOf(id)) {
      deps.setParent(id, placement.parentId);
    }
    deps.notify?.();
  };

  return { insertAt, moveTo };
};

/**
 * Mutant-killing tests for `src/components/block/api.ts`.
 *
 * PROVEN EQUIVALENT (no test can distinguish these mutants):
 *
 * - `position: InsertPosition = 'end'` -> `''`. The default only ever reaches
 *   `resolveInsertIndex`, whose non-object branch tests `position === 'start'`
 *   and treats every other value as the end, and `typeof position !== 'object'`
 *   at the replace guard, which is true for both strings. No other code reads
 *   `position`, so `''` and `'end'` resolve to the same flat index everywhere.
 *
 * - `delta > 0` -> `delta >= 0` when choosing before/after for the move target.
 *   `moveChild` returns at its first line when `delta === 0`, so the two
 *   operators can only differ on a value that never reaches line 387. NaN and
 *   -0 do not separate them either: `-0 === 0` returns early, and both
 *   comparisons are false for NaN.
 *
 * KILLABLE, DELIBERATELY NOT KILLED:
 *
 * - `const out = { child: null }` -> `{}` inside the transacted replace.
 *   `out.child` is written by the callback and read only after
 *   `blocks.transact` returns, and `transact` runs its callback synchronously -
 *   that is what makes the insert and the reparent one undo entry. So only a
 *   stub that never invokes its callback separates `null` from `undefined`, and
 *   the value is a lie either way there (both are returned as a BlockAPI).
 *   Pinning one would assert nothing about this module.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

import { BlockAPI as BlockAPIConstructor } from '../../../../src/components/block/api';
import type { Block } from '../../../../src/components/block';
import type { API as ApiModules } from '../../../../src/components/modules/api';
import type { BlockAPI as BlockAPIInterface } from '../../../../types/api';
import type { BlockToolData } from '../../../../types/tools';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';

type FakeRecord = { id: string; name: string; parentId: string | null };

type InsertInsideParentFn = (
  parentId: string,
  index: number,
  data: BlockToolData | undefined,
  toolName: string | undefined,
  options: Record<string, unknown>
) => BlockAPIInterface;

type InsertFn = (
  toolName: string | undefined,
  data: BlockToolData,
  config: Record<string, unknown>,
  index: number,
  needToFocus: boolean,
  replace: boolean,
  id: string | undefined,
  tunes: Record<string, BlockTuneData> | undefined
) => BlockAPIInterface;

type MoveFn = (toIndex: number, fromIndex: number) => void;
type TransactFn = (fn: () => void) => void;

/**
 * p
 * |- a
 * |- b
 * other
 */
const tree = (): FakeRecord[] => [
  { id: 'p', name: 'toggle', parentId: null },
  { id: 'a', name: 'paragraph', parentId: 'p' },
  { id: 'b', name: 'paragraph', parentId: 'p' },
  { id: 'other', name: 'paragraph', parentId: null },
];

const makeApi = (
  flat: (FakeRecord | undefined)[],
  options: { withTransact?: boolean } = {}
): {
  api: ApiModules;
  insertInsideParent: Mock<InsertInsideParentFn>;
  insert: Mock<InsertFn>;
  move: Mock<MoveFn>;
  transact: Mock<TransactFn>;
  setBlockParent: Mock<(childId: string, parentId: string | null) => void>;
  created: BlockAPIInterface;
} => {
  const created = { id: 'new-child',
    name: 'paragraph',
    parentId: 'p' } as unknown as BlockAPIInterface;

  const insertInsideParent = vi.fn<InsertInsideParentFn>(() => created);
  const insert = vi.fn<InsertFn>(() => created);
  const move = vi.fn<MoveFn>();
  const transact = vi.fn<TransactFn>((fn) => fn());
  const setBlockParent = vi.fn<(childId: string, parentId: string | null) => void>();

  const blocks = {
    getBlocksCount: (): number => flat.length,
    getBlockByIndex: (i: number): FakeRecord | undefined => flat[i],
    getBlockIndex: (id: string): number | undefined => {
      const idx = flat.findIndex((b) => b?.id === id);

      return idx === -1 ? undefined : idx;
    },
    getChildren: (parentId: string) => flat.filter((b) => b?.parentId === parentId),
    insertInsideParent,
    setBlockParent,
    move,
    insert,
    ...(options.withTransact !== false && { transact }),
  };

  return {
    api: { methods: { blocks,
      caret: { setToBlock: vi.fn() } } } as unknown as ApiModules,
    insertInsideParent,
    insert,
    move,
    transact,
    setBlockParent,
    created,
  };
};

const containerBlock = (
  contentIds: string[] = [ 'a', 'b' ],
  onReadContentIds?: () => void
): Block => {
  const block = {
    id: 'p',
    name: 'toggle',
    parentId: null,
    get contentIds(): string[] {
      onReadContentIds?.();

      return contentIds;
    },
  };

  return block as unknown as Block;
};

describe('BlockAPI mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('id and name views', () => {
    it('carries id and name as own enumerable properties', () => {
      const blockAPI = new BlockAPIConstructor(containerBlock(), makeApi(tree()).api);

      expect(Object.keys(blockAPI)).toEqual([ 'id', 'name' ]);
      expect({ ...blockAPI }).toEqual({ id: 'p',
        name: 'toggle' });
    });

    it('lets the own views be removed, falling back to the interface getters', () => {
      const blockAPI = new BlockAPIConstructor(containerBlock(), makeApi(tree()).api);

      expect(Reflect.deleteProperty(blockAPI, 'id')).toBe(true);
      expect(Reflect.deleteProperty(blockAPI, 'name')).toBe(true);

      expect(blockAPI.id).toBe('p');
      expect(blockAPI.name).toBe('toggle');
    });
  });

  describe('insertChild', () => {
    it('probes for an existing id without tripping over a gap in the block list', () => {
      const flat: (FakeRecord | undefined)[] = [ tree()[0], undefined, tree()[2] ];
      const { api, insertInsideParent } = makeApi(flat);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild({ text: 'x' });

      expect(insertInsideParent).toHaveBeenCalledTimes(1);
      expect(insertInsideParent.mock.lastCall?.[1]).toBe(1);
    });

    it('scans for an existing id across a gap in the block list', () => {
      const flat: (FakeRecord | undefined)[] = [ tree()[0], undefined, tree()[2] ];
      const { api, insertInsideParent } = makeApi(flat);
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild({ text: 'x' }, 'end', undefined, { id: 'ghost' });

      expect(insertInsideParent).toHaveBeenCalledTimes(1);
      expect(insertInsideParent.mock.lastCall?.[4]).toStrictEqual({ id: 'ghost' });
    });

    // A host whose transact swallows its callback leaves nothing assigned. Both
    // the seeded null and an unseeded undefined are wrong for the declared
    // BlockAPI return, so this pins the seed itself, not a useful answer.
    it('yields the seeded null when a transact never runs its callback', () => {
      const { api, transact } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      transact.mockImplementation(() => undefined);

      const child = blockAPI.insertChild({ text: 'x' }, { before: 'b' }, 'header', {
        replace: true,
        id: 'a',
      });

      expect(child).toBeNull();
    });

    it('replaces a child whose id already exists instead of returning it', () => {
      const { api, insert } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild({ text: 'x' }, { before: 'b' }, 'header', { replace: true,
        id: 'a' });

      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert.mock.lastCall?.[6]).toBe('a');
    });

    it('sends no key at all for an absent id or tunes', () => {
      const { api, insertInsideParent } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild({ text: 'x' });

      expect(insertInsideParent.mock.lastCall?.[4]).toStrictEqual({});
    });

    it('opens no transaction for a plain insert', () => {
      const { api, transact } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild({ text: 'x' });

      expect(transact).not.toHaveBeenCalled();
    });

    it('replaces through an editor that has no transact', () => {
      const { api, insert, setBlockParent } = makeApi(tree(), { withTransact: false });
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild({ text: 'x' }, { before: 'b' }, 'header', { replace: true });

      expect(insert).toHaveBeenCalledTimes(1);
      expect(setBlockParent).toHaveBeenCalledWith('new-child', 'p');
    });

    it('gives a replace with no data an empty paragraph for the default tool', () => {
      const { api, insert } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild(undefined, { before: 'b' }, undefined, { replace: true });

      expect(insert.mock.lastCall?.[1]).toStrictEqual({ text: '' });
    });

    it('gives a replace with no data nothing to seed a named tool with', () => {
      const { api, insert } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.insertChild(undefined, { before: 'b' }, 'header', { replace: true });

      expect(insert.mock.lastCall?.[1]).toStrictEqual({});
    });

    it('shows the position shape when a replace names no child', () => {
      const { api } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      expect(() => blockAPI.insertChild({ text: 'x' }, 'end', undefined, { replace: true }))
        .toThrow(/e\.g\. \{ before: childId \}/);
    });
  });

  describe('moveChild', () => {
    it('ignores a zero delta without even reading the children', () => {
      const { api, move } = makeApi(tree());
      const readContentIds = vi.fn();
      const blockAPI = new BlockAPIConstructor(containerBlock([ 'a', 'b' ], readContentIds), api);

      blockAPI.moveChild('a', 0);

      expect(move).not.toHaveBeenCalled();
      expect(readContentIds).not.toHaveBeenCalled();
    });

    it('ignores a block that is not one of the children', () => {
      const { api, move } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.moveChild('other', 1);

      expect(move).not.toHaveBeenCalled();
    });

    it('moves a child up to the slot before its previous sibling', () => {
      const { api, move } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.moveChild('b', -1);

      expect(move).toHaveBeenCalledWith(1, 2);
    });

    it('clamps a delta reaching past the last sibling', () => {
      const { api, move } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.moveChild('a', 5);

      // 'a' lands after b's whole subtree, which ends at flat index 2.
      expect(move).toHaveBeenCalledWith(3, 1);
    });

    it('ignores a delta that clamps back onto the current slot', () => {
      const { api, move } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock(), api);

      blockAPI.moveChild('a', -1);

      expect(move).not.toHaveBeenCalled();
    });

    it('ignores a child that is listed but missing from the document', () => {
      const { api, move } = makeApi(tree());
      const blockAPI = new BlockAPIConstructor(containerBlock([ 'a', 'ghost' ]), api);

      blockAPI.moveChild('ghost', -1);

      expect(move).not.toHaveBeenCalled();
    });
  });
});

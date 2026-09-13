import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { Block } from '../../../../../src/components/block';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';

interface BlockFixtureOptions {
  id: string;
  name?: string;
  parentId?: string | null;
  ownsChildren?: boolean;
  isEmpty?: boolean;
  hasInput?: boolean;
}

/**
 * A stand-in for Block exposing exactly the surface the repository reads.
 */
const makeBlock = (options: BlockFixtureOptions): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  const inputs: HTMLElement[] = [];

  if (options.hasInput !== false) {
    const input = document.createElement('div');

    input.setAttribute('contenteditable', 'true');
    holder.appendChild(input);
    inputs.push(input);
  }

  const fixture = {
    id: options.id,
    name: options.name ?? 'paragraph',
    holder,
    inputs,
    isEmpty: options.isEmpty ?? false,
    parentId: options.parentId ?? null,
    contentIds: [] as string[],
    tool: { ownsChildren: options.ownsChildren ?? false },
    call: vi.fn(),
  };

  return fixture as unknown as Block;
};

const makeStore = (blocks: Block[]): BlocksStore => {
  const workingArea = document.createElement('div');
  const store = new Blocks(workingArea);

  for (const block of blocks) {
    store.push(block);
  }

  return new Proxy(store, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;
};

const idsOf = (blocks: Block[]): string[] => blocks.map((block) => block.id);

describe('BlockRepository (mutants)', () => {
  let repository: BlockRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new BlockRepository();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getBlock', () => {
    it('returns the block owning the queried holder, not merely the first block', () => {
      const first = makeBlock({ id: 'a' });
      const second = makeBlock({ id: 'b' });

      repository.initialize(makeStore([first, second]));

      expect(repository.getBlock(second.holder)).toBe(second);
      expect(repository.getBlock(first.holder)).toBe(first);
    });

    it('resolves a text node through its parent element', () => {
      const block = makeBlock({ id: 'a' });
      const text = document.createTextNode('hi');

      block.inputs[0].appendChild(text);
      repository.initialize(makeStore([block]));

      expect(repository.getBlock(text as unknown as HTMLElement)).toBe(block);
    });

    it('returns undefined for a detached text node whose parent is null', () => {
      repository.initialize(makeStore([makeBlock({ id: 'a' })]));

      const orphanText = document.createTextNode('lonely');

      expect(repository.getBlock(orphanText as unknown as HTMLElement)).toBeUndefined();
    });

    it('returns undefined for an element outside any block holder', () => {
      repository.initialize(makeStore([makeBlock({ id: 'a' })]));

      expect(repository.getBlock(document.createElement('span'))).toBeUndefined();
    });

    it('returns undefined for null and undefined', () => {
      repository.initialize(makeStore([makeBlock({ id: 'a' })]));

      expect(repository.getBlock(null)).toBeUndefined();
      expect(repository.getBlock(undefined)).toBeUndefined();
    });

    it('returns undefined when the holder is not registered in the store', () => {
      const known = makeBlock({ id: 'a' });
      const stranger = makeBlock({ id: 'ghost' });

      repository.initialize(makeStore([known]));

      expect(repository.getBlock(stranger.holder)).toBeUndefined();
    });
  });

  describe('getBlockByChildNode', () => {
    it('returns the owning block, not merely the first block', () => {
      const first = makeBlock({ id: 'a' });
      const second = makeBlock({ id: 'b' });

      repository.initialize(makeStore([first, second]));

      expect(repository.getBlockByChildNode(second.inputs[0])).toBe(second);
      expect(repository.getBlockByChildNode(first.inputs[0])).toBe(first);
    });

    it('resolves a text node through its parent element', () => {
      const block = makeBlock({ id: 'a' });
      const text = document.createTextNode('hi');

      block.inputs[0].appendChild(text);
      repository.initialize(makeStore([block]));

      expect(repository.getBlockByChildNode(text)).toBe(block);
    });

    it('returns undefined for a non-Node value', () => {
      repository.initialize(makeStore([makeBlock({ id: 'a' })]));

      expect(repository.getBlockByChildNode({ nodeType: 1 } as unknown as Node)).toBeUndefined();
      expect(repository.getBlockByChildNode('text' as unknown as Node)).toBeUndefined();
    });

    it('returns undefined for a detached text node whose parent is null', () => {
      repository.initialize(makeStore([makeBlock({ id: 'a' })]));

      expect(repository.getBlockByChildNode(document.createTextNode('lonely'))).toBeUndefined();
    });

    it('returns undefined for an element outside any block holder', () => {
      repository.initialize(makeStore([makeBlock({ id: 'a' })]));

      expect(repository.getBlockByChildNode(document.createElement('span'))).toBeUndefined();
    });
  });

  describe('getPreviousContentfulBlock', () => {
    it('returns the NEAREST contentful block before the index, not the earliest', () => {
      const blocks = [
        makeBlock({ id: 'a' }),
        makeBlock({ id: 'b' }),
        makeBlock({ id: 'c' }),
      ];

      repository.initialize(makeStore(blocks));

      expect(repository.getPreviousContentfulBlock(2)?.id).toBe('b');
    });

    it('skips input-less blocks walking backwards', () => {
      const blocks = [
        makeBlock({ id: 'a' }),
        makeBlock({ id: 'b', hasInput: false }),
        makeBlock({ id: 'c' }),
      ];

      repository.initialize(makeStore(blocks));

      expect(repository.getPreviousContentfulBlock(2)?.id).toBe('a');
    });

    it('returns undefined at index 0', () => {
      repository.initialize(makeStore([makeBlock({ id: 'a' })]));

      expect(repository.getPreviousContentfulBlock(0)).toBeUndefined();
    });
  });

  describe('getNextContentfulBlock', () => {
    it('returns the nearest contentful block after the index', () => {
      const blocks = [
        makeBlock({ id: 'a' }),
        makeBlock({ id: 'b', hasInput: false }),
        makeBlock({ id: 'c' }),
      ];

      repository.initialize(makeStore(blocks));

      expect(repository.getNextContentfulBlock(0)?.id).toBe('c');
      expect(repository.getNextContentfulBlock(2)).toBeUndefined();
    });
  });

  describe('resolveToRootBlock', () => {
    it('returns the block itself when it has no parent', () => {
      const root = makeBlock({ id: 'root' });

      repository.initialize(makeStore([root]));

      expect(repository.resolveToRootBlock(root)).toBe(root);
    });

    it('walks to the outermost ancestor, past an owning container', () => {
      const toggle = makeBlock({ id: 'toggle' });
      const table = makeBlock({ id: 'table', name: 'table', parentId: 'toggle', ownsChildren: true });
      const cell = makeBlock({ id: 'cell', parentId: 'table' });

      repository.initialize(makeStore([toggle, table, cell]));

      expect(repository.resolveToRootBlock(cell)).toBe(toggle);
    });

    it('returns the block when its parentId points at nothing', () => {
      const orphan = makeBlock({ id: 'orphan', parentId: 'missing' });

      repository.initialize(makeStore([orphan]));

      expect(repository.resolveToRootBlock(orphan)).toBe(orphan);
    });
  });

  describe('resolveToSelectableBlock', () => {
    it('represents a table cell by its owning table, and stops at the table', () => {
      const toggle = makeBlock({ id: 'toggle' });
      const table = makeBlock({ id: 'table', name: 'table', parentId: 'toggle', ownsChildren: true });
      const cell = makeBlock({ id: 'cell', parentId: 'table' });

      repository.initialize(makeStore([toggle, table, cell]));

      expect(repository.resolveToSelectableBlock(cell)).toBe(table);
      expect(repository.resolveToSelectableBlock(table)).toBe(table);
      expect(repository.resolveToSelectableBlock(toggle)).toBe(toggle);
    });

    it('keeps a column child first-class even though column owns its children', () => {
      const list = makeBlock({ id: 'list', name: 'column_list', ownsChildren: true });
      const column = makeBlock({ id: 'col', name: 'column', parentId: 'list', ownsChildren: true });
      const child = makeBlock({ id: 'child', parentId: 'col' });

      repository.initialize(makeStore([list, column, child]));

      expect(repository.resolveToSelectableBlock(child)).toBe(child);
      expect(repository.resolveToSelectableBlock(column)).toBe(column);
    });

    it('returns the block when its parentId points at nothing', () => {
      const orphan = makeBlock({ id: 'orphan', parentId: 'missing' });

      repository.initialize(makeStore([orphan]));

      expect(repository.resolveToSelectableBlock(orphan)).toBe(orphan);
    });

    it('returns the block when the parent does not own its children', () => {
      const toggle = makeBlock({ id: 'toggle' });
      const child = makeBlock({ id: 'child', parentId: 'toggle' });

      repository.initialize(makeStore([toggle, child]));

      expect(repository.resolveToSelectableBlock(child)).toBe(child);
    });
  });

  describe('isSelectionUnit', () => {
    it('rejects both column containers and accepts their content', () => {
      const list = makeBlock({ id: 'list', name: 'column_list', ownsChildren: true });
      const column = makeBlock({ id: 'col', name: 'column', parentId: 'list', ownsChildren: true });
      const child = makeBlock({ id: 'child', parentId: 'col' });

      repository.initialize(makeStore([list, column, child]));

      expect(repository.isSelectionUnit(list)).toBe(false);
      expect(repository.isSelectionUnit(column)).toBe(false);
      expect(repository.isSelectionUnit(child)).toBe(true);
    });

    it('rejects a table cell and accepts the table', () => {
      const table = makeBlock({ id: 'table', name: 'table', ownsChildren: true });
      const cell = makeBlock({ id: 'cell', parentId: 'table' });

      repository.initialize(makeStore([table, cell]));

      expect(repository.isSelectionUnit(cell)).toBe(false);
      expect(repository.isSelectionUnit(table)).toBe(true);
    });

    it('accepts a plain root block', () => {
      const root = makeBlock({ id: 'root' });

      repository.initialize(makeStore([root]));

      expect(repository.isSelectionUnit(root)).toBe(true);
    });
  });

  describe('getSelectionSiblingRange', () => {
    it('returns the single unit when both endpoints resolve to the same block', () => {
      const table = makeBlock({ id: 'table', name: 'table', ownsChildren: true });
      const cellA = makeBlock({ id: 'cellA', parentId: 'table' });
      const cellB = makeBlock({ id: 'cellB', parentId: 'table' });

      repository.initialize(makeStore([table, cellA, cellB]));

      expect(idsOf(repository.getSelectionSiblingRange(cellA, cellB))).toStrictEqual(['table']);
      expect(idsOf(repository.getSelectionSiblingRange(table, table))).toStrictEqual(['table']);
    });

    it('expands a column layout endpoint into the blocks inside its columns', () => {
      const list = makeBlock({ id: 'list', name: 'column_list', ownsChildren: true });
      const colA = makeBlock({ id: 'colA', name: 'column', parentId: 'list', ownsChildren: true });
      const colB = makeBlock({ id: 'colB', name: 'column', parentId: 'list', ownsChildren: true });
      const a1 = makeBlock({ id: 'a1', parentId: 'colA' });
      const b1 = makeBlock({ id: 'b1', parentId: 'colB' });

      repository.initialize(makeStore([list, colA, colB, a1, b1]));

      expect(idsOf(repository.getSelectionSiblingRange(list, list))).toStrictEqual(['a1', 'b1']);
    });

    it('returns the container alone when one endpoint contains the other', () => {
      const toggle = makeBlock({ id: 'toggle' });
      const inner = makeBlock({ id: 'inner', parentId: 'toggle' });

      repository.initialize(makeStore([toggle, inner]));

      expect(idsOf(repository.getSelectionSiblingRange(inner, toggle))).toStrictEqual(['toggle']);
      expect(idsOf(repository.getSelectionSiblingRange(toggle, inner))).toStrictEqual(['toggle']);
    });

    it('selects a whole root run when the endpoints share no ancestor', () => {
      const toggle = makeBlock({ id: 'toggle' });
      const inner = makeBlock({ id: 'inner', parentId: 'toggle' });
      const middle = makeBlock({ id: 'middle' });
      const tail = makeBlock({ id: 'tail' });

      repository.initialize(makeStore([toggle, middle, tail, inner]));

      expect(idsOf(repository.getSelectionSiblingRange(inner, tail))).toStrictEqual([
        'toggle',
        'middle',
        'tail',
      ]);
    });

    it('returns document order when the gesture runs backwards', () => {
      const first = makeBlock({ id: 'first' });
      const middle = makeBlock({ id: 'middle' });
      const last = makeBlock({ id: 'last' });

      repository.initialize(makeStore([first, middle, last]));

      expect(idsOf(repository.getSelectionSiblingRange(last, first))).toStrictEqual([
        'first',
        'middle',
        'last',
      ]);
      expect(idsOf(repository.getSelectionSiblingRange(first, last))).toStrictEqual([
        'first',
        'middle',
        'last',
      ]);
    });

    it('includes the last sibling of the run, not one short of it', () => {
      const first = makeBlock({ id: 'first' });
      const second = makeBlock({ id: 'second' });
      const third = makeBlock({ id: 'third' });

      repository.initialize(makeStore([first, second, third]));

      expect(idsOf(repository.getSelectionSiblingRange(first, second))).toStrictEqual(['first', 'second']);
      expect(idsOf(repository.getSelectionSiblingRange(second, second))).toStrictEqual(['second']);
    });

    it('lifts both endpoints to siblings under their lowest common ancestor', () => {
      const toggle = makeBlock({ id: 'toggle' });
      const section = makeBlock({ id: 'section', parentId: 'toggle' });
      const sibling = makeBlock({ id: 'sibling', parentId: 'toggle' });
      const deep = makeBlock({ id: 'deep', parentId: 'section' });
      const outsider = makeBlock({ id: 'outsider' });

      repository.initialize(makeStore([toggle, outsider, section, sibling, deep]));

      expect(idsOf(repository.getSelectionSiblingRange(deep, sibling))).toStrictEqual([
        'section',
        'sibling',
      ]);
    });

    it('falls back to the two endpoints when a sibling is not in the resolved run', () => {
      const orphan = makeBlock({ id: 'orphan', parentId: 'missing' });
      const root = makeBlock({ id: 'root' });

      repository.initialize(makeStore([root, orphan]));

      expect(idsOf(repository.getSelectionSiblingRange(orphan, root))).toStrictEqual(['orphan', 'root']);
    });

    it('falls back when only the TARGET endpoint is missing from the run', () => {
      const root1 = makeBlock({ id: 'root1' });
      const root2 = makeBlock({ id: 'root2' });
      const orphan = makeBlock({ id: 'orphan', parentId: 'missing' });

      repository.initialize(makeStore([root1, root2, orphan]));

      expect(idsOf(repository.getSelectionSiblingRange(root1, orphan))).toStrictEqual(['root1', 'orphan']);
    });

    it('survives a corrupted parentId cycle instead of recursing forever', () => {
      const a = makeBlock({ id: 'a', parentId: 'b' });
      const b = makeBlock({ id: 'b', parentId: 'a' });
      const root = makeBlock({ id: 'root' });

      repository.initialize(makeStore([root, a, b]));

      expect(idsOf(repository.getSelectionSiblingRange(a, root))).toStrictEqual(['a', 'root']);
    });
  });
});

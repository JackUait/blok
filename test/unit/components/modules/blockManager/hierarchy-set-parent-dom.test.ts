/**
 * Where setBlockParent leaves holders in the DOM, with a real Blocks store
 * whose working area is in the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockHierarchy } from '../../../../../src/components/modules/blockManager/hierarchy';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';

type Kind = 'paragraph' | 'toggle' | 'callout' | 'table' | 'column_list' | 'column' | 'list';

interface Spec {
  id: string;
  kind?: Kind;
  parentId?: string | null;
}

interface Harness {
  store: Blocks;
  hierarchy: BlockHierarchy;
  get: (id: string) => Block;
  slotOf: (id: string) => Element;
  cellsOf: (id: string) => Element[];
}

const SLOT_SELECTOR = '[data-blok-toggle-children], [data-blok-nested-blocks]';

const makeBlock = (spec: Spec): Block => {
  const kind = spec.kind ?? 'paragraph';
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  holder.setAttribute('data-blok-id', spec.id);

  if (kind === 'toggle') {
    holder.appendChild(document.createElement('div')).setAttribute('data-blok-toggle-children', '');
  }

  if (kind === 'callout') {
    holder.appendChild(document.createElement('div')).setAttribute('data-blok-nested-blocks', '');
  }

  if (kind === 'column_list') {
    const row = holder.appendChild(document.createElement('div'));

    row.setAttribute('data-blok-columns', '');
    row.setAttribute('data-blok-nested-blocks', '');
  }

  if (kind === 'column') {
    holder.setAttribute('data-blok-column', '');
    holder.appendChild(document.createElement('div')).setAttribute('data-blok-nested-blocks', '');
  }

  if (kind === 'table') {
    [0, 1].forEach(() => {
      const cell = holder.appendChild(document.createElement('div'));

      cell.setAttribute('data-blok-nested-blocks', '');
      cell.setAttribute('data-blok-table-cell-blocks', '');
    });
  }

  return {
    id: spec.id,
    name: kind,
    holder,
    parentId: spec.parentId ?? null,
    contentIds: [],
    call: vi.fn(),
  } as unknown as Block;
};

/**
 * Specs list the flat array depth-first. A child goes into the nearest
 * ancestor slot; a table child into the table's first cell.
 */
const build = (workingArea: HTMLElement, specs: Spec[]): Harness => {
  const store = new Blocks(workingArea);
  const blocks = specs.map(makeBlock);
  const byId = new Map(blocks.map(block => [block.id, block]));
  const homeOf = (parentId: string | null): Element => {
    const parent = parentId === null ? undefined : byId.get(parentId);

    if (parent === undefined) {
      return workingArea;
    }

    return parent.holder.querySelector(SLOT_SELECTOR) ?? homeOf(parent.parentId);
  };

  blocks.forEach(block => {
    store.addToArray(store.length, block);
    (block.parentId === null ? undefined : byId.get(block.parentId))?.contentIds.push(block.id);
    homeOf(block.parentId).appendChild(block.holder);
  });

  const repository = new BlockRepository();

  repository.initialize(store as BlocksStore);

  const get = (id: string): Block => {
    const block = store.getById(id);

    if (block === undefined) {
      throw new Error(`no block ${id}`);
    }

    return block;
  };
  const cellsOf = (id: string): Element[] => Array.from(get(id).holder.querySelectorAll(SLOT_SELECTOR));
  const slotOf = (id: string): Element => {
    const [slot] = cellsOf(id);

    if (slot === undefined) {
      throw new Error(`block ${id} has no slot`);
    }

    return slot;
  };

  return { store, hierarchy: new BlockHierarchy(repository, vi.fn(), undefined, store), get, slotOf, cellsOf };
};

const holderIds = (element: Element): Array<string | null> =>
  Array.from(element.children)
    .filter(child => child.hasAttribute('data-blok-id'))
    .map(child => child.getAttribute('data-blok-id'));

/** Moves the flat array only, like drag does before it reparents. */
const reorder = (h: Harness, ids: string[]): void => {
  h.store.reorder(ids.map(h.get));
};

describe('BlockHierarchy.setBlockParent — holders in the DOM', () => {
  let workingArea: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    workingArea = document.createElement('div');
    document.body.appendChild(workingArea);
  });

  afterEach(() => {
    workingArea.remove();
    vi.restoreAllMocks();
  });

  it('puts a block that joins a toggle last in the toggle\'s slot', () => {
    const h = build(workingArea, [
      { id: 't', kind: 'toggle' },
      { id: 'c', parentId: 't' },
      { id: 'p' },
    ]);

    h.hierarchy.setBlockParent(h.get('p'), 't');

    expect(holderIds(h.slotOf('t'))).toEqual(['c', 'p']);
    expect(holderIds(workingArea)).toEqual(['t']);
  });

  it('puts a block that leaves a toggle for flat index 0 first at the root', () => {
    const h = build(workingArea, [
      { id: 'a' },
      { id: 't', kind: 'toggle' },
      { id: 'c', parentId: 't' },
    ]);

    reorder(h, ['c', 'a', 't']);
    h.hierarchy.setBlockParent(h.get('c'), null);

    expect(holderIds(workingArea)).toEqual(['c', 'a', 't']);
    expect(holderIds(h.slotOf('t'))).toEqual([]);
  });

  it('puts a block that leaves a toggle for its grandparent right after the toggle it left', () => {
    const h = build(workingArea, [
      { id: 'outer', kind: 'toggle' },
      { id: 'inner', kind: 'toggle', parentId: 'outer' },
      { id: 'c', parentId: 'inner' },
      { id: 'd', parentId: 'outer' },
    ]);

    h.hierarchy.setBlockParent(h.get('c'), 'outer');

    expect(holderIds(h.slotOf('outer'))).toEqual(['inner', 'c', 'd']);
    expect(holderIds(h.slotOf('inner'))).toEqual([]);
  });

  it('moves a block that escapes a column to the root, after the column list', () => {
    const h = build(workingArea, [
      { id: 'list', kind: 'column_list' },
      { id: 'col', kind: 'column', parentId: 'list' },
      { id: 'p', parentId: 'col' },
      { id: 'q', parentId: 'col' },
      { id: 'after' },
    ]);

    reorder(h, ['list', 'col', 'p', 'q', 'after']);
    h.hierarchy.setBlockParent(h.get('q'), null);

    expect(holderIds(workingArea)).toEqual(['list', 'q', 'after']);
    expect(holderIds(h.slotOf('col'))).toEqual(['p']);
  });

  it('hides a block that joins a collapsed toggle', () => {
    const h = build(workingArea, [
      { id: 't', kind: 'toggle' },
      { id: 'c', parentId: 't' },
      { id: 'p' },
    ]);

    h.get('c').holder.classList.add('hidden');
    h.hierarchy.setBlockParent(h.get('p'), 't');

    expect(h.get('p').holder.classList.contains('hidden')).toBe(true);
    expect(h.get('p').holder.parentElement).toBe(h.slotOf('t'));
  });

  it('puts a block that joins a callout in the callout\'s slot', () => {
    const h = build(workingArea, [
      { id: 'co', kind: 'callout' },
      { id: 'p' },
    ]);

    h.hierarchy.setBlockParent(h.get('p'), 'co');

    expect(h.get('p').holder.parentElement).toBe(h.slotOf('co'));
    expect(holderIds(workingArea)).toEqual(['co']);
  });

  it('puts a child of a slotless paragraph in the slot the paragraph sits in, after it', () => {
    const h = build(workingArea, [
      { id: 't', kind: 'toggle' },
      { id: 'para', parentId: 't' },
      { id: 'next', parentId: 't' },
      { id: 'x' },
    ]);

    reorder(h, ['t', 'para', 'x', 'next']);
    h.hierarchy.setBlockParent(h.get('x'), 'para');

    expect(holderIds(h.slotOf('t'))).toEqual(['para', 'x', 'next']);
    expect(holderIds(workingArea)).toEqual(['t']);
  });

  it('carries the slotless children of a paragraph that joins a toggle', () => {
    const h = build(workingArea, [
      { id: 't', kind: 'toggle' },
      { id: 'para' },
      { id: 'kid', parentId: 'para' },
    ]);

    h.hierarchy.setBlockParent(h.get('para'), 't');

    expect(holderIds(h.slotOf('t'))).toEqual(['para', 'kid']);
    expect(holderIds(workingArea)).toEqual(['t']);
  });

  it('keeps a table child\'s holder in its own cell when the parent link is re-asserted', () => {
    const h = build(workingArea, [
      { id: 'table', kind: 'table' },
      { id: 'a', parentId: 'table' },
      { id: 'b', parentId: 'table' },
    ]);
    const [firstCell, secondCell] = h.cellsOf('table');

    secondCell.appendChild(h.get('b').holder);
    h.hierarchy.setBlockParent(h.get('b'), 'table');

    expect(h.get('b').holder.parentElement).toBe(secondCell);
    expect(holderIds(firstCell)).toEqual(['a']);
  });

  it('keeps each child of a two-slot parent in its own slot when the parent moves', () => {
    const h = build(workingArea, [
      { id: 't', kind: 'toggle' },
      { id: 'two', kind: 'table' },
      { id: 'a', parentId: 'two' },
      { id: 'b', parentId: 'two' },
    ]);
    const two = h.get('two');
    const [firstSlot, secondSlot] = h.cellsOf('two');

    // An adapter block with two child slots: not a table, so no tool places them.
    Object.assign(two, { name: 'two-slots' });
    secondSlot.appendChild(h.get('b').holder);
    h.hierarchy.setBlockParent(two, 't');

    expect(holderIds(firstSlot)).toEqual(['a']);
    expect(holderIds(secondSlot)).toEqual(['b']);
    expect(holderIds(h.slotOf('t'))).toEqual(['two']);
  });

  it('puts a root holder back in flat order when its root parent link is re-asserted', () => {
    const h = build(workingArea, [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);

    reorder(h, ['a', 'c', 'b']);
    h.hierarchy.setBlockParent(h.get('b'), null);

    expect(holderIds(workingArea)).toEqual(['a', 'c', 'b']);
  });

  it('moves a block that leaves a table cell for the root out of the cell', () => {
    const h = build(workingArea, [
      { id: 'table', kind: 'table' },
      { id: 'a', parentId: 'table' },
      { id: 'b', parentId: 'table' },
      { id: 'after' },
    ]);
    const [, secondCell] = h.cellsOf('table');

    secondCell.appendChild(h.get('b').holder);
    reorder(h, ['table', 'a', 'after', 'b']);
    h.hierarchy.setBlockParent(h.get('b'), null);

    expect(holderIds(secondCell)).toEqual([]);
    expect(holderIds(workingArea)).toEqual(['table', 'after', 'b']);
  });

  it('leaves the holders alone when the new parent sits inside a moved child\'s holder', () => {
    const h = build(workingArea, [
      { id: 'para' },
      { id: 'kid', parentId: 'para' },
      { id: 't', kind: 'toggle' },
    ]);

    // Corrupted DOM: the toggle's holder sits inside the slotless child's holder.
    h.get('kid').holder.appendChild(h.get('t').holder);

    expect(() => h.hierarchy.setBlockParent(h.get('para'), 't')).not.toThrow();
    expect(h.get('para').parentId).toBe('t');
    expect(holderIds(workingArea)).toEqual(['para', 'kid']);
  });

  it('fires the moved hook once for each nested list item and not for the moved block', () => {
    const h = build(workingArea, [
      { id: 't', kind: 'toggle' },
      { id: 'para' },
      { id: 'item', kind: 'list', parentId: 'para' },
    ]);

    h.hierarchy.setBlockParent(h.get('para'), 't');

    expect(vi.mocked(h.get('item').call).mock.calls.filter(([name]) => name === 'moved')).toHaveLength(1);
    expect(h.get('para').call).not.toHaveBeenCalled();
  });
});

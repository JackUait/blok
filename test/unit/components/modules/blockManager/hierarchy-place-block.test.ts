/**
 * BlockHierarchy.placeBlock: moves a block with its whole subtree to a
 * sibling-relative place. Seeded random trees check that the flat array stays
 * the tree's depth-first order and every holder lands in its home slot, in
 * order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockHierarchy } from '../../../../../src/components/modules/blockManager/hierarchy';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { placementImpliedByFlat } from '../../../../../src/components/utils/tree-order';
import type { TreePlacement } from '../../../../../src/components/utils/tree-order';
import { validateFlatOrder, validateHomeSlots, validateTreeOrder } from '../../../../../src/components/utils/hierarchy-invariant';

type Kind = 'paragraph' | 'toggle' | 'callout' | 'table';

interface Spec {
  id: string;
  kind?: Kind;
  parentId?: string | null;
}

interface Harness {
  store: Blocks;
  hierarchy: BlockHierarchy;
  onParentChanged: ReturnType<typeof vi.fn>;
  get: (id: string) => Block;
  ids: () => string[];
  slotOf: (id: string) => Element;
}

/** mulberry32: small, fast, deterministic. */
const rng = (seed: number): () => number => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

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
 * The slot element a child of `parentId` belongs in, or null for the working
 * area, or 'self' when a table places it. Written independently of core.
 */
const expectedHome = (byId: Map<string, Block>, parentId: string | null): Element | null | 'self' => {
  const parent = parentId === null ? undefined : byId.get(parentId);

  if (parent === undefined) {
    return null;
  }

  if (parent.name === 'table') {
    return 'self';
  }

  const slot = parent.holder.querySelector('[data-blok-toggle-children], [data-blok-nested-blocks]');

  return slot ?? expectedHome(byId, parent.parentId);
};

/**
 * Specs must list the flat array in depth-first order. Table children go into
 * the table's first cell.
 */
const build = (workingArea: HTMLElement, specs: Spec[], withStore = true): Harness => {
  const store = new Blocks(workingArea);
  const blocks = specs.map(makeBlock);
  const byId = new Map(blocks.map(block => [block.id, block]));

  blocks.forEach(block => {
    store.addToArray(store.length, block);

    const parent = block.parentId === null ? undefined : byId.get(block.parentId);

    parent?.contentIds.push(block.id);

    const home = expectedHome(byId, block.parentId);
    const table = home === 'self' ? parent?.holder.querySelector('[data-blok-table-cell-blocks]') : undefined;

    (home === 'self' ? table ?? workingArea : home ?? workingArea).appendChild(block.holder);
  });

  const repository = new BlockRepository();

  repository.initialize(store as BlocksStore);
  const onParentChanged = vi.fn();
  const hierarchy = new BlockHierarchy(repository, onParentChanged, undefined, withStore ? store : undefined);
  const get = (id: string): Block => {
    const block = store.getById(id);

    if (block === undefined) {
      throw new Error(`no block ${id}`);
    }

    return block;
  };
  const slotOf = (id: string): Element => {
    const slot = get(id).holder.querySelector('[data-blok-toggle-children], [data-blok-nested-blocks]');

    if (slot === null) {
      throw new Error(`block ${id} has no slot`);
    }

    return slot;
  };

  return { store, hierarchy, onParentChanged, get, ids: () => store.blocks.map(block => block.id), slotOf };
};

const holderIds = (element: Element): Array<string | null> =>
  Array.from(element.children)
    .filter(child => child.hasAttribute('data-blok-id'))
    .map(child => child.getAttribute('data-blok-id'));

/** Every consistency property placeBlock must keep. Table-placed blocks are not judged in the DOM. */
const expectConsistent = (h: Harness, workingArea: HTMLElement, context: string): void => {
  const blocks = h.store.blocks;
  const byId = new Map(blocks.map(block => [block.id, block]));

  expect(validateFlatOrder(blocks).map(v => v.message), context).toEqual([]);
  expect(validateHomeSlots(blocks, workingArea).map(v => v.message), context).toEqual([]);
  expect(validateTreeOrder(blocks).map(v => v.message), context).toEqual([]);

  // Independent of core's walk: roots in flat order, children by contentIds.
  const walk = (block: Block): string[] => [block.id, ...block.contentIds.flatMap(id => walk(h.get(id)))];

  expect(blocks.filter(block => block.parentId === null).flatMap(walk), context).toEqual(h.ids());
  expect(h.store.idIndexViolations(), context).toEqual([]);

  blocks.forEach(parent => {
    expect(parent.contentIds, `${context}: contentIds of ${parent.id}`)
      .toEqual(blocks.filter(block => block.parentId === parent.id).map(block => block.id));
  });

  const slots = new Map<Element, string[]>();

  blocks.forEach(block => {
    const home = expectedHome(byId, block.parentId);

    if (home !== 'self') {
      const slot = home ?? workingArea;

      slots.set(slot, [...(slots.get(slot) ?? []), block.id]);
    } else {
      const table = block.parentId === null ? undefined : byId.get(block.parentId);

      expect(table?.holder.contains(block.holder), `${context}: ${block.id} stays in its table`).toBe(true);
    }
  });

  slots.forEach((expected, slot) => {
    expect(holderIds(slot), `${context}: holders in the slot of ${slot === workingArea ? 'root' : String(slot.parentElement?.getAttribute('data-blok-id'))}`)
      .toEqual(expected);
  });
};

describe('BlockHierarchy.placeBlock', () => {
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

  describe('data', () => {
    it('makes the block the first child when afterId is null', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 'a', parentId: 't' },
        { id: 'x' },
      ]);

      h.hierarchy.placeBlock(h.get('x'), { parentId: 't', afterId: null });

      expect(h.ids()).toEqual(['t', 'x', 'a']);
      expect(h.get('t').contentIds).toEqual(['x', 'a']);
      expect(h.get('x').parentId).toBe('t');
      expect(holderIds(h.slotOf('t'))).toEqual(['x', 'a']);
      expectConsistent(h, workingArea, 'first child');
    });

    it('puts a first root at the start of the document', () => {
      const h = build(workingArea, [
        { id: 'a' },
        { id: 'b' },
      ]);

      h.hierarchy.placeBlock(h.get('b'), { parentId: null, afterId: null });

      expect(h.ids()).toEqual(['b', 'a']);
      expect(holderIds(workingArea)).toEqual(['b', 'a']);
    });

    it('reorders children of one parent in contentIds too', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 'a', parentId: 't' },
        { id: 'b', parentId: 't' },
        { id: 'c', parentId: 't' },
      ]);

      h.hierarchy.placeBlock(h.get('a'), { parentId: 't', afterId: 'c' });

      expect(h.get('t').contentIds).toEqual(['b', 'c', 'a']);
      expect(h.ids()).toEqual(['t', 'b', 'c', 'a']);
      expectConsistent(h, workingArea, 'same-parent reorder');
    });

    it('carries the whole subtree down, past the next sibling\'s subtree', () => {
      const h = build(workingArea, [
        { id: 'a', kind: 'toggle' },
        { id: 'a1', parentId: 'a' },
        { id: 'b', kind: 'callout' },
        { id: 'b1', parentId: 'b' },
        { id: 'c' },
      ]);

      h.hierarchy.placeBlock(h.get('a'), { parentId: null, afterId: 'b' });

      expect(h.ids()).toEqual(['b', 'b1', 'a', 'a1', 'c']);
      expectConsistent(h, workingArea, 'subtree down');
    });

    it('carries the whole subtree up and across into another container', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 't1', parentId: 't' },
        { id: 'x' },
        { id: 'p', kind: 'callout' },
        { id: 'p1', parentId: 'p' },
        { id: 'p2', parentId: 'p1' },
      ]);

      h.hierarchy.placeBlock(h.get('p'), { parentId: 't', afterId: null });

      expect(h.ids()).toEqual(['t', 'p', 'p1', 'p2', 't1', 'x']);
      expect(holderIds(h.slotOf('t'))).toEqual(['p', 't1']);
      expectConsistent(h, workingArea, 'subtree across');
    });

    it('lists a stale parent\'s unlisted children before placing after one of them', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 'a', parentId: 't' },
        { id: 'b', parentId: 't' },
        { id: 'x' },
      ]);

      h.get('t').contentIds = ['a'];
      h.hierarchy.placeBlock(h.get('x'), { parentId: 't', afterId: 'b' });

      expect(h.get('t').contentIds).toEqual(['a', 'b', 'x']);
      expectConsistent(h, workingArea, 'stale contentIds');
    });

    it('re-indents the moved subtree', () => {
      const h = build(workingArea, [
        { id: 'p' },
        { id: 'x' },
        { id: 'y', parentId: 'x' },
      ]);

      h.hierarchy.placeBlock(h.get('x'), { parentId: 'p', afterId: null });

      expect(h.get('x').holder.getAttribute('data-blok-depth')).toBe('1');
      expect(h.get('y').holder.getAttribute('data-blok-depth')).toBe('2');
    });

    it('does not notify the parent-change listener', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 'x' },
      ]);

      h.hierarchy.placeBlock(h.get('x'), { parentId: 't', afterId: null });

      expect(h.onParentChanged).not.toHaveBeenCalled();
    });
  });

  describe('with dom: false', () => {
    it('writes the model only, even without a blocks store', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 'a', parentId: 't' },
        { id: 'x' },
        { id: 'y', parentId: 'x' },
      ], false);
      const html = workingArea.innerHTML;

      h.hierarchy.placeBlock(h.get('x'), { parentId: 't', afterId: 'a' }, { dom: false });

      expect(h.ids()).toEqual(['t', 'a', 'x', 'y']);
      expect(h.get('t').contentIds).toEqual(['a', 'x']);
      expect(h.get('x').parentId).toBe('t');
      expect(workingArea.innerHTML).toBe(html);
    });

    it('does not refuse a home slot inside the moved holder, since it mounts nothing', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 'b' },
      ]);

      h.get('b').holder.appendChild(h.get('t').holder);
      h.hierarchy.placeBlock(h.get('b'), { parentId: 't', afterId: null }, { dom: false });

      expect(h.get('b').parentId).toBe('t');
      expect(h.ids()).toEqual(['t', 'b']);
    });
  });

  describe('home slots', () => {
    it('puts a child of a slotless paragraph in the paragraph\'s own slot, after its earlier children', () => {
      const h = build(workingArea, [
        { id: 'p' },
        { id: 'p1', parentId: 'p' },
        { id: 'z' },
        { id: 'x' },
      ]);

      h.hierarchy.placeBlock(h.get('x'), { parentId: 'p', afterId: 'p1' });

      expect(h.ids()).toEqual(['p', 'p1', 'x', 'z']);
      expect(holderIds(workingArea)).toEqual(['p', 'p1', 'x', 'z']);
      expectConsistent(h, workingArea, 'slotless parent');
    });

    it('shares a toggle\'s slot for children of a paragraph inside it', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 'p', parentId: 't' },
        { id: 'q', parentId: 't' },
        { id: 'x' },
      ]);

      h.hierarchy.placeBlock(h.get('x'), { parentId: 'p', afterId: null });

      expect(holderIds(h.slotOf('t'))).toEqual(['p', 'x', 'q']);
      expectConsistent(h, workingArea, 'grandparent slot');
    });

    it('brings a slotless block\'s children along into the new slot', () => {
      const h = build(workingArea, [
        { id: 't', kind: 'toggle' },
        { id: 'p' },
        { id: 'p1', parentId: 'p' },
        { id: 'p2', parentId: 'p1' },
      ]);

      h.hierarchy.placeBlock(h.get('p'), { parentId: 't', afterId: null });

      expect(holderIds(h.slotOf('t'))).toEqual(['p', 'p1', 'p2']);
      expect(holderIds(workingArea)).toEqual(['t']);
      expectConsistent(h, workingArea, 'slotless carry');
    });

    it('moves a slotless block with children earlier in the same slot', () => {
      const h = build(workingArea, [
        { id: 'a' },
        { id: 'b' },
        { id: 'p' },
        { id: 'p1', parentId: 'p' },
        { id: 'c' },
      ]);

      h.hierarchy.placeBlock(h.get('p'), { parentId: null, afterId: 'a' });

      expect(holderIds(workingArea)).toEqual(['a', 'p', 'p1', 'b', 'c']);
      expectConsistent(h, workingArea, 'same slot earlier');
    });
  });

  describe('tables and databases', () => {
    it('leaves the DOM alone for a block joining a table', () => {
      const h = build(workingArea, [
        { id: 'tbl', kind: 'table' },
        { id: 'c1', parentId: 'tbl' },
        { id: 'x' },
      ]);
      const cell = h.get('c1').holder.parentElement;

      h.hierarchy.placeBlock(h.get('x'), { parentId: 'tbl', afterId: 'c1' });

      expect(h.ids()).toEqual(['tbl', 'c1', 'x']);
      expect(h.get('tbl').contentIds).toEqual(['c1', 'x']);
      expect(h.get('x').holder.parentElement).toBe(workingArea);
      expect(cell !== null && holderIds(cell)).toEqual(['c1']);
    });

    it('leaves a table child\'s holder in its cell when it is reordered', () => {
      const h = build(workingArea, [
        { id: 'tbl', kind: 'table' },
        { id: 'c1', parentId: 'tbl' },
        { id: 'c2', parentId: 'tbl' },
      ]);
      const cell = h.get('c1').holder.parentElement;

      h.hierarchy.placeBlock(h.get('c1'), { parentId: 'tbl', afterId: 'c2' });

      expect(h.ids()).toEqual(['tbl', 'c2', 'c1']);
      expect(cell !== null && holderIds(cell)).toEqual(['c1', 'c2']);
    });

    it('leaves the DOM alone for a child of a slotless block inside a table', () => {
      const h = build(workingArea, [
        { id: 'tbl', kind: 'table' },
        { id: 'c1', parentId: 'tbl' },
        { id: 'x' },
      ]);

      h.hierarchy.placeBlock(h.get('x'), { parentId: 'c1', afterId: null });

      expect(h.ids()).toEqual(['tbl', 'c1', 'x']);
      expect(h.get('x').holder.parentElement).toBe(workingArea);
    });

    it('moves a table with its cell blocks inside it', () => {
      const h = build(workingArea, [
        { id: 'a' },
        { id: 'tbl', kind: 'table' },
        { id: 'c1', parentId: 'tbl' },
      ]);
      const cell = h.get('c1').holder.parentElement;

      h.hierarchy.placeBlock(h.get('tbl'), { parentId: null, afterId: null });

      expect(h.ids()).toEqual(['tbl', 'c1', 'a']);
      expect(holderIds(workingArea)).toEqual(['tbl', 'a']);
      expect(h.get('c1').holder.parentElement).toBe(cell);
    });

    it('treats a database like a table', () => {
      const h = build(workingArea, [
        { id: 'db', kind: 'callout' },
        { id: 'r1', parentId: 'db' },
        { id: 'x' },
      ]);
      const db = h.get('db');

      Object.assign(db, { name: 'database' });
      h.hierarchy.placeBlock(h.get('x'), { parentId: 'db', afterId: 'r1' });

      expect(h.ids()).toEqual(['db', 'r1', 'x']);
      expect(h.get('x').holder.parentElement).toBe(workingArea);
    });
  });

  describe('refusals leave everything unchanged', () => {
    const specs: Spec[] = [
      { id: 't', kind: 'toggle' },
      { id: 'a', parentId: 't' },
      { id: 'a1', parentId: 'a' },
      { id: 'b' },
    ];

    const expectRefused = (place: (h: Harness) => void, message: RegExp, corrupt?: (h: Harness) => void): void => {
      const h = build(workingArea, specs);

      corrupt?.(h);
      const before = {
        ids: h.ids(),
        contentIds: h.store.blocks.map(block => [...block.contentIds]),
        parentIds: h.store.blocks.map(block => block.parentId),
        html: workingArea.innerHTML,
      };

      expect(() => place(h)).toThrow(message);
      expect(h.ids()).toEqual(before.ids);
      expect(h.store.blocks.map(block => block.contentIds)).toEqual(before.contentIds);
      expect(h.store.blocks.map(block => block.parentId)).toEqual(before.parentIds);
      expect(workingArea.innerHTML).toBe(before.html);
    };

    it('refuses a cycle', () => {
      expectRefused(h => h.hierarchy.placeBlock(h.get('t'), { parentId: 'a1', afterId: null }), /cycle/);
      expectRefused(h => h.hierarchy.placeBlock(h.get('a'), { parentId: 'a', afterId: null }), /cycle/);
    });

    it('refuses a home slot inside the moved block\'s own holder', () => {
      expectRefused(
        h => h.hierarchy.placeBlock(h.get('b'), { parentId: 't', afterId: null }),
        /inside its own holder/,
        h => h.get('b').holder.appendChild(h.get('t').holder)
      );
    });

    it('refuses a sibling that is not a child of the parent', () => {
      expectRefused(h => h.hierarchy.placeBlock(h.get('b'), { parentId: 't', afterId: 'a1' }), /not a child/);
    });

    it('refuses the block itself as its previous sibling', () => {
      expectRefused(h => h.hierarchy.placeBlock(h.get('a'), { parentId: 't', afterId: 'a' }), /"a"/);
    });

    it('refuses an unknown parent', () => {
      expectRefused(h => h.hierarchy.placeBlock(h.get('b'), { parentId: 'ghost', afterId: null }), /ghost/);
    });

    it('refuses a block the store does not hold', () => {
      expectRefused(h => h.hierarchy.placeBlock(makeBlock({ id: 'stale' }), { parentId: null, afterId: null }), /stale/);
    });

    it('refuses to run without a blocks store to mount into', () => {
      const h = build(workingArea, specs, false);

      expect(() => h.hierarchy.placeBlock(h.get('b'), { parentId: null, afterId: null })).toThrow(/store/);
    });
  });

  describe('seeded random trees', () => {
    const SEEDS = 120;
    const MOVES_PER_SEED = 6;

    /**
     * Paragraphs, toggles, callouts and tables nested up to three levels, in
     * depth-first order. A table holds only childless paragraphs, as its cells do.
     */
    const randomSpecs = (random: () => number): Spec[] => {
      const specs: Spec[] = [];
      let counter = 0;
      const kinds: Kind[] = ['paragraph', 'paragraph', 'toggle', 'callout', 'table'];

      const make = (parentId: string | null, depth: number, inTable = false): void => {
        const kind = inTable ? 'paragraph' : kinds[Math.floor(random() * kinds.length)];
        const spec: Spec = { id: `b${counter++}`, kind, parentId };

        specs.push(spec);
        const childCount = depth >= 3 || inTable ? 0 : Math.floor(random() * 3) + (kind === 'table' ? 1 : 0);

        for (let i = 0; i < childCount; i++) {
          make(spec.id, depth + 1, kind === 'table');
        }
      };

      const roots = 2 + Math.floor(random() * 3);

      for (let i = 0; i < roots; i++) {
        make(null, 0);
      }

      return specs;
    };

    it('keeps flat order, tree order, contentIds and home slots in step', () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const random = rng(seed);
        const h = build(workingArea, randomSpecs(random));

        expectConsistent(h, workingArea, `seed ${seed} start`);

        for (let move = 0; move < MOVES_PER_SEED; move++) {
          const blocks = h.store.blocks;
          const block = blocks[Math.floor(random() * blocks.length)];
          const isInSubtree = (candidate: Block): boolean =>
            candidate === block || (candidate.parentId !== null && isInSubtree(h.get(candidate.parentId)));
          // Placing into a table is the table's job (it picks the cell): the
          // caller hands the holder over, so random moves never target one.
          const isTableOrCell = (candidate: Block): boolean =>
            candidate.name === 'table' || (candidate.parentId !== null && h.get(candidate.parentId).name === 'table');
          const parents = [null, ...blocks.filter(candidate => !isInSubtree(candidate) && !isTableOrCell(candidate))];
          const parent = parents[Math.floor(random() * parents.length)];
          const parentId = parent === null ? null : parent.id;
          const siblings = blocks.filter(candidate => candidate.parentId === parentId && candidate !== block);
          const after = [null, ...siblings][Math.floor(random() * (siblings.length + 1))];
          const placement: TreePlacement = { parentId, afterId: after === null ? null : after.id };
          const context = `seed ${seed} move ${move}: ${block.id} -> ${JSON.stringify(placement)}`;

          h.hierarchy.placeBlock(block, placement);

          expect(placementImpliedByFlat(h.store, block), context).toEqual(placement);
          expectConsistent(h, workingArea, context);
        }

        workingArea.replaceChildren();
      }
    });
  });
});

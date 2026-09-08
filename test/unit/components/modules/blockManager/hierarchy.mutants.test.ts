import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockHierarchy } from '../../../../../src/components/modules/blockManager/hierarchy';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import type * as HtmlUtils from '../../../../../src/components/utils/html';
import { moveElementAfter } from '../../../../../src/components/utils/html';

/**
 * The DOM-move helpers keep their real behaviour; only `moveElementAfter` is
 * wrapped so a test can assert that a reparent performed NO extractive move.
 * That intermediate detach is invisible in the final DOM — the mount branch at
 * the end of setBlockParent puts the holder back — so it is the only way to
 * pin "re-asserting the same parent does not yank the child out".
 */
vi.mock('../../../../../src/components/utils/html', async (importOriginal) => {
  const actual = await importOriginal<typeof HtmlUtils>();

  return {
    ...actual,
    moveElementAfter: vi.fn(actual.moveElementAfter),
  };
});

/*
 * Mutants of hierarchy.ts that no test can kill, and why. Each is a real
 * behaviour-preserving edit, not a coverage hole — do not chase them.
 *
 * `repository.getBlockById(null)` is `blocks.find(b => b.id === null)`, i.e.
 * always `undefined`, because a Block id is a string. So every `x !== null`
 * guard that only decides whether to make that lookup is inert:
 *   - getBlockDepth's `parentId === null` early return (both the condition and
 *     its body): falling through looks the null up, misses, and returns the
 *     same depth.
 *   - wouldFormCycle's `cursor === null` early return (same shape).
 *   - hasColumnAncestor's `parentId === null` half of its bail-out.
 *   - `oldParentId !== null ? getBlockById(...)` and
 *     `sanitizedParentId !== null ? getBlockById(...)`, which both yield
 *     `undefined` either way.
 *
 * `Node.contains(null)` is false per DOM, so forcing `newContainer !== null`
 * true in strandedInAncestorContainer / wouldNestInsideItself leaves both
 * flags false.
 *
 * strandedInAncestorContainer and strandedInDescendantContainer are read ONLY
 * by claimedByOtherContainer, which already requires
 * `currentNestedContainer !== newContainer`. Forcing that same comparison true
 * INSIDE either flag therefore cannot change the outcome.
 *
 * `sanitizedParentId !== null` and `newParent !== undefined` are the same
 * predicate: a non-null sanitizedParentId means parentExists, so the very same
 * getBlockById lookup that proved it also defines newParent. Swapping their
 * `&&` for `||`, or dropping either operand, keeps both guards identical.
 *
 * childSlotForFlatOrder: `flatIndexById.get(block.id) ?? -1` never falls back —
 * setBlockParent's entry guard proves the block is in `repository.blocks`, the
 * exact array the map is built from. And `siblingIndex < flatIndex` can never
 * be `<=`: distinct ids get distinct last-occurrence indices, and the block's
 * own id is excluded by the `contentIds.includes(block.id)` guard above.
 *
 * `newParentId !== null && wouldFormCycle(...)` forced true just calls
 * wouldFormCycle with a null target, which returns false on its first step.
 *
 * `getBlockDepth`'s `block.id !== undefined` seed guard forced true is a no-op
 * for a real block, and even for an id-less one both variants return the same
 * depth (one bails on `visited.has(undefined)`, the other on a missed lookup).
 *
 * The `else if (oldParent !== undefined)` anchor fallback forced true is
 * unreachable-as-a-difference: that branch runs only when `oldContainer` is
 * truthy, which already required `oldParent !== undefined`.
 *
 * isColumnContainer's SECOND `?.` (`container?.parentElement.matches`) needs a
 * connected element with no parentElement. Its two call sites pass either a
 * container that passed `.isConnected`, or a querySelector hit inside a
 * holder — both always have a parent.
 */

interface FixtureBlockConfig {
  id: string;
  parentId?: string | null;
  contentIds?: string[];
  name?: string;
}

interface Fixture {
  repository: BlockRepository;
  workingArea: HTMLElement;
}

const workingAreas: HTMLElement[] = [];

/**
 * Builds a minimal Block stand-in with the hierarchy surface the module reads.
 * @param config - id, parent link, children and tool name of the block
 * @returns a Block-shaped object backed by a real holder element
 */
const createMockBlock = (config: FixtureBlockConfig): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id: config.id,
    name: config.name ?? 'paragraph',
    holder,
    parentId: config.parentId ?? null,
    contentIds: config.contentIds ?? [],
    call: vi.fn(),
  } as unknown as Block;
};

/**
 * Creates a repository over a real Blocks store whose working area is IN the
 * document — `currentNestedContainer.isConnected` gates the anti-stealing
 * guard, so a detached fixture silently skips the branch under test.
 * @param configs - blocks to push, in flat-array order
 * @returns the repository plus its working area
 */
const createFixture = (configs: FixtureBlockConfig[]): Fixture => {
  const workingArea = document.createElement('div');

  document.body.appendChild(workingArea);
  workingAreas.push(workingArea);

  const store = new Blocks(workingArea);

  for (const config of configs) {
    store.push(createMockBlock(config));
  }

  const repository = new BlockRepository();

  repository.initialize(store as BlocksStore);

  return {
    repository,
    workingArea,
  };
};

/**
 * @param repository - repository to look the block up in
 * @param id - block id
 * @returns the block, or throws when the fixture is wrong
 */
const requireBlock = (repository: BlockRepository, id: string): Block => {
  const block = repository.getBlockById(id);

  if (block === undefined) {
    throw new Error(`Fixture is missing block "${id}"`);
  }

  return block;
};

/**
 * @param attribute - attribute to stamp on the created element
 * @returns a fresh div carrying that attribute
 */
const createContainer = (attribute: string): HTMLElement => {
  const container = document.createElement('div');

  container.setAttribute(attribute, '');

  return container;
};

/**
 * Gives a column block the real DOM shape the module keys off: a
 * [data-blok-column] wrapper whose direct child is the nested-blocks slot.
 * @param column - the column block to build the wrapper into
 * @returns the column's child container
 */
const buildColumn = (column: Block): HTMLElement => {
  const wrapper = createContainer('data-blok-column');
  const container = createContainer('data-blok-nested-blocks');

  wrapper.appendChild(container);
  column.holder.appendChild(wrapper);

  return container;
};

describe('BlockHierarchy — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    while (workingAreas.length > 0) {
      workingAreas.pop()?.remove();
    }
  });

  describe('getBlockDepth', () => {
    it('seeds the visited set with the block itself, so a self-parent stays depth 0', () => {
      const { repository } = createFixture([{ id: 'self', parentId: 'self' }]);
      const hierarchy = new BlockHierarchy(repository);

      expect(hierarchy.getBlockDepth(requireBlock(repository, 'self'))).toBe(0);
    });

    it('records every ancestor it walks, so a loop ABOVE the block still terminates', () => {
      const { repository } = createFixture([
        { id: 'x', parentId: 'a' },
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      let depth = -1;

      expect(() => {
        depth = hierarchy.getBlockDepth(requireBlock(repository, 'x'));
      }).not.toThrow();
      expect(depth).toBe(2);
    });
  });

  describe('setBlockParent — cycle guard', () => {
    it('refuses a target whose ancestor chain already loops, instead of walking it forever', () => {
      const { repository } = createFixture([
        { id: 'mover', parentId: null },
        { id: 'target', parentId: 'a' },
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ]);
      const hierarchy = new BlockHierarchy(repository);

      expect(() => hierarchy.setBlockParent(requireBlock(repository, 'mover'), 'target')).toThrow(
        /refusing to form cycle/
      );
    });
  });

  describe('setBlockParent — dangling parent guard', () => {
    it('names both the dangling parent and the block in the message', () => {
      const { repository } = createFixture([{ id: 'child', parentId: null }]);
      const hierarchy = new BlockHierarchy(repository);

      expect(() => hierarchy.setBlockParent(requireBlock(repository, 'child'), 'ghost-parent')).toThrow(
        /dangling parent id "ghost-parent" for block "child"/
      );
    });

    it('throws in development too, not only under NODE_ENV=test', async () => {
      const { repository } = createFixture([{ id: 'child', parentId: null }]);
      const hierarchy = new BlockHierarchy(repository);
      const utils = await import('../../../../../src/components/utils');

      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const previous = process.env.NODE_ENV;

      process.env.NODE_ENV = 'development';

      try {
        expect(() => hierarchy.setBlockParent(requireBlock(repository, 'child'), 'ghost-parent')).toThrow(
          /dangling parent id/
        );
      } finally {
        process.env.NODE_ENV = previous;
      }
    });

    it('coerces instead of throwing when there is no process global at all', async () => {
      const { repository } = createFixture([{ id: 'child', parentId: null }]);
      const hierarchy = new BlockHierarchy(repository);
      const utils = await import('../../../../../src/components/utils');
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
      const child = requireBlock(repository, 'child');
      let thrown: unknown = null;

      // Asserted after the global is restored: a failing expect() inside the
      // stubbed window would itself run without `process`.
      vi.stubGlobal('process', undefined);

      try {
        hierarchy.setBlockParent(child, 'ghost-parent');
      } catch (error) {
        thrown = error;
      } finally {
        vi.unstubAllGlobals();
      }

      expect(thrown).toBeNull();
      expect(child.parentId).toBeNull();
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/dangling parent id/), 'error');
    });

    it('coerces instead of throwing when the process global carries no env', async () => {
      const { repository } = createFixture([{ id: 'child', parentId: null }]);
      const hierarchy = new BlockHierarchy(repository);
      const utils = await import('../../../../../src/components/utils');
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
      const child = requireBlock(repository, 'child');
      let thrown: unknown = null;

      vi.stubGlobal('process', {});

      try {
        hierarchy.setBlockParent(child, 'ghost-parent');
      } catch (error) {
        thrown = error;
      } finally {
        vi.unstubAllGlobals();
      }

      expect(thrown).toBeNull();
      expect(child.parentId).toBeNull();
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/dangling parent id/), 'error');
    });
  });

  describe('setBlockParent — contentIds slot', () => {
    it('ignores a contentIds entry that is not in the flat array when picking the slot', () => {
      const { repository } = createFixture([
        { id: 'parent', parentId: null, contentIds: ['ghost'] },
        { id: 'other', parentId: null },
        { id: 'mover', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);

      hierarchy.setBlockParent(requireBlock(repository, 'mover'), 'parent');

      expect(requireBlock(repository, 'parent').contentIds).toStrictEqual(['mover', 'ghost']);
    });

    it('lands the child between the siblings its flat position implies', () => {
      const { repository } = createFixture([
        { id: 'parent', parentId: null, contentIds: ['c1', 'c2'] },
        { id: 'c1', parentId: 'parent' },
        { id: 'mover', parentId: null },
        { id: 'c2', parentId: 'parent' },
      ]);
      const hierarchy = new BlockHierarchy(repository);

      hierarchy.setBlockParent(requireBlock(repository, 'mover'), 'parent');

      expect(requireBlock(repository, 'parent').contentIds).toStrictEqual(['c1', 'mover', 'c2']);
    });
  });

  describe('setBlockParent — collapsed parent detection', () => {
    it('does not hide the new child when only SOME existing children are hidden', () => {
      const { repository } = createFixture([
        { id: 'toggle', parentId: null, contentIds: ['visible', 'collapsed'] },
        { id: 'visible', parentId: 'toggle' },
        { id: 'collapsed', parentId: 'toggle' },
        { id: 'mover', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const mover = requireBlock(repository, 'mover');

      requireBlock(repository, 'collapsed').holder.classList.add('hidden');

      hierarchy.setBlockParent(mover, 'toggle');

      expect(mover.holder.classList.contains('hidden')).toBe(false);
      expect(requireBlock(repository, 'toggle').contentIds).toStrictEqual([
        'visible',
        'collapsed',
        'mover',
      ]);
    });
  });

  describe('setBlockParent — leaving a toggle container', () => {
    it('leaves the holder in place when the reparent re-asserts the parent it already has', () => {
      const { repository, workingArea } = createFixture([
        { id: 'toggle', parentId: null, contentIds: ['child'] },
        { id: 'child', parentId: 'toggle' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const toggle = requireBlock(repository, 'toggle');
      const child = requireBlock(repository, 'child');
      const container = createContainer('data-blok-toggle-children');

      toggle.holder.appendChild(container);
      container.appendChild(child.holder);

      hierarchy.setBlockParent(child, 'toggle');

      expect(vi.mocked(moveElementAfter)).not.toHaveBeenCalled();
      expect(child.holder.parentElement).toBe(container);
      expect(toggle.contentIds).toStrictEqual(['child']);
      expect(Array.from(workingArea.children)).toStrictEqual([toggle.holder]);
    });

    it('leaves the holder in place when it is not inside the old toggle container', () => {
      const { repository, workingArea } = createFixture([
        { id: 'toggle', parentId: null, contentIds: ['child'] },
        { id: 'x', parentId: null },
        { id: 'child', parentId: 'toggle' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const toggle = requireBlock(repository, 'toggle');
      const x = requireBlock(repository, 'x');
      const child = requireBlock(repository, 'child');

      toggle.holder.appendChild(createContainer('data-blok-toggle-children'));
      workingArea.insertBefore(child.holder, x.holder);

      hierarchy.setBlockParent(child, null);

      expect(Array.from(workingArea.children)).toStrictEqual([toggle.holder, child.holder, x.holder]);
      expect(vi.mocked(moveElementAfter)).not.toHaveBeenCalled();
      expect(toggle.contentIds).toStrictEqual([]);
    });

    it('anchors the extracted child on the nearest PRECEDING block that is outside the toggle', () => {
      const { repository, workingArea } = createFixture([
        { id: 'toggle', parentId: null, contentIds: ['childD', 'child'] },
        { id: 'childD', parentId: 'toggle' },
        { id: 'child', parentId: 'toggle' },
        { id: 'tail', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const toggle = requireBlock(repository, 'toggle');
      const childD = requireBlock(repository, 'childD');
      const child = requireBlock(repository, 'child');
      const tail = requireBlock(repository, 'tail');
      const container = createContainer('data-blok-toggle-children');

      toggle.holder.appendChild(container);
      container.appendChild(childD.holder);
      container.appendChild(child.holder);

      hierarchy.setBlockParent(child, null);

      expect(Array.from(workingArea.children)).toStrictEqual([
        toggle.holder,
        child.holder,
        tail.holder,
      ]);
      expect(Array.from(container.children)).toStrictEqual([childD.holder]);
    });

    it('falls back to the old parent holder when nothing precedes the extracted child', () => {
      const { repository, workingArea } = createFixture([
        { id: 'child', parentId: 'toggle' },
        { id: 'toggle', parentId: null, contentIds: ['child'] },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const toggle = requireBlock(repository, 'toggle');
      const child = requireBlock(repository, 'child');
      const container = createContainer('data-blok-toggle-children');

      toggle.holder.appendChild(container);
      container.appendChild(child.holder);

      expect(() => hierarchy.setBlockParent(child, null)).not.toThrow();
      expect(Array.from(workingArea.children)).toStrictEqual([toggle.holder, child.holder]);
      expect(Array.from(container.children)).toStrictEqual([]);
    });
  });

  describe('setBlockParent — container claim guards', () => {
    it('moves a holder from one column container into another', () => {
      const { repository } = createFixture([
        { id: 'col-a', parentId: null, name: 'column', contentIds: ['moving'] },
        { id: 'moving', parentId: 'col-a' },
        { id: 'col-b', parentId: null, name: 'column' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const moving = requireBlock(repository, 'moving');
      const containerA = buildColumn(requireBlock(repository, 'col-a'));
      const containerB = buildColumn(requireBlock(repository, 'col-b'));

      containerA.appendChild(moving.holder);

      hierarchy.setBlockParent(moving, 'col-b');

      expect(moving.holder.parentElement).toBe(containerB);
      expect(Array.from(containerA.children)).toStrictEqual([]);
      expect(requireBlock(repository, 'col-b').contentIds).toStrictEqual(['moving']);
      expect(requireBlock(repository, 'col-a').contentIds).toStrictEqual([]);
    });

    it('mounts a column into its columns row even when a foreign container holds it', () => {
      const { repository } = createFixture([
        { id: 'list', parentId: null, name: 'column_list', contentIds: [] },
        { id: 'new-col', parentId: null, name: 'column' },
        { id: 'toggle', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const newCol = requireBlock(repository, 'new-col');
      const row = createContainer('data-blok-columns');
      const foreign = createContainer('data-blok-nested-blocks');

      row.setAttribute('data-blok-nested-blocks', '');
      requireBlock(repository, 'list').holder.appendChild(row);
      requireBlock(repository, 'toggle').holder.appendChild(foreign);
      foreign.appendChild(newCol.holder);

      hierarchy.setBlockParent(newCol, 'list');

      expect(newCol.holder.parentElement).toBe(row);
      expect(Array.from(foreign.children)).toStrictEqual([]);
    });

    it('refuses to steal a holder out of a column container into a foreign toggle', () => {
      const { repository } = createFixture([
        { id: 'col', parentId: null, name: 'column', contentIds: ['moving'] },
        { id: 'moving', parentId: 'col' },
        { id: 'toggle', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const moving = requireBlock(repository, 'moving');
      const container = buildColumn(requireBlock(repository, 'col'));
      const toggleContainer = createContainer('data-blok-toggle-children');

      requireBlock(repository, 'toggle').holder.appendChild(toggleContainer);
      container.appendChild(moving.holder);

      hierarchy.setBlockParent(moving, 'toggle');

      expect(moving.holder.parentElement).toBe(container);
      expect(Array.from(toggleContainer.children)).toStrictEqual([]);
      expect(requireBlock(repository, 'toggle').contentIds).toStrictEqual(['moving']);
    });

    it('handles a destination parent that has no child container at all', () => {
      const { repository } = createFixture([
        { id: 'col', parentId: null, name: 'column', contentIds: ['moving'] },
        { id: 'moving', parentId: 'col' },
        { id: 'plain', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const moving = requireBlock(repository, 'moving');
      const container = buildColumn(requireBlock(repository, 'col'));

      container.appendChild(moving.holder);

      expect(() => hierarchy.setBlockParent(moving, 'plain')).not.toThrow();
      expect(moving.holder.parentElement).toBe(container);
      expect(requireBlock(repository, 'plain').contentIds).toStrictEqual(['moving']);
    });

    it('re-orders a holder that is ALREADY in the destination container to its flat slot', () => {
      const { repository } = createFixture([
        { id: 'toggle', parentId: null, contentIds: ['first', 'second'] },
        { id: 'first', parentId: 'toggle' },
        { id: 'second', parentId: 'toggle' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const toggle = requireBlock(repository, 'toggle');
      const first = requireBlock(repository, 'first');
      const second = requireBlock(repository, 'second');
      const container = createContainer('data-blok-toggle-children');

      // Both markers: the destination container must ALSO be what
      // `closest([data-blok-nested-blocks])` resolves to for the holder, so the
      // anti-stealing guard sees "same container", not "no container".
      container.setAttribute('data-blok-nested-blocks', '');
      toggle.holder.appendChild(container);
      container.appendChild(second.holder);
      container.appendChild(first.holder);

      hierarchy.setBlockParent(first, 'toggle');

      expect(Array.from(container.children)).toStrictEqual([first.holder, second.holder]);
    });

    it('mounts a holder that is in no container yet into the parent container', () => {
      const { repository } = createFixture([
        { id: 'toggle', parentId: null },
        { id: 'mover', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const mover = requireBlock(repository, 'mover');
      const container = createContainer('data-blok-toggle-children');

      requireBlock(repository, 'toggle').holder.appendChild(container);

      expect(() => hierarchy.setBlockParent(mover, 'toggle')).not.toThrow();
      expect(mover.holder.parentElement).toBe(container);
    });
  });

  describe('setBlockParent — escaping a columns layout for root', () => {
    it('leaves the DOM alone for a root-to-root reparent outside any columns layout', () => {
      const { repository, workingArea } = createFixture([
        { id: 'a', parentId: null },
        { id: 'b', parentId: null },
        { id: 'c', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const a = requireBlock(repository, 'a');
      const b = requireBlock(repository, 'b');
      const c = requireBlock(repository, 'c');

      workingArea.appendChild(b.holder);

      hierarchy.setBlockParent(b, null);

      expect(Array.from(workingArea.children)).toStrictEqual([a.holder, c.holder, b.holder]);
    });

    it('anchors the escapee on the nearest preceding holder that is outside every nested container', () => {
      const { repository, workingArea } = createFixture([
        { id: 'top', parentId: null },
        { id: 'list', parentId: null, name: 'column_list', contentIds: ['col'] },
        { id: 'col', parentId: 'list', name: 'column', contentIds: ['inner', 'escapee'] },
        { id: 'inner', parentId: 'col' },
        { id: 'escapee', parentId: 'col' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const top = requireBlock(repository, 'top');
      const list = requireBlock(repository, 'list');
      const col = requireBlock(repository, 'col');
      const inner = requireBlock(repository, 'inner');
      const escapee = requireBlock(repository, 'escapee');
      const row = createContainer('data-blok-columns');
      const container = buildColumn(col);

      row.setAttribute('data-blok-nested-blocks', '');
      list.holder.appendChild(row);
      row.appendChild(col.holder);
      container.appendChild(inner.holder);
      container.appendChild(escapee.holder);

      hierarchy.setBlockParent(escapee, null);

      expect(Array.from(workingArea.children)).toStrictEqual([
        top.holder,
        list.holder,
        escapee.holder,
      ]);
      expect(Array.from(container.children)).toStrictEqual([inner.holder]);
    });

    it('falls forward to the next root holder when nothing precedes the escapee', () => {
      const { repository, workingArea } = createFixture([
        { id: 'escapee', parentId: null },
        { id: 'r1', parentId: null },
        { id: 'r2', parentId: null },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const escapee = requireBlock(repository, 'escapee');
      const r1 = requireBlock(repository, 'r1');
      const r2 = requireBlock(repository, 'r2');
      const row = createContainer('data-blok-columns');

      workingArea.insertBefore(row, r1.holder);
      row.appendChild(escapee.holder);

      expect(() => hierarchy.setBlockParent(escapee, null)).not.toThrow();
      expect(Array.from(workingArea.children)).toStrictEqual([
        row,
        escapee.holder,
        r1.holder,
        r2.holder,
      ]);
    });

    it('leaves a lone escapee where it is when the document has no root sibling', () => {
      const { repository, workingArea } = createFixture([{ id: 'escapee', parentId: null }]);
      const hierarchy = new BlockHierarchy(repository);
      const escapee = requireBlock(repository, 'escapee');
      const row = createContainer('data-blok-columns');

      workingArea.appendChild(row);
      row.appendChild(escapee.holder);

      expect(() => hierarchy.setBlockParent(escapee, null)).not.toThrow();
      expect(Array.from(row.children)).toStrictEqual([escapee.holder]);
    });
  });

  describe('reindentSubtree', () => {
    it('stops on a contentIds loop instead of recursing forever', () => {
      const { repository } = createFixture([
        { id: 'a', parentId: null, contentIds: ['b'] },
        { id: 'b', parentId: 'a', contentIds: ['a'] },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const a = requireBlock(repository, 'a');
      const b = requireBlock(repository, 'b');

      expect(() => hierarchy.setBlockParent(a, null)).not.toThrow();
      expect(a.holder.getAttribute('data-blok-depth')).toBe('0');
      expect(b.holder.getAttribute('data-blok-depth')).toBe('1');
    });

    it('skips a contentIds entry with no block behind it', () => {
      const { repository } = createFixture([{ id: 'parent', parentId: null, contentIds: ['ghost'] }]);
      const hierarchy = new BlockHierarchy(repository);

      expect(() => hierarchy.setBlockParent(requireBlock(repository, 'parent'), null)).not.toThrow();
    });

    it('hands the descendant list MOVED hook the block index on both ends', () => {
      const { repository } = createFixture([
        { id: 'parent', parentId: null, contentIds: ['li'] },
        { id: 'li', parentId: 'parent', name: 'list' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const li = requireBlock(repository, 'li');

      hierarchy.setBlockParent(requireBlock(repository, 'parent'), null);

      expect(li.call).toHaveBeenCalledWith('moved', {
        fromIndex: 1,
        toIndex: 1,
      });
    });
  });

  describe('updateBlockIndentation — column ancestry', () => {
    it('terminates a parentId loop while looking for a column ancestor', () => {
      const { repository } = createFixture([
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const a = requireBlock(repository, 'a');

      expect(() => hierarchy.updateBlockIndentation(a)).not.toThrow();
      expect(a.holder.getAttribute('data-blok-depth')).toBe('1');
      expect(a.holder.style.getPropertyValue('--_blok-block-depth')).toBe('1');
    });

    it('stops the ancestor walk at a parent id with no block behind it', () => {
      const { repository } = createFixture([
        { id: 'c', parentId: 'p' },
        { id: 'p', parentId: 'ghost' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const c = requireBlock(repository, 'c');

      expect(() => hierarchy.updateBlockIndentation(c)).not.toThrow();
      expect(c.holder.getAttribute('data-blok-depth')).toBe('1');
      expect(c.holder.style.getPropertyValue('--_blok-block-depth')).toBe('1');
    });

    it('keeps a child of a `column` block flush, holder outside the columns DOM', () => {
      const { repository } = createFixture([
        { id: 'col', parentId: null, name: 'column', contentIds: ['c'] },
        { id: 'c', parentId: 'col' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const c = requireBlock(repository, 'c');

      hierarchy.updateBlockIndentation(c);

      expect(c.holder.getAttribute('data-blok-depth')).toBe('0');
      expect(c.holder.style.getPropertyValue('--_blok-block-depth')).toBe('0');
    });

    it('keeps a child of a `column_list` block flush, holder outside the columns DOM', () => {
      const { repository } = createFixture([
        { id: 'list', parentId: null, name: 'column_list', contentIds: ['c'] },
        { id: 'c', parentId: 'list' },
      ]);
      const hierarchy = new BlockHierarchy(repository);
      const c = requireBlock(repository, 'c');

      hierarchy.updateBlockIndentation(c);

      expect(c.holder.getAttribute('data-blok-depth')).toBe('0');
      expect(c.holder.style.getPropertyValue('--_blok-block-depth')).toBe('0');
    });
  });
});

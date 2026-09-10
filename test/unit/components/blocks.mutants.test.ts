import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Blocks } from '../../../src/components/blocks';
import type { Block } from '../../../src/components/block';
import { BlockToolAPI } from '../../../src/components/block';
import { BlockRendered } from '../../../src/components/events';
import type { BlokEventMap } from '../../../src/components/events';
import type { EventsDispatcher } from '../../../src/components/utils/events';

/**
 * Mutation-coverage tests for Blocks.
 *
 * Every test here pins one branch of `src/components/blocks.ts`; the DOM
 * fixtures carry distinct `data-blok-id` values so a wrong-node mutant cannot
 * hide behind structurally equal markup.
 */

const makeBlock = (id: string, parentId: string | null = null): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);

  return makeBlockWithHolder(id, holder, parentId);
};

const makeBlockWithHolder = (
  id: string,
  holder: HTMLElement,
  parentId: string | null = null
): Block => ({
  id,
  name: 'paragraph',
  holder,
  parentId,
  call: vi.fn(),
  destroy: vi.fn(),
  tool: { name: 'paragraph' },
} as unknown as Block);

const makeContainer = (id: string = 'container'): HTMLDivElement => {
  const container = document.createElement('div');

  container.setAttribute('data-blok-id', id);

  return container;
};

const domOrder = (root: HTMLElement): (string | null)[] =>
  Array.from(root.children).map((child) => child.getAttribute('data-blok-id'));

const arrayOrder = (blocks: Blocks): string[] => blocks.array.map((block) => block.id);

const makeDispatcher = (): { emit: ReturnType<typeof vi.fn>; dispatcher: EventsDispatcher<BlokEventMap> } => {
  const emit = vi.fn();

  return { emit, dispatcher: { emit } as unknown as EventsDispatcher<BlokEventMap> };
};

describe('Blocks (mutation coverage)', () => {
  let workingArea: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    workingArea = document.createElement('div');
    workingArea.setAttribute('data-blok-id', 'working-area');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('static proxy traps', () => {
    it('Blocks.set returns true when it stores a non-numeric property through Reflect', () => {
      const blocks = new Blocks(workingArea);

      const result = Blocks.set(blocks, 'customFlag', 'stored');

      expect(result).toBe(true);
      expect((blocks as unknown as { customFlag: string }).customFlag).toBe('stored');
    });

    it('Blocks.set returns true when it routes a numeric property to insert', () => {
      const blocks = new Blocks(workingArea);
      const block = makeBlock('a');

      const result = Blocks.set(blocks, 0, block);

      expect(result).toBe(true);
      expect(blocks.get(0)).toBe(block);
    });

    it('Blocks.get reads a numeric property as a block index', () => {
      const blocks = new Blocks(workingArea);
      const first = makeBlock('first');
      const second = makeBlock('second');

      blocks.push(first);
      blocks.push(second);

      expect(Blocks.get(blocks, 1)).toBe(second);
    });
  });

  describe('move — index guards', () => {
    it('leaves the order untouched when fromIndex equals the array length', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      expect(() => blocks.move(0, 3)).not.toThrow();
      expect(arrayOrder(blocks)).toEqual(['a', 'b', 'c']);
      expect(domOrder(workingArea)).toEqual(['a', 'b', 'c']);
    });

    it('leaves the order untouched when toIndex is negative', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      blocks.move(-1, 1);

      expect(arrayOrder(blocks)).toEqual(['a', 'b', 'c']);
      expect(domOrder(workingArea)).toEqual(['a', 'b', 'c']);
    });

    it('leaves the order untouched when toIndex equals the array length', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      blocks.move(3, 0);

      expect(arrayOrder(blocks)).toEqual(['a', 'b', 'c']);
      expect(domOrder(workingArea)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('move — DOM placement', () => {
    it('moves a block whose holder has no parent element into the working area', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const detached = makeBlock('detached');

      blocks.push(a);
      blocks.push(b);
      blocks.addToArray(2, detached);

      expect(detached.holder.parentElement).toBeNull();

      blocks.move(0, 2);

      expect(workingArea.firstElementChild).toBe(detached.holder);
      expect(arrayOrder(blocks)).toEqual(['detached', 'a', 'b']);
    });

    it('leaves a nested holder inside its container when the block moves in the array', () => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();

      workingArea.appendChild(container);

      const a = makeBlock('a');
      const nested = makeBlock('nested');
      const b = makeBlock('b');

      blocks.push(a);
      blocks.addToArray(1, nested);
      container.appendChild(nested.holder);
      blocks.addToArray(2, b);
      workingArea.appendChild(b.holder);

      expect(domOrder(workingArea)).toEqual(['container', 'a', 'b']);

      blocks.move(0, 1);

      expect(nested.holder.parentElement).toBe(container);
      expect(arrayOrder(blocks)).toEqual(['nested', 'a', 'b']);
      expect(domOrder(workingArea)).toEqual(['container', 'a', 'b']);
    });

    it('leaves the DOM untouched when skipDOM is set', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      blocks.move(0, 2, true);

      expect(arrayOrder(blocks)).toEqual(['c', 'a', 'b']);
      expect(domOrder(workingArea)).toEqual(['a', 'b', 'c']);
    });

    it('anchors the moved holder directly before the block at the target index', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      blocks.move(0, 2);

      expect(arrayOrder(blocks)).toEqual(['c', 'a', 'b']);
      expect(domOrder(workingArea)).toEqual(['c', 'a', 'b']);
    });

    it('appends the moved holder at the end of the working area when the target index is past the array', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      blocks.move(2, 0);

      expect(workingArea.children[2]).toBe(a.holder);
      expect(arrayOrder(blocks)).toEqual(['b', 'c', 'a']);
      expect(domOrder(workingArea)).toEqual(['b', 'c', 'a']);
    });
  });

  describe('move — lifecycle hooks', () => {
    it('re-sorts the nested children of a moved block behind it in the array', () => {
      const blocks = new Blocks(workingArea);
      const toggle = makeBlock('toggle');
      const child = makeBlock('child');
      const sibling = makeBlock('sibling');

      blocks.addToArray(0, toggle);
      blocks.addToArray(1, child);
      toggle.holder.appendChild(child.holder);
      blocks.addToArray(2, sibling);
      workingArea.appendChild(toggle.holder);
      workingArea.appendChild(sibling.holder);

      expect(domOrder(workingArea)).toEqual(['toggle', 'sibling']);

      blocks.move(0, 0);

      expect(arrayOrder(blocks)).toEqual(['toggle', 'child', 'sibling']);
      expect(domOrder(workingArea)).toEqual(['toggle', 'sibling']);
      expect(toggle.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('does not fire the moved hook when skipMovedHook is set', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      blocks.move(0, 2, false, true);

      expect(c.call).not.toHaveBeenCalledWith(BlockToolAPI.MOVED, expect.anything());
      expect(arrayOrder(blocks)).toEqual(['c', 'a', 'b']);
    });

    it('fires the moved hook and the rendered hook for the moved block', () => {
      const { emit, dispatcher } = makeDispatcher();
      const blocks = new Blocks(workingArea, dispatcher);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      // An unmounted holder, so the only rendered hook on `c` is the one move fires.
      blocks.addToArray(2, c);
      workingArea.appendChild(c.holder);

      emit.mockClear();

      blocks.move(0, 2);

      expect(c.call).toHaveBeenCalledWith(BlockToolAPI.MOVED, { fromIndex: 2, toIndex: 0 });
      expect(c.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
      expect(emit).toHaveBeenCalledWith(BlockRendered, { blockId: 'c' });
    });
  });

  describe('insert — empty array path', () => {
    it('places the first block at index 0 and fires its rendered hook', () => {
      const { emit, dispatcher } = makeDispatcher();
      const blocks = new Blocks(workingArea, dispatcher);
      const a = makeBlock('a');

      blocks.insert(0, a);

      expect(blocks.get(0)).toBe(a);
      expect(workingArea.firstElementChild).toBe(a.holder);
      expect(a.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
      expect(emit).toHaveBeenCalledWith(BlockRendered, { blockId: 'a' });
      expect(blocks.length).toBe(1);
    });

    it('clamps an out-of-range index on an empty array to the same slot', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');

      blocks.insert(7, a);

      expect(blocks.get(0)).toBe(a);
      expect(domOrder(workingArea)).toEqual(['a']);
    });
  });

  describe('insert — replace path', () => {
    it('destroys the block it replaces', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const fresh = makeBlock('fresh');

      blocks.push(a);
      blocks.push(b);

      blocks.insert(1, fresh, true);

      expect(b.destroy).toHaveBeenCalledTimes(1);
      expect(b.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
      expect(fresh.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
      expect(workingArea.children[1]).toBe(fresh.holder);
      expect(arrayOrder(blocks)).toEqual(['a', 'fresh']);
    });
  });

  describe('replace', () => {
    it('fires removed and rendered hooks through replace', () => {
      const { emit, dispatcher } = makeDispatcher();
      const blocks = new Blocks(workingArea, dispatcher);
      const a = makeBlock('a');
      const fresh = makeBlock('fresh');

      blocks.push(a);

      blocks.replace(0, fresh);

      expect(a.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
      expect(a.destroy).toHaveBeenCalledTimes(1);
      expect(fresh.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
      expect(emit).toHaveBeenCalledWith(BlockRendered, { blockId: 'fresh' });
      expect(workingArea.firstElementChild).toBe(fresh.holder);
      expect(arrayOrder(blocks)).toEqual(['fresh']);
    });

    it('rejects an index that is not part of the array', () => {
      const blocks = new Blocks(workingArea);

      blocks.push(makeBlock('a'));

      expect(() => blocks.replace(5, makeBlock('fresh'))).toThrowError(new Error('Incorrect index'));
    });
  });

  describe('insert — forceTopLevel at index 0', () => {
    const buildIndexZeroFixture = (): { blocks: Blocks; container: HTMLDivElement; nested: Block; root: Block } => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();
      const nested = makeBlock('nested');
      const root = makeBlock('root');

      workingArea.appendChild(container);
      blocks.addToArray(0, nested);
      blocks.addToArray(1, root);
      container.appendChild(nested.holder);
      workingArea.appendChild(root.holder);

      return { blocks, container, nested, root };
    };

    it('inserts before the flat follower when the flag is not set', () => {
      const { blocks, container, nested } = buildIndexZeroFixture();
      const fresh = makeBlock('fresh');

      blocks.insert(0, fresh);

      expect(fresh.holder.parentElement).toBe(container);
      expect(nested.holder.previousElementSibling).toBe(fresh.holder);
    });

    it('skips a nested follower when forceTopLevel is set', () => {
      const { blocks, root, nested } = buildIndexZeroFixture();
      const fresh = makeBlock('fresh');

      blocks.insert(0, fresh, false, false, true);

      expect(fresh.holder.parentElement).toBe(workingArea);
      expect(root.holder.previousElementSibling).toBe(fresh.holder);
      expect(nested.holder.previousElementSibling).toBeNull();
    });
  });

  describe('insert — successor container routing', () => {
    it('anchors after a root predecessor even when the successor sits outside the working area', () => {
      const isolatedArea = document.createElement('div');

      document.body.appendChild(isolatedArea);

      const blocks = new Blocks(isolatedArea);
      const prev = makeBlock('prev');
      const next = makeBlock('next');

      blocks.addToArray(0, prev);
      blocks.addToArray(1, next);
      isolatedArea.appendChild(prev.holder);
      document.body.appendChild(next.holder);

      const fresh = makeBlock('fresh');

      blocks.insert(1, fresh);

      expect(fresh.holder.parentElement).toBe(isolatedArea);
      expect(prev.holder.nextElementSibling).toBe(fresh.holder);
    });

    it('keeps the new block beside a nested predecessor when the successor is in the same container', () => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();
      const spacer = document.createElement('span');
      const prev = makeBlock('prev');
      const next = makeBlock('next');

      workingArea.appendChild(container);
      spacer.setAttribute('data-blok-id', 'spacer');
      blocks.addToArray(0, prev);
      blocks.addToArray(1, next);
      container.appendChild(prev.holder);
      container.appendChild(spacer);
      container.appendChild(next.holder);

      const fresh = makeBlock('fresh');

      blocks.insert(1, fresh);

      expect(prev.holder.nextElementSibling).toBe(fresh.holder);
      expect(domOrder(container)).toEqual(['prev', 'fresh', 'spacer', 'next']);
    });
  });

  describe('insert — appendToWorkingArea', () => {
    it('appends to the working area when appendToWorkingArea is set', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const fresh = makeBlock('fresh');

      blocks.push(a);

      blocks.insert(1, fresh, false, true);

      expect(workingArea.children[1]).toBe(fresh.holder);
      expect(fresh.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
      expect(arrayOrder(blocks)).toEqual(['a', 'fresh']);
    });
  });

  describe('insertAtRootLevel invariant', () => {
    it('throws when a forced top-level insert cannot land its holder at the working area root', () => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();
      const nested = makeBlock('nested');

      workingArea.appendChild(container);
      blocks.addToArray(0, nested);
      container.appendChild(nested.holder);

      // A DocumentFragment as a holder can never report the working area as its
      // parentElement — appendChild moves a fragment's children, not the fragment.
      const fragmentHolder = document.createDocumentFragment() as unknown as HTMLElement;
      const ghost = makeBlockWithHolder('ghost', fragmentHolder);

      expect(() => blocks.insert(0, ghost, false, false, true)).toThrowError(new Error(
        '[Blocks.insertAtRootLevel] invariant violated: block holder did not land at workingArea root. ' +
        'This indicates the Enter-after-callout regression guard is broken.'
      ));
    });
  });

  describe('insertMany', () => {
    it('inserts after the flat predecessor and fires rendered for each block', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');
      const fresh = makeBlock('fresh');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      blocks.insertMany([fresh], 1);

      expect(workingArea.children[1]).toBe(fresh.holder);
      expect(domOrder(workingArea)).toEqual(['a', 'fresh', 'b', 'c']);
      expect(arrayOrder(blocks)).toEqual(['a', 'fresh', 'b', 'c']);
      expect(fresh.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('anchors at the next top-level block when the predecessor is nested', () => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();
      const nested = makeBlock('nested');
      const root = makeBlock('root');
      const fresh = makeBlock('fresh');

      workingArea.appendChild(container);
      blocks.addToArray(0, nested);
      blocks.addToArray(1, root);
      container.appendChild(nested.holder);
      workingArea.appendChild(root.holder);

      blocks.insertMany([fresh], 1);

      expect(fresh.holder.parentElement).toBe(workingArea);
      expect(root.holder.previousElementSibling).toBe(fresh.holder);
      expect(domOrder(workingArea)).toEqual(['container', 'fresh', 'root']);
    });

    it('skips a nested follower and anchors at the first top-level block', () => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();
      const first = makeBlock('first');
      const second = makeBlock('second');
      const root = makeBlock('root');
      const fresh = makeBlock('fresh');

      workingArea.appendChild(container);
      blocks.addToArray(0, first);
      blocks.addToArray(1, second);
      blocks.addToArray(2, root);
      container.appendChild(first.holder);
      container.appendChild(second.holder);
      workingArea.appendChild(root.holder);

      blocks.insertMany([fresh], 1);

      expect(fresh.holder.parentElement).toBe(workingArea);
      expect(domOrder(workingArea)).toEqual(['container', 'fresh', 'root']);
    });
  });

  describe('addToArray', () => {
    it('clamps an out-of-range index to the end of the array', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');

      blocks.push(a);

      blocks.addToArray(2, b);

      expect(arrayOrder(blocks)).toEqual(['a', 'b']);
    });

    it('ignores a negative index', () => {
      const blocks = new Blocks(workingArea);

      blocks.addToArray(0, makeBlock('a'));
      blocks.addToArray(-1, makeBlock('intruder'));

      expect(arrayOrder(blocks)).toEqual(['a']);
    });
  });

  describe('remove', () => {
    it('ignores an out-of-range index instead of throwing', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const c = makeBlock('c');

      blocks.push(a);
      blocks.push(b);
      blocks.push(c);

      expect(() => blocks.remove(3)).not.toThrow();
      expect(blocks.length).toBe(3);
      expect(domOrder(workingArea)).toEqual(['a', 'b', 'c']);
    });

    it('fires removed and destroys the block it drops', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');

      blocks.push(a);
      blocks.push(b);

      blocks.remove(1);

      expect(b.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
      expect(b.destroy).toHaveBeenCalledTimes(1);
      expect(arrayOrder(blocks)).toEqual(['a']);
      expect(domOrder(workingArea)).toEqual(['a']);
    });
  });

  describe('activateBlock', () => {
    it('inserts an unmounted block before the first mounted follower inside its container', () => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();
      const activating = makeBlock('activating', 'parent-1');
      const mounted = makeBlock('mounted');
      const laterUnmounted = makeBlock('later-unmounted');

      workingArea.appendChild(container);
      blocks.addToArray(0, activating);
      blocks.addToArray(1, mounted);
      blocks.addToArray(2, laterUnmounted);
      container.appendChild(mounted.holder);

      blocks.activateBlock(activating);

      expect(activating.holder.parentElement).toBe(container);
      expect(mounted.holder.previousElementSibling).toBe(activating.holder);
    });

    it('skips an unmounted follower and anchors on the mounted one', () => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();
      const activating = makeBlock('activating', 'parent-1');
      const unmounted = makeBlock('unmounted');
      const mounted = makeBlock('mounted');

      workingArea.appendChild(container);
      blocks.addToArray(0, activating);
      blocks.addToArray(1, unmounted);
      blocks.addToArray(2, mounted);
      container.appendChild(mounted.holder);

      blocks.activateBlock(activating);

      expect(activating.holder.parentElement).toBe(container);
      expect(mounted.holder.previousElementSibling).toBe(activating.holder);
    });

    it('appends when no follower is mounted', () => {
      const blocks = new Blocks(workingArea);
      const activating = makeBlock('activating', 'parent-1');

      blocks.addToArray(0, activating);

      blocks.activateBlock(activating);

      expect(activating.holder.parentElement).toBe(workingArea);
      expect(activating.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('routes a root-level block to the working area through insertAtRootLevel', () => {
      const blocks = new Blocks(workingArea);
      const container = makeContainer();
      const nested = makeBlock('nested');
      const root = makeBlock('root', null);

      workingArea.appendChild(container);
      blocks.addToArray(0, nested);
      blocks.addToArray(1, root);
      container.appendChild(nested.holder);

      blocks.activateBlock(root);

      expect(root.holder.parentElement).toBe(workingArea);
    });

    it('only fires the rendered hook when the holder is already mounted', () => {
      const blocks = new Blocks(workingArea);
      const mounted = makeBlock('mounted');

      blocks.addToArray(0, mounted);
      workingArea.appendChild(mounted.holder);

      blocks.activateBlock(mounted);

      expect(mounted.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
      expect(workingArea.firstElementChild).toBe(mounted.holder);
    });
  });

  describe('insertAfter', () => {
    it('ignores a target that is not part of the array', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const fresh = makeBlock('fresh');

      blocks.push(a);

      blocks.insertAfter(makeBlock('stranger'), fresh);

      expect(arrayOrder(blocks)).toEqual(['a']);
      expect(fresh.holder.parentElement).toBeNull();
    });

    it('inserts a new block after the target', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');
      const b = makeBlock('b');
      const fresh = makeBlock('fresh');

      blocks.push(a);
      blocks.push(b);

      blocks.insertAfter(a, fresh);

      expect(arrayOrder(blocks)).toEqual(['a', 'fresh', 'b']);
      expect(domOrder(workingArea)).toEqual(['a', 'fresh', 'b']);
    });
  });

  describe('removeAll', () => {
    it('clears the array and the working area', () => {
      const blocks = new Blocks(workingArea);
      const a = makeBlock('a');

      blocks.push(a);

      blocks.removeAll();

      expect(a.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
      expect(a.destroy).toHaveBeenCalledTimes(1);
      expect(blocks.length).toBe(0);
      expect(domOrder(workingArea)).toEqual([]);
    });
  });
});

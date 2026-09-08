import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  OrderedMarkerManager,
  resetPendingMarkerUpdate,
  getPendingMarkerUpdate,
} from '../../../../src/tools/list/ordered-marker-manager';
import { TOOL_NAME, INDENT_PER_LEVEL } from '../../../../src/tools/list/constants';
import type { BlocksAPI } from '../../../../src/tools/list/marker-calculator';

interface MockBlock {
  id: string;
  name: string;
  holder?: HTMLElement;
}

interface WrapperOptions {
  /** Depth is read back from the list item's margin-left, not from an attribute. */
  depth?: number;
  start?: number;
  /** `null` builds a wrapper with no marker element at all. */
  marker?: string | null;
}

/**
 * Builds one `[data-list-style]` wrapper, the shape the manager walks:
 * wrapper → `[role="listitem"]` → `[data-list-marker]`.
 */
const makeWrapper = (style: string, options: WrapperOptions = {}): HTMLElement => {
  const { depth = 0, start, marker = 'X' } = options;
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-list-style', style);
  if (start !== undefined) {
    wrapper.setAttribute('data-list-start', String(start));
  }

  const item = document.createElement('div');

  item.setAttribute('role', 'listitem');
  if (depth > 0) {
    item.style.marginLeft = `${depth * INDENT_PER_LEVEL}px`;
  }

  if (marker !== null) {
    const markerEl = document.createElement('span');

    markerEl.setAttribute('data-list-marker', 'true');
    markerEl.textContent = marker;
    item.appendChild(markerEl);
  }

  wrapper.appendChild(item);

  return wrapper;
};

/**
 * Wraps wrappers in a holder. `holderStart` puts `data-list-start` on the holder
 * itself, which is the only place `updateMarker` looks for it.
 */
const makeBlock = (
  id: string,
  wrappers: HTMLElement[],
  options: { name?: string; holderStart?: number } = {}
): MockBlock => {
  const holder = document.createElement('div');

  if (options.holderStart !== undefined) {
    holder.setAttribute('data-list-start', String(options.holderStart));
  }
  wrappers.forEach((wrapper) => holder.appendChild(wrapper));

  return { id, name: options.name ?? TOOL_NAME, holder };
};

const orderedBlock = (id: string, options: WrapperOptions = {}, holderStart?: number): MockBlock =>
  makeBlock(id, [makeWrapper('ordered', options)], { holderStart });

const makeBlocksAPI = (
  blocks: MockBlock[],
  options: { count?: number; indexOf?: (id: string) => number | undefined } = {}
): BlocksAPI => ({
  getBlockByIndex: (index: number) => blocks[index],
  getBlockIndex: (id: string) => {
    if (options.indexOf !== undefined) {
      return options.indexOf(id);
    }
    const index = blocks.findIndex((block) => block.id === id);

    return index === -1 ? undefined : index;
  },
  getBlocksCount: () => options.count ?? blocks.length,
  getCurrentBlockIndex: () => 0,
});

const markerOf = (block: MockBlock): string | null =>
  block.holder?.querySelector('[data-list-marker]')?.textContent ?? null;

const markersOf = (blocks: MockBlock[]): Array<string | null> => blocks.map(markerOf);

/**
 * Ten mutants in this file are equivalent and no test can kill them:
 *
 * - `if (!startAttr) return startValue` (both copies): dropping it changes
 *   nothing, because `parseInt(null, 10)` and `parseInt('', 10)` are both NaN
 *   and the `isNaN` line below returns the same `startValue`.
 * - `if (!listItemEl) continue` in updateAllMarkers: updateBlockMarker runs the
 *   same `[data-list-style="ordered"]` query on the same holder and returns.
 * - `if (!block) return` in updateBlockMarker: both call sites test `!block`
 *   first.
 * - `if (!listItemEl) return` in updateBlockMarker: it is reached only after a
 *   caller found that element, or after getBlockStyle read 'ordered' off the
 *   first `[data-list-style]` — which then IS a `[data-list-style="ordered"]`.
 * - `blockHolder?.querySelector` in updateBlockMarker: a holder-less block is
 *   filtered one frame earlier (updateAllMarkers) or reads style null and stops
 *   at the style boundary (updateMarkersInRange), so the chain never shortens.
 * - `blockIndex === null`: BlocksAPI.getBlockIndex returns `number | undefined`.
 */
describe('OrderedMarkerManager mutants', () => {
  beforeEach(() => {
    resetPendingMarkerUpdate();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateMarker', () => {
    it('reads the start value off the holder when the item opens the group', () => {
      const block = orderedBlock('a', {}, 7);
      const manager = new OrderedMarkerManager(makeBlocksAPI([block]));

      manager.updateMarker(block.holder as HTMLElement, 0, 0);

      expect(markerOf(block)).toBe('7.');
    });

    it('ignores the holder start value on an item that is not first in its group', () => {
      const blocks = [orderedBlock('a'), orderedBlock('b', {}, 9)];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateMarker(blocks[1].holder as HTMLElement, 1, 0);

      expect(markersOf(blocks)).toStrictEqual(['X', '2.']);
    });

    it('keeps the group start value when the group already begins past one', () => {
      const block = orderedBlock('a', { start: 5 }, 3);
      const manager = new OrderedMarkerManager(makeBlocksAPI([block]));

      manager.updateMarker(block.holder as HTMLElement, 0, 0);

      expect(markerOf(block)).toBe('5.');
    });

    it('counts the preceding ordered siblings', () => {
      const blocks = [orderedBlock('a'), orderedBlock('b'), orderedBlock('c')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateMarker(blocks[2].holder as HTMLElement, 2, 0);

      expect(markersOf(blocks)).toStrictEqual(['X', 'X', '3.']);
    });

    it('takes the group start value from the first item of the group', () => {
      const blocks = [orderedBlock('a', { start: 10 }), orderedBlock('b'), orderedBlock('c')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateMarker(blocks[2].holder as HTMLElement, 2, 0);

      expect(markerOf(blocks[2])).toBe('12.');
    });
  });

  describe('updateSiblingMarkers', () => {
    it('renumbers the group from its first item and leaves the caller alone', () => {
      const blocks = [orderedBlock('a'), orderedBlock('b'), orderedBlock('c')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateSiblingMarkers(2, 0);

      expect(markersOf(blocks)).toStrictEqual(['1.', '2.', 'X']);
    });

    it('stops at the reported block count, not at the end of the block array', () => {
      const blocks = [
        makeBlock('p', [], { name: 'paragraph' }),
        orderedBlock('a'),
        orderedBlock('b'),
        orderedBlock('c'),
        orderedBlock('d'),
      ];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks, { count: 3 }));

      manager.updateSiblingMarkers(2, 0);

      expect(markersOf(blocks)).toStrictEqual([null, '1.', 'X', 'X', 'X']);
    });

    it('stops at a block that is not a list item, however list-shaped its DOM is', () => {
      const blocks = [
        orderedBlock('a'),
        makeBlock('p', [makeWrapper('ordered')], { name: 'paragraph' }),
        orderedBlock('c'),
      ];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateSiblingMarkers(0, 0);

      expect(markersOf(blocks)).toStrictEqual(['X', 'X', 'X']);
    });

    it('survives a block count that runs past the last block', () => {
      const blocks = [orderedBlock('a'), orderedBlock('b')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks, { count: 4 }));

      expect(() => manager.updateSiblingMarkers(0, 0)).not.toThrow();
      expect(markersOf(blocks)).toStrictEqual(['X', '2.']);
    });

    it('stops when the run rises back to a shallower depth', () => {
      const blocks = [
        orderedBlock('a', { depth: 1 }),
        orderedBlock('b', { depth: 1 }),
        orderedBlock('c', { depth: 0 }),
        orderedBlock('d', { depth: 1 }),
      ];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateSiblingMarkers(0, 1);

      expect(markersOf(blocks)).toStrictEqual(['X', '2.', 'X', 'X']);
    });

    it('steps over a deeper item without renumbering it', () => {
      const blocks = [orderedBlock('a'), orderedBlock('b', { depth: 1 }), orderedBlock('c')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateSiblingMarkers(0, 0);

      expect(markersOf(blocks)).toStrictEqual(['X', 'X', '2.']);
    });

    it('stops at a style boundary at the same depth', () => {
      const blocks = [
        orderedBlock('a'),
        makeBlock('b', [makeWrapper('unordered')]),
        orderedBlock('c'),
      ];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateSiblingMarkers(0, 0);

      expect(markersOf(blocks)).toStrictEqual(['X', 'X', 'X']);
    });
  });

  describe('updateAllMarkers', () => {
    it('survives a block count that runs past the last block', () => {
      const blocks = [orderedBlock('a')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks, { count: 3 }));

      expect(() => manager.updateAllMarkers()).not.toThrow();
      expect(markerOf(blocks[0])).toBe('1.');
    });

    it('leaves a non-list block alone even when its DOM looks like a list', () => {
      const blocks = [makeBlock('p', [makeWrapper('ordered')], { name: 'paragraph' })];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateAllMarkers();

      expect(markerOf(blocks[0])).toBe('X');
    });

    it('survives a list block that has no holder', () => {
      const blocks: MockBlock[] = [{ id: 'a', name: TOOL_NAME }, orderedBlock('b')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      expect(() => manager.updateAllMarkers()).not.toThrow();
      expect(markerOf(blocks[1])).toBe('1.');
    });

    it('survives an ordered wrapper that has no marker element', () => {
      const blocks = [orderedBlock('a', { marker: null }), orderedBlock('b')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      expect(() => manager.updateAllMarkers()).not.toThrow();
      expect(markerOf(blocks[1])).toBe('2.');
    });

    it('leaves a block whose index cannot be resolved untouched', () => {
      const blocks = [orderedBlock('a')];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks, { indexOf: () => undefined }));

      manager.updateAllMarkers();

      expect(markerOf(blocks[0])).toBe('X');
    });

    it('reads the start value off the holder when the item opens the group', () => {
      const blocks = [orderedBlock('a', {}, 4)];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateAllMarkers();

      expect(markerOf(blocks[0])).toBe('4.');
    });

    it('ignores the holder start value on an item that is not first in its group', () => {
      const blocks = [orderedBlock('a'), orderedBlock('b', {}, 6)];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateAllMarkers();

      expect(markersOf(blocks)).toStrictEqual(['1.', '2.']);
    });

    // A block can hold more than one list wrapper. getBlockStartValue reads the
    // FIRST [data-list-style] element, while the marker's own start attribute is
    // whatever closest() finds from the ordered wrapper — so the two disagree,
    // and only the group value may be used.
    it('uses the group start value, not the ordered wrapper\'s own, once the group starts past one', () => {
      const ordered = makeWrapper('ordered', { start: 8 });
      const block = makeBlock('a', [makeWrapper('unordered', { start: 3, marker: null }), ordered]);
      const manager = new OrderedMarkerManager(makeBlocksAPI([block]));

      manager.updateAllMarkers();

      expect(ordered.querySelector('[data-list-marker]')?.textContent).toBe('3.');
    });

    // Same two-wrapper shape, but the first wrapper carries a style the type guard
    // rejects, so getBlockStyle returns null and the 'ordered' fallback is what
    // keeps the sibling count on the right group.
    it('falls back to the ordered style when the block\'s own style does not parse', () => {
      const ordered = makeWrapper('ordered');
      const blocks = [
        orderedBlock('a'),
        makeBlock('b', [makeWrapper('todo', { marker: null }), ordered]),
      ];
      const manager = new OrderedMarkerManager(makeBlocksAPI(blocks));

      manager.updateAllMarkers();

      expect(ordered.querySelector('[data-list-marker]')?.textContent).toBe('2.');
    });
  });

  describe('scheduleUpdateAll', () => {
    it('schedules one frame however many instances ask for it', () => {
      const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(0);
      const blocks = [orderedBlock('a')];
      const api = makeBlocksAPI(blocks);

      new OrderedMarkerManager(api).scheduleUpdateAll();
      new OrderedMarkerManager(api).scheduleUpdateAll();

      expect(raf).toHaveBeenCalledTimes(1);
      expect(getPendingMarkerUpdate()).toBe(true);
    });

    it('updates every marker and clears the flag when the frame runs', () => {
      const frames: FrameRequestCallback[] = [];

      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return 0;
      });

      const blocks = [orderedBlock('a'), orderedBlock('b')];

      new OrderedMarkerManager(makeBlocksAPI(blocks)).scheduleUpdateAll();
      frames.forEach((callback) => callback(0));

      expect(markersOf(blocks)).toStrictEqual(['1.', '2.']);
      expect(getPendingMarkerUpdate()).toBe(false);
    });
  });
});

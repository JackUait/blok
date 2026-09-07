import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  updateCheckboxState,
  getBlockDepth,
  getBlockStyle,
  getSiblingIndex,
  getListStartValue,
  getOrderedMarkerText,
  findListGroupStartIndex,
  updateBlockMarker,
  updateMarkersInRange,
  updateAllOrderedListMarkers,
} from '../../../../src/tools/list/list-helpers';
import type { BlocksAPI, ListMarkerCalculator } from '../../../../src/tools/list/marker-calculator';
import type { ListDepthValidator } from '../../../../src/tools/list/depth-validator';
import type { ListItemStyle } from '../../../../src/tools/list/types';

type FakeBlock = ReturnType<BlocksAPI['getBlockByIndex']>;

interface BlockFixture {
  id: string;
  name: string;
  holder: HTMLElement;
  marker: HTMLElement | null;
}

/**
 * A block whose holder carries the ordered-list marker element the helpers look for.
 *
 * `withMarkerHost` and `withMarker` are separate switches: the helpers bail at two
 * different selectors, and a fixture missing both cannot tell them apart.
 */
const makeBlock = (
  id: string,
  { name = 'list', withMarkerHost = true, withMarker = true, markerText = '' } = {},
): BlockFixture => {
  const holder = document.createElement('div');
  let marker: HTMLElement | null = null;

  if (withMarkerHost) {
    const listItem = document.createElement('div');

    listItem.setAttribute('data-list-style', 'ordered');

    if (withMarker) {
      marker = document.createElement('span');
      marker.setAttribute('data-list-marker', '');
      marker.textContent = markerText;
      listItem.appendChild(marker);
    }

    holder.appendChild(listItem);
  }

  return { id, name, holder, marker };
};

const asBlock = (fixture: BlockFixture): FakeBlock => fixture;

interface BlocksFake {
  api: BlocksAPI;
  getBlockIndex: ReturnType<typeof vi.fn>;
  getCurrentBlockIndex: ReturnType<typeof vi.fn>;
  getBlockByIndex: ReturnType<typeof vi.fn>;
  getBlocksCount: ReturnType<typeof vi.fn>;
}

const makeBlocks = ({
  blocks = [] as BlockFixture[],
  currentIndex = 0,
  indexOf,
}: {
  blocks?: BlockFixture[];
  currentIndex?: number;
  indexOf?: (id: string | undefined) => number | undefined | null;
} = {}): BlocksFake => {
  const getBlockIndex = vi.fn(
    (id: string | undefined) => (indexOf === undefined
      ? blocks.findIndex((block) => block.id === id)
      : indexOf(id)),
  );
  const getCurrentBlockIndex = vi.fn(() => currentIndex);
  const getBlockByIndex = vi.fn((index: number) => blocks[index]);
  const getBlocksCount = vi.fn(() => blocks.length);

  return {
    api: {
      getBlockIndex, getCurrentBlockIndex, getBlockByIndex, getBlocksCount,
    } as unknown as BlocksAPI,
    getBlockIndex,
    getCurrentBlockIndex,
    getBlockByIndex,
    getBlocksCount,
  };
};

interface CalculatorFake {
  api: ListMarkerCalculator;
  calls: {
    siblingIndex: Array<[number, number, ListItemStyle]>;
    groupStartValue: Array<[number, number, number, ListItemStyle]>;
    formatNumber: Array<[number, number]>;
    visualDepth: Array<[number, number]>;
    firstItemIndex: Array<[number, number, number, ListItemStyle | undefined]>;
    blockStartValue: number[];
    groupStart: Array<[number, number, ListItemStyle]>;
  };
}

interface CalculatorOptions {
  siblingIndex?: number;
  groupStartValue?: number;
  blockStartValue?: number;
  firstItemIndex?: number | null;
  visualDepth?: number;
  blockStyle?: ListItemStyle | null;
  groupStart?: number;
}

const makeCalculator = ({
  siblingIndex = 7,
  groupStartValue = 100,
  blockStartValue = 500,
  firstItemIndex = 4,
  visualDepth = 3,
  blockStyle = 'ordered',
  groupStart = 11,
}: CalculatorOptions = {}): CalculatorFake => {
  const calls: CalculatorFake['calls'] = {
    siblingIndex: [], groupStartValue: [], formatNumber: [], visualDepth: [],
    firstItemIndex: [], blockStartValue: [], groupStart: [],
  };

  const api = {
    getSiblingIndex: vi.fn((index: number, depth: number, style: ListItemStyle) => {
      calls.siblingIndex.push([index, depth, style]);

      return siblingIndex;
    }),
    getGroupStartValue: vi.fn((index: number, depth: number, sibling: number, style: ListItemStyle) => {
      calls.groupStartValue.push([index, depth, sibling, style]);

      return groupStartValue;
    }),
    formatNumber: vi.fn((value: number, depth: number) => {
      calls.formatNumber.push([value, depth]);

      return `n${value}d${depth}`;
    }),
    getVisualDepth: vi.fn((index: number, depth: number) => {
      calls.visualDepth.push([index, depth]);

      return visualDepth;
    }),
    findFirstItemIndex: vi.fn((index: number, depth: number, remaining: number, style?: ListItemStyle) => {
      calls.firstItemIndex.push([index, depth, remaining, style]);

      return firstItemIndex;
    }),
    getBlockStartValue: vi.fn((index: number) => {
      calls.blockStartValue.push(index);

      return blockStartValue;
    }),
    findGroupStart: vi.fn((index: number, depth: number, style: ListItemStyle) => {
      calls.groupStart.push([index, depth, style]);

      return groupStart;
    }),
    getBlockStyle: vi.fn(() => blockStyle),
    getBulletCharacter: vi.fn(() => '•'),
  } as unknown as ListMarkerCalculator;

  return { api, calls };
};

const makeDepthValidator = (depthOf: (block: FakeBlock) => number): ListDepthValidator => ({
  getBlockDepth: vi.fn(depthOf),
} as unknown as ListDepthValidator);

describe('list-helpers mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('updateCheckboxState', () => {
    it('leaves a checkbox from another realm alone', () => {
      const frame = document.createElement('iframe');

      document.body.appendChild(frame);

      const foreignDocument = frame.contentDocument;

      expect(foreignDocument).not.toBeNull();

      const foreign = foreignDocument?.createElement('input');

      expect(foreign).toBeDefined();

      if (foreign === undefined || foreign === null) {
        return;
      }

      foreign.setAttribute('type', 'checkbox');

      const host = document.createElement('div');

      host.appendChild(foreign);

      expect(host.querySelector('input[type="checkbox"]')).toBe(foreign);
      expect(foreign instanceof HTMLInputElement).toBe(false);

      updateCheckboxState(host, true);

      expect(foreign.checked).toBe(false);
    });

    it('marks the checklist content element, not the plain content container', () => {
      const host = document.createElement('div');
      const checkbox = document.createElement('input');

      checkbox.type = 'checkbox';

      const checklistContent = document.createElement('div');

      checklistContent.setAttribute('data-blok-testid', 'list-checklist-content');
      host.append(checkbox, checklistContent);

      updateCheckboxState(host, true);

      expect(checklistContent.getAttribute('data-checked')).toBe('true');
      expect(checkbox.checked).toBe(true);
    });

    it('clears the checklist content marking when unchecked', () => {
      const host = document.createElement('div');
      const checkbox = document.createElement('input');

      checkbox.type = 'checkbox';
      checkbox.checked = true;

      const checklistContent = document.createElement('div');

      checklistContent.setAttribute('data-blok-testid', 'list-checklist-content');
      checklistContent.setAttribute('data-checked', 'true');
      host.append(checkbox, checklistContent);

      updateCheckboxState(host, false);

      expect(checklistContent.getAttribute('data-checked')).toBe('false');
      expect(checkbox.checked).toBe(false);
    });
  });

  describe('getBlockDepth / getBlockStyle / findListGroupStartIndex', () => {
    it('returns the validator depth for the block it was given', () => {
      const block = asBlock(makeBlock('a'));
      const validator = makeDepthValidator(() => 6);

      expect(getBlockDepth(block, validator)).toBe(6);
      expect(validator.getBlockDepth).toHaveBeenCalledWith(block);
    });

    it('returns the calculator style', () => {
      const calculator = makeCalculator({ blockStyle: 'checklist' });

      expect(getBlockStyle(asBlock(makeBlock('a')), calculator.api)).toBe('checklist');
    });

    it('returns the calculator group start and forwards every argument', () => {
      const calculator = makeCalculator({ groupStart: 42 });

      expect(findListGroupStartIndex(9, 2, 'ordered', calculator.api)).toBe(42);
      expect(calculator.calls.groupStart).toEqual([[9, 2, 'ordered']]);
    });
  });

  describe('getSiblingIndex', () => {
    it('resolves the block id to its own index rather than the current one', () => {
      const blocks = makeBlocks({ currentIndex: 3, indexOf: () => 5 });
      const calculator = makeCalculator();

      expect(getSiblingIndex('b1', 2, 'ordered', blocks.api, calculator.api)).toBe(7);
      expect(calculator.calls.siblingIndex).toEqual([[5, 2, 'ordered']]);
    });

    it('falls back to the current index when the id is unknown', () => {
      const blocks = makeBlocks({ currentIndex: 4, indexOf: () => undefined });
      const calculator = makeCalculator();

      getSiblingIndex('missing', 1, 'unordered', blocks.api, calculator.api);

      expect(calculator.calls.siblingIndex).toEqual([[4, 1, 'unordered']]);
    });

    it('uses the current index when no id is given', () => {
      const blocks = makeBlocks({ currentIndex: 2, indexOf: () => 5 });
      const calculator = makeCalculator();

      getSiblingIndex(undefined, 1, 'ordered', blocks.api, calculator.api);

      expect(calculator.calls.siblingIndex).toEqual([[2, 1, 'ordered']]);
    });

    it('reports zero for the first block without asking the calculator', () => {
      const blocks = makeBlocks({ currentIndex: 0 });
      const calculator = makeCalculator();

      expect(getSiblingIndex(undefined, 0, 'ordered', blocks.api, calculator.api)).toBe(0);
      expect(calculator.calls.siblingIndex).toEqual([]);
    });

    it('reports zero for a negative index', () => {
      const blocks = makeBlocks({ currentIndex: -1 });
      const calculator = makeCalculator();

      expect(getSiblingIndex(undefined, 0, 'ordered', blocks.api, calculator.api)).toBe(0);
      expect(calculator.calls.siblingIndex).toEqual([]);
    });
  });

  describe('getListStartValue', () => {
    it('uses the block start for the first item of a group', () => {
      const blocks = makeBlocks({ currentIndex: 9 });
      const calculator = makeCalculator();

      expect(getListStartValue(0, 1, 'b', { start: 12, style: 'ordered' }, blocks.api, calculator.api)).toBe(12);
      expect(calculator.calls.firstItemIndex).toEqual([]);
    });

    it('defaults the first item to one when no start is stored', () => {
      const blocks = makeBlocks({ currentIndex: 9 });
      const calculator = makeCalculator();

      expect(getListStartValue(0, 1, 'b', { style: 'ordered' }, blocks.api, calculator.api)).toBe(1);
    });

    it('searches from the block before the current one for a later item', () => {
      const blocks = makeBlocks({ currentIndex: 3, indexOf: () => 8 });
      const calculator = makeCalculator({ firstItemIndex: 4, blockStartValue: 77 });

      expect(getListStartValue(2, 1, 'b', { start: 12, style: 'checklist' }, blocks.api, calculator.api)).toBe(77);
      expect(calculator.calls.firstItemIndex).toEqual([[7, 1, 2, 'checklist']]);
      expect(calculator.calls.blockStartValue).toEqual([4]);
    });

    it('searches from the current index when no id is given', () => {
      const blocks = makeBlocks({ currentIndex: 6, indexOf: () => 8 });
      const calculator = makeCalculator();

      getListStartValue(2, 1, undefined, { style: 'ordered' }, blocks.api, calculator.api);

      expect(calculator.calls.firstItemIndex).toEqual([[5, 1, 2, 'ordered']]);
    });

    it('searches from the current index when the id is unknown', () => {
      const blocks = makeBlocks({ currentIndex: 6, indexOf: () => undefined });
      const calculator = makeCalculator();

      getListStartValue(2, 1, 'ghost', { style: 'ordered' }, blocks.api, calculator.api);

      expect(calculator.calls.firstItemIndex).toEqual([[5, 1, 2, 'ordered']]);
    });

    it('restarts at one when no first item is found', () => {
      const blocks = makeBlocks({ currentIndex: 6 });
      const calculator = makeCalculator({ firstItemIndex: null, blockStartValue: 77 });

      expect(getListStartValue(2, 1, undefined, { start: 12, style: 'ordered' }, blocks.api, calculator.api)).toBe(1);
      expect(calculator.calls.blockStartValue).toEqual([]);
    });
  });

  describe('getOrderedMarkerText', () => {
    it('adds the sibling offset to the group start and formats at the visual depth', () => {
      const blocks = makeBlocks({ currentIndex: 3, indexOf: () => 8 });
      const calculator = makeCalculator({ firstItemIndex: 4, blockStartValue: 20, visualDepth: 2 });

      const text = getOrderedMarkerText(3, 1, { style: 'ordered' }, 'b', blocks.api, calculator.api);

      expect(text).toBe('n23d2');
      expect(calculator.calls.visualDepth).toEqual([[8, 1]]);
    });

    it('reads the visual depth at the current index when no id is given', () => {
      const blocks = makeBlocks({ currentIndex: 5, indexOf: () => 8 });
      const calculator = makeCalculator({ firstItemIndex: 4, blockStartValue: 20 });

      getOrderedMarkerText(3, 1, { style: 'ordered' }, undefined, blocks.api, calculator.api);

      expect(calculator.calls.visualDepth).toEqual([[5, 1]]);
    });

    it('reads the visual depth at the current index when the id is unknown', () => {
      const blocks = makeBlocks({ currentIndex: 5, indexOf: () => undefined });
      const calculator = makeCalculator({ firstItemIndex: 4, blockStartValue: 20 });

      getOrderedMarkerText(3, 1, { style: 'ordered' }, 'ghost', blocks.api, calculator.api);

      expect(calculator.calls.visualDepth).toEqual([[5, 1]]);
    });
  });

  describe('updateBlockMarker', () => {
    it('writes the formatted number built from the group start plus the sibling index', () => {
      const block = makeBlock('a', { markerText: 'old' });
      const blocks = makeBlocks({ blocks: [block] });
      const calculator = makeCalculator({ siblingIndex: 2, groupStartValue: 30, visualDepth: 1 });
      const validator = makeDepthValidator(() => 4);

      updateBlockMarker(asBlock(block), blocks.api, validator, calculator.api);

      expect(block.marker?.textContent).toBe('n32d1');
      expect(calculator.calls.groupStartValue).toEqual([[0, 4, 2, 'ordered']]);
      expect(calculator.calls.siblingIndex).toEqual([[0, 4, 'ordered']]);
      expect(calculator.calls.visualDepth).toEqual([[0, 4]]);
    });

    it('falls back to the ordered style when the block has none', () => {
      const block = makeBlock('a', { markerText: 'old' });
      const blocks = makeBlocks({ blocks: [block] });
      const calculator = makeCalculator({ blockStyle: null });
      const validator = makeDepthValidator(() => 0);

      updateBlockMarker(asBlock(block), blocks.api, validator, calculator.api);

      expect(calculator.calls.siblingIndex).toEqual([[0, 0, 'ordered']]);
    });

    it('passes the block style through when it has one', () => {
      const block = makeBlock('a', { markerText: 'old' });
      const blocks = makeBlocks({ blocks: [block] });
      const calculator = makeCalculator({ blockStyle: 'unordered' });
      const validator = makeDepthValidator(() => 0);

      updateBlockMarker(asBlock(block), blocks.api, validator, calculator.api);

      expect(calculator.calls.siblingIndex).toEqual([[0, 0, 'unordered']]);
    });

    it('does nothing without a block', () => {
      const blocks = makeBlocks();
      const calculator = makeCalculator();
      const validator = makeDepthValidator(() => 0);

      updateBlockMarker(undefined, blocks.api, validator, calculator.api);

      expect(blocks.getBlockIndex).not.toHaveBeenCalled();
      expect(calculator.calls.formatNumber).toEqual([]);
    });

    it('does nothing when the block has no holder', () => {
      const blocks = makeBlocks();
      const calculator = makeCalculator();
      const validator = makeDepthValidator(() => 0);
      const holderless = { id: 'a', name: 'list' } as unknown as FakeBlock;

      expect(() => updateBlockMarker(holderless, blocks.api, validator, calculator.api)).not.toThrow();
      expect(calculator.calls.formatNumber).toEqual([]);
    });

    it('does nothing when the holder carries no ordered list item', () => {
      const block = makeBlock('a', { withMarkerHost: false });
      const blocks = makeBlocks({ blocks: [block] });
      const calculator = makeCalculator();
      const validator = makeDepthValidator(() => 0);

      updateBlockMarker(asBlock(block), blocks.api, validator, calculator.api);

      expect(blocks.getBlockIndex).not.toHaveBeenCalled();
      expect(calculator.calls.formatNumber).toEqual([]);
    });

    it('does nothing when the list item carries no marker', () => {
      const block = makeBlock('a', { withMarker: false });
      const blocks = makeBlocks({ blocks: [block] });
      const calculator = makeCalculator();
      const validator = makeDepthValidator(() => 0);

      updateBlockMarker(asBlock(block), blocks.api, validator, calculator.api);

      expect(blocks.getBlockIndex).not.toHaveBeenCalled();
      expect(calculator.calls.formatNumber).toEqual([]);
    });

    it('does nothing when the block has no index', () => {
      const block = makeBlock('a', { markerText: 'old' });
      const blocks = makeBlocks({ blocks: [block], indexOf: () => undefined });
      const calculator = makeCalculator();
      const validator = makeDepthValidator(() => 0);

      updateBlockMarker(asBlock(block), blocks.api, validator, calculator.api);

      expect(block.marker?.textContent).toBe('old');
      expect(calculator.calls.formatNumber).toEqual([]);
    });

    it('does nothing when the block index comes back null', () => {
      const block = makeBlock('a', { markerText: 'old' });
      const blocks = makeBlocks({ blocks: [block], indexOf: () => null });
      const calculator = makeCalculator();
      const validator = makeDepthValidator(() => 0);

      updateBlockMarker(asBlock(block), blocks.api, validator, calculator.api);

      expect(block.marker?.textContent).toBe('old');
      expect(calculator.calls.formatNumber).toEqual([]);
    });
  });

  describe('updateMarkersInRange', () => {
    interface SweepOptions {
      start?: number;
      end?: number;
      skip?: number;
      depth?: number;
      style?: ListItemStyle;
      depthOf?: (block: FakeBlock) => number;
    }

    const sweep = (
      fixtures: BlockFixture[],
      { start = 0, end = fixtures.length, skip = -1, depth = 1, style, depthOf }: SweepOptions = {},
    ) => {
      const blocks = makeBlocks({ blocks: fixtures });
      const calculator = makeCalculator({ siblingIndex: 0, groupStartValue: 1, visualDepth: 0 });
      const validator = makeDepthValidator((block) => (depthOf === undefined ? 1 : depthOf(block)));

      updateMarkersInRange(start, end, skip, depth, style ?? 'ordered', blocks.api, validator, calculator.api);

      return fixtures.map((fixture) => fixture.marker?.textContent);
    };

    it('renumbers every list block in the range', () => {
      const fixtures = [makeBlock('a', { markerText: 'a' }), makeBlock('b', { markerText: 'b' })];

      expect(sweep(fixtures)).toEqual(['n1d0', 'n1d0']);
    });

    it('stops before the end index', () => {
      const fixtures = [
        makeBlock('a', { markerText: 'a' }),
        makeBlock('b', { markerText: 'b' }),
        makeBlock('c', { markerText: 'c' }),
      ];

      expect(sweep(fixtures, { end: 2 })).toEqual(['n1d0', 'n1d0', 'c']);
    });

    it('starts at the start index', () => {
      const fixtures = [makeBlock('a', { markerText: 'a' }), makeBlock('b', { markerText: 'b' })];

      expect(sweep(fixtures, { start: 1 })).toEqual(['a', 'n1d0']);
    });

    it('skips the skip index and carries on past it', () => {
      const fixtures = [
        makeBlock('a', { markerText: 'a' }),
        makeBlock('b', { markerText: 'b' }),
        makeBlock('c', { markerText: 'c' }),
      ];

      expect(sweep(fixtures, { skip: 1 })).toEqual(['n1d0', 'b', 'n1d0']);
    });

    it('stops at a block that is not a list', () => {
      const fixtures = [
        makeBlock('a', { markerText: 'a' }),
        makeBlock('p', { name: 'paragraph', markerText: 'p' }),
        makeBlock('c', { markerText: 'c' }),
      ];

      expect(sweep(fixtures)).toEqual(['n1d0', 'p', 'c']);
    });

    it('stops at a missing block', () => {
      const fixtures = [makeBlock('a', { markerText: 'a' })];

      expect(sweep(fixtures, { end: 4 })).toEqual(['n1d0']);
    });

    it('stops at a shallower block', () => {
      const fixtures = [
        makeBlock('a', { markerText: 'a' }),
        makeBlock('b', { markerText: 'b' }),
        makeBlock('c', { markerText: 'c' }),
      ];
      const depthOf = (block: FakeBlock): number => (block?.id === 'b' ? 0 : 1);

      expect(sweep(fixtures, { depthOf })).toEqual(['n1d0', 'b', 'c']);
    });

    it('walks past a deeper block without renumbering it', () => {
      const fixtures = [
        makeBlock('a', { markerText: 'a' }),
        makeBlock('b', { markerText: 'b' }),
        makeBlock('c', { markerText: 'c' }),
      ];
      const depthOf = (block: FakeBlock): number => (block?.id === 'b' ? 2 : 1);

      expect(sweep(fixtures, { depthOf })).toEqual(['n1d0', 'b', 'n1d0']);
    });

    it('stops at a block of another style', () => {
      const fixtures = [makeBlock('a', { markerText: 'a' }), makeBlock('b', { markerText: 'b' })];
      const blocks = makeBlocks({ blocks: fixtures });
      const calculator = makeCalculator({ siblingIndex: 0, groupStartValue: 1, visualDepth: 0, blockStyle: 'unordered' });
      const validator = makeDepthValidator(() => 1);

      updateMarkersInRange(0, 2, -1, 1, 'ordered', blocks.api, validator, calculator.api);

      expect(fixtures.map((fixture) => fixture.marker?.textContent)).toEqual(['a', 'b']);
    });
  });

  describe('updateAllOrderedListMarkers', () => {
    it('renumbers every ordered list block in the document', () => {
      const fixtures = [makeBlock('a', { markerText: 'a' }), makeBlock('b', { markerText: 'b' })];
      const blocks = makeBlocks({ blocks: fixtures });
      const calculator = makeCalculator({ siblingIndex: 0, groupStartValue: 1, visualDepth: 0 });
      const validator = makeDepthValidator(() => 0);

      updateAllOrderedListMarkers(blocks.api, validator, calculator.api);

      expect(fixtures.map((fixture) => fixture.marker?.textContent)).toEqual(['n1d0', 'n1d0']);
      expect(blocks.getBlockByIndex).toHaveBeenNthCalledWith(1, 0);
      expect(blocks.getBlockByIndex).toHaveBeenNthCalledWith(2, 1);
      expect(blocks.getBlockByIndex).toHaveBeenCalledTimes(2);
    });

    it('walks past a block that is not a list and keeps going', () => {
      const fixtures = [
        makeBlock('p', { name: 'paragraph', markerText: 'p' }),
        makeBlock('b', { markerText: 'b' }),
      ];
      const blocks = makeBlocks({ blocks: fixtures });
      const calculator = makeCalculator({ siblingIndex: 0, groupStartValue: 1, visualDepth: 0 });
      const validator = makeDepthValidator(() => 0);

      updateAllOrderedListMarkers(blocks.api, validator, calculator.api);

      expect(fixtures.map((fixture) => fixture.marker?.textContent)).toEqual(['p', 'n1d0']);
    });

    it('walks past a block whose holder has no ordered list item', () => {
      const fixtures = [
        makeBlock('a', { withMarkerHost: false }),
        makeBlock('b', { markerText: 'b' }),
      ];
      const blocks = makeBlocks({ blocks: fixtures });
      const calculator = makeCalculator({ siblingIndex: 0, groupStartValue: 1, visualDepth: 0 });
      const validator = makeDepthValidator(() => 0);

      updateAllOrderedListMarkers(blocks.api, validator, calculator.api);

      expect(fixtures.map((fixture) => fixture.marker?.textContent)).toEqual([undefined, 'n1d0']);
    });

    it('walks past a holderless block without throwing', () => {
      const holderless = { id: 'x', name: 'list' } as unknown as BlockFixture;
      const fixtures = [holderless, makeBlock('b', { markerText: 'b' })];
      const blocks = makeBlocks({ blocks: fixtures });
      const calculator = makeCalculator({ siblingIndex: 0, groupStartValue: 1, visualDepth: 0 });
      const validator = makeDepthValidator(() => 0);

      expect(() => updateAllOrderedListMarkers(blocks.api, validator, calculator.api)).not.toThrow();
      expect(fixtures[1].marker?.textContent).toBe('n1d0');
    });

    it('reads the block count before walking', () => {
      const blocks = makeBlocks({ blocks: [] });
      const calculator = makeCalculator();
      const validator = makeDepthValidator(() => 0);

      updateAllOrderedListMarkers(blocks.api, validator, calculator.api);

      expect(blocks.getBlocksCount).toHaveBeenCalledTimes(1);
      expect(blocks.getBlockByIndex).not.toHaveBeenCalled();
    });
  });
});

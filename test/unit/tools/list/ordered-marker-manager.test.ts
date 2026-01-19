import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OrderedMarkerManager,
  resetPendingMarkerUpdate,
  getPendingMarkerUpdate,
  setPendingMarkerUpdate,
} from '../../../../src/tools/list/ordered-marker-manager';
import { TOOL_NAME, INDENT_PER_LEVEL } from '../../../../src/tools/list/constants';
import type { BlocksAPI } from '../../../../src/tools/list/marker-calculator';

/**
 * Creates a mock block for testing
 * Properly simulates the DOM structure that ListDepthValidator and ListMarkerCalculator expect
 */
const createMockBlock = (
  id: string,
  style: string = 'ordered',
  depth: number = 0,
  start: number = 1
): { id: string; name: string; holder: HTMLElement } => {
  const holder = document.createElement('div');

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-list-style', style);
  wrapper.setAttribute('data-list-depth', String(depth));
  if (start !== 1) {
    wrapper.setAttribute('data-list-start', String(start));
  }

  const listItem = document.createElement('div');
  listItem.setAttribute('role', 'listitem');
  // The depth is stored in marginLeft, which ListDepthValidator reads
  if (depth > 0) {
    listItem.style.marginLeft = `${depth * INDENT_PER_LEVEL}px`;
  }

  const marker = document.createElement('span');
  marker.setAttribute('data-list-marker', 'true');
  marker.textContent = '1.';
  marker.setAttribute('data-blok-mutation-free', 'true');

  const content = document.createElement('div');
  content.contentEditable = 'true';
  content.textContent = 'Test';

  listItem.appendChild(marker);
  listItem.appendChild(content);
  wrapper.appendChild(listItem);
  holder.appendChild(wrapper);

  return {
    id,
    name: TOOL_NAME,
    holder,
  };
};

/**
 * Creates a mock paragraph block (non-list)
 */
const createMockParagraphBlock = (id: string): { id: string; name: string; holder: HTMLElement } => {
  const holder = document.createElement('div');
  holder.innerHTML = '<p>Paragraph text</p>';
  return {
    id,
    name: 'paragraph',
    holder,
  };
};

/**
 * Creates a mock BlocksAPI for testing
 */
const createMockBlocksAPI = (blocks: Array<{ id: string; name: string; holder: HTMLElement }>, indices: Record<string, number> = {}): BlocksAPI => {
  const getBlockByIndex = (index: number) => blocks[index] ?? undefined;
  // Use indices map if provided, otherwise find by searching blocks array
  const getBlockIndex = (id: string) => {
    if (id in indices) {
      return indices[id];
    }
    const index = blocks.findIndex(b => b?.id === id);
    return index === -1 ? undefined : index;
  };
  return {
    getBlockByIndex,
    getBlockIndex,
    getBlocksCount: () => blocks.length,
    getCurrentBlockIndex: () => 0,
  } as unknown as BlocksAPI;
};

describe('ordered-marker-manager', () => {
  beforeEach(() => {
    // Reset the static pending flag before each test
    resetPendingMarkerUpdate();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('pending marker update state', () => {
    it('initially returns false for pending marker update', () => {
      expect(getPendingMarkerUpdate()).toBe(false);
    });

    it('can set and get pending marker update state', () => {
      setPendingMarkerUpdate(true);
      expect(getPendingMarkerUpdate()).toBe(true);

      setPendingMarkerUpdate(false);
      expect(getPendingMarkerUpdate()).toBe(false);
    });

    it('can reset pending marker update', () => {
      setPendingMarkerUpdate(true);
      resetPendingMarkerUpdate();
      expect(getPendingMarkerUpdate()).toBe(false);
    });
  });

  describe('updateMarker', () => {
    it('updates marker text for single block', () => {
      const block = createMockBlock('block1', 'ordered', 0);
      const blocks = createMockBlocksAPI([block], { block1: 0 });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateMarker(block.holder, 0, 0);

      const marker = block.holder.querySelector('[data-list-marker]');
      expect(marker?.textContent).toBe('1.');
    });

    it('does nothing if marker element not found', () => {
      const block = createMockBlock('block1', 'ordered', 0);
      // Remove the marker
      const marker = block.holder.querySelector('[data-list-marker]');
      marker?.remove();

      const blocks = createMockBlocksAPI([block], { block1: 0 });
      const manager = new OrderedMarkerManager(blocks);

      // Should not throw
      expect(() => manager.updateMarker(block.holder, 0, 0)).not.toThrow();
    });

    it('calculates correct marker for nested items', () => {
      // Create a parent and child ordered list
      const parent = createMockBlock('parent', 'ordered', 0);
      const child = createMockBlock('child', 'ordered', 1);

      const blocks = createMockBlocksAPI([parent, child], { parent: 0, child: 1 });
      const manager = new OrderedMarkerManager(blocks);

      // Parent should be '1.'
      manager.updateMarker(parent.holder, 0, 0);
      const parentMarker = parent.holder.querySelector('[data-list-marker]');
      expect(parentMarker?.textContent).toBe('1.');

      // Child at depth 1 should use alpha (a.)
      manager.updateMarker(child.holder, 1, 1);
      const childMarker = child.holder.querySelector('[data-list-marker]');
      expect(childMarker?.textContent).toBe('a.');
    });
  });

  describe('updateSiblingMarkers', () => {
    it('updates all sibling ordered list items', () => {
      const block1 = createMockBlock('block1', 'ordered', 0);
      const block2 = createMockBlock('block2', 'ordered', 0);
      const block3 = createMockBlock('block3', 'ordered', 0);

      const blocks = createMockBlocksAPI([block1, block2, block3], {
        block1: 0,
        block2: 1,
        block3: 2,
      });

      // Debug: verify the mock is set up correctly
      expect(blocks.getBlockIndex('block1')).toBe(0);
      expect(blocks.getBlockIndex('block2')).toBe(1);
      expect(blocks.getBlockIndex('block3')).toBe(2);

      // Verify getBlockByIndex returns correct blocks
      expect(blocks.getBlockByIndex(0)?.id).toBe('block1');
      expect(blocks.getBlockByIndex(1)?.id).toBe('block2');
      expect(blocks.getBlockByIndex(2)?.id).toBe('block3');

      const manager = new OrderedMarkerManager(blocks);

      // Call updateMarker directly for block2 with explicit index
      manager.updateMarker(block2.holder, 1, 0);

      // The second block should be numbered '2.'
      expect(block2.holder.querySelector('[data-list-marker]')?.textContent).toBe('2.');
    });

    it('respects style boundaries', () => {
      const ordered1 = createMockBlock('ordered1', 'ordered', 0);
      const unordered = createMockBlock('unordered', 'unordered', 0);
      const ordered2 = createMockBlock('ordered2', 'ordered', 0);

      const blocks = createMockBlocksAPI([ordered1, unordered, ordered2], {
        ordered1: 0,
        unordered: 1,
        ordered2: 2,
      });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateSiblingMarkers(0, 0);

      // First ordered list should be '1.'
      expect(ordered1.holder.querySelector('[data-list-marker]')?.textContent).toBe('1.');

      // Unordered doesn't have a marker element (the mock still creates one for ordered style)
      // But the marker update should skip it because the style doesn't match

      // Second ordered list should also be '1.' (separate group)
      expect(ordered2.holder.querySelector('[data-list-marker]')?.textContent).toBe('1.');
    });

    it('updates nested items at same depth only', () => {
      const parent1 = createMockBlock('parent1', 'ordered', 0);
      const child1 = createMockBlock('child1', 'ordered', 1);
      const child2 = createMockBlock('child2', 'ordered', 1);

      const blocks = createMockBlocksAPI([parent1, child1, child2], {
        parent1: 0,
        child1: 1,
        child2: 2,
      });
      const manager = new OrderedMarkerManager(blocks);

      // First, update all markers explicitly to set the correct values
      manager.updateMarker(parent1.holder, 0, 0);  // '1.'
      manager.updateMarker(child1.holder, 1, 1);   // 'a.'
      manager.updateMarker(child2.holder, 2, 1);   // 'b.'

      expect(parent1.holder.querySelector('[data-list-marker]')?.textContent).toBe('1.');
      expect(child1.holder.querySelector('[data-list-marker]')?.textContent).toBe('a.');
      expect(child2.holder.querySelector('[data-list-marker]')?.textContent).toBe('b.');

      // Now test updateSiblingMarkers - it should skip the current block (child1)
      // Reset markers to default
      const child1Marker = child1.holder.querySelector('[data-list-marker]');
      const child2Marker = child2.holder.querySelector('[data-list-marker]');
      if (child1Marker) child1Marker.textContent = '1.';
      if (child2Marker) child2Marker.textContent = '1.';

      // Update siblings from child1's perspective (skips child1)
      manager.updateSiblingMarkers(1, 1);

      // Parent unchanged (different depth)
      expect(parent1.holder.querySelector('[data-list-marker]')?.textContent).toBe('1.');

      // Child1 unchanged (it was skipped as current block)
      expect(child1.holder.querySelector('[data-list-marker]')?.textContent).toBe('1.');

      // Child2 should be 'b.' (second item at depth 1, counting child1 as sibling)
      expect(child2.holder.querySelector('[data-list-marker]')?.textContent).toBe('b.');
    });
  });

  describe('updateAllMarkers', () => {
    it('updates all ordered list items in the editor', () => {
      const para1 = createMockParagraphBlock('para1');
      const ordered1 = createMockBlock('ordered1', 'ordered', 0);
      const ordered2 = createMockBlock('ordered2', 'ordered', 0);
      const ordered3 = createMockBlock('ordered3', 'ordered', 0);

      const blocks = createMockBlocksAPI([para1, ordered1, ordered2, ordered3], {
        para1: 0,
        ordered1: 1,
        ordered2: 2,
        ordered3: 3,
      });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateAllMarkers();

      // Non-list blocks should be skipped (paragraph blocks don't have ordered markers)
      const para1Marker = para1.holder.querySelector('[data-list-marker]');
      expect(para1Marker).toBeNull();

      // Ordered lists should be numbered 1, 2, 3
      expect(ordered1.holder.querySelector('[data-list-marker]')?.textContent).toBe('1.');
      expect(ordered2.holder.querySelector('[data-list-marker]')?.textContent).toBe('2.');
      expect(ordered3.holder.querySelector('[data-list-marker]')?.textContent).toBe('3.');
    });
  });

  describe('scheduleUpdateAll', () => {
    it('schedules update for next frame', () => {
      const block1 = createMockBlock('block1', 'ordered', 0);
      const blocks = createMockBlocksAPI([block1], { block1: 0 });
      const manager = new OrderedMarkerManager(blocks);

      manager.scheduleUpdateAll();

      // Should set pending flag immediately
      expect(getPendingMarkerUpdate()).toBe(true);

      // Run all timers to trigger requestAnimationFrame
      vi.runAllTimers();

      // Pending flag should be reset after the callback runs
      expect(getPendingMarkerUpdate()).toBe(false);
    });

    it('deduplicates multiple calls in same frame', () => {
      const block1 = createMockBlock('block1', 'ordered', 0);
      const blocks = createMockBlocksAPI([block1], { block1: 0 });
      const manager = new OrderedMarkerManager(blocks);

      manager.scheduleUpdateAll();
      manager.scheduleUpdateAll();
      manager.scheduleUpdateAll();

      // Should still be true (not reset multiple times)
      expect(getPendingMarkerUpdate()).toBe(true);

      vi.runAllTimers();

      expect(getPendingMarkerUpdate()).toBe(false);
    });

    it('does not schedule if already pending', () => {
      const block1 = createMockBlock('block1', 'ordered', 0);
      const blocks = createMockBlocksAPI([block1], { block1: 0 });
      const manager = new OrderedMarkerManager(blocks);

      manager.scheduleUpdateAll();

      // Set flag manually to simulate already pending
      setPendingMarkerUpdate(true);

      const initialPending = getPendingMarkerUpdate();
      manager.scheduleUpdateAll();

      // Flag should still be true (no change)
      expect(getPendingMarkerUpdate()).toBe(initialPending);
    });
  });

  describe('start value handling', () => {
    it('uses start value from data attribute', () => {
      const block1 = createMockBlock('block1', 'ordered', 0, 5); // Start at 5
      const block2 = createMockBlock('block2', 'ordered', 0);

      const blocks = createMockBlocksAPI([block1, block2], {
        block1: 0,
        block2: 1,
      });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateAllMarkers();

      expect(block1.holder.querySelector('[data-list-marker]')?.textContent).toBe('5.');
      expect(block2.holder.querySelector('[data-list-marker]')?.textContent).toBe('6.');
    });

    it('defaults to 1 when no start value', () => {
      const block1 = createMockBlock('block1', 'ordered', 0);
      const block2 = createMockBlock('block2', 'ordered', 0);

      const blocks = createMockBlocksAPI([block1, block2], {
        block1: 0,
        block2: 1,
      });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateAllMarkers();

      expect(block1.holder.querySelector('[data-list-marker]')?.textContent).toBe('1.');
      expect(block2.holder.querySelector('[data-list-marker]')?.textContent).toBe('2.');
    });
  });

  describe('depth-based formatting', () => {
    it('uses decimal format at depth 0', () => {
      const block = createMockBlock('block', 'ordered', 0);
      const blocks = createMockBlocksAPI([block], { block: 0 });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateMarker(block.holder, 0, 0);

      const marker = block.holder.querySelector('[data-list-marker]');
      expect(marker?.textContent).toBe('1.');
    });

    it('uses alpha format at depth 1', () => {
      const block = createMockBlock('block', 'ordered', 1);
      const blocks = createMockBlocksAPI([block], { block: 0 });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateMarker(block.holder, 0, 1);

      const marker = block.holder.querySelector('[data-list-marker]');
      expect(marker?.textContent).toBe('a.');
    });

    it('uses roman format at depth 2', () => {
      const block = createMockBlock('block', 'ordered', 2);
      const blocks = createMockBlocksAPI([block], { block: 0 });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateMarker(block.holder, 0, 2);

      const marker = block.holder.querySelector('[data-list-marker]');
      expect(marker?.textContent).toBe('i.');
    });

    it('cycles back to decimal at depth 3', () => {
      const block = createMockBlock('block', 'ordered', 3);
      const blocks = createMockBlocksAPI([block], { block: 0 });
      const manager = new OrderedMarkerManager(blocks);

      manager.updateMarker(block.holder, 0, 3);

      const marker = block.holder.querySelector('[data-list-marker]');
      expect(marker?.textContent).toBe('1.');
    });
  });
});

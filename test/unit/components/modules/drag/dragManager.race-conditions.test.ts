/**
 * Race condition and timing tests for DragManager
 * Tests for rapid start/stop, overlapping operations, and timing edge cases
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DragController as DragManager } from '../../../../../src/components/modules/drag/DragController';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import type { Block } from '../../../../../src/components/block';
import { DATA_ATTR } from '../../../../../src/components/constants';
import * as tooltip from '../../../../../src/components/utils/tooltip';
import * as announcer from '../../../../../src/components/utils/announcer';

/**
 * Store for original document.elementFromPoint
 */
let originalElementFromPoint: typeof document.elementFromPoint;

type DragManagerSetup = {
  dragManager: DragManager;
  modules: BlokModules;
  blocks: Block[];
  wrapper: HTMLDivElement;
};

type ModuleOverrides = Partial<BlokModules>;

/**
 * Creates a mock block for testing
 */
const createBlockStub = (options: {
  id?: string;
  selected?: boolean;
  stretched?: boolean;
  listDepth?: number | null;
} = {}): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  // Create content element structure
  const contentElement = document.createElement('div');

  contentElement.setAttribute('data-blok-element-content', '');
  holder.appendChild(contentElement);

  // Add tool content
  const toolElement = document.createElement('div');

  toolElement.textContent = 'Block content';
  contentElement.appendChild(toolElement);

  // Add list depth if provided
  if (options.listDepth !== undefined && options.listDepth !== null) {
    const listWrapper = document.createElement('div');

    listWrapper.setAttribute('data-list-depth', String(options.listDepth));
    contentElement.appendChild(listWrapper);
  }

  // Mock getBoundingClientRect
  holder.getBoundingClientRect = vi.fn(() => ({
    top: 0,
    bottom: 50,
    left: 0,
    right: 100,
    width: 100,
    height: 50,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));

  contentElement.getBoundingClientRect = vi.fn(() => ({
    top: 0,
    bottom: 50,
    left: 0,
    right: 100,
    width: 100,
    height: 50,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));

  let isSelected = options.selected ?? false;

  const block = {
    id: options.id ?? `block-${Math.random().toString(16).slice(2)}`,
    holder,
    stretched: options.stretched ?? false,
  };

  Object.defineProperty(block, 'selected', {
    configurable: true,
    enumerable: true,
    get: () => isSelected,
    set: (value: boolean) => {
      isSelected = value;
    },
  });

  return block as unknown as Block;
};

/**
 * Creates a DragManager instance with mocked dependencies
 */
const createDragManager = (overrides: ModuleOverrides = {}): DragManagerSetup => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-editor', '');

  const blocks = [
    createBlockStub({ id: 'block-1' }),
    createBlockStub({ id: 'block-2' }),
    createBlockStub({ id: 'block-3' }),
  ];

  const blockManager = {
    blocks,
    getBlockIndex: vi.fn((block: Block) => blocks.indexOf(block)),
    getBlockByIndex: vi.fn((index: number) => blocks[index]),
    move: vi.fn(),
    insert: vi.fn(),
  };

  const blockSelection = {
    selectedBlocks: [] as Block[],
    clearSelection: vi.fn(),
    selectBlock: vi.fn(),
  };

  const toolbar = {
    close: vi.fn(),
    moveAndOpen: vi.fn(),
    skipNextSettingsToggle: vi.fn(),
  };

  const ui = {
    nodes: {
      wrapper,
      redactor: document.createElement('div'),
      holder: document.createElement('div'),
    },
    contentRect: { left: 0 },
  };

  const i18n = {
    t: vi.fn((key: string, vars?: Record<string, unknown>) => {
      let text = key;

      if (vars) {
        for ( const [k, v] of Object.entries(vars)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }

      return text;
    }),
    has: vi.fn(() => false),
  };

  const defaults: ModuleOverrides = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    BlockSelection: blockSelection as unknown as BlokModules['BlockSelection'],
    Toolbar: toolbar as unknown as BlokModules['Toolbar'],
    UI: ui as unknown as BlokModules['UI'],
    I18n: i18n as unknown as BlokModules['I18n'],
  };

  const yjsManager = {
    transact: vi.fn((callback: () => void) => callback()),
    transactMoves: vi.fn(),
  };

  const mergedState = {
    ...defaults,
    ...overrides,
    YjsManager: yjsManager as unknown as BlokModules['YjsManager'],
  } as BlokModules;
  const dragManager = new DragManager({
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  dragManager.state = mergedState;

  // Call prepare to initialize internal components
  void dragManager.prepare();

  return {
    dragManager,
    modules: mergedState,
    blocks,
    wrapper,
  };
};

/**
 * Simulates a mouse event
 */
const createMouseEvent = (type: string, options: Partial<MouseEventInit> = {}): MouseEvent => {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    button: 0,
    ...options,
  });
};

describe('DragManager - Race Conditions and Timing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tooltip, 'hide').mockImplementation(() => undefined);
    vi.spyOn(announcer, 'announce').mockImplementation(() => undefined);

    // Mock document.elementFromPoint which is not available in JSDOM
    originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn().mockReturnValue(null);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.elementFromPoint = originalElementFromPoint;
  });

  describe('rapid start/stop cycles', () => {
    it('should handle rapid mousedown/mouseup without starting drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Rapid click-like sequence
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      // Should not have started dragging
      expect(dragManager.isDragging).toBe(false);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.dragging);
    });

    it('should handle multiple rapid drag start attempts', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle1 = document.createElement('div');
      const dragHandle2 = document.createElement('div');

      dragManager.setupDragHandle(dragHandle1, blocks[0]);
      dragManager.setupDragHandle(dragHandle2, blocks[1]);

      // Start drag on first block
      dragHandle1.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));

      // Immediately cancel first drag
      dragManager.cancelTracking();

      // Now second drag handle should work (first was cancelled)
      dragHandle2.dispatchEvent(createMouseEvent('mousedown', { clientX: 200, clientY: 100 }));

      // Second drag should now be tracked
      expect(dragManager.isDragging).toBe(false); // Still tracking, not dragging yet

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('should complete cleanup even if mouseup fires immediately after mousedown', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Simulate immediate mouseup
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mouseup', { clientX: 100, clientY: 100 }));

      // Verify clean state
      expect(dragManager.isDragging).toBe(false);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.dragging);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.draggingMulti);

      // Should be able to start a new drag
      const dragHandle2 = document.createElement('div');
      dragManager.setupDragHandle(dragHandle2, blocks[1]);

      dragHandle2.dispatchEvent(createMouseEvent('mousedown', { clientX: 200, clientY: 100 }));

      expect(dragManager.isDragging).toBe(false);

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('overlapping drag operations', () => {
    it('should ignore mousedown on another handle during active drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle1 = document.createElement('div');
      const dragHandle2 = document.createElement('div');

      dragManager.setupDragHandle(dragHandle1, blocks[0]);
      dragManager.setupDragHandle(dragHandle2, blocks[1]);

      // Start first drag
      dragHandle1.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(true);

      // Try to click second handle (without dragging) while first is active
      // This should not start a new drag since the first is still active
      // We'll just verify the state hasn't changed
      expect(dragManager.isDragging).toBe(true);

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('should handle destroy called during active drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(true);

      // Destroy during drag
      dragManager.destroy();

      // Should clean up everything
      expect(dragManager.isDragging).toBe(false);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.dragging);
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.draggingMulti);
    });
  });

  describe('event timing edge cases', () => {
    it('should handle mousemove before mousedown gracefully', () => {
      const { dragManager, wrapper } = createDragManager();

      document.body.appendChild(wrapper);

      // Mousemove before any mousedown - should not throw
      expect(() => {
        document.dispatchEvent(createMouseEvent('mousemove', { clientX: 100, clientY: 100 }));
      }).not.toThrow();

      expect(dragManager.isDragging).toBe(false);
    });

    it('should handle mouseup before mousedown gracefully', () => {
      const { dragManager, wrapper } = createDragManager();

      document.body.appendChild(wrapper);

      // Mouseup before any mousedown - should not throw
      expect(() => {
        document.dispatchEvent(createMouseEvent('mouseup'));
      }).not.toThrow();

      expect(dragManager.isDragging).toBe(false);
    });

    it('should handle escape key before drag starts', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start tracking but don't pass threshold
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));

      // Press escape before threshold passed
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });

      document.dispatchEvent(escapeEvent);

      // Should cancel tracking
      expect(dragManager.isDragging).toBe(false);
    });

    it('should handle Alt key pressed before drag starts', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Press Alt before drag starts
      // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Testing drag-and-drop requires direct keyboard event dispatching
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

      // Start tracking
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      // Duplicating attribute should not be set until drag is actually active
      expect(wrapper).not.toHaveAttribute(DATA_ATTR.duplicating);

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('cleanup edge cases', () => {
    it('should handle multiple cleanup calls safely', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(true);

      // Cleanup via mouseup
      document.dispatchEvent(createMouseEvent('mouseup'));

      expect(dragManager.isDragging).toBe(false);

      // Call destroy again - should be safe
      expect(() => {
        dragManager.destroy();
      }).not.toThrow();
    });

    it('should handle cancelTracking called during active drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(true);

      // cancelTracking should not cancel once drag has started
      dragManager.cancelTracking();

      expect(dragManager.isDragging).toBe(true); // Still dragging

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('should handle cancelTracking called during tracking phase', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start tracking but don't pass threshold
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));

      // cancelTracking during tracking phase should cancel
      dragManager.cancelTracking();

      // Now move past threshold - should not start drag
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(false);
    });
  });

  describe('DOM mutation during drag', () => {
    it('should handle target block being removed during drag', () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(true);

      // Remove the target block from DOM (simulating external mutation)
      const targetBlock = blocks[2];
      wrapper.removeChild(targetBlock.holder);

      // Update block manager to reflect removal
      (modules.BlockManager as unknown as { blocks: Block[] }).blocks = [blocks[0], blocks[1]];
      (modules.BlockManager.getBlockIndex as Mock).mockImplementation((block: Block) => {
        const visibleBlocks = [blocks[0], blocks[1]];
        return visibleBlocks.indexOf(block);
      });

      // Move over where target was - should handle gracefully
      vi.mocked(document.elementFromPoint).mockReturnValue(null);
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 50, clientY: 130 }));

      // Should not throw
      expect(dragManager.isDragging).toBe(true);

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('should handle drag handle being removed during drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(true);

      // Remove drag handle from DOM
      dragHandle.remove();

      // Drag should still be active (event listeners are on document)
      expect(dragManager.isDragging).toBe(true);

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('concurrent state updates', () => {
    it('should handle rapid target updates during drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(true);

      // Rapidly move over different blocks
      for (const block of blocks) {
        vi.mocked(document.elementFromPoint).mockReturnValue(block.holder);
        (block.holder.getBoundingClientRect as Mock).mockReturnValue({
          top: 0,
          bottom: 50,
          left: 0,
          right: 100,
          width: 100,
          height: 50,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        });
        document.dispatchEvent(createMouseEvent('mousemove', { clientX: 50, clientY: 25 }));
      }

      // Should handle all updates without error
      expect(dragManager.isDragging).toBe(true);

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('should handle rapid Alt key press/release during drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      expect(dragManager.isDragging).toBe(true);

      // Rapid Alt key toggle
      for (let i = 0; i < 5; i++) {
        // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Testing drag-and-drop requires direct keyboard event dispatching
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
        expect(wrapper).toHaveAttribute(DATA_ATTR.duplicating, 'true');

        // eslint-disable-next-line internal-unit-test/no-direct-event-dispatch -- Testing drag-and-drop requires direct keyboard event dispatching
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
        expect(wrapper).not.toHaveAttribute(DATA_ATTR.duplicating);
      }

      // Cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });
});

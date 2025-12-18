import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DragManager } from '../../../../src/components/modules/dragManager';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import type { Block } from '../../../../src/components/block';
import { DATA_ATTR } from '../../../../src/components/constants';
import * as tooltip from '../../../../src/components/utils/tooltip';
import * as announcer from '../../../../src/components/utils/announcer';

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
  };

  const i18n = {
    t: vi.fn((key: string, vars?: Record<string, unknown>) => {
      let text = key;

      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
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

  const mergedState = { ...defaults, ...overrides } as BlokModules;
  const dragManager = new DragManager({
    config: {} as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  dragManager.state = mergedState;

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

describe('DragManager', () => {
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

  describe('isDragging', () => {
    it('returns false when no drag operation is in progress', () => {
      const { dragManager } = createDragManager();

      expect(dragManager.isDragging).toBe(false);
    });

    it('returns false during drag tracking (before threshold)', () => {
      const { dragManager, blocks } = createDragManager();

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Start tracking
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Still tracking, not dragging yet
      expect(dragManager.isDragging).toBe(false);

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('returns true after drag threshold is passed', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Start tracking
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold (5px default)
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(true);

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('setupDragHandle', () => {
    it('returns a cleanup function', () => {
      const { dragManager, blocks } = createDragManager();
      const dragHandle = document.createElement('div');
      const block = blocks[0];

      const cleanup = dragManager.setupDragHandle(dragHandle, block);

      expect(typeof cleanup).toBe('function');
    });

    it('only responds to left mouse button', () => {
      const { dragManager, blocks } = createDragManager();
      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Right mouse button should not start tracking
      const rightClickEvent = createMouseEvent('mousedown', { button: 2 });

      dragHandle.dispatchEvent(rightClickEvent);

      // isDragging should remain false
      expect(dragManager.isDragging).toBe(false);
    });

    it('cleanup function removes event listener', () => {
      const { dragManager, blocks } = createDragManager();
      const dragHandle = document.createElement('div');
      const block = blocks[0];

      const cleanup = dragManager.setupDragHandle(dragHandle, block);

      cleanup();

      // After cleanup, mousedown should not start tracking
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold - should not trigger drag
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(false);
    });

    it('does not start drag if block has no content element', () => {
      const { dragManager } = createDragManager();

      // Create block without content element
      const holder = document.createElement('div');

      holder.setAttribute('data-blok-element', '');
      const block = { id: 'no-content', holder } as unknown as Block;

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      expect(dragManager.isDragging).toBe(false);
    });
  });

  describe('cancelTracking', () => {
    it('cancels tracking before drag has started', () => {
      const { dragManager, blocks } = createDragManager();
      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Start tracking
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Cancel tracking
      dragManager.cancelTracking();

      // Move past threshold - should not trigger drag since tracking was cancelled
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(false);
    });

    it('does not cancel if drag has already started', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Start tracking
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(true);

      // Try to cancel - should have no effect since drag is in progress
      dragManager.cancelTracking();

      expect(dragManager.isDragging).toBe(true);

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('drag threshold', () => {
    it('does not start drag until threshold is passed', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Start tracking
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move less than threshold (5px)
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 103, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(false);

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('starts drag when threshold is exactly reached', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Start tracking
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move exactly threshold (5px)
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 105, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(true);

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('uses diagonal distance for threshold calculation', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Start tracking
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move 3px in each direction (diagonal distance = sqrt(18) = ~4.24px < 5px threshold)
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 103, clientY: 103 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(false);

      // Move 4px in each direction (diagonal distance = sqrt(32) = ~5.66px > 5px threshold)
      const mouseMoveEvent2 = createMouseEvent('mousemove', { clientX: 104, clientY: 104 });

      document.dispatchEvent(mouseMoveEvent2);

      expect(dragManager.isDragging).toBe(true);

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('drag start', () => {
    it('sets dragging attribute on wrapper', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(wrapper.getAttribute(DATA_ATTR.dragging)).toBe('true');

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('hides tooltip when drag starts', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(tooltip.hide).toHaveBeenCalledWith(true);

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('closes toolbar when drag starts', () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(modules.Toolbar.close).toHaveBeenCalled();

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('clears selection for single-block drag', () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(modules.BlockSelection.clearSelection).toHaveBeenCalled();

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('announces drag started to screen readers', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(announcer.announce).toHaveBeenCalled();

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('multi-block drag', () => {
    it('sets multi-block dragging attribute when multiple blocks selected', () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      // Select multiple blocks
      blocks[0].selected = true;
      blocks[1].selected = true;
      (modules.BlockSelection as unknown as { selectedBlocks: Block[] }).selectedBlocks = [blocks[0], blocks[1]];

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(wrapper.getAttribute(DATA_ATTR.draggingMulti)).toBe('true');

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('keeps selection visible during multi-block drag', () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      // Select multiple blocks
      blocks[0].selected = true;
      blocks[1].selected = true;
      (modules.BlockSelection as unknown as { selectedBlocks: Block[] }).selectedBlocks = [blocks[0], blocks[1]];

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Selection should NOT be cleared for multi-block drag
      expect(modules.BlockSelection.clearSelection).not.toHaveBeenCalled();

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('escape key cancellation', () => {
    it('cancels drag when escape key is pressed', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(true);

      // Press escape
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });

      document.dispatchEvent(escapeEvent);

      expect(dragManager.isDragging).toBe(false);
    });

    it('announces cancellation when escape pressed during drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Clear previous announce calls
      vi.mocked(announcer.announce).mockClear();

      // Press escape
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });

      document.dispatchEvent(escapeEvent);

      expect(announcer.announce).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('removes dragging attributes from wrapper on cleanup', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(wrapper.getAttribute(DATA_ATTR.dragging)).toBe('true');

      // Mouse up triggers cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));

      expect(wrapper.getAttribute(DATA_ATTR.dragging)).toBeNull();
    });

    it('removes preview element from DOM on cleanup', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Preview should be in DOM during drag
      const previewBefore = document.body.querySelector('[class*="fixed"][class*="pointer-events-none"]');

      expect(previewBefore).not.toBeNull();

      // Mouse up triggers cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));

      const previewAfter = document.body.querySelector('[class*="fixed"][class*="pointer-events-none"]');

      expect(previewAfter).toBeNull();
    });

    it('removes document event listeners on cleanup', () => {
      const { dragManager, blocks } = createDragManager();

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Mouse up triggers cleanup
      document.dispatchEvent(createMouseEvent('mouseup'));

      // Start a new drag to verify listeners were properly cleaned up
      expect(dragManager.isDragging).toBe(false);
    });
  });

  describe('drop handling', () => {
    it('moves block when dropped on target', () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Mock document.elementFromPoint to return target block
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[2].holder);

      // Mock block holder position
      (blocks[2].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      // Move over target (bottom half of block)
      const moveOverTarget = createMouseEvent('mousemove', { clientX: 50, clientY: 130 });

      document.dispatchEvent(moveOverTarget);

      // Drop
      document.dispatchEvent(createMouseEvent('mouseup'));

      expect(modules.BlockManager.move).toHaveBeenCalled();
    });

    it('re-opens toolbar on dropped block', () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Mock document.elementFromPoint
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[2].holder);

      (blocks[2].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      // Move over target
      const moveOverTarget = createMouseEvent('mousemove', { clientX: 50, clientY: 130 });

      document.dispatchEvent(moveOverTarget);

      // Drop
      document.dispatchEvent(createMouseEvent('mouseup'));

      expect(modules.Toolbar.skipNextSettingsToggle).toHaveBeenCalled();
      expect(modules.Toolbar.moveAndOpen).toHaveBeenCalledWith(blocks[0]);
    });

    it('does not move block when dropped on itself', () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Mock document.elementFromPoint to return source block
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[0].holder);

      // Move over source block
      const moveOverTarget = createMouseEvent('mousemove', { clientX: 50, clientY: 25 });

      document.dispatchEvent(moveOverTarget);

      // Drop
      document.dispatchEvent(createMouseEvent('mouseup'));

      expect(modules.BlockManager.move).not.toHaveBeenCalled();
    });
  });

  describe('drop indicator', () => {
    it('adds drop indicator attribute to target block', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Mock document.elementFromPoint
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[2].holder);

      (blocks[2].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      // Move over target (bottom half)
      const moveOverTarget = createMouseEvent('mousemove', { clientX: 50, clientY: 130 });

      document.dispatchEvent(moveOverTarget);

      expect(blocks[2].holder.getAttribute('data-drop-indicator')).toBe('bottom');

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('removes drop indicator on cleanup', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Mock document.elementFromPoint
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[2].holder);

      (blocks[2].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      // Move over target
      const moveOverTarget = createMouseEvent('mousemove', { clientX: 50, clientY: 130 });

      document.dispatchEvent(moveOverTarget);

      expect(blocks[2].holder.getAttribute('data-drop-indicator')).toBe('bottom');

      // Drop
      document.dispatchEvent(createMouseEvent('mouseup'));

      expect(blocks[2].holder.getAttribute('data-drop-indicator')).toBeNull();
    });
  });

  describe('list item descendants', () => {
    it('includes list item descendants when dragging a list item', () => {
      const { dragManager, modules, wrapper } = createDragManager();

      // Create blocks with list structure
      const parentBlock = createBlockStub({ id: 'parent', listDepth: 0 });
      const childBlock1 = createBlockStub({ id: 'child-1', listDepth: 1 });
      const childBlock2 = createBlockStub({ id: 'child-2', listDepth: 2 });
      const siblingBlock = createBlockStub({ id: 'sibling', listDepth: 0 });

      const blocks = [parentBlock, childBlock1, childBlock2, siblingBlock];

      (modules.BlockManager as unknown as { blocks: Block[] }).blocks = blocks;
      (modules.BlockManager.getBlockIndex as Mock).mockImplementation((block: Block) => blocks.indexOf(block));
      (modules.BlockManager.getBlockByIndex as Mock).mockImplementation((index: number) => blocks[index]);

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, parentBlock);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Check that multi-block dragging is set (because descendants are included)
      expect(wrapper.getAttribute(DATA_ATTR.draggingMulti)).toBe('true');

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('stops collecting descendants at sibling level', () => {
      // This tests the getListItemDescendants logic - siblings should not be included
      const { dragManager, modules, wrapper } = createDragManager();

      // Create blocks: parent at depth 0, then sibling also at depth 0
      const parentBlock = createBlockStub({ id: 'parent', listDepth: 0 });
      const siblingBlock = createBlockStub({ id: 'sibling', listDepth: 0 });

      const blocks = [parentBlock, siblingBlock];

      (modules.BlockManager as unknown as { blocks: Block[] }).blocks = blocks;
      (modules.BlockManager.getBlockIndex as Mock).mockImplementation((block: Block) => blocks.indexOf(block));
      (modules.BlockManager.getBlockByIndex as Mock).mockImplementation((index: number) => blocks[index]);

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, parentBlock);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      // Should NOT be multi-block drag since sibling is not a descendant
      expect(wrapper.getAttribute(DATA_ATTR.draggingMulti)).toBeNull();

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });
  });

  describe('destroy', () => {
    it('cleans up any ongoing drag operation', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');
      const block = blocks[0];

      dragManager.setupDragHandle(dragHandle, block);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(true);

      // Destroy
      dragManager.destroy();

      expect(dragManager.isDragging).toBe(false);
      expect(wrapper.getAttribute(DATA_ATTR.dragging)).toBeNull();
    });
  });

  describe('prepare', () => {
    it('resolves without error', async () => {
      const { dragManager } = createDragManager();

      await expect(dragManager.prepare()).resolves.toBeUndefined();
    });
  });

  describe('duplication mode', () => {
    it('sets duplicating attribute when Alt key is pressed during drag', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      const mouseDownEvent = createMouseEvent('mousedown', { clientX: 100, clientY: 100 });

      dragHandle.dispatchEvent(mouseDownEvent);

      // Move past threshold
      const mouseMoveEvent = createMouseEvent('mousemove', { clientX: 110, clientY: 100 });

      document.dispatchEvent(mouseMoveEvent);

      expect(dragManager.isDragging).toBe(true);

      // Press Alt key
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

      expect(wrapper.getAttribute(DATA_ATTR.duplicating)).toBe('true');

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('removes duplicating attribute when Alt key is released', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      // Press Alt key
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
      expect(wrapper.getAttribute(DATA_ATTR.duplicating)).toBe('true');

      // Release Alt key
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));
      expect(wrapper.getAttribute(DATA_ATTR.duplicating)).toBeNull();

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('does not set duplicating attribute if drag has not started', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start tracking but don't pass threshold
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));

      expect(dragManager.isDragging).toBe(false);

      // Press Alt key - should not set attribute since not dragging
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

      expect(wrapper.getAttribute(DATA_ATTR.duplicating)).toBeNull();

      // Clean up
      document.dispatchEvent(createMouseEvent('mouseup'));
    });

    it('removes duplicating attribute on cleanup', () => {
      const { dragManager, blocks, wrapper } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      // Press Alt key
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
      expect(wrapper.getAttribute(DATA_ATTR.duplicating)).toBe('true');

      // Clean up via mouseup
      document.dispatchEvent(createMouseEvent('mouseup'));

      expect(wrapper.getAttribute(DATA_ATTR.duplicating)).toBeNull();
    });

    it('calls insert instead of move when Alt key is held during drop', async () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      // Add mock for block.save()
      const mockSaveResult = {
        data: { text: 'Block content' },
        tunes: {},
      };

      (blocks[0] as unknown as { save: () => Promise<typeof mockSaveResult>; name: string }).save =
        vi.fn().mockResolvedValue(mockSaveResult);
      (blocks[0] as unknown as { name: string }).name = 'paragraph';

      // Add mock for insert
      (modules.BlockManager.insert as Mock).mockReturnValue(blocks[0]);

      document.body.appendChild(wrapper);
      blocks.forEach(block => wrapper.appendChild(block.holder));

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      // Set up target
      vi.mocked(document.elementFromPoint).mockReturnValue(blocks[2].holder);
      (blocks[2].holder.getBoundingClientRect as Mock).mockReturnValue({
        top: 100,
        bottom: 150,
        left: 0,
        right: 100,
        width: 100,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      });

      // Move over target
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 50, clientY: 130 }));

      // Drop with Alt key held
      document.dispatchEvent(createMouseEvent('mouseup', { altKey: true } as MouseEventInit));

      // Wait for async duplication
      await new Promise(resolve => setTimeout(resolve, 0));

      // Should have called insert instead of move
      expect(modules.BlockManager.insert).toHaveBeenCalled();
      expect(modules.BlockManager.move).not.toHaveBeenCalled();
    });

    it('does not duplicate when drop target is not set', async () => {
      const { dragManager, blocks, wrapper, modules } = createDragManager();

      document.body.appendChild(wrapper);
      wrapper.appendChild(blocks[0].holder);

      const dragHandle = document.createElement('div');

      dragManager.setupDragHandle(dragHandle, blocks[0]);

      // Start drag
      dragHandle.dispatchEvent(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
      document.dispatchEvent(createMouseEvent('mousemove', { clientX: 110, clientY: 100 }));

      // Drop with Alt key held but no target
      document.dispatchEvent(createMouseEvent('mouseup', { altKey: true } as MouseEventInit));

      // Wait for async duplication
      await new Promise(resolve => setTimeout(resolve, 0));

      // Should not have called insert or move
      expect(modules.BlockManager.insert).not.toHaveBeenCalled();
      expect(modules.BlockManager.move).not.toHaveBeenCalled();
    });
  });
});

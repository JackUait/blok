/**
 * Tests for toolbar alignment with block content:
 *
 * 1. moveAndOpen() updates the toolbox's leftAlignElement to the
 *    current block's content element so the popover aligns with the visible
 *    block content rather than the toolbar's internal content wrapper.
 *
 * 2. moveAndOpen() syncs the toolbar content wrapper's marginLeft with
 *    the block content element's computed marginLeft so toolbar buttons
 *    align with the block content edge.
 *
 * 3. moveAndOpenForMultipleBlocks() also syncs marginLeft.
 *
 * 4. close() resets the toolbar content wrapper's marginLeft.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsDispatcher } from '../../../../src/components/utils/events';
import { Toolbar } from '../../../../src/components/modules/toolbar';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokConfig } from '../../../../types';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../src/components/block';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';

/**
 * Create a minimal Toolbar instance pre-wired for moveAndOpen testing.
 */
function createToolbar(blokOverrides: Partial<BlokModules> = {}): {
  toolbar: Toolbar;
  wrapper: HTMLDivElement;
  content: HTMLDivElement;
} {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const toolbar = new Toolbar({ config: {} as BlokConfig, eventsDispatcher });

  const wrapper = document.createElement('div');
  const content = document.createElement('div');
  const actions = document.createElement('div');
  const plusButton = document.createElement('button');
  const settingsToggler = document.createElement('button');

  toolbar.nodes = { wrapper, content, actions, plusButton, settingsToggler } as unknown as typeof toolbar.nodes;

  const priv = toolbar as unknown as Record<string, unknown>;

  priv.positioner = {
    calculateToolbarY: vi.fn().mockReturnValue(100),
    moveToY: vi.fn(),
    setHoveredTarget: vi.fn(),
    resetCachedPosition: vi.fn(),
    applyContentOffset: vi.fn(),
  };
  priv.plusButtonHandler = { setHoveredBlock: vi.fn() };
  priv.settingsTogglerHandler = { setHoveredBlock: vi.fn() };

  const defaultBlok: Partial<BlokModules> = {
    BlockSettings: {
      opened: false,
      isOpening: false,
      close: vi.fn(),
    } as unknown as BlokModules['BlockSettings'],
    BlockManager: {
      currentBlock: null,
      currentBlockIndex: 0,
      blocks: [],
      getBlockByChildNode: vi.fn().mockReturnValue(null),
    } as unknown as BlokModules['BlockManager'],
    UI: {
      isMobile: false,
      resetBlockHoverState: vi.fn(),
      nodes: {
        wrapper: document.createElement('div'),
      },
    } as unknown as BlokModules['UI'],
    ReadOnly: {
      isEnabled: false,
    } as unknown as BlokModules['ReadOnly'],
    DragManager: {
      isDragging: false,
    } as unknown as BlokModules['DragManager'],
    RectangleSelection: {
      isRectActivated: vi.fn().mockReturnValue(false),
    } as unknown as BlokModules['RectangleSelection'],
  };

  toolbar.state = { ...defaultBlok, ...blokOverrides } as BlokModules;

  return { toolbar, wrapper, content };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Toolbar moveAndOpen — leftAlignElement update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates toolbox leftAlignElement with the block content element on moveAndOpen', () => {
    // Build block holder with a content element inside
    const blockHolder = document.createElement('div');
    const blockContent = document.createElement('div');

    blockContent.setAttribute(DATA_ATTR.elementContent, '');
    blockHolder.appendChild(blockContent);
    document.body.appendChild(blockHolder);

    const block = {
      id: 'block-1',
      name: 'paragraph',
      holder: blockHolder,
      isEmpty: false,
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const { toolbar } = createToolbar({
      BlockManager: {
        currentBlock: block,
        currentBlockIndex: 0,
        blocks: [block],
      } as unknown as BlokModules['BlockManager'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;
    const mockUpdateLeftAlignElement = vi.fn();

    priv.toolboxInstance = {
      opened: false,
      close: vi.fn(),
      open: vi.fn(),
      updateLeftAlignElement: mockUpdateLeftAlignElement,
    };

    // Act
    toolbar.moveAndOpen(block);

    // Assert: updateLeftAlignElement was called with the block's content element
    expect(mockUpdateLeftAlignElement).toHaveBeenCalledWith(blockContent);

    document.body.removeChild(blockHolder);
  });

  it('syncs toolbar content wrapper marginLeft with block content element on moveAndOpen', () => {
    const blockHolder = document.createElement('div');
    const blockContent = document.createElement('div');

    blockContent.setAttribute(DATA_ATTR.elementContent, '');
    blockContent.style.marginLeft = '0px';
    blockHolder.appendChild(blockContent);
    document.body.appendChild(blockHolder);

    const block = {
      id: 'block-1',
      name: 'paragraph',
      holder: blockHolder,
      isEmpty: false,
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const { toolbar, content } = createToolbar({
      BlockManager: {
        currentBlock: block,
        currentBlockIndex: 0,
        blocks: [block],
      } as unknown as BlokModules['BlockManager'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;

    priv.toolboxInstance = {
      opened: false,
      close: vi.fn(),
      open: vi.fn(),
      updateLeftAlignElement: vi.fn(),
    };

    // Act
    toolbar.moveAndOpen(block);

    // Assert: toolbar content wrapper's marginLeft matches block content's marginLeft
    expect(content.style.marginLeft).toBe('0px');

    document.body.removeChild(blockHolder);
  });

  it('clamps toolbar marginLeft to actionsWidth when block content is left-aligned (keeps buttons reachable)', () => {
    const blockHolder = document.createElement('div');
    const blockContent = document.createElement('div');

    blockContent.setAttribute(DATA_ATTR.elementContent, '');
    blockContent.style.marginLeft = '0px';
    blockHolder.appendChild(blockContent);
    document.body.appendChild(blockHolder);

    const block = {
      id: 'block-1',
      name: 'paragraph',
      holder: blockHolder,
      isEmpty: false,
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const { toolbar, content } = createToolbar({
      BlockManager: {
        currentBlock: block,
        currentBlockIndex: 0,
        blocks: [block],
      } as unknown as BlokModules['BlockManager'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;

    priv.toolboxInstance = {
      opened: false,
      close: vi.fn(),
      open: vi.fn(),
      updateLeftAlignElement: vi.fn(),
    };

    // Simulate actions having a real width (e.g. plus button + settings toggler)
    const actions = toolbar.nodes.actions!;

    vi.spyOn(actions, 'offsetWidth', 'get').mockReturnValue(51);

    // Act
    toolbar.moveAndOpen(block);

    // Assert: toolbar content marginLeft is clamped to actionsWidth (51px) so that
    // the actions container (positioned via right:100%) never extends beyond the left
    // viewport edge, keeping plus button and drag handle reachable by pointer events.
    expect(content.style.marginLeft).toBe('51px');

    document.body.removeChild(blockHolder);
  });

  it('preserves block content marginLeft for centered content even with actions width', () => {
    const blockHolder = document.createElement('div');
    const blockContent = document.createElement('div');

    blockContent.setAttribute(DATA_ATTR.elementContent, '');
    blockContent.style.marginLeft = '153px';
    blockHolder.appendChild(blockContent);
    document.body.appendChild(blockHolder);

    const block = {
      id: 'block-1',
      name: 'paragraph',
      holder: blockHolder,
      isEmpty: false,
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const { toolbar, content } = createToolbar({
      BlockManager: {
        currentBlock: block,
        currentBlockIndex: 0,
        blocks: [block],
      } as unknown as BlokModules['BlockManager'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;

    priv.toolboxInstance = {
      opened: false,
      close: vi.fn(),
      open: vi.fn(),
      updateLeftAlignElement: vi.fn(),
    };

    const actions = toolbar.nodes.actions!;

    vi.spyOn(actions, 'offsetWidth', 'get').mockReturnValue(51);

    // Act
    toolbar.moveAndOpen(block);

    // Assert: marginLeft matches block content (153px), not clamped to actionsWidth
    expect(content.style.marginLeft).toBe('153px');

    document.body.removeChild(blockHolder);
  });

  it('syncs toolbar content wrapper marginLeft on moveAndOpenForMultipleBlocks', () => {
    const blockHolder = document.createElement('div');
    const blockContent = document.createElement('div');

    blockContent.setAttribute(DATA_ATTR.elementContent, '');
    blockContent.style.marginLeft = '0px';
    blockHolder.appendChild(blockContent);
    document.body.appendChild(blockHolder);

    const block = {
      id: 'block-1',
      name: 'paragraph',
      holder: blockHolder,
      isEmpty: false,
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const block2 = {
      id: 'block-2',
      name: 'paragraph',
      holder: document.createElement('div'),
      isEmpty: false,
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const { toolbar, content } = createToolbar({
      BlockManager: {
        currentBlock: block,
        currentBlockIndex: 0,
        blocks: [block, block2],
      } as unknown as BlokModules['BlockManager'],
      BlockSelection: {
        selectedBlocks: [block, block2],
      } as unknown as BlokModules['BlockSelection'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;

    priv.toolboxInstance = {
      opened: false,
      close: vi.fn(),
      open: vi.fn(),
      updateLeftAlignElement: vi.fn(),
    };

    // Act
    toolbar.moveAndOpenForMultipleBlocks(block);

    // Assert: toolbar content wrapper's marginLeft matches block content's marginLeft
    expect(content.style.marginLeft).toBe('0px');

    document.body.removeChild(blockHolder);
  });

  it('clamps toolbar marginLeft to actionsWidth on moveAndOpenForMultipleBlocks (keeps buttons reachable)', () => {
    const blockHolder = document.createElement('div');
    const blockContent = document.createElement('div');

    blockContent.setAttribute(DATA_ATTR.elementContent, '');
    blockContent.style.marginLeft = '0px';
    blockHolder.appendChild(blockContent);
    document.body.appendChild(blockHolder);

    const block = {
      id: 'block-1',
      name: 'paragraph',
      holder: blockHolder,
      isEmpty: false,
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const block2 = {
      id: 'block-2',
      name: 'paragraph',
      holder: document.createElement('div'),
      isEmpty: false,
      setupDraggable: vi.fn(),
      cleanupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const { toolbar, content } = createToolbar({
      BlockManager: {
        currentBlock: block,
        currentBlockIndex: 0,
        blocks: [block, block2],
      } as unknown as BlokModules['BlockManager'],
      BlockSelection: {
        selectedBlocks: [block, block2],
      } as unknown as BlokModules['BlockSelection'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;

    priv.toolboxInstance = {
      opened: false,
      close: vi.fn(),
      open: vi.fn(),
      updateLeftAlignElement: vi.fn(),
    };

    const actions = toolbar.nodes.actions!;

    vi.spyOn(actions, 'offsetWidth', 'get').mockReturnValue(51);

    // Act
    toolbar.moveAndOpenForMultipleBlocks(block);

    // Assert: marginLeft is clamped to actionsWidth (51px) so that the actions container
    // (positioned via right:100%) never extends beyond the left viewport edge.
    expect(content.style.marginLeft).toBe('51px');

    document.body.removeChild(blockHolder);
  });

  it('resets toolbar content wrapper marginLeft on close', () => {
    const { toolbar, content } = createToolbar();

    const priv = toolbar as unknown as Record<string, unknown>;

    priv.toolboxInstance = {
      opened: false,
      close: vi.fn(),
      open: vi.fn(),
      updateLeftAlignElement: vi.fn(),
    };

    // Simulate a previous moveAndOpen that set marginLeft
    content.style.marginLeft = '0px';

    // Act
    toolbar.close();

    // Assert: marginLeft is reset
    expect(content.style.marginLeft).toBe('');
  });
});

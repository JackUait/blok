/**
 * Test for: moveAndOpen() updates the toolbox's leftAlignElement to the
 * current block's content element so the popover aligns with the visible
 * block content rather than the toolbar's internal content wrapper.
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
} {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const toolbar = new Toolbar({ config: {} as BlokConfig, eventsDispatcher });

  const wrapper = document.createElement('div');
  const plusButton = document.createElement('button');
  const settingsToggler = document.createElement('button');

  toolbar.nodes = { wrapper, plusButton, settingsToggler } as unknown as typeof toolbar.nodes;

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

  return { toolbar, wrapper };
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
});

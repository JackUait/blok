/**
 * Unit tests for Toolbar.moveAndOpen() — callout first-child toolbar actions visibility.
 *
 * Expected behaviour:
 * - Plus button and settings toggler HIDDEN when toolbar targets the first child of a callout block,
 *   to prevent visual overlap with the callout's emoji icon.
 * - Both VISIBLE for non-first children of a callout.
 * - Both VISIBLE for regular (non-callout) blocks.
 * - Both RESTORED when toolbar moves from a callout first-child to a regular block.
 * - focusin handler preserves hidden state while toolbar targets callout first child.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsDispatcher } from '../../../../src/components/utils/events';
import { Toolbar } from '../../../../src/components/modules/toolbar';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokConfig } from '../../../../types';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../src/components/block';

// ─── helpers ────────────────────────────────────────────────────────────────

function createToolbar(blokOverrides: Partial<BlokModules> = {}): {
  toolbar: Toolbar;
  plusButton: HTMLButtonElement;
  settingsToggler: HTMLButtonElement;
  wrapper: HTMLDivElement;
} {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const toolbar = new Toolbar({ config: {} as BlokConfig, eventsDispatcher });

  const wrapper = document.createElement('div');
  const plusButton = document.createElement('button');
  const settingsToggler = document.createElement('button');

  toolbar.nodes = { wrapper, plusButton, settingsToggler } as unknown as typeof toolbar.nodes;

  const priv = toolbar as unknown as Record<string, unknown>;

  priv.toolboxInstance = { opened: false, close: vi.fn() };
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
      close: vi.fn(),
    } as unknown as BlokModules['BlockSettings'],
    BlockManager: {
      currentBlock: null,
      blocks: [],
      getBlockByChildNode: vi.fn().mockReturnValue(null),
      getBlockById: vi.fn().mockReturnValue(undefined),
    } as unknown as BlokModules['BlockManager'],
    UI: {
      isMobile: false,
    } as unknown as BlokModules['UI'],
    ReadOnly: {
      isEnabled: false,
    } as unknown as BlokModules['ReadOnly'],
    DragManager: {} as unknown as BlokModules['DragManager'],
  };

  toolbar.state = { ...defaultBlok, ...blokOverrides } as BlokModules;

  return { toolbar, plusButton, settingsToggler, wrapper };
}

function createBlock(overrides: Partial<Block> & { id: string }): Block {
  const holder = overrides.holder ?? document.createElement('div');

  return {
    name: 'paragraph',
    isEmpty: false,
    parentId: null,
    contentIds: [],
    cleanupDraggable: vi.fn(),
    setupDraggable: vi.fn(),
    getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    holder,
    ...overrides,
  } as unknown as Block;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Toolbar — callout first-child plus button visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides plus button when toolbar targets the first child of a callout block', () => {
    /**
     * Scenario: activateToolbox calls moveAndOpen() with no args, falling back
     * to currentBlock which is the first child paragraph inside a callout.
     * The plus button should be hidden to avoid overlapping the callout emoji.
     */
    const calloutBlock = createBlock({
      id: 'callout-1',
      name: 'callout',
      contentIds: ['child-1', 'child-2'],
    });

    const childHolder = document.createElement('div');

    document.body.appendChild(childHolder);

    const firstChild = createBlock({
      id: 'child-1',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const { toolbar, plusButton } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [calloutBlock, firstChild],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return calloutBlock;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
    });

    toolbar.moveAndOpen(firstChild);

    expect(plusButton.style.display).toBe('none');

    document.body.removeChild(childHolder);
  });

  it('shows plus button when toolbar targets a non-first child of a callout block', () => {
    /**
     * Scenario: The user types "/" in the second child of a callout.
     * The plus button should remain visible since only the first child
     * overlaps with the emoji icon.
     */
    const calloutBlock = createBlock({
      id: 'callout-1',
      name: 'callout',
      contentIds: ['child-1', 'child-2'],
    });

    const childHolder = document.createElement('div');

    document.body.appendChild(childHolder);

    const secondChild = createBlock({
      id: 'child-2',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const { toolbar, plusButton } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [calloutBlock, secondChild],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return calloutBlock;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
    });

    toolbar.moveAndOpen(secondChild);

    expect(plusButton.style.display).toBe('');

    document.body.removeChild(childHolder);
  });

  it('shows plus button for a regular block not inside a callout', () => {
    const regularBlock = createBlock({
      id: 'para-1',
      name: 'paragraph',
    });

    document.body.appendChild(regularBlock.holder);

    const { toolbar, plusButton } = createToolbar();

    toolbar.moveAndOpen(regularBlock);

    expect(plusButton.style.display).toBe('');

    document.body.removeChild(regularBlock.holder);
  });

  it('restores plus button when moving from callout first-child to a regular block', () => {
    /**
     * Scenario: Toolbar was on the first child (plus button hidden),
     * then moves to a regular block — plus button should be visible again.
     */
    const calloutBlock = createBlock({
      id: 'callout-1',
      name: 'callout',
      contentIds: ['child-1'],
    });

    const childHolder = document.createElement('div');
    const regularHolder = document.createElement('div');

    document.body.appendChild(childHolder);
    document.body.appendChild(regularHolder);

    const firstChild = createBlock({
      id: 'child-1',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const regularBlock = createBlock({
      id: 'para-1',
      name: 'paragraph',
      holder: regularHolder,
    });

    const { toolbar, plusButton } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [calloutBlock, firstChild, regularBlock],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return calloutBlock;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
    });

    // First: move to callout first child — plus button should be hidden
    toolbar.moveAndOpen(firstChild);
    expect(plusButton.style.display).toBe('none');

    // Then: move to regular block — plus button should be restored
    toolbar.moveAndOpen(regularBlock);
    expect(plusButton.style.display).toBe('');

    document.body.removeChild(childHolder);
    document.body.removeChild(regularHolder);
  });

  it('hides settings toggler when toolbar targets the first child of a callout block', () => {
    const calloutBlock = createBlock({
      id: 'callout-1',
      name: 'callout',
      contentIds: ['child-1'],
    });

    const childHolder = document.createElement('div');

    document.body.appendChild(childHolder);

    const firstChild = createBlock({
      id: 'child-1',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const { toolbar, settingsToggler } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [calloutBlock, firstChild],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return calloutBlock;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
    });

    toolbar.moveAndOpen(firstChild);

    expect(settingsToggler.style.display).toBe('none');

    document.body.removeChild(childHolder);
  });

  it('shows settings toggler for non-first children of a callout block', () => {
    const calloutBlock = createBlock({
      id: 'callout-1',
      name: 'callout',
      contentIds: ['child-1', 'child-2'],
    });

    const childHolder = document.createElement('div');

    document.body.appendChild(childHolder);

    const secondChild = createBlock({
      id: 'child-2',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const { toolbar, settingsToggler } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [calloutBlock, secondChild],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return calloutBlock;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
    });

    toolbar.moveAndOpen(secondChild);

    expect(settingsToggler.style.display).toBe('');

    document.body.removeChild(childHolder);
  });

  it('focusin handler preserves hidden state while toolbar targets callout first child', () => {
    /**
     * Scenario: Toolbar is on the first child (actions hidden), then a focusin
     * event fires (e.g. user clicks within the same block). The focusin handler
     * must NOT restore the plus button or settings toggler to visible.
     */
    const calloutBlock = createBlock({
      id: 'callout-1',
      name: 'callout',
      contentIds: ['child-1'],
    });

    const childHolder = document.createElement('div');
    const editable = document.createElement('div');

    editable.setAttribute('contenteditable', 'true');
    editable.tabIndex = 0;
    childHolder.appendChild(editable);
    document.body.appendChild(childHolder);

    const firstChild = createBlock({
      id: 'child-1',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const editorWrapper = document.createElement('div');

    document.body.appendChild(editorWrapper);

    const { toolbar, plusButton, settingsToggler } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [calloutBlock, firstChild],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return calloutBlock;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
      UI: {
        isMobile: false,
        nodes: { wrapper: editorWrapper },
      } as unknown as BlokModules['UI'],
    });

    // Move toolbar to callout first child — actions should be hidden
    toolbar.moveAndOpen(firstChild);
    expect(plusButton.style.display).toBe('none');
    expect(settingsToggler.style.display).toBe('none');

    // Simulate focusin by calling the private method directly
    const priv = toolbar as unknown as Record<string, () => void>;

    priv.updateToolbarButtonsForTableCellFocus();

    // Actions must STAY hidden
    expect(plusButton.style.display).toBe('none');
    expect(settingsToggler.style.display).toBe('none');

    document.body.removeChild(childHolder);
    document.body.removeChild(editorWrapper);
  });
});

// ─── button background color override tests ───────────────────────────────

describe('Toolbar — callout background color override on control buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createCalloutBlockWithColors(options: {
    id: string;
    contentIds: string[];
    textColor?: string;
    backgroundColor?: string;
  }): Block {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-component', 'callout');

    const contentElement = document.createElement('div');

    contentElement.setAttribute('data-blok-element-content', '');

    const toolRendered = document.createElement('div');

    if (options.textColor) {
      toolRendered.style.color = options.textColor;
    }

    if (options.backgroundColor) {
      toolRendered.style.backgroundColor = options.backgroundColor;
    }

    contentElement.appendChild(toolRendered);
    holder.appendChild(contentElement);

    return createBlock({
      id: options.id,
      name: 'callout',
      contentIds: options.contentIds,
      holder,
      pluginsContent: toolRendered,
    } as Partial<Block> & { id: string });
  }

  it('overrides --blok-bg-light on wrapper when inside callout with background color', () => {
    const callout = createCalloutBlockWithColors({
      id: 'callout-1',
      contentIds: ['child-1', 'child-2'],
      backgroundColor: 'var(--blok-color-brown-bg)',
    });

    const childHolder = document.createElement('div');

    callout.holder.appendChild(childHolder);
    document.body.appendChild(callout.holder);

    const child = createBlock({
      id: 'child-2',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const { toolbar, wrapper } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return callout;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
    });

    toolbar.moveAndOpen(child);

    expect(wrapper.style.getPropertyValue('--blok-bg-light')).toBe('color-mix(in srgb, var(--blok-color-brown-bg) 50%, white)');

    document.body.removeChild(callout.holder);
  });

  it('does NOT override --blok-bg-light when callout has no background color', () => {
    const callout = createCalloutBlockWithColors({
      id: 'callout-1',
      contentIds: ['child-1', 'child-2'],
      textColor: 'var(--blok-color-red-text)',
    });

    const childHolder = document.createElement('div');

    callout.holder.appendChild(childHolder);
    document.body.appendChild(callout.holder);

    const child = createBlock({
      id: 'child-2',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const { toolbar, wrapper } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return callout;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
    });

    toolbar.moveAndOpen(child);

    expect(wrapper.style.getPropertyValue('--blok-bg-light')).toBe('');

    document.body.removeChild(callout.holder);
  });

  it('clears --blok-bg-light override when moving from callout child to regular block', () => {
    const callout = createCalloutBlockWithColors({
      id: 'callout-1',
      contentIds: ['child-1', 'child-2'],
      backgroundColor: 'var(--blok-color-blue-bg)',
    });

    const childHolder = document.createElement('div');
    const regularHolder = document.createElement('div');

    callout.holder.appendChild(childHolder);
    document.body.appendChild(callout.holder);
    document.body.appendChild(regularHolder);

    const child = createBlock({
      id: 'child-2',
      name: 'paragraph',
      parentId: 'callout-1',
      holder: childHolder,
    });

    const regularBlock = createBlock({
      id: 'para-1',
      name: 'paragraph',
      holder: regularHolder,
    });

    const { toolbar, wrapper } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockImplementation((id: string) => {
          if (id === 'callout-1') return callout;

          return undefined;
        }),
      } as unknown as BlokModules['BlockManager'],
    });

    // Move to callout child — variable should be overridden
    toolbar.moveAndOpen(child);
    expect(wrapper.style.getPropertyValue('--blok-bg-light')).toBe('color-mix(in srgb, var(--blok-color-blue-bg) 50%, white)');

    // Move to regular block — variable override should be cleared
    toolbar.moveAndOpen(regularBlock);
    expect(wrapper.style.getPropertyValue('--blok-bg-light')).toBe('');

    document.body.removeChild(callout.holder);
    document.body.removeChild(regularHolder);
  });

  it('does NOT override --blok-bg-light when target IS the callout block itself', () => {
    const callout = createCalloutBlockWithColors({
      id: 'callout-1',
      contentIds: ['child-1'],
      backgroundColor: 'var(--blok-color-green-bg)',
    });

    document.body.appendChild(callout.holder);

    const result = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [callout],
        getBlockByChildNode: vi.fn().mockReturnValue(null),
        getBlockById: vi.fn().mockReturnValue(undefined),
      } as unknown as BlokModules['BlockManager'],
    });

    const priv = result.toolbar as unknown as Record<string, unknown>;

    (priv.toolboxInstance as Record<string, unknown>).updateLeftAlignElement = vi.fn();

    result.toolbar.moveAndOpen(callout);

    expect(result.wrapper.style.getPropertyValue('--blok-bg-light')).toBe('');

    document.body.removeChild(callout.holder);
  });
});

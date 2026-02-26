/**
 * Regression test for: toolbox.open() overrides currentBlock with the resolved
 * table block when the toolbar was already opened from hover, causing the toolbox
 * to lose the cell-paragraph context and fail to hide restricted tools.
 *
 * The bug: When "/" is typed inside a table cell, the toolbar is already `opened`
 * (from hover), so `moveAndOpen()` is skipped. The stale `hoveredBlockIsFromTableCell`
 * (false, set during hover resolution) allows the `toolbox.open()` getter to
 * override `currentBlock` with `hoveredBlock` (the TABLE block). The toolbox then
 * reads the table block's index, whose holder is NOT inside
 * `[data-blok-table-cell-blocks]`, so `isInsideTableCell` is false and restricted
 * tools are never hidden.
 *
 * The fix: The `toolbox.open()` getter now also checks if the current block's
 * holder is inside a table cell and skips the override if so.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsDispatcher } from '../../../../src/components/utils/events';
import { Toolbar } from '../../../../src/components/modules/toolbar';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokConfig } from '../../../../types';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../src/components/block';

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build DOM structure simulating a table with a cell paragraph inside.
 * Returns DOM nodes needed for assertion.
 */
function createTableCellDOM(): {
  tableHolder: HTMLDivElement;
  cellContainer: HTMLDivElement;
  cellParagraphHolder: HTMLDivElement;
} {
  const tableHolder = document.createElement('div');
  const cellContainer = document.createElement('div');
  const cellParagraphHolder = document.createElement('div');

  cellContainer.setAttribute('data-blok-table-cell-blocks', '');
  cellContainer.appendChild(cellParagraphHolder);
  tableHolder.appendChild(cellContainer);
  document.body.appendChild(tableHolder);

  return { tableHolder, cellContainer, cellParagraphHolder };
}

/**
 * Create a minimal Toolbar instance pre-wired for toolbox.open() testing.
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
    DragManager: {} as unknown as BlokModules['DragManager'],
  };

  toolbar.state = { ...defaultBlok, ...blokOverrides } as BlokModules;

  return { toolbar, wrapper };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Toolbar toolbox.open() — table cell currentBlock preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT override currentBlock when the current block is inside a table cell', () => {
    /**
     * Regression scenario:
     * 1. User clicks into a table cell → hover triggers moveAndOpen on TABLE block.
     *    hoveredBlockIsFromTableCell = false (TABLE holder is NOT inside cell).
     * 2. User types "/" → slashPressed sets currentBlock to cell paragraph (index 1).
     * 3. activateToolbox calls toolbar.toolbox.open().
     * 4. The getter should NOT override currentBlock with hoveredBlock (TABLE block)
     *    because the current block's holder IS inside [data-blok-table-cell-blocks].
     */
    const { tableHolder, cellParagraphHolder } = createTableCellDOM();

    const cellParagraphBlock = {
      id: 'para-1',
      name: 'paragraph',
      holder: cellParagraphHolder,
    } as unknown as Block;

    const tableBlock = {
      id: 'table-1',
      name: 'table',
      holder: tableHolder,
    } as unknown as Block;

    const mockSetCurrentBlock = vi.fn();

    const blockManagerMock = {
      currentBlockIndex: 1,
      blocks: [tableBlock, cellParagraphBlock],
      get currentBlock() {
        return cellParagraphBlock;
      },
      set currentBlock(block: Block | undefined) {
        mockSetCurrentBlock(block);
      },
    };

    const { toolbar } = createToolbar({
      BlockManager: blockManagerMock as unknown as BlokModules['BlockManager'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;
    const mockToolboxOpen = vi.fn();

    priv.toolboxInstance = { opened: false, close: vi.fn(), open: mockToolboxOpen };

    // Simulate state after hover-triggered moveAndOpen on TABLE block:
    priv.hoveredBlock = tableBlock;
    priv.hoveredBlockIsFromTableCell = false; // stale from hover resolution

    // Act: call toolbox.open() — this goes through the getter
    toolbar.toolbox.open();

    // Assert: currentBlock was NOT overridden with the table block
    expect(mockSetCurrentBlock).not.toHaveBeenCalled();

    // Assert: the actual toolbox open WAS still called
    expect(mockToolboxOpen).toHaveBeenCalledOnce();

    document.body.removeChild(tableHolder);
  });

  it('DOES override currentBlock when the current block is NOT inside a table cell', () => {
    /**
     * Normal scenario: caret is in a regular paragraph, toolbar hovers a different block.
     * The getter should override currentBlock with hoveredBlock to keep them in sync.
     */
    const regularHolder = document.createElement('div');

    document.body.appendChild(regularHolder);

    const regularBlock = {
      id: 'para-1',
      name: 'paragraph',
      holder: regularHolder,
    } as unknown as Block;

    const otherBlock = {
      id: 'para-2',
      name: 'paragraph',
      holder: document.createElement('div'),
    } as unknown as Block;

    let storedCurrentBlock: Block | undefined = regularBlock;
    const mockSetCurrentBlock = vi.fn((block: Block | undefined) => {
      storedCurrentBlock = block;
    });

    const { toolbar } = createToolbar({
      BlockManager: {
        get currentBlock() {
          return storedCurrentBlock;
        },
        set currentBlock(block: Block | undefined) {
          mockSetCurrentBlock(block);
        },
        currentBlockIndex: 0,
        blocks: [regularBlock, otherBlock],
      } as unknown as BlokModules['BlockManager'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;
    const mockToolboxOpen = vi.fn();

    priv.toolboxInstance = { opened: false, close: vi.fn(), open: mockToolboxOpen };
    priv.hoveredBlock = otherBlock;
    priv.hoveredBlockIsFromTableCell = false;

    toolbar.toolbox.open();

    // Assert: currentBlock WAS overridden to the hovered block
    expect(mockSetCurrentBlock).toHaveBeenCalledWith(otherBlock);
    expect(mockToolboxOpen).toHaveBeenCalledOnce();

    document.body.removeChild(regularHolder);
  });

  it('skips override when hoveredBlockIsFromTableCell is true', () => {
    /**
     * When moveAndOpen correctly detects a cell paragraph (e.g. when the toolbar
     * was NOT already opened), hoveredBlockIsFromTableCell is true and the
     * override is skipped via the existing guard.
     */
    const { tableHolder, cellParagraphHolder } = createTableCellDOM();

    const cellParagraphBlock = {
      id: 'para-1',
      name: 'paragraph',
      holder: cellParagraphHolder,
    } as unknown as Block;

    const tableBlock = {
      id: 'table-1',
      name: 'table',
      holder: tableHolder,
    } as unknown as Block;

    const mockSetCurrentBlock = vi.fn();

    const { toolbar } = createToolbar({
      BlockManager: {
        get currentBlock() {
          return cellParagraphBlock;
        },
        set currentBlock(block: Block | undefined) {
          mockSetCurrentBlock(block);
        },
        currentBlockIndex: 1,
        blocks: [tableBlock, cellParagraphBlock],
      } as unknown as BlokModules['BlockManager'],
    });

    const priv = toolbar as unknown as Record<string, unknown>;
    const mockToolboxOpen = vi.fn();

    priv.toolboxInstance = { opened: false, close: vi.fn(), open: mockToolboxOpen };
    priv.hoveredBlock = tableBlock;
    priv.hoveredBlockIsFromTableCell = true; // correctly set from moveAndOpen

    toolbar.toolbox.open();

    expect(mockSetCurrentBlock).not.toHaveBeenCalled();
    expect(mockToolboxOpen).toHaveBeenCalledOnce();

    document.body.removeChild(tableHolder);
  });
});

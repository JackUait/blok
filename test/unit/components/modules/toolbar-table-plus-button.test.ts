/**
 * Unit tests for Toolbar.moveAndOpen() — table block plus button visibility.
 *
 * Expected behaviour:
 * - Plus button HIDDEN when `target` is inside a [data-blok-table-cell-blocks]
 *   container (i.e. the pointer is on a cell's content area).
 * - Plus button VISIBLE when the target is NOT inside a cell (e.g. table border/padding).
 * - Plus button HIDDEN when `unresolvedBlock.holder` IS inside a cell
 *   (i.e. a cell-paragraph block is passed directly via activateToolbox / slash menu).
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
 * Create a minimal Toolbar instance pre-wired with everything moveAndOpen needs.
 * Returns the instance plus the plus-button DOM node so callers can assert on it.
 */
function createToolbar(blokOverrides: Partial<BlokModules> = {}): {
  toolbar: Toolbar;
  plusButton: HTMLButtonElement;
  settingsToggler: HTMLButtonElement;
  wrapper: HTMLDivElement;
} {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const toolbar = new Toolbar({ config: {} as BlokConfig, eventsDispatcher });

  // Build toolbar DOM nodes
  const wrapper = document.createElement('div');
  const plusButton = document.createElement('button');
  const settingsToggler = document.createElement('button');

  toolbar.nodes = { wrapper, plusButton, settingsToggler } as unknown as typeof toolbar.nodes;

  // Stub private helpers
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

  // Set module state
  const defaultBlok: Partial<BlokModules> = {
    BlockSettings: {
      opened: false,
      close: vi.fn(),
    } as unknown as BlokModules['BlockSettings'],
    BlockManager: {
      currentBlock: null,
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

  return { toolbar, plusButton, settingsToggler, wrapper };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('Toolbar — table block plus button visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides plus button when the focused element is inside a table cell', () => {
    /**
     * Scenario: The user clicks inside a table cell, causing document.activeElement
     * to be inside [data-blok-table-cell-blocks]. The plus button should be hidden.
     */
    const { toolbar, plusButton } = createToolbar();

    // DOM structure: top-level table holder → cell container → focusable element
    const tableHolder = document.createElement('div');
    const cellContainer = document.createElement('div');

    cellContainer.setAttribute('data-blok-table-cell-blocks', '');
    const cellEditable = document.createElement('div');

    cellEditable.setAttribute('contenteditable', 'true');
    cellEditable.tabIndex = 0;
    cellContainer.appendChild(cellEditable);
    tableHolder.appendChild(cellContainer);
    tableHolder.appendChild(toolbar.nodes.wrapper as HTMLElement);
    document.body.appendChild(tableHolder);

    const tableBlock = {
      id: 'table-1',
      name: 'table',
      holder: tableHolder,
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    // Focus inside the cell (simulates a click)
    cellEditable.focus();

    // Act — call moveAndOpen while cell has focus
    toolbar.moveAndOpen(tableBlock, cellEditable);

    // Plus button must be HIDDEN (focus is inside a cell)
    expect(plusButton.style.display).toBe('none');

    document.body.removeChild(tableHolder);
  });

  it('shows plus button for a table block when no cell has focus (hover only)', () => {
    /**
     * Scenario: The pointer hovers over the table block but no cell is focused.
     * The plus button should remain visible so the user can click it.
     */
    const { toolbar, plusButton } = createToolbar();

    const tableHolder = document.createElement('div');
    const cellContainer = document.createElement('div');

    cellContainer.setAttribute('data-blok-table-cell-blocks', '');
    const cellTarget = document.createElement('div');

    cellContainer.appendChild(cellTarget);
    tableHolder.appendChild(cellContainer);
    tableHolder.appendChild(toolbar.nodes.wrapper as HTMLElement);
    document.body.appendChild(tableHolder);

    const tableBlock = {
      id: 'table-1',
      name: 'table',
      holder: tableHolder,
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    // Ensure no cell has focus (blur everything)
    (document.activeElement as HTMLElement | null)?.blur?.();

    // Act — hover (target is inside a cell, but no focus)
    toolbar.moveAndOpen(tableBlock, cellTarget);

    // Plus button must be VISIBLE (no cell has focus)
    expect(plusButton.style.display).toBe('');

    document.body.removeChild(tableHolder);
  });

  it('hides plus button when a cell-paragraph block is passed directly and cell is focused', () => {
    /**
     * Scenario: A cell-paragraph block is passed directly to moveAndOpen
     * (e.g. via activateToolbox → slash press, not through the blockHover resolver).
     * The cell is focused (user typed "/" in it), so the plus button should be hidden.
     */
    // Bottom-up DOM: tableHolder > cellContainer > cellParagraphHolder
    const tableHolder = document.createElement('div');

    tableHolder.setAttribute('data-blok-testid', 'block-wrapper');
    const cellContainer = document.createElement('div');

    cellContainer.setAttribute('data-blok-table-cell-blocks', '');
    const cellParagraphHolder = document.createElement('div');

    cellParagraphHolder.setAttribute('contenteditable', 'true');
    cellParagraphHolder.tabIndex = 0;
    cellContainer.appendChild(cellParagraphHolder);
    tableHolder.appendChild(cellContainer);
    document.body.appendChild(tableHolder);

    const tableBlock = {
      id: 'table-1',
      name: 'table',
      holder: tableHolder,
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    const { toolbar, plusButton } = createToolbar({
      BlockManager: {
        currentBlock: null,
        blocks: [],
        getBlockByChildNode: vi.fn().mockReturnValue(tableBlock),
      } as unknown as BlokModules['BlockManager'],
    });

    tableHolder.appendChild(toolbar.nodes.wrapper as HTMLElement);

    const cellParagraphBlock = {
      id: 'para-1',
      name: 'paragraph',
      holder: cellParagraphHolder, // IS inside [data-blok-table-cell-blocks]
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    // Focus inside the cell (simulates typing "/" in a cell)
    cellParagraphHolder.focus();

    toolbar.moveAndOpen(cellParagraphBlock, cellParagraphHolder);

    expect(plusButton.style.display).toBe('none');

    document.body.removeChild(tableHolder);
  });
});

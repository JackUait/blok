/**
 * Unit tests for Toolbar.moveAndOpen() — table block plus button visibility.
 *
 * Regression test for: plus button hidden when hovering a table block because
 * the raw pointer target is inside [data-blok-table-cell-blocks].
 *
 * Expected behaviour:
 * - Plus button VISIBLE when `unresolvedBlock.holder` is NOT inside a cell
 *   (i.e. the block IS the table block itself), even if `target` is a cell element.
 * - Plus button HIDDEN when `unresolvedBlock.holder` IS inside a cell
 *   (i.e. a cell-paragraph block is passed directly).
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

  it('shows plus button for a table block even when the mouse target is inside a cell', () => {
    /**
     * Scenario: Playwright's `tableBlock.hover()` places the pointer at the
     * centre of the table, landing on a cell element. The raw `target` that
     * reaches moveAndOpen is therefore inside [data-blok-table-cell-blocks].
     * However the BLOCK being hovered is the TABLE itself (blockHover.ts
     * resolves cell paragraphs to the parent table before emitting BlockHovered).
     * The plus button must remain visible.
     */
    const { toolbar, plusButton } = createToolbar();

    // DOM structure: top-level table holder → cell container → target element
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
      holder: tableHolder, // NOT inside [data-blok-table-cell-blocks]
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn().mockReturnValue({ toolTunes: [], commonTunes: [] }),
    } as unknown as Block;

    // Act — call with table block but with a target that is inside a cell
    toolbar.moveAndOpen(tableBlock, cellTarget);

    // Plus button must be visible
    expect(plusButton.style.display).not.toBe('none');
    expect(plusButton.style.display).toBe('');

    document.body.removeChild(tableHolder);
  });

  it('hides plus button when the block holder itself is nested inside a table cell', () => {
    /**
     * Scenario: A cell-paragraph block is passed directly to moveAndOpen
     * (e.g. via a direct call, not through the blockHover resolver).
     * Its holder is inside [data-blok-table-cell-blocks], so the plus button
     * should be suppressed.
     */
    // Bottom-up DOM: tableHolder > cellContainer > cellParagraphHolder
    const tableHolder = document.createElement('div');

    tableHolder.setAttribute('data-blok-testid', 'block-wrapper');
    const cellContainer = document.createElement('div');

    cellContainer.setAttribute('data-blok-table-cell-blocks', '');
    const cellParagraphHolder = document.createElement('div');

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

    toolbar.moveAndOpen(cellParagraphBlock, cellParagraphHolder);

    expect(plusButton.style.display).toBe('none');

    document.body.removeChild(tableHolder);
  });
});

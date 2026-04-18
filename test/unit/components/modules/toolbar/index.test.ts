import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Toolbar } from '../../../../../src/components/modules/toolbar/index';
import type * as UtilsModule from '../../../../../src/components/utils';
import { BlockHovered } from '../../../../../src/components/events/BlockHovered';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Lightweight stub class that satisfies `instanceof Block` in the hover handler.
 * Defined via vi.hoisted so it's available when vi.mock runs (hoisted to file top).
 */
const BlockStub = vi.hoisted(() => {
  return class BlockStub {
    public id: string;
    public name = 'paragraph';
    public holder: HTMLDivElement;

    constructor(id: string) {
      this.id = id;
      this.holder = document.createElement('div');
      this.holder.setAttribute('data-blok-testid', 'block-wrapper');
    }
  };
});

vi.mock('../../../../../src/components/icons', () => ({
  IconMenu: '<svg></svg>',
  IconPlus: '<svg></svg>',
}));

vi.mock('../../../../../src/components/block', () => ({
  Block: BlockStub,
}));

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  hide: vi.fn(),
  onHover: vi.fn(),
}));

vi.mock('../../../../../src/components/dom', () => ({
  Dom: {
    make: vi.fn((tag: string) => document.createElement(tag)),
    append: vi.fn((parent: HTMLElement, child: HTMLElement) => {
      parent.appendChild(child);
    }),
  },
  calculateBaseline: vi.fn(() => 0),
}));

vi.mock('../../../../../src/components/utils', async () => {
  const actual = await vi.importActual<typeof UtilsModule>(
    '../../../../../src/components/utils'
  );

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
    log: vi.fn(),
  };
});

vi.mock('../../../../../src/components/i18n', () => ({
  I18n: {
    ui: vi.fn(() => ''),
    t: vi.fn(() => ''),
    tToolName: vi.fn((title: string) => title),
  },
}));

describe('Toolbar module interactions', () => {
  let toolbar: Toolbar;
  let blockHoveredHandler: ((data: { block: unknown }) => void) | undefined;

  type MutableListeners = {
    on: (
      element: EventTarget,
      eventType: string,
      handler: (event: Event) => void,
      options?: boolean | AddEventListenerOptions
    ) => void;
    clearAll: () => void;
  };
  const getBlok = (): BlokModules =>
    (toolbar as unknown as { Blok: BlokModules }).Blok;

  beforeEach(() => {
    const eventsDispatcher = {
      on: vi.fn((event, callback) => {
        if (event === BlockHovered) {
          blockHoveredHandler = callback as (data: { block: unknown }) => void;
        }
      }),
      off: vi.fn(),
    };

    toolbar = new Toolbar({
      config: {},
      eventsDispatcher: eventsDispatcher as unknown as typeof toolbar['eventsDispatcher'],
    });

    toolbar.state = {
      BlockSettings: {
        opened: false,
        isOpening: false,
        close: vi.fn(),
        getElement: vi.fn(() => document.createElement('div')),
      },
      UI: {
        nodes: {
          wrapper: document.createElement('div'),
        },
      },
      BlockManager: {
        currentBlock: null,
        blocks: [],
        length: 0,
      },
      BlockSelection: {
        clearSelection: vi.fn(),
        selectedBlocks: [],
      },
      InlineToolbar: {
        opened: false,
      },
      ReadOnly: {
        isEnabled: false,
      },
      DragManager: {
        isDragging: false,
      },
      RectangleSelection: {
        isRectActivated: vi.fn(() => false),
      },
    } as unknown as Toolbar['Blok'];

    (toolbar as unknown as { nodes: typeof toolbar['nodes'] }).nodes = {
      wrapper: document.createElement('div'),
      content: document.createElement('div'),
      actions: document.createElement('div'),
      plusButton: document.createElement('button'),
      settingsToggler: document.createElement('button'),
    };

    const readOnlyMutableListeners: MutableListeners = {
      on: vi.fn(),
      clearAll: vi.fn(),
    };

    (toolbar as unknown as { readOnlyMutableListeners: MutableListeners }).readOnlyMutableListeners =
      readOnlyMutableListeners;
  });

  afterEach(() => {
    blockHoveredHandler = undefined;
    vi.clearAllMocks();
  });

  const enableBindings = (): void => {
    (toolbar as unknown as { enableModuleBindings: () => void }).enableModuleBindings();

    if (!blockHoveredHandler) {
      throw new Error('BlockHovered handler was not registered');
    }
  };

  it('does not move when Block Settings are opened during block hover', () => {
    enableBindings();

    getBlok().BlockSettings.opened = true;
    const moveSpy = vi.spyOn(toolbar as unknown as { moveAndOpen: (block: unknown) => void }, 'moveAndOpen');

    blockHoveredHandler?.({ block: {} });

    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('does not move when Toolbox is opened during block hover', () => {
    enableBindings();

    getBlok().BlockSettings.opened = false;
    (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void; open: () => void; toggle: () => void; hasFocus: () => boolean } }).toolboxInstance = {
      opened: true,
      close: vi.fn(),
      open: vi.fn(),
      toggle: vi.fn(),
      hasFocus: vi.fn(),
    };

    const moveSpy = vi.spyOn(toolbar as unknown as { moveAndOpen: (block: unknown) => void }, 'moveAndOpen');

    blockHoveredHandler?.({ block: {} });

    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('does not move when BlockSettings is opened and moveAndOpenForMultipleBlocks is called', () => {
    // Setup mock blocks for multi-block selection
    const block1 = { name: 'block1', holder: document.createElement('div') };
    const block2 = { name: 'block2', holder: document.createElement('div') };

    const blok = getBlok();
    blok.BlockSettings.opened = true;
    blok.BlockSettings.isOpening = false;

    // Replace the BlockSelection mock with selected blocks by reassigning the whole object
    const originalBlockSelection = blok.BlockSelection;
    (toolbar as unknown as { Blok: { BlockSelection: typeof originalBlockSelection } }).Blok.BlockSelection = {
      ...originalBlockSelection,
      get selectedBlocks() {
        return [block1, block2];
      },
    } as typeof blok.BlockSelection;

    // Setup toolbox instance to prevent early return
    (toolbar as unknown as { toolboxInstance: { opened: boolean } }).toolboxInstance = {
      opened: false,
    };

    // Spy on moveAndOpen to verify it's not called
    const moveAndOpenSpy = vi.spyOn(toolbar as unknown as { moveAndOpen: () => void }, 'moveAndOpen');

    // Call moveAndOpenForMultipleBlocks - it should return early without moving
    (toolbar as unknown as { moveAndOpenForMultipleBlocks: () => void }).moveAndOpenForMultipleBlocks();

    // Verify that moveAndOpen was not called (meaning toolbar didn't move)
    expect(moveAndOpenSpy).not.toHaveBeenCalled();

    // Restore original BlockSelection
    (toolbar as unknown as { Blok: { BlockSelection: typeof originalBlockSelection } }).Blok.BlockSelection = originalBlockSelection;
  });

  it('does not move when BlockSettings is opening and moveAndOpenForMultipleBlocks is called', () => {
    // Setup mock blocks for multi-block selection
    const block1 = { name: 'block1', holder: document.createElement('div') };
    const block2 = { name: 'block2', holder: document.createElement('div') };

    const blok = getBlok();
    blok.BlockSettings.opened = false;
    blok.BlockSettings.isOpening = true; // Opening flag is set

    // Replace the BlockSelection mock with selected blocks by reassigning the whole object
    const originalBlockSelection = blok.BlockSelection;
    (toolbar as unknown as { Blok: { BlockSelection: typeof originalBlockSelection } }).Blok.BlockSelection = {
      ...originalBlockSelection,
      get selectedBlocks() {
        return [block1, block2];
      },
    } as typeof blok.BlockSelection;

    // Setup toolbox instance to prevent early return
    (toolbar as unknown as { toolboxInstance: { opened: boolean } }).toolboxInstance = {
      opened: false,
    };

    // Spy on moveAndOpen to verify it's not called
    const moveAndOpenSpy = vi.spyOn(toolbar as unknown as { moveAndOpen: () => void }, 'moveAndOpen');

    // Call moveAndOpenForMultipleBlocks - it should return early without moving
    (toolbar as unknown as { moveAndOpenForMultipleBlocks: () => void }).moveAndOpenForMultipleBlocks();

    // Verify that moveAndOpen was not called (meaning toolbar didn't move)
    expect(moveAndOpenSpy).not.toHaveBeenCalled();

    // Restore original BlockSelection
    (toolbar as unknown as { Blok: { BlockSelection: typeof originalBlockSelection } }).Blok.BlockSelection = originalBlockSelection;
  });

  it('resolves a cell block to its parent table block in moveAndOpen', () => {
    // Create a DOM structure simulating a table with a cell block inside
    const tableBlockHolder = document.createElement('div');
    tableBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');

    const cellBlocksContainer = document.createElement('div');
    cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
    tableBlockHolder.appendChild(cellBlocksContainer);

    const cellBlockHolder = document.createElement('div');
    cellBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');
    cellBlocksContainer.appendChild(cellBlockHolder);

    // Create mock blocks
    const pluginsContent = document.createElement('div');
    tableBlockHolder.appendChild(pluginsContent);
    const tableBlock = {
      id: 'table-block-1',
      name: 'table',
      holder: tableBlockHolder,
      pluginsContent,
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
      getToolbarAnchorElement: vi.fn(() => undefined),
    };
    const cellBlock = {
      id: 'cell-block-1',
      name: 'paragraph',
      holder: cellBlockHolder,
      isEmpty: false,
    };

    // Set up BlockManager to return tableBlock when asked for block by child node
    const blok = getBlok();
    blok.BlockManager.currentBlock = cellBlock as unknown as typeof blok.BlockManager.currentBlock;
    (blok.BlockManager as unknown as { getBlockByChildNode: (node: Node) => unknown }).getBlockByChildNode = vi.fn(() => tableBlock);

    // Set up toolbox instance
    (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void } }).toolboxInstance = {
      opened: false,
      close: vi.fn(),
    };

    // Call moveAndOpen (with no block arg, so it uses currentBlock = cellBlock)
    toolbar.moveAndOpen();

    // The toolbar should have opened for the table block, not closed
    const hoveredBlock = (toolbar as unknown as { hoveredBlock: unknown }).hoveredBlock;
    expect(hoveredBlock).toBe(tableBlock);
  });

  it('falls back to original block when table cell resolution fails in moveAndOpen', () => {
    // Create a DOM structure simulating a table cell where parent block can't be found
    const tableBlockHolder = document.createElement('div');
    tableBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');

    const cellBlocksContainer = document.createElement('div');
    cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
    tableBlockHolder.appendChild(cellBlocksContainer);

    const cellBlockHolder = document.createElement('div');
    cellBlocksContainer.appendChild(cellBlockHolder);

    // Create mock cell block inside the table cell container
    const pluginsContent = document.createElement('div');
    cellBlockHolder.appendChild(pluginsContent);
    const cellBlock = {
      id: 'cell-block-1',
      name: 'paragraph',
      holder: cellBlockHolder,
      pluginsContent,
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
      getToolbarAnchorElement: vi.fn(() => undefined),
    };

    // Set up BlockManager to return null when asked for block by child node (resolution fails)
    const blok = getBlok();
    blok.BlockManager.currentBlock = cellBlock as unknown as typeof blok.BlockManager.currentBlock;
    (blok.BlockManager as unknown as { getBlockByChildNode: (node: Node) => unknown }).getBlockByChildNode = vi.fn(() => null);

    // Set up toolbox instance
    (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void } }).toolboxInstance = {
      opened: false,
      close: vi.fn(),
    };

    // Spy on close to verify it's NOT called
    const closeSpy = vi.spyOn(toolbar, 'close');

    // Call moveAndOpen
    toolbar.moveAndOpen();

    // The toolbar should fall back to the cellBlock, not close
    expect(closeSpy).not.toHaveBeenCalled();
    const hoveredBlock = (toolbar as unknown as { hoveredBlock: unknown }).hoveredBlock;
    expect(hoveredBlock).toBe(cellBlock);
  });

  it('keeps plus button visible when moveAndOpen is called with a cell block but no target (keyboard/slash path)', () => {
    // Create DOM structure: table block containing a cell container with a cell block
    const tableBlockHolder = document.createElement('div');

    tableBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');

    const cellBlocksContainer = document.createElement('div');

    cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
    tableBlockHolder.appendChild(cellBlocksContainer);

    const cellBlockHolder = document.createElement('div');

    cellBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');
    cellBlocksContainer.appendChild(cellBlockHolder);

    const pluginsContent = document.createElement('div');

    tableBlockHolder.appendChild(pluginsContent);

    const tableBlock = {
      id: 'table-block',
      name: 'table',
      holder: tableBlockHolder,
      pluginsContent,
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
      getToolbarAnchorElement: vi.fn(() => undefined),
    };

    const cellBlock = {
      id: 'cell-paragraph',
      name: 'paragraph',
      holder: cellBlockHolder,
      pluginsContent: document.createElement('div'),
      isEmpty: true,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
      getToolbarAnchorElement: vi.fn(() => undefined),
    };

    // Focus an element inside the cell so isFocusInsideTableCell() returns true
    const focusable = document.createElement('div');

    focusable.setAttribute('contenteditable', 'true');
    cellBlocksContainer.appendChild(focusable);
    document.body.appendChild(tableBlockHolder);
    focusable.focus();

    const blok = getBlok();

    blok.BlockManager.currentBlock = cellBlock as unknown as typeof blok.BlockManager.currentBlock;
    (blok.BlockManager as unknown as { getBlockByChildNode: (node: Node) => unknown }).getBlockByChildNode = vi.fn(() => tableBlock);

    (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void } }).toolboxInstance = {
      opened: false,
      close: vi.fn(),
    };

    // Call moveAndOpen with the cell block but NO target argument (simulates keyboard/slash path)
    (toolbar as unknown as { moveAndOpen: (block: unknown, target?: unknown) => void }).moveAndOpen(cellBlock);

    const nodes = (toolbar as unknown as { nodes: typeof toolbar['nodes'] }).nodes;

    // Plus button should remain visible so users can add blocks below the table
    expect(nodes.plusButton?.style.display).toBe('');

    // Clean up
    document.body.removeChild(tableBlockHolder);
  });

  it('keeps drag handle (settings toggler) visible and wired to the parent table block when focus is inside a cell', () => {
    /**
     * Regression for: clicking inside a table/database cell hid the drag handle
     * on the parent table's toolbar, making the whole table undraggable while
     * editing cell text. The toolbar resolves to the parent table block via
     * resolveTableCellBlock(), so the settings toggler drags the TABLE — it
     * must stay visible and wired to that parent block even while focus is
     * inside a cell.
     */
    const tableBlockHolder = document.createElement('div');

    tableBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');

    const cellBlocksContainer = document.createElement('div');

    cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
    tableBlockHolder.appendChild(cellBlocksContainer);

    const cellBlockHolder = document.createElement('div');

    cellBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');
    cellBlocksContainer.appendChild(cellBlockHolder);

    const pluginsContent = document.createElement('div');

    tableBlockHolder.appendChild(pluginsContent);

    const tableBlock = {
      id: 'table-block',
      name: 'table',
      holder: tableBlockHolder,
      pluginsContent,
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
      getToolbarAnchorElement: vi.fn(() => undefined),
    };

    const cellBlock = {
      id: 'cell-paragraph',
      name: 'paragraph',
      holder: cellBlockHolder,
      pluginsContent: document.createElement('div'),
      isEmpty: true,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
      getToolbarAnchorElement: vi.fn(() => undefined),
    };

    // Focus a contenteditable inside the cell to simulate the user clicking a cell
    const focusable = document.createElement('div');

    focusable.setAttribute('contenteditable', 'true');
    cellBlocksContainer.appendChild(focusable);
    document.body.appendChild(tableBlockHolder);
    focusable.focus();

    const blok = getBlok();

    blok.BlockManager.currentBlock = cellBlock as unknown as typeof blok.BlockManager.currentBlock;
    (blok.BlockManager as unknown as { getBlockByChildNode: (node: Node) => unknown }).getBlockByChildNode = vi.fn(() => tableBlock);

    (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void } }).toolboxInstance = {
      opened: false,
      close: vi.fn(),
    };

    (toolbar as unknown as { moveAndOpen: (block: unknown, target?: unknown) => void }).moveAndOpen(cellBlock);

    const nodes = (toolbar as unknown as { nodes: typeof toolbar['nodes'] }).nodes;

    // Drag handle MUST stay visible — it drags the parent table, not the cell
    expect(nodes.settingsToggler?.style.display).toBe('');

    // And MUST be wired to the parent table block so dragging it moves the table
    expect(tableBlock.setupDraggable).toHaveBeenCalledWith(nodes.settingsToggler, expect.anything());

    // Also verify the focusin-triggered update path does not re-hide it
    (toolbar as unknown as { updateToolbarButtonsForCalloutFirstChild: () => void }).updateToolbarButtonsForCalloutFirstChild();
    expect(nodes.settingsToggler?.style.display).toBe('');

    document.body.removeChild(tableBlockHolder);
  });

  it('keeps plus button visible when moveAndOpen is called with no arguments but currentBlock is inside a table cell', () => {
    // Create DOM: cell block inside table cell container
    const cellBlocksContainer = document.createElement('div');

    cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');

    const cellBlockHolder = document.createElement('div');

    cellBlocksContainer.appendChild(cellBlockHolder);

    const tableBlockHolder = document.createElement('div');

    tableBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');
    tableBlockHolder.appendChild(cellBlocksContainer);

    const tableBlock = {
      id: 'table-block',
      name: 'table',
      holder: tableBlockHolder,
      pluginsContent: document.createElement('div'),
      isEmpty: false,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
      getToolbarAnchorElement: vi.fn(() => undefined),
    };

    const cellBlock = {
      id: 'cell-paragraph',
      name: 'paragraph',
      holder: cellBlockHolder,
      pluginsContent: document.createElement('div'),
      isEmpty: true,
      cleanupDraggable: vi.fn(),
      setupDraggable: vi.fn(),
      getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
      getToolbarAnchorElement: vi.fn(() => undefined),
    };

    // Focus an element inside the cell so isFocusInsideTableCell() returns true
    const focusable = document.createElement('div');

    focusable.setAttribute('contenteditable', 'true');
    cellBlocksContainer.appendChild(focusable);
    document.body.appendChild(tableBlockHolder);
    focusable.focus();

    const blok = getBlok();

    // No block passed to moveAndOpen → it uses BlockManager.currentBlock
    blok.BlockManager.currentBlock = cellBlock as unknown as typeof blok.BlockManager.currentBlock;
    (blok.BlockManager as unknown as { getBlockByChildNode: (node: Node) => unknown }).getBlockByChildNode = vi.fn(() => tableBlock);

    (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void } }).toolboxInstance = {
      opened: false,
      close: vi.fn(),
    };

    // Call moveAndOpen with NO arguments (simulates activateToolbox() from blockEvents)
    toolbar.moveAndOpen();

    const nodes = (toolbar as unknown as { nodes: typeof toolbar['nodes'] }).nodes;

    // Plus button should remain visible so users can add blocks below the table
    expect(nodes.plusButton?.style.display).toBe('');

    // Clean up
    document.body.removeChild(tableBlockHolder);
  });

  /**
   * Creates a minimal stub that passes `instanceof Block` and has the
   * properties the BlockHovered handler and moveAndOpen need.
   */
  const createBlockStub = (id: string): InstanceType<typeof BlockStub> => {
    return new BlockStub(id);
  };

  describe('explicitlyClosed flag recovery on hover', () => {
    it('resets explicitlyClosed and opens toolbar when hovering a DIFFERENT block after close', () => {
      enableBindings();

      const blockB = createBlockStub('block-b');

      const blok = getBlok();

      blok.BlockSettings.opened = false;
      blok.BlockSettings.isOpening = false;

      (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void } }).toolboxInstance = {
        opened: false,
        close: vi.fn(),
      };

      /**
       * Simulate: user typed in a block which called Toolbar.close(),
       * setting explicitlyClosed = true and hoveredBlock = null.
       */
      (toolbar as unknown as { explicitlyClosed: boolean }).explicitlyClosed = true;
      (toolbar as unknown as { hoveredBlock: unknown }).hoveredBlock = null;

      const moveSpy = vi.spyOn(
        toolbar as unknown as { moveAndOpen: (block: unknown, target?: Element) => void },
        'moveAndOpen'
      ).mockImplementation(() => {});

      /** Hover over blockB — should reset the flag and call moveAndOpen */
      blockHoveredHandler?.({ block: blockB });

      expect(moveSpy).toHaveBeenCalledWith(blockB, undefined);
      expect((toolbar as unknown as { explicitlyClosed: boolean }).explicitlyClosed).toBe(false);
    });

    it('does NOT reopen toolbar when hovering the SAME block that was explicitly closed', () => {
      enableBindings();

      const blockA = createBlockStub('block-a');

      const blok = getBlok();

      blok.BlockSettings.opened = false;
      blok.BlockSettings.isOpening = false;

      (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void } }).toolboxInstance = {
        opened: false,
        close: vi.fn(),
      };

      /**
       * Simulate: user typed in blockA which called Toolbar.close(),
       * setting explicitlyClosed = true. We also track which block was
       * last hovered so the handler can know the user is still on the same block.
       */
      (toolbar as unknown as { explicitlyClosed: boolean }).explicitlyClosed = true;
      (toolbar as unknown as { hoveredBlock: unknown }).hoveredBlock = blockA;

      const moveSpy = vi.spyOn(
        toolbar as unknown as { moveAndOpen: (block: unknown, target?: Element) => void },
        'moveAndOpen'
      ).mockImplementation(() => {});

      /** Hover same block — should NOT reopen */
      blockHoveredHandler?.({ block: blockA });

      expect(moveSpy).not.toHaveBeenCalled();
    });

    it('resets explicitlyClosed when hovering any block after Toolbar.close() with no prior hover', () => {
      enableBindings();

      const blockA = createBlockStub('block-a');

      const blok = getBlok();

      blok.BlockSettings.opened = false;
      blok.BlockSettings.isOpening = false;

      (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void } }).toolboxInstance = {
        opened: false,
        close: vi.fn(),
      };

      /**
       * Simulate: Toolbar.close() was called (e.g. from paste or navigation)
       * when hoveredBlock was already null (toolbar was not attached to any block).
       * hoveredBlock == null means ANY incoming hover should be treated as "different".
       */
      (toolbar as unknown as { explicitlyClosed: boolean }).explicitlyClosed = true;
      (toolbar as unknown as { hoveredBlock: unknown }).hoveredBlock = null;

      const moveSpy = vi.spyOn(
        toolbar as unknown as { moveAndOpen: (block: unknown, target?: Element) => void },
        'moveAndOpen'
      ).mockImplementation(() => {});

      blockHoveredHandler?.({ block: blockA });

      expect(moveSpy).toHaveBeenCalledWith(blockA, undefined);
    });
  });
});



describe('Plus button interactions', () => {
  let toolbar: Toolbar;

  type MutableListeners = {
    on: (
      element: EventTarget,
      eventType: string,
      handler: (event: Event) => void,
      options?: boolean | AddEventListenerOptions
    ) => void;
    clearAll: () => void;
  };

  const getBlok = (): BlokModules =>
    (toolbar as unknown as { Blok: BlokModules }).Blok;

  beforeEach(() => {
    const eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
    };

    toolbar = new Toolbar({
      config: {},
      eventsDispatcher: eventsDispatcher as unknown as typeof toolbar['eventsDispatcher'],
    });

    toolbar.state = {
      BlockSettings: {
        opened: false,
        close: vi.fn(),
        getElement: vi.fn(() => document.createElement('div')),
      },
      UI: {
        nodes: {
          wrapper: document.createElement('div'),
        },
      },
      BlockManager: {
        currentBlock: null,
        currentBlockIndex: 0,
        blocks: [],
        length: 0,
        getBlockIndex: vi.fn(() => 0),
        insertDefaultBlockAtIndex: vi.fn(() => ({
          name: 'paragraph',
          isEmpty: true,
          pluginsContent: { textContent: '' },
          holder: document.createElement('div'),
        })),
      },
      BlockSelection: {
        anyBlockSelected: true,
        clearSelection: vi.fn(function(this: { anyBlockSelected: boolean }) {
          this.anyBlockSelected = false;
        }),
      },
      InlineToolbar: {
        opened: false,
      },
      ReadOnly: {
        isEnabled: false,
      },
      Caret: {
        setToBlock: vi.fn(),
        insertContentAtCaretPosition: vi.fn(),
        positions: { START: 'start', DEFAULT: 'default' },
      },
      I18n: {
        t: vi.fn((key: string) => key),
      },
      Toolbar: {
        CSS: {
          plusButton: '',
        },
      },
    } as unknown as Toolbar['Blok'];

    (toolbar as unknown as { nodes: typeof toolbar['nodes'] }).nodes = {
      wrapper: document.createElement('div'),
      content: document.createElement('div'),
      actions: document.createElement('div'),
      plusButton: document.createElement('button'),
      settingsToggler: document.createElement('button'),
    };

    const readOnlyMutableListeners: MutableListeners = {
      on: vi.fn(),
      clearAll: vi.fn(),
    };

    (toolbar as unknown as { readOnlyMutableListeners: MutableListeners }).readOnlyMutableListeners =
      readOnlyMutableListeners;

    (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void; open: () => void; toggle: () => void; hasFocus: () => boolean } }).toolboxInstance = {
      opened: false,
      close: vi.fn(function(this: { opened: boolean }) {
        this.opened = false;
      }),
      open: vi.fn(function(this: { opened: boolean }) {
        this.opened = true;
      }),
      toggle: vi.fn(),
      hasFocus: vi.fn(),
    };

    // Mock hoveredBlock to null so test flow uses BlockManager.insertDefaultBlockAtIndex
    (toolbar as unknown as { hoveredBlock: null }).hoveredBlock = null;

    // Mock moveAndOpen since it's called in the new implementation
    (toolbar as unknown as { moveAndOpen: () => void }).moveAndOpen = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clears block selection when plus button is clicked with blocks selected', () => {
    // In the refactored code, plusButtonHandler.handleClick is now the method to test
    const plusButtonHandler = (toolbar as unknown as { plusButtonHandler: { handleClick: () => void } }).plusButtonHandler;
    const blockSelection = getBlok().BlockSelection as { anyBlockSelected: boolean };
    const toolboxInstance = (toolbar as unknown as { toolboxInstance: { opened: boolean } }).toolboxInstance;

    expect(blockSelection.anyBlockSelected).toBe(true);

    plusButtonHandler.handleClick();

    expect(blockSelection.anyBlockSelected).toBe(false);
    expect(toolboxInstance.opened).toBe(true);
  });

  it('does not clear selection when no blocks are selected', () => {
    const blockSelection = getBlok().BlockSelection as { anyBlockSelected: boolean };
    blockSelection.anyBlockSelected = false;

    const plusButtonHandler = (toolbar as unknown as { plusButtonHandler: { handleClick: () => void } }).plusButtonHandler;
    const toolboxInstance = (toolbar as unknown as { toolboxInstance: { opened: boolean } }).toolboxInstance;

    plusButtonHandler.handleClick();

    // Since no blocks were selected, clearSelection should not have been called
    // and anyBlockSelected should still be false
    expect(blockSelection.anyBlockSelected).toBe(false);
    // Toolbox should still be opened
    expect(toolboxInstance.opened).toBe(true);
  });

  describe('marginLeft sync in moveAndOpen', () => {
    /**
     * Helper: build a minimal block mock whose holder contains a
     * [data-blok-element-content] child with the given inline marginLeft.
     */
    const buildBlockWithContentMargin = (
      marginLeft: string,
      stretched = false
    ) => {
      const holder = document.createElement('div');
      holder.setAttribute('data-blok-testid', 'block-wrapper');

      const contentEl = document.createElement('div');
      contentEl.setAttribute('data-blok-element-content', '');
      contentEl.style.marginLeft = marginLeft;
      holder.appendChild(contentEl);

      const pluginsContent = document.createElement('div');
      holder.appendChild(pluginsContent);

      return {
        id: 'test-block',
        name: 'paragraph',
        holder,
        pluginsContent,
        isEmpty: false,
        stretched,
        cleanupDraggable: vi.fn(),
        setupDraggable: vi.fn(),
        getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
        getToolbarAnchorElement: vi.fn(() => undefined),
      };
    };

    beforeEach(() => {
      (toolbar as unknown as {
        toolboxInstance: {
          opened: boolean;
          close: () => void;
          updateLeftAlignElement: () => void;
        };
      }).toolboxInstance = {
        opened: false,
        close: vi.fn(),
        updateLeftAlignElement: vi.fn(),
      };

      (getBlok().BlockManager as unknown as { blocks: unknown[] }).blocks = [{}];

      // Restore the real moveAndOpen — the outer beforeEach replaces it with vi.fn()
      // so that other plus-button tests can spy on it. We need the real implementation here.
      (toolbar as unknown as { moveAndOpen: typeof toolbar['moveAndOpen'] }).moveAndOpen =
        toolbar.constructor.prototype.moveAndOpen.bind(toolbar);

      // Mock positioner so calculateToolbarY returns 0 instead of null,
      // allowing moveAndOpen to reach the marginLeft sync code.
      const positioner = (toolbar as unknown as { positioner: {
        setHoveredTarget: (t: unknown) => void;
        resetCachedPosition: () => void;
        calculateToolbarY: () => number | null;
        moveToY: () => void;
        applyContentOffset: () => void;
      } }).positioner;

      vi.spyOn(positioner, 'calculateToolbarY').mockReturnValue(0);
      vi.spyOn(positioner, 'moveToY').mockImplementation(() => {});
      vi.spyOn(positioner, 'applyContentOffset').mockImplementation(() => {});
      vi.spyOn(positioner, 'setHoveredTarget').mockImplementation(() => {});
      vi.spyOn(positioner, 'resetCachedPosition').mockImplementation(() => {});
    });

    it('sets toolbar content marginLeft using getBoundingClientRect offset for non-stretched blocks', () => {
      const block = buildBlockWithContentMargin('40px', false);
      const blok = getBlok();
      blok.BlockManager.currentBlock = block as never;

      document.body.appendChild(block.holder);

      // jsdom does not perform CSS layout. Stub getBoundingClientRect on the
      // content element to simulate 40px left offset relative to the wrapper (left = 0).
      const contentEl = block.holder.querySelector('[data-blok-element-content]') as HTMLElement;

      vi.spyOn(contentEl, 'getBoundingClientRect').mockReturnValue({
        left: 40, top: 0, right: 240, bottom: 24, width: 200, height: 24,
      } as DOMRect);

      // wrapper.getBoundingClientRect() returns left=0 (jsdom default) → visualOffset = 40 - 0 = 40
      // actionsWidth=0 (jsdom), holderLeft=0, minMarginLeft=0 → marginLeft = max(40, 0) = 40px

      let moveAndOpenError: unknown = null;
      try {
        toolbar.moveAndOpen(block as never);
      } catch (e) {
        moveAndOpenError = e;
      }

      const nodesAfter = (toolbar as unknown as { nodes: typeof toolbar['nodes'] }).nodes;

      document.body.removeChild(block.holder);

      expect(moveAndOpenError).toBeNull();
      expect(nodesAfter.content!.style.marginLeft).toBe('40px');
    });

    it('sets toolbar content marginLeft to 0px when content has no visual offset (getBoundingClientRect returns zeros in jsdom)', () => {
      const block = buildBlockWithContentMargin('0px', true);
      const blok = getBlok();
      blok.BlockManager.currentBlock = block as never;

      toolbar.moveAndOpen(block as never);

      const contentNode = (toolbar as unknown as { nodes: typeof toolbar['nodes'] }).nodes.content!;

      // In jsdom getBoundingClientRect returns all zeros, so visualOffset = 0, minMarginLeft = 0
      // → marginLeft is set to '0px' (master uses getBoundingClientRect for precise layout)
      expect(contentNode.style.marginLeft).toBe('0px');
    });
  });

  /**
   * Arch guardrail: protect the "drag handle always visible" invariant.
   *
   * Background: a prior bug hid the toolbar's settings toggler (drag handle)
   * whenever `document.activeElement` was inside `[data-blok-table-cell-blocks]`.
   * Because the toolbar is anchored on the parent table block and the drag
   * handle is wired via `setupDraggable()` to drag that parent, hiding the
   * handle left the whole table undraggable while editing cell text.
   *
   * The fix removed all focus-based hide paths. The settings toggler is now
   * hidden ONLY when the target block is the first child of a callout
   * (structural, not focus-based) — a deliberate design choice so the drag
   * handle does not overlap the callout emoji.
   *
   * These tests ensure the bug class stays dead: no future edit may reintroduce
   * a hide branch keyed off focus, activeElement, or a container DOM attribute.
   */
  describe('drag-handle-always-visible invariant (arch guardrail)', () => {
    const toolbarSource = readFileSync(
      resolve(__dirname, '../../../../../src/components/modules/toolbar/index.ts'),
      'utf8'
    );

    beforeEach(() => {
      /**
       * Parent `Plus button interactions` beforeEach stubs `moveAndOpen` with a
       * noop so other tests can spy on it. Restore the real implementation and
       * mock positioner methods (jsdom doesn't layout) so moveAndOpen can reach
       * setupDraggable.
       */
      (toolbar as unknown as { moveAndOpen: typeof toolbar['moveAndOpen'] }).moveAndOpen =
        toolbar.constructor.prototype.moveAndOpen.bind(toolbar);

      const positioner = (toolbar as unknown as { positioner: {
        setHoveredTarget: (t: unknown) => void;
        resetCachedPosition: () => void;
        calculateToolbarY: () => number | null;
        moveToY: () => void;
        applyContentOffset: () => void;
      } }).positioner;

      vi.spyOn(positioner, 'calculateToolbarY').mockReturnValue(0);
      vi.spyOn(positioner, 'moveToY').mockImplementation(() => {});
      vi.spyOn(positioner, 'applyContentOffset').mockImplementation(() => {});
      vi.spyOn(positioner, 'setHoveredTarget').mockImplementation(() => {});
      vi.spyOn(positioner, 'resetCachedPosition').mockImplementation(() => {});

      (toolbar as unknown as { toolboxInstance: { opened: boolean; close: () => void; updateLeftAlignElement: () => void } }).toolboxInstance = {
        opened: false,
        close: vi.fn(),
        updateLeftAlignElement: vi.fn(),
      };

      (getBlok().BlockManager as unknown as { blocks: unknown[] }).blocks = [{}];
    });

    it('never writes a literal "none" to settingsToggler.style.display in toolbar source', () => {
      /**
       * Any literal `settingsToggler.style.display = 'none'` assignment would
       * be an unconditional hide and would re-introduce the bug. The only
       * allowed hide path uses the ternary `isCalloutFirstChild ? 'none' : ''`.
       */
      const literalHide = toolbarSource.match(
        /settingsToggler\s*\.\s*style\s*\.\s*display\s*=\s*['"]none['"]/g
      );

      expect(literalHide).toBeNull();
    });

    it('hides settingsToggler only via the isCalloutFirstChild ternary', () => {
      const allWrites = toolbarSource.match(
        /settingsToggler(?:\??\.style)?\.style\.display\s*=\s*[^;]+/g
      ) ?? [];

      /**
       * Every hide-capable write (one containing 'none') must be guarded by
       * `isCalloutFirstChild`. Restore writes (containing only '' ) are fine.
       */
      const hidingWrites = allWrites.filter((line) => line.includes("'none'") || line.includes('"none"'));

      expect(hidingWrites.length).toBeGreaterThan(0);

      for (const line of hidingWrites) {
        expect(line).toContain('isCalloutFirstChild');
      }
    });

    it('does not key settings-toggler visibility off document.activeElement or container DOM attributes', () => {
      /**
       * Future regressions to watch: someone re-introducing a helper like
       * `isFocusInsideTableCell()` or an inline `document.activeElement`
       * check that hides the drag handle based on where focus currently sits.
       *
       * Strategy: find every line assigning `settingsToggler.style.display`
       * and check a ±400-character window around each assignment for
       * forbidden symbols. A window-based check catches mutations regardless
       * of whether the forbidden symbol appears before or after the assignment
       * (e.g. a ternary condition to the left, or a helper variable computed
       * just above).
       */
      const forbiddenInWindow: Array<{ name: string; pattern: RegExp }> = [
        { name: 'document.activeElement', pattern: /document\s*\.\s*activeElement/ },
        { name: 'container DOM attribute selector', pattern: /closest\s*\(\s*['"][^'"]*data-blok-[a-z-]*(?:cell|nested-blocks|toggle-children)/ },
        { name: 'isFocusInside* helper', pattern: /isFocusInside/i },
      ];

      const assignmentRegex = /settingsToggler[\s\S]{0,30}?\.style\.display\s*=/g;
      const windowSize = 400;

      let match: RegExpExecArray | null;
      const windows: Array<{ start: number; text: string }> = [];

      while ((match = assignmentRegex.exec(toolbarSource)) !== null) {
        const start = Math.max(0, match.index - windowSize);
        const end = Math.min(toolbarSource.length, match.index + windowSize);

        windows.push({ start, text: toolbarSource.slice(start, end) });
      }

      expect(windows.length).toBeGreaterThan(0);

      const findHit = (): { name: string; start: number } | null => {
        for (const { start, text } of windows) {
          const hit = forbiddenInWindow.find(({ pattern }) => pattern.test(text));

          if (hit !== undefined) {
            return { name: hit.name, start };
          }
        }

        return null;
      };

      const hit = findHit();

      expect(
        hit,
        hit === null
          ? ''
          : `Forbidden symbol "${hit.name}" appears within 400 chars of a `
            + `settingsToggler.style.display assignment near offset ${hit.start}. `
            + `This risks re-introducing the "drag handle hidden while editing `
            + `nested content" bug. See the comment on `
            + `updateToolbarButtonsForCalloutFirstChild().`
      ).toBeNull();

      /**
       * Also forbid the standalone helper name anywhere in the file — if
       * someone re-adds it, catch it regardless of where it's called.
       */
      expect(toolbarSource).not.toMatch(/isFocusInside/i);
    });

    /**
     * Behavioral matrix: for every common nested-content shape, `moveAndOpen`
     * must keep the drag handle visible when focus sits inside that content.
     * Covers table cells (resolved up to parent), code-style
     * contenteditables, database-title-style contenteditables, toggle/header
     * child containers, and a plain nested contenteditable.
     */
    const scenarios: Array<{ name: string; buildNested: (blockHolder: HTMLElement) => HTMLElement }> = [
      {
        name: 'focus inside a table cell (resolved to parent table)',
        buildNested: (blockHolder) => {
          const cellContainer = document.createElement('div');

          cellContainer.setAttribute('data-blok-table-cell-blocks', '');

          const cellBlockHolder = document.createElement('div');

          cellBlockHolder.setAttribute('data-blok-testid', 'block-wrapper');
          cellContainer.appendChild(cellBlockHolder);
          blockHolder.appendChild(cellContainer);

          const editable = document.createElement('div');

          editable.setAttribute('contenteditable', 'true');
          cellBlockHolder.appendChild(editable);

          return editable;
        },
      },
      {
        name: 'focus inside a code-block contenteditable',
        buildNested: (blockHolder) => {
          const code = document.createElement('div');

          code.setAttribute('contenteditable', 'plaintext-only');
          blockHolder.appendChild(code);

          return code;
        },
      },
      {
        name: 'focus inside a database title contenteditable',
        buildNested: (blockHolder) => {
          const title = document.createElement('div');

          title.setAttribute('data-blok-database-title', '');
          title.setAttribute('contenteditable', 'true');
          blockHolder.appendChild(title);

          return title;
        },
      },
      {
        name: 'focus inside a toggle/header child-blocks container',
        buildNested: (blockHolder) => {
          const childContainer = document.createElement('div');

          childContainer.setAttribute('data-blok-toggle-children', '');
          childContainer.setAttribute('data-blok-nested-blocks', '');
          blockHolder.appendChild(childContainer);

          const childEditable = document.createElement('div');

          childEditable.setAttribute('contenteditable', 'true');
          childContainer.appendChild(childEditable);

          return childEditable;
        },
      },
      {
        name: 'focus inside an arbitrary nested contenteditable',
        buildNested: (blockHolder) => {
          const wrapper = document.createElement('section');

          blockHolder.appendChild(wrapper);

          const editable = document.createElement('div');

          editable.setAttribute('contenteditable', 'true');
          wrapper.appendChild(editable);

          return editable;
        },
      },
    ];

    for (const scenario of scenarios) {
      it(`keeps drag handle visible: ${scenario.name}`, () => {
        const blockHolder = document.createElement('div');

        blockHolder.setAttribute('data-blok-testid', 'block-wrapper');

        const pluginsContent = document.createElement('div');

        blockHolder.appendChild(pluginsContent);
        document.body.appendChild(blockHolder);

        const nested = scenario.buildNested(blockHolder);

        nested.focus();

        const block = {
          id: 'test-block',
          name: 'paragraph',
          holder: blockHolder,
          pluginsContent,
          isEmpty: false,
          cleanupDraggable: vi.fn(),
          setupDraggable: vi.fn(),
          getTunes: vi.fn(() => ({ toolTunes: [{}], commonTunes: [] })),
          getToolbarAnchorElement: vi.fn(() => undefined),
        };

        const blok = getBlok();

        blok.BlockManager.currentBlock = block as unknown as typeof blok.BlockManager.currentBlock;
        (blok.BlockManager as unknown as { getBlockByChildNode: (node: Node) => unknown }).getBlockByChildNode =
          vi.fn(() => block);

        (toolbar as unknown as { moveAndOpen: (b: unknown, t?: unknown) => void }).moveAndOpen(block);

        const nodes = (toolbar as unknown as { nodes: typeof toolbar['nodes'] }).nodes;

        expect(nodes.settingsToggler?.style.display).toBe('');
        expect(nodes.plusButton?.style.display).toBe('');

        (toolbar as unknown as { updateToolbarButtonsForCalloutFirstChild: () => void })
          .updateToolbarButtonsForCalloutFirstChild();

        expect(nodes.settingsToggler?.style.display).toBe('');
        expect(nodes.plusButton?.style.display).toBe('');

        expect(block.setupDraggable).toHaveBeenCalled();
        expect(block.setupDraggable.mock.calls[0]?.[0]).toBe(nodes.settingsToggler);

        document.body.removeChild(blockHolder);
      });
    }
  });

  describe('discardPlusContext', () => {
    // Regression guard: if preToolboxBlock survives a programmatic
    // close-and-reopen of the toolbox (e.g. slashPressed -> activateToolbox),
    // the Closed handler restores caret to the pre-plus block and subsequent
    // keystrokes land in the wrong block. Both fields must clear.
    it('clears preToolboxBlock and plusInsertedBlock so Closed handler skips focus restore', () => {
      const internal = toolbar as unknown as {
        preToolboxBlock: unknown;
        plusInsertedBlock: unknown;
      };

      internal.preToolboxBlock = { name: 'paragraph' };
      internal.plusInsertedBlock = { name: 'paragraph' };

      toolbar.discardPlusContext();

      expect(internal.preToolboxBlock).toBeNull();
      expect(internal.plusInsertedBlock).toBeNull();
    });

    it('is a no-op when no plus context is set', () => {
      const internal = toolbar as unknown as {
        preToolboxBlock: unknown;
        plusInsertedBlock: unknown;
      };

      internal.preToolboxBlock = null;
      internal.plusInsertedBlock = null;

      expect(() => toolbar.discardPlusContext()).not.toThrow();
      expect(internal.preToolboxBlock).toBeNull();
      expect(internal.plusInsertedBlock).toBeNull();
    });
  });
});

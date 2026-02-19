import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Toolbar } from '../../../../../src/components/modules/toolbar/index';
import type * as UtilsModule from '../../../../../src/components/utils';
import { BlockHovered } from '../../../../../src/components/events/BlockHovered';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

vi.mock('../../../../../src/components/icons', () => ({
  IconMenu: '<svg></svg>',
  IconPlus: '<svg></svg>',
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
});

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
    const plusButtonClicked = (toolbar as unknown as { plusButtonClicked: () => void }).plusButtonClicked;
    const blockSelection = getBlok().BlockSelection as { anyBlockSelected: boolean };
    const toolboxInstance = (toolbar as unknown as { toolboxInstance: { opened: boolean } }).toolboxInstance;

    expect(blockSelection.anyBlockSelected).toBe(true);

    plusButtonClicked.call(toolbar);

    expect(blockSelection.anyBlockSelected).toBe(false);
    expect(toolboxInstance.opened).toBe(true);
  });

  it('does not clear selection when no blocks are selected', () => {
    const blockSelection = getBlok().BlockSelection as { anyBlockSelected: boolean };
    blockSelection.anyBlockSelected = false;

    const plusButtonClicked = (toolbar as unknown as { plusButtonClicked: () => void }).plusButtonClicked;
    const toolboxInstance = (toolbar as unknown as { toolboxInstance: { opened: boolean } }).toolboxInstance;

    plusButtonClicked.call(toolbar);

    // Since no blocks were selected, clearSelection should not have been called
    // and anyBlockSelected should still be false
    expect(blockSelection.anyBlockSelected).toBe(false);
    // Toolbox should still be opened
    expect(toolboxInstance.opened).toBe(true);
  });
});

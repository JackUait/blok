import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Toolbar from '../../../../../src/components/modules/toolbar/index';
import type * as UtilsModule from '../../../../../src/components/utils';
import { BlockHovered } from '../../../../../src/components/events/BlockHovered';
import type { EditorModules } from '../../../../../src/types-internal/editor-modules';

vi.mock('@codexteam/icons', () => ({
  IconMenu: '<svg></svg>',
  IconPlus: '<svg></svg>',
}));

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  hide: vi.fn(),
  onHover: vi.fn(),
}));

vi.mock('../../../../../src/components/dom', () => ({
  default: {
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
  default: {
    ui: vi.fn(() => ''),
    t: vi.fn(() => ''),
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
  const getEditor = (): EditorModules =>
    (toolbar as unknown as { Editor: EditorModules }).Editor;

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
      },
      InlineToolbar: {
        opened: false,
      },
      ReadOnly: {
        isEnabled: false,
      },
    } as unknown as Toolbar['Editor'];

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

    getEditor().BlockSettings.opened = true;
    const moveSpy = vi.spyOn(toolbar as unknown as { moveAndOpen: (block: unknown) => void }, 'moveAndOpen');

    blockHoveredHandler?.({ block: {} });

    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('does not move when Toolbox is opened during block hover', () => {
    enableBindings();

    getEditor().BlockSettings.opened = false;
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


import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import BlockSettings from '../../../../../src/components/modules/toolbar/blockSettings';
import type Block from '../../../../../src/components/block';
import type { EditorModules } from '../../../../../src/types-internal/editor-modules';
import type { EditorConfig } from '../../../../../types';
import type { MenuConfigItem } from '../../../../../types/tools';
import { PopoverItemType, PopoverDesktop, PopoverMobile } from '../../../../../src/components/utils/popover';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';
import SelectionUtils from '../../../../../src/components/selection';

type PopoverMock = {
  on: Mock<[string, () => void], void>;
  off: Mock<[string, () => void], void>;
  destroy: Mock<[], void>;
  getElement: Mock<[], HTMLDivElement>;
  show: Mock<[], void>;
  params?: unknown;
};

const popoverInstances: PopoverMock[] = [];

const buildPopoverMock = (): PopoverMock => {
  const element = document.createElement('div');

  return {
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    getElement: vi.fn(() => element),
    show: vi.fn(),
  };
};

const getLastPopover = (): PopoverMock | undefined => popoverInstances.at(-1);

vi.mock('../../../../../src/components/utils/popover', () => {
  const createPopover = (params: unknown): PopoverMock => {
    const instance = buildPopoverMock();

    instance.params = params;
    popoverInstances.push(instance);

    return instance;
  };

  return {
    PopoverDesktop: vi.fn(createPopover),
    PopoverMobile: vi.fn(createPopover),
    PopoverItemType: {
      Default: 'default',
      Separator: 'separator',
      Html: 'html',
    },
  };
});

type FlipperMock = {
  focusItem: Mock<[number], void>;
  setHandleContentEditableTargets: Mock<[boolean], void>;
  handleExternalKeydown: Mock<[KeyboardEvent], void>;
};

const flipperInstances: FlipperMock[] = [];

vi.mock('../../../../../src/components/flipper', () => ({
  default: vi.fn().mockImplementation(() => {
    const instance: FlipperMock = {
      focusItem: vi.fn(),
      setHandleContentEditableTargets: vi.fn(),
      handleExternalKeydown: vi.fn(),
    };

    flipperInstances.push(instance);

    return instance;
  }),
}));

const { getConvertibleToolsForBlockMock } = vi.hoisted(() => ({
  getConvertibleToolsForBlockMock: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/blocks', () => ({
  getConvertibleToolsForBlock: getConvertibleToolsForBlockMock,
}));

const { isMobileScreenMock } = vi.hoisted(() => ({
  isMobileScreenMock: vi.fn(() => false),
}));

vi.mock('../../../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: isMobileScreenMock,
    keyCodes: {
      TAB: 9,
      UP: 38,
      DOWN: 40,
      ENTER: 13,
    },
  };
});

vi.mock('../../../../../src/components/utils/popover/components/popover-item', () => ({
  css: {
    focused: 'focused',
  },
}));

vi.mock('@/types/utils/popover/popover-event', () => ({
  PopoverEvent: {
    Closed: 'closed',
  },
}));

vi.mock('@codexteam/icons', () => ({
  IconReplace: '<svg data-icon="replace" />',
}));

vi.mock('../../../../../src/components/i18n', () => ({
  default: {
    ui: vi.fn((_ns: string, key: string) => key),
    t: vi.fn((_ns: string, key: string) => key),
  },
}));

const { domModuleMock } = vi.hoisted(() => {
  const makeDomNodeMock = vi.fn((tag: string, className?: string | string[]) => {
    const node = document.createElement(tag);

    if (Array.isArray(className)) {
      node.className = className.join(' ');
    } else if (className) {
      node.className = className;
    }

    return node;
  });

  return {
    domModuleMock: {
      default: {
        make: makeDomNodeMock,
      },
    },
  };
});

vi.mock('../../../../../src/components/dom', () => domModuleMock);

type EventsDispatcherMock = {
  on: Mock<[unknown, () => void], void>;
  off: Mock<[unknown, () => void], void>;
  emit: Mock<[unknown], void>;
};

const createBlock = (): Block => ({
  getTunes: vi.fn(() => ({
    toolTunes: [],
    commonTunes: [],
  })),
  holder: document.createElement('div'),
  pluginsContent: document.createElement('div'),
} as unknown as Block);

type EditorMock = {
  BlockSelection: {
    selectBlock: Mock<[Block], void>;
    clearCache: Mock<[], void>;
    unselectBlock: Mock<[Block], void>;
  };
  BlockManager: {
    currentBlock?: Block;
    convert: Mock<[Block, string, unknown?], Promise<Block>>;
  };
  CrossBlockSelection: {
    isCrossBlockSelectionStarted: boolean;
    clear: Mock<[Event?], void>;
  };
  API: {
    methods: {
      ui: {
        nodes: {
          redactor: HTMLElement;
        };
      };
    };
  };
  Tools: {
    blockTools: Map<string, { name: string; toolbox?: Array<{ icon?: string; title?: string; data?: unknown }> }>;
    inlineTools: Map<never, never>;
    blockTunes: Map<never, never>;
    externalTools: Map<never, never>;
    internalTools: Map<never, never>;
  };
  Caret: {
    positions: {
      START: string;
      END: string;
      DEFAULT: string;
    };
    setToBlock: Mock<[Block, string], void>;
  };
  Toolbar: {
    close: Mock<[], void>;
  };
};

const createEditorMock = (): EditorMock => {
  const redactor = document.createElement('div');
  const blockSelection = {
    selectBlock: vi.fn(),
    clearCache: vi.fn(),
    unselectBlock: vi.fn(),
  };
  const blockManager = {
    currentBlock: undefined as Block | undefined,
    convert: vi.fn<[Block, string, unknown?], Promise<Block>>(async () => createBlock()),
  };
  const crossBlockSelection = {
    isCrossBlockSelectionStarted: false,
    clear: vi.fn(),
  };
  const tools = {
    blockTools: new Map<string, { name: string; toolbox?: Array<{ icon?: string; title?: string; data?: unknown }> }>(),
    inlineTools: new Map<never, never>(),
    blockTunes: new Map<never, never>(),
    externalTools: new Map<never, never>(),
    internalTools: new Map<never, never>(),
  };
  const caret = {
    positions: {
      START: 'start',
      END: 'end',
      DEFAULT: 'default',
    },
    setToBlock: vi.fn(),
  };
  const toolbar = {
    close: vi.fn(),
  };

  return {
    BlockSelection: blockSelection,
    BlockManager: blockManager,
    CrossBlockSelection: crossBlockSelection,
    API: {
      methods: {
        ui: {
          nodes: {
            redactor,
          },
        },
      },
    },
    Tools: tools,
    Caret: caret,
    Toolbar: toolbar,
  } satisfies EditorMock;
};

describe('BlockSettings', () => {
  let blockSettings: BlockSettings;
  let editorMock: EditorMock;
  let eventsDispatcher: EventsDispatcherMock;

  beforeEach(() => {
    popoverInstances.length = 0;
    flipperInstances.length = 0;
    getConvertibleToolsForBlockMock.mockReset();
    isMobileScreenMock.mockClear();

    eventsDispatcher = {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    blockSettings = new BlockSettings({
      config: {} as EditorConfig,
      eventsDispatcher: eventsDispatcher as unknown as typeof blockSettings['eventsDispatcher'],
    });

    editorMock = createEditorMock();
    blockSettings.state = editorMock as unknown as EditorModules;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates wrapper and subscribes to layout toggles on make', () => {
    blockSettings.make();

    const element = blockSettings.getElement();

    expect(element).toBeInstanceOf(HTMLElement);
    expect(element?.classList.contains('ce-settings')).toBe(true);
    expect(element?.dataset.cy).toBe('block-tunes');
    expect(eventsDispatcher.on).toHaveBeenCalledWith(expect.anything(), blockSettings.close);
  });

  it('does nothing when open is called without a block', async () => {
    await blockSettings.open();

    expect(blockSettings.opened).toBe(false);
    expect(eventsDispatcher.emit).not.toHaveBeenCalled();
  });

  it('opens block settings near provided block', async () => {
    blockSettings.make();

    const block = createBlock();

    editorMock.BlockManager.currentBlock = block;

    const selectionStub = {
      save: vi.fn(),
      restore: vi.fn(),
      clearSaved: vi.fn(),
    };

    (blockSettings as unknown as { selection: typeof selectionStub }).selection = selectionStub;

    const addEventListenerSpy = vi.spyOn(block.pluginsContent as HTMLElement, 'addEventListener');
    const getTunesItemsSpy = vi.spyOn(blockSettings as unknown as {
      getTunesItems: (b: Block, common: MenuConfigItem[], tool?: MenuConfigItem[]) => Promise<PopoverItemParams[]>;
    }, 'getTunesItems').mockResolvedValue([
      {
        name: 'duplicate',
        title: 'Duplicate',
      } as PopoverItemParams,
    ]);

    await blockSettings.open(block);

    expect(blockSettings.opened).toBe(true);
    expect(selectionStub.save).toHaveBeenCalledTimes(1);
    expect(editorMock.BlockSelection.selectBlock).toHaveBeenCalledWith(block);
    expect(eventsDispatcher.emit).toHaveBeenCalledWith(blockSettings.events.opened);

    const popover = getLastPopover();

    expect(popover?.show).toHaveBeenCalledTimes(1);
    expect(popover?.on).toHaveBeenCalledWith('closed', expect.any(Function));

    const popoverElement = popover?.getElement();

    expect(popoverElement && blockSettings.getElement()?.contains(popoverElement)).toBe(true);
    expect(flipperInstances[0]?.focusItem).toHaveBeenCalledWith(0);
    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    getTunesItemsSpy.mockRestore();
  });

  it('falls back to current block and instantiates mobile popover without focusing flipper', async () => {
    blockSettings.make();

    const block = createBlock();

    editorMock.BlockManager.currentBlock = block;

    const selectionStub = {
      save: vi.fn(),
      restore: vi.fn(),
      clearSaved: vi.fn(),
    };

    (blockSettings as unknown as { selection: typeof selectionStub }).selection = selectionStub;

    const getTunesItemsSpy = vi.spyOn(blockSettings as unknown as {
      getTunesItems: (b: Block, common: MenuConfigItem[], tool?: MenuConfigItem[]) => Promise<PopoverItemParams[]>;
    }, 'getTunesItems').mockResolvedValue([]);

    isMobileScreenMock.mockReturnValueOnce(true);

    await blockSettings.open();

    expect(PopoverMobile).toHaveBeenCalledTimes(1);
    expect(PopoverDesktop).not.toHaveBeenCalled();
    expect(selectionStub.save).toHaveBeenCalledTimes(1);
    expect(flipperInstances[0]?.focusItem).not.toHaveBeenCalled();

    const params = getLastPopover()?.params as { flipper?: unknown } | undefined;

    expect(params?.flipper).toBeUndefined();

    getTunesItemsSpy.mockRestore();
  });

  it('restores selection and tears down popover on close', () => {
    blockSettings.make();

    const block = createBlock();

    editorMock.BlockManager.currentBlock = block;

    const selectionStub = {
      save: vi.fn(),
      restore: vi.fn(),
      clearSaved: vi.fn(),
    };

    (blockSettings as unknown as { selection: typeof selectionStub }).selection = selectionStub;

    const popoverElement = document.createElement('div');
    const popover = {
      off: vi.fn(),
      destroy: vi.fn(),
      getElement: vi.fn(() => popoverElement),
    };

    Object.assign(blockSettings as unknown as { opened: boolean; popover: typeof popover }, {
      opened: true,
      popover,
    });

    const detachSpy = vi.spyOn(blockSettings as unknown as { detachFlipperKeydownListener: () => void }, 'detachFlipperKeydownListener');
    const selectionAtEditorSpy = vi.spyOn(SelectionUtils, 'isAtEditor', 'get').mockReturnValue(false);
    const removeSpy = vi.spyOn(popoverElement, 'remove');

    blockSettings.close();

    expect(blockSettings.opened).toBe(false);
    expect(selectionStub.restore).toHaveBeenCalledTimes(1);
    expect(selectionStub.clearSaved).toHaveBeenCalledTimes(1);
    expect(editorMock.BlockSelection.unselectBlock).toHaveBeenCalledWith(block);
    expect(eventsDispatcher.emit).toHaveBeenCalledWith(blockSettings.events.closed);
    expect(popover.destroy).toHaveBeenCalledTimes(1);
    expect(popover.off).toHaveBeenCalledWith('closed', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(detachSpy).toHaveBeenCalledTimes(1);
    expect((blockSettings as unknown as { popover: unknown }).popover).toBeNull();

    selectionAtEditorSpy.mockRestore();
  });

  it('does not try to restore selection when caret is already inside editor UI', () => {
    blockSettings.make();

    const block = createBlock();

    editorMock.BlockManager.currentBlock = block;

    const selectionStub = {
      save: vi.fn(),
      restore: vi.fn(),
      clearSaved: vi.fn(),
    };

    (blockSettings as unknown as { selection: typeof selectionStub }).selection = selectionStub;

    Object.assign(blockSettings as unknown as { opened: boolean; popover: null }, {
      opened: true,
      popover: null,
    });

    const selectionAtEditorSpy = vi.spyOn(SelectionUtils, 'isAtEditor', 'get').mockReturnValue(true);

    blockSettings.close();

    expect(selectionStub.restore).not.toHaveBeenCalled();
    expect(selectionStub.clearSaved).toHaveBeenCalledTimes(1);

    selectionAtEditorSpy.mockRestore();
  });


  it('merges tool tunes, convert-to menu and common tunes', async () => {
    const block = createBlock();

    editorMock.Tools.blockTools = new Map([
      ['paragraph', { name: 'paragraph' } ],
    ]);

    const toolTunes: MenuConfigItem[] = [
      {
        name: 'duplicate',
        title: 'Duplicate',
        onActivate: vi.fn(),
      },
    ];
    const commonTunes: MenuConfigItem[] = [
      {
        name: 'delete',
        title: 'Delete',
        onActivate: vi.fn(),
      },
    ];

    getConvertibleToolsForBlockMock.mockResolvedValueOnce([
      {
        name: 'header',
        toolbox: [
          {
            icon: '<svg />',
            title: 'Header',
            data: { level: 2 },
          },
        ],
      },
    ]);

    const items = await (blockSettings as unknown as {
      getTunesItems: (b: Block, common: MenuConfigItem[], tool?: MenuConfigItem[]) => Promise<PopoverItemParams[]>;
    }).getTunesItems(block, commonTunes, toolTunes);

    if ('title' in items[0]) {
      expect(items[0].title).toBe('Duplicate');
    }
    expect(items[1].type).toBe(PopoverItemType.Separator);

    const convertTo = items.find((item): item is PopoverItemParams & { name?: string; children?: { items?: PopoverItemParams[] } } => 'name' in item && item.name === 'convert-to');

    if (convertTo && 'children' in convertTo) {
      expect(convertTo.children?.items).toHaveLength(1);
    }

    const lastItem = items.at(-1);

    if (lastItem && 'name' in lastItem) {
      expect(lastItem.name).toBe('delete');
    }
    expect(getConvertibleToolsForBlockMock).toHaveBeenCalledWith(block, Array.from(editorMock.Tools.blockTools.values()));
  });

  it('returns only common tunes when there are no tool-specific or convertible tunes', async () => {
    const block = createBlock();
    const commonTunes: MenuConfigItem[] = [
      {
        name: 'move-up',
        title: 'Move up',
        onActivate: vi.fn(),
      },
      {
        name: 'move-down',
        title: 'Move down',
        onActivate: vi.fn(),
      },
    ];

    getConvertibleToolsForBlockMock.mockResolvedValueOnce([]);

    const items = await (blockSettings as unknown as {
      getTunesItems: (b: Block, common: MenuConfigItem[], tool?: MenuConfigItem[]) => Promise<PopoverItemParams[]>;
    }).getTunesItems(block, commonTunes);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.type !== PopoverItemType.Separator)).toBe(true);
  });

  it('forwards popover close event to block settings close', () => {
    const closeSpy = vi.spyOn(blockSettings, 'close');

    (blockSettings as unknown as { onPopoverClose: () => void }).onPopoverClose();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('attaches and detaches flipper keydown listeners around block content', () => {
    const block = createBlock();
    const addSpy = vi.spyOn(block.pluginsContent as HTMLElement, 'addEventListener');
    const removeSpy = vi.spyOn(block.pluginsContent as HTMLElement, 'removeEventListener');

    (blockSettings as unknown as { attachFlipperKeydownListener: (b: Block) => void }).attachFlipperKeydownListener(block);

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(flipperInstances[0].setHandleContentEditableTargets).toHaveBeenCalledWith(true);

    (blockSettings as unknown as { detachFlipperKeydownListener: () => void }).detachFlipperKeydownListener();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(flipperInstances[0].setHandleContentEditableTargets).toHaveBeenCalledWith(false);
  });

  it('skips attaching flipper keydown listener when plugins content is not an element', () => {
    const block = {
      pluginsContent: null,
    } as unknown as Block;

    (blockSettings as unknown as { attachFlipperKeydownListener: (b: Block) => void }).attachFlipperKeydownListener(block);

    expect(flipperInstances[0].setHandleContentEditableTargets).toHaveBeenCalledWith(false);
    expect((blockSettings as unknown as { flipperKeydownSource: HTMLElement | null }).flipperKeydownSource).toBeNull();
  });

  it('cleans up listeners and nodes on destroy', () => {
    const detachSpy = vi.spyOn(blockSettings as unknown as { detachFlipperKeydownListener: () => void }, 'detachFlipperKeydownListener');
    const removeNodesSpy = vi.spyOn(blockSettings, 'removeAllNodes');
    const listenersDestroySpy = vi.spyOn((blockSettings as unknown as { listeners: { destroy: () => void } }).listeners, 'destroy');

    blockSettings.destroy();

    expect(detachSpy).toHaveBeenCalledTimes(1);
    expect(removeNodesSpy).toHaveBeenCalledTimes(1);
    expect(listenersDestroySpy).toHaveBeenCalledTimes(1);
    expect(eventsDispatcher.off).toHaveBeenCalledWith(expect.anything(), blockSettings.close);
  });
});

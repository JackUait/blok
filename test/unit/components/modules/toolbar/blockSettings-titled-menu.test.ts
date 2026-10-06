/** A tool's `blockMenu` declaration lays out the block menu like Notion's page menu. */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { MenuConfigItem } from '../../../../../types/tools';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';

type PopoverMock = {
  on: Mock;
  off: Mock;
  destroy: Mock;
  getElement: Mock;
  show: Mock;
};

const popoverInstances: PopoverMock[] = [];

vi.mock('../../../../../src/components/utils/popover', () => {
  const createPopoverClass = (): new () => PopoverMock => {
    return function (this: PopoverMock) {
      const element = document.createElement('div');

      this.on = vi.fn();
      this.off = vi.fn();
      this.destroy = vi.fn();
      this.getElement = vi.fn(() => element);
      this.show = vi.fn();
      popoverInstances.push(this);
    } as unknown as new () => PopoverMock;
  };

  return {
    PopoverDesktop: createPopoverClass(),
    PopoverMobile: createPopoverClass(),
    PopoverItemType: {
      Default: 'default',
      Separator: 'separator',
      Html: 'html',
    },
  };
});

vi.mock('../../../../../src/components/flipper', () => ({
  Flipper: function (this: Record<string, unknown>) {
    this.focusItem = vi.fn();
    this.setHandleContentEditableTargets = vi.fn();
    this.handleExternalKeydown = vi.fn();
  } as unknown as new () => unknown,
}));

const { getConvertibleToolsForBlockMock, getConvertibleToolsForBlocksMock } = vi.hoisted(() => ({
  getConvertibleToolsForBlockMock: vi.fn(),
  getConvertibleToolsForBlocksMock: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/blocks', () => ({
  getConvertibleToolsForBlock: getConvertibleToolsForBlockMock,
  getConvertibleToolsForBlocks: getConvertibleToolsForBlocksMock,
  CURRENT_CONVERT_VARIANT: '__currentConvertVariant',
}));

vi.mock('../../../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => false),
    keyCodes: { TAB: 9, UP: 38, DOWN: 40, ENTER: 13, DELETE: 46 },
  };
});

vi.mock('../../../../../src/components/utils/popover/components/popover-item', () => ({
  css: { focused: 'focused' },
}));

vi.mock('@/types/utils/popover/popover-event', () => ({
  PopoverEvent: { Closed: 'closed' },
}));

vi.mock('../../../../../src/components/icons', () => ({
  IconColumns: '<svg data-blok-icon="columns" />',
  IconReplace: '<svg data-blok-icon="replace" />',
  IconTrash: '<svg data-blok-icon="trash" />',
  IconCopy: '<svg data-blok-icon="copy" />',
}));

vi.mock('../../../../../src/components/dom', () => ({
  Dom: { make: vi.fn((tag: string) => document.createElement(tag)) },
}));

vi.mock('../../../../../src/components/i18n', () => ({
  I18n: {
    ui: vi.fn((_ns: string, key: string) => key),
    t: vi.fn((_ns: string, key: string) => key),
    hasTranslation: vi.fn(() => false),
  },
}));

const createBlock = (blockMenu = { titled: false, trash: false }): Block => ({
  getTunes: vi.fn(() => ({ commonTunes: [] })),
  getActiveToolboxEntry: vi.fn(async () => undefined),
  name: 'page',
  tool: { name: 'page', blockMenu, toolbox: [{ titleKey: 'page' }] },
  holder: document.createElement('div'),
  pluginsContent: document.createElement('div'),
} as unknown as Block);

const createBlokMock = (): Record<string, unknown> => ({
  BlockSelection: {
    selectBlock: vi.fn(),
    clearSelection: vi.fn(),
    clearCache: vi.fn(),
    unselectBlock: vi.fn(),
    selectedBlocks: [] as Block[],
    allBlocksSelected: false,
  },
  BlockManager: {
    currentBlock: undefined as Block | undefined,
    convert: vi.fn(async () => createBlock()),
  },
  DragManager: {
    duplicateBlocksInPlace: vi.fn(async () => []),
  },
  ReadOnly: { isEnabled: false },
  CrossBlockSelection: { isCrossBlockSelectionStarted: false, clear: vi.fn() },
  API: { methods: { ui: { nodes: { redactor: document.createElement('div') } } } },
  Tools: {
    blockTools: new Map(),
    inlineTools: new Map(),
    blockTunes: new Map(),
    externalTools: new Map(),
    internalTools: new Map(),
  },
  Caret: {
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
    setToBlock: vi.fn(),
  },
  Toolbar: { close: vi.fn() },
  I18n: { t: vi.fn((key: string) => key), has: vi.fn(() => true), getLocale: vi.fn(() => 'en'), getEnglishTranslation: vi.fn((key: string) => key) },
});


type Named = PopoverItemParams & { name?: string; title?: string; type?: unknown; element?: HTMLElement };

const layout = (items: PopoverItemParams[]): string[] => (items as Named[]).map((item) => {
  if (String(item.type) === 'separator') {
    return '---';
  }
  if (item.name === 'block-menu-title') {
    return `# ${item.element?.textContent ?? ''}`;
  }

  return item.name ?? '?';
});

describe('BlockSettings — a tool that declares a titled block menu', () => {
  let blockSettings: BlockSettings;

  const commonTunes = (): MenuConfigItem[] => [
    { name: 'copy-link', title: 'Copy link', onActivate: vi.fn() },
    { name: 'delete', title: 'blockSettings.delete', onActivate: vi.fn() },
  ];
  const toolTunes = (): MenuConfigItem[] => [
    { name: 'color', title: 'Color', onActivate: vi.fn() },
    { name: 'rename', title: 'Rename', onActivate: vi.fn() },
    { type: 'separator' } as MenuConfigItem,
    { name: 'open', title: 'Open', onActivate: vi.fn() },
  ];
  const tunesItems = (block: Block, tool: MenuConfigItem[] = toolTunes()): Promise<PopoverItemParams[]> =>
    (blockSettings as unknown as {
      getTunesItems: (b: Block, common: MenuConfigItem[], tool: MenuConfigItem[]) => Promise<PopoverItemParams[]>;
    }).getTunesItems(block, commonTunes(), tool);

  beforeEach(() => {
    popoverInstances.length = 0;
    getConvertibleToolsForBlockMock.mockReset();
    blockSettings = new BlockSettings({
      config: {},
      eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as typeof blockSettings['eventsDispatcher'],
    });
    blockSettings.state = createBlokMock() as unknown as BlokModules;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('heads the menu with the tool title and puts Turn into before the tool actions', async () => {
    getConvertibleToolsForBlockMock.mockResolvedValueOnce([
      { name: 'paragraph', toolbox: [{ icon: '<svg />', titleKey: 'text' }] },
    ]);

    const items = await tunesItems(createBlock({ titled: true, trash: true }));

    expect(layout(items)).toEqual([
      '# toolNames.page',
      'convert-to',
      'color',
      'rename',
      '---',
      'open',
      '---',
      'copy-link',
      'duplicate',
      'delete',
      '---',
      'edit-metadata',
    ]);
  });

  it('reads Delete as Move to Trash', async () => {
    getConvertibleToolsForBlockMock.mockResolvedValueOnce([]);

    const items = await tunesItems(createBlock({ titled: true, trash: true }));
    const remove = (items as Named[]).find((item) => item.name === 'delete');

    expect(remove?.title).toBe('blockSettings.moveToTrash');
  });

  it('keeps one boundary when there is nothing to turn into', async () => {
    getConvertibleToolsForBlockMock.mockResolvedValueOnce([]);

    const items = await tunesItems(createBlock({ titled: true, trash: false }), [{ name: 'color', title: 'Color', onActivate: vi.fn() }]);

    expect(layout(items)).toEqual([
      '# toolNames.page',
      'color',
      '---',
      'copy-link',
      'duplicate',
      '---',
      'delete',
      '---',
      'edit-metadata',
    ]);
  });

  it('reads Copy link without asking the tool for its link', async () => {
    getConvertibleToolsForBlockMock.mockResolvedValueOnce([]);
    const block = createBlock({ titled: true, trash: true });
    const copyAsLink = vi.fn();

    Object.assign(block.tool, { hasCopyAsLink: true, copyAsLink });

    const items = await tunesItems(block);

    expect((items as Named[]).find((item) => item.name === 'copy-link')?.title).toBe('blockSettings.copyPageLink');
    expect(copyAsLink).not.toHaveBeenCalled();
  });

  it('leaves other tools in the default order', async () => {
    getConvertibleToolsForBlockMock.mockResolvedValueOnce([]);

    const items = await tunesItems(createBlock(), [{ name: 'color', title: 'Color', onActivate: vi.fn() }]);

    expect(layout(items)[0]).toBe('color');
    expect((items as Named[]).find((item) => item.name === 'copy-link')?.title).toBe('Copy link');
    expect((items as Named[]).find((item) => item.name === 'delete')?.title).toBe('blockSettings.delete');
  });
});

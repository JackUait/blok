/**
 * Regression coverage for BUG #8 — the block settings (···) menu must expose an
 * explicit "Duplicate" item beside "Delete", mirroring Notion. Before the fix
 * the only way to duplicate was Cmd/Ctrl+D or alt-drag; the menu never offered it.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import type { MenuConfigItem } from '../../../../../types/tools';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';
import { beautifyShortcut } from '../../../../../src/components/utils/string';

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

const createBlock = (): Block => ({
  getTunes: vi.fn(() => ({ commonTunes: [] })),
  getActiveToolboxEntry: vi.fn(async () => undefined),
  name: 'paragraph',
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
  I18n: { t: vi.fn((key: string) => key), has: vi.fn(() => false), getLocale: vi.fn(() => 'en') },
});

describe('BlockSettings — Duplicate menu item (BUG #8)', () => {
  let blockSettings: BlockSettings;
  let blokMock: Record<string, unknown>;

  beforeEach(() => {
    popoverInstances.length = 0;
    getConvertibleToolsForBlockMock.mockReset();
    getConvertibleToolsForBlocksMock.mockReset();

    blockSettings = new BlockSettings({
      config: {} as BlokConfig,
      eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as typeof blockSettings['eventsDispatcher'],
    });

    blokMock = createBlokMock();
    blockSettings.state = blokMock as unknown as BlokModules;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('includes a "Duplicate" item for a single block', async () => {
    const block = createBlock();
    const commonTunes: MenuConfigItem[] = [
      { name: 'delete', title: 'Delete', onActivate: vi.fn() },
    ];

    getConvertibleToolsForBlockMock.mockResolvedValueOnce([]);

    const items = await (blockSettings as unknown as {
      getTunesItems: (b: Block, common: MenuConfigItem[]) => Promise<PopoverItemParams[]>;
    }).getTunesItems(block, commonTunes);

    const duplicate = items.find(
      (item): item is PopoverItemParams & { name?: string } => 'name' in item && item.name === 'duplicate'
    );

    expect(duplicate).toBeDefined();
  });

  it('renders the Duplicate shortcut via the OS-aware beautifyShortcut helper', async () => {
    const block = createBlock();
    const commonTunes: MenuConfigItem[] = [
      { name: 'delete', title: 'Delete', onActivate: vi.fn() },
    ];

    getConvertibleToolsForBlockMock.mockResolvedValueOnce([]);

    const items = await (blockSettings as unknown as {
      getTunesItems: (b: Block, common: MenuConfigItem[]) => Promise<PopoverItemParams[]>;
    }).getTunesItems(block, commonTunes);

    const duplicate = items.find(
      (item): item is PopoverItemParams & { name?: string; secondaryLabel?: string } =>
        'name' in item && item.name === 'duplicate'
    );

    expect(duplicate?.secondaryLabel).toBe(beautifyShortcut('CMD+D'));
    // The hardcoded literal is gone — it must be derived per-platform.
    expect(duplicate?.secondaryLabel).not.toBe('⌘D');
  });

  it('invokes the existing duplicate operation when the Duplicate item is activated', async () => {
    const block = createBlock();
    const commonTunes: MenuConfigItem[] = [
      { name: 'delete', title: 'Delete', onActivate: vi.fn() },
    ];

    getConvertibleToolsForBlockMock.mockResolvedValueOnce([]);

    const items = await (blockSettings as unknown as {
      getTunesItems: (b: Block, common: MenuConfigItem[]) => Promise<PopoverItemParams[]>;
    }).getTunesItems(block, commonTunes);

    const duplicate = items.find(
      (item): item is PopoverItemParams & { name?: string; onActivate?: () => void } =>
        'name' in item && item.name === 'duplicate'
    );

    expect(duplicate?.onActivate).toBeTypeOf('function');

    duplicate?.onActivate?.(duplicate as PopoverItemParams, { event: new MouseEvent('click') } as never);

    const dragManager = blokMock.DragManager as { duplicateBlocksInPlace: Mock };

    expect(dragManager.duplicateBlocksInPlace).toHaveBeenCalledWith(block);
  });
});

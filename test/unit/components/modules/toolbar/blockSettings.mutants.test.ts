/**
 * Mutation-driven coverage for the block settings (···) menu.
 *
 * Every assertion here was watched failing against a surviving Stryker mutant,
 * so the file is deliberately specific: exact item order, exact arguments, and
 * exact popover params. Loosening any of them re-opens a mutant.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { BlockSettings } from '../../../../../src/components/modules/toolbar/blockSettings';
import type { Block } from '../../../../../src/components/block';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import type { BlokConfig } from '../../../../../types';
import type { BlockToolData, MenuConfigItem, ToolboxConfigEntry } from '../../../../../types/tools';
import type { PopoverItemParams } from '../../../../../types/utils/popover/popover-item';
import type { BlockTuneRenderContext } from '../../../../../types/block-tunes/block-tune';
import { BlockSettingsClosed, BlockSettingsOpened } from '../../../../../src/components/events';
import { SelectionUtils } from '../../../../../src/components/selection';
import { beautifyShortcut } from '../../../../../src/components/utils/string';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';

/* ------------------------------------------------------------------ mocks */

type CapturedPopoverParams = {
  items: PopoverItemParams[];
  trigger?: HTMLElement;
  position?: DOMRect;
  positionContext?: HTMLElement;
  placeLeftOfAnchor?: boolean;
  asideSide?: string;
  viewportMargin?: number;
  contextLabel?: string;
  searchable?: boolean;
  autoFocusFirstItem?: boolean;
  minWidth?: string;
  messages?: Record<string, string>;
  flipper?: unknown;
};

type PopoverMock = {
  on: Mock<(event: string, handler: () => void) => void>;
  off: Mock<(event: string, handler: () => void) => void>;
  destroy: Mock<() => void>;
  getElement: Mock<() => HTMLElement>;
  show: Mock<() => void>;
  hasNode: Mock<(element: HTMLElement) => boolean>;
  params: CapturedPopoverParams;
  kind: 'desktop' | 'mobile';
};

const popoverInstances: PopoverMock[] = [];

vi.mock('../../../../../src/components/utils/popover', () => {
  const createPopoverClass = (kind: 'desktop' | 'mobile'): new (params: unknown) => PopoverMock =>
    function (this: PopoverMock, params: unknown) {
      const element = document.createElement('div');

      this.on = vi.fn();
      this.off = vi.fn();
      this.destroy = vi.fn();
      this.getElement = vi.fn(() => element);
      this.show = vi.fn();
      this.hasNode = vi.fn(() => false);
      this.params = params as CapturedPopoverParams;
      this.kind = kind;
      popoverInstances.push(this);
    } as unknown as new (params: unknown) => PopoverMock;

  return {
    PopoverDesktop: createPopoverClass('desktop'),
    PopoverMobile: createPopoverClass('mobile'),
    PopoverItemType: {
      Default: 'default',
      Separator: 'separator',
      Html: 'html',
    },
  };
});

vi.mock('../../../../../src/components/utils/popover/components/popover-item', () => ({
  css: { focused: 'focused-item' },
}));

type FlipperMock = {
  ctorParams: { focusedItemClass?: string; allowedKeys?: number[] };
  setHandleContentEditableTargets: Mock<(handle: boolean) => void>;
  handleExternalKeydown: Mock<(event: KeyboardEvent) => void>;
  focusItem: Mock<(index: number) => void>;
};

const flipperInstances: FlipperMock[] = [];

vi.mock('../../../../../src/components/flipper', () => ({
  Flipper: function (this: FlipperMock, params: FlipperMock['ctorParams']) {
    this.ctorParams = params ?? {};
    this.setHandleContentEditableTargets = vi.fn();
    this.handleExternalKeydown = vi.fn();
    this.focusItem = vi.fn();
    flipperInstances.push(this);
  } as unknown as new (params: unknown) => FlipperMock,
}));

const { getConvertibleToolsForBlockMock, getConvertibleToolsForBlocksMock } = vi.hoisted(() => ({
  getConvertibleToolsForBlockMock: vi.fn(),
  getConvertibleToolsForBlocksMock: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/blocks', () => ({
  getConvertibleToolsForBlock: getConvertibleToolsForBlockMock,
  getConvertibleToolsForBlocks: getConvertibleToolsForBlocksMock,
}));

const { isMobileScreenMock } = vi.hoisted(() => ({
  isMobileScreenMock: vi.fn(() => false),
}));

vi.mock('../../../../../src/components/utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: isMobileScreenMock,
  };
});

const { wrapBlocksInColumnsMock } = vi.hoisted(() => ({
  wrapBlocksInColumnsMock: vi.fn(() => null as string | null),
}));

vi.mock('../../../../../src/tools/column-drop', () => ({
  wrapBlocksInColumns: wrapBlocksInColumnsMock,
}));

/* --------------------------------------------------------------- fixtures */

type BlockStub = {
  id: string;
  name: string;
  holder: HTMLElement;
  pluginsContent: HTMLElement;
  parentId: string | null;
  selected: boolean;
  createdAt: number;
  lastEditedAt?: number;
  lastEditedBy: string | null;
  data: Promise<BlockToolData>;
  exportDataAsString: Mock<() => Promise<string>>;
  getTunes: Mock<(context: BlockTuneRenderContext) => {
    toolTunes?: MenuConfigItem[];
    commonTunes: MenuConfigItem[];
  }>;
  getActiveToolboxEntry: Mock<() => Promise<ToolboxConfigEntry | undefined>>;
};

let blockCounter = 0;

const createBlockStub = (overrides: Partial<BlockStub> = {}): BlockStub => {
  blockCounter += 1;

  const holder = document.createElement('div');
  const pluginsContent = document.createElement('div');

  // Distinct markup so a structural toHaveBeenCalledWith cannot confuse two blocks.
  holder.setAttribute('data-fixture-block', `holder-${blockCounter}`);
  pluginsContent.setAttribute('data-fixture-block', `content-${blockCounter}`);

  return {
    id: `block-${blockCounter}`,
    name: 'paragraph',
    holder,
    pluginsContent,
    parentId: null,
    selected: false,
    createdAt: Date.UTC(2026, 8, 5, 12, 30),
    lastEditedBy: null,
    data: Promise.resolve({}),
    exportDataAsString: vi.fn(async () => 'exported'),
    getTunes: vi.fn(() => ({ commonTunes: [] as MenuConfigItem[] })),
    getActiveToolboxEntry: vi.fn(async () => undefined),
    ...overrides,
  };
};

const asBlock = (stub: BlockStub): Block => stub as unknown as Block;

type ToolStub = {
  name: string;
  toolbox?: ToolboxConfigEntry[];
  conversionConfig?: {
    export?: string | ((data: BlockToolData) => string);
    import?: string | ((content: string, settings?: unknown) => BlockToolData);
  };
  settings?: Record<string, unknown>;
};

const asTool = (stub: ToolStub): BlockToolAdapter => stub as unknown as BlockToolAdapter;

/** Import that produces one item per newline — the "mergeable" shape (List). */
const listImport = (content: string): BlockToolData => ({
  items: content.split('\n').map((text) => ({ content: text })),
});

/** Import that never produces an items array — the "single item" shape (Paragraph). */
const textImport = (content: string): BlockToolData => ({ text: content });

type Harness = {
  settings: BlockSettings;
  blok: BlokMock;
  dispatcher: { on: Mock; off: Mock; emit: Mock };
  config: BlokConfig;
};

type BlokMock = {
  ReadOnly: { isEnabled: boolean; isControlsHidden: boolean };
  BlockSelection: {
    selectedBlocks: Block[];
    allBlocksSelected: boolean;
    selectBlock: Mock<(block: Block) => void>;
    unselectBlock: Mock<(block: Block) => void>;
    clearSelection: Mock<() => void>;
    clearCache: Mock<() => void>;
  };
  BlockManager: {
    currentBlock?: Block;
    blocks: Block[];
    convert: Mock<(block: Block, tool: string, data?: unknown, options?: unknown) => Promise<Block | null>>;
    replace: Mock<(block: Block, tool: string, data?: unknown) => Block>;
    insert: Mock<(options: unknown) => Block>;
    removeBlock: Mock<(block: Block, addLastBlock: boolean) => Promise<void>>;
    getBlockIndex: Mock<(block: Block) => number>;
    getBlockById: Mock<(id: string) => Block | undefined>;
    getBlock: Mock<(holder: HTMLElement) => Block | undefined>;
    deleteSelectedBlocksAndInsertReplacement: Mock<() => Block | null>;
  };
  CrossBlockSelection: { isCrossBlockSelectionStarted: boolean };
  DragManager?: { duplicateBlocksInPlace: Mock<(block: Block) => Promise<void>> };
  Toolbar: { close: Mock<() => void>; isPositionedRight: boolean };
  Caret: {
    positions: { START: string; END: string; DEFAULT: string };
    setToBlock: Mock<(block: Block, position: string, offset?: number) => void>;
  };
  Tools: { blockTools: Map<string, BlockToolAdapter> };
  API: { methods: { blocks: { getChildren: Mock<(id: string) => Array<{ id: string }>> } } };
  I18n: {
    t: Mock<(key: string, params?: Record<string, unknown>) => string>;
    has: Mock<(key: string) => boolean>;
    getLocale: Mock<() => string>;
    getEnglishTranslation: Mock<(key: string) => string>;
  };
};

const createBlokMock = (): BlokMock => ({
  ReadOnly: { isEnabled: false, isControlsHidden: false },
  BlockSelection: {
    selectedBlocks: [],
    allBlocksSelected: false,
    selectBlock: vi.fn(),
    unselectBlock: vi.fn(),
    clearSelection: vi.fn(),
    clearCache: vi.fn(),
  },
  BlockManager: {
    currentBlock: undefined,
    blocks: [],
    convert: vi.fn(async () => null),
    replace: vi.fn(() => asBlock(createBlockStub())),
    insert: vi.fn(() => asBlock(createBlockStub())),
    removeBlock: vi.fn(async () => undefined),
    getBlockIndex: vi.fn(() => 0),
    getBlockById: vi.fn(() => undefined),
    getBlock: vi.fn(() => undefined),
    deleteSelectedBlocksAndInsertReplacement: vi.fn(() => null),
  },
  CrossBlockSelection: { isCrossBlockSelectionStarted: false },
  DragManager: { duplicateBlocksInPlace: vi.fn(async () => undefined) },
  Toolbar: { close: vi.fn(), isPositionedRight: false },
  Caret: {
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
    setToBlock: vi.fn(),
  },
  Tools: { blockTools: new Map<string, BlockToolAdapter>() },
  API: { methods: { blocks: { getChildren: vi.fn(() => []) } } },
  I18n: {
    // Params are folded into the returned string so an emptied `{ count }`
    // object literal cannot hide behind an identical key.
    t: vi.fn((key: string, params?: Record<string, unknown>) =>
      params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    has: vi.fn(() => false),
    getLocale: vi.fn(() => 'en'),
    getEnglishTranslation: vi.fn((key: string) => `en(${key})`),
  },
});

/* ---------------------------------------------------------------- helpers */

const lastPopover = (): PopoverMock => {
  const popover = popoverInstances.at(-1);

  if (popover === undefined) {
    throw new Error('no popover was created');
  }

  return popover;
};

/** Item identity as the user sees it: the item name, or the bare separator type. */
const itemKeys = (items: PopoverItemParams[]): string[] =>
  items.map((item) => {
    const record = item as unknown as { name?: unknown; type?: unknown };

    return typeof record.name === 'string' ? record.name : String(record.type);
  });

type ActivatableItem = {
  name: string;
  title?: string;
  secondaryLabel?: string;
  closeOnActivate?: boolean;
  isDestructive?: boolean;
  icon?: string;
  onActivate: (item: unknown) => void | Promise<void>;
};

const itemNamed = (items: PopoverItemParams[], name: string): Record<string, unknown> => {
  const found = items.find((item) => (item as unknown as { name?: unknown }).name === name);

  if (found === undefined) {
    throw new Error(`no menu item named "${name}" in [${itemKeys(items).join(', ')}]`);
  }

  return found as unknown as Record<string, unknown>;
};

const activatable = (items: PopoverItemParams[], name: string): ActivatableItem => {
  const item = itemNamed(items, name);

  if (typeof item.onActivate !== 'function') {
    throw new Error(`menu item "${name}" has no onActivate`);
  }

  return item as unknown as ActivatableItem;
};

const childrenOf = (items: PopoverItemParams[], name: string): PopoverItemParams[] => {
  const children = itemNamed(items, name).children as { items?: PopoverItemParams[] } | undefined;

  return children?.items ?? [];
};

const nextTick = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const nextFrame = async (): Promise<void> => {
  await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
  await nextTick();
};

/* ------------------------------------------------------------------ suite */

describe('BlockSettings — mutation coverage', () => {
  let settings: BlockSettings;
  let blok: BlokMock;
  let dispatcher: { on: Mock; off: Mock; emit: Mock };
  let config: BlokConfig;

  const build = (): Harness => {
    dispatcher = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
    config = {};
    settings = new BlockSettings({
      config,
      eventsDispatcher: dispatcher as unknown as ConstructorParameters<typeof BlockSettings>[0]['eventsDispatcher'],
    });
    blok = createBlokMock();
    settings.state = blok as unknown as BlokModules;
    settings.make();

    return { settings, blok, dispatcher, config };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    popoverInstances.length = 0;
    flipperInstances.length = 0;
    getConvertibleToolsForBlockMock.mockReset();
    getConvertibleToolsForBlockMock.mockResolvedValue([]);
    getConvertibleToolsForBlocksMock.mockReset();
    getConvertibleToolsForBlocksMock.mockResolvedValue([]);
    isMobileScreenMock.mockReturnValue(false);
    wrapBlocksInColumnsMock.mockReset();
    wrapBlocksInColumnsMock.mockReturnValue(null);
    build();
  });

  afterEach(() => {
    // ScrollLocker keeps a static reference count; an unclosed menu leaks it.
    settings.destroy();
    vi.restoreAllMocks();
  });

  /* ------------------------------------------------------- public surface */

  describe('public surface', () => {
    it('exposes the opened/closed event pair', () => {
      expect(settings.events).toStrictEqual({
        opened: BlockSettingsOpened,
        closed: BlockSettingsClosed,
      });
    });

    it('keeps the deprecated CSS map with an empty settings class', () => {
      expect(settings.CSS).toStrictEqual({ settings: '' });
    });

    it('is not opening before anything happens', () => {
      expect(settings.isOpening).toBe(false);
      expect(settings.opened).toBe(false);
    });

    it('exposes the shared flipper instance built with the popover item focus class and arrow keys', () => {
      const flipper = flipperInstances.at(-1);

      expect(settings.flipper).toBe(flipper);
      expect(flipper?.ctorParams.focusedItemClass).toBe('focused-item');
      // TAB/UP/DOWN/ENTER/RIGHT/LEFT — dropping any of them breaks menu keyboard nav.
      expect(flipper?.ctorParams.allowedKeys).toStrictEqual([9, 38, 40, 13, 39, 37]);
    });

    it('reports containment for the wrapper, the popover and nothing else', async () => {
      const outside = document.createElement('span');
      const inside = document.createElement('span');
      const wrapper = settings.getElement();

      wrapper?.appendChild(inside);

      expect(settings.contains(inside)).toBe(true);
      expect(settings.contains(outside)).toBe(false);

      const block = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      lastPopover().hasNode.mockReturnValue(true);
      expect(settings.contains(outside)).toBe(true);
    });

    it('answers contains() without a wrapper or a popover', () => {
      const bare = new BlockSettings({
        config,
        eventsDispatcher: dispatcher as unknown as ConstructorParameters<typeof BlockSettings>[0]['eventsDispatcher'],
      });

      bare.state = blok as unknown as BlokModules;

      // No make() has run, so `nodes.wrapper` is undefined and `popover` is null.
      expect(bare.contains(document.createElement('span'))).toBe(false);
    });

    it('survives destroy() before any menu was opened', () => {
      expect(() => settings.destroy()).not.toThrow();
    });

    it('does nothing when close() runs on an already-closed menu', () => {
      settings.close();

      expect(dispatcher.emit).not.toHaveBeenCalled();
      expect(blok.BlockSelection.unselectBlock).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------- open() */

  describe('open()', () => {
    it('refuses to open while read-only hides the controls', async () => {
      blok.ReadOnly.isControlsHidden = true;
      blok.BlockManager.currentBlock = asBlock(createBlockStub());

      await settings.open();

      expect(popoverInstances).toHaveLength(0);
      expect(settings.opened).toBe(false);
    });

    it('never touches the selection when there is no block to open for', async () => {
      await settings.open();

      expect(blok.BlockSelection.selectBlock).not.toHaveBeenCalled();
      expect(popoverInstances).toHaveLength(0);
    });

    it('treats a single selected block as a single-block menu', async () => {
      const selected = createBlockStub();
      const current = createBlockStub();

      blok.BlockSelection.selectedBlocks = [asBlock(selected)];
      blok.BlockManager.currentBlock = asBlock(current);

      await settings.open();

      // One selected block is NOT a multi-selection: the target block wins and
      // still gets highlighted.
      expect(blok.BlockSelection.selectBlock.mock.calls[0][0]).toBe(asBlock(current));
      expect(blok.BlockSelection.clearCache).toHaveBeenCalledTimes(1);
      expect(lastPopover().params.contextLabel).toBe('paragraph');
    });

    it('anchors a multi-selection to the first selected block and skips re-highlighting', async () => {
      const first = createBlockStub();
      const second = createBlockStub();

      blok.BlockSelection.selectedBlocks = [asBlock(first), asBlock(second)];
      blok.BlockManager.currentBlock = asBlock(createBlockStub());

      await settings.open();

      expect(blok.BlockSelection.selectBlock).not.toHaveBeenCalled();
      expect(blok.BlockSelection.clearCache).not.toHaveBeenCalled();
      expect(lastPopover().params.positionContext).toBe(first.holder);
      expect(lastPopover().params.contextLabel).toBe('blockSettings.blocksSelected:{"count":2}');
    });

    it('names the menu after the active toolbox entry of a single block', async () => {
      const block = createBlockStub({
        getActiveToolboxEntry: vi.fn(async () => ({ title: 'Heading 2', titleKey: 'tools.header.heading2' })),
      });

      blok.I18n.has.mockImplementation((key: string) => key === 'tools.header.heading2');
      blok.I18n.t.mockImplementation((key: string) => `t(${key})`);
      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      expect(lastPopover().params.contextLabel).toBe('t(tools.header.heading2)');
    });

    it('hands tunes a render context that resolves the popover element only after it exists', async () => {
      let seenDuringRender: HTMLElement | null | undefined = undefined;
      let capturedContext: BlockTuneRenderContext | undefined;

      const block = createBlockStub({
        getTunes: vi.fn((context: BlockTuneRenderContext) => {
          capturedContext = context;
          seenDuringRender = context.getPopoverElement();

          return { commonTunes: [] as MenuConfigItem[] };
        }),
      });

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      expect(settings.opened).toBe(true);
      // Null, not undefined: the ref exists before the popover does.
      expect(seenDuringRender).toBeNull();
      expect(capturedContext?.getPopoverElement()).toBe(lastPopover().getElement());
    });

    it('stamps the popover element with its test id and aria id', async () => {
      const block = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      const element = lastPopover().getElement();

      expect(element.getAttribute('data-blok-testid')).toBe('block-tunes-popover');
      expect(element.id).toBe('blok-block-settings-popover');
    });

    it('passes the searchable, non-auto-focusing popover params and every a11y message', async () => {
      const block = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      const params = lastPopover().params;

      expect(params.searchable).toBe(true);
      expect(params.autoFocusFirstItem).toBe(false);
      expect(params.minWidth).toBe('220px');
      expect(params.viewportMargin).toBe(8);
      expect(params.messages).toStrictEqual({
        back: 'a11y.back',
        nothingFound: 'popover.nothingFound',
        search: 'popover.search',
        actions: 'popover.actions',
        searchResults: 'a11y.searchResults',
      });
    });

    it('mirrors the menu side when the block controls sit in the inline-end gutter', async () => {
      const block = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(block);
      blok.Toolbar.isPositionedRight = true;

      await settings.open(asBlock(block), document.createElement('button'));

      expect(lastPopover().params.asideSide).toBe('right');
    });

    it('opens beside the dots trigger with no explicit position', async () => {
      const block = createBlockStub();
      const trigger = document.createElement('button');

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open(asBlock(block), trigger);

      const params = lastPopover().params;

      expect(params.trigger).toBe(trigger);
      // A missing `position` key, not an undefined one: the popover falls back
      // to trigger measurement only when the key is absent.
      expect('position' in params).toBe(false);
      expect(params.placeLeftOfAnchor).toBe(true);
      expect(params.asideSide).toBe('left');
    });

    it('opens at a virtual rect when one is given', async () => {
      const block = createBlockStub();
      const rect = new DOMRect(10, 20, 30, 40);

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open(asBlock(block), rect);

      const params = lastPopover().params;

      expect(params.position).toBe(rect);
      expect(params.trigger).toBe(settings.getElement());
      expect(params.placeLeftOfAnchor).toBe(false);
    });

    it('falls back to the block holder rect when nothing anchors the menu', async () => {
      const block = createBlockStub();
      const rect = new DOMRect(1, 2, 3, 4);

      vi.spyOn(block.holder, 'getBoundingClientRect').mockReturnValue(rect);
      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      expect(lastPopover().params.position).toBe(rect);
      expect(lastPopover().params.placeLeftOfAnchor).toBe(false);
    });

    it('gives the desktop popover the shared flipper and the mobile one none', async () => {
      const block = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      expect(lastPopover().kind).toBe('desktop');
      expect(lastPopover().params.flipper).toBe(settings.flipper);

      settings.close();
      isMobileScreenMock.mockReturnValue(true);

      await settings.open();

      expect(lastPopover().kind).toBe('mobile');
      expect('flipper' in lastPopover().params).toBe(false);
    });

    it('shows the popover before announcing that the menu opened', async () => {
      const block = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      const showOrder = lastPopover().show.mock.invocationCallOrder[0];
      const emitIndex = dispatcher.emit.mock.calls.findIndex((call) => call[0] === BlockSettingsOpened);

      expect(emitIndex).toBeGreaterThanOrEqual(0);
      expect(showOrder).toBeLessThan(dispatcher.emit.mock.invocationCallOrder[emitIndex]);
      expect(settings.isOpening).toBe(false);
    });

    it('clears the opening flag when building the menu throws', async () => {
      const block = createBlockStub({
        getTunes: vi.fn(() => {
          throw new Error('tune render blew up');
        }),
      });

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      expect(settings.isOpening).toBe(false);
      expect(settings.opened).toBe(false);
      expect(popoverInstances).toHaveLength(0);
    });

    it('forwards block keydown to the flipper while the menu is open, and stops on close', async () => {
      const block = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open();

      const flipper = flipperInstances.at(-1);
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });

      block.pluginsContent.dispatchEvent(event);

      expect(flipper?.setHandleContentEditableTargets).toHaveBeenCalledWith(true);
      expect(flipper?.handleExternalKeydown).toHaveBeenCalledTimes(1);
      expect(flipper?.handleExternalKeydown.mock.calls[0][0]).toBe(event);

      settings.close();
      block.pluginsContent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      expect(flipper?.handleExternalKeydown).toHaveBeenCalledTimes(1);
      expect(flipper?.setHandleContentEditableTargets).toHaveBeenLastCalledWith(false);
    });
  });

  /* ------------------------------------------------------------- close() */

  describe('close()', () => {
    const openSingle = async (block: BlockStub): Promise<void> => {
      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));
    };

    it('restores the saved selection only when the caret left the editor', async () => {
      const restore = vi.spyOn(SelectionUtils.prototype, 'restore').mockImplementation(() => undefined);
      const isAtBlok = vi.spyOn(SelectionUtils, 'isAtBlok', 'get');

      isAtBlok.mockReturnValue(true);
      await openSingle(createBlockStub());
      settings.close();

      expect(restore).not.toHaveBeenCalled();

      isAtBlok.mockReturnValue(false);
      await openSingle(createBlockStub());
      settings.close();

      expect(restore).toHaveBeenCalledTimes(1);
    });

    it('tears the popover down and announces the closed event', async () => {
      const block = createBlockStub();

      await openSingle(block);

      const popover = lastPopover();
      const element = popover.getElement();

      document.body.appendChild(element);
      settings.close();

      expect(popover.off).toHaveBeenCalledWith('closed', expect.any(Function));
      expect(popover.destroy).toHaveBeenCalledTimes(1);
      expect(element.isConnected).toBe(false);
      expect(dispatcher.emit).toHaveBeenCalledWith(BlockSettingsClosed);
      expect(settings.opened).toBe(false);
    });

    it('leaves the block selection alone while a cross-block selection is in progress', async () => {
      const block = createBlockStub();

      await openSingle(block);
      blok.CrossBlockSelection.isCrossBlockSelectionStarted = true;
      blok.BlockSelection.allBlocksSelected = true;
      settings.close();

      expect(blok.BlockSelection.unselectBlock).not.toHaveBeenCalled();
      expect(blok.BlockSelection.allBlocksSelected).toBe(true);
    });

    it('unselects the single current block on close', async () => {
      const block = createBlockStub();

      await openSingle(block);
      blok.BlockSelection.selectedBlocks = [asBlock(block)];
      settings.close();

      expect(blok.BlockSelection.unselectBlock).toHaveBeenCalledTimes(1);
      expect(blok.BlockSelection.unselectBlock.mock.calls[0][0]).toBe(asBlock(block));
    });

    it('skips unselecting when there is no current block', async () => {
      const block = createBlockStub();

      await openSingle(block);
      blok.BlockManager.currentBlock = undefined;
      settings.close();

      expect(blok.BlockSelection.unselectBlock).not.toHaveBeenCalled();
    });

    it('drops the all-blocks-selected flag instead of unselecting on a multi-selection', async () => {
      const block = createBlockStub();

      await openSingle(block);
      blok.BlockSelection.selectedBlocks = [asBlock(block), asBlock(createBlockStub())];
      blok.BlockSelection.allBlocksSelected = true;
      settings.close();

      expect(blok.BlockSelection.allBlocksSelected).toBe(false);
      expect(blok.BlockSelection.unselectBlock).not.toHaveBeenCalled();
    });
  });

  /* --------------------------------------------------- dismissal & focus */

  describe('dismissal', () => {
    const dismiss = (): void => {
      const handler = lastPopover().on.mock.calls.find((call) => call[0] === 'closed')?.[1];

      if (typeof handler !== 'function') {
        throw new Error('popover close handler was never registered');
      }

      handler();
    };

    it('returns focus to the settings toggler when dismissal stranded it on the body', async () => {
      const block = createBlockStub();
      const trigger = document.createElement('button');

      document.body.appendChild(trigger);
      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open(asBlock(block), trigger);
      (document.activeElement as HTMLElement | null)?.blur();

      dismiss();

      expect(trigger).toHaveFocus();
      expect(settings.opened).toBe(false);
      trigger.remove();
    });

    it('never steals focus from wherever an activated item placed it', async () => {
      const block = createBlockStub();
      const trigger = document.createElement('button');
      const elsewhere = document.createElement('input');

      document.body.append(trigger, elsewhere);
      blok.BlockManager.currentBlock = asBlock(block);

      await settings.open(asBlock(block), trigger);
      elsewhere.focus();

      dismiss();

      expect(elsewhere).toHaveFocus();
      trigger.remove();
      elsewhere.remove();
    });
  });

  /* -------------------------------------------------------- menu contents */

  describe('menu contents', () => {
    const headerTool: ToolStub = {
      name: 'header',
      toolbox: [{ icon: '<svg data-icon="h1" />', title: 'Heading 1', titleKey: 'tools.header.heading1', data: { level: 1 } }],
      conversionConfig: { export: 'text', import: textImport },
    };

    const openWith = async (block: BlockStub): Promise<PopoverItemParams[]> => {
      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      return lastPopover().params.items;
    };

    const tunedBlock = (overrides: Partial<BlockStub> = {}): BlockStub => createBlockStub({
      getTunes: vi.fn(() => ({
        toolTunes: [{ name: 'tool-tune', title: 'Tool tune' }] as MenuConfigItem[],
        commonTunes: [
          { name: 'move-up', title: 'Move up' },
          { name: 'delete', title: 'Delete' },
          { name: 'copy-link', title: 'Copy link' },
        ] as MenuConfigItem[],
      })),
      ...overrides,
    });

    it('orders a single-block menu: tool tunes, convert-to, common tunes with duplicate before delete, footer', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([asTool(headerTool)]);

      const items = await openWith(tunedBlock());

      expect(itemKeys(items)).toStrictEqual([
        'tool-tune',
        'separator',
        'convert-to',
        'separator',
        'move-up',
        'duplicate',
        'delete',
        'copy-link',
        'separator',
        'edit-metadata',
      ]);
    });

    it('still builds a single-block menu when exactly one block is selected', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([asTool(headerTool)]);

      const block = tunedBlock();

      blok.BlockSelection.selectedBlocks = [asBlock(block)];

      const items = await openWith(block);

      // One selected block must not be mistaken for a multi-selection: the tool
      // tunes stay and the common tunes are not replaced by a bulk delete.
      expect(itemKeys(items)).toStrictEqual([
        'tool-tune',
        'separator',
        'convert-to',
        'separator',
        'move-up',
        'duplicate',
        'delete',
        'copy-link',
        'separator',
        'edit-metadata',
      ]);
      expect(getConvertibleToolsForBlocksMock).not.toHaveBeenCalled();
    });

    it('drops the tool-tunes section when the tool contributes none', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([asTool(headerTool)]);

      const items = await openWith(createBlockStub({
        getTunes: vi.fn(() => ({
          toolTunes: [] as MenuConfigItem[],
          commonTunes: [{ name: 'delete', title: 'Delete' }] as MenuConfigItem[],
        })),
      }));

      expect(itemKeys(items)).toStrictEqual([
        'convert-to',
        'separator',
        'duplicate',
        'delete',
        'separator',
        'edit-metadata',
      ]);
    });

    it('builds a menu with no convert section when nothing is convertible', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([]);

      const items = await openWith(createBlockStub({
        getTunes: vi.fn(() => ({ commonTunes: [{ name: 'delete', title: 'Delete' }] as MenuConfigItem[] })),
      }));

      expect(itemKeys(items)).toStrictEqual(['duplicate', 'delete', 'separator', 'edit-metadata']);
    });

    it('omits duplicate when the block offers no delete to sit beside', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([]);

      const items = await openWith(createBlockStub({
        getTunes: vi.fn(() => ({
          commonTunes: [{ name: 'move-up', title: 'Move up' }] as MenuConfigItem[],
        })),
      }));

      expect(itemKeys(items)).toStrictEqual(['move-up', 'separator', 'edit-metadata']);
    });

    it('shows only the copy-link tune and the footer in read-only mode', async () => {
      blok.ReadOnly.isEnabled = true;
      getConvertibleToolsForBlockMock.mockResolvedValue([asTool(headerTool)]);

      const items = await openWith(tunedBlock({
        getTunes: vi.fn(() => ({
          toolTunes: [{ name: 'tool-tune', title: 'Tool tune' }] as MenuConfigItem[],
          commonTunes: [
            { name: 'copy-link', title: 'Copy link' },
            { name: 'delete', title: 'Delete' },
          ] as MenuConfigItem[],
        })),
      }));

      expect(itemKeys(items)).toStrictEqual(['copy-link', 'separator', 'edit-metadata']);
      expect(getConvertibleToolsForBlockMock).not.toHaveBeenCalled();
    });

    it('replaces tool tunes and common tunes with duplicate + delete for a multi-selection', async () => {
      const first = tunedBlock();
      const second = createBlockStub();

      blok.BlockSelection.selectedBlocks = [asBlock(first), asBlock(second)];
      getConvertibleToolsForBlocksMock.mockResolvedValue([asTool(headerTool)]);

      await settings.open();

      const items = lastPopover().params.items;

      expect(itemKeys(items)).toStrictEqual([
        'convert-to',
        'separator',
        'duplicate',
        'delete',
        'separator',
        'edit-metadata',
      ]);
    });

    it('labels the convert-to entry and sizes its submenu', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([asTool(headerTool)]);

      const items = await openWith(tunedBlock());
      const convertTo = itemNamed(items, 'convert-to');

      expect(convertTo.title).toBe('popover.convertTo');
      expect((convertTo.children as { minWidth?: string }).minWidth).toBe('200px');
      expect(itemKeys(childrenOf(items, 'convert-to'))).toStrictEqual(['header']);

      const entry = itemNamed(childrenOf(items, 'convert-to'), 'header');

      // A conversion must dismiss the menu; leaving it open strands it over a
      // block that no longer exists.
      expect(entry.closeOnActivate).toBe(true);
      expect(entry.icon).toBe('<svg data-icon="h1" />');
      expect(entry.title).toBe('Heading 1');
      expect(entry.englishTitle).toBe('en(tools.header.heading1)');
    });

    it('passes the menu block through the blocks API when collecting single-block conversions', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([]);
      blok.Tools.blockTools.set('header', asTool(headerTool));

      const block = createBlockStub();

      await openWith(block);

      const [blockApi, tools] = getConvertibleToolsForBlockMock.mock.calls[0] as [{ id: string }, BlockToolAdapter[]];

      expect(blockApi.id).toBe(block.id);
      expect(tools).toStrictEqual([asTool(headerTool)]);
    });

    it('passes every selected block through the blocks API when collecting multi-block conversions', async () => {
      const first = createBlockStub();
      const second = createBlockStub();

      blok.BlockSelection.selectedBlocks = [asBlock(first), asBlock(second)];
      getConvertibleToolsForBlocksMock.mockResolvedValue([]);

      await settings.open();

      const [apis] = getConvertibleToolsForBlocksMock.mock.calls[0] as [Array<{ id: string }>];

      expect(apis.map((api) => api.id)).toStrictEqual([first.id, second.id]);
    });

    it('describes the duplicate entry with its shortcut and close-on-activate flag', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([]);

      const items = await openWith(tunedBlock());
      const duplicate = itemNamed(items, 'duplicate');

      expect(duplicate.title).toBe('blockSettings.duplicate');
      expect(duplicate.secondaryLabel).toBe(beautifyShortcut('CMD+D'));
      expect(duplicate.closeOnActivate).toBe(true);
    });

    it('describes the multi-block delete entry as destructive with its shortcut', async () => {
      blok.BlockSelection.selectedBlocks = [asBlock(createBlockStub()), asBlock(createBlockStub())];
      getConvertibleToolsForBlocksMock.mockResolvedValue([]);

      await settings.open();

      const remove = itemNamed(lastPopover().params.items, 'delete');

      expect(remove.title).toBe('blockSettings.delete');
      expect(remove.isDestructive).toBe(true);
      expect(remove.closeOnActivate).toBe(true);
      expect(remove.secondaryLabel).toBe(beautifyShortcut('DELETE'));
    });
  });

  /* ------------------------------------------------------------ duplicate */

  describe('duplicate', () => {
    const duplicateBlock = (): BlockStub => createBlockStub({
      getTunes: vi.fn(() => ({ commonTunes: [{ name: 'delete', title: 'Delete' }] as MenuConfigItem[] })),
    });

    it('duplicates the menu block and closes the toolbar, leaving the selection alone', async () => {
      const block = duplicateBlock();

      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      await activatable(lastPopover().params.items, 'duplicate').onActivate({});

      expect(blok.BlockSelection.clearSelection).not.toHaveBeenCalled();
      expect(blok.DragManager?.duplicateBlocksInPlace.mock.calls[0][0]).toBe(asBlock(block));
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('re-selects the captured group before duplicating a multi-selection', async () => {
      const first = createBlockStub();
      const second = createBlockStub();

      blok.BlockSelection.selectedBlocks = [asBlock(first), asBlock(second)];
      getConvertibleToolsForBlocksMock.mockResolvedValue([]);

      await settings.open();

      // The document mousedown behind a popover click clears the live selection
      // before onActivate runs; the captured group must survive that.
      blok.BlockSelection.selectedBlocks = [];

      await activatable(lastPopover().params.items, 'duplicate').onActivate({});

      expect(blok.BlockSelection.clearSelection).toHaveBeenCalledTimes(1);
      expect(blok.BlockSelection.selectBlock.mock.calls.map((call) => call[0])).toStrictEqual([
        asBlock(first),
        asBlock(second),
      ]);
      expect(blok.DragManager?.duplicateBlocksInPlace.mock.calls[0][0]).toBe(asBlock(first));
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('still closes the toolbar when no drag manager is wired up', async () => {
      const block = duplicateBlock();

      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      blok.DragManager = undefined;

      expect(() => activatable(lastPopover().params.items, 'duplicate').onActivate({})).not.toThrow();
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });
  });

  /* --------------------------------------------------------- multi delete */

  describe('multi-block delete', () => {
    const openMulti = async (): Promise<{ first: BlockStub; second: BlockStub }> => {
      const first = createBlockStub();
      const second = createBlockStub();

      blok.BlockSelection.selectedBlocks = [asBlock(first), asBlock(second)];
      getConvertibleToolsForBlocksMock.mockResolvedValue([]);
      await settings.open();

      return { first, second };
    };

    it('places the caret at the end of the replacement block and closes the toolbar', async () => {
      await openMulti();

      const replacement = createBlockStub();

      blok.BlockManager.deleteSelectedBlocksAndInsertReplacement.mockReturnValue(asBlock(replacement));

      await activatable(lastPopover().params.items, 'delete').onActivate({});

      expect(blok.Caret.setToBlock).toHaveBeenCalledTimes(1);
      expect(blok.Caret.setToBlock.mock.calls[0][0]).toBe(asBlock(replacement));
      expect(blok.Caret.setToBlock.mock.calls[0][1]).toBe('end');
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('restores the caret into the shared nested container when no replacement was inserted', async () => {
      const container = document.createElement('div');

      container.setAttribute(DATA_ATTR.nestedBlocks, '');
      document.body.appendChild(container);

      const inside = createBlockStub();
      const alsoInside = createBlockStub();
      const outside = createBlockStub();

      inside.selected = true;
      alsoInside.selected = true;
      outside.selected = false;
      inside.holder.setAttribute(DATA_ATTR.element, '');
      alsoInside.holder.setAttribute(DATA_ATTR.element, '');
      container.append(inside.holder, alsoInside.holder);
      document.body.appendChild(outside.holder);

      const survivor = createBlockStub();

      blok.BlockManager.blocks = [asBlock(inside), asBlock(alsoInside), asBlock(outside)];
      blok.BlockManager.getBlock.mockReturnValue(asBlock(survivor));
      blok.BlockManager.deleteSelectedBlocksAndInsertReplacement.mockReturnValue(null);

      await openMulti();

      await activatable(lastPopover().params.items, 'delete').onActivate({});

      await nextFrame();

      expect(blok.BlockManager.getBlock.mock.calls[0][0]).toBe(inside.holder);
      expect(blok.Caret.setToBlock).toHaveBeenCalledTimes(1);
      expect(blok.Caret.setToBlock.mock.calls[0][0]).toBe(asBlock(survivor));
      expect(blok.Caret.setToBlock.mock.calls[0][1]).toBe('start');

      container.remove();
      outside.holder.remove();
    });
  });

  /* -------------------------------------------------- turn into columns */

  describe('turn into columns', () => {
    const openMulti = async (): Promise<{ first: BlockStub; second: BlockStub }> => {
      const first = createBlockStub();
      const second = createBlockStub();

      blok.BlockSelection.selectedBlocks = [asBlock(first), asBlock(second)];
      getConvertibleToolsForBlocksMock.mockResolvedValue([]);
      await settings.open();

      return { first, second };
    };

    it('offers the columns entry only for a multi-selection', async () => {
      const { first, second } = await openMulti();
      const entry = itemNamed(childrenOf(lastPopover().params.items, 'convert-to'), 'turn-into-columns');

      expect(entry.title).toBe('toolNames.columns');
      expect(entry.closeOnActivate).toBe(true);

      settings.close();
      blok.BlockSelection.selectedBlocks = [];
      getConvertibleToolsForBlockMock.mockResolvedValue([asTool({
        name: 'header',
        toolbox: [{ icon: '<svg />', title: 'Heading' }],
        conversionConfig: { export: 'text', import: textImport },
      })]);

      const single = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(single);
      await settings.open(asBlock(single));

      expect(itemKeys(childrenOf(lastPopover().params.items, 'convert-to'))).toStrictEqual(['header']);
      expect([first.id, second.id]).toHaveLength(2);
    });

    it('wraps the captured selection ids and lands the caret in the first column', async () => {
      const { first, second } = await openMulti();
      const landing = createBlockStub();

      // The live selection is already gone by the time the item is activated.
      blok.BlockSelection.selectedBlocks = [];
      wrapBlocksInColumnsMock.mockReturnValue('list-1');
      blok.API.methods.blocks.getChildren.mockImplementation((id: string) => {
        if (id === 'list-1') {
          return [{ id: 'column-1' }];
        }

        return id === 'column-1' ? [{ id: 'child-1' }] : [];
      });
      blok.BlockManager.getBlockById.mockReturnValue(asBlock(landing));

      await activatable(childrenOf(lastPopover().params.items, 'convert-to'), 'turn-into-columns').onActivate({});

      expect(wrapBlocksInColumnsMock.mock.calls[0][0]).toBe(blok.API.methods);
      expect(wrapBlocksInColumnsMock.mock.calls[0][1]).toStrictEqual([first.id, second.id]);
      expect(blok.BlockManager.getBlockById).toHaveBeenCalledWith('child-1');
      expect(blok.Caret.setToBlock).toHaveBeenCalledTimes(1);
      expect(blok.Caret.setToBlock.mock.calls[0][0]).toBe(asBlock(landing));
      expect(blok.Caret.setToBlock.mock.calls[0][1]).toBe('start');
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('closes the toolbar and looks no further when the wrap is refused', async () => {
      await openMulti();
      wrapBlocksInColumnsMock.mockReturnValue(null);

      await activatable(childrenOf(lastPopover().params.items, 'convert-to'), 'turn-into-columns').onActivate({});

      expect(blok.API.methods.blocks.getChildren).not.toHaveBeenCalled();
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('closes the toolbar without a caret when the new list has no children yet', async () => {
      await openMulti();
      wrapBlocksInColumnsMock.mockReturnValue('list-1');
      blok.API.methods.blocks.getChildren.mockReturnValue([]);

      expect(() => activatable(childrenOf(lastPopover().params.items, 'convert-to'), 'turn-into-columns').onActivate({}))
        .not.toThrow();
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------- conversions */

  describe('conversions', () => {
    const textTool: ToolStub = {
      name: 'text',
      toolbox: [{ icon: '<svg data-icon="text" />', title: 'Text' }],
      conversionConfig: { export: 'text', import: textImport },
    };

    const listTool: ToolStub = {
      name: 'list',
      toolbox: [{ icon: '<svg data-icon="list" />', title: 'List', data: { style: 'ordered' } }],
      conversionConfig: { export: 'text', import: listImport },
    };

    /** Registry entry for the tools the fixture blocks are made of. */
    const registerBlockTool = (name: string, tool: ToolStub = { name, conversionConfig: { export: 'text' } }): void => {
      blok.Tools.blockTools.set(name, asTool(tool));
    };

    const openSingleWith = async (tools: ToolStub[], block: BlockStub): Promise<PopoverItemParams[]> => {
      getConvertibleToolsForBlockMock.mockResolvedValue(tools.map(asTool));
      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      return lastPopover().params.items;
    };

    const openMultiWith = async (tools: ToolStub[], blocks: BlockStub[]): Promise<PopoverItemParams[]> => {
      getConvertibleToolsForBlocksMock.mockResolvedValue(tools.map(asTool));
      blok.BlockSelection.selectedBlocks = blocks.map(asBlock);
      await settings.open();

      return lastPopover().params.items;
    };

    beforeEach(() => {
      registerBlockTool('paragraph');
    });

    it('converts one block with the activated entry tool and its toolbox data, then closes the toolbar', async () => {
      const editable = document.createElement('div');

      editable.setAttribute('contenteditable', 'true');
      editable.textContent = 'hello world';
      document.body.appendChild(editable);

      const range = document.createRange();
      const textNode = editable.firstChild;

      if (textNode !== null) {
        range.setStart(textNode, 3);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }

      const converted = createBlockStub();

      blok.BlockManager.convert.mockResolvedValue(asBlock(converted));

      const headerTool: ToolStub = {
        name: 'header',
        toolbox: [{ icon: '<svg />', title: 'Heading 1', data: { level: 1 } }],
        conversionConfig: { export: 'text', import: textImport },
      };
      const block = createBlockStub();
      const items = await openSingleWith([textTool, headerTool], block);

      await activatable(childrenOf(items, 'convert-to'), 'header').onActivate({});

      // The SECOND tool must win — the entry names the tool, not its position.
      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(1);
      expect(blok.BlockManager.convert.mock.calls[0][0]).toBe(asBlock(block));
      expect(blok.BlockManager.convert.mock.calls[0][1]).toBe('header');
      expect(blok.BlockManager.convert.mock.calls[0][2]).toStrictEqual({ level: 1 });
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
      // The caret offset captured before the block was highlighted is restored.
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(asBlock(converted), 'default', 3);

      window.getSelection()?.removeAllRanges();
      editable.remove();
    });

    it('places no caret when the conversion produced nothing', async () => {
      blok.BlockManager.convert.mockResolvedValue(null);

      const items = await openSingleWith([textTool], createBlockStub());

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('converts every selected block separately and lands the caret at the end of the last one', async () => {
      const first = createBlockStub();
      const second = createBlockStub();
      const firstConverted = createBlockStub();
      const secondConverted = createBlockStub();

      registerBlockTool('text', textTool);
      blok.BlockManager.convert
        .mockResolvedValueOnce(asBlock(firstConverted))
        .mockResolvedValueOnce(asBlock(secondConverted));

      const items = await openMultiWith([textTool], [first, second]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(2);
      expect(blok.BlockManager.convert.mock.calls[0][0]).toBe(asBlock(first));
      expect(blok.BlockManager.convert.mock.calls[1][0]).toBe(asBlock(second));
      // Each block becomes its own block, so none may adopt a following section.
      expect(blok.BlockManager.convert.mock.calls[0][3]).toStrictEqual({ skipSectionAdoption: true });
      expect(blok.BlockManager.replace).not.toHaveBeenCalled();
      // A multi-block conversion has no caret offset to preserve.
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(asBlock(secondConverted), 'end');
    });

    it('merges the selection into one block when the target tool accepts multi-line content', async () => {
      const first = createBlockStub({ exportDataAsString: vi.fn(async () => 'alpha') });
      const second = createBlockStub({ exportDataAsString: vi.fn(async () => 'beta') });
      const merged = createBlockStub();

      registerBlockTool('list', listTool);
      blok.BlockManager.replace.mockReturnValue(asBlock(merged));

      const items = await openMultiWith([listTool], [first, second]);

      await activatable(childrenOf(items, 'convert-to'), 'list').onActivate({});

      expect(blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(blok.BlockManager.replace).toHaveBeenCalledTimes(1);
      expect(blok.BlockManager.replace.mock.calls[0][0]).toBe(asBlock(first));
      expect(blok.BlockManager.replace.mock.calls[0][1]).toBe('list');
      // Exports joined with newlines, then the toolbox data merged on top.
      expect(blok.BlockManager.replace.mock.calls[0][2]).toStrictEqual({
        items: [{ content: 'alpha' }, { content: 'beta' }],
        style: 'ordered',
      });
      // Only the blocks folded into the first one are removed.
      expect(blok.BlockManager.removeBlock).toHaveBeenCalledTimes(1);
      expect(blok.BlockManager.removeBlock.mock.calls[0][0]).toBe(asBlock(second));
      expect(blok.BlockManager.removeBlock.mock.calls[0][1]).toBe(false);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(asBlock(merged), 'end');
    });

    it('abandons the merge when not one block could export itself', async () => {
      const failing = (): BlockStub => createBlockStub({
        exportDataAsString: vi.fn(async () => {
          throw new Error('cannot export');
        }),
      });

      registerBlockTool('list', listTool);

      const items = await openMultiWith([listTool], [failing(), failing()]);

      await activatable(childrenOf(items, 'convert-to'), 'list').onActivate({});

      expect(blok.BlockManager.replace).not.toHaveBeenCalled();
      expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
    });

    it('converts separately when the target tool import yields a single item', async () => {
      const singleItemTool: ToolStub = {
        name: 'quote',
        toolbox: [{ icon: '<svg />', title: 'Quote' }],
        conversionConfig: { export: 'text', import: (content: string) => ({ items: [{ content }] }) },
      };

      registerBlockTool('quote', singleItemTool);
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      const items = await openMultiWith([singleItemTool], [createBlockStub(), createBlockStub()]);

      await activatable(childrenOf(items, 'convert-to'), 'quote').onActivate({});

      expect(blok.BlockManager.replace).not.toHaveBeenCalled();
      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(2);
    });

    it('converts separately when the target tool import throws on the probe', async () => {
      const throwingTool: ToolStub = {
        name: 'broken',
        toolbox: [{ icon: '<svg />', title: 'Broken' }],
        conversionConfig: {
          export: 'text',
          import: () => {
            throw new Error('import blew up');
          },
        },
      };

      registerBlockTool('broken', throwingTool);
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      const items = await openMultiWith([throwingTool], [createBlockStub(), createBlockStub()]);

      await activatable(childrenOf(items, 'convert-to'), 'broken').onActivate({});

      expect(blok.BlockManager.replace).not.toHaveBeenCalled();
      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(2);
    });

    it('converts separately when the target tool has no import at all', async () => {
      const noImportTool: ToolStub = {
        name: 'plain',
        toolbox: [{ icon: '<svg />', title: 'Plain' }],
        conversionConfig: { export: 'text' },
      };

      registerBlockTool('plain', noImportTool);
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      const items = await openMultiWith([noImportTool], [createBlockStub(), createBlockStub()]);

      await activatable(childrenOf(items, 'convert-to'), 'plain').onActivate({});

      expect(blok.BlockManager.replace).not.toHaveBeenCalled();
      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(2);
    });

    it('leaves a block nested under another selected block to ride with its container', async () => {
      const container = createBlockStub();
      const nested = createBlockStub();

      nested.parentId = container.id;
      registerBlockTool('text', textTool);
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      const items = await openMultiWith([textTool], [container, nested]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(1);
      expect(blok.BlockManager.convert.mock.calls[0][0]).toBe(asBlock(container));
      // One block left standing means nothing can steal a following section.
      expect(blok.BlockManager.convert.mock.calls[0][3]).toStrictEqual({ skipSectionAdoption: false });
    });

    it('still converts a block whose parent is outside the selection', async () => {
      const nested = createBlockStub();
      const sibling = createBlockStub();

      nested.parentId = 'a-block-nobody-selected';
      registerBlockTool('text', textTool);
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      const items = await openMultiWith([textTool], [nested, sibling]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(2);
    });

    it('skips a selected block whose tool refuses to export', async () => {
      const convertible = createBlockStub();
      const stubborn = createBlockStub({ name: 'image' });

      registerBlockTool('image', { name: 'image' });
      registerBlockTool('text', textTool);
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      const items = await openMultiWith([textTool], [convertible, stubborn]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(1);
      expect(blok.BlockManager.convert.mock.calls[0][0]).toBe(asBlock(convertible));
    });

    it('converts a selected block whose tool is not in the registry', async () => {
      const known = createBlockStub();
      const unknown = createBlockStub({ name: 'third-party' });

      registerBlockTool('text', textTool);
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      const items = await openMultiWith([textTool], [known, unknown]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(2);
      expect(blok.BlockManager.convert.mock.calls[1][0]).toBe(asBlock(unknown));
    });

    it('converts nothing when every selected block refuses to export', async () => {
      registerBlockTool('image', { name: 'image' });
      registerBlockTool('text', textTool);

      const items = await openMultiWith([textTool], [
        createBlockStub({ name: 'image' }),
        createBlockStub({ name: 'image' }),
      ]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(blok.BlockManager.replace).not.toHaveBeenCalled();
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
    });

    it('warns about a failing conversion and keeps the caret on the last success', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const first = createBlockStub();
      const second = createBlockStub();
      const converted = createBlockStub();

      registerBlockTool('text', textTool);
      blok.BlockManager.convert
        .mockResolvedValueOnce(asBlock(converted))
        .mockRejectedValueOnce(new Error('conversion exploded'));

      const items = await openMultiWith([textTool], [first, second]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(second.id);
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(asBlock(converted), 'end');
    });

    it('places no caret when a later conversion produced nothing', async () => {
      const converted = createBlockStub();

      registerBlockTool('text', textTool);
      blok.BlockManager.convert
        .mockResolvedValueOnce(asBlock(converted))
        .mockResolvedValueOnce(null);

      const items = await openMultiWith([textTool], [createBlockStub(), createBlockStub()]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.Caret.setToBlock).toHaveBeenCalledTimes(1);
      expect(blok.Caret.setToBlock.mock.calls[0][0]).toBe(asBlock(converted));
    });

    it('places no caret when no conversion succeeded at all', async () => {
      registerBlockTool('text', textTool);
      blok.BlockManager.convert.mockResolvedValue(null);

      const items = await openMultiWith([textTool], [createBlockStub(), createBlockStub()]);

      await activatable(childrenOf(items, 'convert-to'), 'text').onActivate({});

      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------- exploding multi-item blocks */

  describe('exploding a multi-item block', () => {
    const textTool: ToolStub = {
      name: 'text',
      toolbox: [{ icon: '<svg data-icon="text" />', title: 'Text' }],
      conversionConfig: { export: 'text', import: textImport },
    };

    const explodable = (items: unknown[]): BlockStub => createBlockStub({
      data: Promise.resolve({ items } as unknown as BlockToolData),
    });

    const explode = async (block: BlockStub, tool: ToolStub = textTool): Promise<void> => {
      getConvertibleToolsForBlockMock.mockResolvedValue([asTool(tool)]);
      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      await activatable(childrenOf(lastPopover().params.items, 'convert-to'), tool.name).onActivate({});
    };

    it('turns every item, nested ones included, into its own block after the original is removed', async () => {
      const inserted = [createBlockStub(), createBlockStub(), createBlockStub()];

      blok.Tools.blockTools.set('text', asTool(textTool));
      blok.BlockManager.getBlockIndex.mockReturnValue(5);
      blok.BlockManager.insert
        .mockReturnValueOnce(asBlock(inserted[0]))
        .mockReturnValueOnce(asBlock(inserted[1]))
        .mockReturnValueOnce(asBlock(inserted[2]));

      const block = explodable([
        { content: 'alpha', items: [{ content: 'beta' }] },
        null,
        undefined,
        'a bare string',
        { content: '' },
        { items: [] },
        { content: 'gamma' },
      ]);

      await explode(block);

      expect(blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(blok.BlockManager.removeBlock).toHaveBeenCalledTimes(1);
      expect(blok.BlockManager.removeBlock.mock.calls[0][0]).toBe(asBlock(block));
      expect(blok.BlockManager.removeBlock.mock.calls[0][1]).toBe(false);
      expect(blok.BlockManager.insert.mock.calls.map((call) => call[0])).toStrictEqual([
        { tool: 'text', data: { text: 'alpha' }, index: 5, needToFocus: false },
        { tool: 'text', data: { text: 'beta' }, index: 6, needToFocus: false },
        { tool: 'text', data: { text: 'gamma' }, index: 7, needToFocus: false },
      ]);
      expect(blok.Caret.setToBlock.mock.calls[0][0]).toBe(asBlock(inserted[2]));
    });

    it('merges the toolbox data of the entry into every created block', async () => {
      const stylishTool: ToolStub = {
        name: 'header',
        toolbox: [{ icon: '<svg />', title: 'Heading 2', data: { level: 2 } }],
        conversionConfig: { export: 'text', import: textImport },
      };

      blok.Tools.blockTools.set('header', asTool(stylishTool));
      blok.BlockManager.getBlockIndex.mockReturnValue(0);

      await explode(explodable([{ content: 'one' }, { content: 'two' }]), stylishTool);

      expect(blok.BlockManager.insert.mock.calls.map((call) => call[0])).toStrictEqual([
        { tool: 'header', data: { text: 'one', level: 2 }, index: 0, needToFocus: false },
        { tool: 'header', data: { text: 'two', level: 2 }, index: 1, needToFocus: false },
      ]);
    });

    it('supports a string-shaped conversion import', async () => {
      const stringImportTool: ToolStub = {
        name: 'note',
        toolbox: [{ icon: '<svg />', title: 'Note' }],
        conversionConfig: { export: 'text', import: 'body' },
      };

      blok.Tools.blockTools.set('note', asTool(stringImportTool));
      blok.BlockManager.getBlockIndex.mockReturnValue(0);

      await explode(explodable([{ content: 'one' }, { content: 'two' }]), stringImportTool);

      expect(blok.BlockManager.insert.mock.calls.map((call) => call[0])).toStrictEqual([
        { tool: 'note', data: { body: 'one' }, index: 0, needToFocus: false },
        { tool: 'note', data: { body: 'two' }, index: 1, needToFocus: false },
      ]);
    });

    it('converts normally when the block holds a single item', async () => {
      blok.Tools.blockTools.set('text', asTool(textTool));
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      await explode(explodable([{ content: 'only' }]));

      expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
      expect(blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(1);
    });

    it('converts normally when the block holds no items array', async () => {
      blok.Tools.blockTools.set('text', asTool(textTool));
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      await explode(createBlockStub({ data: Promise.resolve({ text: 'plain' }) }));

      expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(1);
    });

    it('converts normally when the block data cannot be read', async () => {
      const rejected: Promise<BlockToolData> = Promise.reject(new Error('data unavailable'));

      // Claim the rejection now; the module still awaits and catches it.
      rejected.catch(() => undefined);

      blok.Tools.blockTools.set('text', asTool(textTool));
      blok.BlockManager.convert.mockResolvedValue(asBlock(createBlockStub()));

      await explode(createBlockStub({ data: rejected }));

      expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
      expect(blok.BlockManager.convert).toHaveBeenCalledTimes(1);
    });

    it('destroys nothing when every item turns out to be empty', async () => {
      blok.Tools.blockTools.set('text', asTool(textTool));

      await explode(explodable([{ content: '' }, { content: '' }]));

      expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
      expect(blok.BlockManager.insert).not.toHaveBeenCalled();
      expect(blok.BlockManager.convert).not.toHaveBeenCalled();
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
    });

    it('destroys nothing when the target tool is missing from the registry', async () => {
      await explode(explodable([{ content: 'one' }, { content: 'two' }]));

      expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
      expect(blok.BlockManager.insert).not.toHaveBeenCalled();
    });

    it('destroys nothing when the registered target tool has no conversion config', async () => {
      blok.Tools.blockTools.set('text', asTool({ name: 'text' }));

      await explode(explodable([{ content: 'one' }, { content: 'two' }]));

      expect(blok.BlockManager.removeBlock).not.toHaveBeenCalled();
      expect(blok.BlockManager.insert).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------ metadata footer */

  describe('last edited footer', () => {
    const timestamp = Date.UTC(2026, 8, 5, 12, 0);

    const footerOf = async (block: BlockStub): Promise<HTMLElement> => {
      getConvertibleToolsForBlockMock.mockResolvedValue([]);
      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      const element = itemNamed(lastPopover().params.items, 'edit-metadata').element;

      if (!(element instanceof HTMLElement)) {
        throw new Error('the footer item carries no element');
      }

      return element;
    };

    it('labels the footer and formats the edit date followed by the short time', async () => {
      const footer = await footerOf(createBlockStub({ lastEditedAt: timestamp }));
      const label = footer.querySelector('[data-edit-meta-label]');
      const date = new Date(timestamp);
      const expectedDate = new Intl.DateTimeFormat('en', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(date);
      const expectedTime = new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(date);

      expect(label?.textContent).toBe('blockSettings.lastEdited');
      // A bare marker hook: styling and tests select it by presence, so it must
      // stay valueless rather than pick up content of its own.
      expect(label?.getAttribute('data-edit-meta-label')).toBe('');
      expect(footer.lastElementChild?.textContent).toBe(`${expectedDate}, ${expectedTime}`);
    });

    it('drops an abbreviation suffix but keeps a meaningful trailing character', async () => {
      blok.I18n.getLocale.mockReturnValue('ru');

      const russian = await footerOf(createBlockStub({ lastEditedAt: timestamp }));

      expect(russian.lastElementChild?.textContent).not.toContain('г.');

      settings.close();
      blok.I18n.getLocale.mockReturnValue('ja');

      const japanese = await footerOf(createBlockStub({ lastEditedAt: timestamp }));

      // 日 is part of the date, not an abbreviation dot — it must survive.
      expect(japanese.lastElementChild?.textContent).toContain('日');
    });

    it('falls back to the block creation time when nothing was ever edited', async () => {
      const created = Date.UTC(2020, 0, 15, 9, 0);
      const footer = await footerOf(createBlockStub({ createdAt: created }));
      const expectedDate = new Intl.DateTimeFormat('en', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(created));

      expect(footer.lastElementChild?.textContent).toContain(expectedDate);
    });

    it('resolves the last editor into the label when a resolver is configured', async () => {
      const resolveUser = vi.fn(async () => ({ id: 'u1', name: 'Ada' }));

      Object.assign(config, { resolveUser });

      const footer = await footerOf(createBlockStub({ lastEditedBy: 'u1', lastEditedAt: timestamp }));

      await nextTick();

      expect(resolveUser).toHaveBeenCalledWith('u1');
      expect(footer.querySelector('[data-edit-meta-label]')?.textContent)
        .toBe('blockSettings.lastEditedBy:{"name":"Ada"}');
    });

    it('keeps the generic label when there is an editor but no resolver', async () => {
      const footer = await footerOf(createBlockStub({ lastEditedBy: 'u1', lastEditedAt: timestamp }));

      await nextTick();

      expect(settings.opened).toBe(true);
      expect(footer.querySelector('[data-edit-meta-label]')?.textContent).toBe('blockSettings.lastEdited');
    });

    it('keeps the generic label when a resolver exists but the block has no editor', async () => {
      const resolveUser = vi.fn(async () => ({ id: 'u1', name: 'Ada' }));

      Object.assign(config, { resolveUser });

      const footer = await footerOf(createBlockStub({ lastEditedAt: timestamp }));

      await nextTick();

      expect(resolveUser).not.toHaveBeenCalled();
      expect(footer.querySelector('[data-edit-meta-label]')?.textContent).toBe('blockSettings.lastEdited');
    });
  });

  /* -------------------------------------------------------- Delete key */

  describe('Delete shortcut', () => {
    const openWithDelete = async (onDelete: Mock<() => void>): Promise<HTMLElement> => {
      getConvertibleToolsForBlockMock.mockResolvedValue([]);

      const block = createBlockStub({
        getTunes: vi.fn(() => ({
          commonTunes: [{ name: 'delete', title: 'Delete', onActivate: onDelete }] as MenuConfigItem[],
        })),
      });

      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      return lastPopover().getElement();
    };

    it('runs the delete tune and closes the menu when Delete is pressed inside the popover', async () => {
      const onDelete = vi.fn();
      const element = await openWithDelete(onDelete);
      const event = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });

      element.dispatchEvent(event);

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(settings.opened).toBe(false);
    });

    it('ignores every other key', async () => {
      const onDelete = vi.fn();
      const element = await openWithDelete(onDelete);

      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }));

      expect(onDelete).not.toHaveBeenCalled();
      expect(settings.opened).toBe(true);
    });

    it('leaves Delete untouched when the menu offers no delete tune', async () => {
      getConvertibleToolsForBlockMock.mockResolvedValue([]);

      const block = createBlockStub();

      blok.BlockManager.currentBlock = asBlock(block);
      await settings.open(asBlock(block));

      const event = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });

      lastPopover().getElement().dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(settings.opened).toBe(true);
    });

    it('stops listening for Delete once the menu is closed', async () => {
      const onDelete = vi.fn();
      const element = await openWithDelete(onDelete);

      settings.close();
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', cancelable: true }));

      expect(onDelete).not.toHaveBeenCalled();
    });
  });
});

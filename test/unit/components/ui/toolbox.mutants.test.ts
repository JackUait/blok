import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Toolbox, ToolboxEvent } from '../../../../src/components/ui/toolbox';
import { BlokMobileLayoutToggled } from '../../../../src/components/events';
import { DATA_ATTR } from '../../../../src/components/constants';
import { beautifyShortcut } from '../../../../src/components/utils';
import { Shortcuts } from '../../../../src/components/utils/shortcuts';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { ToolsCollection } from '../../../../src/components/tools/collection';
import type { API, BlockAPI, BlockToolData, ToolboxConfigEntry } from '@/types';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';

/**
 * Shape the Toolbox actually hands to the popover. The published union needs a
 * narrowing per branch; these assertions only ever read fields, so one
 * structural view keeps every expectation free of casts at the call site.
 */
type CapturedItem = {
  name?: string;
  title?: string;
  icon?: string;
  secondaryLabel?: string;
  englishTitle?: string;
  searchTerms?: string[];
  type?: string;
  element?: HTMLElement;
  onActivate?: () => void;
};

const popoverSpies = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn<(event: PopoverEvent, handler: () => void) => void>(),
  off: vi.fn<(event: PopoverEvent, handler: () => void) => void>(),
  hasFocus: vi.fn(() => false),
  filterItems: vi.fn<(query: string) => void>(),
  toggleItemHiddenByName: vi.fn<(name: string, isHidden: boolean) => void>(),
  updatePosition: vi.fn<(rect: DOMRect, update: Record<string, unknown>) => void>(),
  setLeftAlignElement: vi.fn(),
  setActiveDescendantHost: vi.fn(),
}));

const popoverState = vi.hoisted((): {
  items: unknown[];
  params: Record<string, unknown>;
  element: HTMLElement | null;
  constructions: number;
} => ({
  items: [],
  params: {},
  element: null,
  constructions: 0,
}));

const screenState = vi.hoisted(() => ({ mobile: false }));
const selectionState = vi.hoisted(() => ({ rect: undefined as DOMRect | undefined }));

/**
 * PopoverMobile deliberately implements NONE of setLeftAlignElement,
 * setActiveDescendantHost or updatePosition — those live on PopoverDesktop only.
 * The Toolbox guards every one of them with an `in` / instanceof check, so a
 * mobile double that copied the desktop surface would make those guards
 * untestable.
 */
vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    private readonly el: HTMLElement = document.createElement('div');

    public constructor(params: Record<string, unknown>) {
      popoverState.items = (params.items as unknown[]) ?? [];
      popoverState.params = params;
      popoverState.element = this.el;
      popoverState.constructions += 1;
    }

    public getElement = (): HTMLElement => this.el;
    public show = popoverSpies.show;
    public hide = popoverSpies.hide;
    public destroy = popoverSpies.destroy;
    public on = popoverSpies.on;
    public off = popoverSpies.off;
    public hasFocus = popoverSpies.hasFocus;
    public filterItems = popoverSpies.filterItems;
    public toggleItemHiddenByName = popoverSpies.toggleItemHiddenByName;
    public updatePosition = popoverSpies.updatePosition;
    public setLeftAlignElement = popoverSpies.setLeftAlignElement;
    public setActiveDescendantHost = popoverSpies.setActiveDescendantHost;
  }

  class MockPopoverMobile {
    private readonly el: HTMLElement = document.createElement('div');

    public constructor(params: Record<string, unknown>) {
      popoverState.items = (params.items as unknown[]) ?? [];
      popoverState.params = params;
      popoverState.element = this.el;
      popoverState.constructions += 1;
    }

    public getElement = (): HTMLElement => this.el;
    public show = popoverSpies.show;
    public hide = popoverSpies.hide;
    public destroy = popoverSpies.destroy;
    public on = popoverSpies.on;
    public off = popoverSpies.off;
    public hasFocus = popoverSpies.hasFocus;
    public filterItems = popoverSpies.filterItems;
    public toggleItemHiddenByName = popoverSpies.toggleItemHiddenByName;
  }

  return {
    PopoverDesktop: MockPopoverDesktop,
    PopoverMobile: MockPopoverMobile,
  };
});

vi.mock('../../../../src/components/utils/shortcuts', () => ({
  Shortcuts: {
    add: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('../../../../src/components/utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../src/components/utils');

  return {
    ...actual,
    isMobileScreen: vi.fn(() => screenState.mobile),
  };
});

vi.mock('../../../../src/components/selection', () => ({
  SelectionUtils: {
    get rect(): DOMRect | undefined {
      return selectionState.rect;
    },
  },
}));

const I18N_LABELS: Record<'filter' | 'nothingFound' | 'slashSearchPlaceholder', string> = {
  filter: 'Filter',
  nothingFound: 'Nothing found',
  slashSearchPlaceholder: 'Type to search',
};

/**
 * ToolsCollection double. Map.prototype.forEach cannot simply be bound here:
 * the Toolbox calls it with a (value, key, map) callback.
 * @param entries - tool name / adapter pairs
 */
const createToolsCollection = (entries: [string, BlockToolAdapter][]): ToolsCollection<BlockToolAdapter> => {
  const map = new Map<string, BlockToolAdapter>(entries);

  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: BlockToolAdapter) => map.set(key, value),
    has: (key: string) => map.has(key),
    delete: (key: string) => map.delete(key),
    get size(): number {
      return map.size;
    },
    keys: () => map.keys(),
    values: () => map.values(),
    entries: () => map.entries(),
    forEach: (callback: (value: BlockToolAdapter, key: string, source: Map<string, BlockToolAdapter>) => void) => {
      for (const [key, value] of map.entries()) {
        callback(value, key, map);
      }
    },
    [Symbol.iterator]: () => map[Symbol.iterator](),
  } as unknown as ToolsCollection<BlockToolAdapter>;
};

/**
 * Declares a tool adapter for the collection.
 * @param name - registration name
 * @param toolbox - the tool's toolbox config (entry or entries)
 * @param extra - sanitizeConfig / shortcut / searchTerms overrides
 */
const createTool = (
  name: string,
  toolbox: ToolboxConfigEntry | ToolboxConfigEntry[] | undefined,
  extra: Record<string, unknown> = {}
): BlockToolAdapter => ({
  name,
  toolbox,
  ...extra,
} as unknown as BlockToolAdapter);

/**
 * The text nodes a fixture's contentEditable should be built from. A list keeps
 * the strip walker honest: a single node cannot exercise its offset bookkeeping.
 * @param text - one string, several, or nothing
 */
const toTextChunks = (text: string | string[] | undefined): string[] => {
  if (text === undefined) {
    return [''];
  }

  return Array.isArray(text) ? text : [text];
};

/**
 * A block whose holder carries the DOM the Toolbox reads: the content wrapper it
 * anchors against and the contentEditable it runs slash search on.
 *
 * `text` may be a list, which becomes one Text node per entry — the strip path
 * walks text nodes, and a single-node fixture cannot exercise its bookkeeping.
 * @param options - fixture shape
 * @param options.text - contentEditable text, split across nodes when a list
 */
const createBlock = (options: {
  id?: string;
  name?: string;
  isEmpty?: boolean;
  text?: string | string[];
  parentId?: string | null;
  editable?: boolean;
  contentWrapper?: boolean;
  insideTableCell?: boolean;
  holderRect?: DOMRect;
  contentRect?: DOMRect;
} = {}): { block: BlockAPI; holder: HTMLElement; editable: HTMLElement } => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const editable = document.createElement('div');

  content.setAttribute(DATA_ATTR.elementContent, '');
  editable.setAttribute('contenteditable', 'true');

  const chunks = toTextChunks(options.text);

  for (const chunk of chunks) {
    editable.appendChild(document.createTextNode(chunk));
  }

  if (options.editable !== false) {
    content.appendChild(editable);
  }

  if (options.contentWrapper === false) {
    holder.appendChild(editable);
  } else {
    holder.appendChild(content);
  }

  if (options.holderRect !== undefined) {
    const holderRect = options.holderRect;

    holder.getBoundingClientRect = (): DOMRect => holderRect;
  }

  if (options.contentRect !== undefined) {
    const contentRect = options.contentRect;

    content.getBoundingClientRect = (): DOMRect => contentRect;
  }

  if (options.insideTableCell === true) {
    const cell = document.createElement('div');

    cell.setAttribute('data-blok-table-cell-blocks', '');
    cell.appendChild(holder);
    document.body.appendChild(cell);
  } else {
    document.body.appendChild(holder);
  }

  const block = {
    id: options.id ?? 'block-1',
    name: options.name ?? 'testTool',
    isEmpty: options.isEmpty ?? true,
    parentId: options.parentId ?? null,
    holder,
  } as unknown as BlockAPI;

  return { block,
    holder,
    editable };
};

/**
 * API double plus direct handles on the spies each test asserts against.
 */
const createApi = (): {
  api: API;
  getCurrentBlockIndex: ReturnType<typeof vi.fn>;
  getBlockByIndex: ReturnType<typeof vi.fn>;
  getById: ReturnType<typeof vi.fn>;
  getBlockTools: ReturnType<typeof vi.fn>;
  convert: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  composeBlockData: ReturnType<typeof vi.fn>;
  setBlockParent: ReturnType<typeof vi.fn>;
  transact: ReturnType<typeof vi.fn>;
  stopBlockMutationWatching: ReturnType<typeof vi.fn>;
  startBlockMutationWatching: ReturnType<typeof vi.fn>;
  setToBlock: ReturnType<typeof vi.fn>;
  closeToolbar: ReturnType<typeof vi.fn>;
  eventsOn: ReturnType<typeof vi.fn>;
  eventsOff: ReturnType<typeof vi.fn>;
  getEnglishTranslation: ReturnType<typeof vi.fn>;
  redactor: HTMLElement;
} => {
  const insertedBlock = { id: 'inserted-block',
    name: 'inserted' } as unknown as BlockAPI;
  const convertedBlock = { id: 'converted-block',
    name: 'converted' } as unknown as BlockAPI;

  const spies = {
    getCurrentBlockIndex: vi.fn(() => 0),
    getBlockByIndex: vi.fn((): BlockAPI | undefined => undefined),
    getById: vi.fn((): BlockAPI | undefined => undefined),
    getBlockTools: vi.fn((): BlockToolAdapter[] => []),
    convert: vi.fn(async (): Promise<BlockAPI> => convertedBlock),
    insert: vi.fn((): BlockAPI => insertedBlock),
    update: vi.fn(async (): Promise<BlockAPI> => insertedBlock),
    composeBlockData: vi.fn(async (): Promise<BlockToolData> => ({ composed: true })),
    setBlockParent: vi.fn(),
    transact: vi.fn((fn: () => void) => fn()),
    stopBlockMutationWatching: vi.fn(),
    startBlockMutationWatching: vi.fn(),
    setToBlock: vi.fn(),
    closeToolbar: vi.fn(),
    eventsOn: vi.fn(),
    eventsOff: vi.fn(),
    getEnglishTranslation: vi.fn((key: string) => key),
    redactor: document.createElement('div'),
  };

  const api = {
    blocks: {
      getCurrentBlockIndex: spies.getCurrentBlockIndex,
      getBlockByIndex: spies.getBlockByIndex,
      getById: spies.getById,
      convert: spies.convert,
      insert: spies.insert,
      update: spies.update,
      composeBlockData: spies.composeBlockData,
      setBlockParent: spies.setBlockParent,
      transact: spies.transact,
      stopBlockMutationWatching: spies.stopBlockMutationWatching,
      startBlockMutationWatching: spies.startBlockMutationWatching,
    },
    tools: { getBlockTools: spies.getBlockTools },
    caret: { setToBlock: spies.setToBlock },
    toolbar: { close: spies.closeToolbar },
    ui: { nodes: { redactor: spies.redactor } },
    events: { on: spies.eventsOn,
      off: spies.eventsOff },
    i18n: {
      t: (key: string): string => key,
      has: (): boolean => false,
      getEnglishTranslation: spies.getEnglishTranslation,
      getLocale: (): string => 'en',
    },
  };

  return { api: api as unknown as API,
    ...spies };
};

const items = (): CapturedItem[] => popoverState.items as CapturedItem[];

/**
 * The item the popover received under `name`.
 * @param name - popover item name
 */
const itemNamed = (name: string): CapturedItem => {
  const found = items().find((item) => item.name === name);

  if (found === undefined) {
    throw new Error(`No popover item named ${name}. Present: ${items().map((item) => item.name).join(', ')}`);
  }

  return found;
};

/**
 * Places a collapsed caret at `offset` inside `node`, so the Toolbox's
 * plain-text caret math runs against a live selection.
 * @param node - text node to place the caret in
 * @param offset - character offset within that node
 */
const placeCaret = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

/**
 * The rect the Toolbox anchored its popover at on the last open().
 */
const lastAnchorRect = (): DOMRect => {
  const call = popoverSpies.updatePosition.mock.calls.at(-1);

  if (call === undefined) {
    throw new Error('updatePosition was never called');
  }

  return call[0];
};

/**
 * The four numbers resolveAnchorRect actually composes. Compared as a plain
 * object because DOMRect exposes them through prototype getters, which
 * objectContaining cannot see.
 * @param rect - rect to flatten
 */
const rectShape = (rect: DOMRect): Record<string, number> => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
});

const HOLDER_RECT = new DOMRect(10, 180, 900, 60);
const CONTENT_RECT = new DOMRect(30, 200, 500, 40);
const COMPOSITE = { left: 30,
  top: 180,
  width: 500,
  height: 60 };

describe('Toolbox — surviving-mutant coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    screenState.mobile = false;
    selectionState.rect = undefined;
    popoverState.items = [];
    popoverState.params = {};
    popoverState.element = null;
    popoverState.constructions = 0;
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('popover anchoring', () => {
    /**
     * Opens the toolbox over one block whose holder/content geometry is
     * deliberately asymmetric — equal or zero rects make every arithmetic
     * mistake in the composed rect invisible.
     *
     * The "pill" is the block's own contentEditable: open() stamps
     * data-blok-slash-search on it before measuring, so its rect is what the
     * pill branch reads.
     * @param options - per-open geometry
     * @param options.pillRect - rect the contentEditable reports once stamped
     */
    const openOverGeometry = (options: {
      caretRect?: DOMRect;
      withSlash?: boolean;
      pillRect?: DOMRect;
    }): void => {
      const { block, editable } = createBlock({
        holderRect: HOLDER_RECT,
        contentRect: CONTENT_RECT,
      });
      const api = createApi();

      api.getBlockByIndex.mockReturnValue(block);
      selectionState.rect = options.caretRect;

      if (options.pillRect !== undefined) {
        const pillRect = options.pillRect;

        editable.getBoundingClientRect = (): DOMRect => pillRect;
      }

      const toolbox = new Toolbox({
        api: api.api,
        tools: createToolsCollection([['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' })]]),
        i18nLabels: I18N_LABELS,
        i18n: { t: (key: string) => key,
          has: () => false },
      });

      toolbox.open(options.withSlash ?? true);
    };

    it('anchors at the block content column, not the holder, when the caret rect is degenerate', () => {
      openOverGeometry({ caretRect: new DOMRect(0, 0, 0, 0) });

      expect(rectShape(lastAnchorRect())).toStrictEqual(COMPOSITE);
    });

    it('uses the caret rect itself when only its width is non-zero', () => {
      const caretRect = new DOMRect(0, 0, 5, 0);

      openOverGeometry({ caretRect });

      expect(lastAnchorRect()).toBe(caretRect);
    });

    it('uses the caret rect itself when only its height is non-zero', () => {
      const caretRect = new DOMRect(0, 0, 0, 9);

      openOverGeometry({ caretRect });

      expect(lastAnchorRect()).toBe(caretRect);
    });

    it('uses the caret rect itself when only its x is non-zero', () => {
      const caretRect = new DOMRect(11, 0, 0, 0);

      openOverGeometry({ caretRect });

      expect(lastAnchorRect()).toBe(caretRect);
    });

    it('uses the caret rect itself when only its y is non-zero', () => {
      const caretRect = new DOMRect(0, 13, 0, 0);

      openOverGeometry({ caretRect });

      expect(lastAnchorRect()).toBe(caretRect);
    });

    it('ignores the caret entirely on a plus-button open and composes the block rect', () => {
      openOverGeometry({ caretRect: new DOMRect(11, 22, 33, 44),
        withSlash: false });

      expect(rectShape(lastAnchorRect())).toStrictEqual(COMPOSITE);
    });

    it('anchors at a pill that has height but no width, insetting its bottom by 2', () => {
      openOverGeometry({ caretRect: new DOMRect(11, 22, 33, 44),
        pillRect: new DOMRect(70, 90, 0, 12) });

      expect(rectShape(lastAnchorRect())).toStrictEqual({ left: 70,
        top: 90,
        width: 0,
        height: 10 });
    });

    it('anchors at a pill that has width but no height, clamping the inset at 0', () => {
      openOverGeometry({ caretRect: new DOMRect(11, 22, 33, 44),
        pillRect: new DOMRect(70, 90, 7, 0) });

      expect(rectShape(lastAnchorRect())).toStrictEqual({ left: 70,
        top: 90,
        width: 7,
        height: 0 });
    });

    it('falls through to the caret when the pill has no size at all', () => {
      const caretRect = new DOMRect(11, 22, 33, 44);

      openOverGeometry({ caretRect,
        pillRect: new DOMRect(70, 90, 0, 0) });

      expect(lastAnchorRect()).toBe(caretRect);
    });

    it('anchors a block-less open at the caret and marks the popover to dismiss on nested scroll', () => {
      const api = createApi();
      const caretRect = new DOMRect(5, 6, 7, 8);

      selectionState.rect = caretRect;

      const toolbox = new Toolbox({
        api: api.api,
        tools: createToolsCollection([['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' })]]),
        i18nLabels: I18N_LABELS,
        i18n: { t: (key: string) => key,
          has: () => false },
      });

      toolbox.open();

      expect(popoverSpies.updatePosition).toHaveBeenCalledWith(caretRect, { positionLifecycle: 'dismiss-on-nested-scroll' });
    });

    it('leaves the popover unpositioned when there is neither a block nor a usable caret', () => {
      const api = createApi();

      selectionState.rect = new DOMRect(0, 0, 0, 0);

      const toolbox = new Toolbox({
        api: api.api,
        tools: createToolsCollection([['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' })]]),
        i18nLabels: I18N_LABELS,
        i18n: { t: (key: string) => key,
          has: () => false },
      });

      toolbox.open();

      expect(popoverSpies.updatePosition).not.toHaveBeenCalled();
      expect(popoverSpies.show).toHaveBeenCalled();
    });

    it('positions against the block holder when a block is present', () => {
      const { block } = createBlock({ holderRect: HOLDER_RECT,
        contentRect: CONTENT_RECT });
      const api = createApi();

      api.getBlockByIndex.mockReturnValue(block);
      selectionState.rect = new DOMRect(0, 0, 0, 0);

      const toolbox = new Toolbox({
        api: api.api,
        tools: createToolsCollection([['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' })]]),
        i18nLabels: I18N_LABELS,
        i18n: { t: (key: string) => key,
          has: () => false },
      });

      toolbox.open();

      expect(popoverSpies.updatePosition.mock.calls[0][1]).toStrictEqual({ positionContext: block.holder });
    });

    it('never positions a mobile popover, which has no updatePosition to call', () => {
      screenState.mobile = true;

      const { block } = createBlock({ holderRect: HOLDER_RECT,
        contentRect: CONTENT_RECT });
      const api = createApi();

      api.getBlockByIndex.mockReturnValue(block);
      selectionState.rect = new DOMRect(50, 60, 70, 80);

      const toolbox = new Toolbox({
        api: api.api,
        tools: createToolsCollection([['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' })]]),
        i18nLabels: I18N_LABELS,
        i18n: { t: (key: string) => key,
          has: () => false },
      });

      toolbox.open();

      expect(popoverSpies.updatePosition).not.toHaveBeenCalled();
      expect(popoverSpies.show).toHaveBeenCalled();
    });

    it('skips the desktop-only left-align forwarding on a mobile popover', () => {
      screenState.mobile = true;

      const api = createApi();
      const toolbox = new Toolbox({
        api: api.api,
        tools: createToolsCollection([['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' })]]),
        i18nLabels: I18N_LABELS,
        i18n: { t: (key: string) => key,
          has: () => false },
      });

      toolbox.updateLeftAlignElement(document.createElement('div'));

      expect(popoverSpies.setLeftAlignElement).not.toHaveBeenCalled();
    });
  });

  /**
   * Toolbox over one plain tool, plus the API double it was given.
   * @param options - per-test wiring
   * @param options.block - what getBlockByIndex answers with
   */
  const buildToolbox = (options: {
    tools?: [string, BlockToolAdapter][];
    block?: BlockAPI;
    triggerElement?: HTMLElement;
    listboxId?: string;
    i18n?: { t: (key: string) => string; has: (key: string) => boolean };
  } = {}): { toolbox: Toolbox; api: ReturnType<typeof createApi> } => {
    const api = createApi();

    if (options.block !== undefined) {
      api.getBlockByIndex.mockReturnValue(options.block);
    }

    const toolbox = new Toolbox({
      api: api.api,
      tools: createToolsCollection(options.tools ?? [
        ['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' })],
      ]),
      i18nLabels: I18N_LABELS,
      i18n: options.i18n ?? { t: (key: string) => key,
        has: () => false },
      triggerElement: options.triggerElement,
      listboxId: options.listboxId,
    });

    return { toolbox,
      api };
  };

  /**
   * The Toolbox root, refusing to continue if it went missing.
   * @param toolbox - toolbox under test
   */
  const rootOf = (toolbox: Toolbox): HTMLElement => {
    const root = toolbox.getElement();

    if (root === null) {
      throw new Error('Toolbox has no root element');
    }

    return root;
  };

  /**
   * The popover element the Toolbox is currently driving.
   */
  const popoverElement = (): HTMLElement => {
    if (popoverState.element === null) {
      throw new Error('No popover was constructed');
    }

    return popoverState.element;
  };

  /**
   * The Closed handler the Toolbox subscribed to its popover with. Firing it is
   * how the popover reports a dismissal the Toolbox did not initiate (Escape,
   * outside click).
   */
  const popoverClosedHandler = (): (() => void) => {
    const call = popoverSpies.on.mock.calls.find(([event]) => event === PopoverEvent.Closed);

    if (call === undefined) {
      throw new Error('Toolbox never subscribed to PopoverEvent.Closed');
    }

    return call[1];
  };

  describe('lifecycle', () => {
    it('claims elements in its own root and in the popover, and disowns everything else', () => {
      const { toolbox } = buildToolbox();
      const inRoot = document.createElement('span');
      const inPopover = document.createElement('span');
      const stranger = document.createElement('span');

      inRoot.textContent = 'root child';
      inPopover.textContent = 'popover child';
      stranger.textContent = 'unrelated';
      rootOf(toolbox).appendChild(inRoot);
      popoverElement().appendChild(inPopover);
      document.body.appendChild(stranger);

      expect(toolbox.contains(inRoot)).toBe(true);
      expect(toolbox.contains(inPopover)).toBe(true);
      expect(toolbox.contains(stranger)).toBe(false);
    });

    it('drops its event subscribers on destroy, so a later close emits nothing', () => {
      const { block } = createBlock();
      const { toolbox } = buildToolbox({ block });
      const onClosed = vi.fn();

      toolbox.on(ToolboxEvent.Closed, onClosed);
      toolbox.open();
      toolbox.destroy();
      toolbox.close();

      expect(onClosed).not.toHaveBeenCalled();
    });

    it('removes each registered shortcut exactly once on destroy', () => {
      const { toolbox, api } = buildToolbox({
        tools: [['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' }, { shortcut: 'CMD+T' })]],
      });

      toolbox.destroy();

      expect(vi.mocked(Shortcuts.remove)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(Shortcuts.remove)).toHaveBeenCalledWith(api.redactor, 'CMD+T');
    });

    it('tears down the block input listener on destroy', () => {
      const { block, editable } = createBlock({ text: 'x' });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      toolbox.destroy();
      popoverSpies.filterItems.mockClear();
      editable.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).not.toHaveBeenCalled();
    });

    it('stays silent when close() runs as routine cleanup on a toolbox that never opened', () => {
      const { toolbox } = buildToolbox();
      const onClosed = vi.fn();

      toolbox.on(ToolboxEvent.Closed, onClosed);
      toolbox.close();

      expect(onClosed).not.toHaveBeenCalled();
      expect(popoverSpies.setActiveDescendantHost).not.toHaveBeenCalled();
    });

    it('stays silent when the popover reports a close it was never opened for', () => {
      const { toolbox, api } = buildToolbox();
      const onClosed = vi.fn();

      toolbox.on(ToolboxEvent.Closed, onClosed);
      popoverClosedHandler()();

      expect(onClosed).not.toHaveBeenCalled();
      expect(api.startBlockMutationWatching).not.toHaveBeenCalled();
    });

    it('re-arms mutation watching when the popover closes itself after an open', () => {
      const { block } = createBlock({ id: 'watched-block' });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      popoverClosedHandler()();

      expect(api.startBlockMutationWatching).toHaveBeenCalledWith('watched-block');
    });

    it('resets the popover filter to the empty query on close', () => {
      const { block } = createBlock({ text: 'x' });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      popoverSpies.filterItems.mockClear();
      toolbox.close();

      expect(popoverSpies.filterItems).toHaveBeenCalledWith('');
    });

    it('detaches the block input listener on close', () => {
      const { block, editable } = createBlock({ text: 'x' });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      toolbox.close();
      popoverSpies.filterItems.mockClear();
      editable.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).not.toHaveBeenCalled();
    });

    it('opens and closes over a block that has no contentEditable at all', () => {
      const { block } = createBlock({ editable: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();

      expect(() => {
        toolbox.close();
      }).not.toThrow();
      expect(popoverSpies.hide).toHaveBeenCalled();
    });

    it('clears stale markup out of its root when the popover is rebuilt', () => {
      const { toolbox } = buildToolbox();
      const root = rootOf(toolbox);

      root.innerHTML = '<b>stale</b>';
      toolbox.refreshItems();

      expect(root.innerHTML).toBe('');
    });

    it('unsubscribes the discarded popover from its Closed event on rebuild', () => {
      const { toolbox } = buildToolbox();

      popoverSpies.off.mockClear();
      toolbox.refreshItems();

      expect(popoverSpies.off).toHaveBeenCalledWith(PopoverEvent.Closed, expect.any(Function));
    });

    it('removes one shortcut per rebuild instead of accumulating them', () => {
      const { toolbox } = buildToolbox({
        tools: [['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' }, { shortcut: 'CMD+T' })]],
      });

      toolbox.refreshItems();
      toolbox.refreshItems();

      expect(vi.mocked(Shortcuts.remove)).toHaveBeenCalledTimes(2);
    });

    it('rebuilds the popover against replaced labels', () => {
      const { toolbox } = buildToolbox();

      toolbox.setI18nLabels({ filter: 'Filtrer',
        nothingFound: 'Rien trouvé',
        slashSearchPlaceholder: 'Rechercher' });
      toolbox.refreshItems();

      expect(popoverState.params.messages).toMatchObject({ nothingFound: 'Rien trouvé',
        search: 'Filtrer' });
    });

    it('anchors the popover at the supplied trigger element', () => {
      const triggerElement = document.createElement('button');

      triggerElement.textContent = 'plus button';
      buildToolbox({ triggerElement });

      expect(popoverState.params.trigger).toBe(triggerElement);
    });

    it('falls back to its own root as the popover trigger', () => {
      const { toolbox } = buildToolbox();

      expect(popoverState.params.trigger).toBe(rootOf(toolbox));
    });

    it('lets the popover keep handling contentEditable navigation', () => {
      buildToolbox();

      expect(popoverState.params.handleContentEditableNavigation).toBe(true);
    });

    it('stamps the popover element with its own test id', () => {
      buildToolbox();

      expect(popoverElement().getAttribute('data-blok-testid')).toBe('toolbox-popover');
    });

    it('rebuilds a working popover when the mobile layout is toggled', () => {
      const { toolbox, api } = buildToolbox();
      const subscription = api.eventsOn.mock.calls.find(([event]) => event === BlokMobileLayoutToggled);

      if (subscription === undefined) {
        throw new Error('Toolbox never subscribed to BlokMobileLayoutToggled');
      }

      const handler = subscription[1] as () => void;

      handler();

      expect(toolbox.hasFocus()).toBe(false);
      expect(popoverState.constructions).toBe(2);
    });

    it('reuses the built item list when the popover is recreated for a layout change', () => {
      const { api } = buildToolbox();
      const before = popoverState.items;
      const subscription = api.eventsOn.mock.calls.find(([event]) => event === BlokMobileLayoutToggled);

      if (subscription === undefined) {
        throw new Error('Toolbox never subscribed to BlokMobileLayoutToggled');
      }

      (subscription[1] as () => void)();

      expect(popoverState.items).toBe(before);
    });

    it('keeps reporting an empty toolbox until refreshItems picks up a newly registered tool', () => {
      const tools = createToolsCollection([]);
      const api = createApi();
      const toolbox = new Toolbox({
        api: api.api,
        tools,
        i18nLabels: I18N_LABELS,
        i18n: { t: (key: string) => key,
          has: () => false },
      });

      tools.set('late', createTool('late', { title: 'Late',
        icon: '<svg />' }));

      expect(toolbox.isEmpty).toBe(true);

      toolbox.refreshItems();

      expect(toolbox.isEmpty).toBe(false);
    });

    it('clears both search-input overrides when the callout background is dropped', () => {
      const { toolbox } = buildToolbox();

      popoverElement().style.setProperty('--blok-search-input-bg', 'red');
      popoverElement().style.setProperty('--blok-search-input-border', '1px solid red');
      toolbox.setCalloutBackground(null);

      expect(popoverElement().style.getPropertyValue('--blok-search-input-bg')).toBe('');
      expect(popoverElement().style.getPropertyValue('--blok-search-input-border')).toBe('');
    });
  });

  /**
   * Fires a popover item's activation the way a click on it would.
   * @param name - popover item name
   */
  const activateItem = (name: string): void => {
    const handler = itemNamed(name).onActivate;

    if (handler === undefined) {
      throw new Error(`Popover item ${name} has no onActivate`);
    }

    handler();
  };

  /**
   * A tool that opts into block-level color the way paragraph/header do — by
   * declaring the colour fields in its sanitize config.
   * @param sanitizeConfig - the config to declare
   */
  const createColorTool = (sanitizeConfig: unknown): BlockToolAdapter => createTool(
    'paragraph',
    { title: 'Text',
      icon: '<svg />' },
    { sanitizeConfig }
  );

  describe('toolbox items', () => {
    it('inserts the tool the activated entry belongs to, carrying that entry data', async () => {
      const { block } = createBlock({ isEmpty: true });
      const { toolbox, api } = buildToolbox({
        block,
        tools: [
          ['plain', createTool('plain', { name: 'plain',
            title: 'Plain',
            icon: '<svg>p</svg>' })],
          ['list', createTool('list', [
            { name: 'bulleted-list',
              title: 'Bulleted',
              icon: '<svg>b</svg>',
              data: { style: 'unordered' } },
            { name: 'numbered-list',
              title: 'Numbered',
              icon: '<svg>n</svg>',
              data: { style: 'ordered' } },
          ])],
        ],
      });

      toolbox.open();
      activateItem('numbered-list');

      await vi.waitFor(() => {
        expect(api.insert).toHaveBeenCalled();
      });

      expect(api.insert.mock.calls[0][0]).toBe('list');
      expect(api.insert.mock.calls[0][1]).toStrictEqual({ composed: true,
        style: 'ordered' });
    });

    it('namespaces a bare titleKey under toolNames for the English search fallback', () => {
      const { api } = buildToolbox({
        tools: [['text', createTool('text', { titleKey: 'text',
          title: 'Text',
          icon: '<svg />' })]],
      });

      expect(api.getEnglishTranslation).toHaveBeenCalledWith('toolNames.text');
      expect(itemNamed('text').englishTitle).toBe('toolNames.text');
    });

    it('leaves an already-qualified titleKey alone', () => {
      const { api } = buildToolbox({
        tools: [['quote', createTool('quote', { titleKey: 'tools.quote.title',
          title: 'Quote',
          icon: '<svg />' })]],
      });

      expect(api.getEnglishTranslation).toHaveBeenCalledWith('tools.quote.title');
      expect(itemNamed('quote').englishTitle).toBe('tools.quote.title');
    });

    it('gives an entry that declares no aliases an empty search-term list', () => {
      buildToolbox({
        tools: [['plain', createTool('plain', { title: 'Plain',
          icon: '<svg />' })]],
        i18n: { t: (key: string) => `T:${key}`,
          has: () => true },
      });

      expect(itemNamed('plain').searchTerms).toStrictEqual([]);
    });

    it('merges the entry aliases with the tool aliases without duplicating them', () => {
      buildToolbox({
        tools: [['plain', createTool(
          'plain',
          { title: 'Plain',
            icon: '<svg />',
            searchTerms: ['para', 'shared'] },
          { searchTerms: ['shared', 'body'] }
        )]],
        i18n: { t: (key: string) => `T:${key}`,
          has: () => false },
      });

      expect(itemNamed('plain').searchTerms).toStrictEqual(['para', 'shared', 'body']);
    });

    it('resolves only the translated aliases the locale actually knows', () => {
      buildToolbox({
        tools: [['plain', createTool('plain', {
          title: 'Plain',
          icon: '<svg />',
          searchTermKeys: ['known', 'missing'],
        })]],
        i18n: {
          t: (key: string) => `T:${key}`,
          has: (key: string) => key === 'searchTerms.known',
        },
      });

      expect(itemNamed('plain').searchTerms).toStrictEqual(['T:searchTerms.known']);
    });

    it('prefers the entry shortcut over the tool shortcut', () => {
      buildToolbox({
        tools: [['heading', createTool(
          'heading',
          { name: 'heading-1',
            title: 'Heading 1',
            icon: '<svg />',
            shortcut: 'CMD+1' },
          { shortcut: 'CMD+H' }
        )]],
      });

      expect(itemNamed('heading-1').secondaryLabel).toBe(beautifyShortcut('CMD+1'));
    });

    it('lends the tool shortcut to the first entry only', () => {
      buildToolbox({
        tools: [['list', createTool(
          'list',
          [
            { name: 'bulleted-list',
              title: 'Bulleted',
              icon: '<svg>b</svg>' },
            { name: 'numbered-list',
              title: 'Numbered',
              icon: '<svg>n</svg>' },
          ],
          { shortcut: 'CMD+L' }
        )]],
      });

      expect(itemNamed('bulleted-list').secondaryLabel).toBe(beautifyShortcut('CMD+L'));
      expect(itemNamed('numbered-list').secondaryLabel).toBe('');
    });

    it('leaves the secondary label empty for a tool with no shortcut at all', () => {
      buildToolbox({
        tools: [['plain', createTool('plain', { title: 'Plain',
          icon: '<svg />' })]],
      });

      expect(itemNamed('plain').secondaryLabel).toBe('');
    });

    it('keeps an entry whose declared section is not one the toolbox renders', () => {
      buildToolbox({
        tools: [
          ['known', createTool('known', { title: 'Known',
            icon: '<svg />',
            section: 'basic' })],
          ['odd', createTool('odd', { title: 'Odd',
            icon: '<svg />',
            section: 'not-a-section' } as unknown as ToolboxConfigEntry)],
        ],
      });

      expect(itemNamed('odd').title).toBe('Odd');
      expect(items().some((item) => item.type === PopoverItemType.Separator)).toBe(true);
    });

    it('gives the Color header the same roomy top padding as any non-first header', () => {
      buildToolbox({
        tools: [
          ['paragraph', createColorTool({ textColor: false,
            backgroundColor: false })],
          ['known', createTool('known', { title: 'Known',
            icon: '<svg />',
            section: 'basic' })],
        ],
      });

      const basicHeader = itemNamed('toolbox-section-basic').element;
      const colorHeader = itemNamed('toolbox-section-color').element;

      expect(basicHeader?.className).toContain('pt-0.5');
      expect(colorHeader?.className).toContain('pt-2.5');
      expect(colorHeader?.className).toContain('text-xs');
    });

    it('marks a section header as presentational so the listbox may own it', () => {
      buildToolbox({
        tools: [['known', createTool('known', { title: 'Known',
          icon: '<svg />',
          section: 'basic' })]],
      });

      expect(itemNamed('toolbox-section-basic').element?.getAttribute('role')).toBe('presentation');
    });

    it('gives block-color commands no secondary label', () => {
      buildToolbox({
        tools: [['paragraph', createColorTool({ textColor: false,
          backgroundColor: false })]],
      });

      expect(itemNamed('block-color-bg-red').secondaryLabel).toBe('');
    });

    it('treats a tool declaring only a text colour field as colour-capable', () => {
      buildToolbox({
        tools: [
          ['plain', createTool('plain', { title: 'Plain',
            icon: '<svg />' })],
          ['paragraph', createColorTool({ textColor: false })],
        ],
      });

      expect(items().some((item) => item.name === 'block-color-text-red')).toBe(true);
    });

    it('treats a tool declaring only a background colour field as colour-capable', () => {
      buildToolbox({
        tools: [
          ['plain', createTool('plain', { title: 'Plain',
            icon: '<svg />' })],
          ['paragraph', createColorTool({ backgroundColor: false })],
        ],
      });

      expect(items().some((item) => item.name === 'block-color-bg-red')).toBe(true);
    });

    it('does not read colour support out of a null sanitize config', () => {
      buildToolbox({
        tools: [['paragraph', createColorTool(null)]],
      });

      expect(items().some((item) => item.name?.startsWith('block-color-'))).toBe(false);
    });

    it('offers no colour commands when no registered tool declares colour fields', () => {
      buildToolbox({
        tools: [['plain', createTool('plain', { title: 'Plain',
          icon: '<svg />' }, { sanitizeConfig: { text: {} } })]],
      });

      expect(items().some((item) => item.name?.startsWith('block-color-'))).toBe(false);
    });
  });

  describe('what the open menu is allowed to offer', () => {
    /**
     * Every hide/show the Toolbox asked the popover for, in order.
     * @param prefix - only report names starting with this
     */
    const hideCalls = (prefix: string): [string, boolean][] => popoverSpies.toggleItemHiddenByName.mock.calls
      .filter(([name]) => name.startsWith(prefix));

    it('hides the tools the direct parent container denies its children', () => {
      const { block } = createBlock({ parentId: 'parent-1' });
      const { toolbox, api } = buildToolbox({
        block,
        tools: [
          ['table', createTool('table', { title: 'Table',
            icon: '<svg />' })],
          ['plain', createTool('plain', { title: 'Plain',
            icon: '<svg />' })],
        ],
      });

      const parentBlock = { id: 'parent-1',
        name: 'columns' } as unknown as BlockAPI;

      api.getById.mockReturnValue(parentBlock);
      api.getBlockTools.mockReturnValue([
        createTool('plain', undefined),
        createTool('columns', undefined, { childTools: { deny: ['table'] } }),
      ]);

      toolbox.open();

      expect(popoverSpies.toggleItemHiddenByName).toHaveBeenCalledWith('table', true);
      expect(popoverSpies.toggleItemHiddenByName).not.toHaveBeenCalledWith('plain', true);
    });

    it('does not go looking for a parent block when the block has none', () => {
      const { block } = createBlock({ parentId: null });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();

      expect(api.getById).not.toHaveBeenCalled();
    });

    it('leaves the table-cell restrictions alone outside a table cell', () => {
      const { block } = createBlock();
      const { toolbox } = buildToolbox({
        block,
        tools: [['table', createTool('table', { title: 'Table',
          icon: '<svg />' })]],
      });

      toolbox.open();

      expect(popoverSpies.toggleItemHiddenByName).not.toHaveBeenCalledWith('table', true);
    });

    it('hides a section header once every entry under it is restricted, and restores it on close', () => {
      const { block } = createBlock({ insideTableCell: true });
      const { toolbox } = buildToolbox({
        block,
        tools: [
          ['table', createTool('table', { title: 'Table',
            icon: '<svg />',
            section: 'basic' })],
          ['plain', createTool('plain', { title: 'Plain',
            icon: '<svg />',
            section: 'media' })],
        ],
      });

      toolbox.open();
      toolbox.close();
      toolbox.open();

      expect(hideCalls('toolbox-section-basic')).toStrictEqual([
        ['toolbox-section-basic', true],
        ['toolbox-section-basic', false],
        ['toolbox-section-basic', true],
      ]);
      expect(hideCalls('toolbox-section-media')).toStrictEqual([]);
    });

    it('touches no section header when the opening changes nothing', () => {
      const { block } = createBlock({ name: 'paragraph' });
      const { toolbox } = buildToolbox({
        block,
        tools: [['paragraph', createTool(
          'paragraph',
          { title: 'Text',
            icon: '<svg />',
            section: 'basic' },
          { sanitizeConfig: { textColor: false,
            backgroundColor: false } }
        )]],
      });

      toolbox.open();

      expect(hideCalls('toolbox-section-')).toStrictEqual([]);
    });

    it('shows the block-colour commands for a block whose tool renders colour', () => {
      const { block } = createBlock({ name: 'paragraph' });
      const { toolbox } = buildToolbox({
        block,
        tools: [['paragraph', createColorTool({ textColor: false,
          backgroundColor: false })]],
      });

      toolbox.open();

      expect(popoverSpies.toggleItemHiddenByName).toHaveBeenCalledWith('block-color-bg-red', false);
    });

    it('hides the block-colour commands when there is no current block to recolour', () => {
      const { toolbox } = buildToolbox({
        tools: [['paragraph', createColorTool({ textColor: false,
          backgroundColor: false })]],
      });

      toolbox.open();

      expect(popoverSpies.toggleItemHiddenByName).toHaveBeenCalledWith('block-color-bg-red', true);
    });

    it('survives a tool whose toolbox config was withdrawn after the menu was built', () => {
      const config: { value: ToolboxConfigEntry | undefined } = {
        value: { title: 'Table',
          icon: '<svg />' },
      };
      const withdrawing = {
        name: 'table',
        get toolbox(): ToolboxConfigEntry | undefined {
          return config.value;
        },
      } as unknown as BlockToolAdapter;
      const { block } = createBlock({ insideTableCell: true });
      const { toolbox } = buildToolbox({ block,
        tools: [['table', withdrawing]] });

      config.value = undefined;

      expect(() => {
        toolbox.open();
      }).not.toThrow();
    });
  });

  describe('inline slash search', () => {
    /**
     * The single text node behind a block's contentEditable, so a caret can be
     * placed at an exact plain-text offset.
     * @param editable - the block's contentEditable
     */
    const textNodeOf = (editable: HTMLElement): Text => {
      const node = editable.firstChild;

      if (node === null || node.nodeType !== Node.TEXT_NODE) {
        throw new Error('contentEditable has no leading text node');
      }

      return node as Text;
    };

    it('filters by the text between the slash and the caret, ignoring a later slash', () => {
      const { block, editable } = createBlock({ text: 'a/b/c',
        isEmpty: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      placeCaret(textNodeOf(editable), 3);
      popoverSpies.filterItems.mockClear();
      editable.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).toHaveBeenCalledWith('b');
    });

    it('tracks the slash nearest before the caret, not one that follows it', async () => {
      const { block, editable } = createBlock({ text: 'a/b/c',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      placeCaret(textNodeOf(editable), 2);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      await toolbox.toolButtonActivated('testTool');

      expect(api.convert).toHaveBeenCalled();
      expect(editable.textContent).toBe('ab/c');
    });

    it('falls back to the end of the block when the selection sits outside it', () => {
      const { block, editable } = createBlock({ text: '/ab',
        isEmpty: false });
      const outsider = document.createElement('div');

      outsider.setAttribute('contenteditable', 'true');
      outsider.appendChild(document.createTextNode('elsewhere'));
      document.body.appendChild(outsider);

      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      placeCaret(textNodeOf(outsider), 1);
      popoverSpies.filterItems.mockClear();
      editable.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).toHaveBeenCalledWith('ab');
    });

    it('falls back to the end of the block when there is no selection at all', () => {
      const { block, editable } = createBlock({ text: '/ab',
        isEmpty: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      window.getSelection()?.removeAllRanges();
      popoverSpies.filterItems.mockClear();
      editable.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).toHaveBeenCalledWith('ab');
    });

    it('ignores input on a block that has no contentEditable to search', () => {
      const { block, holder } = createBlock({ editable: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      popoverSpies.filterItems.mockClear();
      holder.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).not.toHaveBeenCalled();
    });

    it('never stamps the search pill on an editable host that is not an HTML element', () => {
      const holder = document.createElement('div');
      const content = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      content.setAttribute(DATA_ATTR.elementContent, '');
      svg.setAttribute('contenteditable', 'true');
      svg.appendChild(document.createTextNode('/ab'));
      content.appendChild(svg);
      holder.appendChild(content);
      document.body.appendChild(holder);

      const block = { id: 'svg-block',
        name: 'testTool',
        isEmpty: false,
        parentId: null,
        holder } as unknown as BlockAPI;
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      popoverSpies.filterItems.mockClear();
      holder.dispatchEvent(new Event('input', { bubbles: true }));

      expect(svg.hasAttribute(DATA_ATTR.slashSearch)).toBe(false);
      expect(popoverSpies.filterItems).toHaveBeenCalledWith('ab');
    });

    it('searches the contentEditable that holds focus, not the first one in the block', () => {
      const holder = document.createElement('div');
      const first = document.createElement('div');
      const second = document.createElement('div');

      for (const editable of [first, second]) {
        editable.setAttribute('contenteditable', 'true');
        // jsdom never computes isContentEditable, so the focused-host branch is
        // unreachable without declaring it on the element.
        Object.defineProperty(editable, 'isContentEditable', { value: true,
          configurable: true });
        holder.appendChild(editable);
      }
      first.appendChild(document.createTextNode('first'));
      second.appendChild(document.createTextNode('second'));
      document.body.appendChild(holder);
      second.focus();

      const block = { id: 'two-editables',
        name: 'testTool',
        isEmpty: false,
        parentId: null,
        holder } as unknown as BlockAPI;
      const { toolbox } = buildToolbox({ block });

      toolbox.open();

      expect(second.hasAttribute(DATA_ATTR.slashSearch)).toBe(true);
      expect(first.hasAttribute(DATA_ATTR.slashSearch)).toBe(false);
    });

    it('ignores a focused element inside the block that is not editable', () => {
      const holder = document.createElement('div');
      const editable = document.createElement('div');
      const button = document.createElement('button');

      editable.setAttribute('contenteditable', 'true');
      editable.appendChild(document.createTextNode('text'));
      holder.append(editable, button);
      document.body.appendChild(holder);
      button.focus();

      const block = { id: 'button-focused',
        name: 'testTool',
        isEmpty: false,
        parentId: null,
        holder } as unknown as BlockAPI;
      const { toolbox } = buildToolbox({ block });

      toolbox.open();

      expect(editable.hasAttribute(DATA_ATTR.slashSearch)).toBe(true);
      expect(button.hasAttribute(DATA_ATTR.slashSearch)).toBe(false);
    });

    it('points aria-controls at the listbox only when one was named', () => {
      const withId = createBlock({ text: 'x' });
      const withoutId = createBlock({ text: 'x' });
      const named = buildToolbox({ block: withId.block,
        listboxId: 'toolbox-listbox' });
      const unnamed = buildToolbox({ block: withoutId.block });

      named.toolbox.open();
      unnamed.toolbox.open();

      expect(withId.editable.getAttribute('aria-controls')).toBe('toolbox-listbox');
      expect(withoutId.editable.hasAttribute('aria-controls')).toBe(false);
    });

    it('leaves no combobox attribute behind on close', () => {
      const { block, editable } = createBlock({ text: 'x' });
      const { toolbox } = buildToolbox({ block,
        listboxId: 'toolbox-listbox' });

      toolbox.open();
      toolbox.close();

      expect(editable.hasAttribute('aria-autocomplete')).toBe(false);
      expect(editable.hasAttribute('aria-haspopup')).toBe(false);
      expect(editable.hasAttribute('aria-controls')).toBe(false);
      expect(editable.hasAttribute('aria-label')).toBe(false);
      expect(editable.hasAttribute('role')).toBe(false);
    });

    it('restores a label the block already carried instead of clearing it', () => {
      const { block, editable } = createBlock({ text: 'x' });
      const { toolbox } = buildToolbox({ block });

      editable.setAttribute('aria-label', 'Paragraph body');
      toolbox.open();
      toolbox.close();

      expect(editable.getAttribute('aria-label')).toBe('Paragraph body');
    });
  });

  describe('picking a tool', () => {
    /**
     * Puts the caret at a plain-text offset inside the block and lets the
     * Toolbox record the slash span from a real input event — the same way a
     * user typing "/query" does.
     * @param editable - the block's contentEditable
     * @param offset - plain-text offset of the caret
     */
    const typeUpTo = (editable: HTMLElement, offset: number): void => {
      let remaining = offset;

      for (const node of Array.from(editable.childNodes)) {
        const length = node.textContent?.length ?? 0;

        if (remaining <= length) {
          placeCaret(node, remaining);
          break;
        }

        remaining -= length;
      }

      editable.dispatchEvent(new Event('input', { bubbles: true }));
    };

    it('replaces the block from a plus-button open without resolving any slash span', async () => {
      const { block, editable } = createBlock({ text: 'a/b',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open(false);
      await toolbox.toolButtonActivated('testTool');

      expect(api.insert.mock.calls[0][3]).toBe(0);
      expect(api.insert.mock.calls[0][5]).toBe(true);
      expect(editable.textContent).toBe('a/b');
    });

    it('still inserts when the block has no contentEditable to read a query from', async () => {
      const { block } = createBlock({ editable: false,
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      await toolbox.toolButtonActivated('testTool');

      expect(api.insert).toHaveBeenCalled();
    });

    it('replaces in place when only whitespace surrounds the slash query', async () => {
      const { block, editable } = createBlock({ text: ' /x',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[0], 3);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      await toolbox.toolButtonActivated('testTool');

      expect(api.convert).not.toHaveBeenCalled();
      expect(api.insert.mock.calls[0][3]).toBe(0);
      expect(api.insert.mock.calls[0][5]).toBe(true);
    });

    it('inserts a sibling when the in-place conversion is refused', async () => {
      const { block, editable } = createBlock({ text: 'a/x',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      api.convert.mockRejectedValue(new Error('no conversionConfig'));
      toolbox.open();
      typeUpTo(editable, 3);
      await toolbox.toolButtonActivated('testTool');

      expect(api.insert).toHaveBeenCalled();
    });

    it('restores the caret where the slash query was and closes the toolbar after converting', async () => {
      const { block, editable } = createBlock({ text: 'hi/x',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      typeUpTo(editable, 4);
      await toolbox.toolButtonActivated('testTool');

      expect(api.setToBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'converted-block' }), 'default', 2);
      expect(api.closeToolbar).toHaveBeenCalledWith({ setExplicitlyClosed: false });
    });

    it('inserts below and leaves the text alone when the block holds no slash query', async () => {
      const { block, editable } = createBlock({ text: 'abc',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      await toolbox.toolButtonActivated('testTool');

      expect(api.convert).not.toHaveBeenCalled();
      expect(api.insert.mock.calls[0][3]).toBe(1);
      expect(api.setToBlock).toHaveBeenCalledWith(1);
      expect(api.closeToolbar).toHaveBeenCalledWith({ setExplicitlyClosed: false });
      expect(editable.textContent).toBe('abc');
    });

    it('resolves the span from the live caret when nothing was typed after opening', async () => {
      const { block, editable } = createBlock({ text: 'a/b',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[0], 3);
      await toolbox.toolButtonActivated('testTool');

      expect(api.convert).toHaveBeenCalled();
      expect(editable.textContent).toBe('a');
    });

    it('keeps the span it tracked while typing even after the caret has moved away', async () => {
      const { block, editable } = createBlock({ text: 'hi/x',
        isEmpty: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      typeUpTo(editable, 4);
      placeCaret(editable.childNodes[0], 3);
      await toolbox.toolButtonActivated('testTool');

      expect(editable.textContent).toBe('hi');
    });

    it('wraps a parented insert in a transaction and leaves an unparented one alone', async () => {
      const parented = createBlock({ id: 'child-block',
        parentId: 'parent-1',
        isEmpty: true });
      const orphan = createBlock({ id: 'root-block',
        parentId: null,
        isEmpty: true });
      const withParent = buildToolbox({ block: parented.block });
      const withoutParent = buildToolbox({ block: orphan.block });

      await withParent.toolbox.toolButtonActivated('testTool');
      await withoutParent.toolbox.toolButtonActivated('testTool');

      expect(withParent.api.transact).toHaveBeenCalled();
      expect(withoutParent.api.transact).not.toHaveBeenCalled();
    });
  });

  describe('block-colour commands', () => {
    const COLOUR_TOOLS: [string, BlockToolAdapter][] = [
      ['paragraph', createColorTool({ textColor: false,
        backgroundColor: false })],
    ];

    it('recolours the current block in place, stripping only the typed query', async () => {
      const { block, editable } = createBlock({ id: 'coloured',
        name: 'paragraph',
        text: 'hi/red',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block,
        tools: COLOUR_TOOLS });

      toolbox.open();
      placeCaret(editable.childNodes[0], 6);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      activateItem('block-color-bg-red');

      await vi.waitFor(() => {
        expect(api.update).toHaveBeenCalled();
      });

      expect(api.update).toHaveBeenCalledWith('coloured', { backgroundColor: 'red' });
      expect(editable.textContent).toBe('hi');
      expect(api.setToBlock).toHaveBeenCalledWith(0);
      expect(api.closeToolbar).toHaveBeenCalledWith({ setExplicitlyClosed: false });
    });

    it('never strips block text when the menu was opened from the plus button', async () => {
      const { block, editable } = createBlock({ id: 'coloured',
        name: 'paragraph',
        text: 'a/b',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block,
        tools: COLOUR_TOOLS });

      toolbox.open(false);
      activateItem('block-color-text-red');

      await vi.waitFor(() => {
        expect(api.update).toHaveBeenCalled();
      });

      expect(editable.textContent).toBe('a/b');
      expect(api.update).toHaveBeenCalledWith('coloured', { textColor: 'red' });
    });

    it('recolours a block that has no contentEditable to strip a query from', async () => {
      const { block } = createBlock({ id: 'coloured',
        name: 'paragraph',
        editable: false,
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block,
        tools: COLOUR_TOOLS });

      toolbox.open();
      activateItem('block-color-bg-red');

      await vi.waitFor(() => {
        expect(api.update).toHaveBeenCalled();
      });

      expect(api.update).toHaveBeenCalledWith('coloured', { backgroundColor: 'red' });
    });

    it('does nothing at all when there is no block to recolour', async () => {
      const { toolbox, api } = buildToolbox({ tools: COLOUR_TOOLS });

      toolbox.open();
      activateItem('block-color-bg-red');

      await vi.waitFor(() => {
        expect(popoverSpies.show).toHaveBeenCalled();
      });

      expect(api.update).not.toHaveBeenCalled();
      expect(api.setToBlock).not.toHaveBeenCalled();
    });

    it('clears the colour field for the default reset command', async () => {
      const { block, editable } = createBlock({ id: 'coloured',
        name: 'paragraph',
        text: '',
        isEmpty: true });
      const { toolbox, api } = buildToolbox({ block,
        tools: COLOUR_TOOLS });

      toolbox.open();
      placeCaret(editable, 0);
      activateItem('block-color-bg-default');

      await vi.waitFor(() => {
        expect(api.update).toHaveBeenCalled();
      });

      expect(api.update).toHaveBeenCalledWith('coloured', { backgroundColor: undefined });
    });
  });

  describe('stripping the typed query out of the block', () => {
    it('removes only the slash span while walking every text node', async () => {
      const { block, editable } = createBlock({ text: ['ab', 'cd', '/xy', 'z'],
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[2], 2);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      await toolbox.toolButtonActivated('testTool');

      expect(api.convert).toHaveBeenCalled();
      expect(editable.textContent).toBe('abcdyz');
    });

    it('drops a text node the query emptied instead of leaving a blank one', async () => {
      const { block, editable } = createBlock({ text: ['ab', '/x', 'cd'],
        isEmpty: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[1], 2);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      await toolbox.toolButtonActivated('testTool');

      expect(editable.textContent).toBe('abcd');
      expect(editable.childNodes).toHaveLength(2);
    });

    it('removes a query that straddles two text nodes', async () => {
      const { block, editable } = createBlock({ text: ['ab', '/x', 'yz'],
        isEmpty: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[2], 1);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      await toolbox.toolButtonActivated('testTool');

      expect(editable.textContent).toBe('abz');
    });
  });

  describe('slash spans that do not mean what they look like', () => {
    it('does not convert in place when the caret sits on the slash itself', async () => {
      const { block, editable } = createBlock({ text: '/abc',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[0], 0);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      await toolbox.toolButtonActivated('testTool');

      expect(api.convert).not.toHaveBeenCalled();
      expect(api.insert).toHaveBeenCalled();
    });

    it('does not convert in place when the tracked span points at text that is not a slash query', async () => {
      const holder = document.createElement('div');
      const body = document.createElement('div');
      const caption = document.createElement('div');

      for (const host of [body, caption]) {
        host.setAttribute('contenteditable', 'true');
        // jsdom never computes isContentEditable, so the focused-host branch is
        // unreachable without declaring it on the element.
        Object.defineProperty(host, 'isContentEditable', { value: true,
          configurable: true });
        holder.appendChild(host);
      }
      body.appendChild(document.createTextNode('abc'));
      caption.appendChild(document.createTextNode('/x'));
      document.body.appendChild(holder);
      caption.focus();

      const block = { id: 'two-hosts',
        name: 'testTool',
        isEmpty: false,
        parentId: null,
        holder } as unknown as BlockAPI;
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      placeCaret(caption.childNodes[0], 2);
      caption.dispatchEvent(new Event('input', { bubbles: true }));
      await toolbox.toolButtonActivated('testTool');

      expect(api.convert).not.toHaveBeenCalled();
      expect(api.insert).toHaveBeenCalled();
    });

    it('resolves the fallback span at the slash before the caret, never a later one', async () => {
      const { block, editable } = createBlock({ text: 'a/b/c',
        isEmpty: false });
      const { toolbox, api } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[0], 3);
      await toolbox.toolButtonActivated('testTool');

      expect(api.convert).toHaveBeenCalled();
      expect(editable.textContent).toBe('a/c');
    });

    it('measures the caret from the block start when the selection is before the block', () => {
      const outsider = document.createElement('div');

      outsider.setAttribute('contenteditable', 'true');
      outsider.appendChild(document.createTextNode('elsewhere'));
      document.body.appendChild(outsider);

      const { block, editable, holder } = createBlock({ text: '/ab',
        isEmpty: false });

      document.body.insertBefore(outsider, holder);

      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      placeCaret(outsider.childNodes[0], 1);
      popoverSpies.filterItems.mockClear();
      editable.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).toHaveBeenCalledWith('ab');
    });

    it('keeps an empty text node that sits before the query', async () => {
      const { block, editable } = createBlock({ text: ['ab', '', '/x', 'cd'],
        isEmpty: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[2], 2);
      editable.dispatchEvent(new Event('input', { bubbles: true }));
      await toolbox.toolButtonActivated('testTool');

      expect(editable.textContent).toBe('abcd');
      expect(editable.childNodes).toHaveLength(3);
    });
  });

  describe('degraded hosts', () => {
    it('inserts without a transaction when the host API has none to offer', async () => {
      const { block } = createBlock({ id: 'child-block',
        parentId: 'parent-1',
        isEmpty: true });
      const { toolbox, api } = buildToolbox({ block });

      Reflect.deleteProperty(api.api.blocks, 'transact');
      await toolbox.toolButtonActivated('testTool');

      expect(api.insert).toHaveBeenCalled();
      expect(api.setBlockParent).toHaveBeenCalledWith('inserted-block', 'parent-1');
    });

    it('leaves out a tool that withdraws its toolbox config while the menu is being built', () => {
      const reads = { count: 0 };
      const withdrawing = {
        name: 'flaky',
        get toolbox(): ToolboxConfigEntry | undefined {
          reads.count += 1;

          return reads.count === 1
            ? { title: 'Flaky',
              icon: '<svg />' }
            : undefined;
        },
      } as unknown as BlockToolAdapter;

      expect(() => {
        buildToolbox({ tools: [['flaky', withdrawing]] });
      }).not.toThrow();
      expect(items()).toStrictEqual([]);
    });

    it('stops driving the filter from a block the toolbox has moved away from', () => {
      const first = createBlock({ id: 'block-a',
        text: 'aaa',
        isEmpty: false });
      const second = createBlock({ id: 'block-b',
        text: '/x',
        isEmpty: false });
      const current: { block: BlockAPI } = { block: first.block };
      const api = createApi();

      api.getBlockByIndex.mockImplementation(() => current.block);

      const toolbox = new Toolbox({
        api: api.api,
        tools: createToolsCollection([['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' })]]),
        i18nLabels: I18N_LABELS,
        i18n: { t: (key: string) => key,
          has: () => false },
      });

      toolbox.open();
      toolbox.close();
      current.block = second.block;
      toolbox.open();
      popoverSpies.filterItems.mockClear();
      first.editable.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).not.toHaveBeenCalled();
    });
  });

  describe('the SVG editable host', () => {
    it('leaves an existing label alone on a host it never marked as a combobox', () => {
      const holder = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      svg.setAttribute('contenteditable', 'true');
      svg.setAttribute('aria-label', 'Diagram');
      svg.appendChild(document.createTextNode('/ab'));
      holder.appendChild(svg);
      document.body.appendChild(holder);

      const block = { id: 'svg-block',
        name: 'testTool',
        isEmpty: false,
        parentId: null,
        holder } as unknown as BlockAPI;
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      toolbox.close();

      expect(svg.getAttribute('aria-label')).toBe('Diagram');
    });
  });

  describe('shortcut activation with no block under the caret', () => {
    it('never converts a block when the shortcut fires with no current block', async () => {
      const { api } = buildToolbox({
        tools: [['testTool', createTool('testTool', { title: 'Test',
          icon: '<svg />' }, { shortcut: 'CMD+T' })]],
      });
      const registration = vi.mocked(Shortcuts.add).mock.calls[0];

      if (registration === undefined) {
        throw new Error('Toolbox registered no shortcut to fire');
      }

      await registration[0].handler(new KeyboardEvent('keydown'));

      expect(api.convert).not.toHaveBeenCalled();
      expect(api.setToBlock).not.toHaveBeenCalled();
    });
  });

  describe('a space typed straight after the slash', () => {
    /**
     * Types into the block and reports what the Toolbox asked the popover to do.
     * @param text - the block's text, slash first
     */
    const typeInto = (text: string): { filterQueries: string[], hides: number } => {
      const { block, editable } = createBlock({ text,
        isEmpty: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      placeCaret(editable.childNodes[0], text.length);
      popoverSpies.filterItems.mockClear();
      popoverSpies.hide.mockClear();
      editable.dispatchEvent(new Event('input', { bubbles: true }));

      return { filterQueries: popoverSpies.filterItems.mock.calls.map(([query]) => query),
        hides: popoverSpies.hide.mock.calls.length };
    };

    it('cancels the menu when a plain space follows the slash', () => {
      const result = typeInto('/ ');

      expect(result.hides).toBe(1);
      expect(result.filterQueries).toStrictEqual(['']);
    });

    it('cancels the menu when a non-breaking space follows the slash', () => {
      const result = typeInto('/\u00a0');

      expect(result.hides).toBe(1);
      expect(result.filterQueries).toStrictEqual(['']);
    });

    it('keeps filtering when a real character follows the slash', () => {
      const result = typeInto('/a');

      expect(result.hides).toBe(0);
      expect(result.filterQueries).toStrictEqual(['a']);
    });
  });

  describe('the caret a non-HTML editable host reports', () => {
    it('measures the query from the block end when the host is an SVG element', () => {
      const holder = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      svg.setAttribute('contenteditable', 'true');
      svg.appendChild(document.createTextNode('/ab'));
      holder.appendChild(svg);
      document.body.appendChild(holder);

      const block = { id: 'svg-caret',
        name: 'testTool',
        isEmpty: false,
        parentId: null,
        holder } as unknown as BlockAPI;
      const { toolbox } = buildToolbox({ block });

      toolbox.open();
      placeCaret(svg.firstChild as Text, 1);
      popoverSpies.filterItems.mockClear();
      holder.dispatchEvent(new Event('input', { bubbles: true }));

      expect(popoverSpies.filterItems).toHaveBeenCalledWith('ab');
    });
  });

  /**
   * Runs a listener-throwing body while watching for the error jsdom reports on
   * window instead of failing the test.
   * @param body - the interaction to run
   */
  const errorsDuring = (body: () => void): unknown[] => {
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      errors.push(event.error ?? event.message);
    };

    window.addEventListener('error', onError);
    body();
    window.removeEventListener('error', onError);

    return errors;
  };

  describe('input on a block with nothing to search', () => {
    it('raises no window error when the input listener has no contentEditable to read', () => {
      const { block, holder } = createBlock({ editable: false,
        isEmpty: false });
      const { toolbox } = buildToolbox({ block });

      toolbox.open();

      expect(errorsDuring(() => {
        holder.dispatchEvent(new Event('input', { bubbles: true }));
      })).toStrictEqual([]);
    });
  });

  describe('block-colour commands with no block under the caret', () => {
    it('settles without rejecting when there is no block to recolour', async () => {
      const { toolbox, api } = buildToolbox({
        tools: [['paragraph', createColorTool({ textColor: false,
          backgroundColor: false })]],
      });
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown): void => {
        rejections.push(reason);
      };

      process.on('unhandledRejection', onRejection);

      toolbox.open();
      activateItem('block-color-bg-red');
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      process.off('unhandledRejection', onRejection);

      expect(rejections).toStrictEqual([]);
      expect(api.update).not.toHaveBeenCalled();
    });
  });

  describe('a rebuild that fails before the popover exists', () => {
    const gate = { armed: false };

    /**
     * A tool whose toolbox config becomes unreadable on demand — the untyped-JS
     * config shape the item builder already tolerates elsewhere.
     */
    const createFlakyTableTool = (): BlockToolAdapter => ({
      name: 'table',
      get toolbox(): ToolboxConfigEntry {
        if (gate.armed) {
          throw new Error('unreadable toolbox config');
        }

        return { title: 'Table',
          icon: '<svg />',
          section: 'basic' };
      },
    } as unknown as BlockToolAdapter);

    beforeEach(() => {
      gate.armed = false;
    });

    /**
     * A Toolbox whose popover is gone: refreshItems() destroys it, then the item
     * rebuild throws before initPopover() can construct a replacement.
     */
    const buildWithoutPopover = (): { toolbox: Toolbox, holder: HTMLElement } => {
      const { block, holder } = createBlock({ insideTableCell: true,
        text: '/x',
        isEmpty: false });
      const { toolbox } = buildToolbox({ block,
        tools: [['table', createFlakyTableTool()]] });

      gate.armed = true;
      expect(() => {
        toolbox.refreshItems();
      }).toThrowError(new Error('unreadable toolbox config'));
      gate.armed = false;

      return { toolbox,
        holder };
    };

    it('keeps every public entry point safe while the popover is missing', () => {
      const { toolbox, holder } = buildWithoutPopover();

      expect(toolbox.contains(document.createElement('div'))).toBe(false);
      expect(() => {
        toolbox.updateLeftAlignElement(document.createElement('div'));
      }).not.toThrow();
      expect(() => {
        toolbox.setCalloutBackground('red');
      }).not.toThrow();
      expect(() => {
        toolbox.open();
      }).not.toThrow();
      // The inline slash search drives the popover on every input event.
      expect(errorsDuring(() => {
        holder.dispatchEvent(new Event('input', { bubbles: true }));
      })).toStrictEqual([]);
      expect(() => {
        toolbox.close();
      }).not.toThrow();
      expect(() => {
        toolbox.destroy();
      }).not.toThrow();
    });

    it('reports the rebuild failure itself, not a crash on the missing popover', () => {
      const { toolbox } = buildWithoutPopover();

      gate.armed = true;

      expect(() => {
        toolbox.refreshItems();
      }).toThrowError(new Error('unreadable toolbox config'));
      gate.armed = false;

      expect(() => {
        toolbox.destroy();
      }).not.toThrow();
    });
  });
});

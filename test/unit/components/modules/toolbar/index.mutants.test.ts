import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { Toolbar } from '../../../../../src/components/modules/toolbar/index';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { Block } from '../../../../../src/components/block';
import { BlockHovered } from '../../../../../src/components/events/BlockHovered';
import { BlockChanged } from '../../../../../src/components/events/BlockChanged';
import { BlockSettingsOpened } from '../../../../../src/components/events/BlockSettingsOpened';
import { BlockSettingsClosed } from '../../../../../src/components/events/BlockSettingsClosed';
import { computeVisualContentOffset, resolveVisualContentWidth } from '../../../../../src/components/modules/toolbar/content-alignment';
import { getUserOS, isMobileScreen } from '../../../../../src/components/utils';
import { Toolbox } from '../../../../../src/components/ui/toolbox';

/**
 * Equivalence classifications used in this file (proven against the source):
 *
 * - `explicitlyClosed = true` initializer (L90) and `explicitlyClosed = true`
 *   in close() (L1014): the flag is only read behind
 *   `this.hoveredBlock !== null` (L1778), and both writes happen while
 *   hoveredBlock is null (it is null at construction and close() nulls it at
 *   L1010 before writing the flag), so the stored value is unobservable.
 * - `if (!calloutBlock)` guards in getCalloutBackgroundColor (L1164): with the
 *   guard removed, `calloutBlock.pluginsContent` throws inside the try and the
 *   catch returns the same null (shape 6: try-guard whose catch returns the
 *   identical value).
 * - `if (!actions)` in shieldLeftEdgeControl (L1268): the only caller checks
 *   `hasLeftEdgeInteraction && this.nodes.actions` before calling (shape 4:
 *   guard duplicated by the caller).
 * - `?.` on `this.nodes.wrapper` in open() (L1348/1350/1351) and in
 *   syncContentToBlock (L793): both callers verify wrapper before calling
 *   (shape 4: guard duplicated by the caller).
 * - `?.` on `this.toolboxInstance` in the toolbox Opened handler (L1517): the
 *   handler is registered in makeToolbox() right after the field is set and
 *   nothing nulls it afterwards (shape 11).
 * - dropping `this.hoveredBlock !== null` from the L1778 guard: the compared
 *   `hoveredBlock` payload is asserted `instanceof Block` at L1760, hence
 *   non-null, so `A !== null && A === B` is subsumed by `A === B` (shape 8).
 * - `''` → `"Stryker was here!"` in the CSS writes at L1226 and L1296 (the
 *   NOT-callout / NOT-covering branches): CSSOM rejects invalid property
 *   values, so assigning a garbage string leaves the inline declaration
 *   exactly as writing `''` does — verified against jsdom's cssstyle, which
 *   ignores `style.pointerEvents = "Stryker was here!"`.
 */

/**
 * Registry of mock instances created inside vi.mock factories. Populated when
 * Toolbar constructs its collaborators, read by the harness afterwards.
 */
const registries = vi.hoisted(() => ({
  plusButtonHandlers: [] as unknown[],
  settingsTogglerHandlers: [] as unknown[],
  positioners: [] as unknown[],
  clickDragHandlers: [] as unknown[],
  rovingControllers: [] as unknown[],
  toolboxes: [] as unknown[],
  /** one-shot: the next Toolbox instance's getElement() returns null */
  toolboxNextReturnsNull: false,
}));

/**
 * Minimal Block double. Satisfies `hoveredBlock instanceof Block` because the
 * block module is mocked with this class. Uses plain recorders (no vi.fn) so
 * it can be defined inside vi.hoisted.
 */
const BlockStub = vi.hoisted(() => {
  class BlockStub {
    public id: string;
    public name = 'paragraph';
    public holder: HTMLElement;
    public pluginsContent: HTMLElement;
    public isEmpty = false;
    public inputs: HTMLElement[] = [];
    public parentId: string | null = null;
    public contentIds: string[] = [];
    public setupDraggableCalls: unknown[][] = [];
    public cleanupDraggableCalls = 0;

    constructor(id: string) {
      this.id = id;
      this.holder = document.createElement('div');
      this.holder.setAttribute('data-blok-testid', 'block-wrapper');
      this.pluginsContent = document.createElement('div');
      this.holder.appendChild(this.pluginsContent);
    }

    public setupDraggable(...args: unknown[]): void {
      this.setupDraggableCalls.push(args);
    }

    public cleanupDraggable(): void {
      this.cleanupDraggableCalls += 1;
    }

    public getTunes(): { toolTunes: unknown[]; commonTunes: unknown[] } {
      return { toolTunes: [], commonTunes: [] };
    }
  }

  return BlockStub;
});

type BlockStubInstance = InstanceType<typeof BlockStub>;

vi.mock('../../../../../src/components/block', () => ({
  Block: BlockStub,
}));

vi.mock('../../../../../src/components/dom', () => ({
  Dom: {
    make: (tag: string, classes?: string | string[]): HTMLElement => {
      const el = document.createElement(tag);
      const classList = typeof classes === 'string' ? [classes] : classes ?? [];

      for (const cls of classList) {
        if (cls !== '') {
          el.classList.add(cls);
        }
      }

      return el;
    },
    append: (parent: HTMLElement, child: HTMLElement): void => {
      parent.appendChild(child);
    },
  },
}));

vi.mock('../../../../../src/components/utils', () => ({
  getUserOS: vi.fn((): { win: boolean; mac: boolean } => ({ win: false, mac: true })),
  isMobileScreen: vi.fn((): boolean => false),
  log: vi.fn(),
  // Listeners (imported by Module) needs generateId from this barrel.
  generateId: vi.fn((prefix: string): string => `${prefix}-1`),
}));

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  hide: vi.fn(),
  onHover: vi.fn(),
}));

vi.mock('../../../../../src/components/modules/toolbar/styles', () => ({
  getToolbarStyles: (): { [name: string]: string } => ({
    toolbar: 'tb-toolbar',
    toolbarOpened: 'tb-opened',
    toolbarClosed: 'tb-closed',
    content: 'tb-content',
    actions: 'tb-actions',
    actionsOpened: 'tb-actions-opened',
    plusButton: 'tb-plus',
    settingsToggler: 'tb-st',
    settingsTogglerHidden: 'tb-st-hidden',
    openedToolboxHolderModifier: 'tb-toolbox-opened',
  }),
}));

vi.mock('../../../../../src/components/modules/toolbar/blockSettings', () => ({
  SETTINGS_POPOVER_ID: 'blok-block-settings-popover-id',
}));

vi.mock('../../../../../src/components/modules/toolbar/content-alignment', () => ({
  computeVisualContentOffset: vi.fn((): number => 0),
  resolveVisualContentWidth: vi.fn((): number => 100),
}));

vi.mock('../../../../../src/components/modules/toolbar/positioning', () => ({
  ToolbarPositioner: class {
    public setHoveredTarget: Mock = vi.fn();
    public resetCachedPosition: Mock = vi.fn();
    public calculateToolbarY: Mock = vi.fn(() => 0);
    public moveToY: Mock = vi.fn();
    public applyContentOffset: Mock = vi.fn();
    public watchTargetResize: Mock = vi.fn();
    public stopWatchingTargetResize: Mock = vi.fn();
    public repositionToolbar: Mock = vi.fn();

    constructor() {
      registries.positioners.push(this);
    }
  },
}));

vi.mock('../../../../../src/components/modules/toolbar/click-handler', () => ({
  ClickDragHandler: class {
    public setup: Mock = vi.fn();
    public destroy: Mock = vi.fn();

    constructor() {
      registries.clickDragHandlers.push(this);
    }
  },
}));

vi.mock('../../../../../src/components/modules/toolbar/plus-button', () => ({
  TOOLBOX_POPOVER_ID: 'blok-toolbox-popover',
  PlusButtonHandler: class {
    public callbacks: unknown;
    public el: HTMLElement;
    public handleClick: Mock = vi.fn();
    public setHoveredBlock: Mock = vi.fn();
    public refreshI18n: Mock = vi.fn();

    constructor(_getBlok: unknown, callbacks: unknown) {
      this.callbacks = callbacks;
      this.el = document.createElement('button');
      this.el.setAttribute('data-blok-testid', 'plus-button');
      registries.plusButtonHandlers.push(this);
    }

    public make(nodes: { plusButton?: HTMLElement }): HTMLElement {
      // mirrors the real handler, which registers its button on the nodes bag
      // eslint-disable-next-line no-param-reassign
      nodes.plusButton = this.el;

      return this.el;
    }
  },
}));

vi.mock('../../../../../src/components/modules/toolbar/settings-toggler', () => ({
  SettingsTogglerHandler: class {
    public callbacks: unknown;
    public el: HTMLElement;
    public mousedownHandler: Mock = vi.fn();
    public setHoveredBlock: Mock = vi.fn();
    public refreshTooltip: Mock = vi.fn();
    public refreshCursor: Mock = vi.fn();
    public refreshAriaLabel: Mock = vi.fn();
    public skipNextToggle: Mock = vi.fn();
    public createMousedownHandler: Mock = vi.fn(function (this: { mousedownHandler: Mock }): Mock {
      return this.mousedownHandler;
    });

    constructor(_getBlok: unknown, _clickDrag: unknown, callbacks: unknown) {
      this.callbacks = callbacks;
      this.el = document.createElement('button');
      this.el.setAttribute('data-blok-testid', 'settings-toggler');
      registries.settingsTogglerHandlers.push(this);
    }

    public make(nodes: { settingsToggler?: HTMLElement }): HTMLElement {
      // mirrors the real handler, which registers its button on the nodes bag
      // eslint-disable-next-line no-param-reassign
      nodes.settingsToggler = this.el;

      return this.el;
    }
  },
}));

vi.mock('../../../../../src/components/utils/roving-tabindex', () => ({
  RovingTabindexController: class {
    public elements: unknown[];
    public options: unknown;
    public focusFirst: Mock = vi.fn();
    public destroy: Mock = vi.fn();

    constructor(elements: unknown[], options: unknown) {
      this.elements = elements;
      this.options = options;
      registries.rovingControllers.push(this);
    }
  },
}));

vi.mock('../../../../../src/components/ui/toolbox', () => ({
  ToolboxEvent: {
    Opened: 'toolbox-opened',
    Closed: 'toolbox-closed',
    BlockAdded: 'toolbox-block-added',
  },
  Toolbox: class {
    public opened = false;
    public element: HTMLElement;
    public handlers = new Map<string, (payload?: unknown) => void>();
    public getElementReturnsNull = false;
    public open: Mock = vi.fn(function (this: { opened: boolean }): void {
      this.opened = true;
    });
    public close: Mock = vi.fn(function (this: { opened: boolean }): void {
      this.opened = false;
    });
    public toggle: Mock = vi.fn();
    public hasFocus: Mock = vi.fn((): boolean => false);
    public contains: Mock = vi.fn((): boolean => false);
    public setCalloutBackground: Mock = vi.fn();
    public updateLeftAlignElement: Mock = vi.fn();
    public refreshItems: Mock = vi.fn();
    public setI18nLabels: Mock = vi.fn();
    public destroy: Mock = vi.fn();

    constructor() {
      this.element = document.createElement('div');
      this.element.setAttribute('data-blok-testid', 'toolbox');
      this.getElementReturnsNull = registries.toolboxNextReturnsNull;
      registries.toolboxNextReturnsNull = false;
      registries.toolboxes.push(this);
    }

    public on(event: string, cb: (payload?: unknown) => void): void {
      this.handlers.set(event, cb);
    }

    public emit(event: string, payload?: unknown): void {
      const handler = this.handlers.get(event);

      if (handler !== undefined) {
        handler(payload);
      }
    }

    public getElement(): HTMLElement | null {
      return this.getElementReturnsNull ? null : this.element;
    }
  },
}));

/**
 * Typed view of the Toolbar's non-public surface used by these tests.
 */
interface ToolbarInternals {
  toolboxInstance: ToolboxDouble | null;
  hoveredBlock: Block | null;
  hoveredBlockIsFromTableCell: boolean;
  explicitlyClosed: boolean;
  preToolboxBlock: Block | null;
  plusInsertedBlock: Block | null;
  blockBeforeToolbarFocus: Block | null;
  rovingController: { focusFirst: Mock; destroy: Mock } | null;
  positioner: { resetCachedPosition: Mock; repositionToolbar: Mock; setHoveredTarget: Mock; stopWatchingTargetResize: Mock };
  clickDragHandler: { setup: Mock; destroy: Mock };
  plusButtonHandler: { callbacks: PlusButtonCallbacks | undefined; handleClick: Mock };
  settingsTogglerHandler: { callbacks: SettingsTogglerCallbacks | undefined; createMousedownHandler: Mock; mousedownHandler: Mock };
  config: { hideToolbar?: boolean; toolbarPosition?: string };
  nodes: {
    wrapper?: HTMLElement;
    content?: HTMLElement;
    actions?: HTMLElement;
    plusButton?: HTMLElement;
    settingsToggler?: HTMLElement;
  };
  enableModuleBindings: () => void;
  disableModuleBindings: () => void;
  drawUI: () => Promise<void>;
  open: (withBlockActions?: boolean) => void;
  destroy: () => void;
  updateToolbarButtonsForCalloutFirstChild: () => void;
  onBlockSettingsOpen: () => void;
  onBlockSettingsClose: () => void;
  onBlockChanged: (payload: unknown) => void;
}

interface PlusButtonCallbacks {
  getToolboxOpened: () => boolean;
  openToolbox: () => void;
  openToolboxWithoutSlash: () => void;
  closeToolbox: () => void;
  moveAndOpenToolbar: (block?: Block | null, target?: Element | null) => void;
  onFocusBlockCaptured: (block: Block | null, insertedBlock: Block | null) => void;
}

interface SettingsTogglerCallbacks {
  setHoveredBlock: (block: Block) => void;
  getToolboxOpened: () => boolean;
  closeToolbox: () => void;
}

interface ToolboxDouble {
  opened: boolean;
  handlers: Map<string, (payload?: unknown) => void>;
  getElementReturnsNull: boolean;
  open: Mock;
  close: Mock;
  toggle: Mock;
  hasFocus: Mock;
  contains: Mock;
  setCalloutBackground: Mock;
  updateLeftAlignElement: Mock;
  refreshItems: Mock;
  setI18nLabels: Mock;
  destroy: Mock;
  element: HTMLElement;
  on: (event: string, cb: (payload?: unknown) => void) => void;
  emit: (event: string, payload?: unknown) => void;
  getElement: () => HTMLElement | null;
}

interface BlokStub {
  BlockSettings: { opened: boolean; isOpening: boolean; close: Mock; make: Mock; getElement: Mock };
  UI: { nodes: { wrapper: HTMLElement }; isMobile: boolean; resetBlockHoverState: Mock };
  BlockManager: {
    currentBlock: Block | undefined;
    blocks: Block[];
    getBlockById: Mock;
    getBlockByChildNode: Mock;
    insertAtEnd: Mock;
    lastBlock: Block | undefined;
    nextBlock: Block | undefined;
  };
  BlockSelection: { selectedBlocks: Block[] };
  ReadOnly: { isEnabled: boolean; isControlsHidden: boolean };
  DragManager: { isDragging: boolean };
  RectangleSelection: { isRectActivated: Mock; isMouseDownWithinBounds: boolean };
  Caret: { setToBlock: Mock; positions: { START: string; END: string; DEFAULT: string } };
  I18n: { t: Mock };
  API: { methods: Record<string, unknown> };
  Tools: { blockTools: Map<string, unknown> };
}

interface MutableListenersStub {
  on: (target: EventTarget, type: string, handler: (event: Event) => void, options?: boolean | AddEventListenerOptions) => void;
  clearAll: () => void;
}

interface Harness {
  toolbar: Toolbar;
  intern: ToolbarInternals;
  blok: BlokStub;
  dispatcher: { on: Mock; off: Mock };
  positioner: ToolbarInternals['positioner'];
  clickDrag: ToolbarInternals['clickDragHandler'];
  plusButton: NonNullable<ToolbarInternals['plusButtonHandler']>;
  settingsToggler: NonNullable<ToolbarInternals['settingsTogglerHandler']>;
  toolbox: ToolboxDouble;
  registered: { target: EventTarget; type: string; handler: (event: Event) => void }[];
}

type CreateToolbarOptions = {
  /** leave nodes untouched (all undefined) — for pre-make() paths */
  bareNodes?: boolean;
};

const intern = (toolbar: Toolbar): ToolbarInternals => toolbar as unknown as ToolbarInternals;

const lastOf = <T>(list: unknown[]): T => {
  const value = list.at(-1);

  if (value === undefined) {
    throw new Error('expected a registered mock instance');
  }

  return value as T;
};

const createToolbar = (options: CreateToolbarOptions = {}): Harness => {
  const dispatcher = { on: vi.fn(), off: vi.fn() };
  const toolbar = new Toolbar({
    config: {},
    eventsDispatcher: dispatcher as unknown as ModuleConfig['eventsDispatcher'],
  });

  const blok: BlokStub = {
    BlockSettings: {
      opened: false,
      isOpening: false,
      close: vi.fn(),
      make: vi.fn(),
      getElement: vi.fn(() => document.createElement('div')),
    },
    UI: {
      nodes: { wrapper: document.createElement('div') },
      isMobile: false,
      resetBlockHoverState: vi.fn(),
    },
    BlockManager: {
      currentBlock: undefined,
      blocks: [],
      getBlockById: vi.fn(),
      getBlockByChildNode: vi.fn(),
      insertAtEnd: vi.fn(),
      lastBlock: undefined,
      nextBlock: undefined,
    },
    BlockSelection: { selectedBlocks: [] },
    ReadOnly: { isEnabled: false, isControlsHidden: false },
    DragManager: { isDragging: false },
    RectangleSelection: { isRectActivated: vi.fn(() => false), isMouseDownWithinBounds: false },
    Caret: { setToBlock: vi.fn(), positions: { START: 'start', END: 'end', DEFAULT: 'default' } },
    I18n: { t: vi.fn((key: string) => `t:${key}`) },
    API: { methods: {} },
    Tools: { blockTools: new Map() },
  };

  (toolbar as unknown as { state: unknown }).state = blok;

  if (options.bareNodes !== true) {
    toolbar.nodes = {
      wrapper: document.createElement('div'),
      content: document.createElement('div'),
      actions: document.createElement('div'),
      plusButton: document.createElement('button'),
      settingsToggler: document.createElement('button'),
    };
  }

  /**
   * Recording stand-in for readOnlyMutableListeners: keeps real DOM wiring
   * (so dispatched events reach handlers) while exposing the handlers for
   * direct invocation — jsdom swallows listener exceptions on dispatch.
   */
  const registered: Harness['registered'] = [];
  const listeners: MutableListenersStub = {
    on: (target, type, handler, options) => {
      registered.push({ target, type, handler });
      target.addEventListener(type, handler, options);
    },
    clearAll: () => {
      for (const entry of registered) {
        entry.target.removeEventListener(entry.type, entry.handler);
      }
      registered.length = 0;
    },
  };
  (toolbar as unknown as { readOnlyMutableListeners: MutableListenersStub }).readOnlyMutableListeners = listeners;

  const positioner = lastOf<ToolbarInternals['positioner']>(registries.positioners);
  const clickDrag = lastOf<ToolbarInternals['clickDragHandler']>(registries.clickDragHandlers);
  const plusButton = lastOf<NonNullable<ToolbarInternals['plusButtonHandler']>>(registries.plusButtonHandlers);
  const settingsToggler = lastOf<NonNullable<ToolbarInternals['settingsTogglerHandler']>>(registries.settingsTogglerHandlers);
  const ToolboxCtor = Toolbox as unknown as new () => ToolboxDouble;
  const toolbox = new ToolboxCtor();

  intern(toolbar).toolboxInstance = toolbox;

  return { toolbar, intern: intern(toolbar), blok, dispatcher, positioner, clickDrag, plusButton, settingsToggler, toolbox, registered };
};

type BlockOverrides = {
  id: string;
  name?: string;
  isEmpty?: boolean;
  parentId?: string | null;
  contentIds?: string[];
  inputs?: HTMLElement[];
  backgroundColor?: string;
  withContentElement?: boolean;
};

const makeBlock = (overrides: BlockOverrides): Block => {
  const block = new BlockStub(overrides.id);

  if (overrides.name !== undefined) {
    block.name = overrides.name;
  }
  if (overrides.isEmpty !== undefined) {
    block.isEmpty = overrides.isEmpty;
  }
  if (overrides.parentId !== undefined) {
    block.parentId = overrides.parentId;
  }
  if (overrides.contentIds !== undefined) {
    block.contentIds = overrides.contentIds;
  }
  if (overrides.inputs !== undefined) {
    block.inputs = overrides.inputs;
  }
  if (overrides.backgroundColor !== undefined) {
    block.pluginsContent.style.backgroundColor = overrides.backgroundColor;
  }
  if (overrides.withContentElement === true) {
    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');
    block.holder.appendChild(content);
  }

  return block as unknown as Block;
};

const enableBindings = (h: Harness): void => {
  h.intern.enableModuleBindings();
};

const getDispatcherHandler = (h: Harness, eventKey: string): ((data: unknown) => void) => {
  const call = h.dispatcher.on.mock.calls.find((args) => args[0] === eventKey);

  if (call === undefined) {
    throw new Error(`no handler registered for ${eventKey}`);
  }

  return call[1] as (data: unknown) => void;
};

const getRegisteredListener = (h: Harness, target: EventTarget, type: string): ((event: Event) => void) => {
  const entry = h.registered.find((candidate) => candidate.target === target && candidate.type === type);

  if (entry === undefined) {
    throw new Error(`no listener registered for ${type}`);
  }

  return entry.handler;
};

/** narrows an optional node to an EventTarget for listener lookups */
const targetOf = (el: HTMLElement | undefined): EventTarget => {
  if (el === undefined) {
    throw new Error('node is missing');
  }

  return el;
};

const hover = (h: Harness, data: unknown): void => {
  getDispatcherHandler(h, BlockHovered)(data);
};

const emitBlockChanged = (h: Harness, changedBlockId: string): void => {
  getDispatcherHandler(h, BlockChanged)({
    event: { detail: { target: { id: changedBlockId } } },
  });
};

/** stubs getBoundingClientRect on an element with explicit edge coordinates */
const rectOf = (el: HTMLElement, left: number, top: number, right: number, bottom: number): void => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: (): { left: number; top: number; right: number; bottom: number } => ({ left, top, right, bottom }),
  });
};

const blurActiveElement = (): void => {
  const active = document.activeElement;

  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(computeVisualContentOffset).mockReturnValue(0);
  vi.mocked(resolveVisualContentWidth).mockReturnValue(100);
  vi.mocked(isMobileScreen).mockReturnValue(false);
  vi.mocked(getUserOS).mockReturnValue({ win: false, mac: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Toolbar constructor callbacks', () => {
  it('reports the toolbox closed before initialization through both handlers', () => {
    const h = createToolbar();

    expect(h.plusButton.callbacks?.getToolboxOpened()).toBe(false);
    expect(h.settingsToggler.callbacks?.getToolboxOpened()).toBe(false);

    h.toolbox.opened = true;
    expect(h.plusButton.callbacks?.getToolboxOpened()).toBe(true);
    expect(h.settingsToggler.callbacks?.getToolboxOpened()).toBe(true);
  });

  it('reports the toolbox closed when the instance was never created', () => {
    const h = createToolbar();

    h.intern.toolboxInstance = null;

    expect(h.plusButton.callbacks?.getToolboxOpened()).toBe(false);
    expect(h.settingsToggler.callbacks?.getToolboxOpened()).toBe(false);
  });

  it('wires openToolbox and closeToolbox to the toolbox instance', () => {
    const h = createToolbar();

    h.plusButton.callbacks?.openToolbox();
    expect(h.toolbox.open).toHaveBeenCalledTimes(1);

    h.plusButton.callbacks?.closeToolbox();
    expect(h.toolbox.close).toHaveBeenCalledTimes(1);

    h.settingsToggler.callbacks?.closeToolbox();
    expect(h.toolbox.close).toHaveBeenCalledTimes(2);
  });

  it('routes moveAndOpenToolbar through to moveAndOpen with both arguments', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const target = document.createElement('div');
    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');

    h.plusButton.callbacks?.moveAndOpenToolbar(blockA, target);

    expect(spy).toHaveBeenCalledWith(blockA, target);
  });

  it('captures the pre-toolbox focus context via onFocusBlockCaptured', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const inserted = makeBlock({ id: 'inserted' });

    h.plusButton.callbacks?.onFocusBlockCaptured(blockA, inserted);

    expect(h.intern.preToolboxBlock).toBe(blockA);
    expect(h.intern.plusInsertedBlock).toBe(inserted);
  });

  it('lets the settings toggler handler set the hovered block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.intern.hoveredBlock = null;
    h.settingsToggler.callbacks?.setHoveredBlock(blockA);

    expect(h.intern.hoveredBlock).toBe(blockA);
  });
});

describe('Toolbar.opened getter', () => {
  it('returns false without throwing before the toolbar DOM exists', () => {
    const h = createToolbar({ bareNodes: true });

    expect(() => h.toolbar.opened).not.toThrow();
    expect(h.toolbar.opened).toBe(false);
  });

  it('reads the opened class from the wrapper', () => {
    const h = createToolbar();

    h.intern.nodes.wrapper?.classList.add('tb-opened');
    expect(h.toolbar.opened).toBe(true);

    h.intern.nodes.wrapper?.classList.remove('tb-opened');
    expect(h.toolbar.opened).toBe(false);
  });
});

describe('Toolbar toolbox facade', () => {
  it('openWithoutSlash promotes the hovered block when the current block is outside cells', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'hovered' });
    const blockB = makeBlock({ id: 'current' });

    h.intern.hoveredBlock = blockA;
    h.intern.hoveredBlockIsFromTableCell = false;
    h.blok.BlockManager.currentBlock = blockB;

    h.toolbar.toolbox.openWithoutSlash();

    expect(h.blok.BlockManager.currentBlock).toBe(blockA);
    expect(h.toolbox.open).toHaveBeenCalledWith(false);
  });

  it('openWithoutSlash survives an undefined current block outside cells', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'hovered' });

    h.intern.hoveredBlock = blockA;
    h.intern.hoveredBlockIsFromTableCell = false;
    h.blok.BlockManager.currentBlock = undefined;

    // the undefined check must short-circuit before the holder is touched
    expect(() => h.toolbar.toolbox.openWithoutSlash()).not.toThrow();
  });

  it('openWithoutSlash keeps a cell paragraph as the current block', () => {
    const h = createToolbar();

    const tableHolder = document.createElement('div');
    tableHolder.setAttribute('data-blok-testid', 'block-wrapper');
    const cellContainer = document.createElement('div');
    cellContainer.setAttribute('data-blok-table-cell-blocks', '');
    tableHolder.appendChild(cellContainer);
    const cellHolder = document.createElement('div');
    cellContainer.appendChild(cellHolder);

    const cellBlock = makeBlock({ id: 'cell-paragraph' });
    (cellBlock as unknown as BlockStubInstance).holder = cellHolder;
    const tableBlock = makeBlock({ id: 'table' });

    h.intern.hoveredBlock = tableBlock;
    h.intern.hoveredBlockIsFromTableCell = false;
    h.blok.BlockManager.currentBlock = cellBlock;

    h.toolbar.toolbox.openWithoutSlash();

    expect(h.blok.BlockManager.currentBlock).toBe(cellBlock);
    expect(h.toolbox.open).toHaveBeenCalledWith(false);
  });

  it('the table-cell flag starts false so the hovered block is promoted', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    h.intern.hoveredBlock = blockA;
    h.blok.BlockManager.currentBlock = blockB;

    h.toolbar.toolbox.open();

    expect(h.blok.BlockManager.currentBlock).toBe(blockA);
  });

  it('open promotes the hovered block to current when the current block is not in a cell', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'hovered' });
    const blockB = makeBlock({ id: 'current' });

    h.intern.hoveredBlock = blockA;
    h.intern.hoveredBlockIsFromTableCell = false;
    h.blok.BlockManager.currentBlock = blockB;

    h.toolbar.toolbox.open();

    expect(h.blok.BlockManager.currentBlock).toBe(blockA);
    expect(h.toolbox.open).toHaveBeenCalledTimes(1);
  });

  it('toggle and hasFocus reach the toolbox instance', () => {
    const h = createToolbar();

    h.toolbar.toolbox.toggle();
    expect(h.toolbox.toggle).toHaveBeenCalledTimes(1);

    expect(h.toolbar.toolbox.hasFocus()).toBe(false);
    expect(h.toolbar.toolbox.opened).toBe(false);
  });
});

describe('Toolbar block actions visibility', () => {
  it('hideBlockActions tolerates a missing actions node', () => {
    const h = createToolbar();

    h.intern.nodes.actions = undefined;

    expect(() => h.toolbar.hideBlockActions()).not.toThrow();
  });

  it('moveAndOpen shows the actions bar', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.toolbar.hideBlockActions();
    h.toolbar.moveAndOpen(blockA);

    const actions = h.intern.nodes.actions;
    expect(actions?.classList.contains('tb-actions-opened')).toBe(true);
    expect(actions?.getAttribute('data-blok-opened')).toBe('true');
    expect(actions?.style.pointerEvents).toBe('auto');
    expect(h.toolbar.opened).toBe(true);
    expect(h.intern.nodes.wrapper?.getAttribute('data-blok-opened')).toBe('true');
  });

  it('moveAndOpen tolerates a missing actions node', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.intern.nodes.actions = undefined;

    expect(() => h.toolbar.moveAndOpen(blockA)).not.toThrow();
    expect(h.toolbar.opened).toBe(true);
  });

  it('open(false) hides the actions bar', () => {
    const h = createToolbar();

    h.intern.open();
    h.intern.open(false);

    const actions = h.intern.nodes.actions;
    expect(actions?.classList.contains('tb-actions-opened')).toBe(false);
    expect(actions?.getAttribute('data-blok-opened')).toBeNull();
    expect(actions?.style.pointerEvents).toBe('none');
  });
});

describe('Toolbar block tunes toggler', () => {
  it('hides the settings toggler for a single empty block without tunes', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a', isEmpty: true });

    h.blok.BlockManager.blocks = [blockA];

    h.toolbar.moveAndOpen(blockA);

    expect(h.intern.nodes.settingsToggler?.classList.contains('tb-st-hidden')).toBe(true);
  });

  it('tunes-toggler hide tolerates a missing settings toggler node', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a', isEmpty: true });

    h.blok.BlockManager.blocks = [blockA];
    h.intern.nodes.settingsToggler = undefined;

    expect(() => h.toolbar.moveAndOpen(blockA)).not.toThrow();
    expect(h.toolbar.opened).toBe(true);
  });

  it('shows the settings toggler when the block has content', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    h.intern.nodes.settingsToggler?.classList.add('tb-st-hidden');
    h.blok.BlockManager.blocks = [blockA, blockB];

    h.toolbar.moveAndOpen(blockA);

    expect(h.intern.nodes.settingsToggler?.classList.contains('tb-st-hidden')).toBe(false);
  });

  it('tunes-toggler show tolerates a missing settings toggler node', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    h.blok.BlockManager.blocks = [blockA, blockB];
    h.intern.nodes.settingsToggler = undefined;

    expect(() => h.toolbar.moveAndOpen(blockA)).not.toThrow();
    expect(h.toolbar.opened).toBe(true);
  });
});

describe('Toolbar.toggleReadOnly', () => {
  it('defers drawing to the idle callback when the toolbar has not been drawn', async () => {
    const h = createToolbar({ bareNodes: true });
    const idleOptions: unknown[] = [];
    let idleCallback: (() => Promise<void>) | undefined;

    vi.stubGlobal('requestIdleCallback', (cb: () => Promise<void>, opts?: unknown): number => {
      idleCallback = cb;
      idleOptions.push(opts);

      return 1;
    });

    h.toolbar.toggleReadOnly(true);

    expect(idleOptions).toEqual([{ timeout: 2000 }]);
    expect(h.intern.nodes.wrapper).toBeUndefined();

    await idleCallback?.();

    expect(h.intern.nodes.wrapper?.classList.contains('tb-toolbar')).toBe(true);
    expect(h.intern.nodes.plusButton?.style.display).toBe('none');
    expect(h.dispatcher.on.mock.calls.some((args) => args[0] === BlockHovered)).toBe(true);
  });

  it('closes an open toolbar when read-only hides controls', () => {
    const h = createToolbar();

    h.intern.nodes.wrapper?.classList.add('tb-opened');
    h.blok.ReadOnly.isControlsHidden = true;

    h.toolbar.toggleReadOnly(true);

    expect(h.intern.nodes.wrapper?.classList.contains('tb-closed')).toBe(true);
    expect(h.intern.nodes.wrapper?.classList.contains('tb-opened')).toBe(false);
    expect(h.blok.BlockSettings.close).toHaveBeenCalledTimes(1);
    expect(h.blok.UI.resetBlockHoverState).toHaveBeenCalledTimes(1);
  });

  it('keeps the toolbar open when controls are not hidden', () => {
    const h = createToolbar();

    h.intern.nodes.wrapper?.classList.add('tb-opened');
    h.blok.ReadOnly.isControlsHidden = false;

    h.toolbar.toggleReadOnly(true);

    expect(h.intern.nodes.wrapper?.classList.contains('tb-opened')).toBe(true);
  });

  it('hides the plus button in read-only and restores it otherwise', () => {
    const h = createToolbar();

    h.toolbar.toggleReadOnly(true);
    expect(h.intern.nodes.plusButton?.style.display).toBe('none');

    h.toolbar.toggleReadOnly(false);
    expect(h.intern.nodes.plusButton?.style.display).toBe('');
  });

  it('tolerates a missing plus button node', () => {
    const h = createToolbar();

    h.intern.nodes.plusButton = undefined;

    expect(() => h.toolbar.toggleReadOnly(true)).not.toThrow();
  });
});

describe('Toolbar.setHidden / setPosition', () => {
  it('setHidden toggles the wrapper attribute and closes an open toolbar', () => {
    const h = createToolbar();

    h.intern.nodes.wrapper?.classList.add('tb-opened');

    h.toolbar.setHidden(true);

    expect(h.intern.config.hideToolbar).toBe(true);
    expect(h.blok.UI.nodes.wrapper.hasAttribute('data-blok-toolbar-hidden')).toBe(true);
    expect(h.intern.nodes.wrapper?.classList.contains('tb-opened')).toBe(false);

    h.toolbar.setHidden(false);

    expect(h.intern.config.hideToolbar).toBe(false);
    expect(h.blok.UI.nodes.wrapper.hasAttribute('data-blok-toolbar-hidden')).toBe(false);
  });

  it('setHidden tolerates a missing editor wrapper', () => {
    const h = createToolbar();

    h.blok.UI.nodes.wrapper = undefined as unknown as HTMLElement;

    expect(() => h.toolbar.setHidden(true)).not.toThrow();
    expect(h.intern.config.hideToolbar).toBe(true);
  });

  it('setPosition writes the wrapper attribute', () => {
    const h = createToolbar();

    h.toolbar.setPosition('right');

    expect(h.intern.config.toolbarPosition).toBe('right');
    expect(h.blok.UI.nodes.wrapper.getAttribute('data-blok-toolbar-position')).toBe('right');
  });

  it('setPosition tolerates a missing editor wrapper', () => {
    const h = createToolbar();

    h.blok.UI.nodes.wrapper = undefined as unknown as HTMLElement;

    expect(() => h.toolbar.setPosition('right')).not.toThrow();
    expect(h.intern.config.toolbarPosition).toBe('right');
  });
});

describe('Toolbar.moveAndOpen', () => {
  it('moves to the block and resets the cached position', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const target = document.createElement('div');

    h.toolbar.moveAndOpen(blockA, target);

    expect(h.positioner.resetCachedPosition).toHaveBeenCalledTimes(1);
    expect(h.positioner.setHoveredTarget).toHaveBeenCalledWith(target);
    expect(h.intern.hoveredBlock).toBe(blockA);
    expect((blockA as unknown as BlockStubInstance).setupDraggableCalls.length).toBe(1);
  });

  it('promotes the hovered block on toolbox.open after a hover with a plain target', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });
    const target = document.createElement('div');

    h.blok.BlockManager.currentBlock = blockB;
    h.toolbar.moveAndOpen(blockA, target);
    h.toolbar.toolbox.open();

    expect(h.blok.BlockManager.currentBlock).toBe(blockA);
  });

  it('tolerates a missing settings toggler node', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.intern.nodes.settingsToggler = undefined;

    expect(() => h.toolbar.moveAndOpen(blockA)).not.toThrow();
    expect(h.toolbar.opened).toBe(true);
  });

  it('does not treat a plain header as a left-edge toggle header', () => {
    const h = createToolbar();
    const headerBlock = makeBlock({ id: 'h', name: 'header' });

    h.toolbar.moveAndOpen(headerBlock);

    expect(h.intern.nodes.actions?.style.pointerEvents).toBe('auto');
  });

  it('does not treat an arrow-bearing non-header block as a toggle header', () => {
    const h = createToolbar();
    const block = makeBlock({ id: 'p', name: 'paragraph' });
    const arrow = document.createElement('span');

    arrow.setAttribute('data-blok-toggle-arrow', '');
    block.holder.appendChild(arrow);

    const actions = h.intern.nodes.actions;

    if (actions === undefined) {
      throw new Error('actions missing');
    }
    // make the bar geometrically cover the control: only a wrongly-run shield
    // would blank the whole bar
    rectOf(arrow, 0, 0, 10, 10);
    rectOf(actions, 0, 0, 10, 10);

    h.toolbar.moveAndOpen(block);

    expect(actions.style.pointerEvents).toBe('auto');
  });

  it('syncs content margin with a missing actions node defaulting its width to 0', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a', withContentElement: true });

    vi.mocked(computeVisualContentOffset).mockReturnValue(7);
    h.intern.nodes.actions = undefined;

    h.toolbar.moveAndOpen(blockA);

    expect(h.intern.nodes.content?.style.marginLeft).toBe('7px');
  });

  it('end-dock clamp falls back to the raw offset when the wrapper has no rect', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a', withContentElement: true });

    h.toolbar.setPosition('right');
    const wrapper = h.intern.nodes.wrapper;

    if (wrapper === undefined) {
      throw new Error('wrapper missing');
    }
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(undefined as unknown as DOMRect);
    vi.mocked(computeVisualContentOffset).mockReturnValue(5);

    h.toolbar.moveAndOpen(blockA);

    expect(h.intern.nodes.content?.style.marginLeft).toBe('5px');
  });

  it('resolves a cell block without a block-wrapper ancestor to itself', () => {
    const h = createToolbar();

    const cellContainer = document.createElement('div');
    cellContainer.setAttribute('data-blok-table-cell-blocks', '');
    const cellHolder = document.createElement('div');
    cellContainer.appendChild(cellHolder);

    const cellBlock = makeBlock({ id: 'cell' });
    (cellBlock as unknown as BlockStubInstance).holder = cellHolder;
    const tableBlock = makeBlock({ id: 'table' });

    h.blok.BlockManager.getBlockByChildNode.mockReturnValue(tableBlock);

    h.toolbar.moveAndOpen(cellBlock);

    expect(h.intern.hoveredBlock).toBe(cellBlock);
  });

  it('cleans up the draggable of the previously hovered block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    h.toolbar.moveAndOpen(blockA);
    h.toolbar.moveAndOpen(blockB);

    expect((blockA as unknown as BlockStubInstance).cleanupDraggableCalls).toBe(1);
  });

  it('returns early when the toolbar is not initialized yet', () => {
    const h = createToolbar();

    h.intern.toolboxInstance = null;

    expect(() => h.toolbar.moveAndOpen(makeBlock({ id: 'a' }))).not.toThrow();
    expect(h.toolbar.opened).toBe(false);
  });

  it('returns early when the current block is missing', () => {
    const h = createToolbar();

    h.blok.BlockManager.currentBlock = undefined;

    expect(() => h.toolbar.moveAndOpen()).not.toThrow();
    expect(h.toolbar.opened).toBe(false);
  });
});

describe('Toolbar.moveAndOpenForMultipleBlocks', () => {
  const twoSelected = (harness: Harness): { blockA: Block; blockB: Block } => {
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    // harness mutation helper
    // eslint-disable-next-line no-param-reassign
    harness.blok.BlockSelection.selectedBlocks = [blockA, blockB];

    return { blockA, blockB };
  };

  it('moves to the first selected block and shows the toggler', () => {
    const h = createToolbar();
    const { blockA } = twoSelected(h);

    h.toolbar.moveAndOpenForMultipleBlocks(blockA);

    expect(h.intern.hoveredBlock).toBe(blockA);
    expect(h.intern.nodes.plusButton?.style.display).toBe('');
    expect(h.toolbar.opened).toBe(true);
    expect(h.positioner.resetCachedPosition).toHaveBeenCalledTimes(1);
  });

  it('tolerates a missing settings toggler node', () => {
    const h = createToolbar();
    const { blockA } = twoSelected(h);

    h.intern.nodes.settingsToggler = undefined;

    expect(() => h.toolbar.moveAndOpenForMultipleBlocks(blockA)).not.toThrow();
    expect(h.toolbar.opened).toBe(true);
  });

  it('does nothing while block settings are open or opening', () => {
    const h = createToolbar();
    const { blockA } = twoSelected(h);

    h.blok.BlockSettings.opened = true;
    h.toolbar.moveAndOpenForMultipleBlocks(blockA);
    expect(h.toolbar.opened).toBe(false);

    h.blok.BlockSettings.opened = false;
    h.blok.BlockSettings.isOpening = true;
    h.toolbar.moveAndOpenForMultipleBlocks(blockA);
    expect(h.toolbar.opened).toBe(false);
  });

  it('does nothing for fewer than two selected blocks', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.blok.BlockSelection.selectedBlocks = [blockA];

    expect(() => h.toolbar.moveAndOpenForMultipleBlocks(blockA)).not.toThrow();
    expect(h.toolbar.opened).toBe(false);
  });
});

describe('Toolbar.close', () => {
  it('restores buttons and clears the open state', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.toolbar.moveAndOpen(blockA);
    h.intern.nodes.plusButton?.style.setProperty('display', 'none');
    h.toolbar.close();

    expect(h.intern.nodes.wrapper?.classList.contains('tb-closed')).toBe(true);
    expect(h.intern.nodes.wrapper?.classList.contains('tb-opened')).toBe(false);
    expect(h.intern.nodes.plusButton?.style.display).toBe('');
    expect(h.toolbox.close).toHaveBeenCalledTimes(1);
    expect(h.blok.BlockSettings.close).toHaveBeenCalledTimes(1);
    expect(h.positioner.setHoveredTarget).toHaveBeenCalledWith(null);
    expect(h.positioner.stopWatchingTargetResize).toHaveBeenCalledTimes(1);
    expect(h.intern.nodes.actions?.style.transform).toBe('');
    expect(h.intern.nodes.content?.style.marginLeft).toBe('');
    expect(h.intern.hoveredBlock).toBeNull();
  });

  it('resets the table-cell hover flag so the next hover promotes the block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    h.toolbar.moveAndOpen(blockA);
    h.toolbar.close();

    h.intern.hoveredBlock = blockA;
    h.blok.BlockManager.currentBlock = blockB;

    h.toolbar.toolbox.open();

    expect(h.blok.BlockManager.currentBlock).toBe(blockA);
  });

  it('keeps the toolbar closable when every node is missing', () => {
    const h = createToolbar({ bareNodes: true });

    expect(() => h.toolbar.close()).not.toThrow();
    expect(h.blok.BlockSettings.close).toHaveBeenCalledTimes(1);
  });
});

describe('Toolbar.resetExplicitlyClosed', () => {
  it('lets the same block reopen the toolbar after an explicit close', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.intern.explicitlyClosed = true;
    h.intern.hoveredBlock = blockA;
    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');

    h.toolbar.resetExplicitlyClosed();
    hover(h, { block: blockA });

    expect(spy).toHaveBeenCalledWith(blockA, undefined);
  });
});

describe('Toolbar BlockHovered handler', () => {
  it('opens the toolbar beside the hovered block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    hover(h, { block: blockA });

    expect(spy).toHaveBeenCalledWith(blockA, undefined);
  });

  it('opens the toolbar beside the hovered block with its target', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const target = document.createElement('div');

    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    hover(h, { block: blockA, target });

    expect(spy).toHaveBeenCalledWith(blockA, target);
  });

  it('keeps the toolbar closed while a drag or rectangle selection is active', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');

    h.blok.DragManager.isDragging = true;
    hover(h, { block: blockA });
    expect(spy).not.toHaveBeenCalled();

    h.blok.DragManager.isDragging = false;
    h.blok.RectangleSelection.isRectActivated.mockReturnValue(true);
    hover(h, { block: blockA });
    expect(spy).not.toHaveBeenCalled();

    h.blok.RectangleSelection.isRectActivated.mockReturnValue(false);
    h.blok.RectangleSelection.isMouseDownWithinBounds = true;
    hover(h, { block: blockA });
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores hover payloads whose block is not a Block instance', () => {
    const h = createToolbar();

    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    hover(h, { block: { id: 'plain-object' } });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does not move while block settings are open', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.blok.BlockSettings.opened = true;
    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    hover(h, { block: blockA });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does not move while the toolbox is open', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.toolbox.opened = true;
    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    hover(h, { block: blockA });

    expect(spy).not.toHaveBeenCalled();
  });

  it('moves even when the toolbox was never initialized', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.intern.toolboxInstance = null;
    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    hover(h, { block: blockA });

    expect(spy).toHaveBeenCalledWith(blockA, undefined);
  });

  it('reopens for a different block while explicitly closed', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');

    h.toolbar.moveAndOpen(blockA);
    h.toolbar.close();
    h.intern.hoveredBlock = blockA;

    hover(h, { block: blockB });

    expect(spy).toHaveBeenCalledWith(blockB, undefined);
  });

  it('does not reopen the same block twice without a close in between', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');

    hover(h, { block: blockA });
    hover(h, { block: blockA });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('skips the hover subscription on mobile screens', () => {
    const h = createToolbar();

    vi.mocked(isMobileScreen).mockReturnValue(true);
    enableBindings(h);

    expect(h.dispatcher.on.mock.calls.some((args) => args[0] === BlockHovered)).toBe(false);
  });

  it('multi-select hover of a selected block moves for multiple blocks', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    h.blok.BlockSelection.selectedBlocks = [blockA, blockB];
    enableBindings(h);

    const multiSpy = vi.spyOn(h.toolbar, 'moveAndOpenForMultipleBlocks');
    const singleSpy = vi.spyOn(h.toolbar, 'moveAndOpen');

    hover(h, { block: blockA });

    expect(multiSpy).toHaveBeenCalledWith(blockA);
    expect(singleSpy).not.toHaveBeenCalled();
  });

  it('multi-select hover outside the selection does nothing', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });
    const stranger = makeBlock({ id: 'stranger' });

    h.blok.BlockSelection.selectedBlocks = [blockA, blockB];
    enableBindings(h);

    const multiSpy = vi.spyOn(h.toolbar, 'moveAndOpenForMultipleBlocks');
    const singleSpy = vi.spyOn(h.toolbar, 'moveAndOpen');

    hover(h, { block: stranger });

    expect(multiSpy).not.toHaveBeenCalled();
    expect(singleSpy).not.toHaveBeenCalled();
  });

  it('single selected block hover moves the toolbar normally', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.blok.BlockSelection.selectedBlocks = [blockA];
    enableBindings(h);

    const multiSpy = vi.spyOn(h.toolbar, 'moveAndOpenForMultipleBlocks');
    const singleSpy = vi.spyOn(h.toolbar, 'moveAndOpen');

    hover(h, { block: blockA });

    expect(singleSpy).toHaveBeenCalledWith(blockA, undefined);
    expect(multiSpy).not.toHaveBeenCalled();
  });

  it('keeps reopening for multiple blocks across repeated hovers of the same block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });
    const blockB = makeBlock({ id: 'b' });

    h.blok.BlockSelection.selectedBlocks = [blockA, blockB];
    enableBindings(h);

    const multiSpy = vi.spyOn(h.toolbar, 'moveAndOpenForMultipleBlocks');

    hover(h, { block: blockA });
    hover(h, { block: blockA });

    expect(multiSpy).toHaveBeenCalledTimes(2);
  });
});

describe('Toolbar onBlockChanged handler', () => {
  const openOnBlock = (harness: Harness, block: Block): void => {
    harness.intern.nodes.wrapper?.classList.add('tb-opened');
    // harness mutation helper
    // eslint-disable-next-line no-param-reassign
    harness.intern.hoveredBlock = block;
  };

  it('repositions for the hovered block while the toolbar is open', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    openOnBlock(h, blockA);
    enableBindings(h);
    emitBlockChanged(h, 'a');

    expect(h.positioner.repositionToolbar).toHaveBeenCalledTimes(1);
  });

  it('repositions even when the toolbox was never initialized', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.intern.toolboxInstance = null;
    openOnBlock(h, blockA);
    enableBindings(h);
    emitBlockChanged(h, 'a');

    expect(h.positioner.repositionToolbar).toHaveBeenCalledTimes(1);
  });

  it('skips repositioning while the toolbar is closed', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.intern.hoveredBlock = blockA;
    enableBindings(h);
    emitBlockChanged(h, 'a');

    expect(h.positioner.repositionToolbar).not.toHaveBeenCalled();
  });

  it('skips safely when nothing is hovered', () => {
    const h = createToolbar();

    h.intern.nodes.wrapper?.classList.add('tb-opened');
    h.intern.hoveredBlock = null;
    enableBindings(h);

    expect(() => emitBlockChanged(h, 'a')).not.toThrow();
    expect(h.positioner.repositionToolbar).not.toHaveBeenCalled();
  });

  it('skips repositioning while block settings are open', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    openOnBlock(h, blockA);
    h.blok.BlockSettings.opened = true;
    enableBindings(h);
    emitBlockChanged(h, 'a');

    expect(h.positioner.repositionToolbar).not.toHaveBeenCalled();
  });

  it('skips changes belonging to a different block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    openOnBlock(h, blockA);
    enableBindings(h);
    emitBlockChanged(h, 'other-block');

    expect(h.positioner.repositionToolbar).not.toHaveBeenCalled();
  });
});

describe('Toolbar block settings open/close handlers', () => {
  it('stamps the opened state on the wrapper and the toggler', () => {
    const h = createToolbar();

    h.intern.onBlockSettingsOpen();

    expect(h.blok.UI.nodes.wrapper.getAttribute('data-blok-block-settings-opened')).toBe('true');
    expect(h.intern.nodes.settingsToggler?.getAttribute('aria-expanded')).toBe('true');
  });

  it('removes the opened state on close', () => {
    const h = createToolbar();

    h.intern.onBlockSettingsOpen();
    h.intern.onBlockSettingsClose();

    expect(h.blok.UI.nodes.wrapper.hasAttribute('data-blok-block-settings-opened')).toBe(false);
    expect(h.intern.nodes.settingsToggler?.getAttribute('aria-expanded')).toBe('false');
  });

  it('tolerates a missing settings toggler node', () => {
    const h = createToolbar();

    h.intern.nodes.settingsToggler = undefined;

    expect(() => h.intern.onBlockSettingsOpen()).not.toThrow();
    expect(() => h.intern.onBlockSettingsClose()).not.toThrow();
  });
});

describe('Toolbar.drawUI / make', () => {
  it('draws the full toolbar DOM', async () => {
    const h = createToolbar({ bareNodes: true });

    await h.intern.drawUI();

    const wrapper = h.intern.nodes.wrapper;
    const actions = h.intern.nodes.actions;
    const toggler = h.intern.nodes.settingsToggler;

    expect(wrapper?.classList.contains('tb-toolbar')).toBe(true);
    expect(wrapper?.classList.contains('tb-closed')).toBe(true);
    expect(wrapper?.classList.contains('group-data-[blok-dragging=true]:pointer-events-none')).toBe(true);
    expect(wrapper?.hasAttribute('data-blok-toolbar')).toBe(true);
    expect(wrapper?.getAttribute('data-blok-toolbar')).toBe('');
    expect(wrapper?.getAttribute('data-blok-testid')).toBe('toolbar');
    expect(h.blok.UI.nodes.wrapper.contains(wrapper ?? null)).toBe(true);

    expect(actions?.classList.contains('tb-actions')).toBe(true);
    expect(actions?.style.pointerEvents).toBe('none');
    expect(actions?.hasAttribute('data-blok-toolbar-actions')).toBe(true);
    expect(actions?.getAttribute('data-blok-toolbar-actions')).toBe('');
    expect(actions?.getAttribute('data-blok-testid')).toBe('toolbar-actions');

    expect(toggler?.getAttribute('aria-haspopup')).toBe('menu');
    expect(toggler?.getAttribute('aria-expanded')).toBe('false');
    expect(actions?.contains(toggler ?? null)).toBe(true);

    const toolboxInstance = lastOf<ToolboxDouble>(registries.toolboxes);
    expect(actions?.contains(toolboxInstance.element)).toBe(true);

    const blockSettingsElement = h.blok.BlockSettings.getElement.mock.results[0]?.value as HTMLElement;
    expect(actions?.contains(blockSettingsElement)).toBe(true);

    const roving = lastOf<{ elements: unknown[]; options: unknown }>(registries.rovingControllers);
    expect(roving.elements).toContain(h.intern.nodes.plusButton);
    expect(roving.elements).toContain(toggler);
    expect(roving.options).toEqual({ orientation: 'horizontal', tabbable: false });
  });

  it('rejects when the block settings element is missing', async () => {
    const h = createToolbar({ bareNodes: true });

    h.blok.BlockSettings.getElement.mockReturnValue(null);

    await expect(h.intern.drawUI()).rejects.toThrowError(new Error('Block Settings element was not created'));
  });

  it('rejects when the toolbox element is missing', async () => {
    const h = createToolbar({ bareNodes: true });

    registries.toolboxNextReturnsNull = true;

    await expect(h.intern.drawUI()).rejects.toThrowError(new Error('Toolbox element was not created'));
  });
});

describe('Toolbar toolbox events', () => {
  const drawAndGetToolbox = async (h: Harness): Promise<ToolboxDouble> => {
    await h.intern.drawUI();

    return lastOf<ToolboxDouble>(registries.toolboxes);
  };

  it('toolbox opened stamps the editor state and reports a null callout background', async () => {
    const h = createToolbar({ bareNodes: true });
    const tb = await drawAndGetToolbox(h);

    tb.emit('toolbox-opened');

    expect(h.blok.UI.nodes.wrapper.classList.contains('tb-toolbox-opened')).toBe(true);
    expect(h.blok.UI.nodes.wrapper.getAttribute('data-blok-toolbox-opened')).toBe('true');
    expect(h.intern.nodes.plusButton?.getAttribute('aria-expanded')).toBe('true');
    expect(tb.setCalloutBackground).toHaveBeenCalledWith(null);
  });

  it('toolbox opened repositions while a block is hovered', async () => {
    const h = createToolbar({ bareNodes: true });
    const tb = await drawAndGetToolbox(h);

    h.intern.hoveredBlock = makeBlock({ id: 'a' });
    tb.emit('toolbox-opened');

    expect(h.positioner.repositionToolbar).toHaveBeenCalledTimes(1);
  });

  it('toolbox opened tolerates a missing plus button node', async () => {
    const h = createToolbar({ bareNodes: true });
    const tb = await drawAndGetToolbox(h);

    h.intern.nodes.plusButton = undefined;

    expect(() => tb.emit('toolbox-opened')).not.toThrow();
  });

  it('toolbox opened forwards the hovered callout background', async () => {
    const h = createToolbar({ bareNodes: true });
    // the callout itself: resolveCalloutBlock must return it via the
    // name==='callout' branch (no parent to fall back to)
    const callout = makeBlock({ id: 'callout', name: 'callout', backgroundColor: 'rgb(9, 9, 9)' });

    h.intern.hoveredBlock = callout;

    const tb = await drawAndGetToolbox(h);
    tb.emit('toolbox-opened');

    expect(tb.setCalloutBackground).toHaveBeenCalledWith('rgb(9, 9, 9)');
  });

  it('toolbox closed unstamps the editor state and repositions', async () => {
    const h = createToolbar({ bareNodes: true });
    const tb = await drawAndGetToolbox(h);

    h.intern.hoveredBlock = makeBlock({ id: 'a' });

    tb.emit('toolbox-opened');
    tb.emit('toolbox-closed');

    expect(h.blok.UI.nodes.wrapper.classList.contains('tb-toolbox-opened')).toBe(false);
    expect(h.blok.UI.nodes.wrapper.hasAttribute('data-blok-toolbox-opened')).toBe(false);
    expect(h.intern.nodes.plusButton?.getAttribute('aria-expanded')).toBe('false');
    expect(h.positioner.repositionToolbar).toHaveBeenCalledTimes(2);
  });

  it('toolbox closed tolerates a missing plus button node', async () => {
    const h = createToolbar({ bareNodes: true });
    const tb = await drawAndGetToolbox(h);

    h.intern.nodes.plusButton = undefined;

    expect(() => tb.emit('toolbox-closed')).not.toThrow();
  });

  it('toolbox closed restores the caret to the pre-toolbox block', async () => {
    const h = createToolbar({ bareNodes: true });
    const blockR = makeBlock({ id: 'restore', inputs: [document.createElement('div')] });
    const inserted = makeBlock({ id: 'inserted' });

    const tb = await drawAndGetToolbox(h);

    h.intern.preToolboxBlock = blockR;
    h.intern.plusInsertedBlock = inserted;

    tb.emit('toolbox-closed');

    expect(h.blok.Caret.setToBlock).toHaveBeenCalledWith(blockR, 'end');
    expect(h.intern.preToolboxBlock).toBeNull();
    expect(h.intern.plusInsertedBlock).toBeNull();
  });

  it('skips the caret restore when the pre-toolbox block has no inputs', async () => {
    const h = createToolbar({ bareNodes: true });
    const blockR = makeBlock({ id: 'restore' });

    const tb = await drawAndGetToolbox(h);

    h.intern.preToolboxBlock = blockR;

    tb.emit('toolbox-closed');

    expect(h.blok.Caret.setToBlock).not.toHaveBeenCalled();
    expect(h.intern.preToolboxBlock).toBeNull();
  });

  it('restores the caret to the current block when closed without a plus context', async () => {
    const h = createToolbar({ bareNodes: true });
    const blockC = makeBlock({ id: 'current', inputs: [document.createElement('div')] });

    blurActiveElement();

    const tb = await drawAndGetToolbox(h);

    h.blok.BlockManager.currentBlock = blockC;

    tb.emit('toolbox-closed');

    expect(h.blok.Caret.setToBlock).toHaveBeenCalledWith(blockC, 'end');
  });

  it('leaves the caret when the current block has no inputs', async () => {
    const h = createToolbar({ bareNodes: true });
    const blockC = makeBlock({ id: 'current' });

    blurActiveElement();

    const tb = await drawAndGetToolbox(h);

    h.blok.BlockManager.currentBlock = blockC;

    tb.emit('toolbox-closed');

    expect(h.blok.Caret.setToBlock).not.toHaveBeenCalled();
  });

  it('leaves the caret when focus already sits inside the current block', async () => {
    const h = createToolbar({ bareNodes: true });
    const blockC = makeBlock({ id: 'current', inputs: [document.createElement('div')] });
    const focusTarget = document.createElement('button');

    blockC.holder.appendChild(focusTarget);
    document.body.appendChild(blockC.holder);
    focusTarget.focus();

    const tb = await drawAndGetToolbox(h);

    h.blok.BlockManager.currentBlock = blockC;

    tb.emit('toolbox-closed');

    expect(h.blok.Caret.setToBlock).not.toHaveBeenCalled();

    blurActiveElement();
    focusTarget.remove();
  });

  it('block added inserts a paragraph after an input-less last block', async () => {
    const h = createToolbar({ bareNodes: true });
    const newBlock = makeBlock({ id: 'new' });
    const tb = await drawAndGetToolbox(h);

    h.blok.BlockManager.getBlockById.mockReturnValue(newBlock);
    h.blok.BlockManager.lastBlock = newBlock;

    tb.emit('toolbox-block-added', { block: { id: 'new' } });

    expect(h.blok.BlockManager.insertAtEnd).toHaveBeenCalledTimes(1);
    expect(h.blok.Caret.setToBlock).toHaveBeenCalledWith(newBlock);
  });

  it('block added places the caret in the next block when the new block is not last', async () => {
    const h = createToolbar({ bareNodes: true });
    const newBlock = makeBlock({ id: 'new' });
    const nextBlock = makeBlock({ id: 'next' });
    const tb = await drawAndGetToolbox(h);

    h.blok.BlockManager.getBlockById.mockReturnValue(newBlock);
    h.blok.BlockManager.lastBlock = makeBlock({ id: 'other' });
    h.blok.BlockManager.nextBlock = nextBlock;

    tb.emit('toolbox-block-added', { block: { id: 'new' } });

    expect(h.blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
    expect(h.blok.Caret.setToBlock).toHaveBeenCalledWith(nextBlock);
  });

  it('block added does not insert for a block that already has inputs', async () => {
    const h = createToolbar({ bareNodes: true });
    const newBlock = makeBlock({ id: 'new', inputs: [document.createElement('div')] });
    const tb = await drawAndGetToolbox(h);

    h.blok.BlockManager.getBlockById.mockReturnValue(newBlock);
    h.blok.BlockManager.lastBlock = newBlock;

    tb.emit('toolbox-block-added', { block: { id: 'new' } });

    expect(h.blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
  });

  it('block added ignores an unknown block id', async () => {
    const h = createToolbar({ bareNodes: true });
    const tb = await drawAndGetToolbox(h);

    h.blok.BlockManager.getBlockById.mockReturnValue(undefined);

    expect(() => tb.emit('toolbox-block-added', { block: { id: 'ghost' } })).not.toThrow();
    expect(h.blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
    expect(h.blok.Caret.setToBlock).not.toHaveBeenCalled();
  });

  it('block added does nothing when there is no next block', async () => {
    const h = createToolbar({ bareNodes: true });
    const newBlock = makeBlock({ id: 'new' });
    const tb = await drawAndGetToolbox(h);

    h.blok.BlockManager.getBlockById.mockReturnValue(newBlock);
    h.blok.BlockManager.lastBlock = makeBlock({ id: 'other' });
    h.blok.BlockManager.nextBlock = undefined;

    tb.emit('toolbox-block-added', { block: { id: 'new' } });

    expect(h.blok.BlockManager.insertAtEnd).not.toHaveBeenCalled();
    expect(h.blok.Caret.setToBlock).not.toHaveBeenCalled();
  });
});

describe('Toolbar.enableModuleBindings — plus button mousedown', () => {
  it('routes plus button mousedown into the click-drag handler', () => {
    const h = createToolbar();

    enableBindings(h);

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    getRegisteredListener(h, targetOf(h.intern.nodes.plusButton), 'mousedown')(event);

    expect(h.clickDrag.setup).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('hides any open tooltip on plus button mousedown', async () => {
    const tooltipModule = await import('../../../../../src/components/utils/tooltip');
    const h = createToolbar();

    enableBindings(h);

    const event = new MouseEvent('mousedown', { cancelable: true });
    getRegisteredListener(h, targetOf(h.intern.nodes.plusButton), 'mousedown')(event);

    expect(vi.mocked(tooltipModule.hide)).toHaveBeenCalledTimes(1);
  });

  it('ignores plus button mousedown in read-only mode', () => {
    const h = createToolbar();

    h.blok.ReadOnly.isEnabled = true;
    enableBindings(h);

    const event = new MouseEvent('mousedown', { cancelable: true });
    getRegisteredListener(h, targetOf(h.intern.nodes.plusButton), 'mousedown')(event);

    expect(h.clickDrag.setup).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('passes the insert direction to the plus button click', () => {
    const h = createToolbar();

    enableBindings(h);

    const handler = getRegisteredListener(h, targetOf(h.intern.nodes.plusButton), 'mousedown');

    vi.mocked(getUserOS).mockReturnValue({ win: true, mac: false });
    handler(new MouseEvent('mousedown', { cancelable: true }));
    const mouseUpCb = h.clickDrag.setup.mock.calls[0]?.[1] as (event: { ctrlKey: boolean; altKey: boolean }) => void;

    mouseUpCb({ ctrlKey: false, altKey: true });
    expect(h.plusButton.handleClick).toHaveBeenLastCalledWith(false);

    vi.mocked(getUserOS).mockReturnValue({ win: false, mac: true });
    handler(new MouseEvent('mousedown', { cancelable: true }));
    const mouseUpCbMac = h.clickDrag.setup.mock.calls[1]?.[1] as (event: { ctrlKey: boolean; altKey: boolean }) => void;

    mouseUpCbMac({ ctrlKey: false, altKey: true });
    expect(h.plusButton.handleClick).toHaveBeenLastCalledWith(true);
  });

  it('registers the plus button listener in the capture phase', () => {
    const h = createToolbar();

    const plusButton = h.intern.nodes.plusButton;
    const child = document.createElement('span');

    plusButton?.appendChild(child);
    const order: string[] = [];
    plusButton?.addEventListener('mousedown', () => {
      // registered before the toolbar's listener, so in the bubble phase it
      // would run first; the capture-phase listener runs before it
      order.push(h.clickDrag.setup.mock.calls.length > 0 ? 'after' : 'before');
    });

    enableBindings(h);

    child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(h.clickDrag.setup).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['after']);
  });

  it('registers the settings toggler listener in the capture phase', () => {
    const h = createToolbar();
    const toggler = h.intern.nodes.settingsToggler;
    const child = document.createElement('span');

    toggler?.appendChild(child);
    const order: string[] = [];
    toggler?.addEventListener('mousedown', () => {
      order.push(h.settingsToggler.mousedownHandler.mock.calls.length > 0 ? 'after' : 'before');
    });

    enableBindings(h);

    child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(order).toEqual(['after']);
    expect(h.settingsToggler.createMousedownHandler).toHaveBeenCalledTimes(1);
    expect(h.settingsToggler.mousedownHandler).toHaveBeenCalledTimes(1);
  });

  it('binds the settings toggler mousedown to its handler', () => {
    const h = createToolbar();

    enableBindings(h);

    getRegisteredListener(h, targetOf(h.intern.nodes.settingsToggler), 'mousedown')(
      new MouseEvent('mousedown')
    );

    expect(h.settingsToggler.mousedownHandler).toHaveBeenCalledTimes(1);
  });

  it('tolerates missing buttons while binding', () => {
    const h = createToolbar();

    h.intern.nodes.plusButton = undefined;
    h.intern.nodes.settingsToggler = undefined;

    expect(() => enableBindings(h)).not.toThrow();
    expect(h.dispatcher.on.mock.calls.some((args) => args[0] === BlockHovered)).toBe(true);
  });
});

describe('Toolbar keyboard bindings', () => {
  it('moves focus into the roving group on Alt+F10', () => {
    const h = createToolbar();
    const blockC = makeBlock({ id: 'c' });

    h.blok.BlockManager.currentBlock = blockC;
    h.intern.rovingController = { focusFirst: vi.fn(), destroy: vi.fn() };
    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    const event = new KeyboardEvent('keydown', { key: 'F10', altKey: true, cancelable: true });

    getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown')(event);

    expect(spy).toHaveBeenCalledWith(blockC);
    expect(h.intern.rovingController.focusFirst).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores other key combinations on the editor wrapper', () => {
    const h = createToolbar();
    const blockC = makeBlock({ id: 'c' });

    h.blok.BlockManager.currentBlock = blockC;
    h.intern.rovingController = { focusFirst: vi.fn(), destroy: vi.fn() };
    enableBindings(h);

    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });

    getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown')(event);

    expect(h.intern.rovingController?.focusFirst).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('requires Alt with F10 — a plain key with Alt held does not enter the toolbar', () => {
    const h = createToolbar();
    const blockC = makeBlock({ id: 'c' });

    h.blok.BlockManager.currentBlock = blockC;
    h.intern.rovingController = { focusFirst: vi.fn(), destroy: vi.fn() };
    enableBindings(h);

    const event = new KeyboardEvent('keydown', { key: 'Enter', altKey: true, cancelable: true });

    getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown')(event);

    expect(h.intern.rovingController?.focusFirst).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('Escape returns the caret to the origin block and stops propagation', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a', inputs: [document.createElement('div')] });

    h.blok.BlockManager.currentBlock = blockA;
    h.intern.rovingController = { focusFirst: vi.fn(), destroy: vi.fn() };
    enableBindings(h);

    const uiKeydown = getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown');
    uiKeydown(new KeyboardEvent('keydown', { key: 'F10', altKey: true, cancelable: true }));

    const documentRecorder = vi.fn();
    document.addEventListener('keydown', documentRecorder);

    // the wrapper must be in the document for a bubbling event to reach it
    const wrapper = h.intern.nodes.wrapper;

    if (wrapper === undefined) {
      throw new Error('wrapper missing');
    }
    document.body.appendChild(wrapper);

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    getRegisteredListener(h, targetOf(h.intern.nodes.wrapper), 'keydown')(escapeEvent);

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(h.blok.Caret.setToBlock).toHaveBeenCalledWith(blockA, 'end');

    wrapper.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(documentRecorder).not.toHaveBeenCalled();

    document.removeEventListener('keydown', documentRecorder);
    wrapper.remove();
  });

  it('Escape ignores other keys', () => {
    const h = createToolbar();

    enableBindings(h);

    const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    getRegisteredListener(h, targetOf(h.intern.nodes.wrapper), 'keydown')(event);

    expect(event.defaultPrevented).toBe(false);
    expect(h.blok.Caret.setToBlock).not.toHaveBeenCalled();
  });

  it('Escape without a remembered block does nothing', () => {
    const h = createToolbar();

    enableBindings(h);

    expect(() =>
      getRegisteredListener(h, targetOf(h.intern.nodes.wrapper), 'keydown')(
        new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      )
    ).not.toThrow();
    expect(h.blok.Caret.setToBlock).not.toHaveBeenCalled();
  });

  it('Escape does nothing when the remembered block has no inputs', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.blok.BlockManager.currentBlock = blockA;
    h.intern.rovingController = { focusFirst: vi.fn(), destroy: vi.fn() };
    enableBindings(h);

    getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown')(
      new KeyboardEvent('keydown', { key: 'F10', altKey: true, cancelable: true })
    );
    getRegisteredListener(h, targetOf(h.intern.nodes.wrapper), 'keydown')(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    );

    expect(h.blok.Caret.setToBlock).not.toHaveBeenCalled();
  });

  it('tolerates a missing toolbar wrapper while binding', () => {
    const h = createToolbar();

    h.intern.nodes.wrapper = undefined;

    expect(() => enableBindings(h)).not.toThrow();
  });

  it('focusin refreshes the button visibility', () => {
    const h = createToolbar();

    h.intern.nodes.plusButton?.style.setProperty('display', 'none');
    enableBindings(h);

    getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'focusin')(new Event('focusin'));

    expect(h.intern.nodes.plusButton?.style.display).toBe('');
    expect(h.intern.nodes.settingsToggler?.style.display).toBe('');
  });

  it('registers the block settings and block changed subscriptions', () => {
    const h = createToolbar();

    enableBindings(h);

    expect(h.dispatcher.on).toHaveBeenCalledWith(BlockSettingsOpened, h.intern.onBlockSettingsOpen);
    expect(h.dispatcher.on).toHaveBeenCalledWith(BlockSettingsClosed, h.intern.onBlockSettingsClose);
    expect(h.dispatcher.on).toHaveBeenCalledWith(BlockChanged, h.intern.onBlockChanged);
  });
});

describe('Toolbar.focusToolbar / reposition guard', () => {
  it('does not reposition when the toolbar is already open on the same block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.blok.BlockManager.currentBlock = blockA;
    h.intern.rovingController = { focusFirst: vi.fn(), destroy: vi.fn() };
    enableBindings(h);

    h.toolbar.moveAndOpen(blockA);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown')(
      new KeyboardEvent('keydown', { key: 'F10', altKey: true, cancelable: true })
    );

    expect(spy).not.toHaveBeenCalled();
    expect(h.intern.rovingController.focusFirst).toHaveBeenCalledTimes(1);
  });

  it('repositions on Alt+F10 when the toolbar is closed but already anchored on the block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.intern.hoveredBlock = blockA;
    h.blok.BlockManager.currentBlock = blockA;
    h.intern.rovingController = { focusFirst: vi.fn(), destroy: vi.fn() };
    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown')(
      new KeyboardEvent('keydown', { key: 'F10', altKey: true, cancelable: true })
    );

    expect(spy).toHaveBeenCalledWith(blockA);
  });

  it('Alt+F10 tolerates a missing roving controller', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.blok.BlockManager.currentBlock = blockA;
    enableBindings(h);

    expect(() =>
      getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown')(
        new KeyboardEvent('keydown', { key: 'F10', altKey: true, cancelable: true })
      )
    ).not.toThrow();
  });

  it('repositions on Alt+F10 when open but anchored on nothing', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.blok.BlockManager.currentBlock = blockA;
    h.intern.nodes.wrapper?.classList.add('tb-opened');
    h.intern.rovingController = { focusFirst: vi.fn(), destroy: vi.fn() };
    enableBindings(h);

    const spy = vi.spyOn(h.toolbar, 'moveAndOpen');
    getRegisteredListener(h, h.blok.UI.nodes.wrapper, 'keydown')(
      new KeyboardEvent('keydown', { key: 'F10', altKey: true, cancelable: true })
    );

    expect(spy).toHaveBeenCalledWith(blockA);
    expect(h.intern.rovingController.focusFirst).toHaveBeenCalledTimes(1);
  });
});

describe('Toolbar.disableModuleBindings', () => {
  it('clears the mutable listeners and unsubscribes the event handlers', () => {
    const h = createToolbar();

    enableBindings(h);

    const clearAllSpy = vi.fn();
    (h.toolbar as unknown as { readOnlyMutableListeners: MutableListenersStub }).readOnlyMutableListeners = {
      on: (target: EventTarget, type: string, handler: (event: Event) => void, options?: boolean | AddEventListenerOptions): void => {
        target.addEventListener(type, handler, options);
      },
      clearAll: clearAllSpy,
    };

    h.intern.disableModuleBindings();

    expect(clearAllSpy).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.off).toHaveBeenCalledWith(BlockSettingsOpened, h.intern.onBlockSettingsOpen);
    expect(h.dispatcher.off).toHaveBeenCalledWith(BlockSettingsClosed, h.intern.onBlockSettingsClose);
    expect(h.dispatcher.off).toHaveBeenCalledWith(BlockChanged, h.intern.onBlockChanged);
  });
});

describe('Toolbar.shieldLeftEdgeControl', () => {
  const makeToggleWithArrow = (h: Harness, id: string): Block => {
    const block = makeBlock({ id, name: 'toggle' });
    const arrow = document.createElement('span');

    arrow.setAttribute('data-blok-toggle-arrow', '');
    block.holder.appendChild(arrow);

    return block;
  };

  it('blanks the whole actions bar when no left-edge control exists', () => {
    const h = createToolbar();
    const block = makeBlock({ id: 't', name: 'toggle' });
    const stray = document.createElement('div');

    h.intern.nodes.actions?.appendChild(stray);

    h.toolbar.moveAndOpen(block);

    const actions = h.intern.nodes.actions;
    expect(actions?.style.pointerEvents).toBe('none');
    expect(stray.style.pointerEvents).toBe('none');
    expect(h.intern.nodes.settingsToggler?.style.pointerEvents).toBe('auto');
  });

  it('tolerates a missing settings toggler on a left-edge block', () => {
    const h = createToolbar();
    const block = makeToggleWithArrow(h, 't');

    h.intern.nodes.settingsToggler = undefined;

    expect(() => h.toolbar.moveAndOpen(block)).not.toThrow();
  });

  it('blanks only the descendants that geometrically cover the control', () => {
    const h = createToolbar();
    const block = makeToggleWithArrow(h, 't');

    const control = block.holder.querySelector('[data-blok-toggle-arrow]');

    if (!(control instanceof HTMLElement)) {
      throw new Error('control arrow missing');
    }

    const actions = h.intern.nodes.actions;

    if (actions === undefined) {
      throw new Error('actions missing');
    }

    const makeDescendant = (id: string): HTMLElement => {
      const el = document.createElement('div');

      el.setAttribute('data-testid', id);
      actions.appendChild(el);

      return el;
    };

    const dRightOfControl = makeDescendant('d-right-of-control');
    const dLeftTouching = makeDescendant('d-left-touching');
    const dBelowTouching = makeDescendant('d-below-touching');
    const dAboveTouching = makeDescendant('d-above-touching');
    const dCovering = makeDescendant('d-covering');

    rectOf(control, 10, 10, 20, 20);
    rectOf(actions, 100, 100, 110, 110);
    // left edge exactly at the control's right edge — touching, not covering
    rectOf(dRightOfControl, 20, 0, 30, 30);
    // right edge exactly at the control's left edge
    rectOf(dLeftTouching, 0, 0, 10, 30);
    // top edge exactly at the control's bottom edge
    rectOf(dBelowTouching, 0, 20, 30, 30);
    // bottom edge exactly at the control's top edge
    rectOf(dAboveTouching, 0, -10, 30, 10);
    rectOf(dCovering, 10, 10, 20, 20);

    h.toolbar.moveAndOpen(block);

    expect(actions.style.pointerEvents).toBe('auto');
    expect(dRightOfControl.style.pointerEvents).toBe('');
    expect(dLeftTouching.style.pointerEvents).toBe('');
    expect(dBelowTouching.style.pointerEvents).toBe('');
    expect(dAboveTouching.style.pointerEvents).toBe('');
    expect(dCovering.style.pointerEvents).toBe('none');
    expect(h.intern.nodes.settingsToggler?.style.pointerEvents).toBe('auto');
  });
});

describe('Toolbar callout adaptation', () => {
  it('reads the callout background from a child of a colored callout', () => {
    const h = createToolbar();
    const callout = makeBlock({ id: 'p', name: 'callout', backgroundColor: 'rgb(9, 9, 9)', contentIds: [] });
    const child = makeBlock({ id: 'child', parentId: 'p' });

    h.blok.BlockManager.getBlockById.mockReturnValue(callout);

    h.toolbar.moveAndOpen(child);

    const wrapper = h.intern.nodes.wrapper;
    expect(wrapper?.style.getPropertyValue('--blok-bg-light')).toContain('rgb(9, 9, 9)');
  });

  it('drops the background variable when the parent callout paints no background', () => {
    const h = createToolbar();
    const callout = makeBlock({ id: 'p', name: 'callout', backgroundColor: '', contentIds: [] });
    const child = makeBlock({ id: 'child', parentId: 'p' });

    h.blok.BlockManager.getBlockById.mockReturnValue(callout);

    h.toolbar.moveAndOpen(child);

    const wrapper = h.intern.nodes.wrapper;
    expect(wrapper?.style.getPropertyValue('--blok-bg-light')).toBe('');
  });

  it('drops the background variable when the callout plugin content is unreadable', () => {
    const h = createToolbar();
    const callout = makeBlock({ id: 'p', name: 'callout', contentIds: [] });
    const child = makeBlock({ id: 'child', parentId: 'p' });

    // reading pluginsContent.style throws — the catch must restore null
    (callout as unknown as BlockStubInstance).pluginsContent = undefined as unknown as HTMLElement;
    h.blok.BlockManager.getBlockById.mockReturnValue(callout);

    expect(() => h.toolbar.moveAndOpen(child)).not.toThrow();

    const wrapper = h.intern.nodes.wrapper;
    expect(wrapper?.style.getPropertyValue('--blok-bg-light')).toBe('');
  });

  it('keeps the background variable off a plain block', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.toolbar.moveAndOpen(blockA);

    const wrapper = h.intern.nodes.wrapper;
    expect(wrapper?.style.getPropertyValue('--blok-bg-light')).toBe('');
  });

  it('hides both buttons over the emoji of a callout first child', () => {
    const h = createToolbar();
    const callout = makeBlock({ id: 'callout', name: 'callout', contentIds: ['child'] });
    const child = makeBlock({ id: 'child', parentId: 'callout' });

    h.blok.BlockManager.getBlockById.mockReturnValue(callout);
    h.intern.hoveredBlock = child;
    h.intern.nodes.plusButton?.style.setProperty('display', '');
    h.intern.nodes.settingsToggler?.style.setProperty('display', '');

    h.intern.updateToolbarButtonsForCalloutFirstChild();

    expect(h.intern.nodes.plusButton?.style.display).toBe('none');
    expect(h.intern.nodes.settingsToggler?.style.display).toBe('none');
  });

  it('hides only the plus button in read-only mode', () => {
    const h = createToolbar();
    const blockA = makeBlock({ id: 'a' });

    h.blok.ReadOnly.isEnabled = true;
    h.intern.hoveredBlock = blockA;

    h.intern.updateToolbarButtonsForCalloutFirstChild();

    expect(h.intern.nodes.plusButton?.style.display).toBe('none');
    expect(h.intern.nodes.settingsToggler?.style.display).toBe('');
  });

  it('button refresh tolerates a missing settings toggler node', () => {
    const h = createToolbar();

    h.intern.hoveredBlock = makeBlock({ id: 'a' });
    h.intern.nodes.settingsToggler = undefined;

    expect(() => h.intern.updateToolbarButtonsForCalloutFirstChild()).not.toThrow();
  });

  it('button refresh tolerates a missing plus button node', () => {
    const h = createToolbar();

    h.intern.nodes.plusButton = undefined;

    expect(() => h.intern.updateToolbarButtonsForCalloutFirstChild()).not.toThrow();
  });
});

describe('Toolbar.destroy', () => {
  it('tears down all collaborators', async () => {
    const h = createToolbar({ bareNodes: true });

    await h.intern.drawUI();

    const roving = lastOf<{ destroy: Mock }>(registries.rovingControllers);
    const toolbox = lastOf<ToolboxDouble>(registries.toolboxes);
    const removeAllNodesSpy = vi.spyOn(h.toolbar, 'removeAllNodes');

    h.intern.destroy();

    expect(removeAllNodesSpy).toHaveBeenCalledTimes(1);
    expect(toolbox.destroy).toHaveBeenCalledTimes(1);
    expect(h.clickDrag.destroy).toHaveBeenCalledTimes(1);
    expect(roving.destroy).toHaveBeenCalledTimes(1);
  });

  it('tolerates a missing toolbox instance', () => {
    const h = createToolbar();

    h.intern.toolboxInstance = null;

    expect(() => h.intern.destroy()).not.toThrow();
    expect(h.clickDrag.destroy).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_ATTR, INLINE_TOOLBAR_INTERFACE_VALUE } from '../../../../../../src/components/constants';
import { InlineToolbar } from '../../../../../../src/components/modules/toolbar/inline/index';
import { INLINE_TOOLBAR_VERTICAL_MARGIN_DESKTOP } from '../../../../../../src/components/modules/toolbar/inline/constants';
import { SelectionUtils } from '../../../../../../src/components/selection/index';
import type { InlineToolAdapter } from '../../../../../../src/components/tools/inline';
import { PopoverInline } from '../../../../../../src/components/utils/popover/popover-inline';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Shared state between the PopoverInline module mock and the tests.
 * `handlerLists[i]` holds the Closed handlers of `instances[i]`, so a test can
 * replay the event the real popover fires from its own hide().
 */
const popoverHolder = vi.hoisted(() => ({
  factory: (): Record<string, unknown> => ({}),
  params: [] as unknown[],
  instances: [] as unknown[],
  handlerLists: [] as Array<Array<() => void>>,
}));

vi.mock('../../../../../../src/components/utils/popover/popover-inline', () => ({
  PopoverInline: class MockPopoverInline {
    /**
     * @param params - popover constructor params captured for assertions
     */
    constructor(params: unknown) {
      popoverHolder.params.push(params);

      const stub = popoverHolder.factory();
      const closedHandlers: Array<() => void> = [];

      popoverHolder.instances.push(this);
      popoverHolder.handlerLists.push(closedHandlers);

      Object.assign(this, stub);

      Object.assign(this, {
        on: (_event: string, handler: () => void): void => {
          closedHandlers.push(handler);
        },
      });

      const stubHide = stub.hide;

      if (typeof stubHide === 'function') {
        Object.assign(this, {
          /**
           * The real popover emits Closed from inside hide(); the module relies
           * on that (its Closed handler calls close() back into itself).
           */
          hide: (): void => {
            stubHide();
            closedHandlers.slice().forEach((handler) => handler());
          },
        });
      }
    }
  },
}));

/**
 * Minimal inline tool instance shape the toolbar drives.
 */
interface ToolInstanceStub {
  render: () => unknown;
  destroy?: () => void;
  applyShortcut?: unknown;
}

/**
 * Minimal inline tool adapter shape the toolbar reads.
 */
interface ToolAdapterStub {
  name: string;
  title?: string;
  titleKey?: string;
  shortcut?: string;
  isReadOnlySupported?: boolean;
  allowCaretShortcut?: boolean;
  create: () => ToolInstanceStub;
}

/**
 * Casts a plain object into the adapter type the module expects.
 * @param stub - adapter-shaped object
 */
const asAdapter = (stub: ToolAdapterStub): InlineToolAdapter => stub as unknown as InlineToolAdapter;

/**
 * Popover constructor params, as far as the tests read them.
 */
interface CapturedPopoverParams {
  items?: unknown[];
  messages?: { nothingFound?: string; search?: string; actions?: string };
}

/**
 * The params of the popover created last.
 */
const lastPopoverParams = (): CapturedPopoverParams =>
  popoverHolder.params[popoverHolder.params.length - 1] as CapturedPopoverParams;

/**
 * Items handed to the popover created last.
 */
const lastPopoverItems = (): unknown[] => lastPopoverParams().items ?? [];

describe('InlineToolbar (mutation coverage)', () => {
  let toolbar: InlineToolbar;
  let blok: BlokModules;
  let uiWrapper: HTMLElement;
  let redactor: HTMLElement;
  let blockHolder: HTMLElement;
  let blockInlineTools: Map<string, InlineToolAdapter>;
  let registeredInlineTools: Map<string, InlineToolAdapter>;
  let hideBlockActions: ReturnType<typeof vi.fn>;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let popoverElement: HTMLElement;
  let popoverContainer: HTMLElement;
  let popoverItemsHost: HTMLElement;
  let mountElement: HTMLElement;
  let show: ReturnType<typeof vi.fn>;
  let hide: ReturnType<typeof vi.fn>;
  let destroyPopover: ReturnType<typeof vi.fn>;
  let activateItemByName: ReturnType<typeof vi.fn>;

  /**
   * Builds the default popover stub: the shape a real PopoverInline exposes.
   */
  const defaultPopoverStub = (): Record<string, unknown> => ({
    show,
    hide,
    destroy: destroyPopover,
    activateItemByName,
    getElement: () => popoverElement,
    getMountElement: () => mountElement,
    hasNode: () => false,
    size: { width: 200 },
    hasNestedPopoverOpen: false,
    closeNestedPopover: vi.fn(),
  });

  /**
   * Selects the whole contents of a node through the real Selection API.
   * @param node - node whose contents become the selection
   */
  const selectContentsOf = (node: Node): void => {
    const range = document.createRange();

    range.selectNodeContents(node);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    popoverHolder.params = [];
    popoverHolder.instances = [];
    popoverHolder.handlerLists = [];

    show = vi.fn();
    hide = vi.fn();
    destroyPopover = vi.fn();
    activateItemByName = vi.fn();
    hideBlockActions = vi.fn();

    popoverElement = document.createElement('div');
    popoverContainer = document.createElement('div');
    popoverContainer.setAttribute(DATA_ATTR.popoverContainer, '');
    popoverItemsHost = document.createElement('div');
    popoverItemsHost.setAttribute(DATA_ATTR.popoverItems, '');
    popoverContainer.appendChild(popoverItemsHost);
    popoverElement.appendChild(popoverContainer);
    mountElement = document.createElement('div');
    mountElement.setAttribute('data-blok-testid', 'popover-mount');

    popoverHolder.factory = defaultPopoverStub;

    uiWrapper = document.createElement('div');
    redactor = document.createElement('div');
    redactor.setAttribute(DATA_ATTR.redactor, '');
    blockHolder = document.createElement('div');
    blockHolder.setAttribute('contenteditable', 'true');
    blockHolder.textContent = 'selected text';
    redactor.appendChild(blockHolder);
    uiWrapper.appendChild(redactor);
    document.body.appendChild(uiWrapper);

    const boldAdapter = asAdapter({
      name: 'bold',
      title: 'Bold',
      shortcut: 'CMD+B',
      create: () => ({
        render: () => ({ name: 'bold' }),
        destroy: vi.fn(),
      }),
    });

    blockInlineTools = new Map([['bold', boldAdapter]]);
    registeredInlineTools = new Map([['bold', boldAdapter]]);

    blok = {
      ReadOnly: {
        isEnabled: false,
        isControlsHidden: false,
      },
      UI: {
        nodes: { wrapper: uiWrapper, redactor },
        contentRect: new DOMRect(0, 0, 1000, 600),
      },
      Toolbar: { hideBlockActions },
      Tools: {
        inlineTools: registeredInlineTools,
        internal: { inlineTools: new Map() },
      },
      I18n: {
        t: vi.fn((key: string) => key),
        has: vi.fn(() => false),
      },
      BlockManager: {
        currentBlock: {
          tool: { inlineTools: blockInlineTools, enabledInlineTools: true },
          holder: blockHolder,
        },
        getBlock: vi.fn(() => null),
        getBlockByChildNode: vi.fn(() => null),
      },
    } as unknown as BlokModules;

    addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    toolbar = new InlineToolbar({
      config: {},
      eventsDispatcher: { on: vi.fn(), off: vi.fn() } as unknown as InlineToolbar['eventsDispatcher'],
    });
    toolbar.state = blok;

    selectContentsOf(blockHolder);
    vi.spyOn(SelectionUtils, 'rect', 'get').mockReturnValue(new DOMRect(100, 40, 50, 20));
  });

  afterEach(() => {
    // destroy() unregisters the document shortcuts; the module never detaches its
    // own window keydown listener, so stale toolbars would keep answering keys.
    toolbar.destroy();

    addEventListenerSpy.mock.calls.forEach((call: unknown) => {
      const [type, handler, options] = call as [string, EventListener, boolean | undefined];

      if (type === 'keydown') {
        window.removeEventListener(type, handler, options);
      }
    });

    (PopoverInline as unknown as { mock?: unknown }).mock = undefined;
    uiWrapper.remove();
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('builds the toolbar DOM on its own scheduled pass, without any show call', () => {
      vi.advanceTimersByTime(50);

      expect(toolbar.nodes.wrapper).toBeInstanceOf(HTMLElement);
    });

    it('creates the wrapper even when the selection is not allowed to show it', async () => {
      blok.BlockManager.currentBlock = undefined;

      await toolbar.tryToShow();

      // tryToShow() initializes before validating: the DOM must exist for a later show.
      expect(toolbar.nodes.wrapper).toBeInstanceOf(HTMLElement);
      expect(toolbar.opened).toBe(false);
    });

    it('reuses the same wrapper across repeated shows', async () => {
      await toolbar.tryToShow();

      const firstWrapper = toolbar.nodes.wrapper;

      toolbar.close();
      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper).toBe(firstWrapper);
      expect(uiWrapper.querySelectorAll(`[${DATA_ATTR.interface}]`)).toHaveLength(1);
    });

    it('marks the wrapper as the labelled inline-toolbar surface and mounts it in the UI', async () => {
      await toolbar.tryToShow();

      const wrapper = toolbar.nodes.wrapper;

      expect(wrapper?.getAttribute(DATA_ATTR.interface)).toBe(INLINE_TOOLBAR_INTERFACE_VALUE);
      expect(wrapper?.getAttribute('data-blok-testid')).toBe('inline-toolbar');
      expect(wrapper?.parentElement).toBe(uiWrapper);
    });

    it('gives the wrapper its positioning, transition and hidden-child classes', async () => {
      await toolbar.tryToShow();

      const wrapper = toolbar.nodes.wrapper;
      const classes = wrapper?.className ?? '';

      // Layout: the toolbar is absolutely placed by applyPosition().
      expect(classes).toContain('absolute');
      expect(classes).toContain('top-0');
      expect(classes).toContain('left-0');
      expect(classes).toContain('z-3');
      expect(classes).toContain('opacity-100');
      expect(classes).toContain('visible');
      // Fade-in on show.
      expect(classes).toContain('transition-opacity');
      expect(classes).toContain('duration-250');
      expect(classes).toContain('ease-out');
      expect(classes).toContain('will-change-[opacity,left,top]');
      // Popover items marked [hidden] must not take space inside the bar.
      expect(classes).toContain('**:[[hidden]]:hidden!');
    });

    it('registers the tool shortcuts as soon as the modules arrive', () => {
      const applyShortcut = vi.fn();

      // Shortcuts is a module-wide singleton keyed by element: the toolbar built
      // in beforeEach already owns CMD+B on document and would answer for us.
      toolbar.destroy();
      registeredInlineTools.set('bold', asAdapter({
        name: 'bold',
        shortcut: 'CMD+B',
        create: () => ({ render: () => ({ name: 'bold' }), applyShortcut }),
      }));

      toolbar = new InlineToolbar({
        config: {},
        eventsDispatcher: { on: vi.fn(), off: vi.fn() } as unknown as InlineToolbar['eventsDispatcher'],
      });
      toolbar.state = blok;

      // No timer is advanced: the state setter must register, not just schedule.
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', metaKey: true, bubbles: true }));

      expect(applyShortcut).toHaveBeenCalledTimes(1);
    });

    it('registers shortcuts that only became available after the modules were set', async () => {
      const applyShortcut = vi.fn();

      toolbar.destroy();
      registeredInlineTools.clear();

      toolbar = new InlineToolbar({
        config: {},
        eventsDispatcher: { on: vi.fn(), off: vi.fn() } as unknown as InlineToolbar['eventsDispatcher'],
      });
      toolbar.state = blok;
      registeredInlineTools.set('bold', asAdapter({
        name: 'bold',
        shortcut: 'CMD+B',
        create: () => ({ render: () => ({ name: 'bold' }), applyShortcut }),
      }));

      // initialize() retries registration; no timer is advanced so only it can help.
      await toolbar.tryToShow();
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', metaKey: true, bubbles: true }));

      expect(applyShortcut).toHaveBeenCalledTimes(1);
    });
  });

  describe('tryToShow', () => {
    it('opens for a valid selection and hides the block actions', async () => {
      await toolbar.tryToShow();

      expect(toolbar.opened).toBe(true);
      expect(hideBlockActions).toHaveBeenCalledTimes(1);
    });

    it('stays closed when the selection is not allowed', async () => {
      blok.BlockManager.currentBlock = undefined;

      await toolbar.tryToShow();

      expect(toolbar.opened).toBe(false);
      expect(popoverHolder.params).toHaveLength(0);
    });

    it('does not rebuild the popover when called again while open', async () => {
      await toolbar.tryToShow();
      await toolbar.tryToShow();

      // The default is "do not close first", so the second call is a no-op.
      expect(popoverHolder.params).toHaveLength(1);
      expect(toolbar.opened).toBe(true);
    });

    it('closes first when asked to, and stays closed if the selection went away', async () => {
      await toolbar.tryToShow();

      blok.BlockManager.currentBlock = undefined;

      await toolbar.tryToShow(true);

      expect(toolbar.opened).toBe(false);
      expect(hide).toHaveBeenCalledTimes(1);
    });

    it('rolls back to a closed, popover-less state when the popover cannot be built', async () => {
      const toolDestroy = vi.fn();

      blockInlineTools.set('bold', asAdapter({
        name: 'bold',
        create: () => ({ render: () => ({ name: 'bold' }), destroy: toolDestroy }),
      }));
      popoverHolder.factory = () => {
        throw new Error('popover blew up');
      };

      await toolbar.tryToShow();

      expect(toolbar.opened).toBe(false);
      expect(toolDestroy).toHaveBeenCalledTimes(1);
      expect(hideBlockActions).not.toHaveBeenCalled();
      expect(toolbar.containsNode(document.createElement('span'))).toBe(false);
    });

    it('tears the half-open popover down when the failure happens after it exists', async () => {
      popoverHolder.factory = () => ({
        ...defaultPopoverStub(),
        show: vi.fn(() => {
          throw new Error('show failed');
        }),
      });

      await toolbar.tryToShow();

      expect(toolbar.opened).toBe(false);
      expect(hide).toHaveBeenCalledTimes(1);
      expect(destroyPopover).toHaveBeenCalledTimes(1);
    });

    it('survives a half-open popover that has no hide or destroy hook', async () => {
      popoverHolder.factory = () => ({
        getElement: () => popoverElement,
        getMountElement: () => mountElement,
        size: { width: 200 },
        show: () => {
          throw new Error('show failed');
        },
      });

      await expect(toolbar.tryToShow()).resolves.toBeUndefined();
      expect(toolbar.opened).toBe(false);
    });
  });

  describe('close', () => {
    it('closes an open toolbar exactly once, even though hide re-emits Closed', async () => {
      await toolbar.tryToShow();

      toolbar.close();

      expect(toolbar.opened).toBe(false);
      expect(hide).toHaveBeenCalledTimes(1);
      expect(destroyPopover).toHaveBeenCalledTimes(1);
    });

    it('destroys the tool instances it created', async () => {
      const toolDestroy = vi.fn();

      blockInlineTools.set('bold', asAdapter({
        name: 'bold',
        create: () => ({ render: () => ({ name: 'bold' }), destroy: toolDestroy }),
      }));

      await toolbar.tryToShow();
      toolbar.close();

      expect(toolDestroy).toHaveBeenCalledTimes(1);
    });

    it('empties the wrapper it mounted the popover into', async () => {
      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper?.firstElementChild).toBe(mountElement);

      toolbar.close();

      expect(toolbar.nodes.wrapper?.innerHTML).toBe('');
    });

    it('unwraps fake background left behind by an inline tool', async () => {
      await toolbar.tryToShow();

      const leftover = document.createElement('span');

      leftover.setAttribute('data-blok-fake-background', 'true');
      leftover.textContent = 'highlighted';
      blockHolder.appendChild(leftover);

      toolbar.close();

      expect(document.querySelectorAll('[data-blok-fake-background="true"]')).toHaveLength(0);
    });

    it('does nothing when the toolbar was never opened', () => {
      toolbar.close();

      expect(hide).not.toHaveBeenCalled();
      expect(toolbar.opened).toBe(false);
    });

    it('tolerates a popover without hide or destroy hooks', async () => {
      popoverHolder.factory = () => ({
        show,
        getElement: () => popoverElement,
        getMountElement: () => mountElement,
        size: { width: 200 },
      });

      await toolbar.tryToShow();

      expect(() => toolbar.close()).not.toThrow();
      expect(toolbar.opened).toBe(false);
    });

    it('clears an opened-but-unmounted toolbar without touching a missing popover', async () => {
      await toolbar.tryToShow();
      toolbar.close();
      toolbar.nodes.wrapper = undefined;

      // open() bails before creating a popover when the DOM is gone, yet reports open.
      await toolbar.tryToShow();

      expect(toolbar.opened).toBe(true);
      expect(() => toolbar.close()).not.toThrow();
      expect(toolbar.opened).toBe(false);
    });
  });

  describe('close with a mocked popover constructor', () => {
    /**
     * `close()` also tears down the popover a mocked PopoverInline constructor
     * recorded last. These tests drive that recorded-results branch.
     */
    const setRecordedResults = (results: unknown): void => {
      (PopoverInline as unknown as { mock?: { results?: unknown } }).mock = { results };
    };

    it('tears down only the popover recorded last', () => {
      const older = { hide: vi.fn(), destroy: vi.fn() };
      const middle = { hide: vi.fn(), destroy: vi.fn() };
      const newest = { hide: vi.fn(), destroy: vi.fn() };

      setRecordedResults([{ value: older }, { value: middle }, { value: newest }]);
      toolbar.opened = true;

      toolbar.close();

      expect(newest.hide).toHaveBeenCalledTimes(1);
      expect(newest.destroy).toHaveBeenCalledTimes(1);
      expect(middle.hide).not.toHaveBeenCalled();
      expect(older.hide).not.toHaveBeenCalled();
    });

    it('tolerates a recorded popover without hide or destroy hooks', () => {
      setRecordedResults([{ value: {} }]);
      toolbar.opened = true;

      expect(() => toolbar.close()).not.toThrow();
    });

    it('tolerates an empty recording', () => {
      setRecordedResults([]);
      toolbar.opened = true;

      expect(() => toolbar.close()).not.toThrow();
    });

    it('tolerates a constructor mock that recorded nothing at all', () => {
      (PopoverInline as unknown as { mock?: unknown }).mock = {};
      toolbar.opened = true;

      expect(() => toolbar.close()).not.toThrow();
    });
  });

  describe('containsNode', () => {
    it('reports false before the toolbar DOM exists', () => {
      expect(toolbar.containsNode(document.createElement('span'))).toBe(false);
    });

    it('reports true for a node inside the wrapper', async () => {
      await toolbar.tryToShow();

      expect(toolbar.containsNode(mountElement)).toBe(true);
    });

    it('reports true for a node the popover claims, even outside the wrapper', async () => {
      const outside = document.createElement('span');

      popoverHolder.factory = () => ({
        ...defaultPopoverStub(),
        hasNode: (node: Node) => node === outside,
      });

      await toolbar.tryToShow();

      expect(toolbar.containsNode(outside)).toBe(true);
    });

    it('reports false for a node neither the wrapper nor the popover owns', async () => {
      await toolbar.tryToShow();

      expect(toolbar.containsNode(document.createElement('span'))).toBe(false);
    });

    it('reports false for an outside node while no popover is open', async () => {
      await toolbar.tryToShow();
      toolbar.close();

      expect(toolbar.containsNode(document.createElement('span'))).toBe(false);
    });
  });

  describe('destroy', () => {
    it('tears down the open popover, the tools and the DOM', async () => {
      const toolDestroy = vi.fn();

      blockInlineTools.set('bold', asAdapter({
        name: 'bold',
        create: () => ({ render: () => ({ name: 'bold' }), destroy: toolDestroy }),
      }));

      await toolbar.tryToShow();

      const wrapper = toolbar.nodes.wrapper;

      toolbar.destroy();

      expect(toolDestroy).toHaveBeenCalledTimes(1);
      expect(hide).toHaveBeenCalledTimes(1);
      expect(destroyPopover).toHaveBeenCalledTimes(1);
      expect(wrapper?.isConnected).toBe(false);
    });

    it('stops answering the tool shortcuts it registered', async () => {
      const applyShortcut = vi.fn();

      registeredInlineTools.set('bold', asAdapter({
        name: 'bold',
        shortcut: 'CMD+B',
        create: () => ({ render: () => ({ name: 'bold' }), applyShortcut }),
      }));
      await toolbar.tryToShow();

      toolbar.destroy();

      const event = new KeyboardEvent('keydown', {
        code: 'KeyB',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      document.dispatchEvent(event);

      expect(applyShortcut).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('does not reopen or re-close itself while tearing the popover down', async () => {
      await toolbar.tryToShow();

      toolbar.destroy();

      // The Closed event hide() fires must find an identity mismatch and stand down.
      expect(destroyPopover).toHaveBeenCalledTimes(1);
    });

    it('is safe on a toolbar that was never opened', () => {
      expect(() => toolbar.destroy()).not.toThrow();
    });

    it('tolerates a popover without hide or destroy hooks', async () => {
      popoverHolder.factory = () => ({
        show,
        getElement: () => popoverElement,
        getMountElement: () => mountElement,
        size: { width: 200 },
      });
      await toolbar.tryToShow();

      expect(() => toolbar.destroy()).not.toThrow();
    });
  });

  describe('keyboard', () => {
    it('closes on a bare vertical arrow key', async () => {
      await toolbar.tryToShow();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

      expect(toolbar.opened).toBe(false);
    });

    it('sees the arrow key before a listener on the document can swallow it', async () => {
      await toolbar.tryToShow();

      const swallow = (event: Event): void => event.stopPropagation();

      document.addEventListener('keydown', swallow);

      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      } finally {
        document.removeEventListener('keydown', swallow);
      }

      expect(toolbar.opened).toBe(false);
    });

    it('opens on Shift+Arrow, which extends the selection', async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        shiftKey: true,
        bubbles: true,
      }));
      await vi.advanceTimersByTimeAsync(0);

      expect(toolbar.opened).toBe(true);
    });

    it('ignores keys that are neither arrows nor shortcuts', async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      await vi.advanceTimersByTimeAsync(0);

      expect(toolbar.opened).toBe(false);
    });
  });

  describe('nested popover and flipper state', () => {
    it('reports no nested popover, no flipper focus and no direct menu when closed', () => {
      expect(toolbar.hasNestedPopoverOpen).toBe(false);
      expect(toolbar.hasFlipperFocus).toBe(false);
      expect(toolbar.hasDirectMenuOpen).toBe(false);
      expect(toolbar.closeNestedPopover()).toBe(false);
    });

    it('reports and closes a nested popover the inline popover owns', async () => {
      const closeNested = vi.fn();

      popoverHolder.factory = () => ({
        ...defaultPopoverStub(),
        hasNestedPopoverOpen: true,
        closeNestedPopover: closeNested,
      });

      await toolbar.tryToShow();

      expect(toolbar.hasNestedPopoverOpen).toBe(true);
      expect(toolbar.hasFlipperFocus).toBe(true);
      expect(toolbar.closeNestedPopover()).toBe(true);
      expect(closeNested).toHaveBeenCalledTimes(1);
    });
  });

  describe('popover creation', () => {
    it('passes the localized empty and search messages to the popover', async () => {
      await toolbar.tryToShow();

      expect(lastPopoverParams().messages?.nothingFound).toBe('popover.nothingFound');
      expect(lastPopoverParams().messages?.search).toBe('popover.search');
    });

    it('builds one popover item per available inline tool', async () => {
      await toolbar.tryToShow();

      expect(lastPopoverItems()).toStrictEqual([
        expect.objectContaining({ name: 'bold' }),
      ]);
    });

    it('clears stale wrapper content before mounting the popover', async () => {
      await toolbar.tryToShow();
      toolbar.close();

      const stale = document.createElement('span');

      stale.textContent = 'stale';
      toolbar.nodes.wrapper?.appendChild(stale);

      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper?.childNodes).toHaveLength(1);
      expect(toolbar.nodes.wrapper?.firstElementChild).toBe(mountElement);
    });

    it('mounts the popover mount element, not the popover root', async () => {
      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper?.firstElementChild).toBe(mountElement);
      expect(show).toHaveBeenCalledTimes(1);
    });

    it('falls back to the popover root when there is no separate mount element', async () => {
      popoverHolder.factory = () => ({
        show,
        hide,
        destroy: destroyPopover,
        getElement: () => popoverElement,
        size: { width: 200 },
      });

      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper?.firstElementChild).toBe(popoverElement);
    });

    it('opens with nothing mounted when the popover exposes no element at all', async () => {
      popoverHolder.factory = () => ({ hide, destroy: destroyPopover });

      await toolbar.tryToShow();

      expect(toolbar.opened).toBe(true);
      expect(toolbar.nodes.wrapper?.childNodes).toHaveLength(0);
    });

    it('reports itself open but skips the popover when the DOM is missing', async () => {
      await toolbar.tryToShow();
      toolbar.close();
      popoverHolder.params = [];
      toolbar.nodes.wrapper = undefined;

      await toolbar.tryToShow();

      expect(toolbar.opened).toBe(true);
      expect(popoverHolder.params).toHaveLength(0);
    });

    it('closes itself when the popover reports it was closed from the inside', async () => {
      await toolbar.tryToShow();

      popoverHolder.handlerLists[0].forEach((handler) => handler());

      expect(toolbar.opened).toBe(false);
    });

    it('ignores a Closed event from a popover it already replaced', async () => {
      await toolbar.tryToShow();
      toolbar.close();
      await toolbar.tryToShow();

      popoverHolder.handlerLists[0].forEach((handler) => handler());

      expect(toolbar.opened).toBe(true);
    });
  });

  describe('positioning', () => {
    it('places the wrapper under the selection', async () => {
      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper?.style.left).toBe('100px');
      expect(toolbar.nodes.wrapper?.style.top).toBe(`${40 + 20 + INLINE_TOOLBAR_VERTICAL_MARGIN_DESKTOP}px`);
    });

    it('pulls the wrapper back inside the content area using the popover width', async () => {
      Object.defineProperty(blok.UI, 'contentRect', { value: new DOMRect(0, 0, 200, 600), configurable: true });

      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper?.style.left).toBe('0px');
    });

    it('measures the popover from its element when it reports no size', async () => {
      Object.defineProperty(blok.UI, 'contentRect', { value: new DOMRect(0, 0, 200, 600), configurable: true });
      vi.spyOn(popoverElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 120, 38));
      popoverHolder.factory = () => ({
        show,
        hide,
        destroy: destroyPopover,
        getElement: () => popoverElement,
        getMountElement: () => mountElement,
      });

      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper?.style.left).toBe('80px');
    });

    it('offsets by its own containing block when the wrapper is laid out inside the UI wrapper', async () => {
      await toolbar.tryToShow();
      toolbar.close();

      const wrapper = toolbar.nodes.wrapper;

      Object.defineProperty(wrapper, 'offsetParent', {
        value: uiWrapper,
        configurable: true,
      });
      vi.spyOn(uiWrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 15, 900, 500));

      await toolbar.tryToShow();

      expect(wrapper?.style.left).toBe('70px');
      expect(wrapper?.style.top).toBe(`${40 + 20 - 15 + INLINE_TOOLBAR_VERTICAL_MARGIN_DESKTOP}px`);
    });

    it('ignores the UI wrapper offset when it is not the containing block', async () => {
      vi.spyOn(uiWrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 15, 900, 500));

      await toolbar.tryToShow();

      expect(toolbar.nodes.wrapper?.style.left).toBe('100px');
    });
  });

  describe('tool shortcuts', () => {
    /**
     * Registers a `link` tool under both the global registry and the current
     * block, then drives it through the public editLink() entry point.
     * @param adapter - the adapter both registries get
     */
    const registerLinkTool = (adapter: ToolAdapterStub): void => {
      blockInlineTools.set('link', asAdapter(adapter));
      registeredInlineTools.set('link', asAdapter(adapter));
    };

    /**
     * Builds an anchor inside the editable block.
     * @param text - anchor text; empty text makes the expanded selection collapsed
     */
    const anchorInBlock = (text = 'a link'): HTMLAnchorElement => {
      const anchor = document.createElement('a');

      anchor.href = 'https://example.com';
      anchor.textContent = text;
      blockHolder.appendChild(anchor);

      return anchor;
    };

    it('applies a tool that handles its own shortcut instead of opening a menu', async () => {
      const applyShortcut = vi.fn();
      const instanceDestroy = vi.fn();

      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => ({ name: 'link', children: { items: [] } }),
          applyShortcut,
          destroy: instanceDestroy,
        }),
      });

      await toolbar.editLink(anchorInBlock());

      expect(applyShortcut).toHaveBeenCalledTimes(1);
      expect(toolbar.opened).toBe(false);
      expect(instanceDestroy).toHaveBeenCalledTimes(1);
    });

    it('ignores a non-function applyShortcut and opens the menu instead', async () => {
      const linkChildren = { items: [{ name: 'link-input' }], onOpen: vi.fn() };

      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => ({ name: 'link', children: linkChildren }),
          applyShortcut: 'not callable',
        }),
      });

      await toolbar.editLink(anchorInBlock());

      expect(toolbar.hasDirectMenuOpen).toBe(true);
      expect(linkChildren.onOpen).toHaveBeenCalledTimes(1);
    });

    it('ignores applyShortcut on a non-object tool instance', async () => {
      const applyShortcut = vi.fn();
      const callableInstance = Object.assign(
        () => undefined,
        {
          render: () => ({ name: 'link', children: { items: [{ name: 'link-input' }] } }),
          applyShortcut,
        }
      );

      registerLinkTool({
        name: 'link',
        create: () => callableInstance,
      });

      await toolbar.editLink(anchorInBlock());

      expect(applyShortcut).not.toHaveBeenCalled();
      expect(toolbar.hasDirectMenuOpen).toBe(true);
    });

    it('fails at render, not in the shortcut probe, when a tool creates nothing', async () => {
      registerLinkTool({
        name: 'link',
        create: () => null as unknown as ToolInstanceStub,
      });

      await expect(toolbar.editLink(anchorInBlock())).rejects.toThrow(/render/);
    });

    it('destroys the throwaway instance it probes for a shortcut hook', async () => {
      const instanceDestroy = vi.fn();

      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => ({ name: 'link', onActivate: vi.fn() }),
          destroy: instanceDestroy,
        }),
      });

      await toolbar.editLink(anchorInBlock());

      // Two probes run before the toolbar opens: the applyShortcut probe and the
      // nested-menu probe. Both must release their instance.
      expect(instanceDestroy).toHaveBeenCalledTimes(2);
    });

    it('opens the full toolbar and activates the item for a tool without a menu', async () => {
      const onActivate = vi.fn();

      registerLinkTool({
        name: 'link',
        create: () => ({ render: () => ({ name: 'link', onActivate }) }),
      });

      await toolbar.editLink(anchorInBlock());

      expect(activateItemByName).toHaveBeenCalledWith('link');
      expect(onActivate).not.toHaveBeenCalled();
    });

    it('does not re-run the show sequence when the toolbar is already open', async () => {
      registerLinkTool({
        name: 'link',
        create: () => ({ render: () => ({ name: 'link', onActivate: vi.fn() }) }),
      });
      await toolbar.tryToShow();

      await toolbar.editLink(anchorInBlock());

      expect(hideBlockActions).toHaveBeenCalledTimes(1);
    });

    it('waits for an open already in flight before activating the item', async () => {
      const onActivate = vi.fn();

      registerLinkTool({
        name: 'link',
        create: () => ({ render: () => ({ name: 'link', onActivate }) }),
      });

      const pending = toolbar.tryToShow();

      await toolbar.editLink(anchorInBlock());
      await pending;

      expect(activateItemByName).toHaveBeenCalledWith('link');
      expect(onActivate).not.toHaveBeenCalled();
    });

    it('falls back to the plain toolbar for an anchor whose tool is not registered', async () => {
      await toolbar.editLink(anchorInBlock());

      // No tool means no shortcut hook and no menu: the ordinary toolbar opens
      // and the (absent) item is still requested by name.
      expect(activateItemByName).toHaveBeenCalledWith('link');
      expect(toolbar.hasDirectMenuOpen).toBe(false);
      expect(toolbar.opened).toBe(true);
    });
  });

  describe('direct tool menu', () => {
    let onOpen: ReturnType<typeof vi.fn>;
    let onClose: ReturnType<typeof vi.fn>;
    let anchor: HTMLAnchorElement;

    /**
     * Registers a link tool in both registries.
     * @param adapter - adapter shared by the global registry and the block
     */
    const registerLinkTool = (adapter: ToolAdapterStub): void => {
      blockInlineTools.set('link', asAdapter(adapter));
      registeredInlineTools.set('link', asAdapter(adapter));
    };

    beforeEach(() => {
      onOpen = vi.fn();
      onClose = vi.fn();
      anchor = document.createElement('a');
      anchor.href = 'https://example.com';
      anchor.textContent = 'a link';
      blockHolder.appendChild(anchor);

      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => ({
            name: 'link',
            children: { items: [{ name: 'link-input' }], onOpen, onClose },
          }),
          destroy: vi.fn(),
        }),
      });
    });

    it('selects the anchor contents first, so it works with nothing selected', async () => {
      window.getSelection()?.removeAllRanges();

      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(true);
    });

    it('shows only the tool menu and runs its open hook', async () => {
      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(true);
      expect(lastPopoverItems()).toStrictEqual([{ name: 'link-input' }]);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(hideBlockActions).toHaveBeenCalledTimes(1);
    });

    it('replaces an already open toolbar', async () => {
      await toolbar.tryToShow();

      await toolbar.editLink(anchor);

      expect(hide).toHaveBeenCalledTimes(1);
      expect(toolbar.hasDirectMenuOpen).toBe(true);
    });

    it('runs the menu close hook once when the toolbar closes', async () => {
      await toolbar.editLink(anchor);

      toolbar.close();

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(toolbar.hasDirectMenuOpen).toBe(false);
    });

    it('tolerates a menu without open and close hooks', async () => {
      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => ({ name: 'link', children: { items: [{ name: 'link-input' }] } }),
        }),
      });

      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(true);
      expect(() => toolbar.close()).not.toThrow();
    });

    it('keeps the DOM ready even when the selection forbids the menu', async () => {
      blok.BlockManager.currentBlock = undefined;

      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(false);
      expect(toolbar.opened).toBe(false);
      expect(toolbar.nodes.wrapper).toBeInstanceOf(HTMLElement);
    });

    it('refuses a collapsed caret for a tool that wraps a selection', async () => {
      anchor.textContent = '';

      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(false);
      expect(toolbar.opened).toBe(false);
    });

    it('allows a collapsed caret for a tool that inserts at the caret', async () => {
      anchor.textContent = '';
      registerLinkTool({
        name: 'link',
        allowCaretShortcut: true,
        create: () => ({
          render: () => ({ name: 'link', children: { items: [{ name: 'link-input' }], onOpen } }),
        }),
      });

      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(true);
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('rolls the menu back when the popover cannot be built', async () => {
      const toolDestroy = vi.fn();

      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => ({ name: 'link', children: { items: [], onOpen, onClose } }),
          destroy: toolDestroy,
        }),
      });
      popoverHolder.factory = () => {
        throw new Error('popover blew up');
      };

      await toolbar.editLink(anchor);

      expect(toolbar.opened).toBe(false);
      expect(toolbar.hasDirectMenuOpen).toBe(false);
      // Two shortcut probes plus the instance the menu was built from.
      expect(toolDestroy).toHaveBeenCalledTimes(3);
      expect(hideBlockActions).not.toHaveBeenCalled();
    });

    it('tears down a half-open menu popover', async () => {
      popoverHolder.factory = () => ({
        ...defaultPopoverStub(),
        show: vi.fn(() => {
          throw new Error('show failed');
        }),
      });

      await toolbar.editLink(anchor);

      expect(hide).toHaveBeenCalledTimes(1);
      expect(destroyPopover).toHaveBeenCalledTimes(1);
      expect(toolbar.opened).toBe(false);
    });

    it('survives a half-open menu popover with no hide or destroy hook', async () => {
      popoverHolder.factory = () => ({
        getElement: () => popoverElement,
        getMountElement: () => mountElement,
        size: { width: 200 },
        show: () => {
          throw new Error('show failed');
        },
      });

      await expect(toolbar.editLink(anchor)).resolves.toBeUndefined();
      expect(toolbar.opened).toBe(false);
    });

    it('picks the rendered entry that carries the menu', async () => {
      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => [
            { name: 'link', onActivate: vi.fn() },
            { name: 'link', children: { items: [{ name: 'link-input' }], onOpen } },
          ],
        }),
      });

      await toolbar.editLink(anchor);

      expect(lastPopoverItems()).toStrictEqual([{ name: 'link-input' }]);
    });

    it('skips an entry that declares an empty children slot', async () => {
      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => [
            { name: 'link', children: undefined },
            { name: 'link', children: { items: [{ name: 'link-input' }], onOpen } },
          ],
        }),
      });

      await toolbar.editLink(anchor);

      expect(toolbar.opened).toBe(true);
      expect(lastPopoverItems()).toStrictEqual([{ name: 'link-input' }]);
    });

    it('opens the plain toolbar for a tool whose children slot is empty', async () => {
      const onActivate = vi.fn();

      registerLinkTool({
        name: 'link',
        create: () => ({ render: () => ({ name: 'link', children: undefined, onActivate }) }),
      });

      await toolbar.editLink(anchor);

      expect(activateItemByName).toHaveBeenCalledWith('link');
      expect(toolbar.hasDirectMenuOpen).toBe(false);
    });

    it('opens a menu when any rendered entry declares one', async () => {
      registerLinkTool({
        name: 'link',
        create: () => ({
          render: () => [
            { name: 'link', onActivate: vi.fn() },
            { name: 'link', children: { items: [{ name: 'link-input' }], onOpen } },
          ],
        }),
      });

      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(true);
    });

    it('destroys the instance it renders only to probe for a menu', async () => {
      const instanceDestroy = vi.fn();
      let probeCount = 0;

      registerLinkTool({
        name: 'link',
        create: () => {
          probeCount += 1;

          return {
            render: () => ({ name: 'link', children: { items: [], onOpen } }),
            destroy: probeCount === 2 ? instanceDestroy : vi.fn(),
          };
        },
      });

      await toolbar.editLink(anchor);

      expect(instanceDestroy).toHaveBeenCalledTimes(1);
    });

    it('opens with an empty menu when the block has no instance of that tool', async () => {
      blockInlineTools.delete('link');

      await toolbar.editLink(anchor);

      expect(toolbar.opened).toBe(true);
      expect(lastPopoverItems()).toStrictEqual([]);
      expect(toolbar.hasDirectMenuOpen).toBe(false);
    });

    it('opens with an empty menu when the block instance renders no menu', async () => {
      blockInlineTools.set('link', asAdapter({
        name: 'link',
        create: () => ({ render: () => ({ name: 'link', onActivate: vi.fn() }) }),
      }));

      await toolbar.editLink(anchor);

      expect(toolbar.opened).toBe(true);
      expect(lastPopoverItems()).toStrictEqual([]);
    });

    it('picks the requested tool, not the first one the block offers', async () => {
      blockInlineTools.set('bold', asAdapter({
        name: 'bold',
        create: () => ({ render: () => ({ name: 'bold' }) }),
      }));

      await toolbar.editLink(anchor);

      expect(lastPopoverItems()).toStrictEqual([{ name: 'link-input' }]);
    });

    it('opens with an empty menu when the menu declares no items', async () => {
      registerLinkTool({
        name: 'link',
        create: () => ({ render: () => ({ name: 'link', children: { onOpen } }) }),
      });

      await toolbar.editLink(anchor);

      expect(lastPopoverItems()).toStrictEqual([]);
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('recovers on the next attempt after a failed menu open', async () => {
      popoverHolder.factory = () => {
        throw new Error('popover blew up');
      };
      await toolbar.editLink(anchor);

      popoverHolder.factory = defaultPopoverStub;
      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(true);
      expect(toolbar.opened).toBe(true);
    });
  });

  describe('direct menu styling', () => {
    let anchor: HTMLAnchorElement;

    beforeEach(() => {
      anchor = document.createElement('a');
      anchor.href = 'https://example.com';
      anchor.textContent = 'a link';
      blockHolder.appendChild(anchor);

      const adapter = asAdapter({
        name: 'link',
        create: () => ({
          render: () => ({ name: 'link', children: { items: [{ name: 'link-input' }] } }),
        }),
      });

      blockInlineTools.set('link', adapter);
      registeredInlineTools.set('link', adapter);

      popoverElement.style.width = '320px';
      popoverElement.style.height = '38px';
      popoverContainer.style.height = '38px';
      popoverContainer.className = 'h-[38px]';
      popoverItemsHost.className = 'flex';
    });

    it('releases the bar sizing so the menu box sizes to its own content', async () => {
      await toolbar.editLink(anchor);

      expect(popoverElement.style.width).toBe('');
      expect(popoverElement.style.height).toBe('');
      expect(popoverElement.style.verticalAlign).toBe('top');
    });

    it('turns the horizontal bar container into a vertical menu box', async () => {
      await toolbar.editLink(anchor);

      expect(popoverContainer.style.height).toBe('');
      expect(popoverContainer.className).toContain('h-fit');
      expect(popoverContainer.className).toContain('w-max');
      expect(popoverContainer.className).toContain('flex-col');
      expect(popoverContainer.className).toContain('p-1.5');
      expect(popoverContainer.className).toContain('max-h-none');
    });

    it('stacks the menu items to the full box width', async () => {
      await toolbar.editLink(anchor);

      expect(popoverItemsHost.className).toContain('block');
      expect(popoverItemsHost.className).toContain('w-full');
      expect(popoverItemsHost.className).toContain('pb-0');
    });

    it('leaves the horizontal bar untouched for a plain toolbar open', async () => {
      await toolbar.tryToShow();

      expect(popoverElement.style.verticalAlign).toBe('');
      expect(popoverElement.style.width).toBe('320px');
      expect(popoverContainer.className).toBe('h-[38px]');
    });

    it('opens the menu even when the popover exposes no element to restyle', async () => {
      popoverHolder.factory = () => ({
        show,
        hide,
        destroy: destroyPopover,
        getMountElement: () => mountElement,
        size: { width: 200 },
      });

      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(true);
      expect(toolbar.opened).toBe(true);
    });

    it('opens the menu when the popover has no container or items host', async () => {
      const bare = document.createElement('div');

      popoverHolder.factory = () => ({
        ...defaultPopoverStub(),
        getElement: () => bare,
      });

      await toolbar.editLink(anchor);

      expect(toolbar.hasDirectMenuOpen).toBe(true);
      expect(bare.style.verticalAlign).toBe('top');
    });

    it('opens the menu when the container carries no items host', async () => {
      const root = document.createElement('div');
      const container = document.createElement('div');

      container.setAttribute(DATA_ATTR.popoverContainer, '');
      root.appendChild(container);
      popoverHolder.factory = () => ({
        ...defaultPopoverStub(),
        getElement: () => root,
      });

      await toolbar.editLink(anchor);

      expect(container.className).toContain('h-fit');
      expect(toolbar.hasDirectMenuOpen).toBe(true);
    });
  });

  describe('direct tool action fallback', () => {
    let anchor: HTMLAnchorElement;

    beforeEach(() => {
      anchor = document.createElement('a');
      anchor.href = 'https://example.com';
      anchor.textContent = 'a link';
      blockHolder.appendChild(anchor);
      // No block under the anchor: the toolbar cannot open, so the tool's own
      // action is the only way its shortcut can still do something.
      blok.BlockManager.currentBlock = undefined;
    });

    /**
     * Registers a link tool in the global registry only.
     * @param instance - factory for the tool instance
     */
    const registerLinkTool = (instance: () => ToolInstanceStub): void => {
      registeredInlineTools.set('link', asAdapter({ name: 'link', create: instance }));
    };

    it('invokes the tool action directly when no popover could open', async () => {
      const onActivate = vi.fn();

      registerLinkTool(() => ({ render: () => ({ name: 'link', onActivate }) }));

      await toolbar.editLink(anchor);

      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(toolbar.opened).toBe(false);
    });

    it('passes the item itself to its own action', async () => {
      const onActivate = vi.fn();
      const item = { name: 'link', onActivate };

      registerLinkTool(() => ({ render: () => item }));

      await toolbar.editLink(anchor);

      expect(onActivate.mock.calls[0][0]).toBe(item);
    });

    it('picks the entry that actually carries an action', async () => {
      const onActivate = vi.fn();

      registerLinkTool(() => ({
        render: () => [
          { name: 'link-label' },
          { name: 'link', onActivate },
        ],
      }));

      await toolbar.editLink(anchor);

      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('skips entries whose action slot is empty or not callable', async () => {
      const onActivate = vi.fn();

      registerLinkTool(() => ({
        render: () => [
          { name: 'link-a', onActivate: undefined },
          { name: 'link-b', onActivate: 'not callable' },
          { name: 'link', onActivate },
        ],
      }));

      await toolbar.editLink(anchor);

      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a tool that renders no action', async () => {
      registerLinkTool(() => ({ render: () => ({ name: 'link' }) }));

      await expect(toolbar.editLink(anchor)).resolves.toBeUndefined();
    });

    it('does nothing for an unregistered tool', async () => {
      registeredInlineTools.delete('link');

      await expect(toolbar.editLink(anchor)).resolves.toBeUndefined();
    });

    it('destroys the throwaway instance it created for the action', async () => {
      const instanceDestroy = vi.fn();

      registerLinkTool(() => ({
        render: () => ({ name: 'link', onActivate: vi.fn() }),
        destroy: instanceDestroy,
      }));

      await toolbar.editLink(anchor);

      // Three throwaway instances: the applyShortcut probe, the nested-menu probe
      // and the one this call activates. Each must be released.
      expect(instanceDestroy).toHaveBeenCalledTimes(3);
    });
  });
});

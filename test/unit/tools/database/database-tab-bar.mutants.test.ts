import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';

/**
 * Recording doubles for the two popovers the tab bar owns. The bar hands its
 * whole configuration to a constructor and never reads it back, so the
 * constructor arguments are the only place that configuration is observable.
 */
interface RecordedItem {
  type?: string;
  icon?: string;
  title?: string;
  isDestructive?: boolean;
  closeOnActivate?: boolean;
  onActivate?: () => void;
}

interface RecordedPopoverParams {
  items: RecordedItem[];
  trigger?: HTMLElement;
  width?: string;
  minWidth?: string;
  autoFocusFirstItem?: boolean;
}

interface ContextPopoverProbe {
  params: RecordedPopoverParams;
  destroyCount: number;
  shownCount: number;
  /** Simulates the popover closing itself (outside click, Escape). */
  fireClosed(): void;
}

interface ViewPopoverProbe {
  destroyCount: number;
  openedWith: HTMLElement | null;
  select(type: string): void;
  fireClose(): void;
}

const probes = vi.hoisted(() => ({
  contexts: [] as ContextPopoverProbe[],
  views: [] as ViewPopoverProbe[],
}));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    private readonly closedHandlers: Array<() => void> = [];
    private readonly probe: ContextPopoverProbe;

    constructor(params: RecordedPopoverParams) {
      this.probe = {
        params,
        destroyCount: 0,
        shownCount: 0,
        fireClosed: (): void => {
          for (const handler of [...this.closedHandlers]) {
            handler();
          }
        },
      };
      probes.contexts.push(this.probe);
    }

    show(): void {
      this.probe.shownCount += 1;
    }

    hide(): void {
      /* no-op */
    }

    // The real popover emits Closed as part of being destroyed; the bar's Closed
    // handler is written to survive being re-entered that way.
    destroy(): void {
      this.probe.destroyCount += 1;
      this.probe.fireClosed();
    }

    on(event: string, handler: () => void): void {
      if (event === 'closed') {
        this.closedHandlers.push(handler);
      }
    }

    off(): void {
      /* no-op */
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop };
});

vi.mock('../../../../src/tools/database/database-view-popover', () => {
  class MockDatabaseViewPopover {
    private readonly probe: ViewPopoverProbe;

    constructor(options: { onSelect: (type: string) => void; onClose?: () => void }) {
      this.probe = {
        destroyCount: 0,
        openedWith: null,
        select: (type: string): void => {
          options.onSelect(type);
        },
        fireClose: (): void => {
          options.onClose?.();
        },
      };
      probes.views.push(this.probe);
    }

    open(anchor: HTMLElement): void {
      this.probe.openedWith = anchor;
    }

    close(): void {
      this.probe.fireClose();
    }

    destroy(): void {
      this.probe.destroyCount += 1;
      this.probe.fireClose();
    }
  }

  return { DatabaseViewPopover: MockDatabaseViewPopover };
});

/**
 * The tab bar's only observable statement about where the overflow dropdown
 * goes is the option object it hands to the placement engine, so the engine is
 * replaced by a recorder.
 */
vi.mock('../../../../src/components/utils/popover/anchored-position', () => ({
  positionFixedAnchored: vi.fn(),
  createPositionTracker: () => ({ attach: (): void => undefined, detach: (): void => undefined }),
}));

import { DatabaseTabBar, type TabBarOptions } from '../../../../src/tools/database/database-tab-bar';
import { positionFixedAnchored } from '../../../../src/components/utils/popover/anchored-position';
import type { DatabaseViewConfig, ViewType } from '../../../../src/tools/database/types';
import type { API } from '../../../../types';

interface I18nStub {
  t(key: string, vars?: Record<string, string | number>): string;
  has(key: string): boolean;
}

const makeApi = (i18n: I18nStub): API => ({ i18n } as unknown as API);

/** Echoes keys back, so a mutated translation key shows up in the rendered string. */
const echoApi = (): API => makeApi({ t: (key: string) => key, has: () => false });

const makeView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'view',
  name: 'Board',
  type: 'board',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});

const makeRect = (left: number, right: number, top = 0): DOMRect => ({
  x: left,
  y: top,
  width: right - left,
  height: 30,
  top,
  right,
  bottom: top + 30,
  left,
  toJSON: () => ({}),
});

interface ResizeProbe {
  observed: Element[];
  fire(): void;
}

const resizeProbes: ResizeProbe[] = [];
const originalResizeObserver = globalThis.ResizeObserver;

class StubResizeObserver implements ResizeObserver {
  private readonly observed: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    resizeProbes.push({
      observed: this.observed,
      fire: (): void => {
        callback([], this);
      },
    });
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(): void {
    /* no-op */
  }

  disconnect(): void {
    /* no-op */
  }
}

const queryOne = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector(selector);

  if (!(found instanceof HTMLElement)) {
    throw new Error(`expected one ${selector}`);
  }

  return found;
};

const tabOf = (root: ParentNode, viewId: string): HTMLElement =>
  queryOne(root, `[data-blok-database-tab][data-view-id="${viewId}"]`);

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const key = (name: string): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });

const pointer = (type: string, clientX: number): PointerEvent =>
  new PointerEvent(type, { clientX, clientY: 15, bubbles: true, cancelable: true });

/**
 * jsdom hands an exception thrown inside an event listener to `window`'s error
 * event rather than letting it out of `dispatchEvent`, and the test run stays
 * green, so a listener that throws is otherwise invisible.
 */
const uncaughtDuring = (run: () => void): string[] => {
  const seen: string[] = [];
  const onError = (event: ErrorEvent): void => {
    seen.push(event.message);
  };

  window.addEventListener('error', onError);
  try {
    run();
  } finally {
    window.removeEventListener('error', onError);
  }

  return seen;
};

describe('DatabaseTabBar — surviving-mutant coverage', () => {
  let onTabClick: ReturnType<typeof vi.fn<(viewId: string) => void>>;
  let onAddView: ReturnType<typeof vi.fn<(type: ViewType) => void>>;
  let onRename: ReturnType<typeof vi.fn<(viewId: string, newName: string) => void>>;
  let onDuplicate: ReturnType<typeof vi.fn<(viewId: string) => void>>;
  let onDelete: ReturnType<typeof vi.fn<(viewId: string) => void>>;
  let onReorder: ReturnType<typeof vi.fn<(viewId: string, newPosition: string) => void>>;

  const live: DatabaseTabBar[] = [];

  const build = (options: Partial<TabBarOptions> & { views: DatabaseViewConfig[]; activeViewId: string }): DatabaseTabBar => {
    const bar = new DatabaseTabBar({
      onTabClick,
      onAddView,
      onRename,
      onDuplicate,
      onDelete,
      onReorder,
      ...options,
    });

    live.push(bar);

    return bar;
  };

  const mount = (
    views: DatabaseViewConfig[],
    activeViewId: string,
    options: Partial<TabBarOptions> = {}
  ): { bar: DatabaseTabBar; el: HTMLElement } => {
    const bar = build({ views, activeViewId, ...options });
    const el = bar.render();

    document.body.appendChild(el);

    return { bar, el };
  };

  const lastResizeProbe = (): ResizeProbe => {
    const probe = resizeProbes[resizeProbes.length - 1];

    if (probe === undefined) {
      throw new Error('no ResizeObserver was constructed');
    }

    return probe;
  };

  const lastContext = (): ContextPopoverProbe => {
    const probe = probes.contexts[probes.contexts.length - 1];

    if (probe === undefined) {
      throw new Error('no context popover was constructed');
    }

    return probe;
  };

  const lastViewPopover = (): ViewPopoverProbe => {
    const probe = probes.views[probes.views.length - 1];

    if (probe === undefined) {
      throw new Error('no view popover was constructed');
    }

    return probe;
  };

  const openContextOn = (tab: HTMLElement): ContextPopoverProbe => {
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    return lastContext();
  };

  const threeViews = (): DatabaseViewConfig[] => [
    makeView({ id: 'v1', name: 'One', position: 'a0' }),
    makeView({ id: 'v2', name: 'Two', position: 'a1' }),
    makeView({ id: 'v3', name: 'Three', position: 'a2' }),
  ];

  /** Sizes tabs and the bar so the overflow arithmetic has a single right answer. */
  const layOutForOverflow = (el: HTMLElement, barWidth: number): void => {
    for (const tab of Array.from(el.querySelectorAll('[data-blok-database-tab]'))) {
      Object.defineProperty(tab, 'offsetWidth', { value: 100, configurable: true });
    }
    Object.defineProperty(el, 'clientWidth', { value: barWidth, configurable: true });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    probes.contexts.length = 0;
    probes.views.length = 0;
    resizeProbes.length = 0;
    live.length = 0;
    onTabClick = vi.fn<(viewId: string) => void>();
    onAddView = vi.fn<(type: ViewType) => void>();
    onRename = vi.fn<(viewId: string, newName: string) => void>();
    onDuplicate = vi.fn<(viewId: string) => void>();
    onDelete = vi.fn<(viewId: string) => void>();
    onReorder = vi.fn<(viewId: string, newPosition: string) => void>();
    globalThis.ResizeObserver = StubResizeObserver;
  });

  afterEach(() => {
    for (const bar of live) {
      try {
        bar.destroy();
      } catch {
        /* a bar whose destroy() throws is the assertion's business, not cleanup's */
      }
    }
    live.length = 0;
    document.body.replaceChildren();
    globalThis.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();

    // The keyboard focus hand-off is module-level state shared by every bar in
    // the process: a test that arms it and does not spend it makes the NEXT
    // test's focus assertions depend on run order.
    const drain = new DatabaseTabBar({
      views: [makeView({ id: 'drain' })],
      activeViewId: 'drain',
      onTabClick: () => undefined,
      onAddView: () => undefined,
      onRename: () => undefined,
      onDuplicate: () => undefined,
      onDelete: () => undefined,
      onReorder: () => undefined,
    });

    drain.render();
    drain.destroy();
  });

  describe('bar and tab markup', () => {
    it('stamps the bar with empty-valued marker attributes and a tablist role', () => {
      const { el } = mount([makeView({ id: 'v1' })], 'v1');

      expect(el.getAttribute('data-blok-database-tab-bar')).toBe('');
      expect(el.getAttribute('role')).toBe('tablist');
      expect(el.getAttribute('data-blok-keyboard-owner')).toBe('');
    });

    it('stamps every tab attribute the CSS and a11y tree read', () => {
      const { el } = mount(
        [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })],
        'v2'
      );
      const active = tabOf(el, 'v2');
      const inactive = tabOf(el, 'v1');

      expect(active.getAttribute('data-blok-database-tab')).toBe('');
      expect(active.getAttribute('role')).toBe('tab');
      expect(active.getAttribute('aria-selected')).toBe('true');
      expect(active.getAttribute('data-active')).toBe('');
      expect(active.getAttribute('aria-current')).toBe('true');
      expect(inactive.getAttribute('aria-selected')).toBe('false');
      expect(inactive.hasAttribute('data-active')).toBe(false);
      expect(queryOne(active, '[data-blok-database-tab-name]').getAttribute('data-blok-database-tab-name')).toBe('');
    });

    it('renders no icon markup for a view type the icon table does not cover', () => {
      const { el } = mount([makeView({ id: 'v1', type: 'table' })], 'v1');
      const tab = tabOf(el, 'v1');

      expect(tab.children.length).toBe(2);
      expect(tab.children[0].innerHTML).toBe('');
      expect(tab.children[1].textContent).toBe('Board');
    });

    it('labels the add button from the dictionary key, falling back to English', () => {
      const { el } = mount([makeView({ id: 'v1' })], 'v1');

      expect(queryOne(el, '[data-blok-database-add-view]').getAttribute('data-blok-database-add-view')).toBe('');
      expect(queryOne(el, '[data-blok-database-add-view]').getAttribute('aria-label')).toBe('Add view');

      const localized = mount([makeView({ id: 'v1' })], 'v1', { api: echoApi() });

      expect(queryOne(localized.el, '[data-blok-database-add-view]').getAttribute('aria-label')).toBe(
        'tools.database.addView'
      );
    });
  });

  describe('tab order', () => {
    const tabIds = (root: ParentNode): (string | null)[] =>
      Array.from(root.querySelectorAll('[data-blok-database-tab]')).map((tab) =>
        tab.getAttribute('data-view-id')
      );

    it('lays the tabs out by position, not by the order the views arrived in', () => {
      const { el } = mount(
        [
          makeView({ id: 'v3', name: 'Three', position: 'a2' }),
          makeView({ id: 'v1', name: 'One', position: 'a0' }),
          makeView({ id: 'v2', name: 'Two', position: 'a1' }),
        ],
        'v1'
      );

      expect(tabIds(el)).toStrictEqual(['v1', 'v2', 'v3']);
    });

    it('keeps two views that share a position in the order they arrived', () => {
      const { el } = mount(
        [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a0' })],
        'v1'
      );

      expect(tabIds(el)).toStrictEqual(['v1', 'v2']);
    });
  });

  describe('roving tab stop', () => {
    it('parks the single tab stop on the active tab, not the first one', () => {
      const { el } = mount(
        [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })],
        'v2'
      );

      expect(tabOf(el, 'v2').getAttribute('tabindex')).toBe('0');
      expect(tabOf(el, 'v1').getAttribute('tabindex')).toBe('-1');
    });
  });

  describe('activating a tab', () => {
    it('activates on Enter and on Space, and swallows the key', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const first = mount(views, 'v1');
      const enter = key('Enter');

      tabOf(first.el, 'v2').dispatchEvent(enter);
      expect(onTabClick).toHaveBeenCalledWith('v2');
      expect(enter.defaultPrevented).toBe(true);

      onTabClick.mockClear();

      const second = mount(views, 'v1');
      const space = key(' ');

      tabOf(second.el, 'v2').dispatchEvent(space);
      expect(onTabClick).toHaveBeenCalledWith('v2');
      expect(space.defaultPrevented).toBe(true);
    });

    it('ignores every other key', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const { el } = mount(views, 'v1');
      const other = key('a');

      tabOf(el, 'v2').dispatchEvent(other);
      expect(onTabClick).not.toHaveBeenCalled();
      expect(other.defaultPrevented).toBe(false);
    });

    it('is not an error when a pointer press misses every tab', () => {
      const { el } = mount(threeViews(), 'v1');

      expect(
        uncaughtDuring(() => {
          el.dispatchEvent(pointer('pointerdown', 50));
        })
      ).toStrictEqual([]);
    });

    it('ignores a click on a tab that carries no view id', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const { el } = mount(views, 'v1');
      const tab = tabOf(el, 'v2');

      tab.removeAttribute('data-view-id');
      tab.click();

      expect(onTabClick).not.toHaveBeenCalled();
    });
  });

  describe('keyboard focus hand-off across the re-render', () => {
    it('moves focus into the next bar after an arrow key selects the first tab', async () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const first = mount(views, 'v2');

      tabOf(first.el, 'v2').focus();
      tabOf(first.el, 'v2').dispatchEvent(key('ArrowLeft'));

      expect(onTabClick).toHaveBeenCalledWith('v1');

      const second = mount(views, 'v1');

      await flush();

      expect(tabOf(second.el, 'v1')).toHaveFocus();
    });

    it('moves focus into the next bar after Enter activates a tab', async () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const first = mount(views, 'v1');

      tabOf(first.el, 'v2').dispatchEvent(key('Enter'));

      const second = mount(views, 'v2');

      await flush();

      expect(tabOf(second.el, 'v2')).toHaveFocus();
    });

    it('leaves focus alone after a mouse click activates a tab', async () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const first = mount(views, 'v1');

      tabOf(first.el, 'v2').click();
      expect(onTabClick).toHaveBeenCalledWith('v2');

      const second = mount(views, 'v2');

      await flush();

      expect(tabOf(second.el, 'v2')).not.toHaveFocus();
    });

    it('does not carry the hand-off over into a later render', async () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];

      mount(views, 'v1');

      const second = mount(views, 'v1');

      await flush();

      expect(tabOf(second.el, 'v1')).not.toHaveFocus();
    });

    it('survives a hand-off into a bar whose active view is missing', async () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const first = mount(views, 'v1');

      tabOf(first.el, 'v2').dispatchEvent(key('Enter'));

      const second = mount(views, 'gone');

      await flush();

      expect(second.el.querySelectorAll('[data-blok-database-tab]').length).toBe(2);
    });
  });

  describe('context menu triggers', () => {
    it('opens the menu on right-click and suppresses the native one', () => {
      const { el } = mount(threeViews(), 'v1');
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

      tabOf(el, 'v2').dispatchEvent(event);

      expect(probes.contexts.length).toBe(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves a right-click outside any tab to the browser', () => {
      const { el } = mount(threeViews(), 'v1');
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

      el.dispatchEvent(event);

      expect(probes.contexts.length).toBe(0);
      expect(event.defaultPrevented).toBe(false);
    });

    it('opens the menu on double-click', () => {
      const { el } = mount(threeViews(), 'v1');

      tabOf(el, 'v2').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

      expect(probes.contexts.length).toBe(1);
      expect(lastContext().params.trigger).toBe(tabOf(el, 'v2'));
    });

    it('ignores a double-click outside any tab', () => {
      const { el } = mount(threeViews(), 'v1');

      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

      expect(probes.contexts.length).toBe(0);
    });

    it('reaches a double-click outside any tab without throwing', () => {
      const { el } = mount(threeViews(), 'v1');

      expect(
        uncaughtDuring(() => {
          el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        })
      ).toStrictEqual([]);
      expect(probes.contexts.length).toBe(0);
    });

    it('ignores a right-click or double-click on a tab that carries no view id', () => {
      const { el } = mount(threeViews(), 'v1');
      const tab = tabOf(el, 'v2');

      tab.removeAttribute('data-view-id');
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

      expect(probes.contexts.length).toBe(0);
    });
  });

  describe('context menu contents', () => {
    it('describes rename, duplicate and a separated destructive delete', () => {
      const { el } = mount(threeViews(), 'v1', { api: echoApi() });
      const probe = openContextOn(tabOf(el, 'v2'));
      const { items } = probe.params;

      expect(items.length).toBe(4);
      expect(items[0].title).toBe('tools.database.renameView');
      expect(items[0].closeOnActivate).toBe(true);
      expect(items[1].title).toBe('tools.database.duplicateView');
      expect(items[1].closeOnActivate).toBe(true);
      expect(items[2]).toStrictEqual({ type: PopoverItemType.Separator });
      expect(items[3].title).toBe('tools.database.deleteView');
      expect(items[3].isDestructive).toBe(true);
      expect(items[3].closeOnActivate).toBe(true);
    });

    it('offers no delete — and no separator — for the last remaining view', () => {
      const { el } = mount([makeView({ id: 'v1' })], 'v1');
      const probe = openContextOn(tabOf(el, 'v1'));

      expect(probe.params.items.length).toBe(2);
      expect(probe.params.items.map((item) => item.title)).toStrictEqual(['Rename', 'Duplicate']);
    });

    it('anchors the menu on the tab with the sizing the design asks for', () => {
      const { el } = mount(threeViews(), 'v1');
      const probe = openContextOn(tabOf(el, 'v2'));

      expect(probe.params.trigger).toBe(tabOf(el, 'v2'));
      expect(probe.params.width).toBe('auto');
      expect(probe.params.minWidth).toBe('160px');
      expect(probe.params.autoFocusFirstItem).toBe(false);
      expect(probe.shownCount).toBe(1);
    });

    it('routes duplicate and delete to the tab that was right-clicked', () => {
      const { el } = mount(threeViews(), 'v1');
      const probe = openContextOn(tabOf(el, 'v3'));

      probe.params.items[1].onActivate?.();
      expect(onDuplicate).toHaveBeenCalledWith('v3');

      probe.params.items[3].onActivate?.();
      expect(onDelete).toHaveBeenCalledWith('v3');
    });

    it('destroys the open menu before opening another', () => {
      const { el } = mount(threeViews(), 'v1');
      const first = openContextOn(tabOf(el, 'v2'));

      openContextOn(tabOf(el, 'v3'));

      expect(first.destroyCount).toBe(1);
      expect(probes.contexts.length).toBe(2);
    });

    it('destroys a menu that closed itself', () => {
      const { el } = mount(threeViews(), 'v1');
      const probe = openContextOn(tabOf(el, 'v2'));

      probe.fireClosed();

      expect(probe.destroyCount).toBe(1);
    });

    it('destroys the open menu exactly once when the bar is torn down', () => {
      const { el, bar } = mount(threeViews(), 'v1');
      const probe = openContextOn(tabOf(el, 'v2'));

      bar.destroy();

      expect(probe.destroyCount).toBe(1);
    });
  });

  describe('renaming a view from the menu', () => {
    const startRename = (el: HTMLElement, viewId: string): HTMLInputElement => {
      const probe = openContextOn(tabOf(el, viewId));

      probe.params.items[0].onActivate?.();

      const input = tabOf(el, viewId).querySelector('input');

      if (!(input instanceof HTMLInputElement)) {
        throw new Error('rename input was not swapped in');
      }

      return input;
    };

    it('swaps the name for a labelled input', () => {
      const { el } = mount(threeViews(), 'v1', { api: echoApi() });
      const input = startRename(el, 'v2');

      expect(input.getAttribute('data-blok-database-tab-rename-input')).toBe('');
      expect(input.getAttribute('aria-label')).toBe('tools.database.renameView');
      expect(input.value).toBe('Two');
    });

    it('reports a changed name and restores a marked-up name span', () => {
      const { el } = mount(threeViews(), 'v1');
      const input = startRename(el, 'v2');

      input.value = 'Renamed';
      input.dispatchEvent(key('Enter'));

      expect(onRename).toHaveBeenCalledWith('v2', 'Renamed');

      const restored = queryOne(tabOf(el, 'v2'), '[data-blok-database-tab-name]');

      expect(restored.getAttribute('data-blok-database-tab-name')).toBe('');
      expect(restored.textContent).toBe('Renamed');
    });

    it('reports nothing when the name is committed unchanged', () => {
      const { el } = mount(threeViews(), 'v1');
      const input = startRename(el, 'v2');

      input.dispatchEvent(key('Enter'));

      expect(onRename).not.toHaveBeenCalled();
    });

    it('does nothing when the tab has no name span left to swap', () => {
      const { el } = mount(threeViews(), 'v1');
      const tab = tabOf(el, 'v2');
      const probe = openContextOn(tab);

      queryOne(tab, '[data-blok-database-tab-name]').remove();
      probe.params.items[0].onActivate?.();

      expect(tab.querySelector('input')).toBeNull();
    });
  });

  describe('add-view popover', () => {
    it('marks the anchor and the bar while the popover is open, and clears both on close', () => {
      const { el } = mount(threeViews(), 'v1');
      const addBtn = queryOne(el, '[data-blok-database-add-view]');

      addBtn.click();

      expect(addBtn.getAttribute('data-popover-open')).toBe('');
      expect(el.getAttribute('data-popover-open')).toBe('');
      expect(lastViewPopover().openedWith).toBe(addBtn);

      lastViewPopover().fireClose();

      expect(addBtn.hasAttribute('data-popover-open')).toBe(false);
      expect(el.hasAttribute('data-popover-open')).toBe(false);
    });

    it('destroys a previous popover before opening another', () => {
      const { el } = mount(threeViews(), 'v1');
      const addBtn = queryOne(el, '[data-blok-database-add-view]');

      addBtn.click();

      const first = lastViewPopover();

      addBtn.click();

      expect(first.destroyCount).toBe(1);
      expect(probes.views.length).toBe(2);
    });

    it('reports the chosen view type', () => {
      const { el } = mount(threeViews(), 'v1');

      queryOne(el, '[data-blok-database-add-view]').click();
      lastViewPopover().select('list');

      expect(onAddView).toHaveBeenCalledWith('list');
    });

    it('destroys an open popover when the bar is torn down', () => {
      const { el, bar } = mount(threeViews(), 'v1');

      queryOne(el, '[data-blok-database-add-view]').click();

      const probe = lastViewPopover();

      bar.destroy();

      expect(probe.destroyCount).toBe(1);
    });
  });

  describe('overflow measurement', () => {
    it('keeps the tabs that fit and folds the rest behind a count button', () => {
      const { el } = mount(threeViews(), 'v1');

      layOutForOverflow(el, 243);
      lastResizeProbe().fire();

      const more = queryOne(el, '[data-blok-database-tab-more]');

      expect(more.textContent).toBe('2 more…');
      expect(tabOf(el, 'v1').style.display).toBe('');
      expect(tabOf(el, 'v2').style.display).toBe('none');
      expect(tabOf(el, 'v3').style.display).toBe('none');
    });

    it('treats a row that exactly fills the bar as fitting', () => {
      const { el } = mount(threeViews(), 'v1');

      layOutForOverflow(el, 244);
      lastResizeProbe().fire();

      expect(queryOne(el, '[data-blok-database-tab-more]').textContent).toBe('1 more…');
    });

    it('folds nothing, and un-hides what was folded, once the bar is wide again', () => {
      const { el, bar } = mount(threeViews(), 'v1');

      bar.handleOverflow(1);
      expect(tabOf(el, 'v3').style.display).toBe('none');

      layOutForOverflow(el, 1000);
      lastResizeProbe().fire();

      expect(el.querySelector('[data-blok-database-tab-more]')).toBeNull();
      expect(tabOf(el, 'v1').style.display).toBe('');
      expect(tabOf(el, 'v2').style.display).toBe('');
      expect(tabOf(el, 'v3').style.display).toBe('');
    });

    it('observes the bar it just built', () => {
      const { el } = mount(threeViews(), 'v1');

      expect(lastResizeProbe().observed.length).toBe(1);
      expect(lastResizeProbe().observed[0]).toBe(el);
    });

    it('renders in an environment with no ResizeObserver at all', () => {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');

      try {
        expect(() => mount(threeViews(), 'v1')).not.toThrow();
      } finally {
        globalThis.ResizeObserver = StubResizeObserver;
      }
    });
  });

  describe('overflow button', () => {
    it('is inserted before the add button and carries its own affordances', () => {
      const { el, bar } = mount(threeViews(), 'v1');

      bar.handleOverflow(1);

      const more = queryOne(el, '[data-blok-database-tab-more]');
      const addBtn = queryOne(el, '[data-blok-database-add-view]');

      expect(more.getAttribute('data-blok-database-tab-more')).toBe('');
      expect(more.getAttribute('role')).toBe('button');
      expect(more.getAttribute('tabindex')).toBe('0');
      expect(more.style.cursor).toBe('pointer');
      expect(addBtn.previousElementSibling).toBe(more);
    });

    it('lands in the bar when read-only mode removed the add button', () => {
      const { el, bar } = mount(threeViews(), 'v1', { readOnly: true });

      bar.handleOverflow(1);

      const more = queryOne(el, '[data-blok-database-tab-more]');

      expect(more.parentElement).toBe(el);
      expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();
    });

    it('folds nothing when every view already fits', () => {
      const { el, bar } = mount(threeViews(), 'v1');

      bar.handleOverflow(3);

      expect(el.querySelector('[data-blok-database-tab-more]')).toBeNull();
      expect(tabOf(el, 'v3').style.display).toBe('');
    });

    it('is a no-op before the bar has been rendered', () => {
      const bar = build({ views: threeViews(), activeViewId: 'v1' });

      expect(() => {
        bar.handleOverflow(1);
      }).not.toThrow();
    });

    it('localizes the count when the host dictionary carries the key', () => {
      const t = vi.fn((dictKey: string, vars?: Record<string, string | number>) =>
        dictKey === 'tools.database.moreViews' ? `${String(vars?.count)} weitere` : dictKey
      );
      const { el, bar } = mount(threeViews(), 'v1', {
        api: makeApi({ t, has: (dictKey: string) => dictKey === 'tools.database.moreViews' }),
      });

      bar.handleOverflow(1);

      expect(queryOne(el, '[data-blok-database-tab-more]').textContent).toBe('2 weitere');
    });

    it('opens the overflow dropdown from Enter as well as from a click', () => {
      const { el, bar } = mount(threeViews(), 'v1');

      bar.handleOverflow(1);
      queryOne(el, '[data-blok-database-tab-more]').dispatchEvent(key('Enter'));

      expect(document.querySelectorAll('[data-blok-database-tab-overflow-dropdown]').length).toBe(1);
    });
  });

  describe('overflow dropdown', () => {
    const openDropdown = (
      views: DatabaseViewConfig[],
      activeViewId: string,
      options: Partial<TabBarOptions> = {}
    ): { el: HTMLElement; bar: DatabaseTabBar; dropdown: HTMLElement; more: HTMLElement } => {
      const { el, bar } = mount(views, activeViewId, options);

      bar.handleOverflow(1);

      const more = queryOne(el, '[data-blok-database-tab-more]');

      more.click();

      return { el, bar, more, dropdown: queryOne(document.body, '[data-blok-database-tab-overflow-dropdown]') };
    };

    it('stamps the dropdown so the popover styles and the keyboard owner apply', () => {
      const { dropdown } = openDropdown(threeViews(), 'v1');

      expect(dropdown.getAttribute('data-blok-popover')).toBe('');
      expect(dropdown.getAttribute('data-blok-database-tab-overflow-dropdown')).toBe('');
      expect(dropdown.getAttribute('data-blok-keyboard-owner')).toBe('');
      expect(dropdown.style.zIndex).toBe('1000');
    });

    it('lists every view in position order, whatever order they were passed in', () => {      const views = [
        makeView({ id: 'v3', name: 'Three', position: 'a2' }),
        makeView({ id: 'v1', name: 'One', position: 'a0' }),
        makeView({ id: 'v2', name: 'Two', position: 'a1' }),
      ];
      const { dropdown } = openDropdown(views, 'v1');
      const items = Array.from(dropdown.querySelectorAll('[data-blok-database-tab-overflow-item]'));

      expect(items.map((item) => item.getAttribute('data-view-id'))).toStrictEqual(['v1', 'v2', 'v3']);
      expect(items.map((item) => item.lastElementChild?.textContent)).toStrictEqual(['One', 'Two', 'Three']);
    });

    it('keeps two views that share a position in the order they arrived', () => {
      const { dropdown } = openDropdown(
        [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a0' })],
        'v1'
      );
      const items = Array.from(dropdown.querySelectorAll('[data-blok-database-tab-overflow-item]'));

      expect(items.map((item) => item.getAttribute('data-view-id'))).toStrictEqual(['v1', 'v2']);
    });

    it('places the dropdown below its anchor with the gap the design asks for', () => {
      const { dropdown, more } = openDropdown(threeViews(), 'v1');
      const calls = vi.mocked(positionFixedAnchored).mock.calls;
      const last = calls[calls.length - 1];

      expect(last?.[0]).toBe(dropdown);
      expect(last?.[1]).toBe(more);
      expect(last?.[2]).toStrictEqual({ side: 'bottom', offset: 4 });
    });

    it('reaches the new-view action without throwing when the bar has no add button', () => {
      const { dropdown } = openDropdown(threeViews(), 'v1', { readOnly: true });

      expect(
        uncaughtDuring(() => {
          queryOne(dropdown, '[data-blok-database-tab-overflow-new]').click();
        })
      ).toStrictEqual([]);
      expect(probes.views.length).toBe(0);
    });

    it('marks only the active view', () => {
      const { dropdown } = openDropdown(threeViews(), 'v2');
      const items = Array.from(dropdown.querySelectorAll('[data-blok-database-tab-overflow-item]'));
      const marked = items.filter((item) => item.hasAttribute('data-active'));

      expect(items[0].getAttribute('data-blok-database-tab-overflow-item')).toBe('');
      expect(marked.length).toBe(1);
      expect(marked[0].getAttribute('data-view-id')).toBe('v2');
      expect(marked[0].getAttribute('data-active')).toBe('');
    });

    it('gives every item an icon slot — drawn for known types, empty for the rest', () => {
      const views = [
        makeView({ id: 'v1', name: 'One', position: 'a0', type: 'board' }),
        makeView({ id: 'v2', name: 'Two', position: 'a1', type: 'table' }),
      ];
      const { dropdown } = openDropdown(views, 'v1');
      const items = Array.from(dropdown.querySelectorAll('[data-blok-database-tab-overflow-item]'));

      expect(items[0].children.length).toBe(2);
      expect(items[0].querySelector('svg')).not.toBeNull();
      expect(items[1].children.length).toBe(2);
      expect(items[1].children[0].innerHTML).toBe('');
    });

    it('switches to a view and closes when its row is clicked', () => {
      const { dropdown } = openDropdown(threeViews(), 'v1');
      const row = queryOne(dropdown, '[data-blok-database-tab-overflow-item][data-view-id="v3"]');

      row.click();

      expect(onTabClick).toHaveBeenCalledWith('v3');
      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).toBeNull();
    });

    it('closes without re-selecting when the active view is clicked', () => {
      const { dropdown } = openDropdown(threeViews(), 'v2');
      const row = queryOne(dropdown, '[data-blok-database-tab-overflow-item][data-view-id="v2"]');

      row.click();

      expect(onTabClick).not.toHaveBeenCalled();
      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).toBeNull();
    });

    it('separates the view list from the new-view action', () => {
      const { dropdown } = openDropdown(threeViews(), 'v1');
      const separator = queryOne(dropdown, '[data-blok-database-tab-overflow-separator]');

      expect(separator.getAttribute('data-blok-database-tab-overflow-separator')).toBe('');
      expect(separator.nextElementSibling).toBe(queryOne(dropdown, '[data-blok-database-tab-overflow-new]'));
    });

    it('describes the new-view action as a focusable button', () => {
      const { dropdown } = openDropdown(threeViews(), 'v1');
      const newBtn = queryOne(dropdown, '[data-blok-database-tab-overflow-new]');

      expect(newBtn.getAttribute('data-blok-database-tab-overflow-new')).toBe('');
      expect(newBtn.getAttribute('role')).toBe('button');
      expect(newBtn.getAttribute('tabindex')).toBe('0');
      expect(newBtn.textContent).toBe('+ New view');
    });

    it('closes the dropdown and opens the add-view popover on the add button', () => {
      const { el, dropdown } = openDropdown(threeViews(), 'v1');

      queryOne(dropdown, '[data-blok-database-tab-overflow-new]').click();

      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).toBeNull();
      expect(probes.views.length).toBe(1);
      expect(lastViewPopover().openedWith).toBe(queryOne(el, '[data-blok-database-add-view]'));
    });

    it('opens the add-view popover from Enter on the new-view action', () => {
      const { dropdown } = openDropdown(threeViews(), 'v1');

      queryOne(dropdown, '[data-blok-database-tab-overflow-new]').dispatchEvent(key('Enter'));

      expect(probes.views.length).toBe(1);
    });

    it('offers no add-view popover in read-only mode, where there is no add button', () => {
      const { dropdown } = openDropdown(threeViews(), 'v1', { readOnly: true });

      queryOne(dropdown, '[data-blok-database-tab-overflow-new]').click();

      expect(probes.views.length).toBe(0);
      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).toBeNull();
    });

    it('keeps only one dropdown in the document when reopened', () => {
      const { more } = openDropdown(threeViews(), 'v1');

      more.click();

      expect(document.querySelectorAll('[data-blok-database-tab-overflow-dropdown]').length).toBe(1);
    });

    it('closes on a mousedown outside itself and its anchor', () => {
      openDropdown(threeViews(), 'v1');

      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).toBeNull();
    });

    it('stays open for a mousedown inside itself or on its anchor', () => {
      const { dropdown, more } = openDropdown(threeViews(), 'v1');

      queryOne(dropdown, '[data-blok-database-tab-overflow-item]').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true })
      );
      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).not.toBeNull();

      more.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).not.toBeNull();
    });

    it('takes its outside-click listener back off the document when it closes', () => {
      const removed = vi.spyOn(document, 'removeEventListener');
      const { dropdown } = openDropdown(threeViews(), 'v1');

      queryOne(dropdown, '[data-blok-database-tab-overflow-item][data-view-id="v3"]').click();

      expect(removed.mock.calls.map((call) => call[0])).toContain('mousedown');
    });

    it('removes the very listener it added, not some other mousedown listener', () => {
      const added = vi.spyOn(document, 'addEventListener');
      const removed = vi.spyOn(document, 'removeEventListener');
      const { dropdown } = openDropdown(threeViews(), 'v1');
      const outsideClose = added.mock.calls.find((call) => call[0] === 'mousedown')?.[1];

      expect(outsideClose).toBeDefined();

      queryOne(dropdown, '[data-blok-database-tab-overflow-item][data-view-id="v3"]').click();

      expect(
        removed.mock.calls.some((call) => call[0] === 'mousedown' && call[1] === outsideClose)
      ).toBe(true);
    });

    it('is torn down with the bar', () => {
      const { bar } = openDropdown(threeViews(), 'v1');

      bar.destroy();

      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).toBeNull();
    });
  });

  describe('dragging a tab', () => {
    const layOutTabs = (el: HTMLElement): void => {
      const tabs = Array.from(el.querySelectorAll<HTMLElement>('[data-blok-database-tab]'));

      tabs.forEach((tab, index) => {
        vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(
          makeRect(index * 100, index * 100 + 100, index === 0 ? 40 : 0)
        );
      });
    };

    const dragFrom = (el: HTMLElement, viewId: string, startX: number): void => {
      layOutTabs(el);
      tabOf(el, viewId).dispatchEvent(pointer('pointerdown', startX));
    };

    const ghost = (): HTMLElement | null => document.body.querySelector('[data-blok-database-tab-ghost]');

    it('starts the drag at exactly the threshold and builds one ghost', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 60));

      expect(ghost()).not.toBeNull();

      document.dispatchEvent(pointer('pointermove', 200));

      expect(document.body.querySelectorAll('[data-blok-database-tab-ghost]').length).toBe(1);
    });

    it('does not start the drag below the threshold', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 59));

      expect(ghost()).toBeNull();
      expect(el.hasAttribute('data-dragging')).toBe(false);
    });

    it('describes the ghost so it floats over the bar at the tab it came from', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 200));

      const floating = ghost();

      if (floating === null) {
        throw new Error('no ghost was built');
      }

      expect(el.getAttribute('data-dragging')).toBe('');
      expect(floating.getAttribute('data-blok-database-tab-ghost')).toBe('');
      expect(floating.style.position).toBe('fixed');
      expect(floating.style.pointerEvents).toBe('none');
      expect(floating.style.zIndex).toBe('50');
      expect(floating.style.opacity).toBe('0.7');
      expect(floating.style.top).toBe('40px');
      expect(floating.style.width).toBe('100px');
      expect(floating.style.left).toBe('150px');
      expect(tabOf(el, 'v1').style.opacity).toBe('0.4');
    });

    it('tracks the pointer while the drag continues', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 200));
      document.dispatchEvent(pointer('pointermove', 260));

      const floating = ghost();

      if (floating === null) {
        throw new Error('no ghost was built');
      }

      expect(floating.style.left).toBe('210px');
    });

    it('survives the dragged tab disappearing mid-gesture', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      el.querySelector('[data-view-id="v1"]')?.remove();
      document.dispatchEvent(pointer('pointermove', 200));

      expect(ghost()).toBeNull();
      expect(el.getAttribute('data-dragging')).toBe('');
    });

    it('reaches the move after the dragged tab is gone without throwing', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      el.querySelector('[data-view-id="v1"]')?.remove();

      expect(
        uncaughtDuring(() => {
          document.dispatchEvent(pointer('pointermove', 200));
        })
      ).toStrictEqual([]);
    });

    it('does not drag a tab that carries no view id', () => {
      const { el } = mount(threeViews(), 'v1');

      layOutTabs(el);

      const tab = tabOf(el, 'v1');

      tab.removeAttribute('data-view-id');
      tab.dispatchEvent(pointer('pointerdown', 50));
      document.dispatchEvent(pointer('pointermove', 200));

      expect(ghost()).toBeNull();
      expect(el.hasAttribute('data-dragging')).toBe(false);
    });

    it('drops before the tab whose left half the pointer is over', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 120));
      document.dispatchEvent(pointer('pointerup', 120));

      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder).toHaveBeenCalledWith('v1', generateKeyBetween(null, 'a1'));
    });

    it('drops before the first neighbour rather than at the head of the row', () => {
      const views = [
        makeView({ id: 'v1', name: 'One', position: 'a1' }),
        makeView({ id: 'v2', name: 'Two', position: 'a2' }),
        makeView({ id: 'v3', name: 'Three', position: 'a3' }),
      ];
      const { el } = mount(views, 'v1');

      // With the row starting at 'a0' these two keys collide, and "before the
      // first neighbour" is indistinguishable from "against nothing at all".
      expect(generateKeyBetween(null, 'a2')).not.toBe(generateKeyBetween(null, null));

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 120));
      document.dispatchEvent(pointer('pointerup', 120));

      expect(onReorder).toHaveBeenCalledWith('v1', generateKeyBetween(null, 'a2'));
    });

    it('drops between the two tabs the pointer sits between', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 220));
      document.dispatchEvent(pointer('pointerup', 220));

      expect(onReorder).toHaveBeenCalledWith('v1', generateKeyBetween('a1', 'a2'));
    });

    it('drops after the last tab when the pointer is past the row', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 350));
      document.dispatchEvent(pointer('pointerup', 350));

      expect(onReorder).toHaveBeenCalledWith('v1', generateKeyBetween('a2', null));
    });

    it('treats a drop exactly on a tab midpoint as being past that tab', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 250));
      document.dispatchEvent(pointer('pointerup', 250));

      expect(onReorder).toHaveBeenCalledWith('v1', generateKeyBetween('a2', null));
    });

    it('reorders a lone view against nothing at all', () => {
      const { el } = mount([makeView({ id: 'v1', position: 'a0' })], 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 350));
      document.dispatchEvent(pointer('pointerup', 350));

      expect(onReorder).toHaveBeenCalledWith('v1', generateKeyBetween(null, null));
    });

    it('clears the ghost, the dragging flag and the faded tab on drop', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 220));
      document.dispatchEvent(pointer('pointerup', 220));

      expect(ghost()).toBeNull();
      expect(el.hasAttribute('data-dragging')).toBe(false);
      expect(tabOf(el, 'v1').style.opacity).toBe('');
    });

    it('cancels on Escape and on pointercancel, reordering nothing', () => {
      const first = mount(threeViews(), 'v1');

      dragFrom(first.el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 220));
      document.dispatchEvent(key('Escape'));

      expect(ghost()).toBeNull();
      expect(first.el.hasAttribute('data-dragging')).toBe(false);
      expect(onReorder).not.toHaveBeenCalled();

      const second = mount(threeViews(), 'v1');

      dragFrom(second.el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 220));
      document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));

      expect(ghost()).toBeNull();
      expect(onReorder).not.toHaveBeenCalled();
    });

    it('leaves a drag running when some other key is pressed', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 220));
      document.dispatchEvent(key('a'));

      expect(ghost()).not.toBeNull();
    });

    it('stops listening once the drag is cancelled', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 220));
      document.dispatchEvent(key('Escape'));
      document.dispatchEvent(pointer('pointermove', 300));

      expect(ghost()).toBeNull();
    });

    it('stops listening after a press that never became a drag', () => {
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointerup', 52));

      expect(onReorder).not.toHaveBeenCalled();

      document.dispatchEvent(pointer('pointermove', 300));

      expect(ghost()).toBeNull();
    });

    it('takes every drag listener back off the document', () => {
      const removed = vi.spyOn(document, 'removeEventListener');
      const { el } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 220));
      document.dispatchEvent(key('Escape'));

      const names = removed.mock.calls.map((call) => call[0]);

      expect(names).toContain('pointermove');
      expect(names).toContain('pointerup');
      expect(names).toContain('pointercancel');
      expect(names).toContain('keydown');
    });

    it('is cleaned up when the bar is torn down mid-drag', () => {
      const { el, bar } = mount(threeViews(), 'v1');

      dragFrom(el, 'v1', 50);
      document.dispatchEvent(pointer('pointermove', 220));

      bar.destroy();

      expect(ghost()).toBeNull();
      expect(el.hasAttribute('data-dragging')).toBe(false);
    });
  });

  describe('read-only toggling', () => {
    it('is a no-op before the bar is rendered', () => {
      const bar = build({ views: threeViews(), activeViewId: 'v1' });

      expect(() => {
        bar.setReadOnly(true);
      }).not.toThrow();
    });

    it('removes and restores the add button', () => {
      const { el, bar } = mount(threeViews(), 'v1');

      bar.setReadOnly(true);
      expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();

      bar.setReadOnly(false);
      expect(el.querySelector('[data-blok-database-add-view]')).not.toBeNull();
    });

    it('leaves an add button the host re-homed where the host put it', () => {
      const host = document.createElement('div');

      document.body.appendChild(host);

      const { bar } = mount(threeViews(), 'v1', { readOnly: true });
      const addBtn = bar.getAddBtnEl();

      if (addBtn === null) {
        throw new Error('no add button');
      }

      host.appendChild(addBtn);

      bar.setReadOnly(true);
      expect(addBtn.parentElement).toBe(host);

      bar.setReadOnly(false);
      expect(addBtn.parentElement).toBe(host);
    });
  });

  describe('teardown', () => {
    it('can be destroyed twice after a render', () => {
      const { bar } = mount(threeViews(), 'v1');

      bar.destroy();

      expect(() => {
        bar.destroy();
      }).not.toThrow();
    });
  });
});

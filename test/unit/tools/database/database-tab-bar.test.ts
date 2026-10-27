import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock PopoverDesktop so JSDOM does not blow up on className assignments.
// When show() is called the mock appends a lightweight DOM container with
// action items derived from the constructor `items` array.  Tests can then
// query `[data-blok-database-tab-context]` and
// `[data-blok-database-tab-action="…"]` as expected.
// ---------------------------------------------------------------------------
vi.mock('../../../../src/components/utils/popover', () => {
  const PopoverItemType = { Default: 'default', Separator: 'separator', Html: 'html' };

  class MockPopoverDesktop {
    private container: HTMLElement | null = null;
    private readonly items: Array<{ title?: string; name?: string; onActivate?: () => void; type?: string; closeOnActivate?: boolean }>;
    private readonly eventHandlers: Map<string, Array<() => void>> = new Map();

    private readonly className: unknown;

    constructor(params: { items?: Array<{ title?: string; name?: string; onActivate?: () => void; type?: string; closeOnActivate?: boolean }>; [key: string]: unknown }) {
      this.items = params.items ?? [];
      this.className = params.class;
    }

    show(): void {
      this.container = document.createElement('div');
      this.container.setAttribute('data-blok-database-tab-context', '');
      if (typeof this.className === 'string') this.container.setAttribute('data-mock-popover-class', this.className);
      this.container.style.position = 'fixed';

      for (const item of this.items) {
        if (item.type === PopoverItemType.Separator || !item.title) continue;
        const el = document.createElement('div');
        el.setAttribute('data-blok-database-tab-action', item.title.toLowerCase());
        el.textContent = item.title;
        const onActivate = item.onActivate;
        if (onActivate) {
          el.addEventListener('click', () => {
            onActivate();
            if (item.closeOnActivate === true && item.name === 'database-view-delete') this.destroy();
          });
        }
        this.container.appendChild(el);
      }

      document.body.appendChild(this.container);
    }

    hide(): void {
      /* no-op */
    }

    destroy(): void {
      this.container?.remove();
      this.container = null;
      // Fire Closed handlers
      const handlers = this.eventHandlers.get('closed') ?? [];
      for (const h of handlers) h();
    }

    on(event: string, handler: () => void): void {
      const existing = this.eventHandlers.get(event) ?? [];
      this.eventHandlers.set(event, [...existing, handler]);
    }

    off(): void {
      /* no-op */
    }

    getElement(): HTMLElement | null {
      return this.container;
    }

    /** Records the row the release gives the cursor back to. */
    holdOpen(): (focusItemName?: string) => void {
      this.container?.setAttribute('data-held', '');

      return (focusItemName) => {
        this.container?.removeAttribute('data-held');
        this.container?.setAttribute('data-released-to', focusItemName ?? '');
      };
    }

    hasNode(node: Node): boolean {
      return this.container?.contains(node) ?? false;
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType };
});

// ---------------------------------------------------------------------------
// Mock PopoverEvent so the 'closed' string constant matches what MockPopoverDesktop
// uses internally.
// ---------------------------------------------------------------------------
vi.mock('@/types/utils/popover/popover-event', () => ({
  PopoverEvent: { Closed: 'closed' },
}));

// ---------------------------------------------------------------------------
// Mock DatabaseViewPopover so it produces testable DOM instead of delegating
// to the real PopoverDesktop.  When open() is called a lightweight container
// is appended to the body with view-option elements the tests expect.
// ---------------------------------------------------------------------------
vi.mock('../../../../src/tools/database/database-view-popover', () => {
  class MockDatabaseViewPopover {
    private container: HTMLElement | null = null;
    private readonly onSelect: (type: string) => void;
    private readonly onClose?: () => void;

    constructor(options: { onSelect: (type: string) => void; onClose?: () => void }) {
      this.onSelect = options.onSelect;
      this.onClose = options.onClose;
    }

    open(_anchor: HTMLElement): void {
      this.container = document.createElement('div');
      this.container.setAttribute('data-blok-database-view-popover', '');

      for (const viewType of ['board', 'list']) {
        const el = document.createElement('div');
        el.setAttribute('data-blok-database-view-option', viewType);
        const onSelect = this.onSelect;
        el.addEventListener('click', () => onSelect(viewType));
        this.container.appendChild(el);
      }

      document.body.appendChild(this.container);
    }

    close(): void {
      this.container?.remove();
      this.container = null;
      this.onClose?.();
    }

    destroy(): void {
      this.close();
    }
  }

  return { DatabaseViewPopover: MockDatabaseViewPopover };
});

import { DatabaseTabBar } from '../../../../src/tools/database/database-tab-bar';
import { IconChart, IconGallery, IconTable, IconViewCalendar, IconViewFeed } from '../../../../src/components/icons';
import { resyncPortalDirections } from '../../../../src/components/utils/portal-direction';
import type { DatabaseViewConfig, ViewType } from '../../../../src/tools/database/types';
import type { API } from '../../../../types';

const rect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
  toJSON: () => ({}),
  ...overrides,
});

const makeView = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: `view-${Math.random().toString(36).slice(2, 6)}`,
  name: 'Board',
  type: 'board',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});

describe('DatabaseTabBar', () => {
  let onTabClick: ReturnType<typeof vi.fn<(viewId: string) => void>>;
  let onAddView: ReturnType<typeof vi.fn<(type: ViewType) => void>>;
  let onRename: ReturnType<typeof vi.fn<(viewId: string, newName: string) => void>>;
  let onDuplicate: ReturnType<typeof vi.fn<(viewId: string) => void>>;
  let onDelete: ReturnType<typeof vi.fn<(viewId: string) => void | Promise<boolean>>>;
  let onReorder: ReturnType<typeof vi.fn<(viewId: string, newPosition: string) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    onTabClick = vi.fn<(viewId: string) => void>();
    onAddView = vi.fn<(type: ViewType) => void>();
    onRename = vi.fn<(viewId: string, newName: string) => void>();
    onDuplicate = vi.fn<(viewId: string) => void>();
    onDelete = vi.fn<(viewId: string) => void | Promise<boolean>>();
    onReorder = vi.fn<(viewId: string, newPosition: string) => void>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any popovers left in the DOM
    document.querySelectorAll('[data-blok-database-view-popover]').forEach((el) => el.remove());
    document.querySelectorAll('[data-blok-database-tab-context]').forEach((el) => el.remove());
    document.querySelectorAll('[data-blok-database-tab-overflow-dropdown]').forEach((el) => el.remove());
  });

  const createTabBar = (
    views: DatabaseViewConfig[],
    activeViewId: string,
    api?: ConstructorParameters<typeof DatabaseTabBar>[0]['api']
  ): DatabaseTabBar => {
    return new DatabaseTabBar({
      views,
      activeViewId,
      onTabClick,
      onAddView,
      onRename,
      onDuplicate,
      onDelete,
      onReorder,
      api,
    });
  };

  describe('render()', () => {
    it('gives a table view tab the table icon', () => {
      const view = makeView({ type: 'table' });
      const el = createTabBar([view], view.id).render();
      const tab = el.querySelector('[data-blok-database-tab-name]')?.parentElement;

      const expected = document.createElement('span');

      expected.innerHTML = IconTable;
      expect(tab?.firstElementChild?.innerHTML).toBe(expected.innerHTML);
    });

    it('gives gallery and calendar view tabs their icons', () => {
      const gallery = makeView({ id: 'g', type: 'gallery' });
      const calendar = makeView({ id: 'c', type: 'calendar', position: 'a2' });
      const el = createTabBar([gallery, calendar], gallery.id).render();
      const icons = [...el.querySelectorAll('[data-blok-database-tab-name]')].map((name) => name.parentElement?.firstElementChild?.innerHTML);
      const expected = [IconGallery, IconViewCalendar].map((icon) => {
        const span = document.createElement('span');

        span.innerHTML = icon;

        return span.innerHTML;
      });

      expect(icons).toEqual(expected);
    });

    it('gives chart and feed view tabs their icons', () => {
      const chart = makeView({ id: 'ch', type: 'chart' });
      const feed = makeView({ id: 'fe', type: 'feed', position: 'a2' });
      const el = createTabBar([chart, feed], chart.id).render();
      const icons = [...el.querySelectorAll('[data-blok-database-tab-name]')].map((name) => name.parentElement?.firstElementChild?.innerHTML);
      const expected = [IconChart, IconViewFeed].map((icon) => {
        const span = document.createElement('span');

        span.innerHTML = icon;

        return span.innerHTML;
      });

      expect(icons).toEqual(expected);
    });

    it('creates tab bar element with data-blok-database-tab-bar attribute', () => {
      const view = makeView();
      const bar = createTabBar([view], view.id);
      const el = bar.render();
      expect(el.hasAttribute('data-blok-database-tab-bar')).toBe(true);
    });

    it('renders one tab per view', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'b0' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      const tabs = el.querySelectorAll('[data-blok-database-tab]');
      expect(tabs.length).toBe(2);
    });

    it('sets data-view-id on each tab', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'b0' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      const tabs = el.querySelectorAll('[data-blok-database-tab]');
      const ids = Array.from(tabs).map((t) => t.getAttribute('data-view-id'));
      expect(ids).toContain('v1');
      expect(ids).toContain('v2');
    });

    it('displays view name in each tab', () => {
      const views = [makeView({ id: 'v1', name: 'My Board', position: 'a0' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      expect(el.textContent).toContain('My Board');
    });

    it('displays an icon (svg) in each tab', () => {
      const view = makeView({ id: 'v1', type: 'board' });
      const bar = createTabBar([view], 'v1');
      const el = bar.render();
      const tab = el.querySelector('[data-blok-database-tab]')!;
      expect(tab.querySelector('svg')).not.toBeNull();
    });

    it('marks active tab with data-active attribute', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'b0' })];
      const bar = createTabBar(views, 'v2');
      const el = bar.render();
      const activeTab = el.querySelector('[data-blok-database-tab][data-active]');
      expect(activeTab).not.toBeNull();
      expect(activeTab!.getAttribute('data-view-id')).toBe('v2');
    });

    it('renders tabs in position order even when views are passed out of order', () => {
      const views = [
        makeView({ id: 'v3', position: 'c0' }),
        makeView({ id: 'v1', position: 'a0' }),
        makeView({ id: 'v2', position: 'b0' }),
      ];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      const tabs = el.querySelectorAll('[data-blok-database-tab]');
      const ids = Array.from(tabs).map((t) => t.getAttribute('data-view-id'));
      expect(ids).toEqual(['v1', 'v2', 'v3']);
    });

    it('renders + button with data-blok-database-add-view attribute', () => {
      const view = makeView();
      const bar = createTabBar([view], view.id);
      const el = bar.render();
      const addBtn = el.querySelector('[data-blok-database-add-view]');
      expect(addBtn).not.toBeNull();
    });
  });

  describe('tab click', () => {
    it('calls onTabClick with view id when inactive tab is clicked', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'b0' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      const inactiveTab = el.querySelector('[data-view-id="v2"]') as HTMLElement;
      inactiveTab.click();
      expect(onTabClick).toHaveBeenCalledWith('v2');
    });

    it('does NOT call onTabClick when active tab is clicked', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'b0' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      const activeTab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      activeTab.click();
      expect(onTabClick).not.toHaveBeenCalled();
    });
  });

  describe('+ button', () => {
    it('opens view popover when + is clicked', () => {
      const view = makeView({ id: 'v1' });
      const bar = createTabBar([view], 'v1');
      const el = bar.render();
      document.body.appendChild(el);

      const addBtn = el.querySelector('[data-blok-database-add-view]') as HTMLElement;
      addBtn.click();

      const popover = document.querySelector('[data-blok-database-view-popover]');
      expect(popover).not.toBeNull();

      bar.destroy();
      el.remove();
    });

    it('calls onAddView when Board is selected from popover', () => {
      const view = makeView({ id: 'v1' });
      const bar = createTabBar([view], 'v1');
      const el = bar.render();
      document.body.appendChild(el);

      const addBtn = el.querySelector('[data-blok-database-add-view]') as HTMLElement;
      addBtn.click();

      const boardOption = document.querySelector('[data-blok-database-view-option="board"]') as HTMLElement;
      boardOption.click();

      expect(onAddView).toHaveBeenCalledWith('board');

      bar.destroy();
      el.remove();
    });
  });

  describe('right-click context popover', () => {
    it('opens a context popover on tab right-click', () => {
      const bar = createTabBar([makeView({ id: 'v1' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const popover = document.querySelector('[data-blok-database-tab-context]');
      expect(popover).not.toBeNull();
      el.remove();
    });

    it('owns right-click on its tabs, so the editor\'s block menu does not replace the view menu', () => {
      const bar = createTabBar([makeView({ id: 'v1' })], 'v1');
      const el = bar.render();

      expect(el.querySelector('[data-view-id="v1"]')?.closest('[data-blok-context-menu-owner]')).not.toBeNull();
    });

    it('opens the context popover with the database menu motion', () => {
      const bar = createTabBar([makeView({ id: 'v1' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      expect(document.querySelector('[data-blok-database-tab-context]')?.getAttribute('data-mock-popover-class')).toBe('blok-database-menu');
      el.remove();
    });

    it('shows Rename, Duplicate, and Delete options when multiple views exist', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      expect(document.querySelector('[data-blok-database-tab-action="rename"]')).not.toBeNull();
      expect(document.querySelector('[data-blok-database-tab-action="duplicate view"]')).not.toBeNull();
      expect(document.querySelector('[data-blok-database-tab-action="delete view"]')).not.toBeNull();
      el.remove();
    });

    describe('"Hide data source titles" (research/23 §10)', () => {
      const menuTitles = (): Array<string | null> => Array.from(
        document.querySelector('[data-blok-database-tab-context]')?.children ?? []
      ).map((item) => item.textContent);

      it('sits before Duplicate and calls onDataSourceTitlesToggle', () => {
        const onDataSourceTitlesToggle = vi.fn();
        const bar = new DatabaseTabBar({
          views: [makeView({ id: 'v1' })], activeViewId: 'v1', onTabClick, onAddView, onRename, onDuplicate, onDelete, onReorder,
          dataSourceTitlesHidden: false, onDataSourceTitlesToggle,
        });
        const el = bar.render();

        document.body.appendChild(el);
        el.querySelector('[data-view-id="v1"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

        expect(menuTitles()).toStrictEqual(['Rename', 'Hide data source titles', 'Duplicate view']);
        document.querySelector<HTMLElement>('[data-blok-database-tab-action="hide data source titles"]')?.click();
        expect(onDataSourceTitlesToggle).toHaveBeenCalledTimes(1);
        el.remove();
      });

      it('reads "Show data source titles" while they are hidden', () => {
        const bar = new DatabaseTabBar({
          views: [makeView({ id: 'v1' })], activeViewId: 'v1', onTabClick, onAddView, onRename, onDuplicate, onDelete, onReorder,
          dataSourceTitlesHidden: true, onDataSourceTitlesToggle: vi.fn(),
        });
        const el = bar.render();

        document.body.appendChild(el);
        el.querySelector('[data-view-id="v1"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

        expect(menuTitles()).toStrictEqual(['Rename', 'Show data source titles', 'Duplicate view']);
        el.remove();
      });
    });

    it('hides Delete option when only one view exists', () => {
      const bar = createTabBar([makeView({ id: 'v1' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const deleteItem = document.querySelector<HTMLElement>('[data-blok-database-tab-action="delete view"]');
      const isHidden = deleteItem === null || deleteItem.style.display === 'none';
      expect(isHidden).toBe(true);
      el.remove();
    });

    it('calls onDuplicate when Duplicate is clicked', () => {
      const bar = createTabBar([makeView({ id: 'v1' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const dup = document.querySelector('[data-blok-database-tab-action="duplicate view"]') as HTMLElement;
      dup.click();
      expect(onDuplicate).toHaveBeenCalledWith('v1');
      el.remove();
    });

    describe('a Delete that asks first (research/30 B3)', () => {
      const openDelete = (ask: () => void | Promise<boolean>): HTMLElement => {
        onDelete.mockImplementation(ask);
        const bar = createTabBar([makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })], 'v1');
        const el = bar.render();

        document.body.appendChild(el);
        el.querySelector<HTMLElement>('[data-view-id="v1"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
        document.querySelector<HTMLElement>('[data-blok-database-tab-action="delete view"]')?.click();

        return el;
      };
      const menu = (): HTMLElement | null => document.querySelector('[data-blok-database-tab-context]');

      it('keeps the menu open behind the dialog; after Cancel the cursor goes back to Delete', async () => {
        const answer: { resolve: (deleted: boolean) => void; heldWhenAsked?: boolean } = { resolve: () => undefined };
        const el = openDelete(() => {
          // The dialog takes focus as it opens, so the hold must already be on.
          answer.heldWhenAsked = menu()?.hasAttribute('data-held');

          return new Promise<boolean>((resolve) => {
            answer.resolve = resolve;
          });
        });

        expect(answer.heldWhenAsked).toBe(true);
        expect(menu()?.hasAttribute('data-held')).toBe(true);
        answer.resolve(false);
        await Promise.resolve();
        await Promise.resolve();

        expect(menu()?.getAttribute('data-released-to')).toBe('database-view-delete');
        el.remove();
      });

      it('closes the menu once the view is deleted', async () => {
        const el = openDelete(() => Promise.resolve(true));

        expect(menu()).not.toBeNull();
        await Promise.resolve();
        await Promise.resolve();

        expect(menu()).toBeNull();
        el.remove();
      });

      it('closes the menu at once when nothing asks', () => {
        const el = openDelete(() => undefined);

        expect(menu()).toBeNull();
        el.remove();
      });
    });

    it('calls onDelete when Delete is clicked', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const del = document.querySelector('[data-blok-database-tab-action="delete view"]') as HTMLElement;
      del.click();
      expect(onDelete).toHaveBeenCalledWith('v1');
      el.remove();
    });
  });

  describe('Edit view', () => {
    it('opens the view settings from the tab menu, anchored at the tab', () => {
      const onEditView = vi.fn<(viewId: string, anchor: HTMLElement) => void>();
      const bar = new DatabaseTabBar({
        views: [makeView({ id: 'v1' })],
        activeViewId: 'v1',
        onTabClick,
        onAddView,
        onRename,
        onDuplicate,
        onDelete,
        onReorder,
        onEditView,
      });
      const el = bar.render();

      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;

      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      (document.querySelector('[data-blok-database-tab-action="edit view"]') as HTMLElement).click();

      expect(onEditView).toHaveBeenCalledWith('v1', tab);
      el.remove();
    });
  });

  describe('tab drag reordering', () => {
    const createBarWithLayout = (views: DatabaseViewConfig[], activeViewId: string): { bar: DatabaseTabBar; el: HTMLElement } => {
      const bar = createTabBar(views, activeViewId);
      const el = bar.render();
      document.body.appendChild(el);
      const tabs = Array.from(el.querySelectorAll<HTMLElement>('[data-blok-database-tab]'));
      tabs.forEach((tab, index) => {
        const tabLeft = index * 100;
        const tabRight = tabLeft + 100;
        Object.defineProperty(tab, 'getBoundingClientRect', {
          value: () => ({
            left: tabLeft, right: tabRight, top: 0, bottom: 30,
            width: 100, height: 30, x: tabLeft, y: 0, toJSON: () => ({}),
          }),
          configurable: true,
        });
      });
      return { bar, el };
    };

    it('does not start drag below threshold', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const { bar, el } = createBarWithLayout(views, 'v1');
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 15, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 55, clientY: 15 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 55, clientY: 15 }));
      expect(onReorder).not.toHaveBeenCalled();
      bar.destroy();
      el.remove();
    });

    it('calls onReorder after drag past threshold', () => {
      const views = [
        makeView({ id: 'v1', position: 'a0' }),
        makeView({ id: 'v2', position: 'a1' }),
        makeView({ id: 'v3', position: 'a2' }),
      ];
      const { bar, el } = createBarWithLayout(views, 'v1');
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 15, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 15 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 15 }));
      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder).toHaveBeenCalledWith('v1', expect.any(String));
      bar.destroy();
      el.remove();
    });

    it('drops between neighbours whose keys the key generator rejects', () => {
      // 'a10' ends in a zero: a host or an old document can hold it.
      const views = [
        makeView({ id: 'v1', position: 'a0' }),
        makeView({ id: 'v2', position: 'a1' }),
        makeView({ id: 'v3', position: 'a10' }),
      ];
      const { bar, el } = createBarWithLayout(views, 'v1');
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;

      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 15, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 15 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 220, clientY: 15 }));

      expect(onReorder).toHaveBeenCalledTimes(1);
      const key = onReorder.mock.calls[0][1];

      expect(key > 'a1' && key < 'a10').toBe(true);
      bar.destroy();
      el.remove();
    });

    it('drops between two views that hold the same key', () => {
      const views = [
        makeView({ id: 'v1', position: 'a0' }),
        makeView({ id: 'v2', position: 'a1' }),
        makeView({ id: 'v3', position: 'a1' }),
      ];
      const { bar, el } = createBarWithLayout(views, 'v1');
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;

      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 15, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 15 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 220, clientY: 15 }));

      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder.mock.calls[0][1] > 'a1').toBe(true);
      bar.destroy();
      el.remove();
    });

    it('keeps Cmd+Z from the editor while a tab is dragged', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const { bar, el } = createBarWithLayout(views, 'v1');
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;

      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 15, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 15 }));
      const undo = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true });

      document.dispatchEvent(undo);
      bar.destroy();
      el.remove();

      expect(undo.defaultPrevented).toBe(true);
    });

    it('cancels drag on Escape key', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const { bar, el } = createBarWithLayout(views, 'v1');
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 15, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 15 }));
       
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(onReorder).not.toHaveBeenCalled();
      bar.destroy();
      el.remove();
    });
  });

  describe('tab overflow', () => {
    it('shows the canonical "N more…" fallback when tabs overflow', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}`, name: `Board ${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const el = bar.render();
      document.body.appendChild(el);

      // Simulate overflow by calling the overflow handler directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);

      const moreBtn = el.querySelector('[data-blok-database-tab-more]') as HTMLElement;
      expect(moreBtn).not.toBeNull();
      expect(moreBtn.textContent).toBe('3 more…');

      bar.destroy();
      el.remove();
    });

    it('localizes the overflow count as one interpolated message', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}`, name: `Board ${i}` })
      );
      const t = vi.fn((key: string, vars?: Record<string, string | number>) =>
        key === 'tools.database.moreViews'
          ? `${String(vars?.count)} weitere…`
          : key
      );
      const bar = createTabBar(views, 'v0', {
        i18n: {
          t,
          has: (key: string) => key === 'tools.database.moreViews',
        },
      } as unknown as API);
      const el = bar.render();
      document.body.appendChild(el);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);

      expect(el.querySelector('[data-blok-database-tab-more]')?.textContent).toBe('3 weitere…');
      expect(t).toHaveBeenCalledWith('tools.database.moreViews', { count: 3 });

      bar.destroy();
      el.remove();
    });

    it('gives the overflow dropdown the tab bar direction', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}`, name: `Board ${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const el = bar.render();
      el.style.direction = 'rtl';
      document.body.appendChild(el);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);
      (el.querySelector('[data-blok-database-tab-more]') as HTMLElement).click();

      expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')?.getAttribute('dir')).toBe('rtl');

      bar.destroy();
    });

    it('re-places an open overflow dropdown after the editor flips direction', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}`, name: `Board ${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const editor = document.createElement('div');
      const el = bar.render();

      editor.setAttribute('data-blok-editor', '');
      editor.style.direction = 'ltr';
      editor.appendChild(el);
      document.body.appendChild(editor);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);
      const moreBtn = el.querySelector('[data-blok-database-tab-more]') as HTMLElement;

      vi.spyOn(moreBtn, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 60, 20));
      moreBtn.click();
      const dropdown = document.querySelector<HTMLElement>('[data-blok-database-tab-overflow-dropdown]');

      expect(dropdown?.style.left).toBe('100px');

      // The mirrored tab bar puts the button on the other side.
      vi.spyOn(moreBtn, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 50, 60, 20));
      editor.style.direction = 'rtl';
      resyncPortalDirections(editor);

      expect(dropdown?.getAttribute('dir')).toBe('rtl');
      expect(dropdown?.style.left).not.toBe('100px');

      bar.destroy();
      editor.remove();
    });

    it('opens dropdown listing all views when "N more…" is clicked', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}`, name: `Board ${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const el = bar.render();
      document.body.appendChild(el);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);

      const moreBtn = el.querySelector('[data-blok-database-tab-more]') as HTMLElement;
      moreBtn.click();

      const dropdown = document.querySelector('[data-blok-database-tab-overflow-dropdown]');
      expect(dropdown).not.toBeNull();

      const items = dropdown!.querySelectorAll('[data-blok-database-tab-overflow-item]');
      expect(items).toHaveLength(6);

      bar.destroy();
      el.remove();
    });

    it('highlights active view in overflow dropdown', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const el = bar.render();
      document.body.appendChild(el);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);

      const moreBtn = el.querySelector('[data-blok-database-tab-more]') as HTMLElement;
      moreBtn.click();

      const activeItem = document.querySelector('[data-blok-database-tab-overflow-item][data-active]') as HTMLElement;
      expect(activeItem).not.toBeNull();
      expect(activeItem.getAttribute('data-view-id')).toBe('v0');

      bar.destroy();
      el.remove();
    });

    it('calls onTabClick when overflow dropdown item is clicked', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const el = bar.render();
      document.body.appendChild(el);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);

      const moreBtn = el.querySelector('[data-blok-database-tab-more]') as HTMLElement;
      moreBtn.click();

      const items = document.querySelectorAll('[data-blok-database-tab-overflow-item]');
      const item3 = items[3] as HTMLElement;
      item3.click();

      expect(onTabClick).toHaveBeenCalledWith('v3');

      bar.destroy();
      el.remove();
    });

    it('includes "+ New view" action at bottom of overflow dropdown', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const el = bar.render();
      document.body.appendChild(el);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);

      const moreBtn = el.querySelector('[data-blok-database-tab-more]') as HTMLElement;
      moreBtn.click();

      const newViewBtn = document.querySelector('[data-blok-database-tab-overflow-new]');
      expect(newViewBtn).not.toBeNull();

      bar.destroy();
      el.remove();
    });
  });

  /** research/13-notion-tabs-extras.md:81-82 — the "N more…" list. */
  describe('overflow list (Notion parity)', () => {
    const threeViews = (): DatabaseViewConfig[] => [
      makeView({ id: 'v1', name: 'Alpha', position: 'a0' }),
      makeView({ id: 'v2', name: 'Beta', position: 'a1' }),
      makeView({ id: 'v3', name: 'Gamma', position: 'a2' }),
    ];

    const open = (
      options: { api?: API; onEditView?: (viewId: string, anchor: HTMLElement) => void } = {}
    ): { bar: DatabaseTabBar; el: HTMLElement; list: HTMLElement } => {
      const bar = new DatabaseTabBar({
        views: threeViews(),
        activeViewId: 'v1',
        onTabClick,
        onAddView,
        onRename,
        onDuplicate,
        onDelete,
        onReorder,
        onEditView: options.onEditView,
        api: options.api,
      });
      const el = bar.render();

      document.body.appendChild(el);
      bar.handleOverflow(1);
      (el.querySelector('[data-blok-database-tab-more]') as HTMLElement).click();

      return { bar, el, list: document.querySelector('[data-blok-database-tab-overflow-dropdown]') as HTMLElement };
    };

    const row = (list: HTMLElement, viewId: string): HTMLElement =>
      list.querySelector(`[data-blok-database-tab-overflow-item][data-view-id="${viewId}"]`) as HTMLElement;

    const shownRows = (list: HTMLElement): string[] =>
      Array.from(list.querySelectorAll<HTMLElement>('[data-blok-database-tab-overflow-item]'))
        .filter((item) => !item.hidden)
        .map((item) => item.getAttribute('data-view-id') ?? '');

    const openRowMenu = (list: HTMLElement, viewId: string): void => {
      (row(list, viewId).querySelector('[data-blok-database-tab-overflow-menu]') as HTMLButtonElement).click();
    };

    it('opens with a focused "Search for a view..." field in the shared field look', () => {
      const { bar, el, list } = open();
      const field = list.querySelector('[data-blok-field="search"]');
      const input = field?.querySelector('input');

      expect(input?.placeholder).toBe('Search for a view...');
      expect(input).toHaveFocus();
      expect(list.firstElementChild).toBe(field);

      bar.destroy();
      el.remove();
    });

    it('localizes the search placeholder and the new-view action', () => {
      const t = vi.fn((key: string) => `«${key}»`);
      const { bar, el, list } = open({ api: { i18n: { t, has: () => true } } as unknown as API });

      expect(list.querySelector<HTMLInputElement>('[data-blok-field="search"] input')?.placeholder).toBe('«tools.database.searchViews»');
      expect(list.querySelector('[data-blok-database-tab-overflow-new]')?.textContent?.trim()).toBe('«tools.database.newView»');

      bar.destroy();
      el.remove();
    });

    it('labels the new-view action "New view" with a plus icon, not a typed "+"', () => {
      const { bar, el, list } = open();
      const action = list.querySelector('[data-blok-database-tab-overflow-new]') as HTMLElement;

      expect(action.textContent?.trim()).toBe('New view');
      expect(action.querySelector('svg')).not.toBeNull();

      bar.destroy();
      el.remove();
    });

    it('narrows the rows by name as the user types, in tab order, keeping New view', () => {
      const { bar, el, list } = open();
      const input = list.querySelector('[data-blok-field="search"] input') as HTMLInputElement;

      input.value = 'gam';
      input.dispatchEvent(new Event('input'));

      expect(shownRows(list)).toStrictEqual(['v3']);
      expect((list.querySelector('[data-blok-database-tab-overflow-new]') as HTMLElement).hidden).toBe(false);

      input.value = '';
      input.dispatchEvent(new Event('input'));

      expect(shownRows(list)).toStrictEqual(['v1', 'v2', 'v3']);

      bar.destroy();
      el.remove();
    });

    it('gives every row a drag handle and a "•••" button, both labelled', () => {
      const { bar, el, list } = open();

      for (const id of ['v1', 'v2', 'v3']) {
        const handle = row(list, id).querySelector('button[data-blok-database-tab-overflow-handle]');
        const menu = row(list, id).querySelector('button[data-blok-database-tab-overflow-menu]');

        expect(handle?.getAttribute('aria-label')).toBe('Drag to reorder');
        expect(menu?.getAttribute('aria-label')).toBe('More actions');
      }

      bar.destroy();
      el.remove();
    });

    it('opens the tab view menu from "•••" without switching view or closing the list', () => {
      const { bar, el, list } = open({ onEditView: vi.fn() });

      openRowMenu(list, 'v3');

      const menu = document.querySelector('[data-blok-database-tab-context]') as HTMLElement;

      expect(Array.from(menu.children).map((item) => item.textContent)).toStrictEqual(['Rename', 'Edit view', 'Duplicate view', 'Delete view']);
      expect(onTabClick).not.toHaveBeenCalled();
      expect(list.isConnected).toBe(true);

      bar.destroy();
      el.remove();
    });

    it('keeps the list open while the user clicks inside the row menu', () => {
      const { bar, el, list } = open();

      openRowMenu(list, 'v2');
      const item = document.querySelector('[data-blok-database-tab-action="duplicate view"]') as HTMLElement;

      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(list.isConnected).toBe(true);
      item.click();

      expect(onDuplicate).toHaveBeenCalledWith('v2');

      bar.destroy();
      el.remove();
    });

    it('deletes the row\'s view from its menu', () => {
      const { bar, el, list } = open();

      openRowMenu(list, 'v2');
      (document.querySelector('[data-blok-database-tab-action="delete view"]') as HTMLElement).click();

      expect(onDelete).toHaveBeenCalledWith('v2');

      bar.destroy();
      el.remove();
    });

    it('renames in the row itself, since the tab is hidden in the overflow', () => {
      const { bar, el, list } = open();

      openRowMenu(list, 'v3');
      (document.querySelector('[data-blok-database-tab-action="rename"]') as HTMLElement).click();

      const input = row(list, 'v3').querySelector('input') as HTMLInputElement;

      expect(input).not.toBeNull();
      expect(input).toHaveFocus();
      input.click();
      expect(onTabClick).not.toHaveBeenCalled();

      input.value = 'Gamma 2';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(onRename).toHaveBeenCalledWith('v3', 'Gamma 2');

      bar.destroy();
      el.remove();
    });

    it('anchors Edit view at the "N more…" button when the tab is hidden', () => {
      const onEditView = vi.fn<(viewId: string, anchor: HTMLElement) => void>();
      const { bar, el, list } = open({ onEditView });

      openRowMenu(list, 'v3');
      (document.querySelector('[data-blok-database-tab-action="edit view"]') as HTMLElement).click();

      expect(onEditView).toHaveBeenCalledWith('v3', el.querySelector('[data-blok-database-tab-more]'));

      bar.destroy();
      el.remove();
    });

    it('peels one layer per Escape: the row menu first, then the list', () => {
      const { bar, el, list } = open();

      openRowMenu(list, 'v2');
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(document.querySelector('[data-blok-database-tab-context]')).toBeNull();
      expect(list.isConnected).toBe(true);

      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(list.isConnected).toBe(false);

      bar.destroy();
      el.remove();
    });

    it('reorders through the bar\'s onReorder when a row is dragged by its handle', () => {
      const { bar, el, list } = open();

      ['v1', 'v2', 'v3'].forEach((id, index) => {
        Object.defineProperty(row(list, id), 'getBoundingClientRect', {
          value: () => rect({ top: index * 28, bottom: index * 28 + 28, height: 28, width: 290 }),
          configurable: true,
        });
      });
      const handle = row(list, 'v3').querySelector('[data-blok-database-tab-overflow-handle]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 70, button: 0, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 5 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 5 }));

      expect(onTabClick).not.toHaveBeenCalled();
      expect(onReorder).toHaveBeenCalledTimes(1);
      const [viewId, position] = onReorder.mock.calls[0];

      expect(viewId).toBe('v3');
      expect(position < 'a0').toBe(true);

      bar.destroy();
      el.remove();
    });

    it('does not reorder when the handle is pressed and released in place', () => {
      const { bar, el, list } = open();
      const handle = row(list, 'v2').querySelector('[data-blok-database-tab-overflow-handle]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 40, button: 0, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 40 }));
      handle.click();

      expect(onReorder).not.toHaveBeenCalled();
      expect(onTabClick).not.toHaveBeenCalled();

      bar.destroy();
      el.remove();
    });
  });

  describe('popover positioning', () => {
    it('uses position: fixed on context popover so it aligns with viewport coords from getBoundingClientRect', () => {
      const bar = createTabBar([makeView({ id: 'v1' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const popover = document.querySelector('[data-blok-database-tab-context]') as HTMLElement;
      expect(popover.style.position).toBe('fixed');
      el.remove();
    });

    it('uses position: fixed on overflow dropdown so it aligns with viewport coords from getBoundingClientRect', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}`, name: `Board ${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const el = bar.render();
      document.body.appendChild(el);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);

      const moreBtn = el.querySelector('[data-blok-database-tab-more]') as HTMLElement;
      moreBtn.click();

      const dropdown = document.querySelector('[data-blok-database-tab-overflow-dropdown]') as HTMLElement;
      expect(dropdown.style.position).toBe('fixed');

      bar.destroy();
      el.remove();
    });

    it('keeps the overflow dropdown attached during nested scrolling', () => {
      const views = Array.from({ length: 6 }, (_, i) =>
        makeView({ id: `v${i}`, position: `a${i}`, name: `Board ${i}` })
      );
      const bar = createTabBar(views, 'v0');
      const scrollHost = document.createElement('div');
      const el = bar.render();

      scrollHost.appendChild(el);
      document.body.appendChild(scrollHost);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bar as any).handleOverflow(3);

      const moreBtn = el.querySelector('[data-blok-database-tab-more]') as HTMLElement;
      const anchorRectSpy = vi.spyOn(moreBtn, 'getBoundingClientRect').mockReturnValue(
        rect({ top: 100, bottom: 140, left: 50, right: 90, width: 40, height: 40 })
      );

      moreBtn.click();
      const dropdown = document.querySelector('[data-blok-database-tab-overflow-dropdown]') as HTMLElement;

      expect(dropdown.style.top).toBe('144px');

      anchorRectSpy.mockReturnValue(
        rect({ top: 60, bottom: 100, left: 50, right: 90, width: 40, height: 40 })
      );
      scrollHost.dispatchEvent(new Event('scroll'));

      expect(dropdown.style.top).toBe('104px');

      bar.destroy();
      scrollHost.remove();
    });
  });

  describe('rename flow', () => {
    it('replaces tab name with input when Rename is clicked', () => {
      const bar = createTabBar([makeView({ id: 'v1', name: 'Board' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const rename = document.querySelector('[data-blok-database-tab-action="rename"]') as HTMLElement;
      rename.click();
      const input = tab.querySelector('[data-blok-database-tab-rename-input]') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.value).toBe('Board');
      el.remove();
    });

    it('gives the rename input an accessible aria-label', () => {
      const bar = createTabBar([makeView({ id: 'v1', name: 'Board' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const rename = document.querySelector('[data-blok-database-tab-action="rename"]') as HTMLElement;
      rename.click();
      const input = tab.querySelector('[data-blok-database-tab-rename-input]') as HTMLInputElement;
      expect(input.getAttribute('aria-label')).toBe('Rename');
      el.remove();
    });

    it('focuses the rename input so keyboard users can type immediately', () => {
      const bar = createTabBar([makeView({ id: 'v1', name: 'Board' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const rename = document.querySelector('[data-blok-database-tab-action="rename"]') as HTMLElement;
      rename.click();
      const input = tab.querySelector('[data-blok-database-tab-rename-input]') as HTMLInputElement;
      expect(input).toHaveFocus();
      el.remove();
    });

    it('calls onRename with new name on blur', () => {
      const bar = createTabBar([makeView({ id: 'v1', name: 'Board' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const rename = document.querySelector('[data-blok-database-tab-action="rename"]') as HTMLElement;
      rename.click();
      const input = tab.querySelector('[data-blok-database-tab-rename-input]') as HTMLInputElement;
      input.value = 'Sprint';
      input.dispatchEvent(new Event('blur'));
      expect(onRename).toHaveBeenCalledWith('v1', 'Sprint');
      el.remove();
    });

    it('stops propagation of keydown events so the editor keyboard controller does not process them', () => {
      const bar = createTabBar([makeView({ id: 'v1', name: 'Board' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const rename = document.querySelector('[data-blok-database-tab-action="rename"]') as HTMLElement;
      rename.click();
      const input = tab.querySelector('[data-blok-database-tab-rename-input]') as HTMLInputElement;

      const propagatedEvents: string[] = [];
      const outerHandler = (e: Event) => propagatedEvents.push((e as KeyboardEvent).key);
      document.addEventListener('keydown', outerHandler);

      try {
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(enterEvent, 'stopPropagation');
        input.dispatchEvent(enterEvent);
        expect(stopSpy).toHaveBeenCalled();

        // No keydown events should have reached the document listener
        expect(propagatedEvents).toHaveLength(0);
      } finally {
        document.removeEventListener('keydown', outerHandler);
      }

      el.remove();
    });

    it('stops propagation of all keydown events, not just Enter and Escape', () => {
      const bar = createTabBar([makeView({ id: 'v1', name: 'Board' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const rename = document.querySelector('[data-blok-database-tab-action="rename"]') as HTMLElement;
      rename.click();
      const input = tab.querySelector('[data-blok-database-tab-rename-input]') as HTMLInputElement;

      const propagatedEvents: string[] = [];
      const outerHandler = (e: Event) => propagatedEvents.push((e as KeyboardEvent).key);
      document.addEventListener('keydown', outerHandler);

      try {
        const letterEvent = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(letterEvent, 'stopPropagation');
        input.dispatchEvent(letterEvent);
        expect(stopSpy).toHaveBeenCalled();

        // No keydown events should have reached the document listener
        expect(propagatedEvents).toHaveLength(0);
      } finally {
        document.removeEventListener('keydown', outerHandler);
      }

      el.remove();
    });

    it('restores original name on Escape', () => {
      const bar = createTabBar([makeView({ id: 'v1', name: 'Board' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const rename = document.querySelector('[data-blok-database-tab-action="rename"]') as HTMLElement;
      rename.click();
      const input = tab.querySelector('[data-blok-database-tab-rename-input]') as HTMLInputElement;
      input.value = 'Sprint';
       
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(onRename).not.toHaveBeenCalled();
      expect(tab.querySelector('[data-blok-database-tab-name]')?.textContent).toBe('Board');
      el.remove();
    });
  });

  describe('getAddBtnEl', () => {
    it('returns the add-view button element after render', () => {
      const view = makeView({ id: 'v1' });
      const bar = createTabBar([view], 'v1');
      bar.render();
      const btn = bar.getAddBtnEl();
      expect(btn).not.toBeNull();
      expect(btn?.hasAttribute('data-blok-database-add-view')).toBe(true);
    });

    it('returns null before render', () => {
      const view = makeView({ id: 'v1' });
      const bar = createTabBar([view], 'v1');
      expect(bar.getAddBtnEl()).toBeNull();
    });
  });

  describe('read-only mode', () => {
    it('+ button is hidden when readOnly: true is passed to constructor', () => {
      const view = makeView({ id: 'v1', position: 'a0' });
      const bar = new DatabaseTabBar({
        views: [view],
        activeViewId: 'v1',
        onTabClick,
        onAddView,
        onRename,
        onDuplicate,
        onDelete,
        onReorder,
        readOnly: true,
      });
      const el = bar.render();
      expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();
      el.remove();
    });

    it('+ button is visible when readOnly: false (default)', () => {
      const view = makeView({ id: 'v1', position: 'a0' });
      const bar = createTabBar([view], 'v1');
      const el = bar.render();
      expect(el.querySelector('[data-blok-database-add-view]')).not.toBeNull();
      el.remove();
    });

    it('setReadOnly(true) hides the + button', () => {
      const view = makeView({ id: 'v1', position: 'a0' });
      const bar = createTabBar([view], 'v1');
      const el = bar.render();
      expect(el.querySelector('[data-blok-database-add-view]')).not.toBeNull();
      bar.setReadOnly(true);
      expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();
      el.remove();
    });

    it('setReadOnly(false) shows the + button', () => {
      const view = makeView({ id: 'v1', position: 'a0' });
      const bar = new DatabaseTabBar({
        views: [view],
        activeViewId: 'v1',
        onTabClick,
        onAddView,
        onRename,
        onDuplicate,
        onDelete,
        onReorder,
        readOnly: true,
      });
      const el = bar.render();
      expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();
      bar.setReadOnly(false);
      expect(el.querySelector('[data-blok-database-add-view]')).not.toBeNull();
      el.remove();
    });

    const twoViews = (): DatabaseViewConfig[] => [
      makeView({ id: 'v1', position: 'a0' }),
      makeView({ id: 'v2', position: 'a1' }),
    ];

    // The tool flips a live bar with setReadOnly, so both ways must hold.
    const readOnlyBars: Array<[string, () => DatabaseTabBar]> = [
      ['constructed read-only', () => new DatabaseTabBar({
        views: twoViews(),
        activeViewId: 'v1',
        onTabClick,
        onAddView,
        onRename,
        onDuplicate,
        onDelete,
        onReorder,
        readOnly: true,
      })],
      ['switched to read-only', () => {
        const bar = createTabBar(twoViews(), 'v1');

        bar.setReadOnly(true);

        return bar;
      }],
    ];

    it.each(readOnlyBars)('%s: right-click opens no tab menu', (_label, makeBar) => {
      const bar = makeBar();
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(document.querySelector('[data-blok-database-tab-context]')).toBeNull();
      bar.destroy();
      el.remove();
    });

    it.each(readOnlyBars)('%s: double-click opens no tab menu', (_label, makeBar) => {
      const bar = makeBar();
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(document.querySelector('[data-blok-database-tab-context]')).toBeNull();
      bar.destroy();
      el.remove();
    });

    it.each(readOnlyBars)('%s: dragging a tab does not reorder', (_label, makeBar) => {
      const bar = makeBar();
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 15, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 15 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 15 }));
      expect(onReorder).not.toHaveBeenCalled();
      expect(document.querySelector('[data-blok-database-tab-ghost]')).toBeNull();
      bar.destroy();
      el.remove();
    });

    it.each(readOnlyBars)('%s: clicking a tab still switches views', (_label, makeBar) => {
      const bar = makeBar();
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v2"]') as HTMLElement;
      tab.click();
      expect(onTabClick).toHaveBeenCalledWith('v2');
      bar.destroy();
      el.remove();
    });

    it('leaving read-only brings the tab menu back', () => {
      const bar = createTabBar(twoViews(), 'v1');
      bar.setReadOnly(true);
      bar.setReadOnly(false);
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(document.querySelector('[data-blok-database-tab-context]')).not.toBeNull();
      bar.destroy();
      el.remove();
    });
  });
});

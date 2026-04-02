import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseTabBar } from '../../../../src/tools/database/database-tab-bar';
import type { DatabaseViewData } from '../../../../src/tools/database/types';

const makeView = (overrides: Partial<DatabaseViewData> = {}): DatabaseViewData => ({
  id: `view-${Math.random().toString(36).slice(2, 6)}`,
  name: 'Board',
  type: 'board',
  position: 'a0',
  data: { columns: [], cardMap: {} },
  ...overrides,
});

describe('DatabaseTabBar', () => {
  let onTabClick: ReturnType<typeof vi.fn<(viewId: string) => void>>;
  let onAddView: ReturnType<typeof vi.fn<(type: 'board') => void>>;
  let onRename: ReturnType<typeof vi.fn<(viewId: string, newName: string) => void>>;
  let onDuplicate: ReturnType<typeof vi.fn<(viewId: string) => void>>;
  let onDelete: ReturnType<typeof vi.fn<(viewId: string) => void>>;
  let onReorder: ReturnType<typeof vi.fn<(viewId: string, newPosition: string) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    onTabClick = vi.fn<(viewId: string) => void>();
    onAddView = vi.fn<(type: 'board') => void>();
    onRename = vi.fn<(viewId: string, newName: string) => void>();
    onDuplicate = vi.fn<(viewId: string) => void>();
    onDelete = vi.fn<(viewId: string) => void>();
    onReorder = vi.fn<(viewId: string, newPosition: string) => void>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any popovers left in the DOM
    document.querySelectorAll('[data-blok-database-view-popover]').forEach((el) => el.remove());
    document.querySelectorAll('[data-blok-database-tab-context]').forEach((el) => el.remove());
  });

  const createTabBar = (views: DatabaseViewData[], activeViewId: string): DatabaseTabBar => {
    return new DatabaseTabBar({
      views,
      activeViewId,
      onTabClick,
      onAddView,
      onRename,
      onDuplicate,
      onDelete,
      onReorder,
    });
  };

  describe('render()', () => {
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
});

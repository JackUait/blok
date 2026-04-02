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
    document.querySelectorAll('[data-blok-database-tab-overflow-dropdown]').forEach((el) => el.remove());
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

    it('shows Rename, Duplicate, and Delete options when multiple views exist', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      expect(document.querySelector('[data-blok-database-tab-action="rename"]')).not.toBeNull();
      expect(document.querySelector('[data-blok-database-tab-action="duplicate"]')).not.toBeNull();
      expect(document.querySelector('[data-blok-database-tab-action="delete"]')).not.toBeNull();
      el.remove();
    });

    it('hides Delete option when only one view exists', () => {
      const bar = createTabBar([makeView({ id: 'v1' })], 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const deleteItem = document.querySelector<HTMLElement>('[data-blok-database-tab-action="delete"]');
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
      const dup = document.querySelector('[data-blok-database-tab-action="duplicate"]') as HTMLElement;
      dup.click();
      expect(onDuplicate).toHaveBeenCalledWith('v1');
      el.remove();
    });

    it('calls onDelete when Delete is clicked', () => {
      const views = [makeView({ id: 'v1', position: 'a0' }), makeView({ id: 'v2', position: 'a1' })];
      const bar = createTabBar(views, 'v1');
      const el = bar.render();
      document.body.appendChild(el);
      const tab = el.querySelector('[data-view-id="v1"]') as HTMLElement;
      tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      const del = document.querySelector('[data-blok-database-tab-action="delete"]') as HTMLElement;
      del.click();
      expect(onDelete).toHaveBeenCalledWith('v1');
      el.remove();
    });
  });

  describe('tab drag reordering', () => {
    const createBarWithLayout = (views: DatabaseViewData[], activeViewId: string): { bar: DatabaseTabBar; el: HTMLElement } => {
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
      bar.destroy();
      el.remove();
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
    it('shows "N more..." button when tabs overflow', () => {
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
      expect(moreBtn.textContent).toContain('3 more');

      bar.destroy();
      el.remove();
    });

    it('opens dropdown listing all views when "N more..." is clicked', () => {
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
});

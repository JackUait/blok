import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseTabBar } from '../../../../src/tools/database/database-tab-bar';
import type { DatabaseViewConfig } from '../../../../src/tools/database/types';

/** notion-spec-2 §26.1: the view bar folds as one row (tabs, icons, New). */

const probes: Array<() => void> = [];
const originalResizeObserver = globalThis.ResizeObserver;

class StubResizeObserver implements ResizeObserver {
  private readonly fire: () => void;

  constructor(callback: ResizeObserverCallback) {
    this.fire = () => callback([], this);
    probes.push(this.fire);
  }

  observe(): void { /* fired by hand */ }
  unobserve(): void { /* no-op */ }
  disconnect(): void {
    const index = probes.indexOf(this.fire);

    if (index !== -1) probes.splice(index, 1);
  }
}

const view = (id: string, name: string, position: string): DatabaseViewConfig => ({
  id, name, type: 'table', position, sorts: [], filters: [], visibleProperties: [],
});

const threeViews = (): DatabaseViewConfig[] => [view('v1', 'Table', 'a0'), view('v2', 'Board', 'a1'), view('v3', 'List', 'a2')];

interface Mounted { tabBar: DatabaseTabBar; viewBar: HTMLElement; el: HTMLElement; toolbar: HTMLElement }

/**
 * A view bar like index.ts builds it, with a toolbar holding the icon group,
 * Settings and New. Tabs are 100 wide, "N more…" 80; the toolbar is 243 wide,
 * 103 without its icons.
 */
const mount = (views = threeViews(), active = 'v1'): Mounted => {
  const tabBar = new DatabaseTabBar({
    views, activeViewId: active, onTabClick: vi.fn(), onAddView: vi.fn(), onRename: vi.fn(),
    onDuplicate: vi.fn(), onDelete: vi.fn(), onReorder: vi.fn(),
  });
  const viewBar = document.createElement('div');
  const toolbar = document.createElement('div');
  const filter = document.createElement('button');
  const settings = document.createElement('button');
  const newButton = document.createElement('span');

  viewBar.setAttribute('data-blok-database-view-bar', '');
  toolbar.setAttribute('data-blok-database-view-toolbar', '');
  filter.setAttribute('data-blok-database-toolbar-foldable', '');
  newButton.setAttribute('data-blok-database-new', '');
  toolbar.append(filter, settings, newButton);
  const el = tabBar.render();

  viewBar.append(el, toolbar);
  document.body.appendChild(viewBar);

  return { tabBar, viewBar, el, toolbar };
};

const layOut = ({ viewBar }: Mounted, width: number): void => {
  Object.defineProperty(viewBar, 'clientWidth', { value: width, configurable: true });
};

const fire = (): void => {
  for (const probe of [...probes]) probe();
};

const shownTabs = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-blok-database-tab]'))
    .filter((tab) => tab.style.display !== 'none')
    .map((tab) => tab.getAttribute('data-view-id') ?? '');

describe('DatabaseTabBar — the view bar folds like Notion (notion-spec-2 §26.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    probes.length = 0;
    globalThis.ResizeObserver = StubResizeObserver;
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-blok-database-tab')) return 100;
      if (this.hasAttribute('data-blok-database-tab-more')) return 80;
      if (this.hasAttribute('data-blok-database-view-toolbar')) {
        return this.closest('[data-blok-database-fold-icons]') === null ? 243 : 103;
      }

      return 0;
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    globalThis.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it('shows every tab, "+", the icons and New on a wide bar', () => {
    const mounted = mount();

    layOut(mounted, 1000);
    fire();

    expect(shownTabs(mounted.el)).toEqual(['v1', 'v2', 'v3']);
    expect(mounted.el.querySelector('[data-blok-database-tab-more]')).toBeNull();
    expect(mounted.el.hasAttribute('data-blok-database-tab-folded')).toBe(false);
    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-icons')).toBe(false);
    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-new')).toBe(false);
  });

  it('folds tabs beside the full toolbar and drops "+" with the first fold', () => {
    const mounted = mount();

    // 300 for the tabs: three tabs and "+" need 334; two and "1 more…" need 282.
    layOut(mounted, 543);
    fire();

    expect(shownTabs(mounted.el)).toEqual(['v1', 'v2']);
    expect(mounted.el.querySelector('[data-blok-database-tab-more]')?.textContent).toBe('1 more…');
    expect(mounted.el.hasAttribute('data-blok-database-tab-folded')).toBe(true);
    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-icons')).toBe(false);
  });

  it('turns the tabs into one "Table ⌄" button when fewer than two fit, keeping the icons', () => {
    const mounted = mount();

    layOut(mounted, 493);
    fire();

    const compact = mounted.el.querySelector<HTMLElement>('[data-blok-database-tab-compact]');

    expect(shownTabs(mounted.el)).toEqual([]);
    expect(mounted.el.querySelector('[data-blok-database-tab-more]')).toBeNull();
    expect(compact?.textContent).toContain('Table');
    expect(compact?.getAttribute('aria-haspopup')).toBe('listbox');
    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-icons')).toBe(false);
  });

  it('names the current view in "Table ⌄", not the first one', () => {
    const mounted = mount(threeViews(), 'v3');

    layOut(mounted, 493);
    fire();

    expect(mounted.el.querySelector('[data-blok-database-tab-compact]')?.textContent).toContain('List');
  });

  it('opens the views list from "Table ⌄"', () => {
    const mounted = mount();

    layOut(mounted, 493);
    fire();
    mounted.el.querySelector<HTMLElement>('[data-blok-database-tab-compact]')?.click();

    expect(document.querySelector('[data-blok-database-tab-overflow-dropdown]')).not.toBeNull();
    mounted.tabBar.destroy();
  });

  it('hides the icon group, then gives two tabs back', () => {
    const mounted = mount();

    layOut(mounted, 430);
    fire();

    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-icons')).toBe(true);
    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-new')).toBe(false);
    expect(shownTabs(mounted.el)).toEqual(['v1', 'v2']);
  });

  it('drops New last and keeps "Table ⌄"', () => {
    const mounted = mount();

    layOut(mounted, 300);
    fire();

    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-icons')).toBe(true);
    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-new')).toBe(true);
    expect(mounted.el.querySelector('[data-blok-database-tab-compact]')).not.toBeNull();
  });

  it('undoes every fold once the bar is wide again', () => {
    const mounted = mount();

    layOut(mounted, 300);
    fire();
    layOut(mounted, 1000);
    fire();

    expect(shownTabs(mounted.el)).toEqual(['v1', 'v2', 'v3']);
    expect(mounted.el.querySelector('[data-blok-database-tab-compact]')).toBeNull();
    expect(mounted.el.hasAttribute('data-blok-database-tab-folded')).toBe(false);
    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-icons')).toBe(false);
    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-new')).toBe(false);
  });

  it('leaves the view bar alone once destroyed, so a rebuilt bar owns it', () => {
    const mounted = mount();

    mounted.tabBar.destroy();
    layOut(mounted, 300);
    fire();

    expect(mounted.viewBar.hasAttribute('data-blok-database-fold-icons')).toBe(false);
  });
});

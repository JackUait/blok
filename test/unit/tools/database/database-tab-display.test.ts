/**
 * "Display as" for view tabs: text and icon, text only or icon only. The
 * choice is this person's, per database (research/03 §1.2), so it lives in
 * the host's view state lever or this browser, never in the document.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface MockItem {
  title?: string;
  type?: string;
  isActive?: boolean;
  onActivate?: () => void;
  children?: { items?: MockItem[] };
}

vi.mock('../../../../src/components/utils/popover', () => {
  const PopoverItemType = { Default: 'default', Separator: 'separator', Html: 'html' };

  class MockPopoverDesktop {
    private container: HTMLElement | null = null;
    private readonly items: MockItem[];

    constructor(params: { items?: MockItem[] }) {
      this.items = params.items ?? [];
    }

    show(): void {
      const container = document.createElement('div');

      container.setAttribute('data-blok-database-tab-context', '');
      const draw = (items: MockItem[]): void => {
        for (const item of items) {
          if (item.title === undefined) continue;
          const el = document.createElement('div');
          const onActivate = item.onActivate;

          el.setAttribute('data-blok-database-tab-action', item.title);
          if (item.isActive === true) el.setAttribute('data-active', '');
          if (onActivate !== undefined) el.addEventListener('click', () => onActivate());
          container.appendChild(el);
          draw(item.children?.items ?? []);
        }
      };

      draw(this.items);
      document.body.appendChild(container);
      this.container = container;
    }

    destroy(): void {
      this.container?.remove();
      this.container = null;
    }

    on(): void {
      /* no-op */
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverItemType };
});

import { DatabaseTabBar } from '../../../../src/tools/database/database-tab-bar';
import { TabDisplayPreference } from '../../../../src/tools/database/database-tab-display';
import type { DatabaseTabDisplay, DatabaseViewConfig, DatabaseViewStateStore } from '../../../../src/tools/database/types';

const view = (id: string, position: string): DatabaseViewConfig => ({
  id, name: `View ${id}`, type: 'table', position, sorts: [], filters: [], visibleProperties: [],
});

const bar = (display: DatabaseTabDisplay, onDisplayChange = vi.fn<(display: DatabaseTabDisplay) => void>()): HTMLElement => {
  const el = new DatabaseTabBar({
    views: [view('v1', 'a0'), view('v2', 'a1')],
    activeViewId: 'v1',
    onTabClick: vi.fn(),
    onAddView: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    display,
    onDisplayChange,
  }).render();

  document.body.appendChild(el);

  return el;
};

const action = (title: string): HTMLElement | null => document.querySelector(`[data-blok-database-tab-action="${title}"]`);

const openMenu = (el: HTMLElement): void => {
  el.querySelector('[data-view-id="v1"]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
};

describe('view tab "Display as"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('marks the bar with the mode and keeps each tab named in icon-only mode', () => {
    const el = bar('icon');
    const tab = el.querySelector('[data-view-id="v2"]');

    expect(el.getAttribute('data-display')).toBe('icon');
    expect(tab?.querySelector('[data-blok-database-tab-name]')?.textContent).toBe('View v2');
    expect(tab?.querySelector('[data-blok-database-tab-icon] svg')).not.toBeNull();
  });

  it('offers the three modes under "Display as", checks the current one, and reports a pick', () => {
    const onDisplayChange = vi.fn<(display: DatabaseTabDisplay) => void>();

    openMenu(bar('text', onDisplayChange));

    expect(action('Display as')).not.toBeNull();
    expect(action('Text and icon')?.hasAttribute('data-active')).toBe(false);
    expect(action('Text only')?.hasAttribute('data-active')).toBe(true);
    expect(action('Icon only')?.hasAttribute('data-active')).toBe(false);

    action('Icon only')?.click();

    expect(onDisplayChange).toHaveBeenCalledWith('icon');
  });
});

describe('TabDisplayPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fallback = (initial?: unknown): { get: (key: string) => unknown; set: (key: string, value: unknown) => void; values: Map<string, unknown> } => {
    const values = new Map<string, unknown>(initial === undefined ? [] : [['tabDisplay', initial]]);

    return { values, get: (key) => values.get(key), set: (key, value) => { values.set(key, value); } };
  };

  it('defaults to text and icon, and ignores an unknown stored value', () => {
    expect(new TabDisplayPreference({ fallback: fallback(), onChange: vi.fn() }).get()).toBe('both');
    expect(new TabDisplayPreference({ fallback: fallback('huge'), onChange: vi.fn() }).get()).toBe('both');
  });

  it('keeps the choice in this browser without a host store', () => {
    const local = fallback();
    const pref = new TabDisplayPreference({ fallback: local, onChange: vi.fn() });

    pref.set('icon');

    expect(local.values.get('tabDisplay')).toBe('icon');
    expect(new TabDisplayPreference({ fallback: local, onChange: vi.fn() }).get()).toBe('icon');
  });

  it('reads and writes through the host lever when it has one', async () => {
    const local = fallback();
    const setTabDisplay = vi.fn(async () => undefined);
    const store: DatabaseViewStateStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      getTabDisplay: vi.fn(async () => 'icon' as const),
      setTabDisplay,
    };
    const onChange = vi.fn();
    const pref = new TabDisplayPreference({ store, fallback: local, onChange });

    expect(pref.get()).toBe('both');
    await pref.load();

    expect(pref.get()).toBe('icon');
    expect(onChange).toHaveBeenCalledTimes(1);

    pref.set('text');

    expect(setTabDisplay).toHaveBeenCalledWith('text');
    expect(local.values.has('tabDisplay')).toBe(false);
    expect(pref.get()).toBe('text');
  });

  it('falls back to this browser when the host store has no tab display methods', () => {
    const local = fallback('icon');
    const store: DatabaseViewStateStore = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) };
    const pref = new TabDisplayPreference({ store, fallback: local, onChange: vi.fn() });

    expect(pref.get()).toBe('icon');
    pref.set('text');
    expect(local.values.get('tabDisplay')).toBe('text');
  });
});

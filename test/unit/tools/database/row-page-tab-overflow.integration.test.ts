import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { OutputBlockData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const TAB = 100;
const ADD = 28;
const MORE = 60;
const BAR = '[data-blok-database-drawer-tabs]';
const BUILDER = '[data-blok-interface="database-layout-builder"]';
const VIEWS = ['V1', 'V2', 'V3', 'V4'];

/** jsdom lays nothing out: the bar, its tabs and buttons get fixed widths. */
const layout = { bar: 330 };
const observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element> }> = [];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

/** A Tabbed row page: Content, then four views of this database. */
const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'lt'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
  { id: 'lt', type: 'tabs', parent: 'db', data: {}, content: ['tc', ...VIEWS.map((_, i) => `tv${i}`)] },
  { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
  ...VIEWS.flatMap((name, i): OutputBlockData[] => [
    { id: `tv${i}`, type: 'tab', parent: 'lt', data: { title: name }, content: [`lv${i}`] },
    {
      id: `lv${i}`,
      type: 'database',
      parent: `tv${i}`,
      data: {
        title: '',
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: `lvv${i}`, name, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: `lvv${i}`,
        source: { databaseId: 'db' },
      },
    },
  ]),
];

const make = async (): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
      tabs: TabsTool,
      tab: TabTool,
    },
    data: { blocks: doc() },
  } as never);
  await editor.isReady;
  await quiet();
};

const click = async (el: Element | null): Promise<void> => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

/** The bar on screen: the builder's when it is open, else the row page's. */
const bar = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(`${BUILDER} ${BAR}`) ?? holder?.querySelector<HTMLElement>(BAR) ?? null;

const resize = async (width: number): Promise<void> => {
  layout.bar = width;
  observers
    .filter(observer => [...observer.targets].some(target => target.matches(BAR)))
    .forEach(observer => observer.callback([], {} as ResizeObserver));
  await quiet();
};

const tabs = (): HTMLElement[] => [...(bar()?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
const shown = (): string[] => tabs().filter(tab => !tab.hidden).map(tab => tab.textContent?.trim() ?? '');
const selected = (): string | undefined => tabs().find(tab => tab.getAttribute('aria-selected') === 'true')?.textContent?.trim();
const more = (): HTMLElement | null => bar()?.querySelector<HTMLElement>('[data-blok-database-tab-more]') ?? null;
const list = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-tab-overflow-dropdown]');
const rows = (): HTMLElement[] => [...(list()?.querySelectorAll<HTMLElement>('[data-blok-database-tab-overflow-item]') ?? [])];
const rowName = (row: HTMLElement): string => row.querySelector('[data-blok-database-tab-overflow-name]')?.textContent ?? '';
const row = (name: string): HTMLElement | null => rows().find(element => rowName(element) === name) ?? null;

const openRowPage = async (): Promise<void> => {
  await click(holder?.querySelector('[data-row-id="r1"] [data-blok-database-table-open]') ?? null);
};

let elementFromPointDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0;
  // jsdom has no elementFromPoint; rectangle selection calls it on every body mousedown.
  elementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  if (typeof document.elementFromPoint !== 'function') {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  }
  layout.bar = 330;
  vi.stubGlobal('ResizeObserver', class {
    private readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> };

    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set() };
      observers.push(this.entry);
    }

    public observe(target: Element): void {
      this.entry.targets.add(target);
    }

    public unobserve(target: Element): void {
      this.entry.targets.delete(target);
    }

    public disconnect(): void {
      this.entry.targets.clear();
    }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hidden || !this.isConnected || this.closest(BAR) === null) {
      return 0;
    }
    if (this.getAttribute('role') === 'tab') {
      return TAB;
    }
    if (this.hasAttribute('data-blok-database-layout-add-tab')) {
      return ADD;
    }

    return this.hasAttribute('data-blok-database-tab-more') ? MORE : 0;
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.matches(BAR) ? layout.bar : 0;
  });
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
  document.querySelectorAll('[data-blok-database-tab-overflow-dropdown]').forEach(element => element.remove());
  if (elementFromPointDescriptor === undefined) {
    Reflect.deleteProperty(document, 'elementFromPoint');
  } else {
    Object.defineProperty(document, 'elementFromPoint', elementFromPointDescriptor);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('row page tab bar "N more…" (research/13 §3a)', () => {
  it('moves the view tabs that do not fit into "N more…" after the tablist', async () => {
    await make();
    await openRowPage();
    // 330 - 60 ("more") leaves room for two 100px tabs; a row page has no Add tab.
    await resize(330);

    expect(shown()).toEqual(['Content', 'V1']);
    expect(more()?.textContent).toBe('3 more…');
    expect(more()?.closest('[role="tablist"]')).toBeNull();
  });

  it('hides nothing while the bar measures zero, and brings tabs back when it grows', async () => {
    await make();
    await openRowPage();
    await resize(0);

    expect(shown()).toEqual(['Content', ...VIEWS]);
    expect(more()).toBeNull();

    await resize(330);
    await resize(2000);

    expect(shown()).toEqual(['Content', ...VIEWS]);
    expect(more()).toBeNull();
  });

  it('on a row page, lists every tab and only switches tabs: no handle, "•••" or New view', async () => {
    await make();
    await openRowPage();
    await resize(330);
    await click(more());

    expect(list()?.querySelector('input')?.getAttribute('placeholder')).toBe('Search for a view...');
    expect(rows().map(rowName)).toEqual(['Content', ...VIEWS]);
    expect(row('Content')?.hasAttribute('data-active')).toBe(true);
    expect(list()?.querySelector('[data-blok-database-tab-overflow-handle]')).toBeNull();
    expect(list()?.querySelector('[data-blok-database-tab-overflow-menu]')).toBeNull();
    expect(list()?.querySelector('[data-blok-database-tab-overflow-new]')).toBeNull();

    // The list sits on body, outside the peek: pressing a row must not close the peek.
    row('V4')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await click(row('V4'));

    expect(holder?.querySelector('[data-blok-database-drawer]')).not.toBeNull();
    expect(selected()).toBe('V4');
    expect(list()).toBeNull();
  });

  it('keeps the open tab in the bar in place of the last tab that fits (research/21 §2)', async () => {
    await make();
    await openRowPage();
    await resize(330);
    await click(more());
    await click(row('V4'));
    await resize(330);

    // 330 - 60 ("more") holds two tabs: Content, then the open V4.
    expect(shown()).toEqual(['Content', 'V4']);
    expect(more()?.textContent).toBe('3 more…');

    await click(more());

    expect(rows().map(rowName)).toEqual(['Content', ...VIEWS]);
    expect(row('V4')?.hasAttribute('data-active')).toBe(true);
  });

  it('arrows skip the tabs folded into "N more…"', async () => {
    await make();
    await openRowPage();
    await resize(330);
    await click(more());
    await click(row('V4'));
    await resize(330);
    expect(shown()).toEqual(['Content', 'V4']);

    tabs().find(tab => tab.textContent?.trim() === 'V4')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await quiet();

    expect(selected()).toBe('Content');
  });

  it('in the builder, a row\'s "•••" opens the tab menu and New view opens Add tab', async () => {
    await make();
    await openRowPage();
    await click(holder?.querySelector('[data-blok-database-drawer-customize]') ?? null);
    // 330 - 28 (Add tab) - 60 ("more") leaves room for two tabs.
    await resize(330);

    expect(shown()).toEqual(['Content', 'V1']);

    await click(more());

    expect(rows().map(rowName)).toEqual(['Content', ...VIEWS]);
    expect(row('V3')?.querySelector('[data-blok-database-tab-overflow-handle]')).not.toBeNull();
    expect(row('V3')?.querySelector('[data-blok-database-tab-overflow-menu]')).not.toBeNull();

    await click(row('V3')?.querySelector('[data-blok-database-tab-overflow-menu]') ?? null);

    expect(document.querySelector('[data-blok-testid="database-layout-tab-menu"]')).not.toBeNull();
    expect(list()).toBeNull();

    await resize(330);
    await click(more());
    await click(list()?.querySelector('[data-blok-database-tab-overflow-new]') ?? null);

    expect(document.querySelector('[data-blok-testid="database-layout-link-data-source"]')).not.toBeNull();
  });
});

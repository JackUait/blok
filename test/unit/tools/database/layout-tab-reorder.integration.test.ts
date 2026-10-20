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

const ROW = 28;
const builderRoot = (): HTMLElement | null => document.querySelector<HTMLElement>(BUILDER);
const savedOrder = async (): Promise<unknown> =>
  (await (editor as unknown as { save: () => Promise<{ blocks: OutputBlockData[] }> }).save()).blocks.find(block => block.id === 'lt')?.content;
const history = (): { undo: () => void; redo: () => void } => (editor as unknown as { history: { undo: () => void; redo: () => void } }).history;

const customize = async (): Promise<void> => {
  await openRowPage();
  await click(holder?.querySelector('[data-blok-database-drawer-customize]') ?? null);
  await resize(330);
  await click(more());
};

/** Drags a list row by its handle to `y`: rows are 28px, stacked from 0. */
const drag = async (name: string, y: number): Promise<void> => {
  rows().forEach((element, index) => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * ROW, 290, ROW));
  });
  const handle = row(name)?.querySelector('[data-blok-database-tab-overflow-handle]');

  handle?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, clientY: 0 }));
  document.dispatchEvent(new PointerEvent('pointermove', { clientY: y }));
  document.dispatchEvent(new PointerEvent('pointerup', { clientY: y }));
  await quiet();
};

const closeList = async (): Promise<void> => {
  list()?.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await quiet();
};

const apply = async (): Promise<void> => {
  await click(builderRoot()?.querySelector('[data-blok-database-layout-apply]') ?? null);
};

describe('reordering the layout tabs from "N more…" (research/13 §3a)', () => {
  it('gives every view row a drag handle in the builder; Content keeps its place and has none', async () => {
    await make();
    await customize();

    expect(['V1', 'V2', 'V3', 'V4'].every(name => row(name)?.querySelector('[data-blok-database-tab-overflow-handle]') !== null)).toBe(true);
    expect(row('Content')?.querySelector('[data-blok-database-tab-overflow-handle]')).toBeNull();
  });

  it('keeps the list open on the new order, and the bar shows it once the list closes', async () => {
    await make();
    await customize();
    // Above V1's middle (row 1: 28..56).
    await drag('V3', 30);

    expect(rows().map(rowName)).toEqual(['Content', 'V3', 'V1', 'V2', 'V4']);
    expect(list()).not.toBeNull();

    await closeList();
    await resize(2000);

    expect(shown()).toEqual(['Content', 'V3', 'V1', 'V2', 'V4']);
  });

  it('never drops a view above Content', async () => {
    await make();
    await customize();
    await drag('V2', 2);

    expect(rows().map(rowName)).toEqual(['Content', 'V2', 'V1', 'V3', 'V4']);

    await closeList();
    await resize(2000);

    expect(shown()).toEqual(['Content', 'V2', 'V1', 'V3', 'V4']);
  });

  it('saves nothing until Apply; Apply saves the order', async () => {
    await make();
    await customize();
    await drag('V4', 30);
    await closeList();

    expect(await savedOrder()).toEqual(['tc', 'tv0', 'tv1', 'tv2', 'tv3']);

    await apply();

    expect(await savedOrder()).toEqual(['tc', 'tv3', 'tv0', 'tv1', 'tv2']);
    await resize(2000);
    expect(shown()).toEqual(['Content', 'V4', 'V1', 'V2', 'V3']);
  });

  it('Discard keeps the saved order', async () => {
    await make();
    await customize();
    await drag('V4', 30);
    await closeList();
    await click(builderRoot()?.querySelector('[data-blok-database-layout-cancel]') ?? null);
    // A reorder alone is an edit: Cancel asks first.
    expect(document.querySelector('[data-blok-database-confirm-action="confirm"]')).not.toBeNull();
    await click(document.querySelector('[data-blok-database-confirm-action="confirm"]'));

    expect(builderRoot()).toBeNull();
    expect(await savedOrder()).toEqual(['tc', 'tv0', 'tv1', 'tv2', 'tv3']);
  });

  it('two moves apply as one undo step, and redo puts them back', async () => {
    await make();
    await customize();
    await drag('V4', 30);
    // Now Content, V4, V1, V2, V3: V3 goes above V1 (row 2).
    await drag('V3', 58);

    expect(rows().map(rowName)).toEqual(['Content', 'V4', 'V3', 'V1', 'V2']);

    await closeList();
    await apply();

    expect(await savedOrder()).toEqual(['tc', 'tv3', 'tv2', 'tv0', 'tv1']);

    history().undo();
    await quiet();

    expect(await savedOrder()).toEqual(['tc', 'tv0', 'tv1', 'tv2', 'tv3']);

    history().redo();
    await quiet();

    expect(await savedOrder()).toEqual(['tc', 'tv3', 'tv2', 'tv0', 'tv1']);
  });

  it('a drop back in its own slot is no edit: Cancel closes without asking', async () => {
    await make();
    await customize();
    // V1 (row 1) dragged down and back above V2's middle (row 2).
    rows().forEach((element, index) => {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * ROW, 290, ROW));
    });
    row('V1')?.querySelector('[data-blok-database-tab-overflow-handle]')?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientY: 100 }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientY: 30 }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientY: 30 }));
    await quiet();
    expect(rows().map(rowName)).toEqual(['Content', 'V1', 'V2', 'V3', 'V4']);
    await closeList();
    await click(builderRoot()?.querySelector('[data-blok-database-layout-cancel]') ?? null);

    expect(document.querySelector('[data-blok-database-confirm-action="confirm"]')).toBeNull();
    expect(builderRoot()).toBeNull();
  });

  it('moves a tab made in this draft, in Apply\'s one undo step', async () => {
    await make();
    await openRowPage();
    await click(holder?.querySelector('[data-blok-database-drawer-customize]') ?? null);
    const strip = builderRoot()?.querySelector('[data-blok-database-drawer-tabs]') ?? null;

    strip?.dispatchEvent(new MouseEvent('pointerenter'));
    await click(strip?.querySelector('[data-blok-database-layout-add-tab]') ?? null);
    await click(document.querySelector('[data-blok-testid="database-layout-link-data-source"]'));
    await click(document.querySelector('[data-blok-testid="database-layout-source-db"]'));
    const field = document.querySelector<HTMLInputElement>('[data-blok-testid="database-layout-view-name"]');

    if (field !== null) {
      field.value = 'Fresh';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await click(document.querySelector('[data-blok-testid="database-layout-add-view"]'));
    await resize(330);
    await click(more());
    // Fresh is row 5: up above V1's middle (row 1).
    await drag('Fresh', 30);

    expect(rows().map(rowName)).toEqual(['Content', 'Fresh', 'V1', 'V2', 'V3', 'V4']);

    await closeList();
    await apply();
    const saved = await savedOrder() as string[];
    const fresh = saved[1];

    expect(saved).toEqual(['tc', fresh, 'tv0', 'tv1', 'tv2', 'tv3']);
    expect(fresh).not.toMatch(/^tv/);

    history().undo();
    await quiet();

    expect(await savedOrder()).toEqual(['tc', 'tv0', 'tv1', 'tv2', 'tv3']);

    history().redo();
    await quiet();

    expect(await savedOrder()).toEqual(['tc', fresh, 'tv0', 'tv1', 'tv2', 'tv3']);
  });
});

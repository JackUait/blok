import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * notion-motion.md Round 63 §1 (row 78): a view sort is one undo step. Undo
 * puts the order and the chip back, and the chip bar stays open.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void; canUndo: () => boolean; canRedo: () => boolean };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'x', name: 'Note', type: 'text', position: 'a1' },
      ],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Beta', x: 'b' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', x: 'a' }, position: 'a1' } },
];

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: doc() },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const q = (testId: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${testId}"]`);

const click = (testId: string): void => {
  const el = q(testId);

  if (el === null) throw new Error(`no ${testId}`);
  el.click();
};

const order = (): string[] => [...document.querySelectorAll('[data-blok-database-table-row]')].map((row) => row.getAttribute('data-row-id') ?? '');

const sortByName = async (): Promise<void> => {
  click('database-toolbar-sort');
  click('database-pick-property-t');
  await quiet();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await quiet();
};

describe('view sort undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('undoes a sort add in one step, keeps the chip bar open, and redoes it', async () => {
    const blok = await make();

    expect(order()).toEqual(['r1', 'r2']);
    await sortByName();
    expect(order()).toEqual(['r2', 'r1']);
    expect(q('database-sort-pill')).not.toBeNull();
    expect(blok.history.canUndo()).toBe(true);

    blok.history.undo();
    await quiet();

    expect(order()).toEqual(['r1', 'r2']);
    expect(q('database-sort-pill')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-blok-database-filter-bar]')?.hidden).toBe(false);
    expect(q('database-filter-bar-add')).not.toBeNull();
    expect(blok.history.canUndo()).toBe(false);

    blok.history.redo();
    await quiet();

    expect(order()).toEqual(['r2', 'r1']);
    expect(q('database-sort-pill')).not.toBeNull();
  });

  it('undoes a sort removal, then the add, one step each', async () => {
    const blok = await make();

    click('database-toolbar-sort');
    click('database-pick-property-t');
    await quiet();
    click('database-sort-delete-all');
    await quiet();
    expect(order()).toEqual(['r1', 'r2']);
    expect(q('database-sort-pill')).toBeNull();

    blok.history.undo();
    await quiet();
    expect(order()).toEqual(['r2', 'r1']);
    expect(q('database-sort-pill')).not.toBeNull();

    blok.history.undo();
    await quiet();
    expect(order()).toEqual(['r1', 'r2']);
    expect(q('database-sort-pill')).toBeNull();
  });

  it('undoes only the sort: a filter added after it stays', async () => {
    const blok = await make();

    await sortByName();
    click('database-filter-bar-add');
    click('database-pick-property-x');
    await quiet();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await quiet();
    expect(q('database-sort-pill')).not.toBeNull();
    const filters = (): number => document.querySelectorAll('[data-blok-database-filter-bar] [data-blok-testid^="database-filter-pill"]').length;

    expect(filters()).toBe(1);

    blok.history.undo();
    await quiet();
    expect(q('database-sort-pill')).toBeNull();
    expect(filters()).toBe(1);
  });

  it('keeps a shared view setting one undo step too', async () => {
    const blok = await make();
    const lines = async (): Promise<unknown> => {
      const saved = await blok.save();
      const views = saved.blocks.find((block) => block.id === 'db')?.data.views as Array<Record<string, unknown>>;

      return views[0].showVerticalLines;
    };
    const before = await lines();

    click('database-toolbar-settings');
    click('database-settings-layout');
    click('database-settings-vertical-lines');
    await quiet();
    const after = await lines();

    expect(after).not.toEqual(before);

    blok.history.undo();
    await quiet();
    expect(await lines()).toEqual(before);
  });
});

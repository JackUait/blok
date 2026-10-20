import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * An undo or redo of a database closes every cell editor open over it, on
 * every surface, without writing the editor's draft. Undo moves no focus, so
 * nothing else closes them, and an open editor would show and write back a
 * value the undo just changed.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void; redo: () => void };
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

const SCHEMA = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
  { id: 'n', name: 'Notes', type: 'text', position: 'a2' },
];

const view = (id: string, fields: Record<string, unknown>): Record<string, unknown> => ({
  id, name: id, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['n'], ...fields,
});

const rows: OutputBlockData[] = [
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', s: 'o1', n: 'first' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two', s: 'o1', n: 'second' }, position: 'a1' } },
];

const single = (fields: Record<string, unknown>): OutputBlockData[] => [
  { id: 'db', type: 'database', data: { schema: SCHEMA, views: [view('v', fields)], activeViewId: 'v' }, content: ['r1', 'r2'] },
  ...rows,
];

/** A dashboard in another database block shows this database's table and list. */
const dashboard: OutputBlockData[] = [
  {
    id: 'db', type: 'database', content: ['r1', 'r2'],
    data: { schema: SCHEMA, views: [view('tv', {}), view('lv', { type: 'list', position: 'a1' })], activeViewId: 'tv' },
  },
  ...rows,
  {
    id: 'dash', type: 'database', content: [],
    data: {
      schema: [SCHEMA[0]],
      views: [view('d', { type: 'dashboard', dashboard: { rows: [{ id: 'dr', widgets: [
        { id: 'w-table', databaseId: 'db', viewId: 'tv', width: 6 },
        { id: 'w-list', databaseId: 'db', viewId: 'lv', width: 6 },
      ] }] } })],
      activeViewId: 'd',
    },
  },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const q = (selector: string): HTMLElement | null => holder?.querySelector<HTMLElement>(selector) ?? null;

const click = async (el: Element | null): Promise<void> => {
  if (el === null) throw new Error('nothing to click');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const openEditors = (): number => document.querySelectorAll('[data-blok-database-cell-editor]').length;

const field = (): HTMLInputElement | HTMLTextAreaElement => {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-editor] [data-blok-database-cell-input]');

  if (input === null) throw new Error('no open text editor');

  return input;
};

const type = (text: string): void => {
  const input = field();

  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const enter = async (): Promise<void> => {
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await quiet();
};

const notesOf = async (rowId: string): Promise<unknown> => {
  const saved = await editor?.save();

  return (saved?.blocks.find((block) => block.id === rowId)?.data as { properties?: Record<string, unknown> } | undefined)?.properties?.n;
};

/** Edits r2's notes through `target`, then opens r1's notes editor with an unsaved draft. */
const editThenOpenDraft = async (target: (rowId: string) => HTMLElement | null): Promise<void> => {
  await click(target('r2'));
  type('changed');
  await enter();
  expect(await notesOf('r2')).toBe('changed');

  await click(target('r1'));
  type('draft');
  expect(openEditors()).toBe(1);
};

const tableCell = (root: string) => (rowId: string): HTMLElement | null =>
  q(`${root} [data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="n"]`);
const card = (rowId: string): HTMLElement | null =>
  q(`[data-blok-database-card][data-row-id="${rowId}"] [data-blok-database-card-property][data-property-id="n"]`);
const listRow = (root: string) => (rowId: string): HTMLElement | null =>
  q(`${root} [data-blok-database-list-row][data-row-id="${rowId}"] [data-blok-database-list-row-property][data-property-id="n"]`);
const widget = (id: string): string => `[data-blok-database-dashboard-widget="${id}"]`;

describe('undo and redo close every open cell editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each([
    ['a table cell', single({}), tableCell('')],
    ['a board card', single({ type: 'board', groupBy: 's' }), card],
    ['a list row', single({ type: 'list' }), listRow('')],
    ['a dashboard table widget of another database', dashboard, tableCell(widget('w-table'))],
    ['a dashboard list widget of another database', dashboard, listRow(widget('w-list'))],
  ])('%s: undo closes the editor, drops its draft and shows the undone value', async (_name, blocks, target) => {
    await make(blocks);
    await editThenOpenDraft(target);

    editor?.history.undo();
    await quiet();

    expect(openEditors()).toBe(0);
    expect(await notesOf('r2')).toBe('second');
    expect(await notesOf('r1')).toBe('first');
    expect(target('r2')?.textContent).toContain('second');
  });

  it('the bulk editor of selected table rows: undo closes it without its draft', async () => {
    await make(single({}));
    await click(tableCell('')('r2'));
    type('changed');
    await enter();
    expect(await notesOf('r2')).toBe('changed');
    for (const rowId of ['r1', 'r2']) {
      await click(q(`[data-row-id="${rowId}"] [data-blok-database-table-row-checkbox]`));
    }
    await click(q('[data-blok-database-table-selection-property][data-property-id="n"]'));
    type('draft');
    expect(openEditors()).toBe(1);

    editor?.history.undo();
    await quiet();

    expect(openEditors()).toBe(0);
    expect(await notesOf('r1')).toBe('first');
    expect(await notesOf('r2')).toBe('second');
  });

  it.each([
    ['full page', 'full'],
    ['side peek', 'side'],
  ])('the row page (%s): undo and redo close its property editor', async (_name, mode) => {
    await make(single({ openPagesIn: mode }));
    await click(q('[data-row-id="r1"] [data-blok-database-table-open]'));
    const value = (): HTMLElement | null => q('[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="n"]');

    await click(value());
    type('changed');
    await enter();
    expect(await notesOf('r1')).toBe('changed');

    await click(value());
    type('draft');
    editor?.history.undo();
    await quiet();

    expect(openEditors()).toBe(0);
    expect(await notesOf('r1')).toBe('first');
    expect(value()?.textContent).toContain('first');

    await click(value());
    type('draft');
    editor?.history.redo();
    await quiet();

    expect(openEditors()).toBe(0);
    expect(await notesOf('r1')).toBe('changed');
  });

});

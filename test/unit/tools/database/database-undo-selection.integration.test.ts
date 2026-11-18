import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData } from '../../../../types';

/**
 * notion-motion.md Round 63 §1 (row 78): undoing a row delete selects the
 * row it brings back; undoing a cell edit clears a row selection. A cell
 * selection stays.
 */
interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
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
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', x: 'a' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Beta', x: 'b' }, position: 'a1' } },
  { id: 'r3', type: 'database-row', parent: 'db', data: { properties: { t: 'Gamma', x: 'c' }, position: 'a2' } },
];

if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (type = 'table'): Promise<TestEditor> => {
  const blocks = doc();
  const data = blocks[0].data as { views: Array<Record<string, unknown>> };

  data.views[0] = { ...data.views[0], type, ...(type === 'board' ? { groupBy: 'x' } : {}) };
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const row = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-database-table-row][data-row-id="${id}"]`);
const order = (): string[] => [...document.querySelectorAll('[data-blok-database-table-row]')].map((el) => el.getAttribute('data-row-id') ?? '');
const selectedRows = (): string[] => [...document.querySelectorAll('[data-blok-database-table-row][aria-selected="true"]')].map((el) => el.getAttribute('data-row-id') ?? '');

const pickRow = async (id: string): Promise<void> => {
  row(id)?.querySelector<HTMLElement>('[data-blok-database-table-row-checkbox]')?.click();
  await quiet();
};

const deleteRow = async (blok: TestEditor, id: string): Promise<void> => {
  const at = blok.blocks.getBlockIndex(id);

  if (at === undefined) throw new Error(`no ${id}`);
  await blok.blocks.delete(at);
  await quiet();
};

const editNote = async (blok: TestEditor, id: string, x: string): Promise<void> => {
  const block = blok.blocks.getById(id);

  if (block === null) throw new Error(`no ${id}`);
  const saved = await block.save();
  const data = saved?.data as { properties: Record<string, unknown>; position: string };

  await blok.blocks.update(id, { ...data, properties: { ...data.properties, x } });
  await quiet();
};

describe('row selection after undo', () => {
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

  it('selects the row an undone delete brings back', async () => {
    const blok = await make();

    await deleteRow(blok, 'r2');
    expect(row('r2')).toBeNull();

    blok.history.undo();
    await quiet();

    expect(row('r2')).not.toBeNull();
    expect(selectedRows()).toEqual(['r2']);
  });

  it('clears a row selection when it undoes a cell edit', async () => {
    const blok = await make();

    await editNote(blok, 'r1', 'edited');
    await pickRow('r3');
    expect(selectedRows()).toEqual(['r3']);

    blok.history.undo();
    await quiet();

    expect(row('r1')?.textContent).toContain('a');
    expect(row('r1')?.textContent).not.toContain('edited');
    expect(selectedRows()).toEqual([]);
  });

  // notion-motion.md Round 64 §1: redo of the cell edit fades the row selection back in.
  it('gives the row selection back when it redoes the cell edit', async () => {
    const blok = await make();

    await editNote(blok, 'r1', 'edited');
    await pickRow('r3');
    blok.history.undo();
    await quiet();
    expect(selectedRows()).toEqual([]);

    blok.history.redo();
    await quiet();

    expect(row('r1')?.textContent).toContain('edited');
    expect(selectedRows()).toEqual(['r3']);
  });

  it('keeps a selection made after the undo when it redoes the cell edit', async () => {
    const blok = await make();

    await editNote(blok, 'r1', 'edited');
    await pickRow('r3');
    blok.history.undo();
    await quiet();
    await pickRow('r2');

    blok.history.redo();
    await quiet();

    expect(selectedRows()).toEqual(['r2']);
  });

  // notion-motion.md Round 65 §2 (swap test): undo brings back the selection current when the edit was made; redo the one current at undo.
  it('brings back the row selection the edit was made with, and redo the one undo replaced', async () => {
    const blok = await make();

    await pickRow('r1');
    await editNote(blok, 'r1', 'edited');
    await pickRow('r1');
    await pickRow('r3');
    expect(selectedRows()).toEqual(['r3']);

    blok.history.undo();
    await quiet();

    expect(row('r1')?.textContent).not.toContain('edited');
    expect(selectedRows()).toEqual(['r1']);

    blok.history.redo();
    await quiet();

    expect(row('r1')?.textContent).toContain('edited');
    expect(selectedRows()).toEqual(['r3']);
  });

  it('keeps a row selection that was there when the edit was made', async () => {
    const blok = await make();

    await pickRow('r2');
    await editNote(blok, 'r1', 'edited');

    blok.history.undo();
    await quiet();

    expect(row('r1')?.textContent).not.toContain('edited');
    expect(selectedRows()).toEqual(['r2']);
  });

  it('keeps a row selection when it undoes a reorder', async () => {
    const blok = await make();
    const block = blok.blocks.getById('r1');

    if (block === null) throw new Error('no r1');
    const saved = await block.save();

    await blok.blocks.update('r1', { ...(saved?.data as Record<string, unknown>), position: 'a3' });
    await quiet();
    await pickRow('r3');
    expect(order()).toEqual(['r2', 'r3', 'r1']);
    expect(selectedRows()).toEqual(['r3']);

    blok.history.undo();
    await quiet();

    expect(selectedRows()).toEqual(['r3']);
    expect(order()).toEqual(['r1', 'r2', 'r3']);
  });

  it('drops the restored row from the selection when redo deletes it again', async () => {
    const blok = await make();

    await deleteRow(blok, 'r2');
    blok.history.undo();
    await quiet();
    expect(selectedRows()).toEqual(['r2']);
    expect(document.querySelector('[data-blok-database-table-selection-bar]')).not.toBeNull();

    blok.history.redo();
    await quiet();

    expect(row('r2')).toBeNull();
    expect(document.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
  });

  /** notion-motion.md Round 64 §1: a List row or Gallery card comes back selected, fading in; a Board card does not. */
  const ITEM = {
    list: '[data-blok-database-list-row]',
    gallery: '[data-blok-database-gallery-card]',
    board: '[data-blok-database-card]',
  };
  const picked = (type: keyof typeof ITEM): string[] =>
    [...document.querySelectorAll(`${ITEM[type]}[data-blok-database-row-selected]`)].map((el) => el.getAttribute('data-row-id') ?? '');

  it.each(['list', 'gallery'] as const)('selects the %s item an undone delete brings back, fading it in', async (type) => {
    const blok = await make(type);

    expect(document.querySelector(`${ITEM[type]}[data-row-id="r2"]`)).not.toBeNull();
    await deleteRow(blok, 'r2');
    expect(document.querySelector(`${ITEM[type]}[data-row-id="r2"]`)).toBeNull();

    blok.history.undo();
    await quiet();

    expect(picked(type)).toEqual(['r2']);
    expect(document.querySelector(`${ITEM[type]}[data-row-id="r2"]`)?.hasAttribute('data-blok-database-row-landed')).toBe(true);
  });

  // notion-motion.md Round 65 §2 (List swap): the current pick fades out and the recorded one fades in.
  it('crossfades a List pick back to the row selected when the edit was made', async () => {
    const blok = await make('list');
    const metaClick = async (id: string): Promise<void> => {
      document.querySelector<HTMLElement>(`${ITEM.list}[data-row-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      await quiet();
    };
    const listRow = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`${ITEM.list}[data-row-id="${id}"]`);

    await metaClick('r1');
    await editNote(blok, 'r1', 'edited');
    await metaClick('r1');
    await metaClick('r3');
    expect(picked('list')).toEqual(['r3']);

    blok.history.undo();
    await quiet();

    expect(picked('list')).toEqual(['r1']);
    expect(listRow('r1')?.hasAttribute('data-blok-database-row-landed')).toBe(true);
    expect(listRow('r3')?.hasAttribute('data-blok-database-row-leaving')).toBe(true);

    blok.history.redo();
    await quiet();

    expect(picked('list')).toEqual(['r3']);
  });

  it('does not restart the fade on a List row that stays picked', async () => {
    const blok = await make('list');

    document.querySelector<HTMLElement>(`${ITEM.list}[data-row-id="r2"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    await quiet();
    await editNote(blok, 'r1', 'edited');

    blok.history.undo();
    await quiet();

    expect(picked('list')).toEqual(['r2']);
    expect(document.querySelector(`${ITEM.list}[data-row-id="r2"]`)?.hasAttribute('data-blok-database-row-landed')).toBe(false);
  });

  // notion-motion.md Round 66 §3: a calendar card selected when its edit was made fades back in on undo, and out on redo.
  it('brings back the calendar event picked when the edit was made, fading it in', async () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const blocks = doc();
    const data = blocks[0].data as { schema: Array<Record<string, unknown>>; views: Array<Record<string, unknown>> };

    data.schema.push({ id: 'd', name: 'Date', type: 'date', position: 'a2' });
    data.views[0] = { ...data.views[0], type: 'calendar' };
    blocks.slice(1).forEach((block) => {
      const rowData = block.data as { properties: Record<string, unknown> };

      rowData.properties.d = today;
    });
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks },
    } as never) as unknown as TestEditor;
    const blok = editor;

    await blok.isReady;
    await quiet();
    const event = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-database-calendar-event][data-row-id="${id}"]`);
    const calendarPicked = (): string[] => [...document.querySelectorAll('[data-blok-database-calendar-event][data-blok-database-row-selected]')]
      .map((el) => el.getAttribute('data-row-id') ?? '');

    event('r1')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
    await quiet();
    expect(calendarPicked()).toEqual(['r1']);
    await editNote(blok, 'r1', 'edited');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();
    expect(calendarPicked()).toEqual([]);

    blok.history.undo();
    await quiet();

    expect(calendarPicked()).toEqual(['r1']);
    expect(event('r1')?.hasAttribute('data-blok-database-row-landed')).toBe(true);

    blok.history.redo();
    await quiet();

    expect(calendarPicked()).toEqual([]);
    expect(event('r1')?.hasAttribute('data-blok-database-row-leaving')).toBe(true);
  });

  // notion-motion.md Round 67 §3: Edit property › Text edits at the right-click point; the card stays selected through Escape and undo.
  it('keeps the calendar event selected through an Edit property › Text edit and its undo', async () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const blocks = doc();
    const data = blocks[0].data as { schema: Array<Record<string, unknown>>; views: Array<Record<string, unknown>> };

    data.schema.push({ id: 'd', name: 'Date', type: 'date', position: 'a2' });
    data.views[0] = { ...data.views[0], type: 'calendar' };
    blocks.slice(1).forEach((block) => {
      (block.data as { properties: Record<string, unknown> }).properties.d = today;
    });
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks },
    } as never) as unknown as TestEditor;
    const blok = editor;

    await blok.isReady;
    await quiet();
    const calendarPicked = (): string[] => [...document.querySelectorAll('[data-blok-database-calendar-event][data-blok-database-row-selected]')]
      .map((el) => el.getAttribute('data-row-id') ?? '');
    const note = async (): Promise<unknown> => ((await blok.blocks.getById('r1')?.save())?.data as { properties: Record<string, unknown> }).properties.x;

    document.querySelector('[data-blok-database-calendar-event][data-row-id="r1"]')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
    [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-testid="popover-item-title"]')]
      .find((node) => node.textContent === 'Edit property')?.closest<HTMLElement>('[data-blok-popover-item]')?.click();
    document.querySelector<HTMLElement>('[data-blok-popover-item][data-blok-item-name="database-row-edit-property-x"]')?.click();
    const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-editor] textarea');

    expect(document.querySelector('[data-blok-database-edit-point]')).not.toBeNull();
    if (field === null) throw new Error('no editor');
    field.value = 'edited';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect(await note()).toBe('edited');
    expect(calendarPicked()).toEqual(['r1']);

    blok.history.undo();
    await quiet();

    expect(await note()).toBe('a');
    expect(calendarPicked()).toEqual(['r1']);
  });

  it('selects nothing when undo brings a board card back', async () => {
    const blok = await make('board');

    expect(document.querySelector(`${ITEM.board}[data-row-id="r2"]`)).not.toBeNull();
    await deleteRow(blok, 'r2');
    blok.history.undo();
    await quiet();

    expect(document.querySelector(`${ITEM.board}[data-row-id="r2"]`)).not.toBeNull();
    expect(picked('board')).toEqual([]);
  });
});

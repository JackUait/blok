import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/** Escape in bulk editors (research/31 §4b), on the real tool. */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void };
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

const doc = (view: Record<string, unknown>, date: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
        { id: 'due', name: 'Due', type: 'date', position: 'a2', date },
        { id: 'notes', name: 'Notes', type: 'text', position: 'a3' },
      ],
      views: [{ id: 'v', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['s', 'due', 'notes'], ...view }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', s: 'o1', notes: 'same' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Bravo', s: 'o1', notes: 'same' }, position: 'a1' } },
  { id: 'r3', type: 'database-row', parent: 'db', data: { properties: { t: 'Charlie', s: 'o1' }, position: 'a2' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;

const click = async (el: Element | null, init: MouseEventInit = {}): Promise<void> => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  await quiet();
};

const saved = async (rowId: string): Promise<{ properties?: Record<string, unknown>; reminders?: unknown } | undefined> =>
  (await editor?.save())?.blocks.find((block) => block.id === rowId)?.data;

const escape = async (target: EventTarget = document.activeElement ?? document.body): Promise<void> => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await quiet();
};

const VIEWS = [
  ['table', {}, ''],
  ['board', { type: 'board', groupBy: 's' }, '[data-blok-database-card]'],
  ['list', { type: 'list' }, '[data-blok-database-list-row]'],
] as const;

const selectRows = async (rowSelector: string, ...rowIds: string[]): Promise<void> => {
  for (const rowId of rowIds) {
    if (rowSelector === '') {
      await click(q(`[data-row-id="${rowId}"] [data-blok-database-table-row-checkbox]`));
    } else {
      await click(q(`${rowSelector}[data-row-id="${rowId}"]`), { metaKey: true });
    }
  }
};

const isBoard = (rowSelector: string): boolean => rowSelector === '[data-blok-database-card]';

/** Table and list: the bar's property button. Board: ⌘/, then Edit property › (notion-motion.md Round 12). */
const openBulk = async (rowSelector: string, propertyId: string): Promise<void> => {
  if (!isBoard(rowSelector)) {
    await click(q(`[data-blok-database-table-selection-property][data-property-id="${propertyId}"]`));

    return;
  }
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true, cancelable: true }));
  await quiet();
  const editProperty = [...document.querySelectorAll('[data-blok-popover-opened] [data-blok-testid="popover-item-title"]')]
    .find((node) => node.textContent === 'Edit property')?.closest('[data-blok-popover-item]') ?? null;

  await click(editProperty);
  await click(document.querySelector(`[data-blok-item-name="database-bulk-edit-${propertyId}"]`));
};

const dateInput = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-blok-database-date-input="start"]');

/** Rows still picked: the bar on table and list, the gray cards on a board, which has no bar. */
const picked = (rowSelector: string): boolean => (isBoard(rowSelector)
  ? q('[data-blok-database-row-selected]') !== null
  : q('[data-blok-database-table-selection-bar]') !== null);

describe('Escape in bulk editors (research/31 §4b)', () => {
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

  it.each(VIEWS)('%s: a typed date is saved on Escape, on every row, and the selection stays', async (_name, view, rowSelector) => {
    await make(doc(view));
    await selectRows(rowSelector, 'r1', 'r2', 'r3');
    await openBulk(rowSelector, 'due');
    const input = dateInput();

    if (input === null) throw new Error('no date input');
    input.value = 'Oct 5, 2026';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await escape(input);

    expect([(await saved('r1'))?.properties?.due, (await saved('r2'))?.properties?.due, (await saved('r3'))?.properties?.due])
      .toEqual(['2026-10-05', '2026-10-05', '2026-10-05']);
    expect(picked(rowSelector)).toBe(true);
  });

  it.each(VIEWS)('%s: on empty rows the date opens on today, writes nothing, and Escape writes nothing', async (_name, view, rowSelector) => {
    await make(doc(view));
    await selectRows(rowSelector, 'r1', 'r2');
    await openBulk(rowSelector, 'due');

    expect(dateInput()?.value).not.toBe('');
    expect((await saved('r1'))?.properties?.due).toBeUndefined();

    await escape(dateInput() ?? undefined);

    expect((await saved('r1'))?.properties?.due).toBeUndefined();
    expect((await saved('r2'))?.properties?.due).toBeUndefined();
  });

  it('a typed date saved on Escape, with a default reminder, is one undo step', async () => {
    await make(doc({}, { defaultReminder: '2_days_before' }));
    await selectRows('', 'r1', 'r2');
    await openBulk('', 'due');
    const input = dateInput();

    if (input === null) throw new Error('no date input');
    input.value = 'Oct 5, 2026';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await escape(input);

    expect((await saved('r2'))?.properties?.due).toBe('2026-10-05');
    expect((await saved('r2'))?.reminders).toBeDefined();

    editor?.history.undo();
    await quiet();

    expect([(await saved('r1'))?.properties?.due, (await saved('r2'))?.properties?.due]).toEqual([undefined, undefined]);
    expect([(await saved('r1'))?.reminders, (await saved('r2'))?.reminders]).toEqual([undefined, undefined]);
  });

  it.each(VIEWS)('%s: a Text bulk edit opens on the shared value; Escape keeps the typed text and clears the selection', async (_name, view, rowSelector) => {
    await make(doc(view));
    await selectRows(rowSelector, 'r1', 'r2');
    await openBulk(rowSelector, 'notes');
    const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]');

    if (field === null) throw new Error('no text field');
    expect(field.value).toBe('same');
    field.value = 'sameB';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await escape(field);

    expect([(await saved('r1'))?.properties?.notes, (await saved('r2'))?.properties?.notes]).toEqual(['sameB', 'sameB']);
    expect(picked(rowSelector)).toBe(false);
  });

  it.each(VIEWS)('%s: Select drops a typed option on Escape and keeps the selection; Enter on Create sets every row and clears it', async (_name, view, rowSelector) => {
    await make(doc(view));
    await selectRows(rowSelector, 'r1', 'r2');
    await openBulk(rowSelector, 's');
    const typeQuery = (): HTMLInputElement => {
      const search = document.querySelector<HTMLInputElement>('[data-blok-database-cell-editor] input');

      if (search === null) throw new Error('no select search');
      search.value = 'alpha';
      search.dispatchEvent(new Event('input', { bubbles: true }));

      return search;
    };

    await escape(typeQuery());

    expect([(await saved('r1'))?.properties?.s, (await saved('r2'))?.properties?.s]).toEqual(['o1', 'o1']);
    expect(picked(rowSelector)).toBe(true);

    await openBulk(rowSelector, 's');
    const search = typeQuery();

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    const [first, second] = [(await saved('r1'))?.properties?.s, (await saved('r2'))?.properties?.s];

    expect(first).not.toBe('o1');
    expect(second).toBe(first);
    expect(picked(rowSelector)).toBe(false);
  });

  // research/35 §3: mixed alpha / beta / empty opened on "alpha"; one key gave every row "alphaX".
  it.each(VIEWS)('%s: a Text bulk edit on mixed values opens on the first row\'s value and writes it to every row', async (_name, view, rowSelector) => {
    const blocks = doc(view);

    (blocks[2].data as { properties: Record<string, unknown> }).properties.notes = 'beta';
    await make(blocks);
    await selectRows(rowSelector, 'r1', 'r2', 'r3');
    await openBulk(rowSelector, 'notes');
    const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]');

    if (field === null) throw new Error('no text field');
    expect(field.value).toBe('same');
    field.value = 'sameX';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await escape(field);

    expect([(await saved('r1'))?.properties?.notes, (await saved('r2'))?.properties?.notes, (await saved('r3'))?.properties?.notes])
      .toEqual(['sameX', 'sameX', 'sameX']);
  });

  // The first row is the top one on screen, not the first one ticked.
  it.each(VIEWS)('%s: a Text bulk edit ticked bottom to top opens on the top row\'s value', async (_name, view, rowSelector) => {
    const blocks = doc(view);

    (blocks[2].data as { properties: Record<string, unknown> }).properties.notes = 'beta';
    (blocks[3].data as { properties: Record<string, unknown> }).properties.notes = 'gamma';
    await make(blocks);
    await selectRows(rowSelector, 'r3', 'r2', 'r1');
    await openBulk(rowSelector, 'notes');

    expect(document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]')?.value).toBe('same');
  });

  // research/36 §5: under a Z → A sort the top row is the one sorted first; tick order does not matter.
  it.each(VIEWS.flatMap(([name, view, rowSelector]) => [['r1', 'r3'], ['r3', 'r1']].map((ticked) => [`${name}, ticked ${ticked.join(' then ')}`, view, rowSelector, ticked] as const)))(
    '%s: a Text bulk edit under a Z → A sort opens on the top row\'s value', async (_name, view, rowSelector, ticked) => {
      const blocks = doc({ ...view, sorts: [{ propertyId: 'notes', direction: 'desc' }] });

      (blocks[1].data as { properties: Record<string, unknown> }).properties.notes = 'alpha';
      (blocks[3].data as { properties: Record<string, unknown> }).properties.notes = 'gamma';
      await make(blocks);
      await selectRows(rowSelector, ...ticked);
      await openBulk(rowSelector, 'notes');

      expect(document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]')?.value).toBe('gamma');
    },
  );

  // Opening on the first row's value must not write it over the others when nothing was typed.
  it.each(VIEWS)('%s: a Text bulk edit on mixed values closed without typing changes no row', async (_name, view, rowSelector) => {
    const blocks = doc(view);

    (blocks[2].data as { properties: Record<string, unknown> }).properties.notes = 'beta';
    await make(blocks);
    await selectRows(rowSelector, 'r1', 'r2', 'r3');
    await openBulk(rowSelector, 'notes');
    const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]');

    if (field === null) throw new Error('no text field');
    await escape(field);

    expect([(await saved('r1'))?.properties?.notes, (await saved('r2'))?.properties?.notes, (await saved('r3'))?.properties?.notes])
      .toEqual(['same', 'beta', undefined]);
  });

  // research/35 §3: Enter in a Text bulk edit clears the selection.
  it.each(VIEWS)('%s: Enter in a Text bulk edit clears the selection', async (_name, view, rowSelector) => {
    await make(doc(view));
    await selectRows(rowSelector, 'r1', 'r2');
    await openBulk(rowSelector, 'notes');
    const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]');

    if (field === null) throw new Error('no text field');
    field.value = 'other';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect((await saved('r2'))?.properties?.notes).toBe('other');
    expect(picked(rowSelector)).toBe(false);
  });

  it.each(VIEWS)('%s: one undo takes a bulk Text edit, and a bulk Select Create, back on every row', async (_name, view, rowSelector) => {
    await make(doc(view));
    await selectRows(rowSelector, 'r1', 'r2');
    await openBulk(rowSelector, 'notes');
    const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]');

    if (field === null) throw new Error('no text field');
    field.value = 'other';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await escape(field);
    editor?.history.undo();
    await quiet();

    expect([(await saved('r1'))?.properties?.notes, (await saved('r2'))?.properties?.notes]).toEqual(['same', 'same']);

    await selectRows(rowSelector, 'r1', 'r2');
    await openBulk(rowSelector, 's');
    const search = document.querySelector<HTMLInputElement>('[data-blok-database-cell-editor] input');

    if (search === null) throw new Error('no select search');
    search.value = 'alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();
    expect((await saved('r1'))?.properties?.s).not.toBe('o1');
    editor?.history.undo();
    await quiet();

    expect([(await saved('r1'))?.properties?.s, (await saved('r2'))?.properties?.s]).toEqual(['o1', 'o1']);
    const schema = ((await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as { schema?: Array<{ id: string; config?: { options?: Array<{ label: string }> } }> } | undefined)?.schema;

    expect(schema?.find((p) => p.id === 's')?.config?.options?.map((option) => option.label)).toEqual(['Todo']);
  });
});

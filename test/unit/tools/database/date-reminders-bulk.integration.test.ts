import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * Bulk edit of a date (research/21 §6): the picker has Remind, and the
 * property's Notifications default lands on every selected row.
 */

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

/** As measured: Alpha and Delta already have dates and no reminder. */
const doc = (view: Record<string, unknown>, date: Record<string, unknown> = {}, r3: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
        { id: 'due', name: 'Due', type: 'date', position: 'a2', date },
      ],
      views: [{ id: 'v', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['due'], ...view }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', s: 'o1', due: '2026-10-12' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Delta', s: 'o1', due: '2026-10-27' }, position: 'a1' } },
  { id: 'r3', type: 'database-row', parent: 'db', data: { properties: { t: 'Echo', s: 'o1', due: null }, position: 'a2', ...r3 } },
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

const savedRow = async (rowId: string): Promise<{ properties?: Record<string, unknown>; reminders?: unknown } | undefined> => {
  const saved = await editor?.save();

  return saved?.blocks.find((block) => block.id === rowId)?.data;
};

const remindersOf = async (rowId: string): Promise<unknown> => (await savedRow(rowId))?.reminders;

const remindValue = (): string | null | undefined => document.querySelector('[data-blok-database-date-remind-value]')?.textContent;

const pick = async (option: string): Promise<void> => {
  await click(document.querySelector('[data-blok-database-date-remind]'));
  await click(document.querySelector(`[data-blok-database-date-remind-option="${option}"]`));
};

const pickDay = async (day: string): Promise<void> => {
  await click(document.querySelector(`[data-blok-database-date-day="${day}"]`));
};

/** Any day on the grid the picker opens on (this month). */
const someDay = (): string => document.querySelector('[data-blok-database-date-day]')?.getAttribute('data-blok-database-date-day') ?? '';

const escape = async (): Promise<void> => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await quiet();
};

const selectTableRows = async (...rowIds: string[]): Promise<void> => {
  for (const rowId of rowIds) {
    await click(q(`[data-row-id="${rowId}"] [data-blok-database-table-row-checkbox]`));
  }
};

const openBulkDue = async (): Promise<void> => {
  await click(q('[data-blok-database-table-selection-property][data-property-id="due"]'));
};

const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('bulk edit of a date: Remind and the property default', () => {
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

  it('table: the bulk picker shows the default, and setting a date gives every selected row the reminder', async () => {
    await make(doc({}, { defaultReminder: '2_days_before' }));
    await selectTableRows('r1', 'r2');
    await openBulkDue();

    expect(remindValue()).toBe('2 days before');

    const day = someDay();

    await pickDay(day);

    expect(await remindersOf('r1')).toEqual({ due: { remind: '2_days_before', timeZone: zone } });
    expect(await remindersOf('r2')).toEqual({ due: { remind: '2_days_before', timeZone: zone } });
    expect((await savedRow('r1'))?.properties?.due).toBe(day);
    expect(await remindersOf('r3')).toBeUndefined();
  });

  it('table: with no default the picker shows None, and a pick goes onto every selected row with the setter\'s zone', async () => {
    await make(doc({}));
    await selectTableRows('r1', 'r2');
    await openBulkDue();

    expect(remindValue()).toBe('None');

    await pick('1_day_before');
    await pickDay(someDay());

    expect(await remindersOf('r1')).toEqual({ due: { remind: '1_day_before', timeZone: zone } });
    expect(await remindersOf('r2')).toEqual({ due: { remind: '1_day_before', timeZone: zone } });
  });

  it('table: with no default and no pick, a bulk date writes no reminder', async () => {
    await make(doc({}));
    await selectTableRows('r1', 'r3');
    await openBulkDue();
    await pickDay(someDay());

    expect(await remindersOf('r1')).toBeUndefined();
    expect(await remindersOf('r3')).toBeUndefined();
  });

  it('table: a pick made before the date lands with the date', async () => {
    await make(doc({}, { defaultReminder: '2_days_before' }));
    await selectTableRows('r1', 'r3');
    await openBulkDue();
    await pick('1_week_before');

    expect(await remindersOf('r1')).toBeUndefined();

    await pickDay(someDay());

    expect(await remindersOf('r1')).toEqual({ due: { remind: '1_week_before', timeZone: zone } });
    expect(await remindersOf('r3')).toEqual({ due: { remind: '1_week_before', timeZone: zone } });
  });

  it('table: the default never replaces a row\'s own reminder', async () => {
    await make(doc({}, { defaultReminder: '2_days_before' }, { reminders: { due: { remind: 'on_day_of_event', timeZone: 'UTC' } } }));
    await selectTableRows('r1', 'r3');
    await openBulkDue();
    await pickDay(someDay());

    expect(await remindersOf('r1')).toEqual({ due: { remind: '2_days_before', timeZone: zone } });
    expect(await remindersOf('r3')).toEqual({ due: { remind: 'on_day_of_event', timeZone: 'UTC' } });
  });

  it('table: Escape writes nothing', async () => {
    await make(doc({}, { defaultReminder: '2_days_before' }));
    await selectTableRows('r1', 'r2');
    await openBulkDue();
    await escape();

    expect(await remindersOf('r1')).toBeUndefined();
    expect(await remindersOf('r2')).toBeUndefined();
    expect((await savedRow('r1'))?.properties?.due).toBe('2026-10-12');
  });

  it('table: one undo takes back the dates and the reminders together', async () => {
    await make(doc({}, { defaultReminder: '2_days_before' }));
    await selectTableRows('r1', 'r2');
    await openBulkDue();
    await pickDay(someDay());
    await escape();
    editor?.history.undo();
    await quiet();

    expect((await savedRow('r1'))?.properties?.due).toBe('2026-10-12');
    expect(await remindersOf('r1')).toBeUndefined();
    expect(await remindersOf('r2')).toBeUndefined();
  });

  it.each([
    ['board', { type: 'board', groupBy: 's' }, '[data-blok-database-card]'],
    ['list', { type: 'list' }, '[data-blok-database-list-row]'],
  ])('%s: the bulk picker applies the default and a pick to every selected row', async (_name, view, rowSelector) => {
    await make(doc(view, { defaultReminder: '2_days_before' }));
    await click(q(`${rowSelector}[data-row-id="r1"]`), { metaKey: true });
    await click(q(`${rowSelector}[data-row-id="r2"]`), { metaKey: true });
    await openBulkDue();

    expect(remindValue()).toBe('2 days before');

    await pickDay(someDay());

    expect(await remindersOf('r1')).toEqual({ due: { remind: '2_days_before', timeZone: zone } });
    expect(await remindersOf('r2')).toEqual({ due: { remind: '2_days_before', timeZone: zone } });

    await pick('1_day_before');

    expect(await remindersOf('r1')).toEqual({ due: { remind: '1_day_before', timeZone: zone } });
    expect(await remindersOf('r2')).toEqual({ due: { remind: '1_day_before', timeZone: zone } });
  });

  it('table paste stays as it was (unmeasured): a pasted date brings no default reminder', async () => {
    await make(doc({}, { defaultReminder: '2_days_before' }));
    await click(q('[data-row-id="r3"] [role="gridcell"][data-property-id="due"]'));
    await escape();
    const paste = new Event('paste', { bubbles: true, cancelable: true });

    Object.defineProperty(paste, 'clipboardData', { value: { getData: (format: string): string => format === 'text/plain' ? '2027-06-20' : '', types: ['text/plain'] } });
    q('[role="grid"]')?.dispatchEvent(paste);
    await quiet();

    expect((await savedRow('r3'))?.properties?.due).toBe('2027-06-20');
    expect(await remindersOf('r3')).toBeUndefined();
  });
});

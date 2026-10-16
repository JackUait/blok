import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * The Remind row outside the table: board cards, list rows and the row page
 * (full page and side peek) open the same date picker.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
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

const doc = (view: Record<string, unknown>, date: Record<string, unknown> = {}): OutputBlockData[] => [
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
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', s: 'o1', due: '2027-06-15' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two', s: 'o1', due: null }, position: 'a1' } },
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

const click = async (el: Element | null): Promise<void> => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const remindersOf = async (rowId: string): Promise<unknown> => {
  const saved = await editor?.save();

  return (saved?.blocks.find((block) => block.id === rowId)?.data as { reminders?: unknown } | undefined)?.reminders;
};

const remindRow = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-date-remind]');

const pick = async (option: string): Promise<void> => {
  await click(remindRow());
  await click(document.querySelector(`[data-blok-database-date-remind-option="${option}"]`));
};

const closeEditor = async (): Promise<void> => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await quiet();
};

const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('date reminders outside the table', () => {
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
    ['a board card', { type: 'board', groupBy: 's' }, '[data-blok-database-card][data-row-id="r1"] [data-blok-database-card-property][data-property-id="due"]'],
    ['a list row', { type: 'list' }, '[data-blok-database-list-row][data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="due"]'],
  ])('%s: Remind saves on the row and the picker shows it when opened again', async (_name, view, selector) => {
    await make(doc(view));
    await click(q(selector));
    expect(remindRow()).not.toBeNull();

    await pick('1_day_before');
    expect(await remindersOf('r1')).toEqual({ due: { remind: '1_day_before', timeZone: zone } });
    await closeEditor();

    await click(q(selector));
    expect(document.querySelector('[data-blok-database-date-remind-value]')?.textContent).toBe('1 day before');
  });

  it.each([
    ['full page', 'full'],
    ['side peek', 'side'],
  ])('the row page (%s): Remind saves on the row and the picker shows it when opened again', async (_name, mode) => {
    await make(doc({ openPagesIn: mode }));
    await click(q('[data-row-id="r1"] [data-blok-database-table-open]'));
    const value = (): HTMLElement | null => q('[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="due"]');

    await click(value());
    expect(remindRow()).not.toBeNull();

    await pick('2_days_before');
    expect(await remindersOf('r1')).toEqual({ due: { remind: '2_days_before', timeZone: zone } });
    await closeEditor();

    await click(value());
    expect(document.querySelector('[data-blok-database-date-remind-value]')?.textContent).toBe('2 days before');
  });

  it('the row page: after Clear, the picker shows no reminder and a new date stores none', async () => {
    await make(doc({ openPagesIn: 'side' }));
    await click(q('[data-row-id="r1"] [data-blok-database-table-open]'));
    const value = (): HTMLElement | null => q('[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="due"]');

    await click(value());
    await pick('1_day_before');
    await click(document.querySelector('[data-blok-database-date-clear]'));
    await quiet();
    expect(await remindersOf('r1')).toBeUndefined();

    await click(value());
    expect(document.querySelector('[data-blok-database-date-remind-value]')?.textContent).toBe('None');
    await click(document.querySelector('[data-blok-database-date-day]'));
    expect(await remindersOf('r1')).toBeUndefined();
  });

  it('a template opened as a page takes a reminder, and Clear drops it', async () => {
    const blocks = doc({ openPagesIn: 'side' });

    (blocks[0].content as string[]).push('tpl');
    blocks.push({ id: 'tpl', type: 'database-row', parent: 'db', data: { properties: { t: 'Tpl', due: '2027-06-15' }, position: 'a2', template: true } });
    await make(blocks);
    const tool = (editor as unknown as { blocks: { getById: (id: string) => { call: (method: string, arg: unknown) => void } | undefined } }).blocks;

    tool.getById('db')?.call('openTemplate', 'tpl');
    await quiet();
    const value = (): HTMLElement | null => q('[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="due"]');

    await click(value());
    await pick('1_day_before');
    expect(await remindersOf('tpl')).toEqual({ due: { remind: '1_day_before', timeZone: zone } });

    await click(document.querySelector('[data-blok-database-date-clear]'));
    await quiet();
    const saved = await editor?.save();

    expect((saved?.blocks.find((block) => block.id === 'tpl')?.data as { properties: Record<string, unknown> }).properties.due).toBeNull();
    expect(await remindersOf('tpl')).toBeUndefined();
  });

  it('the row page: a reminder set in the table shows in the open page\'s picker', async () => {
    await make(doc({ openPagesIn: 'side' }));
    await click(q('[data-row-id="r1"] [data-blok-database-table-open]'));
    await click(q('[data-row-id="r1"] [role="gridcell"][data-property-id="due"]'));
    await pick('1_week_before');
    await closeEditor();
    expect(await remindersOf('r1')).toEqual({ due: { remind: '1_week_before', timeZone: zone } });

    await click(q('[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="due"]'));
    expect(document.querySelector('[data-blok-database-date-remind-value]')?.textContent).toBe('1 week before');
  });

  it('the row page: a first date takes the property\'s Notifications default', async () => {
    await make(doc({ openPagesIn: 'side' }, { defaultReminder: '1_week_before' }));
    await click(q('[data-row-id="r2"] [data-blok-database-table-open]'));
    await click(q('[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="due"]'));
    await click(document.querySelector('[data-blok-database-date-day]'));

    expect(await remindersOf('r2')).toEqual({ due: { remind: '1_week_before', timeZone: zone } });
  });
});

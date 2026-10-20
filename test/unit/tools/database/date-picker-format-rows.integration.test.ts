import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * The date picker's Date format row (notion-measure12/17-date-edit) writes the
 * property from every surface that opens the picker, as the property menu
 * would, and only where that menu could.
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

const doc = (view: Record<string, unknown>, date: Record<string, unknown> = {}, locked = false): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0', ...(locked ? { databaseLocked: true } : {}) },
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

const dueSettings = async (): Promise<unknown> => {
  const saved = await editor?.save();
  const schema = (saved?.blocks.find((block) => block.id === 'db')?.data as { schema?: Array<{ id: string; date?: unknown }> } | undefined)?.schema;

  return schema?.find((property) => property.id === 'due')?.date;
};

const formatRow = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-date-setting="dateFormat"]');

const pickFormat = async (format: string): Promise<void> => {
  await click(formatRow());
  await click(document.querySelector(`[data-blok-database-date-setting-option="${format}"]`));
};

const closeEditor = async (): Promise<void> => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await quiet();
};

const CARD = '[data-blok-database-card][data-row-id="r1"] [data-blok-database-card-property][data-property-id="due"]';

describe('date picker format rows', () => {
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

  it('a board card: the pick saves on the property, keeps Notifications, and the card shows it after closing', async () => {
    await make(doc({ type: 'board', groupBy: 's' }, { defaultReminder: '1_day_before' }));
    await click(q(CARD));
    await pickFormat('year_month_day');

    expect(await dueSettings()).toEqual({ defaultReminder: '1_day_before', dateFormat: 'year_month_day' });
    expect(document.querySelector('[data-blok-database-date-editor]')).not.toBeNull();
    await closeEditor();
    expect(q(CARD)?.textContent).toContain('2027/06/15');
  });

  it('the row page: the pick saves and the value shows in the new format after closing', async () => {
    await make(doc({ openPagesIn: 'side' }));
    await click(q('[data-row-id="r1"] [data-blok-database-table-open]'));
    const value = (): HTMLElement | null => q('[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="due"]');

    await click(value());
    await pickFormat('day_month_year');

    expect(await dueSettings()).toEqual({ dateFormat: 'day_month_year' });
    await closeEditor();
    expect(value()?.textContent).toContain('15/06/2027');
  });

  it('a locked database: no format rows, as its property menu cannot open either', async () => {
    await make(doc({ type: 'board', groupBy: 's' }, {}, true));
    await click(q(CARD));

    expect(document.querySelector('[data-blok-database-date-editor]')).not.toBeNull();
    expect(formatRow()).toBeNull();
  });
});

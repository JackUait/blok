import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

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

const doc = (options: { layoutFullWidth?: boolean; r1?: Record<string, unknown>; mode?: string } = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', ...(options.layoutFullWidth === true ? { pageLayoutFullWidth: true } : {}) }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], openPagesIn: options.mode ?? 'full' }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0', ...options.r1 } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[], readOnly = false): Promise<void> => {
  editor = new Blok({
    holder,
    readOnly,
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

const openRow = (rowId: string): Promise<void> =>
  click(q(`[data-row-id="${rowId}"] [data-blok-database-table-open]`));

const drawer = (): HTMLElement | null => q('[data-blok-database-drawer]');

const openActions = (): Promise<void> => click(q('[data-blok-database-peek-actions]'));

const menuItem = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-popover-opened] [data-blok-item-name="${name}"]`);

const fullWidthSwitch = (): HTMLElement | null => menuItem('database-row-full-width')?.querySelector<HTMLElement>('[role="switch"]') ?? null;

const rowData = async (): Promise<Map<string, Record<string, unknown>>> => {
  const saved = await editor?.save();

  return new Map((saved?.blocks ?? []).filter((block) => block.type === 'database-row').map((block) => [block.id ?? '', block.data]));
};

describe('row page Actions menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('lists Copy link, Duplicate, Move to Trash, Full width and Customize layout, in Notion\'s order', async () => {
    await make(doc());
    await openRow('r1');
    const button = q('[data-blok-database-peek-actions]');

    // feel/findings-rowpage R06: Notion's name for the button.
    expect(button?.getAttribute('aria-label')).toBe('Page settings & actions');
    await openActions();

    const names = [...document.querySelectorAll('[data-blok-popover-opened] [data-blok-item-name]')].map((item) => item.getAttribute('data-blok-item-name'));

    expect(names).toEqual(['database-row-copy-link', 'database-row-duplicate', 'database-row-delete', 'database-row-full-width', 'row-page-customize-layout']);
  });

  it('turns Full width on for this page only: its row saves it and only its full page widens', async () => {
    await make(doc());
    await openRow('r1');
    expect(drawer()?.hasAttribute('data-full-width')).toBe(false);
    await openActions();
    expect(fullWidthSwitch()?.getAttribute('aria-checked')).toBe('false');

    await click(fullWidthSwitch());

    expect(drawer()?.hasAttribute('data-full-width')).toBe(true);
    const rows = await rowData();

    expect(rows.get('r1')?.fullWidth).toBe(true);
    expect(rows.get('r2')?.fullWidth).toBeUndefined();

    await click(q('[data-blok-database-peek-next]'));
    expect(drawer()?.hasAttribute('data-full-width')).toBe(false);
  });

  it('lets a page\'s own Full width off override a Full width layout, and shows the layout\'s value on the others', async () => {
    await make(doc({ layoutFullWidth: true, r1: { fullWidth: false } }));
    await openRow('r1');
    expect(drawer()?.hasAttribute('data-full-width')).toBe(false);
    await openActions();
    expect(fullWidthSwitch()?.getAttribute('aria-checked')).toBe('false');

    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());
    await click(q('[data-blok-database-peek-next]'));
    expect(drawer()?.hasAttribute('data-full-width')).toBe(true);
    await openActions();
    expect(fullWidthSwitch()?.getAttribute('aria-checked')).toBe('true');
  });

  it('drops the page\'s own value when the switch goes back to the layout\'s width', async () => {
    await make(doc({ layoutFullWidth: true }));
    await openRow('r1');
    await openActions();

    await click(fullWidthSwitch());
    expect((await rowData()).get('r1')?.fullWidth).toBe(false);
    await click(fullWidthSwitch());

    expect('fullWidth' in ((await rowData()).get('r1') ?? {})).toBe(false);
    expect(drawer()?.hasAttribute('data-full-width')).toBe(true);
  });

  it('duplicates the page with its own full width', async () => {
    await make(doc({ r1: { fullWidth: true } }));
    await openRow('r1');
    await openActions();
    await click(menuItem('database-row-duplicate'));

    const rows = await rowData();
    const copy = [...rows.entries()].find(([id]) => id !== 'r1' && id !== 'r2');

    expect(rows.size).toBe(3);
    expect(copy?.[1].fullWidth).toBe(true);
  });

  it('duplicates the page with its date reminder, ready to remind again', async () => {
    const blocks = doc({ r1: { properties: { t: 'One', due: '2027-06-15' }, reminders: { due: { remind: '1_day_before', timeZone: 'Europe/Berlin', sentFor: '2027-06-14T07:00:00.000Z' } } } });
    const database = blocks[0].data as { schema: unknown[] };

    database.schema.push({ id: 'due', name: 'Due', type: 'date', position: 'a1' });
    await make(blocks);
    await openRow('r1');
    await openActions();
    await click(menuItem('database-row-duplicate'));

    const copy = [...(await rowData()).entries()].find(([id]) => id !== 'r1' && id !== 'r2');

    expect(copy?.[1].reminders).toEqual({ due: { remind: '1_day_before', timeZone: 'Europe/Berlin' } });
  });

  it('moves the page to another database of the document from Move to', async () => {
    const other: OutputBlockData[] = [
      {
        id: 'db2',
        type: 'database',
        data: {
          schema: [{ id: 'n', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: 'v2', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'v2',
          title: 'Projects',
        },
        content: [],
      },
    ];

    await make([...doc(), ...other]);
    await openRow('r1');
    await openActions();
    const moveTo = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-popover-item]')]
      .find((item) => (item.textContent?.includes('Move to')) && !item.textContent.includes('Trash')) ?? null;

    await click(moveTo);
    await click(document.querySelector('[data-blok-item-name="database-row-move-to-db2"]'));

    const saved = await editor?.save();

    expect(saved?.blocks.find((block) => block.id === 'r1')?.parent).toBe('db2');
  });

  it('moves the page to the trash and closes it', async () => {
    await make(doc());
    await openRow('r1');
    await openActions();
    await click(menuItem('database-row-delete'));

    expect([...(await rowData()).keys()]).toEqual(['r2']);
    expect(drawer()?.hasAttribute('data-open') ?? false).toBe(false);
  });

  it('gives a read-only viewer Copy link only', async () => {
    await make(doc(), true);
    await openRow('r1');
    await openActions();

    const names = [...document.querySelectorAll('[data-blok-popover-opened] [data-blok-item-name]')].map((item) => item.getAttribute('data-blok-item-name'));

    expect(names).toEqual(['database-row-copy-link']);
  });

  it('closes only the Actions menu on the first Escape, and the peek on the second', async () => {
    await make(doc({ mode: 'side' }));
    await openRow('r1');
    const trigger = q('[data-blok-database-peek-actions]');

    await click(trigger);
    trigger?.focus();
    expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();

    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    expect(drawer()?.hasAttribute('data-open')).toBe(true);

    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect(drawer()?.hasAttribute('data-open') ?? false).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData } from '../../../../types';

/**
 * research/21 §6: a date with a reminder shows the alarm (and turns blue) in every
 * view that shows the date. The calendar shows it only when Due is visible on cards.
 */

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

// The calendar and timeline open on today, so the date sits in the current month.
const now = new Date();
const due = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;

const doc = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
        { id: 'due', name: 'Due', type: 'date', position: 'a2' },
      ],
      views: [{ id: 'v', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], ...view }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', s: 'o1', due }, reminders: { due: { remind: '1_day_before' } }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two', s: 'o1', due }, position: 'a1' } },
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
  } as never);
  await editor.isReady;
  await quiet();
};

const alarmIn = (scope: string, rowId: string): HTMLElement | null =>
  holder?.querySelector<HTMLElement>(`${scope}[data-row-id="${rowId}"] [data-blok-database-cell="date"][data-reminder] [data-blok-database-date-reminder]`) ?? null;

const dateIn = (scope: string, rowId: string): HTMLElement | null =>
  holder?.querySelector<HTMLElement>(`${scope}[data-row-id="${rowId}"] [data-blok-database-cell="date"]`) ?? null;

describe('the reminder alarm in every view that shows the date', () => {
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
    ['a board card', { type: 'board', groupBy: 's', visibleProperties: ['due'] }, '[data-blok-database-card]'],
    ['a list row', { type: 'list', visibleProperties: ['due'] }, '[data-blok-database-list-row]'],
    ['a gallery card', { type: 'gallery', visibleProperties: ['due'] }, '[data-blok-database-gallery-card]'],
    ['a timeline bar', { type: 'timeline', visibleProperties: ['due'] }, '[data-blok-database-timeline-bar]'],
    ['a timeline table row', { type: 'timeline', showTimelineTable: true, tableProperties: [{ id: 'due', visible: true }] }, '[data-blok-database-timeline-table-row]'],
    ['a calendar event with Due shown', { type: 'calendar', visibleProperties: ['due'] }, '[data-blok-database-calendar-event]'],
  ])('%s: the date with a reminder carries the alarm, the one without does not', async (_name, view, scope) => {
    await make(doc(view));

    expect(alarmIn(scope, 'r1')).not.toBeNull();
    expect(alarmIn(scope, 'r1')?.querySelector('svg')).not.toBeNull();
    expect(dateIn(scope, 'r2')).not.toBeNull();
    expect(dateIn(scope, 'r2')?.hasAttribute('data-reminder')).toBe(false);
  });

  it('a title-only calendar event has no alarm', async () => {
    await make(doc({ type: 'calendar', visibleProperties: [] }));

    expect(holder?.querySelector('[data-blok-database-calendar-event][data-row-id="r1"]')).not.toBeNull();
    expect(holder?.querySelector('[data-blok-database-date-reminder]')).toBeNull();
  });

  describe('the row page', () => {
    const click = async (el: Element | null): Promise<void> => {
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await quiet();
    };
    const pageValue = (): HTMLElement | null =>
      holder?.querySelector<HTMLElement>('[data-blok-database-drawer] [data-blok-database-drawer-prop-value][data-property-id="due"]') ?? null;
    const pageAlarm = (): Element | null =>
      pageValue()?.querySelector('[data-blok-database-cell="date"][data-reminder] [data-blok-database-date-reminder]') ?? null;
    const openPage = async (mode: string, rowId: string): Promise<void> => {
      await make(doc({ type: 'table', openPagesIn: mode }));
      await click(holder?.querySelector(`[data-row-id="${rowId}"] [data-blok-database-table-open]`) ?? null);
    };
    const closeEditor = async (): Promise<void> => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await quiet();
    };

    it.each([['side peek', 'side'], ['center peek', 'center'], ['full page', 'full']])(
      '%s: the date with a reminder carries the alarm, as in the table',
      async (_name, mode) => {
        await openPage(mode, 'r1');

        expect(pageAlarm()).not.toBeNull();
        expect(pageAlarm()?.querySelector('svg')).not.toBeNull();
      }
    );

    it('a date with no reminder shows none', async () => {
      await openPage('side', 'r2');

      expect(pageValue()?.querySelector('[data-blok-database-cell="date"]')).not.toBeNull();
      expect(pageValue()?.querySelector('[data-reminder]')).toBeNull();
    });

    it('a reminder picked in the editor shows the alarm once it closes', async () => {
      await openPage('side', 'r2');
      await click(pageValue());
      await click(document.querySelector('[data-blok-database-date-remind]'));
      await click(document.querySelector('[data-blok-database-date-remind-option="1_day_before"]'));
      await closeEditor();

      expect(pageAlarm()).not.toBeNull();
    });

    it('a cleared date shows no alarm', async () => {
      await openPage('side', 'r1');
      await click(pageValue());
      await click(document.querySelector('[data-blok-database-date-clear]'));
      await closeEditor();

      expect(pageValue()?.querySelector('[data-blok-database-cell="date"][data-empty]')).not.toBeNull();
      expect(pageValue()?.querySelector('[data-blok-database-date-reminder]')).toBeNull();
    });
  });
});

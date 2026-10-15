import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'due', name: 'Due', type: 'date', position: 'a1', date: { timeZone: 'America/New_York' } },
];

const data = (): DatabaseData => ({
  schema,
  views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['due'] }],
  activeViewId: 'v',
});

type DueInput = { rowId: string; propertyId: string; remind: string; dueAt: string; markSent: () => void };

describe('date reminders reach the host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-06-14T13:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
  });

  it('offers a reminder whose time has come, and markSent stamps that due time', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-15' }, reminders: { due: { remind: '1_day_before' } } }),
      rowSeed('r2', 'db', { properties: { title: 'Later', due: '2027-06-20' }, reminders: { due: { remind: '1_day_before' } } }),
    ]);
    const onReminderDue = vi.fn();

    buildDatabase(doc, 'db', data(), { reminders: { onReminderDue } });

    expect(onReminderDue).toHaveBeenCalledTimes(1);
    const call = onReminderDue.mock.calls[0][0] as DueInput;

    expect(call).toMatchObject({ rowId: 'r1', propertyId: 'due', remind: '1_day_before', dueAt: '2027-06-14T13:00:00.000Z' });
    call.markSent();
    expect(doc.row('r1').reminders?.due).toEqual({ remind: '1_day_before', sentFor: '2027-06-14T13:00:00.000Z' });
  });

  it('does not offer a reminder the host already sent', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-15' }, reminders: { due: { remind: '1_day_before', sentFor: '2027-06-14T13:00:00.000Z' } } }),
    ]);
    const onReminderDue = vi.fn();

    buildDatabase(doc, 'db', data(), { reminders: { onReminderDue } });

    expect(onReminderDue).not.toHaveBeenCalled();
  });

  it('never offers a template\'s reminder', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('tpl', 'db', { properties: { title: 'Tpl', due: '2027-06-15' }, template: true, reminders: { due: { remind: '1_day_before' } } }),
    ]);
    const onReminderDue = vi.fn();

    buildDatabase(doc, 'db', data(), { reminders: { onReminderDue } });

    expect(onReminderDue).not.toHaveBeenCalled();
  });

  it('a Remind pick in a table cell lands on the row block as one stored reminder', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-20' } }),
    ]);
    const { el } = buildDatabase(doc, 'db', data());
    const cell = el.querySelector<HTMLElement>('[data-row-id="r1"] [role="gridcell"][data-property-id="due"]');

    cell?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.querySelector<HTMLElement>('[data-blok-database-date-remind]')?.click();
    document.querySelector<HTMLElement>('[data-blok-database-date-remind-option="1_week_before"]')?.click();

    expect(doc.row('r1').reminders).toEqual({ due: { remind: '1_week_before' } });
    document.querySelector<HTMLElement>('[data-blok-database-date-remind]')?.click();
    document.querySelector<HTMLElement>('[data-blok-database-date-remind-option="none"]')?.click();
    expect(doc.row('r1').reminders).toBeUndefined();
  });

  it('Clear drops the date and its reminder in one row write', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-20' }, reminders: { due: { remind: '1_day_before' } } }),
    ]);
    const { el } = buildDatabase(doc, 'db', data());
    const block = doc.blocks.get('r1')?.block;
    const before = vi.mocked(block?.dispatchChange ?? vi.fn()).mock.calls.length;

    el.querySelector<HTMLElement>('[data-row-id="r1"] [role="gridcell"][data-property-id="due"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.querySelector<HTMLElement>('[data-blok-database-date-clear]')?.click();

    expect(doc.row('r1').properties.due).toBeNull();
    expect(doc.row('r1').reminders).toBeUndefined();
    expect(vi.mocked(block?.dispatchChange ?? vi.fn()).mock.calls.length - before).toBe(1);
  });
});

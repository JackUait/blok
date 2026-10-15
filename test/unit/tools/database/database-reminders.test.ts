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

    expect(doc.row('r1').reminders).toEqual({ due: { remind: '1_week_before', timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone } });
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

describe('a reminder on a date with no time zone, seen from two zones', () => {
  const zoneless: PropertyDefinition[] = [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'due', name: 'Due', type: 'date', position: 'a1' },
  ];
  const zonelessData = (): DatabaseData => ({ ...data(), schema: zoneless });
  const originalZone = process.env.TZ;

  /**
   * A client in `zone`: renders the database and returns what it offered.
   * Fresh modules, as in another browser: the date code caches the viewer's zone.
   */
  const client = async (doc: ReturnType<typeof makeDoc>, zone: string): Promise<{ offered: DueInput[]; tool: { destroy: () => void } }> => {
    process.env.TZ = zone;
    vi.resetModules();
    const fresh = await import('./structure-harness');
    const onReminderDue = vi.fn();
    const { tool } = fresh.buildDatabase(doc, 'db', zonelessData(), { reminders: { onReminderDue } });

    return { offered: onReminderDue.mock.calls.map((call) => call[0] as DueInput), tool };
  };

  const pickRemind = (option: string): void => {
    document.querySelector<HTMLElement>('[data-row-id="r1"] [role="gridcell"][data-property-id="due"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.querySelector<HTMLElement>('[data-blok-database-date-remind]')?.click();
    document.querySelector<HTMLElement>(`[data-blok-database-date-remind-option="${option}"]`)?.click();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    // Due for both: 1 day before Jun 15 at 9:00 is 07:00Z in Berlin and 16:00Z in Los Angeles.
    vi.setSystemTime(new Date('2027-06-14T17:00:00.000Z'));
  });

  afterEach(() => {
    process.env.TZ = originalZone;
    vi.useRealTimers();
    vi.restoreAllMocks();
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
  });

  it('a Remind pick records the zone of whoever set it', async () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-20' } }),
    ]);

    await client(doc, 'Asia/Tokyo');
    pickRemind('1_day_before');

    expect(doc.row('r1').reminders).toEqual({ due: { remind: '1_day_before', timeZone: 'Asia/Tokyo' } });
  });

  it('keeps a reminder without a stored zone on each viewer clock, and markSent adds none', async () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-15' }, reminders: { due: { remind: '1_day_before' } } }),
    ]);
    const la = await client(doc, 'America/Los_Angeles');

    expect(la.offered.map((input) => input.dueAt)).toEqual(['2027-06-14T16:00:00.000Z']);
    la.offered[0].markSent();
    expect(doc.row('r1').reminders).toEqual({ due: { remind: '1_day_before', sentFor: '2027-06-14T16:00:00.000Z' } });
  });

  it('markSent after the reminder changed leaves the new choice alone', async () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-15' }, reminders: { due: { remind: '1_day_before', timeZone: 'Europe/Berlin' } } }),
    ]);
    const berlin = await client(doc, 'Europe/Berlin');

    pickRemind('2_days_before');
    berlin.offered[0].markSent();
    expect(doc.row('r1').reminders).toEqual({ due: { remind: '2_days_before', timeZone: 'Europe/Berlin' } });

    pickRemind('none');
    berlin.offered[0].markSent();
    expect(doc.row('r1').reminders).toBeUndefined();
  });

  it('markSent keeps the stored zone', async () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-15' }, reminders: { due: { remind: '1_day_before', timeZone: 'Europe/Berlin' } } }),
    ]);
    const la = await client(doc, 'America/Los_Angeles');

    expect(la.offered.map((input) => input.dueAt)).toEqual(['2027-06-14T07:00:00.000Z']);
    la.offered[0].markSent();
    expect(doc.row('r1').reminders).toEqual({ due: { remind: '1_day_before', timeZone: 'Europe/Berlin', sentFor: '2027-06-14T07:00:00.000Z' } });
  });

  it.each([
    { value: '2027-06-15', remind: '1_day_before', berlin: '2027-06-14T07:00:00.000Z' },
    { value: '2027-06-15T10:00', remind: '1_hour_before', berlin: '2027-06-15T07:00:00.000Z' },
  ])('is offered once: a client in another zone sees $value as sent', async ({ value, remind, berlin }) => {
    vi.setSystemTime(new Date('2027-06-15T17:00:00.000Z'));
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: value } }),
    ]);
    const setter = await client(doc, 'Europe/Berlin');

    pickRemind(remind);
    setter.tool.destroy();
    document.body.innerHTML = '';

    const first = await client(doc, 'Europe/Berlin');

    expect(first.offered.map((input) => input.dueAt)).toEqual([berlin]);
    first.offered[0].markSent();
    first.tool.destroy();
    document.body.innerHTML = '';

    expect((await client(doc, 'America/Los_Angeles')).offered).toEqual([]);
  });
});

describe('copies carry reminders, not their sent stamp', () => {
  const stored = { remind: '1_day_before' as const, timeZone: 'Europe/Berlin', sentFor: '2027-06-14T07:00:00.000Z' };
  const fresh = { remind: '1_day_before', timeZone: 'Europe/Berlin' };
  const copyOf = (doc: ReturnType<typeof makeDoc>, known: string[]): string =>
    doc.childrenOf('db').find((id) => !known.includes(id)) ?? '';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
  });

  it('Cmd+D on a row', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: '2027-06-15' }, reminders: { due: stored } }),
    ]);
    const { el } = buildDatabase(doc, 'db', data());

    el.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-checkbox]')?.click();
    el.querySelector<HTMLElement>('[role="grid"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true, cancelable: true }));

    const copy = copyOf(doc, ['r1']);

    expect(copy).not.toBe('');
    expect(doc.row(copy).reminders).toEqual({ due: fresh });
    expect(doc.row('r1').reminders).toEqual({ due: stored });
  });

  it('a new row from a template, and a duplicated template', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('tpl', 'db', { properties: { title: 'Tpl', due: '2027-06-15' }, template: true, reminders: { due: stored } }),
    ]);
    const { tool } = buildDatabase(doc, 'db', data());

    expect(doc.row(tool.newFromTemplate('tpl') ?? '').reminders).toEqual({ due: fresh });
    expect(doc.row(tool.duplicateTemplate('tpl') ?? '').reminders).toEqual({ due: fresh });
  });

  it('a template applied to an empty row page fills the reminder with the date it fills', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('r1', 'db', { properties: { title: 'Ship', due: null } }),
      rowSeed('r2', 'db', { properties: { title: 'Kept', due: '2027-06-20' }, reminders: { due: { remind: '2_days_before' } } }),
      rowSeed('tpl', 'db', { properties: { title: 'Tpl', due: '2027-06-15' }, template: true, reminders: { due: stored } }),
    ]);
    const { tool } = buildDatabase(doc, 'db', data());

    tool.applyTemplate({ rowId: 'r1', templateId: 'tpl' });
    tool.applyTemplate({ rowId: 'r2', templateId: 'tpl' });

    expect(doc.row('r1').reminders).toEqual({ due: fresh });
    expect(doc.row('r2').reminders).toEqual({ due: { remind: '2_days_before' } });
  });

  it('a duplicated template keeps the reminder on its @today date', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('tpl', 'db', { properties: { title: 'Tpl', due: '@today' }, template: true, reminders: { due: stored } }),
    ]);
    const { tool } = buildDatabase(doc, 'db', data());

    expect(doc.row(tool.duplicateTemplate('tpl') ?? '').reminders).toEqual({ due: fresh });
    expect(doc.row(tool.newFromTemplate('tpl') ?? '').reminders).toEqual({ due: fresh });
  });

  it('a reminder on a date the copy has no value for, or cannot take, stays behind', () => {
    const doc = makeDoc([
      { id: 'db', name: 'database', parentId: null, data: {} },
      rowSeed('tpl', 'db', { properties: { title: 'Tpl', due: null }, template: true, reminders: { due: stored } }),
    ]);
    const { tool } = buildDatabase(doc, 'db', data());

    expect(doc.row(tool.newFromTemplate('tpl') ?? '').reminders).toBeUndefined();
  });
});

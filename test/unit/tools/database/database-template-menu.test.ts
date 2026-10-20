import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { templateMenuItems, templateRepeatItems, templateRepeatSummary } from '../../../../src/tools/database/database-template-menu';
import type { TemplateMenuHost, TemplateRepeatHost } from '../../../../src/tools/database/database-template-menu';
import { onHover } from '../../../../src/components/utils/tooltip';
import type { TemplateRepeat } from '../../../../src/tools/database/types';
import { LightweightI18n } from '../../../../src/components/i18n/lightweight-i18n';

vi.mock('../../../../src/components/utils/tooltip', () => ({ onHover: vi.fn() }));

interface Item { name?: string; title?: string; titleEl?: HTMLElement; isActive?: boolean | (() => boolean); element?: HTMLElement; onActivate?: () => void; children?: { items?: Item[]; searchable?: boolean } }

const host = (patch: Partial<TemplateMenuHost> = {}): TemplateMenuHost => ({
  i18n: { t: (key: string) => key },
  templates: () => [{ id: 't1', title: 'Bug' }, { id: 't2', title: '' }],
  defaultTemplateId: () => 't1',
  repeatOf: () => undefined,
  newEmpty: vi.fn(),
  newFromTemplate: vi.fn(),
  addTemplate: vi.fn(),
  editTemplate: vi.fn(),
  setDefault: vi.fn(),
  duplicate: vi.fn(),
  remove: vi.fn(),
  ...patch,
});

const englishI18n = new LightweightI18n();
const english = { t: (key: string, vars?: Record<string, string | number>) => englishI18n.t(key, vars) };

const find = (items: Item[] | undefined, ...path: string[]): Item | undefined => {
  let level = items;
  let found: Item | undefined;

  for (const name of path) {
    found = level?.find((item) => item.name === name);
    level = found?.children?.items;
  }

  return found;
};

describe('template menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists every template, then an empty page and "New template"', () => {
    const items = templateMenuItems(host()) as Item[];

    expect(items.map((item) => item.name)).toEqual(['template-t1', 'template-t2', 'template-empty', 'template-add']);
    expect(find(items, 'template-t2')?.title).toBe('tools.database.templateUntitled');
  });

  it('makes a row from the template it is picked from', () => {
    const h = host();

    find(templateMenuItems(h) as Item[], 'template-t1', 'template-t1-use')?.onActivate?.();

    expect(h.newFromTemplate).toHaveBeenCalledWith('t1');
  });

  it('marks the default with a check and can move it to an empty page', () => {
    const h = host();
    const items = templateMenuItems(h) as Item[];

    expect(find(items, 'template-t1', 'template-t1-default')?.isActive).toBe(true);
    expect(find(items, 'template-t2', 'template-t2-default')?.isActive).toBe(false);
    find(items, 'template-empty', 'template-empty-default')?.onActivate?.();

    expect(h.setDefault).toHaveBeenCalledWith(null);
  });

  it('has no Repeat in a template\'s submenu: the template banner holds it', () => {
    const items = templateMenuItems(host({ repeatOf: () => ({ frequency: 'weekly', start: '2026-10-01T09:00:00.000Z' }) })) as Item[];

    expect(find(items, 'template-t1')?.children?.items?.map((item) => item.name))
      .toEqual(['template-t1-use', 'template-t1-edit', 'template-t1-default', 'template-t1-duplicate', 'template-t1-delete']);
  });

  it('marks a repeating template with ↻ and a hint that names the unit only', () => {
    const repeats: Record<string, TemplateRepeat | undefined> = { t1: { frequency: 'weekly', interval: 2, start: '2026-10-01T09:00:00.000Z' } };
    const items = templateMenuItems(host({ i18n: english, repeatOf: (id) => repeats[id] })) as Item[];
    const icon = find(items, 'template-t1')?.titleEl?.querySelector('[data-blok-database-template-repeat-icon]');

    expect(icon?.getAttribute('aria-label')).toBe('Duplicate weekly');
    expect(onHover).toHaveBeenCalledWith(icon, 'Duplicate weekly', expect.anything());
    expect(find(items, 'template-t1')?.titleEl?.firstChild?.textContent).toBe('Bug');
    expect(find(items, 'template-t1')?.title).toBe('Bug');
    expect(find(items, 'template-t2')?.titleEl).toBeUndefined();
  });

  describe('repeat in the template banner', () => {
    // Tue Oct 20 2026, noon in Berlin (CEST, GMT+2).
    const now = new Date('2026-10-20T10:00:00.000Z');
    const tomorrowMidnight = '2026-10-20T22:00:00.000Z';
    const weekly: TemplateRepeat = { frequency: 'weekly', interval: 2, start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin', lastRunAt: '2026-10-05T07:30:00.000Z' };
    const repeatHost = (patch: Partial<TemplateRepeatHost> = {}): TemplateRepeatHost => ({
      i18n: english,
      repeat: () => undefined,
      setRepeat: vi.fn(),
      editCadence: vi.fn(),
      close: vi.fn(),
      timeZone: 'Europe/Berlin',
      locale: 'en-US',
      now: () => now,
      ...patch,
    });
    /** The Edit cadence panel for a draft, or for the stored schedule. */
    const panel = (h: TemplateRepeatHost, draft?: TemplateRepeat): { items: Item[]; el: HTMLElement; q: <T extends Element = HTMLElement>(selector: string) => T | null } => {
      const items = templateRepeatItems(h, draft) as Item[];
      const el = document.createElement('div');

      items.forEach((entry) => { if (entry.element !== undefined) el.append(entry.element); });

      return { items, el, q: (selector) => el.querySelector(selector) };
    };
    const type = (input: HTMLInputElement | HTMLSelectElement | null | undefined, value: string): void => {
      if (input === null || input === undefined) throw new Error('no input');
      const el: HTMLInputElement | HTMLSelectElement = input;

      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const chips = (q: ReturnType<typeof panel>['q']): string[] =>
      Array.from(q('[data-blok-database-template-cadence-days]')?.querySelectorAll('button') ?? [])
        .map((chip) => `${chip.textContent ?? ''}${chip.getAttribute('aria-pressed') === 'true' ? '*' : ''}`);
    const chip = (q: ReturnType<typeof panel>['q'], day: number): HTMLButtonElement | null => q<HTMLButtonElement>(`[data-blok-database-template-cadence-days] button[data-weekday="${day}"]`);
    const save = (q: ReturnType<typeof panel>['q']): void => q<HTMLButtonElement>('[data-blok-database-template-cadence-save]')?.click();
    /** The value text on a "Label  value ›" row. */
    const value = (items: Item[], row: string): string => find(items, `template-repeat-${row}`)?.titleEl?.querySelector('[data-blok-database-template-cadence-value]')?.textContent ?? '';
    /** A control in a row's submenu. */
    const field = <T extends Element = HTMLInputElement>(items: Item[], row: string, selector = 'input'): T | null =>
      find(items, `template-repeat-${row}`)?.children?.items?.map((entry) => entry.element?.querySelector<T>(selector) ?? null).find((node) => node !== null) ?? null;
    const active = (entry: Item | undefined): boolean => (typeof entry?.isActive === 'function' ? entry.isActive() : entry?.isActive === true);

    it('sums the schedule up with its interval, and drops 1', () => {
      const summary = (repeat: TemplateRepeat | undefined): string => templateRepeatSummary(english, repeat);

      expect(summary(undefined)).toBe('Duplicate every…');
      expect(summary({ ...weekly })).toBe('Duplicate every 2 weeks');
      expect(summary({ ...weekly, frequency: 'daily', interval: 3 })).toBe('Duplicate every 3 days');
      expect(summary({ ...weekly, frequency: 'monthly', interval: 2 })).toBe('Duplicate every 2 months');
      expect(summary({ ...weekly, frequency: 'yearly', interval: 2 })).toBe('Duplicate every 2 years');
      expect(summary({ ...weekly, frequency: 'daily', interval: 1 })).toBe('Duplicate every day');
      expect(summary({ ...weekly, interval: undefined })).toBe('Duplicate every week');
      expect(summary({ ...weekly, frequency: 'monthly', interval: 1 })).toBe('Duplicate every month');
      expect(summary({ ...weekly, frequency: 'yearly', interval: 1 })).toBe('Duplicate every year');
    });

    it('says "every weekday" for Monday to Friday every week only', () => {
      const summary = (repeat: TemplateRepeat): string => templateRepeatSummary(english, repeat);

      expect(summary({ ...weekly, interval: 1, weekdays: [5, 4, 3, 2, 1] })).toBe('Duplicate every weekday');
      expect(summary({ ...weekly, interval: 2, weekdays: [1, 2, 3, 4, 5] })).toBe('Duplicate every 2 weeks');
      expect(summary({ ...weekly, interval: 1, weekdays: [1, 2] })).toBe('Duplicate every week');
    });

    it('offers Notion\'s presets while the template does not repeat', () => {
      const items = templateRepeatItems(repeatHost()) as Item[];

      expect(items.map((entry) => entry.title)).toEqual(['Day', 'Weekday', 'Week', '2 Weeks', 'Month', '3 Months', '6 Months', 'Year']);
    });

    it('a preset opens Edit cadence with a draft from tomorrow at midnight, and saves nothing yet', () => {
      const h = repeatHost();
      const pick = (id: string): void => find(templateRepeatItems(h) as Item[], `template-repeat-${id}`)?.onActivate?.();

      pick('weekday');
      pick('2-weeks');
      pick('week');
      pick('6-months');

      expect(h.setRepeat).not.toHaveBeenCalled();
      expect(h.editCadence).toHaveBeenNthCalledWith(1, { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      expect(h.editCadence).toHaveBeenNthCalledWith(2, { frequency: 'weekly', interval: 2, weekdays: [1], start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      expect(h.editCadence).toHaveBeenNthCalledWith(3, { frequency: 'weekly', start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      expect(h.editCadence).toHaveBeenNthCalledWith(4, { frequency: 'monthly', interval: 6, start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
    });

    it('opens Edit cadence straight away once the template repeats', () => {
      const { items, q } = panel(repeatHost({ repeat: () => weekly }));

      expect(items.some((entry) => entry.title === '2 Weeks')).toBe(false);
      expect(q('[data-blok-database-template-cadence-title]')?.textContent).toBe('Edit cadence');
      expect(q('[data-blok-database-template-cadence-save]')?.textContent).toBe('Save');
    });

    it('lays the panel out as measured: Every, days, At, Starting, Ending, Timezone', () => {
      const { q, el, items } = panel(repeatHost(), { frequency: 'weekly', interval: 2, weekdays: [1], start: tomorrowMidnight, timeZone: 'Europe/Berlin' });

      expect(Array.from(el.querySelectorAll('[data-blok-database-template-cadence-row]')).map((row) => row.getAttribute('data-blok-database-template-cadence-row')))
        .toEqual(['every']);
      // Shot 61: At, a line, Starting / Ending / Timezone, a line, Cancel recurrence, a line, Next occurrence.
      expect(items.map((entry) => entry.name ?? '-'))
        .toEqual(['template-repeat-cadence', 'template-repeat-at', '-', 'template-repeat-starting', 'template-repeat-ending', 'template-repeat-timezone', '-', 'template-repeat-cancel', '-', 'template-repeat-next']);
      expect(q<HTMLInputElement>('[data-blok-database-template-cadence-row="every"] input')?.value).toBe('2');
      expect(chips(q)).toEqual(['Mo*', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
      expect(chip(q, 1)?.getAttribute('aria-label')).toBe('Monday');
      // Blok runs at the exact time, so At reads a time, not Notion's "Around midnight" window.
      expect(value(items, 'at')).toBe('12:00 AM');
      expect(value(items, 'starting')).toBe('Tomorrow');
      expect(value(items, 'ending')).toBe('Never');
      expect(value(items, 'timezone')).toBe('GMT+2');
    });

    it('opens a submenu from each of At, Starting, Ending and Timezone', () => {
      const { items } = panel(repeatHost(), { frequency: 'weekly', start: tomorrowMidnight, timeZone: 'Europe/Berlin' });

      ['at', 'starting', 'ending', 'timezone'].forEach((row) => {
        const entry = find(items, `template-repeat-${row}`);

        expect(entry?.children?.items?.length ?? 0).toBeGreaterThan(0);
        expect(entry?.titleEl?.querySelector('[data-blok-database-template-cadence-label]')?.textContent).toBe(entry?.title);
      });
      expect(field(items, 'at')?.type).toBe('time');
      expect(field(items, 'starting')?.type).toBe('date');
      expect(field(items, 'ending')?.type).toBe('date');
      expect(find(items, 'template-repeat-timezone')?.children?.searchable).toBe(true);
    });

    it('sets an end from the Ending submenu, and Never takes it off again', () => {
      const h = repeatHost();
      const { items, q } = panel(h, { frequency: 'daily', start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      const never = find(items, 'template-repeat-ending', 'template-repeat-ending-never');

      expect(never?.title).toBe('Never');
      expect(active(never)).toBe(true);
      type(field(items, 'ending'), '2026-12-31');
      expect(value(items, 'ending')).toBe('Dec 31, 2026');
      expect(active(never)).toBe(false);
      save(q);
      // The whole last day counts, on the schedule's wall clock (Berlin is UTC+1 in December).
      expect(h.setRepeat).toHaveBeenLastCalledWith(expect.objectContaining({ end: '2026-12-31T22:59:59.999Z' }));
    });

    it('Never in the Ending submenu drops a stored end', () => {
      const h = repeatHost({ repeat: () => ({ ...weekly, end: '2026-12-31T12:00:00.000Z' }) });
      const { items, q } = panel(h);

      find(items, 'template-repeat-ending', 'template-repeat-ending-never')?.onActivate?.();
      expect(value(items, 'ending')).toBe('Never');
      expect(field(items, 'ending')?.value).toBe('');
      save(q);
      expect(h.setRepeat).toHaveBeenCalledWith(weekly);
    });

    it('picks a zone from the Timezone submenu and keeps the wall time', () => {
      const h = repeatHost({ repeat: () => weekly });
      const { items, q } = panel(h);
      const zones = find(items, 'template-repeat-timezone')?.children?.items ?? [];
      const tokyo = zones.find((entry) => entry.name === 'template-repeat-zone-Asia/Tokyo');

      expect(active(zones.find((entry) => entry.name === 'template-repeat-zone-Europe/Berlin'))).toBe(true);
      expect(tokyo?.title).toBe('Tokyo');
      tokyo?.onActivate?.();
      expect(active(tokyo)).toBe(true);
      expect(value(items, 'timezone')).toBe('GMT+9');
      expect(field(items, 'at')?.value).toBe('09:30');
      save(q);
      // 09:30 in Tokyo on Oct 5 is 00:30Z.
      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, start: '2026-10-05T00:30:00.000Z', timeZone: 'Asia/Tokyo' });
    });

    it('a zone pick keeps the end on the same last day', () => {
      const h = repeatHost({ repeat: () => ({ ...weekly, end: '2026-12-31T22:59:59.999Z' }) });
      const { items, q } = panel(h);

      find(items, 'template-repeat-timezone', 'template-repeat-zone-Asia/Tokyo')?.onActivate?.();
      expect(value(items, 'ending')).toBe('Dec 31, 2026');
      expect(field(items, 'ending')?.value).toBe('2026-12-31');
      save(q);
      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, start: '2026-10-05T00:30:00.000Z', timeZone: 'Asia/Tokyo', end: '2026-12-31T14:59:59.999Z' });
    });

    it('shows "On the [Nth] [Day]" for months only, from the start\'s day', () => {
      const { q } = panel(repeatHost(), { frequency: 'monthly', start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      const ordinal = (): HTMLSelectElement | null => q<HTMLSelectElement>('[data-blok-database-template-cadence-row="month-day"] select[data-blok-database-template-cadence-ordinal]');
      const labels = Array.from(ordinal()?.options ?? []).map((option) => option.textContent ?? '');

      expect(q('[data-blok-database-template-cadence-row="month-day"] [data-blok-database-template-cadence-label]')?.textContent).toBe('On the');
      expect(labels).toHaveLength(31);
      expect([labels[0], labels[1], labels[2], labels[3], labels[10], labels[11], labels[12], labels[20], labels[21], labels[22], labels[30]])
        .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
      // Tomorrow is Oct 21.
      expect(ordinal()?.value).toBe('21');
      expect(Array.from(q<HTMLSelectElement>('[data-blok-database-template-cadence-row="month-day"] select[data-blok-database-template-cadence-day-kind]')?.options ?? []).map((option) => option.textContent))
        .toEqual(['Day']);
      expect(q('[data-blok-database-template-cadence-days]')).toBeNull();
      type(q<HTMLSelectElement>('[data-blok-database-template-cadence-row="every"] select'), 'weekly');
      expect(ordinal()).toBeNull();
      type(q<HTMLSelectElement>('[data-blok-database-template-cadence-row="every"] select'), 'monthly');
      expect(ordinal()?.value).toBe('21');
    });

    it('moves the start to the first such day on or after it, keeping the time', () => {
      const h = repeatHost();
      const { q, items } = panel(h, { frequency: 'monthly', start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      const ordinal = q<HTMLSelectElement>('[data-blok-database-template-cadence-row="month-day"] select[data-blok-database-template-cadence-ordinal]');
      const next = (): string => q('[data-blok-database-template-cadence-next]')?.textContent ?? '';

      type(ordinal, '1');
      expect(value(items, 'starting')).toBe('Nov 1');
      expect(next()).toBe('Next occurrence:Nov 1, 12:00 AM');
      type(ordinal, '31');
      // Nov has no 31st: the first one after Nov 1 is in December.
      expect(value(items, 'starting')).toBe('Dec 31');
      save(q);
      expect(h.setRepeat).toHaveBeenCalledWith({ frequency: 'monthly', start: '2026-12-30T23:00:00.000Z', timeZone: 'Europe/Berlin' });
    });

    it('names the units in Notion\'s list, singular for 1, and relabels as the number is typed', () => {
      const { q } = panel(repeatHost(), { frequency: 'weekly', interval: 2, start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      const unit = q<HTMLSelectElement>('[data-blok-database-template-cadence-row="every"] select');
      const options = (): string[] => Array.from(unit?.options ?? []).map((option) => option.textContent ?? '');

      expect(options()).toEqual(['Days', 'Weeks', 'Months', 'Years']);
      expect(unit?.value).toBe('weekly');
      type(q<HTMLInputElement>('[data-blok-database-template-cadence-row="every"] input'), '1');
      expect(options()).toEqual(['Day', 'Week', 'Month', 'Year']);
    });

    it('shows day chips for weeks only', () => {
      const { q } = panel(repeatHost(), { frequency: 'weekly', start: tomorrowMidnight, timeZone: 'Europe/Berlin' });

      // No days stored: the start's weekday (Wednesday in Berlin) is the one it runs on.
      expect(chips(q)).toEqual(['Mo', 'Tu', 'We*', 'Th', 'Fr', 'Sa', 'Su']);
      type(q<HTMLSelectElement>('[data-blok-database-template-cadence-row="every"] select'), 'daily');
      expect(q('[data-blok-database-template-cadence-days]')).toBeNull();
      type(q<HTMLSelectElement>('[data-blok-database-template-cadence-row="every"] select'), 'weekly');
      expect(chips(q)).toEqual(['Mo', 'Tu', 'We*', 'Th', 'Fr', 'Sa', 'Su']);
    });

    it('saves the draft only on Save, then closes', () => {
      const h = repeatHost();
      const { q } = panel(h, { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], start: tomorrowMidnight, timeZone: 'Europe/Berlin' });

      chip(q, 5)?.click();
      chip(q, 6)?.click();
      type(q<HTMLInputElement>('[data-blok-database-template-cadence-row="every"] input'), '3');
      expect(h.setRepeat).not.toHaveBeenCalled();
      save(q);

      expect(h.setRepeat).toHaveBeenCalledWith({ frequency: 'weekly', interval: 3, weekdays: [1, 2, 3, 4, 6], start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      expect(h.close).toHaveBeenCalled();
    });

    it('keeps at least one day on', () => {
      const h = repeatHost();
      const { q } = panel(h, { frequency: 'weekly', weekdays: [1], start: tomorrowMidnight, timeZone: 'Europe/Berlin' });

      chip(q, 1)?.click();
      expect(chips(q)[0]).toBe('Mo*');
      save(q);
      expect(h.setRepeat).toHaveBeenCalledWith(expect.objectContaining({ weekdays: [1] }));
    });

    it('drops the days when the unit is no longer weeks', () => {
      const h = repeatHost({ repeat: () => ({ ...weekly, weekdays: [1, 3] }) });
      const { q } = panel(h);

      type(q<HTMLSelectElement>('[data-blok-database-template-cadence-row="every"] select'), 'monthly');
      save(q);

      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, frequency: 'monthly' });
    });

    it('ignores a number that is not a whole number of at least 1', () => {
      const h = repeatHost({ repeat: () => weekly });
      const { q } = panel(h);
      const input = q<HTMLInputElement>('[data-blok-database-template-cadence-row="every"] input');

      type(input, '0');
      type(input, '1.5');
      type(input, '');
      save(q);

      expect(h.setRepeat).toHaveBeenCalledWith(weekly);
    });

    it('keeps the latest last run on Save', () => {
      let live: TemplateRepeat = weekly;
      const h = repeatHost({ repeat: () => live });
      const { q } = panel(h);

      live = { ...weekly, lastRunAt: '2026-10-19T07:30:00.000Z' };
      save(q);

      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, lastRunAt: '2026-10-19T07:30:00.000Z' });
    });

    it('edits At and Starting on the schedule\'s own wall clock', () => {
      const h = repeatHost({ repeat: () => weekly, timeZone: 'America/New_York' });
      const { q, items } = panel(h);
      const time = field(items, 'at');
      const date = field(items, 'starting');

      // 07:30Z is 09:30 in Berlin (CEST).
      expect(date?.value).toBe('2026-10-05');
      expect(time?.value).toBe('09:30');
      type(time, '');
      type(time, '18:00');
      type(date, '2026-11-02');
      save(q);

      // Nov 2 is after Berlin leaves summer time: 18:00 CET is 17:00Z.
      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, start: '2026-11-02T17:00:00.000Z' });
    });

    it('stamps the viewer\'s zone on a zone-less schedule', () => {
      const legacy: TemplateRepeat = { frequency: 'daily', start: '2026-10-05T07:30:00.000Z' };
      const h = repeatHost({ repeat: () => legacy, timeZone: 'Asia/Tokyo' });
      const { q, items } = panel(h);
      const time = field(items, 'at');

      // 07:30Z is 16:30 in Tokyo.
      expect(time?.value).toBe('16:30');
      type(time, '09:00');
      save(q);

      expect(h.setRepeat).toHaveBeenCalledWith({ ...legacy, start: '2026-10-05T00:00:00.000Z', timeZone: 'Asia/Tokyo' });
    });

    it('shows an end that the document holds', () => {
      const { items } = panel(repeatHost({ repeat: () => ({ ...weekly, end: '2026-12-31T12:00:00.000Z' }) }));

      expect(value(items, 'ending')).toBe('Dec 31, 2026');
      expect(field(items, 'ending')?.value).toBe('2026-12-31');
    });

    it('reads out the next occurrence and follows the draft', () => {
      const { q } = panel(repeatHost(), { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
      const next = (): string => q('[data-blok-database-template-cadence-next]')?.textContent ?? '';

      expect(next()).toBe('Next occurrence:Tomorrow, 12:00 AM');
      chip(q, 3)?.click();
      chip(q, 2)?.click();
      chip(q, 4)?.click();
      chip(q, 5)?.click();
      // Monday only, from a Wednesday start: the next Monday.
      expect(next()).toBe('Next occurrence:Oct 26, 12:00 AM');
    });

    it('cancels the recurrence', () => {
      const h = repeatHost({ repeat: () => weekly });
      const { items } = panel(h);
      const cancel = find(items, 'template-repeat-cancel');

      expect(cancel?.title).toBe('Cancel recurrence');
      cancel?.onActivate?.();

      expect(h.setRepeat).toHaveBeenCalledWith(null);
    });

    it('opens on malformed document data without walking it or throwing', () => {
      const bad: unknown[] = [
        { ...weekly, interval: 1, weekdays: new Array(1_000_000_000) },
        { ...weekly, weekdays: [1, , 3] },
        { ...weekly, weekdays: '1,2' },
        { ...weekly, end: 42 },
        { ...weekly, start: 'soon' },
      ];

      for (const repeat of bad as TemplateRepeat[]) {
        expect(() => templateRepeatSummary(english, repeat)).not.toThrow();
        const { q } = panel(repeatHost({ repeat: () => repeat }));

        expect(q('[data-blok-database-template-cadence-title]')?.textContent).toBe('Edit cadence');
      }
    });

    it('a start that does not parse opens on tomorrow at midnight', () => {
      const h = repeatHost({ repeat: () => ({ ...weekly, start: 'soon' }) });
      const { q, items } = panel(h);

      expect(field(items, 'starting')?.value).toBe('2026-10-21');
      save(q);
      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, start: tomorrowMidnight });
    });

    it('drops weekdays it cannot read on Save, showing the start\'s weekday', () => {
      const h = repeatHost({ repeat: () => ({ ...weekly, weekdays: '1,2' } as unknown as TemplateRepeat) });
      const { q } = panel(h);

      save(q);
      expect(h.setRepeat).toHaveBeenCalledWith(weekly);
    });

    it('lets the panel own its keys', () => {
      const { q } = panel(repeatHost({ repeat: () => weekly }));

      expect(q('[data-blok-database-template-cadence]')?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    });

    it('lets each submenu field own its keys', () => {
      const { items } = panel(repeatHost({ repeat: () => weekly }));

      ['at', 'starting', 'ending'].forEach((row) => expect(field(items, row)?.closest('[data-blok-keyboard-owner]')).not.toBeNull());
    });
  });

  it('edits, duplicates and deletes a template', () => {
    const h = host();
    const items = templateMenuItems(h) as Item[];

    find(items, 'template-t1', 'template-t1-edit')?.onActivate?.();
    find(items, 'template-t1', 'template-t1-duplicate')?.onActivate?.();
    find(items, 'template-t1', 'template-t1-delete')?.onActivate?.();

    expect(h.editTemplate).toHaveBeenCalledWith('t1');
    expect(h.duplicate).toHaveBeenCalledWith('t1');
    expect(h.remove).toHaveBeenCalledWith('t1');
  });
});

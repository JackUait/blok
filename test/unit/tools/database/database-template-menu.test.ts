import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { templateMenuItems, templateRepeatItems, templateRepeatSummary } from '../../../../src/tools/database/database-template-menu';
import type { TemplateMenuHost, TemplateRepeatHost } from '../../../../src/tools/database/database-template-menu';
import { onHover } from '../../../../src/components/utils/tooltip';
import type { TemplateRepeat } from '../../../../src/tools/database/types';
import { LightweightI18n } from '../../../../src/components/i18n/lightweight-i18n';

vi.mock('../../../../src/components/utils/tooltip', () => ({ onHover: vi.fn() }));

interface Item { name?: string; title?: string; titleEl?: HTMLElement; isActive?: boolean | (() => boolean); element?: HTMLElement; onActivate?: () => void; closeOnActivate?: boolean; children?: { items?: Item[]; searchable?: boolean; moreButton?: { label: string }; onOpen?: () => void; width?: string } }

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

  it('heads the menu with "Templates for <database>" and a description, then the templates, an empty page and "New template"', () => {
    const items = templateMenuItems(host({ databaseName: () => 'Tasks' })) as Item[];

    expect(items.map((item) => item.name ?? '—')).toEqual([
      'template-header', 'template-description', '—', 'template-t1', 'template-t2', 'template-empty', '—', 'template-add',
    ]);
    expect(find(items, 'template-header')?.element?.textContent).toBe('tools.database.templatesFor');
    expect(find(items, 'template-description')?.element?.textContent).toBe('tools.database.templatesDescription');
    expect(find(items, 'template-t2')?.title).toBe('tools.database.templateUntitled');
  });

  it('makes a row from the template it is picked from', () => {
    const h = host();

    find(templateMenuItems(h) as Item[], 'template-t1', 'template-t1-use')?.onActivate?.();

    expect(h.newFromTemplate).toHaveBeenCalledWith('t1');
  });

  // research/33 §3.8: a click on a template row makes a row; research/30 X1: "…" opens the rest.
  it('a template row makes a row on click, and its "…" ("Edit this template") opens its submenu', () => {
    const h = host({ i18n: english });
    const items = templateMenuItems(h) as Item[];
    const row = find(items, 'template-t1');

    row?.onActivate?.();
    expect(h.newFromTemplate).toHaveBeenCalledWith('t1');
    expect(row?.closeOnActivate).toBe(true);
    expect(row?.children?.moreButton).toEqual({ label: 'Edit this template' });

    const empty = find(items, 'template-empty');

    empty?.onActivate?.();
    expect(h.newEmpty).toHaveBeenCalledTimes(1);
    expect(empty?.closeOnActivate).toBe(true);
    expect(empty?.children?.moreButton?.label).toBe('More actions');
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

  it('marks the default template "Default" after its name, beside ↻ when it repeats (research/27:44)', () => {
    const badge = (items: Item[], id: string): string | null | undefined =>
      find(items, `template-${id}`)?.titleEl?.querySelector('[data-blok-database-template-default]')?.textContent;
    const plain = templateMenuItems(host({ i18n: english })) as Item[];

    expect(badge(plain, 't1')).toBe('Default');
    expect(find(plain, 'template-t1')?.titleEl?.textContent).toBe('Bug Default');
    expect(find(plain, 'template-t1')?.titleEl?.firstChild?.textContent).toBe('Bug');
    expect(find(plain, 'template-t1')?.title).toBe('Bug');
    expect(find(plain, 'template-t2')?.titleEl).toBeUndefined();

    const repeating = templateMenuItems(host({ repeatOf: (id) => (id === 't1' ? { frequency: 'weekly', start: '2026-10-01T09:00:00.000Z' } : undefined) })) as Item[];
    const title = find(repeating, 'template-t1')?.titleEl;

    expect(title?.querySelector('[data-blok-database-template-repeat-icon]')).not.toBeNull();
    expect(title?.lastElementChild?.getAttribute('data-blok-database-template-default')).toBe('');
    expect(badge(templateMenuItems(host({ defaultTemplateId: () => undefined })) as Item[], 't1')).toBeUndefined();
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
      expect(field(items, 'starting', '[data-blok-database-date-grid]')).not.toBeNull();
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

      // The viewer's zone is checked once, under "Current timezone".
      expect(active(find(items, 'template-repeat-timezone', 'template-repeat-current-zone'))).toBe(true);
      expect(active(zones.find((entry) => entry.name === 'template-repeat-zone-Europe/Berlin'))).toBe(false);
      expect(tokyo?.title).toBe('Tokyo');
      // research/35 §13: the same zone list and names as the date picker.
      expect(zones.filter((entry) => entry.name?.startsWith('template-repeat-zone-'))).toHaveLength(568);
      expect(zones.find((entry) => entry.name === 'template-repeat-zone-America/Kentucky/Louisville')?.title).toBe('Kentucky/Louisville');
      // The rows read the date picker's offset text (research/30 B25); the row value stays "GMT+9".
      expect(tokyo?.titleEl?.querySelector('[data-blok-database-template-cadence-zone-offset]')?.textContent).toBe('GMT+9:00');
      tokyo?.onActivate?.();
      expect(active(tokyo)).toBe(true);
      expect(value(items, 'timezone')).toBe('GMT+9');
      expect(field(items, 'at')?.value).toBe('09:30');
      save(q);
      // 09:30 in Tokyo on Oct 5 is 00:30Z.
      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, start: '2026-10-05T00:30:00.000Z', timeZone: 'Asia/Tokyo' });
    });

    // research/35 §13 (r35:402): the date editor's search placeholder, "Current timezone" checked, then "Select a timezone".
    it('groups the Timezone submenu as the date editor does', () => {
      const h = repeatHost({ repeat: () => weekly });
      const { items } = panel(h);
      const timezone = find(items, 'template-repeat-timezone');
      const zones = timezone?.children?.items ?? [];
      const current = find(items, 'template-repeat-timezone', 'template-repeat-current-zone');
      const heading = (name: string): string | null | undefined => zones.find((entry) => entry.name === name)?.element?.textContent;

      expect(zones.slice(0, 4).map((entry) => entry.name)).toEqual([
        'template-repeat-timezone-current-heading',
        'template-repeat-current-zone',
        'template-repeat-timezone-select-heading',
        'template-repeat-zone-Africa/Abidjan',
      ]);
      expect(heading('template-repeat-timezone-current-heading')).toBe('Current timezone');
      expect(heading('template-repeat-timezone-select-heading')).toBe('Select a timezone');
      expect(current?.title).toBe('Berlin');
      expect(active(current)).toBe(true);

      // The submenu's search field takes the date editor's placeholder when it opens.
      const root = document.createElement('div');
      const search = document.createElement('div');
      const input = document.createElement('input');

      root.setAttribute('data-blok-popover', '');
      search.setAttribute('data-blok-field', 'search');
      search.append(input);
      root.append(search, ...zones.flatMap((entry) => (entry.element === undefined ? [] : [entry.element])));
      timezone?.children?.onOpen?.();
      expect(input.placeholder).toBe('Search cities, timezones…');

      // Another zone moves the check to its row; the current row picks the viewer's zone back.
      zones.find((entry) => entry.name === 'template-repeat-zone-Asia/Tokyo')?.onActivate?.();
      expect(active(current)).toBe(false);
      current?.onActivate?.();
      expect(active(current)).toBe(true);
      expect(value(items, 'timezone')).toBe('GMT+2');
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
      const grid = (): HTMLElement | null => field<HTMLElement>(items, 'starting', '[data-blok-database-date-grid]');

      // 07:30Z is 09:30 in Berlin (CEST).
      expect(grid()?.querySelector('[aria-selected="true"]')?.getAttribute('data-blok-database-date-day')).toBe('2026-10-05');
      expect(time?.value).toBe('09:30');
      type(time, '');
      type(time, '18:00');
      field<HTMLButtonElement>(items, 'starting', '[data-blok-database-date-next]')?.click();
      grid()?.querySelector<HTMLButtonElement>('[data-blok-database-date-day="2026-11-02"]')?.click();
      save(q);

      // Nov 2 is after Berlin leaves summer time: 18:00 CET is 17:00Z.
      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, start: '2026-11-02T17:00:00.000Z' });
    });

    // research/35 §13 (r35:400): Starting opens a month grid, 268x294, with no Today button and no time.
    it('picks the start day from a month grid, keeping the time of day', () => {
      const h = repeatHost({ repeat: () => weekly });
      const { q, items } = panel(h);
      const starting = find(items, 'template-repeat-starting');
      const box = (selector: string): HTMLElement | null => field<HTMLElement>(items, 'starting', selector);

      expect(box('[data-blok-database-date-grid]')).not.toBeNull();
      expect(box('input')).toBeNull();
      expect(box('[data-blok-database-date-today]')).toBeNull();
      expect(starting?.children?.width).toBe('268px');
      expect(box('[data-blok-database-date-month]')?.textContent).toBe('Oct 2026');
      // Today is Oct 20 in Berlin.
      expect(box('[data-today]')?.getAttribute('data-blok-database-date-day')).toBe('2026-10-20');
      expect(box('[data-blok-database-date-weekday]')?.textContent).toBe('Su');

      box('[data-blok-database-date-day="2026-10-28"]')?.click();
      expect(value(items, 'starting')).toBe('Oct 28');
      expect(box('[aria-selected="true"]')?.getAttribute('data-blok-database-date-day')).toBe('2026-10-28');
      box('[data-blok-database-date-prev]')?.click();
      expect(box('[data-blok-database-date-month]')?.textContent).toBe('Sep 2026');
      save(q);

      // 09:30 in Berlin on Oct 28 (CET) is 08:30Z.
      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, start: '2026-10-28T08:30:00.000Z' });
    });

    it('keeps keyboard focus on the month step and the picked day when the grid redraws', () => {
      const { items } = panel(repeatHost({ repeat: () => weekly }));
      const box = (selector: string): HTMLButtonElement | null => field<HTMLButtonElement>(items, 'starting', selector);
      const calendar = find(items, 'template-repeat-starting')?.children?.items?.[0]?.element;

      if (calendar === undefined) throw new Error('no calendar');
      document.body.append(calendar);
      box('[data-blok-database-date-next]')?.focus();
      box('[data-blok-database-date-next]')?.click();
      expect(box('[data-blok-database-date-next]')).toHaveFocus();
      box('[data-blok-database-date-day="2026-11-03"]')?.focus();
      box('[data-blok-database-date-day="2026-11-03"]')?.click();
      expect(box('[data-blok-database-date-day="2026-11-03"]')).toHaveFocus();
      calendar.remove();
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

      expect(field(items, 'starting', '[aria-selected="true"]')?.getAttribute('data-blok-database-date-day')).toBe('2026-10-21');
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

      ['at', 'ending'].forEach((row) => expect(field(items, row)?.closest('[data-blok-keyboard-owner]')).not.toBeNull());
      expect(field(items, 'starting', '[data-blok-database-date-grid]')?.closest('[data-blok-keyboard-owner]') ?? null).not.toBeNull();
    });

    // research/35 §13 (r35:406): Escape on an unsaved panel asks "Discard unsaved changes?".
    describe('Escape on an unsaved panel', () => {
      const mounted: HTMLElement[] = [];
      /** The panel inside a popover root, as the group popover draws it. */
      const mount = (h: TemplateRepeatHost, draft?: TemplateRepeat): ReturnType<typeof panel> => {
        const shown = panel(h, draft);
        const root = document.createElement('div');

        root.setAttribute('data-blok-popover', '');
        root.append(shown.el);
        document.body.append(root);
        mounted.push(root);

        return shown;
      };
      const escape = (): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

        document.body.dispatchEvent(event);

        return event;
      };
      const dialog = (): HTMLElement | null => document.querySelector('[data-blok-database-confirm-dialog]');
      const action = (name: 'confirm' | 'cancel'): HTMLButtonElement | null => document.querySelector(`[data-blok-database-confirm-action="${name}"]`);
      const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

      afterEach(() => {
        action('cancel')?.click();
        mounted.splice(0).forEach((root) => root.remove());
      });

      it('asks before a preset draft is dropped, with a red filled Discard focused', () => {
        const h = repeatHost();
        const event = (mount(h, { frequency: 'daily', start: tomorrowMidnight, timeZone: 'Europe/Berlin' }), escape());

        expect(dialog()?.textContent).toContain('Discard unsaved changes?');
        expect(event.defaultPrevented).toBe(true);
        expect(action('confirm')?.textContent).toBe('Discard');
        expect(action('confirm')?.hasAttribute('data-destructive')).toBe(true);
        expect(action('confirm')?.hasAttribute('data-filled')).toBe(true);
        expect(action('confirm')).toHaveFocus();
        expect(h.close).not.toHaveBeenCalled();
      });

      it('Discard closes the panel and saves nothing', async () => {
        const h = repeatHost();

        mount(h, { frequency: 'daily', start: tomorrowMidnight, timeZone: 'Europe/Berlin' });
        escape();
        action('confirm')?.click();
        await settle();

        expect(h.close).toHaveBeenCalledTimes(1);
        expect(h.setRepeat).not.toHaveBeenCalled();
        expect(dialog()).toBeNull();
      });

      it('Cancel keeps the panel and its draft', async () => {
        const h = repeatHost({ repeat: () => weekly });
        const { q } = mount(h);

        type(q('input'), '3');
        escape();
        action('cancel')?.click();
        await settle();

        expect(h.close).not.toHaveBeenCalled();
        expect(dialog()).toBeNull();
        save(q);
        expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, interval: 3 });
      });

      it('lets Escape close an unchanged panel without asking', () => {
        const event = (mount(repeatHost({ repeat: () => weekly })), escape());

        expect(dialog()).toBeNull();
        expect(event.defaultPrevented).toBe(false);
      });

      it('stops listening once the panel is gone', () => {
        const shown = mount(repeatHost(), { frequency: 'daily', start: tomorrowMidnight, timeZone: 'Europe/Berlin' });

        shown.el.remove();
        expect(escape().defaultPrevented).toBe(false);
        expect(dialog()).toBeNull();
      });
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
  it('names the database in the header, in English', () => {
    const items = templateMenuItems(host({ i18n: english, databaseName: () => 'Tasks' })) as Item[];

    expect(find(items, 'template-header')?.element?.textContent).toBe('Templates for Tasks');
  });

  it('offers no "Empty page" row when there are no templates (Notion, findings V23)', () => {
    const items = templateMenuItems(host({ templates: () => [] })) as Item[];

    expect(items.map((item) => item.name ?? '—')).toEqual(['template-header', 'template-description', '—', 'template-add']);
  });
});

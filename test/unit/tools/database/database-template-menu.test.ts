import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { templateMenuItems, templateRepeatItems, templateRepeatSummary } from '../../../../src/tools/database/database-template-menu';
import type { TemplateMenuHost, TemplateRepeatHost } from '../../../../src/tools/database/database-template-menu';
import { onHover } from '../../../../src/components/utils/tooltip';
import type { TemplateRepeat } from '../../../../src/tools/database/types';
import { LightweightI18n } from '../../../../src/components/i18n/lightweight-i18n';

vi.mock('../../../../src/components/utils/tooltip', () => ({ onHover: vi.fn() }));

interface Item { name?: string; title?: string; titleEl?: HTMLElement; isActive?: boolean; element?: HTMLElement; onActivate?: () => void; children?: { items?: Item[] } }

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
    const weekly = { frequency: 'weekly' as const, interval: 2, start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin', lastRunAt: '2026-10-05T07:30:00.000Z' };
    const repeatHost = (patch: Partial<TemplateRepeatHost> = {}): TemplateRepeatHost => ({
      i18n: { t: (key: string) => key },
      repeat: () => undefined,
      setRepeat: vi.fn(),
      ...patch,
    });
    const item = (h: TemplateRepeatHost, name: string): Item | undefined => find(templateRepeatItems(h) as Item[], `template-repeat-${name}`);
    const field = (h: TemplateRepeatHost, name: string): HTMLElement | undefined => item(h, name)?.element;
    const type = (input: HTMLInputElement | null | undefined, value: string): void => {
      if (input === null || input === undefined) throw new Error('no input');
      const el: HTMLInputElement = input;

      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    /** The field as a reader sees it: the number box shows its value. */
    const shown = (el: HTMLElement | undefined): string =>
      Array.from(el?.childNodes ?? []).map((node) => (node instanceof HTMLInputElement ? node.value : node.textContent)).join('');

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

    it('offers Notion\'s presets while the template does not repeat', () => {
      const items = templateRepeatItems(repeatHost({ i18n: english })) as Item[];

      expect(items.map((entry) => entry.title)).toEqual(['Day', 'Week', '2 Weeks', 'Month', '3 Months', '6 Months', 'Year']);
      expect(field(repeatHost(), 'interval')).toBeUndefined();
      expect(field(repeatHost(), 'start')).toBeUndefined();
      expect(item(repeatHost(), 'cancel')).toBeUndefined();
    });

    it('a preset starts the schedule now, in the viewer\'s zone', () => {
      const h = repeatHost({ timeZone: 'Europe/Berlin' });

      item(h, '2-weeks')?.onActivate?.();
      item(h, 'day')?.onActivate?.();
      item(h, '6-months')?.onActivate?.();

      expect(h.setRepeat).toHaveBeenNthCalledWith(1, { frequency: 'weekly', interval: 2, start: expect.any(String), timeZone: 'Europe/Berlin' });
      expect(h.setRepeat).toHaveBeenNthCalledWith(2, { frequency: 'daily', start: expect.any(String), timeZone: 'Europe/Berlin' });
      expect(h.setRepeat).toHaveBeenNthCalledWith(3, { frequency: 'monthly', interval: 6, start: expect.any(String), timeZone: 'Europe/Berlin' });
    });

    it('edits a set schedule and cancels it', () => {
      const h = repeatHost({ repeat: () => weekly, i18n: english });
      const items = templateRepeatItems(h) as Item[];

      expect(items.some((entry) => entry.title === '2 Weeks')).toBe(false);
      expect(find(items, 'template-repeat-weekly')?.isActive).toBe(true);
      expect(find(items, 'template-repeat-cancel')?.title).toBe('Cancel recurrence');
      find(items, 'template-repeat-cancel')?.onActivate?.();

      expect(h.setRepeat).toHaveBeenCalledWith(null);
    });

    it('keeps the start, interval, zone and last run when the frequency changes', () => {
      const h = repeatHost({ repeat: () => weekly });

      item(h, 'monthly')?.onActivate?.();

      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, frequency: 'monthly' });
    });

    it('reads "Every N weeks" and stores a whole number of at least 1', () => {
      const h = repeatHost({ repeat: () => weekly, i18n: english });
      const el = field(h, 'interval');
      const input = el?.querySelector<HTMLInputElement>('input');

      expect(shown(el)).toBe('Every 2 weeks');
      type(input, '0');
      type(input, '1.5');
      type(input, '');
      expect(h.setRepeat).not.toHaveBeenCalled();
      type(input, '3');

      expect(h.setRepeat).toHaveBeenCalledWith({ ...weekly, interval: 3 });
    });

    it('says "Every 1 week", not "Every 1 weeks", and rewords as the number is typed', () => {
      const el = field(repeatHost({ repeat: () => ({ ...weekly, interval: 1 }), i18n: english }), 'interval');
      const input = el?.querySelector<HTMLInputElement>('input');

      expect(shown(el)).toBe('Every 1 week');
      expect(shown(field(repeatHost({ repeat: () => ({ ...weekly, interval: undefined }), i18n: english }), 'interval'))).toBe('Every 1 week');
      type(input, '5');
      expect(shown(el)).toBe('Every 5 weeks');
      expect(el?.querySelector('input')).toBe(input);
    });

    it('names the unit after the frequency', () => {
      const interval = (frequency: TemplateRepeat['frequency'], n: number): string =>
        shown(field(repeatHost({ repeat: () => ({ ...weekly, frequency, interval: n }), i18n: english }), 'interval'));

      expect([interval('daily', 1), interval('daily', 3)]).toEqual(['Every 1 day', 'Every 3 days']);
      expect([interval('monthly', 1), interval('monthly', 2)]).toEqual(['Every 1 month', 'Every 2 months']);
      expect([interval('yearly', 1), interval('yearly', 2)]).toEqual(['Every 1 year', 'Every 2 years']);
    });

    it('puts the number box where the language puts the number', () => {
      const japanese = { t: (key: string, vars?: Record<string, string | number>) => `${String(vars?.count)}週間ごと` };
      const el = field(repeatHost({ repeat: () => weekly, i18n: japanese }), 'interval');

      expect(shown(el)).toBe('2週間ごと');
      expect(el?.firstChild?.textContent).toBe('');
      expect(el?.childNodes[1]).toBeInstanceOf(HTMLInputElement);
    });

    it('shows the start on the schedule\'s own wall clock and stores an edit in that zone', () => {
      const h = repeatHost({ repeat: () => weekly, timeZone: 'America/New_York' });
      const el = field(h, 'start');
      const date = el?.querySelector<HTMLInputElement>('input[type="date"]');
      const time = el?.querySelector<HTMLInputElement>('input[type="time"]');

      // 07:30Z is 09:30 in Berlin (CEST).
      expect(date?.value).toBe('2026-10-05');
      expect(time?.value).toBe('09:30');
      expect(time?.getAttribute('aria-label')).toBe('tools.database.dateTime');
      type(time, '');
      expect(h.setRepeat).not.toHaveBeenCalled();
      type(time, '18:00');
      type(date, '2026-11-02');

      expect(h.setRepeat).toHaveBeenNthCalledWith(1, { ...weekly, start: '2026-10-05T16:00:00.000Z' });
      // Nov 2 is after Berlin leaves summer time: 18:00 CET is 17:00Z.
      expect(h.setRepeat).toHaveBeenNthCalledWith(2, { ...weekly, start: '2026-11-02T17:00:00.000Z' });
    });

    it('stamps the viewer\'s zone when the start of a zone-less schedule is edited', () => {
      const legacy = { frequency: 'daily' as const, start: '2026-10-05T07:30:00.000Z' };
      const h = repeatHost({ repeat: () => legacy, timeZone: 'Asia/Tokyo' });
      const el = field(h, 'start');

      // 07:30Z is 16:30 in Tokyo.
      expect(el?.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe('16:30');
      type(el?.querySelector<HTMLInputElement>('input[type="time"]'), '09:00');

      expect(h.setRepeat).toHaveBeenCalledWith({ ...legacy, start: '2026-10-05T00:00:00.000Z', timeZone: 'Asia/Tokyo' });
    });

    it('keeps an interval typed before the start is edited in the same menu', () => {
      let live: TemplateRepeat = weekly;
      const h = repeatHost({ repeat: () => live, setRepeat: vi.fn((next: TemplateRepeat | null) => { if (next !== null) live = next; }) });
      const items = templateRepeatItems(h) as Item[];
      const inMenu = (name: string): HTMLElement | undefined => find(items, `template-repeat-${name}`)?.element;

      type(inMenu('interval')?.querySelector<HTMLInputElement>('input'), '4');
      type(inMenu('start')?.querySelector<HTMLInputElement>('input[type="time"]'), '18:00');

      expect(live).toEqual({ ...weekly, interval: 4, start: '2026-10-05T16:00:00.000Z' });
    });

    it('lets the fields own their keys', () => {
      const h = repeatHost({ repeat: () => weekly });

      expect(field(h, 'interval')?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
      expect(field(h, 'start')?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
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

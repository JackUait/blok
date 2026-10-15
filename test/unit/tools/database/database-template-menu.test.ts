import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { templateMenuItems } from '../../../../src/tools/database/database-template-menu';
import type { TemplateMenuHost } from '../../../../src/tools/database/database-template-menu';
import type { TemplateRepeat } from '../../../../src/tools/database/types';

interface Item { name?: string; title?: string; isActive?: boolean; element?: HTMLElement; onActivate?: () => void; children?: { items?: Item[] } }

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
  setRepeat: vi.fn(),
  duplicate: vi.fn(),
  remove: vi.fn(),
  ...patch,
});

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

  it('stores a weekly repeat starting now and turns it off', () => {
    const h = host({ repeatOf: (id) => (id === 't1' ? { frequency: 'daily', start: '2026-10-01T09:00:00.000Z' } : undefined) });
    const items = templateMenuItems(h) as Item[];

    expect(find(items, 'template-t1', 'template-t1-repeat', 'template-t1-repeat-daily')?.isActive).toBe(true);
    find(items, 'template-t2', 'template-t2-repeat', 'template-t2-repeat-weekly')?.onActivate?.();
    find(items, 'template-t1', 'template-t1-repeat', 'template-t1-repeat-off')?.onActivate?.();

    expect(h.setRepeat).toHaveBeenNthCalledWith(1, 't2', expect.objectContaining({ frequency: 'weekly', start: expect.any(String) }));
    expect(h.setRepeat).toHaveBeenNthCalledWith(2, 't1', null);
  });

  it('keeps the start, interval, zone and last run when the frequency changes', () => {
    const repeat = { frequency: 'daily' as const, interval: 3, start: '2026-10-01T09:00:00.000Z', timeZone: 'Asia/Tokyo', lastRunAt: '2026-10-13T09:00:00.000Z' };
    const h = host({ repeatOf: () => repeat });

    find(templateMenuItems(h) as Item[], 'template-t1', 'template-t1-repeat', 'template-t1-repeat-monthly')?.onActivate?.();

    expect(h.setRepeat).toHaveBeenCalledWith('t1', { ...repeat, frequency: 'monthly' });
  });

  it('starts a new repeat now, in the viewer\'s zone', () => {
    const h = host({ timeZone: 'Europe/Berlin' });

    find(templateMenuItems(h) as Item[], 'template-t1', 'template-t1-repeat', 'template-t1-repeat-weekly')?.onActivate?.();

    expect(h.setRepeat).toHaveBeenCalledWith('t1', { frequency: 'weekly', start: expect.any(String), timeZone: 'Europe/Berlin' });
  });

  describe('schedule fields', () => {
    const weekly = { frequency: 'weekly' as const, interval: 2, start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin', lastRunAt: '2026-10-05T07:30:00.000Z' };
    const field = (h: TemplateMenuHost, name: string): HTMLElement | undefined =>
      find(templateMenuItems(h) as Item[], 'template-t1', 'template-t1-repeat', `template-t1-repeat-${name}`)?.element;
    const type = (input: HTMLInputElement | null | undefined, value: string): void => {
      if (input === null || input === undefined) throw new Error('no input');
      const el: HTMLInputElement = input;

      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    it('has no fields while the template does not repeat', () => {
      expect(field(host(), 'interval')).toBeUndefined();
      expect(field(host(), 'start')).toBeUndefined();
    });

    it('reads "Every N weeks" and stores a whole number of at least 1', () => {
      const h = host({ repeatOf: () => weekly });
      const el = field(h, 'interval');
      const input = el?.querySelector<HTMLInputElement>('input');

      expect(el?.textContent).toBe('tools.database.templateRepeatEverytools.database.filterUnitWeek');
      expect(input?.value).toBe('2');
      type(input, '0');
      type(input, '1.5');
      type(input, '');
      expect(h.setRepeat).not.toHaveBeenCalled();
      type(input, '3');

      expect(h.setRepeat).toHaveBeenCalledWith('t1', { ...weekly, interval: 3 });
    });

    it('names the unit after the frequency', () => {
      expect(field(host({ repeatOf: () => ({ ...weekly, frequency: 'daily' }) }), 'interval')?.textContent).toContain('tools.database.filterUnitDay');
      expect(field(host({ repeatOf: () => ({ ...weekly, frequency: 'yearly' }) }), 'interval')?.textContent).toContain('tools.database.filterUnitYear');
    });

    it('shows the start on the schedule\'s own wall clock and stores an edit in that zone', () => {
      const h = host({ repeatOf: () => weekly, timeZone: 'America/New_York' });
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

      expect(h.setRepeat).toHaveBeenNthCalledWith(1, 't1', { ...weekly, start: '2026-10-05T16:00:00.000Z' });
      // Nov 2 is after Berlin leaves summer time: 18:00 CET is 17:00Z.
      expect(h.setRepeat).toHaveBeenNthCalledWith(2, 't1', { ...weekly, start: '2026-11-02T17:00:00.000Z' });
    });

    it('stamps the viewer\'s zone when the start of a zone-less schedule is edited', () => {
      const legacy = { frequency: 'daily' as const, start: '2026-10-05T07:30:00.000Z' };
      const h = host({ repeatOf: () => legacy, timeZone: 'Asia/Tokyo' });
      const el = field(h, 'start');

      // 07:30Z is 16:30 in Tokyo.
      expect(el?.querySelector<HTMLInputElement>('input[type="time"]')?.value).toBe('16:30');
      type(el?.querySelector<HTMLInputElement>('input[type="time"]'), '09:00');

      expect(h.setRepeat).toHaveBeenCalledWith('t1', { ...legacy, start: '2026-10-05T00:00:00.000Z', timeZone: 'Asia/Tokyo' });
    });

    it('keeps an interval typed before the start is edited in the same menu', () => {
      let live: TemplateRepeat = weekly;
      const h = host({ repeatOf: () => live, setRepeat: vi.fn((_id: string, next: TemplateRepeat | null) => { if (next !== null) live = next; }) });
      const items = templateMenuItems(h) as Item[];
      const inMenu = (name: string): HTMLElement | undefined => find(items, 'template-t1', 'template-t1-repeat', `template-t1-repeat-${name}`)?.element;

      type(inMenu('interval')?.querySelector<HTMLInputElement>('input'), '4');
      type(inMenu('start')?.querySelector<HTMLInputElement>('input[type="time"]'), '18:00');

      expect(live).toEqual({ ...weekly, interval: 4, start: '2026-10-05T16:00:00.000Z' });
    });

    it('lets the fields own their keys', () => {
      const h = host({ repeatOf: () => weekly });

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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { boardLayoutItems, calendarLayoutItems, galleryLayoutItems, timelineLayoutItems } from '../../../../src/tools/database/database-layout-items';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
  { id: 'p-start', name: 'Start', type: 'date', position: 'a2' },
  { id: 'p-link', name: 'Image', type: 'url', position: 'a3' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a4' },
  { id: 'p-files', name: 'Attachments', type: 'files', position: 'a5' },
];

const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'V', type: 'gallery', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const i18n = { t: (key: string) => key };

interface Flat {
  title?: string;
  isActive?: boolean;
  onActivate?: () => void;
  children?: Flat[];
}

const flat = (items: PopoverItemParams[]): Flat[] => items.map((item) => {
  const record = item as unknown as { title?: string; isActive?: boolean; onActivate?: () => void; children?: { items: PopoverItemParams[] } };

  return {
    title: record.title,
    isActive: record.isActive,
    onActivate: record.onActivate,
    ...(record.children !== undefined ? { children: flat(record.children.items) } : {}),
  };
});

const find = (items: Flat[], title: string): Flat => {
  const found = items.find((item) => item.title === title);

  if (found === undefined) {
    throw new Error(`no item ${title}`);
  }

  return found;
};

describe('database layout items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names every row, so the settings panel can give each a stable test id', () => {
    const named = (items: PopoverItemParams[]): string[] => items.flatMap((item) => {
      const record = item as unknown as { name?: string; children?: { items: PopoverItemParams[] } };

      return [record.name ?? '', ...(record.children !== undefined ? named(record.children.items) : [])];
    });

    expect(named(galleryLayoutItems(view(), schema, i18n, vi.fn()))).toEqual([
      'gallery-card-preview', 'gallery-card-preview-none', 'gallery-card-preview-cover', 'gallery-card-preview-content',
      'gallery-card-preview-p-link', 'gallery-card-preview-p-files',
      'gallery-card-size', 'gallery-card-size-small', 'gallery-card-size-medium', 'gallery-card-size-large',
      'gallery-fit-image',
    ]);
    expect(named(calendarLayoutItems(view({ type: 'calendar' }), schema, i18n, vi.fn()))).toEqual([
      'calendar-show-by', 'calendar-show-by-p-due', 'calendar-show-by-p-start',
      'calendar-show-as', 'calendar-range-month', 'calendar-range-week',
      'calendar-show-weekends',
    ]);
  });

  describe('gallery', () => {
    it('offers card size with the current one marked, and writes the pick', () => {
      const update = vi.fn();
      const items = flat(galleryLayoutItems(view({ cardSize: 'small' }), schema, i18n, update));
      const size = find(items, 'tools.database.galleryCardSize').children ?? [];

      expect(size.map((item) => [item.title, item.isActive])).toEqual([
        ['tools.database.galleryCardSizeSmall', true],
        ['tools.database.galleryCardSizeMedium', false],
        ['tools.database.galleryCardSizeLarge', false],
      ]);
      find(size, 'tools.database.galleryCardSizeLarge').onActivate?.();
      expect(update).toHaveBeenCalledWith({ cardSize: 'large' });
    });

    it('offers none, cover, content and each files or url property as the preview', () => {
      const update = vi.fn();
      const items = flat(galleryLayoutItems(view(), schema, i18n, update));
      const preview = find(items, 'tools.database.galleryCardPreview').children ?? [];

      expect(preview.map((item) => [item.title, item.isActive])).toEqual([
        ['tools.database.galleryCardPreviewNone', false],
        ['tools.database.galleryCardPreviewCover', false],
        ['tools.database.galleryCardPreviewContent', true],
        ['Image', false],
        ['Attachments', false],
      ]);
      find(preview, 'Image').onActivate?.();
      expect(update).toHaveBeenCalledWith({ cardPreview: 'property:p-link' });
    });

    // notion-motion.md Round 24 §4 Gallery: the row reads "Fit media".
    it('flips fit media', () => {
      const update = vi.fn();
      const fit = find(flat(galleryLayoutItems(view({ fitImage: true }), schema, i18n, update)), 'tools.database.galleryFitMedia');

      expect(fit.isActive).toBe(true);
      fit.onActivate?.();
      expect(update).toHaveBeenCalledWith({ fitImage: false });
    });
  });

  describe('calendar', () => {
    it('offers each date property to show the calendar by', () => {
      const update = vi.fn();
      const items = flat(calendarLayoutItems(view({ type: 'calendar' }), schema, i18n, update));
      const by = find(items, 'tools.database.calendarShowBy').children ?? [];

      expect(by.map((item) => [item.title, item.isActive])).toEqual([['Due', true], ['Start', false]]);
      find(by, 'Start').onActivate?.();
      expect(update).toHaveBeenCalledWith({ calendarBy: 'p-start' });
    });

    it('switches between month and week, and flips weekends', () => {
      const update = vi.fn();
      const items = flat(calendarLayoutItems(view({ type: 'calendar', calendarRange: 'week' }), schema, i18n, update));
      const as = find(items, 'tools.database.calendarShowAs').children ?? [];

      expect(as.map((item) => [item.title, item.isActive])).toEqual([['tools.database.calendarMonth', false], ['tools.database.calendarWeek', true]]);
      find(as, 'tools.database.calendarMonth').onActivate?.();
      find(items, 'tools.database.calendarShowWeekends').onActivate?.();
      expect(update).toHaveBeenNthCalledWith(1, { calendarRange: 'month' });
      expect(update).toHaveBeenNthCalledWith(2, { showWeekends: false });
    });
  });
  describe('timeline', () => {
    it('names every row and choice, so the settings panel can show them', () => {
      const names = (items: PopoverItemParams[]): unknown[] => items.flatMap((item) => {
        const record = item as unknown as { name?: unknown; children?: { items: PopoverItemParams[] } };

        return [record.name, ...(record.children !== undefined ? names(record.children.items) : [])];
      });

      expect(names(timelineLayoutItems(view({ type: 'timeline' }), schema, i18n, vi.fn())).every((name) => typeof name === 'string' && name !== '')).toBe(true);
      expect(names(boardLayoutItems(view({ type: 'board' }), schema, i18n, vi.fn())).every((name) => typeof name === 'string' && name !== '')).toBe(true);
    });

    it('shows the timeline by a date property, the current one marked', () => {
      const update = vi.fn();
      const showBy = find(flat(timelineLayoutItems(view({ type: 'timeline', timelineBy: 'p-start' }), schema, i18n, update)), 'tools.database.timelineShowBy');

      expect(showBy.children?.map((c) => [c.title, c.isActive])).toEqual([['Due', false], ['Start', true]]);
      find(showBy.children ?? [], 'Due').onActivate?.();
      expect(update).toHaveBeenCalledWith({ timelineBy: 'p-due' });
    });

    // notion-motion.md Round 24 §4 Timeline: a "Separate start and end dates" switch, off, after Show timeline by.
    it('turns separate start and end dates on with the next date property, and off again', () => {
      const update = vi.fn();
      const off = flat(timelineLayoutItems(view({ type: 'timeline' }), schema, i18n, update));
      const toggle = find(off, 'tools.database.timelineSeparateDates');

      expect(off.map((item) => item.title).slice(0, 3)).toEqual([
        'tools.database.timelineShowBy', 'tools.database.timelineSeparateDates', 'tools.database.timelineShowTable',
      ]);
      expect(toggle.isActive).toBe(false);
      expect(toggle.children).toBeUndefined();
      toggle.onActivate?.();
      expect(update).toHaveBeenLastCalledWith({ timelineEndBy: 'p-start' });

      const on = flat(timelineLayoutItems(view({ type: 'timeline', timelineEndBy: 'p-start' }), schema, i18n, update));

      expect(find(on, 'tools.database.timelineSeparateDates').isActive).toBe(true);
      find(on, 'tools.database.timelineSeparateDates').onActivate?.();
      expect(update).toHaveBeenLastCalledWith({ timelineEndBy: '' });
    });

    it('lets a separate end property be picked only while the switch is on', () => {
      const update = vi.fn();

      expect(flat(timelineLayoutItems(view({ type: 'timeline' }), schema, i18n, update)).some((item) => item.title === 'tools.database.timelineEndBy')).toBe(false);

      const on = flat(timelineLayoutItems(view({ type: 'timeline', timelineEndBy: 'p-start' }), schema, i18n, update));
      const endBy = find(on, 'tools.database.timelineEndBy');

      expect(on.map((item) => item.title).indexOf('tools.database.timelineEndBy')).toBe(2);
      expect(endBy.children?.map((c) => [c.title, c.isActive])).toEqual([['Start', true]]);
    });

    it('has no switch when no second date property exists', () => {
      const oneDate = schema.filter((p) => p.id !== 'p-start');

      expect(flat(timelineLayoutItems(view({ type: 'timeline' }), oneDate, i18n, vi.fn())).some((item) => item.title === 'tools.database.timelineSeparateDates')).toBe(false);
    });

    it('toggles the table panel', () => {
      const update = vi.fn();

      find(flat(timelineLayoutItems(view({ type: 'timeline' }), schema, i18n, update)), 'tools.database.timelineShowTable').onActivate?.();
      expect(update).toHaveBeenCalledWith({ showTimelineTable: true });
    });

    it('shows or hides a table panel column apart from the bar properties', () => {
      const update = vi.fn();
      const v = view({ type: 'timeline', properties: [{ id: 'p-notes', visible: true }], tableProperties: [{ id: 'p-due', visible: true }] });
      const columns = find(flat(timelineLayoutItems(v, schema, i18n, update)), 'tools.database.timelineTableProperties');

      expect(columns.children?.map((c) => [c.title, c.isActive])).toEqual([
        ['Due', true], ['Start', false], ['Image', false], ['Notes', false], ['Attachments', false],
      ]);
      find(columns.children ?? [], 'Notes').onActivate?.();
      expect(update).toHaveBeenCalledWith({ tableProperties: [{ id: 'p-due', visible: true }, { id: 'p-notes', visible: true }] });
      find(columns.children ?? [], 'Due').onActivate?.();
      expect(update).toHaveBeenLastCalledWith({ tableProperties: [{ id: 'p-due', visible: false }] });
    });
  });

  describe('board', () => {
    // notion-motion.md Round 25 §7: Card preview, Card size, then "Fit media" only once a preview is set.
    it('offers card preview then card size, and no Fit media while the preview is None', () => {
      const update = vi.fn();
      const items = flat(boardLayoutItems(view({ type: 'board' }), schema, i18n, update));
      const preview = find(items, 'tools.database.galleryCardPreview');

      expect(items.map((item) => item.title)).toEqual(['tools.database.galleryCardPreview', 'tools.database.galleryCardSize']);
      expect(find(preview.children ?? [], 'tools.database.galleryCardPreviewNone').isActive).toBe(true);
      find(find(items, 'tools.database.galleryCardSize').children ?? [], 'tools.database.galleryCardSizeLarge').onActivate?.();
      expect(update).toHaveBeenCalledWith({ cardSize: 'large' });
    });

    it('adds a "Fit media" switch after Card size once a preview is set', () => {
      const update = vi.fn();
      const items = flat(boardLayoutItems(view({ type: 'board', cardPreview: 'content' }), schema, i18n, update));

      expect(items.map((item) => item.title)).toEqual([
        'tools.database.galleryCardPreview', 'tools.database.galleryCardSize', 'tools.database.galleryFitMedia',
      ]);
      find(items, 'tools.database.galleryFitMedia').onActivate?.();
      expect(update).toHaveBeenLastCalledWith({ fitImage: true });
    });

    it('names its rows board-*, not gallery-*', () => {
      const names = (list: PopoverItemParams[]): string[] => list.flatMap((item) => {
        const record = item as unknown as { name?: string; children?: { items: PopoverItemParams[] } };

        return [record.name ?? '', ...(record.children !== undefined ? names(record.children.items) : [])];
      });
      const items = names(boardLayoutItems(view({ type: 'board', cardPreview: 'cover' }), schema, i18n, vi.fn()));

      expect(items).toContain('board-card-size');
      expect(items).toContain('board-card-preview-none');
      expect(items).toContain('board-fit-image');
      expect(items.filter((name) => name.startsWith('gallery-'))).toEqual([]);
    });
  });
});

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
      'gallery-card-size', 'gallery-card-size-small', 'gallery-card-size-medium', 'gallery-card-size-large',
      'gallery-card-preview', 'gallery-card-preview-none', 'gallery-card-preview-cover', 'gallery-card-preview-content',
      'gallery-card-preview-p-link', 'gallery-card-preview-p-files',
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

    it('flips fit image', () => {
      const update = vi.fn();
      const fit = find(flat(galleryLayoutItems(view({ fitImage: true }), schema, i18n, update)), 'tools.database.galleryFitImage');

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

    it('picks a separate end property, or none', () => {
      const update = vi.fn();
      const endBy = find(flat(timelineLayoutItems(view({ type: 'timeline' }), schema, i18n, update)), 'tools.database.timelineEndBy');

      expect(endBy.children?.map((c) => [c.title, c.isActive])).toEqual([['tools.database.timelineEndNone', true], ['Start', false]]);
      find(endBy.children ?? [], 'Start').onActivate?.();
      expect(update).toHaveBeenLastCalledWith({ timelineEndBy: 'p-start' });
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
    it('offers card size, card preview and fit image, with no preview marked by default', () => {
      const update = vi.fn();
      const items = flat(boardLayoutItems(view({ type: 'board' }), schema, i18n, update));
      const preview = find(items, 'tools.database.galleryCardPreview');

      expect(find(preview.children ?? [], 'tools.database.galleryCardPreviewNone').isActive).toBe(true);
      find(find(items, 'tools.database.galleryCardSize').children ?? [], 'tools.database.galleryCardSizeLarge').onActivate?.();
      expect(update).toHaveBeenCalledWith({ cardSize: 'large' });
      find(items, 'tools.database.galleryFitImage').onActivate?.();
      expect(update).toHaveBeenLastCalledWith({ fitImage: true });
    });
  });
});

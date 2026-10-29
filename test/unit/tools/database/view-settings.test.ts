import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  DEFAULT_LOAD_LIMIT,
  resolveCalculations,
  resolveFrozenColumnCount,
  resolveCalendarBy,
  resolveCalendarRange,
  resolveCardPreview,
  resolveCardSize,
  resolveFitImage,
  resolveLoadLimit,
  resolveOpenPagesIn,
  resolveShowWeekends,
  resolveShowVerticalLines,
  resolveArrowsBy,
  resolveBoardCardPreview,
  resolveShowTimelineTable,
  resolveTimelineBy,
  resolveTimelineEndBy,
  resolveTimelineTableProperties,
  resolveTimelineZoom,
  resolveViewProperties,
  resolveWrapCells,
  visibleRowPropertyIds,
  withCalculation,
  withCalculationCap,
  resolveCountCaps,
  withPropertyOrder,
  withPropertySetting,
} from '../../../../src/tools/database/view-settings';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-status', name: 'Status', type: 'select', position: 'a1', config: { options: [] } },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a3' },
];

const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1',
  name: 'View',
  type: 'table',
  position: 'a0',
  sorts: [],
  filters: [],
  visibleProperties: [],
  ...overrides,
});

describe('view-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveViewProperties', () => {
    it('shows every property of a fresh table view, in schema order', () => {
      const resolved = resolveViewProperties(view(), schema);

      expect(resolved.map((p) => [p.id, p.visible])).toEqual([
        ['p-title', true],
        ['p-status', true],
        ['p-due', true],
        ['p-done', true],
      ]);
    });

    it('shows only the title of a fresh list or board view', () => {
      const resolved = resolveViewProperties(view({ type: 'list' }), schema);

      expect(resolved.filter((p) => p.visible).map((p) => p.id)).toEqual(['p-title']);
    });

    it('migrates the legacy visibleProperties list: listed ones first and visible, the rest hidden', () => {
      const resolved = resolveViewProperties(view({ type: 'list', visibleProperties: ['p-due', 'p-status'] }), schema);

      expect(resolved.map((p) => [p.id, p.visible])).toEqual([
        ['p-title', true],
        ['p-due', true],
        ['p-status', true],
        ['p-done', false],
      ]);
    });

    it('hides unlisted columns of a legacy table view that listed some', () => {
      const resolved = resolveViewProperties(view({ visibleProperties: ['p-due'] }), schema);

      expect(resolved.filter((p) => p.visible).map((p) => p.id)).toEqual(['p-title', 'p-due']);
    });

    it('prefers properties over the legacy list', () => {
      const resolved = resolveViewProperties(view({
        visibleProperties: ['p-status'],
        properties: [{ id: 'p-done', visible: true, width: 120 }, { id: 'p-status', visible: false }],
      }), schema);

      expect(resolved.map((p) => [p.id, p.visible, p.width])).toEqual([
        ['p-done', true, 120],
        ['p-status', false, undefined],
        ['p-title', true, undefined],
        ['p-due', true, undefined],
      ]);
    });

    it('drops entries for properties the schema no longer has', () => {
      const resolved = resolveViewProperties(view({ properties: [{ id: 'gone', visible: true }] }), schema);

      expect(resolved.map((p) => p.id)).not.toContain('gone');
      expect(resolved).toHaveLength(4);
    });

    it('merges duplicate entries a concurrent merge can leave, keeping the first position', () => {
      const resolved = resolveViewProperties(view({
        properties: [{ id: 'p-due', width: 100 }, { id: 'p-title' }, { id: 'p-due', wrap: true }],
      }), schema);

      expect(resolved.map((p) => p.id)).toEqual(['p-due', 'p-title', 'p-status', 'p-done']);
      expect(resolved[0]).toMatchObject({ width: 100, wrap: true });
    });

    it('falls back to the view-wide wrap for a column without its own', () => {
      const resolved = resolveViewProperties(view({ wrapCells: true, properties: [{ id: 'p-due', wrap: false }] }), schema);

      expect(resolved.find((p) => p.id === 'p-due')?.wrap).toBe(false);
      expect(resolved.find((p) => p.id === 'p-status')?.wrap).toBe(true);
    });

    it('ignores a width that is not a positive number', () => {
      const resolved = resolveViewProperties(view({ properties: [{ id: 'p-due', width: -5 }] }), schema);

      expect(resolved.find((p) => p.id === 'p-due')?.width).toBeUndefined();
    });
  });

  describe('propertyOrder alphabetical (a relation tab, research/36 §12)', () => {
    const tabSchema: PropertyDefinition[] = [
      { id: 'n', name: 'Name', type: 'title', position: 'a0' },
      { id: 'sel', name: 'Select', type: 'select', position: 'a1', config: { options: [] } },
      { id: 'txt', name: 'Text', type: 'text', position: 'a2' },
      { id: 'pl', name: 'Place', type: 'place', position: 'a3' },
      { id: 'rel', name: 'Related R14', type: 'relation', position: 'a4' },
    ];
    const ids = (v: DatabaseViewConfig, s: PropertyDefinition[] = tabSchema): string[] => resolveViewProperties(v, s).map((p) => p.id);
    const withNumber: PropertyDefinition[] = [...tabSchema, { id: 'num', name: 'Number', type: 'number', position: 'a5' }];

    it('puts the title first, then every other property by name', () => {
      expect(ids(view({ properties: [], propertyOrder: 'alphabetical' }))).toEqual(['n', 'pl', 'rel', 'sel', 'txt']);
    });

    it('places a property added later at its alphabetical place', () => {
      expect(ids(view({ properties: [], propertyOrder: 'alphabetical' }), withNumber)).toEqual(['n', 'num', 'pl', 'rel', 'sel', 'txt']);
    });

    it('still places a later property by name after a column was resized', () => {
      const resized = view({ properties: withPropertySetting(view({ properties: [], propertyOrder: 'alphabetical' }), tabSchema, 'txt', { width: 300 }), propertyOrder: 'alphabetical' });

      expect(ids(resized, withNumber)).toEqual(['n', 'num', 'pl', 'rel', 'sel', 'txt']);
    });

    it('keeps a manual move, and a later property still lands by name', () => {
      const start = view({ properties: [], propertyOrder: 'alphabetical' });
      const moved = view({ properties: withPropertyOrder(start, tabSchema, 'txt', 'pl'), propertyOrder: 'alphabetical' });

      expect(ids(moved)).toEqual(['n', 'txt', 'pl', 'rel', 'sel']);
      expect(ids(moved, withNumber)).toEqual(['n', 'num', 'txt', 'pl', 'rel', 'sel']);
    });

    it('leaves a view without the flag in schema order', () => {
      expect(ids(view({ properties: [] }), withNumber)).toEqual(['n', 'sel', 'txt', 'pl', 'rel', 'num']);
    });
  });

  describe('visibleRowPropertyIds', () => {
    it('lists visible non-title ids in column order, which is what v1.16.1 reads', () => {
      expect(visibleRowPropertyIds(view({ type: 'list', visibleProperties: ['p-due'] }), schema)).toEqual(['p-due']);
      expect(visibleRowPropertyIds(view(), schema)).toEqual(['p-status', 'p-due', 'p-done']);
    });
  });

  describe('withPropertySetting', () => {
    it('materialises a legacy view with explicit visibility, then patches one column', () => {
      const next = withPropertySetting(view({ type: 'list', visibleProperties: ['p-due'] }), schema, 'p-status', { width: 200 });

      expect(next).toEqual([
        { id: 'p-title', visible: true },
        { id: 'p-due', visible: true },
        // A list's hidden properties go by name (notion-spec-2 §21.8).
        { id: 'p-done', visible: false },
        { id: 'p-status', visible: false, width: 200 },
      ]);
    });

    it('keeps fields it does not know and entries for properties it has not seen yet', () => {
      const stored = [{ id: 'p-due', width: 90, future: 'x' }, { id: 'p-new-from-peer', visible: true }];
      const next = withPropertySetting(view({ properties: stored }), schema, 'p-due', { wrap: true });

      expect(next).toEqual([{ id: 'p-due', width: 90, future: 'x', wrap: true }, { id: 'p-new-from-peer', visible: true }]);
    });

    it('appends a column the stored list does not mention, with what the user currently sees', () => {
      const next = withPropertySetting(view({ properties: [{ id: 'p-title', visible: true }] }), schema, 'p-done', { width: 80 });

      expect(next).toEqual([{ id: 'p-title', visible: true }, { id: 'p-done', visible: true, width: 80 }]);
    });

    it('collapses duplicate ids so the list stays keyed by id', () => {
      const next = withPropertySetting(view({ properties: [{ id: 'p-due', width: 1 }, { id: 'p-due', wrap: true }] }), schema, 'p-due', { width: 2 });

      expect(next).toEqual([{ id: 'p-due', width: 2, wrap: true }]);
    });

    it('does not change the view it was given', () => {
      const original = view({ properties: [{ id: 'p-due', width: 1 }] });

      withPropertySetting(original, schema, 'p-due', { width: 2 });

      expect(original.properties).toEqual([{ id: 'p-due', width: 1 }]);
    });
  });

  describe('withPropertyOrder', () => {
    it('moves a column before another and keeps every other entry', () => {
      const next = withPropertyOrder(view(), schema, 'p-done', 'p-status');

      expect(next.map((p) => p.id)).toEqual(['p-title', 'p-done', 'p-status', 'p-due']);
    });

    it('moves a column to the end when there is no column after it', () => {
      const next = withPropertyOrder(view(), schema, 'p-title', null);

      expect(next.map((p) => p.id)).toEqual(['p-status', 'p-due', 'p-done', 'p-title']);
    });
  });

  describe('view-wide settings', () => {
    it('defaults wrap off, vertical lines on and no frozen columns', () => {
      expect(resolveWrapCells(view())).toBe(false);
      expect(resolveShowVerticalLines(view())).toBe(true);
      expect(resolveFrozenColumnCount(view())).toBe(0);
    });

    it('wraps a new board, but not a new table or gallery (notion-spec-2 §21.1, §21.7)', () => {
      expect(resolveWrapCells(view({ type: 'board' }))).toBe(true);
      expect(resolveWrapCells(view({ type: 'gallery' }))).toBe(false);
      expect(resolveViewProperties(view(), schema).some((p) => p.wrap)).toBe(false);
    });

    it('keeps a saved wrap setting over the default', () => {
      expect(resolveWrapCells(view({ wrapCells: true }))).toBe(true);
      expect(resolveWrapCells(view({ type: 'board', wrapCells: false }))).toBe(false);
      expect(resolveViewProperties(view({ properties: [{ id: 'p-due', wrap: true }] }), schema).find((p) => p.id === 'p-due')?.wrap).toBe(true);
    });

    it('reads stored values', () => {
      const v = view({ wrapCells: true, showVerticalLines: false, frozenColumnCount: 2, loadLimit: 10, openPagesIn: 'full' });

      expect(resolveWrapCells(v)).toBe(true);
      expect(resolveShowVerticalLines(v)).toBe(false);
      expect(resolveFrozenColumnCount(v)).toBe(2);
      expect(resolveLoadLimit(v)).toBe(10);
      expect(resolveOpenPagesIn(v)).toBe('full');
    });

    it('rejects a frozen count that is negative or fractional', () => {
      expect(resolveFrozenColumnCount(view({ frozenColumnCount: -1 }))).toBe(0);
      expect(resolveFrozenColumnCount(view({ frozenColumnCount: 1.5 }))).toBe(1);
    });

    it('falls back to the default load limit for a value Notion does not offer', () => {
      expect(resolveLoadLimit(view())).toBe(DEFAULT_LOAD_LIMIT);
      expect(resolveLoadLimit(view({ loadLimit: 7 as never }))).toBe(DEFAULT_LOAD_LIMIT);
    });

    it('opens pages in a center peek for calendar, a layout newer than this union', () => {
      expect(resolveOpenPagesIn(view({ type: 'calendar' as never }))).toBe('center');
    });

    it('opens pages in a side peek for table, board and list, and center for gallery', () => {
      expect(resolveOpenPagesIn(view())).toBe('side');
      expect(resolveOpenPagesIn(view({ type: 'board' }))).toBe('side');
      expect(resolveOpenPagesIn(view({ type: 'list' }))).toBe('side');
      expect(resolveOpenPagesIn(view({ type: 'gallery' }))).toBe('center');
      expect(resolveOpenPagesIn(view({ openPagesIn: 'sideways' as never }))).toBe('side');
    });

    it('opens calendar pages in a center peek by default', () => {
      expect(resolveOpenPagesIn(view({ type: 'calendar' }))).toBe('center');
      expect(resolveOpenPagesIn(view({ type: 'calendar', openPagesIn: 'side' }))).toBe('side');
    });
  });

  describe('feed defaults', () => {
    it('loads 10 cards and opens pages in a center peek, as Notion does (research/08)', () => {
      expect(resolveLoadLimit(view({ type: 'feed' }))).toBe(10);
      expect(resolveOpenPagesIn(view({ type: 'feed' }))).toBe('center');
      expect(resolveLoadLimit(view({ type: 'feed', loadLimit: 25 }))).toBe(25);
    });
  });

  describe('gallery settings', () => {
    it('defaults to medium cards, a page-content preview and cropped images', () => {
      expect(resolveCardSize(view({ type: 'gallery' }))).toBe('medium');
      expect(resolveCardPreview(view({ type: 'gallery' }), schema)).toEqual({ kind: 'content' });
      expect(resolveFitImage(view({ type: 'gallery' }))).toBe(false);
    });

    it('reads stored values', () => {
      const v = view({ type: 'gallery', cardSize: 'large', cardPreview: 'cover', fitImage: true });

      expect(resolveCardSize(v)).toBe('large');
      expect(resolveCardPreview(v, schema)).toEqual({ kind: 'cover' });
      expect(resolveFitImage(v)).toBe(true);
      expect(resolveCardPreview(view({ cardPreview: 'none' }), schema)).toEqual({ kind: 'none' });
    });

    it('reads a property preview and falls back when the property is gone', () => {
      expect(resolveCardPreview(view({ cardPreview: 'property:p-due' }), schema)).toEqual({ kind: 'property', propertyId: 'p-due' });
      expect(resolveCardPreview(view({ cardPreview: 'property:gone' }), schema)).toEqual({ kind: 'content' });
    });

    it('falls back for values it does not know', () => {
      expect(resolveCardSize(view({ cardSize: 'huge' as never }))).toBe('medium');
      expect(resolveCardPreview(view({ cardPreview: 'banner' as never }), schema)).toEqual({ kind: 'content' });
    });
  });

  describe('calendar settings', () => {
    it('shows a month with weekends by default', () => {
      expect(resolveCalendarRange(view({ type: 'calendar' }))).toBe('month');
      expect(resolveShowWeekends(view({ type: 'calendar' }))).toBe(true);
    });

    it('reads stored values', () => {
      const v = view({ type: 'calendar', calendarRange: 'week', showWeekends: false });

      expect(resolveCalendarRange(v)).toBe('week');
      expect(resolveShowWeekends(v)).toBe(false);
      expect(resolveCalendarRange(view({ calendarRange: 'year' as never }))).toBe('month');
    });

    it('shows the calendar by the stored date property, else the first date property', () => {
      const twoDates: PropertyDefinition[] = [...schema, { id: 'p-start', name: 'Start', type: 'date', position: 'a0x' }];

      expect(resolveCalendarBy(view({ calendarBy: 'p-start' }), twoDates)).toBe('p-start');
      expect(resolveCalendarBy(view(), twoDates)).toBe('p-start');
      expect(resolveCalendarBy(view({ calendarBy: 'p-status' }), schema)).toBe('p-due');
      expect(resolveCalendarBy(view(), schema.filter((p) => p.type !== 'date'))).toBeUndefined();
    });
  });

  describe('timeline settings', () => {
    const twoDates: PropertyDefinition[] = [...schema, { id: 'p-end', name: 'End', type: 'date', position: 'a4' }];

    it('opens timeline pages in a side peek by default', () => {
      expect(resolveOpenPagesIn(view({ type: 'timeline' }))).toBe('side');
    });

    it('shows the timeline by the stored date property, else the first one', () => {
      expect(resolveTimelineBy(view({ type: 'timeline', timelineBy: 'p-end' }), twoDates)).toBe('p-end');
      expect(resolveTimelineBy(view({ type: 'timeline' }), twoDates)).toBe('p-due');
      expect(resolveTimelineBy(view({ type: 'timeline', timelineBy: 'p-status' }), twoDates)).toBe('p-due');
      expect(resolveTimelineBy(view(), schema.filter((p) => p.type !== 'date'))).toBeUndefined();
    });

    it('reads a separate end property only when it is another date property', () => {
      expect(resolveTimelineEndBy(view({ type: 'timeline', timelineEndBy: 'p-end' }), twoDates)).toBe('p-end');
      expect(resolveTimelineEndBy(view({ type: 'timeline' }), twoDates)).toBeUndefined();
      expect(resolveTimelineEndBy(view({ type: 'timeline', timelineEndBy: 'p-status' }), twoDates)).toBeUndefined();
      expect(resolveTimelineEndBy(view({ type: 'timeline', timelineBy: 'p-due', timelineEndBy: 'p-due' }), twoDates)).toBeUndefined();
    });

    it('zooms to a month by default and keeps every Notion zoom level', () => {
      expect(resolveTimelineZoom(view({ type: 'timeline' }))).toBe('month');
      for (const zoom of ['hours', 'day', 'week', 'bi_week', 'month', 'quarter', 'year', '5_years'] as const) {
        expect(resolveTimelineZoom(view({ type: 'timeline', timelineZoom: zoom }))).toBe(zoom);
      }
      expect(resolveTimelineZoom(view({ timelineZoom: 'decade' as never }))).toBe('month');
    });

    it('hides the table panel by default', () => {
      expect(resolveShowTimelineTable(view({ type: 'timeline' }))).toBe(false);
      expect(resolveShowTimelineTable(view({ type: 'timeline', showTimelineTable: true }))).toBe(true);
    });

    it('lists the table panel properties apart from the bar properties, title first and shown', () => {
      const v = view({
        type: 'timeline',
        properties: [{ id: 'p-status', visible: true }],
        tableProperties: [{ id: 'p-due', visible: true }],
      });

      expect(resolveTimelineTableProperties(v, schema).filter((p) => p.visible).map((p) => p.id)).toEqual(['p-title', 'p-due']);
      expect(resolveTimelineTableProperties(view({ type: 'timeline' }), schema).filter((p) => p.visible).map((p) => p.id)).toEqual(['p-title']);
    });

    it('reads arrows by a property that still exists, else none', () => {
      expect(resolveArrowsBy(view({ type: 'timeline', arrowsBy: 'p-status' }), schema)).toBe('p-status');
      expect(resolveArrowsBy(view({ type: 'timeline', arrowsBy: 'gone' }), schema)).toBeUndefined();
      expect(resolveArrowsBy(view({ type: 'timeline' }), schema)).toBeUndefined();
    });
  });

  describe('board card preview', () => {
    it('shows no preview on a board until one is picked, so old boards keep their look', () => {
      expect(resolveBoardCardPreview(view({ type: 'board' }), schema)).toEqual({ kind: 'none' });
      expect(resolveBoardCardPreview(view({ type: 'board', cardPreview: 'cover' }), schema)).toEqual({ kind: 'cover' });
      expect(resolveBoardCardPreview(view({ type: 'board', cardPreview: 'property:gone' }), schema)).toEqual({ kind: 'none' });
    });
  });

  describe('calculations', () => {
    it('reads one calculation per known column, the last entry winning', () => {
      const resolved = resolveCalculations(view({
        calculations: [
          { id: 'p-due', fn: 'earliest_date' },
          { id: 'gone', fn: 'count' },
          { id: 'p-due', fn: 'latest_date' },
          { id: 'p-status', fn: 'nonsense' as never },
        ],
      }), schema);

      expect([...resolved]).toEqual([['p-due', 'latest_date']]);
    });

    it('drops a calculation the property type does not offer', () => {
      const resolved = resolveCalculations(view({ calculations: [{ id: 'p-status', fn: 'sum' }] }), schema);

      expect(resolved.size).toBe(0);
    });

    it('sets, replaces and clears one column without touching the others', () => {
      const start = view({ calculations: [{ id: 'p-due', fn: 'count' }] });
      const set = withCalculation(start, 'p-done', 'checked');

      expect(set).toEqual([{ id: 'p-due', fn: 'count' }, { id: 'p-done', fn: 'checked' }]);
      expect(withCalculation({ ...start, calculations: set }, 'p-due', 'empty')).toEqual([{ id: 'p-due', fn: 'empty' }, { id: 'p-done', fn: 'checked' }]);
      expect(withCalculation({ ...start, calculations: set }, 'p-due', null)).toEqual([{ id: 'p-done', fn: 'checked' }]);
    });

    it('keeps "Show large counts as 99+" across a change of function, and sets it with Count when none is picked', () => {
      const start = view({ calculations: [{ id: 'p-due', fn: 'count' }] });
      const capped = withCalculationCap(start, 'p-due', true);

      expect(capped).toEqual([{ id: 'p-due', fn: 'count', capCounts: true }]);
      expect(withCalculation({ ...start, calculations: capped }, 'p-due', 'empty')).toEqual([{ id: 'p-due', fn: 'empty', capCounts: true }]);
      expect(withCalculationCap({ ...start, calculations: capped }, 'p-due', false)).toEqual([{ id: 'p-due', fn: 'count' }]);
      expect(withCalculationCap(start, 'p-done', true)).toEqual([{ id: 'p-due', fn: 'count' }, { id: 'p-done', fn: 'count', capCounts: true }]);
      expect(resolveCountCaps({ ...start, calculations: capped })).toEqual(new Set(['p-due']));
    });
  });
});

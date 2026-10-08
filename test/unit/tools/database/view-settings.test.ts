import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  DEFAULT_LOAD_LIMIT,
  resolveCalculations,
  resolveFrozenColumnCount,
  resolveLoadLimit,
  resolveOpenPagesIn,
  resolveShowVerticalLines,
  resolveViewProperties,
  resolveWrapCells,
  visibleRowPropertyIds,
  withCalculation,
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
        { id: 'p-status', visible: false, width: 200 },
        { id: 'p-done', visible: false },
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

    it('opens pages in a side peek for table, board and list, and center for gallery', () => {
      expect(resolveOpenPagesIn(view())).toBe('side');
      expect(resolveOpenPagesIn(view({ type: 'board' }))).toBe('side');
      expect(resolveOpenPagesIn(view({ type: 'list' }))).toBe('side');
      expect(resolveOpenPagesIn(view({ type: 'gallery' }))).toBe('center');
      expect(resolveOpenPagesIn(view({ openPagesIn: 'sideways' as never }))).toBe('side');
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
  });
});

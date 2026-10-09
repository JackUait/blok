import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  COLOR_RULE_TYPES,
  isGroupCollapsed,
  isGroupHidden,
  resolveRowColors,
  sortFromHeader,
  withGroupState,
  withGroupStates,
} from '../../../../src/tools/database/view-data';
import { resolveLoadLimit } from '../../../../src/tools/database/view-settings';
import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'num', name: 'Amount', type: 'number', position: 'a1' },
];

const view = (overrides: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v', name: 'V', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...overrides,
});

const rows: DatabaseRow[] = [
  { id: 'a', position: 'a0', properties: { num: 5 } },
  { id: 'b', position: 'a1', properties: {} },
];

describe('view-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('conditional color', () => {
    it('allows the property types Notion lists', () => {
      expect(COLOR_RULE_TYPES).toEqual(['title', 'text', 'number', 'select', 'multiSelect', 'date', 'checkbox']);
    });

    it('tints matching rows; the first matching rule wins', () => {
      const v = view({
        colorRules: [
          { id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'green' },
          { id: 'c2', propertyId: 'num', operator: 'greater_than', value: 1, color: 'red' },
        ],
      });
      const colors = resolveRowColors(rows, v, schema);

      expect(colors.get('a')).toEqual({ row: 'green', cells: {} });
      expect(colors.has('b')).toBe(false);
    });

    it('tints only the property cell when a table rule says so, and the row elsewhere', () => {
      const rule = { id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'blue', applyTo: 'property' as const };

      expect(resolveRowColors(rows, view({ colorRules: [rule] }), schema).get('a')).toEqual({ cells: { num: 'blue' } });
      expect(resolveRowColors(rows, view({ type: 'list', colorRules: [rule] }), schema).get('a')).toEqual({ row: 'blue', cells: {} });
    });

    it('skips a rule on a property it cannot read', () => {
      const v = view({ colorRules: [{ id: 'c', propertyId: 'gone', operator: 'is_empty', value: null, color: 'red' }] });

      expect(resolveRowColors(rows, v, schema).size).toBe(0);
    });
  });

  describe('group state', () => {
    it('reads hidden and collapsed per group key', () => {
      const v = view({ groupStates: [{ id: 'k1', hidden: true }, { id: 'k2', collapsed: true }] });

      expect(isGroupHidden(v, 'k1')).toBe(true);
      expect(isGroupHidden(v, 'k2')).toBe(false);
      expect(isGroupCollapsed(v, 'k2')).toBe(true);
      expect(isGroupCollapsed(v, 'k3')).toBe(false);
    });

    it('patches one group and keeps the rest', () => {
      const v = view({ groupStates: [{ id: 'k1', hidden: true }] });

      expect(withGroupState(v, 'k2', { collapsed: true })).toEqual([{ id: 'k1', hidden: true }, { id: 'k2', collapsed: true }]);
      expect(withGroupState(v, 'k1', { hidden: false })).toEqual([{ id: 'k1', hidden: false }]);
    });

    it('patches many groups at once, for Hide all', () => {
      expect(withGroupStates(view(), ['k1', 'k2'], { hidden: true })).toEqual([{ id: 'k1', hidden: true }, { id: 'k2', hidden: true }]);
    });
  });

  it('replaces every sort with the one chosen from a column header', () => {
    const sorts = sortFromHeader('num', 'desc');

    expect(sorts).toHaveLength(1);
    expect(sorts[0]).toMatchObject({ propertyId: 'num', direction: 'desc' });
    expect(typeof sorts[0].id).toBe('string');
  });

  it('loads 25 rows by default on a board (research/08)', () => {
    expect(resolveLoadLimit(view({ type: 'board' }))).toBe(25);
    expect(resolveLoadLimit(view({ type: 'board', loadLimit: 100 }))).toBe(100);
  });
});

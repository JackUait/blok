import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  COLOR_RULE_TYPES,
  isGroupCollapsed,
  isGroupHidden,
  COLOR_RULE_LAYOUTS,
  resolveRowColors,
  sortFromHeader,
  withGroupFlags,
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
    it('allows the property types Notion lists (research/05 §6.2)', () => {
      expect(COLOR_RULE_TYPES).toEqual([
        'title', 'text', 'number', 'select', 'multiSelect', 'status', 'date', 'person', 'checkbox', 'formula', 'relation', 'rollup',
      ]);
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

    it('colors by status, person, relation, formula and rollup, as Notion does (research/05 §6.2)', () => {
      const typed: PropertyDefinition[] = [
        ...schema,
        { id: 'st', name: 'Stage', type: 'status', position: 'a2', config: { options: [{ id: 's1', label: 'Done', position: 'a0', groupId: 'complete' }] } },
        { id: 'own', name: 'Owner', type: 'person', position: 'a3' },
        { id: 'rel', name: 'Rel', type: 'relation', position: 'a4' },
      ];
      const row: DatabaseRow = { id: 'a', position: 'a0', properties: { st: 's1', own: [{ id: 'u1' }], rel: ['r9'] } };
      const rule = (propertyId: string, operator: string, value: unknown): DatabaseViewConfig => view({
        colorRules: [{ id: 'c', propertyId, operator, value: value as never, color: 'pink' }],
      });

      expect(resolveRowColors([row], rule('st', 'equals', 's1'), typed).get('a')).toEqual({ row: 'pink', cells: {} });
      expect(resolveRowColors([row], rule('own', 'is_not_empty', null), typed).get('a')).toEqual({ row: 'pink', cells: {} });
      expect(resolveRowColors([row], rule('rel', 'is_not_empty', null), typed).get('a')).toEqual({ row: 'pink', cells: {} });
      expect(COLOR_RULE_TYPES).toEqual(expect.arrayContaining(['status', 'person', 'relation', 'formula', 'rollup']));
    });

    it('resolves a "Me" person rule to the signed-in person', () => {
      const typed: PropertyDefinition[] = [...schema, { id: 'own', name: 'Owner', type: 'person', position: 'a2' }];
      const row: DatabaseRow = { id: 'a', position: 'a0', properties: { own: [{ id: 'u1' }] } };
      const v = view({ colorRules: [{ id: 'c', propertyId: 'own', operator: 'contains', value: ['me'], color: 'red' }] });

      expect(resolveRowColors([row], v, typed, new Date(), 'u1').get('a')).toEqual({ row: 'red', cells: {} });
      expect(resolveRowColors([row], v, typed, new Date(), 'u2').has('a')).toBe(false);
    });

    it.each(['calendar', 'timeline', 'feed'] as const)('colors a %s view (research/05 §6.2)', (type) => {
      const rule = { id: 'c1', propertyId: 'num', operator: 'is_not_empty', value: null, color: 'blue' };

      expect(COLOR_RULE_LAYOUTS).toContain(type);
      expect(resolveRowColors(rows, view({ type, colorRules: [rule] }), schema).get('a')).toEqual({ row: 'blue', cells: {} });
    });

    it('skips a rule on a property it cannot read', () => {
      const v = view({ colorRules: [{ id: 'c', propertyId: 'gone', operator: 'is_empty', value: null, color: 'red' }] });

      expect(resolveRowColors(rows, v, schema).size).toBe(0);
    });
  });

  describe('group state', () => {
    it('reads hidden and collapsed per group key from the view lists', () => {
      const v = view({ hiddenGroups: [{ id: 'k1' }], collapsedGroups: [{ id: 'k2' }] });

      expect(isGroupHidden(v, 'k1')).toBe(true);
      expect(isGroupHidden(v, 'k2')).toBe(false);
      expect(isGroupCollapsed(v, 'k2')).toBe(true);
      expect(isGroupCollapsed(v, 'k3')).toBe(false);
    });

    it('adds and removes keys without touching the other list or other keys', () => {
      const v = view({ hiddenGroups: [{ id: 'k1' }], collapsedGroups: [{ id: 'k3' }] });

      expect(withGroupFlags(v, ['k2'], { hidden: true })).toEqual({ hiddenGroups: [{ id: 'k1' }, { id: 'k2' }] });
      expect(withGroupFlags(v, ['k1'], { hidden: false })).toEqual({ hiddenGroups: [] });
      expect(withGroupFlags(v, ['k3', 'k4'], { collapsed: true })).toEqual({ collapsedGroups: [{ id: 'k3' }, { id: 'k4' }] });
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

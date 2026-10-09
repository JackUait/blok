import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  defaultFilterFor,
  filterPillLabel,
  operatorChoices,
  sortDirectionLabelKey,
} from '../../../../src/tools/database/database-filter-labels';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

/** Echoes the key and its vars, so a test reads which key a label used. */
const t = (key: string, vars?: Record<string, string | number>): string =>
  vars === undefined ? key : `${key}(${Object.values(vars).join(',')})`;

const prop = (type: PropertyDefinition['type'], extra: Partial<PropertyDefinition> = {}): PropertyDefinition =>
  ({ id: 'p', name: 'Due', type, position: 'a0', ...extra });

describe('database filter labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists Notion\'s operators per type (research/08)', () => {
    expect(operatorChoices('number').map((c) => c.operator)).toEqual([
      'equals', 'does_not_equal', 'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to', 'is_empty', 'is_not_empty',
    ]);
    expect(operatorChoices('text').map((c) => c.operator)).toEqual([
      'equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty',
    ]);
    expect(operatorChoices('select').map((c) => c.operator)).toEqual(['equals', 'does_not_equal', 'is_empty', 'is_not_empty']);
    expect(operatorChoices('multiSelect').map((c) => c.operator)).toEqual(['contains', 'does_not_contain', 'is_empty', 'is_not_empty']);
    expect(operatorChoices('checkbox').map((c) => c.operator)).toEqual(['equals', 'does_not_equal']);
    expect(operatorChoices('date').map((c) => c.operator)).toContain('within');
    expect(operatorChoices('number')[0].labelKey).toBe('tools.database.filterOpNumberEquals');
  });

  it('starts a date filter at "This week", as Notion\'s default pill reads', () => {
    expect(defaultFilterFor(prop('date'))).toMatchObject({ propertyId: 'p', operator: 'this_week', value: null });
    expect(defaultFilterFor(prop('text'))).toMatchObject({ operator: 'contains', value: '' });
    expect(defaultFilterFor(prop('multiSelect'))).toMatchObject({ operator: 'contains', value: [] });
    expect(typeof defaultFilterFor(prop('text')).id).toBe('string');
  });

  it('names a pill by its property alone until it has a value', () => {
    expect(filterPillLabel({ propertyId: 'p', operator: 'contains', value: '' }, prop('text'), t)).toBe('Due');
    expect(filterPillLabel({ propertyId: 'p', operator: 'contains', value: 'abc' }, prop('text'), t)).toBe('Due: abc');
    expect(filterPillLabel({ propertyId: 'p', operator: 'is_not_empty', value: null }, prop('text'), t)).toBe('Due: tools.database.filterOpIsNotEmpty');
    expect(filterPillLabel({ propertyId: 'p', operator: 'this_week', value: null }, prop('date'), t)).toBe('Due: tools.database.filterDateThisWeek');
    expect(filterPillLabel({ propertyId: 'p', operator: 'equals', value: 'tomorrow' }, prop('date'), t)).toBe('Due: tools.database.filterDateTomorrow');
    expect(filterPillLabel({ propertyId: 'p', operator: 'equals', value: true }, prop('checkbox'), t)).toBe('Due: tools.database.filterChecked');
  });

  it('shows option labels on a select pill', () => {
    const select = prop('select', { config: { options: [{ id: 'o1', label: 'Idea', position: 'a0' }, { id: 'o2', label: 'Ship', position: 'a1' }] } });

    expect(filterPillLabel({ propertyId: 'p', operator: 'equals', value: ['o1', 'o2'] }, select, t)).toBe('Due: Idea, Ship');
  });

  it('labels sort directions per type (research/08)', () => {
    expect(sortDirectionLabelKey('number', 'asc')).toBe('tools.database.sortLowHigh');
    expect(sortDirectionLabelKey('date', 'desc')).toBe('tools.database.sortNewOld');
    expect(sortDirectionLabelKey('select', 'asc')).toBe('tools.database.sortAscending');
    expect(sortDirectionLabelKey('text', 'desc')).toBe('tools.database.sortZA');
  });
});

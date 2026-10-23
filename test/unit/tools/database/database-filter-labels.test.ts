import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  defaultFilterFor,
  filterPillLabel,
  menuOperatorOf,
  operatorChoices,
  operatorLabelKey,
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
    expect(operatorChoices('number')[0].labelKey).toBe('tools.database.filterOperator.numberEquals');
  });

  it('offers only "Is empty" and "Is not empty" on a place, starting at "Is not empty" (research/20 §1d)', () => {
    expect(operatorChoices('place').map((c) => c.operator)).toEqual(['is_empty', 'is_not_empty']);
    expect(defaultFilterFor(prop('place'))).toMatchObject({ operator: 'is_not_empty', value: null });
  });

  it('starts a date filter at "This week", as Notion\'s default pill reads', () => {
    expect(defaultFilterFor(prop('date'))).toMatchObject({ propertyId: 'p', operator: 'this_week', value: null });
    expect(defaultFilterFor(prop('text'))).toMatchObject({ operator: 'contains', value: '' });
    expect(defaultFilterFor(prop('multiSelect'))).toMatchObject({ operator: 'contains', value: [] });
    expect(typeof defaultFilterFor(prop('text')).id).toBe('string');
  });

  it('names a pill by its property alone until it has a value', () => {
    expect(filterPillLabel({ operator: 'contains', value: '' }, prop('text'), t)).toBe('Due');
    expect(filterPillLabel({ operator: 'contains', value: 'abc' }, prop('text'), t)).toBe('Due: abc');
    expect(filterPillLabel({ operator: 'is_not_empty', value: null }, prop('text'), t)).toBe('Due: tools.database.filterOperator.isNotEmpty');
    expect(filterPillLabel({ operator: 'this_week', value: null }, prop('date'), t)).toBe('Due: tools.database.filterDateThisWeek');
    expect(filterPillLabel({ operator: 'equals', value: 'tomorrow' }, prop('date'), t)).toBe('Due: tools.database.filterDateTomorrow');
    expect(filterPillLabel({ operator: 'equals', value: true }, prop('checkbox'), t)).toBe('Due: tools.database.filterChecked');
  });

  it('shows option labels on a select pill', () => {
    const select = prop('select', { config: { options: [{ id: 'o1', label: 'Idea', position: 'a0' }, { id: 'o2', label: 'Ship', position: 'a1' }] } });

    expect(filterPillLabel({ operator: 'equals', value: ['o1', 'o2'] }, select, t)).toBe('Due: Idea, Ship');
  });

  it('covers every Phase 2 type with Notion\'s menu (research/04 §2, research/08)', () => {
    expect(operatorChoices('status').map((c) => c.operator)).toEqual(['equals', 'does_not_equal']);
    expect(operatorChoices('person').map((c) => c.operator)).toEqual(['contains', 'does_not_contain', 'is_empty', 'is_not_empty']);
    expect(operatorChoices('createdBy').map((c) => c.operator)).toEqual(['contains', 'does_not_contain', 'is_empty', 'is_not_empty']);
    expect(operatorChoices('files').map((c) => c.operator)).toEqual(['is_empty', 'is_not_empty']);
    expect(operatorChoices('email').map((c) => c.operator)).toEqual(operatorChoices('text').map((c) => c.operator));
    expect(operatorChoices('uniqueId').map((c) => c.operator)).toEqual([
      'equals', 'does_not_equal', 'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to',
    ]);
    expect(operatorChoices('createdTime')).toEqual(operatorChoices('date'));
    expect(defaultFilterFor(prop('person'))).toMatchObject({ operator: 'contains', value: [] });
    expect(defaultFilterFor(prop('files'))).toMatchObject({ operator: 'is_not_empty' });
    expect(defaultFilterFor(prop('lastEditedTime'))).toMatchObject({ operator: 'this_week' });
  });

  it('names "Me" and known people on a person pill', () => {
    const names = (id: string): string | undefined => (id === 'u1' ? 'Ada' : undefined);

    expect(filterPillLabel({ operator: 'contains', value: ['me', 'u1'] }, prop('person'), t, names)).toBe('Due: tools.database.filterMe, Ada');
  });

  it('names "This page" and known rows on a relation pill (research/13 §1c)', () => {
    const rows = (id: string): string | undefined => (id === 'r1' ? 'One' : undefined);

    expect(filterPillLabel({ operator: 'contains', value: ['this_page', 'r1'] }, prop('relation'), t, undefined, rows)).toBe('Due: tools.database.filterThisPage, One');
  });

  it('labels sort directions per type (research/08)', () => {
    expect(sortDirectionLabelKey('number', 'asc')).toBe('tools.database.sortLowHigh');
    expect(sortDirectionLabelKey('date', 'desc')).toBe('tools.database.sortNewOld');
    expect(sortDirectionLabelKey('select', 'asc')).toBe('tools.database.sortAscending');
    expect(sortDirectionLabelKey('text', 'desc')).toBe('tools.database.sortZA');
    expect(sortDirectionLabelKey('uniqueId', 'asc')).toBe('tools.database.sortLowHigh');
    expect(sortDirectionLabelKey('createdTime', 'desc')).toBe('tools.database.sortNewOld');
    expect(sortDirectionLabelKey('email', 'asc')).toBe('tools.database.sortAZ');
    expect(sortDirectionLabelKey('status', 'desc')).toBe('tools.database.sortDescending');
    expect(sortDirectionLabelKey('person', 'asc')).toBe('tools.database.sortAscending');
    expect(sortDirectionLabelKey('checkbox', 'asc')).toBe('tools.database.sortAscending');
  });
  it('lists Notion\'s date operators, with "Is between" and no "Is not" or "Is within" (findings V18)', () => {
    expect(operatorChoices('date').map((c) => c.operator)).toEqual([
      'equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_between', 'relative_to_today', 'is_empty', 'is_not_empty',
    ]);
    expect(operatorChoices('date')[5].labelKey).toBe('tools.database.filterOperator.isBetween');
  });

  it('still names the operators of old saved date filters', () => {
    expect(operatorLabelKey('date', 'does_not_equal')).toBe('tools.database.filterOperator.isNot');
    expect(operatorLabelKey('date', 'past_month')).toBe('tools.database.filterOperator.isRelativeToToday');
    expect(menuOperatorOf('this_week')).toBe('relative_to_today');
    expect(filterPillLabel({ operator: 'does_not_equal', value: 'today' }, prop('date'), t)).toBe('Due: tools.database.filterDateToday');
    expect(filterPillLabel({ operator: 'past_month', value: null }, prop('date'), t)).toBe('Due: tools.database.filterDatePastMonth');
  });

  it('labels a "this" span and a "between" range on the chip', () => {
    expect(filterPillLabel({ operator: 'relative_to_today', value: 'this:1:month' }, prop('date'), t)).toBe('Due: tools.database.filterDateThisMonth');
    expect(filterPillLabel({ operator: 'relative_to_today', value: 'this:1:week' }, prop('date'), t)).toBe('Due: tools.database.filterDateThisWeek');
    expect(filterPillLabel({ operator: 'relative_to_today', value: 'this:1:day' }, prop('date'), t)).toBe('Due: tools.database.filterDateToday');
    expect(filterPillLabel({ operator: 'is_between', value: '2026-10-01/2026-10-07' }, prop('date'), t)).toBe('Due: 2026-10-01 → 2026-10-07');
    expect(filterPillLabel({ operator: 'is_between', value: null }, prop('date'), t)).toBe('Due');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  defaultFilterFor,
  filterPillLabel,
  filterPillParts,
  menuOperatorOf,
  operatorChoices,
  operatorChoicesFor,
  operatorLabelKey,
  operatorNeedsValue,
  quantifierChoices,
  sortDirectionLabelKey,
} from '../../../../src/tools/database/database-filter-labels';
import { PAGE_LIST_ROLLUP } from '../../../../src/shared/database/value-helpers';
import type { DatabaseRow, FilterConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { I18n } from '../../../../src/components/modules/i18n';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import { rowMatchesFilters } from '../../../../src/shared/database/database-query';

/** Echoes the key and its vars, so a test reads which key a label used. */
const t = (key: string, vars?: Record<string, string | number>): string =>
  vars === undefined ? key : `${key}(${Object.values(vars).join(',')})`;

const prop = (type: PropertyDefinition['type'], extra: Partial<PropertyDefinition> = {}): PropertyDefinition =>
  ({ id: 'p', name: 'Due', type, position: 'a0', ...extra });

describe('database filter labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A chip prints the year only for another year, so the 2026 days below need 2026 to be now.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 13));
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('starts a Created time filter at "is" with no value (notion-motion.md Round 13, r13-filter-ops-created.png)', () => {
    expect(defaultFilterFor(prop('createdTime'))).toMatchObject({ operator: 'equals', value: null });
    expect(filterPillLabel({ operator: 'equals', value: null }, prop('createdTime'), t)).toBe('Due');
  });

  it('writes the operator into a text or number pill: "Name: Contains a", "Number = 5" (notion-motion.md Round 18 §2)', () => {
    const en = (key: string): string => ({ 'tools.database.filterOperator.contains': 'Contains', 'tools.database.filterOperator.numberEquals': '=', 'tools.database.filterOperator.greaterThan': '>' }[key] ?? key);

    expect(filterPillLabel({ operator: 'contains', value: 'a' }, prop('title', { name: 'Name' }), en)).toBe('Name: Contains a');
    expect(filterPillLabel({ operator: 'equals', value: 5 }, prop('number', { name: 'Number' }), en)).toBe('Number = 5');
    expect(filterPillLabel({ operator: 'greater_than', value: 5 }, prop('number', { name: 'Number' }), en)).toBe('Number > 5');
    expect(filterPillParts({ operator: 'contains', value: 'a' }, prop('title', { name: 'Name' }), en)).toEqual({ name: 'Name', colon: true, value: 'Contains a' });
    expect(filterPillParts({ operator: 'equals', value: 5 }, prop('number', { name: 'Number' }), en)).toEqual({ name: 'Number', colon: false, value: '= 5' });
    expect(filterPillParts({ operator: 'contains', value: '' }, prop('title', { name: 'Name' }), en)).toEqual({ name: 'Name', colon: false, value: '' });
  });

  it('names a pill by its property alone until it has a value', () => {
    expect(filterPillLabel({ operator: 'contains', value: '' }, prop('text'), t)).toBe('Due');
    expect(filterPillLabel({ operator: 'contains', value: 'abc' }, prop('text'), t)).toBe('Due: tools.database.filterOperator.contains abc');
    expect(filterPillLabel({ operator: 'is_not_empty', value: null }, prop('text'), t)).toBe('Due: tools.database.filterOperator.isNotEmpty');
    expect(filterPillLabel({ operator: 'this_week', value: null }, prop('date'), t)).toBe('Due: tools.database.filterDateThisWeek');
    expect(filterPillLabel({ operator: 'equals', value: 'tomorrow' }, prop('date'), t)).toBe('Due: tools.database.filterDateTomorrow');
    expect(filterPillLabel({ operator: 'equals', value: true }, prop('checkbox'), t)).toBe('Due: tools.database.filterChecked');
  });

  // notion-motion.md Round 19 §2 (r19-cb-new.raw, r19-cb-new-bar.raw): a new Checkbox filter has no value, a gray "Checkbox" chip, and hides nothing.
  it('starts a Checkbox filter with no value, so it hides no rows', () => {
    const box = prop('checkbox', { name: 'Checkbox' });
    const filter = defaultFilterFor(box);
    const rows = [true, false].map((checked, i): DatabaseRow => ({ id: `r${i}`, position: `a${i}`, properties: { p: checked } }));

    expect(filter).toMatchObject({ operator: 'equals', value: null });
    expect(filterPillLabel(filter, box, t)).toBe('Checkbox');
    expect(rows.filter((row) => rowMatchesFilters(row, [filter], [box]))).toHaveLength(2);
  });

  // A saved value comes from document data: a day that is not on the calendar prints raw, and never throws.
  it.each(['2026-13-45', '2026-02-30', '2026-02-30T99', '2026-11-10T25:00'])('prints the impossible day "%s" as saved', (day) => {
    expect(filterPillLabel({ operator: 'before', value: day }, prop('date'), t, undefined, undefined, 'en-US')).toBe(`Due: tools.database.filterPillBefore(${day})`);
    expect(filterPillLabel({ operator: 'is_between', value: `${day}/2026-11-10` }, prop('date'), t, undefined, undefined, 'en-US')).toBe(`Due: ${day} → Nov 10`);
    expect(filterPillLabel({ operator: 'is_between', value: `2026-11-03/${day}` }, prop('date'), t, undefined, undefined, 'en-US')).toBe(`Due: Nov 3 → ${day}`);
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
    // notion-motion.md Round 13 (r13-filter-ops-id.raw): =, ≠, >, <, ≥, ≤, Is empty, Is not empty.
    expect(operatorChoices('uniqueId').map((c) => c.operator)).toEqual([
      'equals', 'does_not_equal', 'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to', 'is_empty', 'is_not_empty',
    ]);
    expect(operatorChoices('createdTime')).toEqual(operatorChoices('date'));
    expect(defaultFilterFor(prop('person'))).toMatchObject({ operator: 'contains', value: [] });
    expect(defaultFilterFor(prop('files'))).toMatchObject({ operator: 'is_not_empty' });
    // notion-motion.md Round 20 §1 (r20-let.raw): "is" with no date, like Created time.
    expect(defaultFilterFor(prop('lastEditedTime'))).toMatchObject({ operator: 'equals', value: null });
  });

  it('names "Me" and known people on a person pill', () => {
    const names = (id: string): string | undefined => (id === 'u1' ? 'Ada' : undefined);

    expect(filterPillLabel({ operator: 'contains', value: ['me', 'u1'] }, prop('person'), t, names)).toBe('Due: tools.database.filterOperator.contains tools.database.filterMe, Ada');
  });

  it('names "This page" and known rows on a relation pill (research/13 §1c)', () => {
    const rows = (id: string): string | undefined => (id === 'r1' ? 'One' : undefined);

    expect(filterPillLabel({ operator: 'contains', value: ['this_page', 'r1'] }, prop('relation'), t, undefined, rows)).toBe('Due: tools.database.filterOperator.contains tools.database.filterThisPage, One');
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
    expect(filterPillLabel({ operator: 'does_not_equal', value: 'today' }, prop('date'), t)).toBe('Due: tools.database.filterPillNot(tools.database.filterDateToday)');
    expect(filterPillLabel({ operator: 'past_month', value: null }, prop('date'), t)).toBe('Due: tools.database.filterDatePastMonth');
  });

  it('labels a "this" span and a "between" range on the chip', () => {
    expect(filterPillLabel({ operator: 'relative_to_today', value: 'this:1:month' }, prop('date'), t)).toBe('Due: tools.database.filterDateThisMonth');
    expect(filterPillLabel({ operator: 'relative_to_today', value: 'this:1:week' }, prop('date'), t)).toBe('Due: tools.database.filterDateThisWeek');
    expect(filterPillLabel({ operator: 'relative_to_today', value: 'this:1:day' }, prop('date'), t)).toBe('Due: tools.database.filterDateToday');
    expect(filterPillLabel({ operator: 'is_between', value: '2026-10-01/2026-10-07' }, prop('date'), t, undefined, undefined, 'en-US')).toBe('Due: Oct 1 → Oct 7');
    expect(filterPillLabel({ operator: 'is_between', value: null }, prop('date'), t)).toBe('Due');
  });

  // notion-motion.md Round 13 (r13-filter-ops-rollup*.raw, r13-filter-ops-rollup.png): Any / None / Every, then the URL list.
  describe('a rollup of the Name', () => {
    const names = Object.assign(prop('relation', { name: 'Names', rollup: { relationPropertyId: 'rel', targetPropertyId: 't', function: 'show_original' } }), { [PAGE_LIST_ROLLUP]: true });

    it('lists Any, None, Every, then the text operators', () => {
      expect(quantifierChoices().map((c) => c.operator)).toEqual(['any', 'none', 'every']);
      expect(quantifierChoices().map((c) => c.labelKey)).toEqual([
        'tools.database.filterOperator.any', 'tools.database.filterOperator.none', 'tools.database.filterOperator.every',
      ]);
      expect(operatorChoicesFor(names, 'any:contains').map((c) => c.operator)).toEqual(operatorChoices('url').map((c) => c.operator));
      // A filter saved before the text quantifiers keeps the id quantifiers.
      expect(operatorChoicesFor(names, 'any').map((c) => c.operator)).toEqual(['any', 'none', 'every', 'is_empty', 'is_not_empty']);
    });

    it('starts at any + contains with no text', () => {
      expect(defaultFilterFor(names)).toMatchObject({ operator: 'any:contains', value: '' });
    });

    it('names the text operator and shows the typed text on the pill', () => {
      expect(operatorLabelKey('relation', 'none:starts_with')).toBe('tools.database.filterOperator.startsWith');
      expect(menuOperatorOf('every:contains')).toBe('contains');
      expect(operatorNeedsValue('any:is_empty')).toBe(false);
      expect(operatorNeedsValue('any:contains')).toBe(true);
      expect(filterPillLabel({ operator: 'any:contains', value: 'des' }, names, t)).toBe('Names: des');
      expect(filterPillLabel({ operator: 'any:contains', value: '' }, names, t)).toBe('Names');
      expect(filterPillLabel({ operator: 'none:is_empty', value: null }, names, t)).toBe('Names: tools.database.filterOperator.isEmpty');
    });

    it('keeps the id quantifiers on other rollup lists, in Notion\'s order', () => {
      const tags = prop('multiSelect', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'tags', function: 'show_original' } });

      expect(operatorChoicesFor(tags, 'any').map((c) => c.operator)).toEqual(['any', 'none', 'every', 'is_empty', 'is_not_empty']);
      expect(defaultFilterFor(tags)).toMatchObject({ operator: 'any', value: [] });
    });
  });

  // notion-motion.md Round 13 (r13-filter-ops-date.raw): a Date filter's End date side.
  it('reads an End date filter by its operator', () => {
    expect(operatorLabelKey('date', 'end:past_month')).toBe('tools.database.filterOperator.isRelativeToToday');
    expect(menuOperatorOf('end:this_week')).toBe('relative_to_today');
    expect(operatorNeedsValue('end:is_between')).toBe(true);
    expect(operatorNeedsValue('end:is_empty')).toBe(false);
    expect(filterPillLabel({ operator: 'end:this_week', value: null }, prop('date'), t)).toBe('Due: tools.database.filterDateThisWeek');
    expect(filterPillLabel({ operator: 'end:equals', value: 'today' }, prop('date'), t)).toBe('Due: tools.database.filterDateToday');
  });
});

// notion-motion.md Round 19 §2 (views-kit/notion-live/r19-<name>-bar.raw): every chip text read off Notion.
describe('filter chip text, as Notion prints it', () => {
  const sel = prop('select', { name: 'Select', config: { options: [{ id: 'r', label: 'Red', position: 'a0' }] } });
  const ms = prop('multiSelect', { name: 'Multi-select', config: { options: [{ id: 'o1', label: 'One', position: 'a0' }, { id: 'o2', label: 'OTwo', position: 'a1' }] } });
  const text = prop('text', { name: 'Text' });
  const num = prop('number', { name: 'Number' });
  const date = prop('date', { name: 'Date' });
  const box = prop('checkbox', { name: 'Checkbox' });
  const person = prop('person', { name: 'Person' });
  const rel = prop('relation', { name: 'Relation' });
  const ct = prop('createdTime', { name: 'Created time' });
  const st = prop('status', { name: 'Status', config: { options: [
    { id: 's1', label: 'Not started', position: 'a0', groupId: 'todo' },
    { id: 's2', label: 'In progress', position: 'a0', groupId: 'inProgress' },
    { id: 's3', label: 'Done', position: 'a0', groupId: 'complete' },
    { id: 's4', label: 'Archived', position: 'a1', groupId: 'complete' },
  ] } });
  const rows = (id: string): string | undefined => ({ a: 'Alpha', b: 'Beta' } as Record<string, string>)[id];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 13));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const cases: Array<[string, { operator: string; value: unknown }, PropertyDefinition]> = [
    ['Text: a', { operator: 'equals', value: 'a' }, text],
    ['Text: Not a', { operator: 'does_not_equal', value: 'a' }, text],
    ['Text: Contains a', { operator: 'contains', value: 'a' }, text],
    ['Text: Does not contain a', { operator: 'does_not_contain', value: 'a' }, text],
    ['Text: Starts with a', { operator: 'starts_with', value: 'a' }, text],
    ['Text: Ends with a', { operator: 'ends_with', value: 'a' }, text],
    ['Text: Is empty', { operator: 'is_empty', value: null }, text],
    ['Text: Is not empty', { operator: 'is_not_empty', value: null }, text],
    ['Number = 5', { operator: 'equals', value: 5 }, num],
    ['Number ≠ 5', { operator: 'does_not_equal', value: 5 }, num],
    ['Number > 5', { operator: 'greater_than', value: 5 }, num],
    ['Number: Is empty', { operator: 'is_empty', value: null }, num],
    ['Select: Red', { operator: 'equals', value: ['r'] }, sel],
    ['Select: Not Red', { operator: 'does_not_equal', value: ['r'] }, sel],
    ['Select: Is empty', { operator: 'is_empty', value: null }, sel],
    ['Select: Is not empty', { operator: 'is_not_empty', value: null }, sel],
    ['Multi-select: Contains One, OTwo', { operator: 'contains', value: ['o1', 'o2'] }, ms],
    ['Multi-select: Does not contain One, OTwo', { operator: 'does_not_contain', value: ['o1', 'o2'] }, ms],
    ['Date: Nov 10', { operator: 'equals', value: '2026-11-10' }, date],
    ['Date: Before Nov 10', { operator: 'before', value: '2026-11-10' }, date],
    ['Date: After Nov 10', { operator: 'after', value: '2026-11-10' }, date],
    ['Date: On or before Nov 10', { operator: 'on_or_before', value: '2026-11-10' }, date],
    ['Date: On or after Nov 10', { operator: 'on_or_after', value: '2026-11-10' }, date],
    ['Date: Nov 3 → Nov 10', { operator: 'is_between', value: '2026-11-03/2026-11-10' }, date],
    ['Date: This week', { operator: 'relative_to_today', value: 'this:1:week' }, date],
    ['Date: Past week', { operator: 'relative_to_today', value: 'past:1:week' }, date],
    ['Date: Past month', { operator: 'relative_to_today', value: 'past:1:month' }, date],
    ['Date: Past 3 months', { operator: 'relative_to_today', value: 'past:3:month' }, date],
    ['Date: Next 3 months', { operator: 'relative_to_today', value: 'next:3:month' }, date],
    ['Date: Is empty', { operator: 'is_empty', value: null }, date],
    ['Date: Is not empty', { operator: 'is_not_empty', value: null }, date],
    ['Checkbox: Checked', { operator: 'equals', value: true }, box],
    ['Checkbox: Unchecked', { operator: 'equals', value: false }, box],
    ['Checkbox: Not Checked', { operator: 'does_not_equal', value: true }, box],
    ['Person: Contains Me', { operator: 'contains', value: ['me'] }, person],
    // Round 20 §1 (r20-rel-a-bar.raw, r20-rel-ab-bar.raw, r20-rel-dnc-bar.raw, r20-rel-empty-bar.raw).
    ['Relation: Contains Alpha', { operator: 'contains', value: ['a'] }, rel],
    ['Relation: Contains Alpha, Beta', { operator: 'contains', value: ['a', 'b'] }, rel],
    ['Relation: Does not contain Alpha, Beta', { operator: 'does_not_contain', value: ['a', 'b'] }, rel],
    ['Relation: Is empty', { operator: 'is_empty', value: null }, rel],
    // Round 20 §1 (r20-st-grp-bar.raw, r20-st-ord-bar.raw, r20-st-isnot-bar.raw): a fully ticked group shows its name, in pick order.
    ['Status: Done', { operator: 'equals', value: ['s3'] }, st],
    ['Status: Complete', { operator: 'equals', value: ['s3', 's4'] }, st],
    ['Status: In progress', { operator: 'equals', value: ['s2'] }, st],
    ['Status: To-do, Complete', { operator: 'equals', value: ['s1', 's4', 's3'] }, st],
    ['Status: Complete, To-do', { operator: 'equals', value: ['s4', 's1', 's3'] }, st],
    ['Status: Not To-do, Complete', { operator: 'does_not_equal', value: ['s1', 's3', 's4'] }, st],
    // Round 20 §1: another year prints it (r20-ct-2025-bar.raw, r20-ct-before-bar.raw, r20-ct-oa-bar.raw, r20-date-end-bar.raw, r20-date-end-before-bar.raw).
    ['Created time: Mar 5, 2025', { operator: 'equals', value: '2025-03-05' }, ct],
    ['Created time: Before Mar 5, 2025', { operator: 'before', value: '2025-03-05' }, ct],
    ['Created time: On or after Mar 5, 2025', { operator: 'on_or_after', value: '2025-03-05' }, ct],
    ['Date: Mar 5, 2025', { operator: 'end:equals', value: '2025-03-05' }, date],
    ['Date: Before Mar 5, 2025', { operator: 'end:before', value: '2025-03-05' }, date],
  ];

  it.each(cases)('prints "%s"', async (want, filter, property) => {
    const i18n = new I18n({ config: {}, eventsDispatcher: new EventsDispatcher() });

    await i18n.prepare();

    expect(filterPillLabel(filter as FilterConfig, property, (key, vars) => i18n.t(key, vars), undefined, rows, 'en-US')).toBe(want);
  });
});

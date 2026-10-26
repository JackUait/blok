/**
 * The values a new row takes from its view's filters, so the filter does not
 * hide it. The editor's New buttons and the agent's database.addRow share it.
 */
import { relativeWindow, resolveDay } from './relative-dates';
import { personIdsOf } from './value-helpers';

import type { DatabaseViewConfig, FilterConfig, FilterRule, PropertyDefinition, PropertyType, PropertyValue } from './types';

/** A person filter's value for the current user (Notion API `"me"`). */
export const ME_FILTER_VALUE = 'me';

/** A relation filter's value for the row page the view is shown on. */
export const THIS_PAGE_FILTER_VALUE = 'this_page';

/** Today in the viewer's zone, as a stored date. */
const todayValue = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const shiftDay = (day: string, by: number): string => {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + by));

  return shifted.toISOString().slice(0, 10);
};

const toNumber = (value: PropertyValue | undefined): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * A date a new row can take and still pass the filter: the day itself, the
 * day past a strict bound, or today when today is in a relative window (a
 * "this week" filter fills today, as Notion does, research/08).
 */
const dateTargetValue = (operator: string, target: PropertyValue, now: Date): string | undefined => {
  if (operator === 'is_not_empty') {
    return todayValue(now);
  }
  const window = relativeWindow(operator, target, now);

  if (window !== undefined) {
    const today = todayValue(now);

    return window.from <= today && today <= window.to ? today : window.from;
  }
  const day = resolveDay(target, now);

  if (day === undefined) return undefined;

  switch (operator) {
    case 'equals':
    case 'on_or_before':
    case 'on_or_after':
      return day;
    case 'before': return shiftDay(day, -1);
    case 'after': return shiftDay(day, 1);
    default: return undefined;
  }
};

/** The value an `equals` filter asks for, or `undefined` when a new row cannot take it. */
const filterTargetValue = (type: PropertyType | undefined, operator: string, target: PropertyValue, me: string | null, page: string | null, now: Date): PropertyValue | undefined => {
  if (type === 'date') {
    return dateTargetValue(operator, target, now);
  }
  // A relation tab's new row links to its page, or its own filter would hide it.
  if (operator === 'contains' && type === 'relation' && page !== null && page !== '' && personIdsOf(target).includes(THIS_PAGE_FILTER_VALUE)) {
    return [{ id: page }];
  }
  if (operator === 'contains' && type === 'person') {
    const id = personIdsOf(target).map((each) => (each === ME_FILTER_VALUE ? me ?? '' : each)).find((each) => each !== '');

    return id === undefined ? undefined : [{ id }];
  }
  if (operator !== 'equals') return undefined;

  switch (type) {
    case 'select':
    case 'status':
      return personIdsOf(target)[0];
    case 'checkbox': return typeof target === 'boolean' ? target : undefined;
    case 'text':
    case 'email':
    case 'phone':
      return typeof target === 'string' && target !== '' ? target : undefined;
    case 'number': return toNumber(target);
    case 'title':
    case 'url':
    case 'richText':
    case 'multiSelect':
    case 'person':
    case 'files':
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
    case 'uniqueId':
    case 'relation':
    case 'formula':
    case 'rollup':
    case 'button':
    case 'place':
    case 'verification':
    case undefined:
      return undefined;
  }
};

/**
 * Values a new row takes from the view's `equals` filters (and a person or a "This page" relation
 * `contains`), as Notion does, so the filter does not hide the row on the
 * next redraw.
 */
export const newRowValues = (
  filters: FilterConfig[], schema: PropertyDefinition[], me: string | null = null, page: string | null = null, now: Date = new Date()
): Record<string, PropertyValue> =>
  Object.fromEntries(filters.flatMap((filter) => {
    const value = filterTargetValue(schema.find((p) => p.id === filter.propertyId)?.type, filter.operator, filter.value, me, page, now);

    return value === undefined ? [] : [[filter.propertyId, value]];
  }));

/**
 * The filters a new row is filled to pass: the simple ones, and an AND tree's
 * top-level rules, which must all hold. `skip` drops the properties a clicked
 * group sets instead.
 */
export const prefillFilters = (view: DatabaseViewConfig | undefined, skip: ReadonlyArray<string | undefined> = []): FilterConfig[] => {
  const treeRules = view?.filterTree?.conjunction === 'and'
    ? view.filterTree.filterRules.filter((node): node is FilterRule => !('filterRules' in node))
    : [];

  return [...(view?.filters ?? []), ...treeRules].filter((filter) => !skip.includes(filter.propertyId));
};

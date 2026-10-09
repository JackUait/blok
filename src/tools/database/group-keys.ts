import { parseDateValue } from './cells/date-value';
import { toLocalDay } from './relative-dates';
import { personIdsOf } from './property-values';
import type { GroupSettings, GroupSort, PropertyDefinition, PropertyType, PropertyValue, SelectOption } from './types';

/**
 * Group key for rows with no value. Not '' because card drag reads a missing
 * data-option-id as ''. 23 chars, so a default 21-char nanoid option id never equals it.
 */
export const NO_VALUE_GROUP_KEY = '__blok-no-value-group__';

/** Rich text holds a document, which has no group. Notion also leaves out Files, Button and ID (research/08). */
export const GROUPABLE_TYPES: readonly PropertyType[] = [
  'title', 'text', 'number', 'select', 'multiSelect', 'status', 'date', 'checkbox', 'url', 'email', 'phone',
  'person', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy',
];

const DATE_LIKE: readonly PropertyType[] = ['date', 'createdTime', 'lastEditedTime'];

const OPTION_LIKE: readonly PropertyType[] = ['select', 'multiSelect', 'status'];

const PERSON_LIKE: readonly PropertyType[] = ['person', 'createdBy', 'lastEditedBy'];

/** Notion's defaults per type (research/08): options keep manual order, numbers and dates go up. */
export const defaultGroupSort = (type: PropertyType): GroupSort =>
  type === 'number' || type === 'checkbox' || DATE_LIKE.includes(type) ? 'ascending' : 'manual';

/** Notion's API default bucket is unknown; 0 to 1000 in steps of 100 is a guess. */
const DEFAULT_RANGE = { start: 0, end: 1000, size: 100 };

const rangeOf = (settings: GroupSettings): { start: number; end: number; size: number } => {
  const size = typeof settings.rangeSize === 'number' && settings.rangeSize >= 1 ? settings.rangeSize : DEFAULT_RANGE.size;
  const start = typeof settings.rangeStart === 'number' && Number.isFinite(settings.rangeStart) ? settings.rangeStart : DEFAULT_RANGE.start;
  const end = typeof settings.rangeEnd === 'number' && settings.rangeEnd > start ? settings.rangeEnd : Math.max(start + size, DEFAULT_RANGE.end);

  return { start, end, size };
};

const toNumber = (value: PropertyValue | undefined): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const n = Number(value);

  return Number.isFinite(n) ? n : undefined;
};

/** The local day of a created or edited time, stored as an ISO instant. */
const instantDay = (value: PropertyValue | undefined): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined;
  const time = Date.parse(value);

  if (Number.isNaN(time)) return undefined;
  const date = new Date(time);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const dayToDate = (day: string): Date => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

const addDays = (day: string, days: number): string => {
  const date = dayToDate(day);

  date.setDate(date.getDate() + days);

  return toLocalDay(date);
};

type RelativeBucket = 'rel:last_30_days' | 'rel:last_7_days' | 'rel:today' | 'rel:next_7_days' | 'rel:next_30_days';

/** Notion's relative groups seen in research/08; anything further out falls into its month. */
const relativeKey = (day: string, now: Date): string => {
  const today = toLocalDay(now);

  if (day === today) return 'rel:today';
  if (day < today && day >= addDays(today, -7)) return 'rel:last_7_days';
  if (day < today && day >= addDays(today, -30)) return 'rel:last_30_days';
  if (day > today && day <= addDays(today, 7)) return 'rel:next_7_days';
  if (day > today && day <= addDays(today, 30)) return 'rel:next_30_days';

  return `month:${day.slice(0, 7)}`;
};

const dateKey = (day: string, settings: GroupSettings, now: Date): string => {
  switch (settings.dateBy ?? 'relative') {
    case 'day': return `day:${day}`;
    case 'week': {
      const date = dayToDate(day);
      const back = (date.getDay() - (settings.weekStart ?? 0) + 7) % 7;

      return `week:${addDays(day, -back)}`;
    }
    case 'month': return `month:${day.slice(0, 7)}`;
    case 'year': return `year:${day.slice(0, 4)}`;
    case 'relative': return relativeKey(day, now);
  }
};

const numberKey = (n: number, settings: GroupSettings): string => {
  if (settings.numberBy !== 'range') return String(n);
  const { start, end, size } = rangeOf(settings);

  if (n < start) return 'range:below';
  if (n >= end) return 'range:above';

  return `range:${start + Math.floor((n - start) / size) * size}`;
};

/**
 * The groups a row's value falls in. A key depends only on the value, the
 * settings and today, so every peer draws the same groups.
 */
export const groupKeysFor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  settings: GroupSettings,
  now: Date
): string[] => {
  switch (property.type) {
    case 'checkbox': return [value === true ? 'true' : 'false'];
    case 'multiSelect': return Array.isArray(value) && value.length > 0 ? [...value] : [NO_VALUE_GROUP_KEY];
    case 'select': return typeof value === 'string' && value !== '' ? [value] : [NO_VALUE_GROUP_KEY];
    case 'number': {
      const n = toNumber(value);

      return n === undefined ? [NO_VALUE_GROUP_KEY] : [numberKey(n, settings)];
    }
    case 'date': {
      const parsed = parseDateValue(value);

      return parsed === null ? [NO_VALUE_GROUP_KEY] : [dateKey(parsed.start.slice(0, 10), settings, now)];
    }
    case 'status': return typeof value === 'string' && value !== '' ? [value] : [NO_VALUE_GROUP_KEY];
    case 'person':
    case 'createdBy':
    case 'lastEditedBy': {
      const ids = personIdsOf(value);

      return ids.length > 0 ? ids : [NO_VALUE_GROUP_KEY];
    }
    case 'createdTime':
    case 'lastEditedTime': {
      const day = instantDay(value);

      return day === undefined ? [NO_VALUE_GROUP_KEY] : [dateKey(day, settings, now)];
    }
    case 'uniqueId': {
      const n = toNumber(value);

      return n === undefined ? [NO_VALUE_GROUP_KEY] : [String(n)];
    }
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone': {
      if (typeof value !== 'string' || value.trim() === '') return [NO_VALUE_GROUP_KEY];
      if (settings.textBy !== 'alphabet') return [value];
      const first = value.trim().charAt(0).toUpperCase();

      return [`alpha:${/\p{L}/u.test(first) ? first : '#'}`];
    }
    case 'richText':
    case 'files':
      return [NO_VALUE_GROUP_KEY];
  }
};

/** A sortable stand-in for a date key: its first day, or a fixed day for a relative bucket. */
const dateRank = (key: string, now: Date): string => {
  const today = toLocalDay(now);
  const relative: Record<RelativeBucket, string> = {
    'rel:last_30_days': addDays(today, -30),
    'rel:last_7_days': addDays(today, -7),
    'rel:today': today,
    'rel:next_7_days': addDays(today, 1),
    'rel:next_30_days': addDays(today, 8),
  };
  const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];

  if (kind === 'rel') return relative[key as RelativeBucket] ?? today;
  if (kind === 'month') return `${rest}-01`;
  if (kind === 'year') return `${rest}-01-01`;

  return rest;
};

const numberRank = (key: string): number => {
  if (key === 'range:below') return -Infinity;
  if (key === 'range:above') return Infinity;

  return Number(key.startsWith('range:') ? key.slice(6) : key);
};

/**
 * Groups in display order. On a select the no-value group goes last; for
 * number, text and date it goes first (research/08). `manual` keeps the
 * option order for selects and the given order otherwise.
 */
export const orderGroupKeys = (
  property: PropertyDefinition,
  keys: string[],
  settings: GroupSettings,
  now: Date = new Date(),
  /** The groups' options when they are not the property's own (status groups). */
  groupOptions?: SelectOption[]
): string[] => {
  const sort = settings.sort ?? defaultGroupSort(property.type);
  const real = keys.filter((key) => key !== NO_VALUE_GROUP_KEY);
  const hasEmpty = real.length < keys.length;
  const options = groupOptions ?? property.config?.options ?? [];
  const label = (key: string): string => options.find((o) => o.id === key)?.label ?? key;
  const isOptionType = OPTION_LIKE.includes(property.type);
  const position = (key: string): string => options.find((o) => o.id === key)?.position ?? '\uffff';
  // `<`, like getSelectOptions: localeCompare orders letter case differently.
  const byPosition = (a: string, b: string): number => (position(a) < position(b) ? -1 : Number(position(a) > position(b)));
  const compare = (a: string, b: string): number => {
    if (property.type === 'number' || property.type === 'uniqueId') return numberRank(a) - numberRank(b);
    if (DATE_LIKE.includes(property.type)) return dateRank(a, now).localeCompare(dateRank(b, now));
    if (property.type === 'checkbox') return Number(a === 'true') - Number(b === 'true');

    return label(a).localeCompare(label(b));
  };
  const sign = sort === 'descending' ? -1 : 1;
  // Status groups and options come in order already; their positions live in two key spaces.
  const manual = isOptionType && groupOptions === undefined ? [...real].sort(byPosition) : real;
  const listed = groupOptions === undefined ? manual : [...real].sort((a, b) => options.findIndex((o) => o.id === a) - options.findIndex((o) => o.id === b));
  const ordered = sort === 'manual' ? listed : [...real].sort((a, b) => compare(a, b) * sign);

  if (!hasEmpty) return ordered;

  // People group like options in Notion (research/08: "Jack Uait, No Owner").
  const emptyLast = isOptionType || property.type === 'checkbox' || PERSON_LIKE.includes(property.type);

  return emptyLast ? [...ordered, NO_VALUE_GROUP_KEY] : [NO_VALUE_GROUP_KEY, ...ordered];
};

/**
 * The value a row takes when it moves into a group, `null` to clear it, or
 * `undefined` when the group is a bucket that names no single value.
 */
export const groupValueForKey = (property: PropertyDefinition, key: string, settings: GroupSettings): PropertyValue | undefined => {
  if (key === NO_VALUE_GROUP_KEY) return property.type === 'multiSelect' ? [] : null;

  switch (property.type) {
    case 'select':
    case 'status':
      return key;
    case 'multiSelect': return [key];
    case 'person': return [{ id: key }];
    case 'checkbox': return key === 'true';
    case 'number': return settings.numberBy === 'range' ? undefined : toNumber(key);
    case 'date': return key.startsWith('day:') ? key.slice(4) : undefined;
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return settings.textBy === 'alphabet' ? undefined : key;
    case 'richText':
    case 'files':
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
    case 'uniqueId':
      return undefined;
  }
};

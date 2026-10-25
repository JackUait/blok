import { nanoid } from 'nanoid';
import { safeHref } from '../../components/utils/sanitize-url';
import {
  filesOf,
  isComputedType,
  isFileValue,
  isReadOnlyType,
  offersAutofill,
  personIdsOf,
  readPropertyValue,
} from '../../shared/database/value-helpers';
import {
  createDefaultStatusOptions as createSharedStatusOptions,
  createDefaultStatusSettings,
  isListValueType,
} from '../../shared/database/schema-ops';
import type {
  DatabaseRow,
  FileValue,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SelectOption,
  StatusGroup,
} from './types';

export { isListValueType, isReadOnlyType, createDefaultStatusSettings, filesOf, isComputedType, isFileValue, offersAutofill, personIdsOf, readPropertyValue };

/** A naive host `target[id] = value` swaps its prototype on these ids. */
const UNSAFE_PROPERTY_IDS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const OPTION_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['select', 'multiSelect', 'status']);

const isSafeFile = (entry: unknown): entry is FileValue =>
  typeof entry === 'object' && entry !== null &&
  'id' in entry && typeof entry.id === 'string' &&
  'name' in entry && typeof entry.name === 'string' &&
  'url' in entry && typeof entry.url === 'string' && safeHref(entry.url) !== null;

/** `value` itself when a host may store it, else a copy with the bad parts removed. */
const adapterSafeValue = (property: PropertyDefinition, value: PropertyValue): PropertyValue => {
  if (OPTION_TYPES.has(property.type)) {
    const known = new Set((property.config?.options ?? []).map((option) => option.id));

    if (typeof value === 'string') return known.has(value) ? value : null;
    if (!Array.isArray(value)) return value;
    const entries: unknown[] = value;
    const ids = entries.filter((id): id is string => typeof id === 'string' && known.has(id));

    return ids.length === entries.length ? value : ids;
  }
  if (property.type === 'url' && typeof value === 'string') return safeHref(value) === null ? null : value;
  if (property.type === 'files' && Array.isArray(value)) {
    const entries: unknown[] = value;
    const files = entries.filter(isSafeFile);

    return files.length === entries.length ? value : files;
  }

  return value;
};

/**
 * Row values fit for a host adapter: writable schema properties, known option
 * ids, link URLs that pass `safeHref`. Unsafe ids are dropped even with no
 * schema. `altered` is true when a kept value had to change: a replayed
 * update skips its write then, so the backend never gets half a value.
 */
export const adapterRowValues = (
  properties: Record<string, PropertyValue>,
  schema?: readonly PropertyDefinition[],
): { properties: Record<string, PropertyValue>; altered: boolean } => {
  const byId = new Map<string, PropertyDefinition>(schema?.map((property) => [property.id, property]));
  const kept = Object.entries(properties).flatMap(([id, value]): Array<[string, PropertyValue, PropertyValue]> => {
    if (UNSAFE_PROPERTY_IDS.has(id)) return [];
    if (schema === undefined) return [[id, value, value]];
    const property = byId.get(id);

    return property === undefined || isReadOnlyType(property.type) ? [] : [[id, value, adapterSafeValue(property, value)]];
  });

  return {
    properties: Object.fromEntries(kept.map(([id, , safe]) => [id, safe])),
    altered: kept.some(([, value, safe]) => safe !== value),
  };
};

/** `properties`, plus `[]` for every list property it holds no value for. */
export const withEmptyLists = (schema: PropertyDefinition[], properties: Record<string, PropertyValue>): Record<string, PropertyValue> => {
  const result = { ...properties };

  for (const property of schema) {
    if (isListValueType(property.type) && (result[property.id] === undefined || result[property.id] === null)) {
      result[property.id] = [];
    }
  }

  return result;
};

// ─── Status ───

export const STATUS_GROUP_KINDS = ['todo', 'inProgress', 'complete'] as const;

export const createDefaultStatusOptions = (labels: { notStarted: string; inProgress: string; done: string }): SelectOption[] =>
  createSharedStatusOptions(labels, () => nanoid());

const byPosition = <T extends { position: string }>(a: T, b: T): number => {
  if (a.position === b.position) return 0;

  return a.position < b.position ? -1 : 1;
};

export const statusGroupsOf = (property: PropertyDefinition): StatusGroup[] =>
  [...(property.status?.groups ?? createDefaultStatusSettings().groups)].sort(byPosition);

/** The group an option sits in. An option with no known group sits in the first one, as Notion puts new options in To-do. */
export const statusGroupOf = (property: PropertyDefinition, optionId: string): StatusGroup | undefined => {
  const groups = statusGroupsOf(property);
  const option = property.config?.options.find((o) => o.id === optionId);

  if (option === undefined) return undefined;

  return groups.find((g) => g.id === option.groupId) ?? groups[0];
};

/** Options of a status property in display order: by group, then by position inside the group. */
export const orderedStatusOptions = (property: PropertyDefinition): SelectOption[] => {
  const groups = statusGroupsOf(property);
  const rank = (option: SelectOption): number => {
    const index = groups.findIndex((g) => g.id === statusGroupOf(property, option.id)?.id);

    return index === -1 ? groups.length : index;
  };

  return [...(property.config?.options ?? [])].sort((a, b) => rank(a) - rank(b) || byPosition(a, b));
};

// ─── Unique ID ───

const isIdNumber = (value: PropertyValue | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * Creation order every peer agrees on: creation time (rows made before the
 * stamp existed come first), then position, then row id.
 */
const byCreation = (a: DatabaseRow, b: DatabaseRow): number => {
  const at = a.meta?.createdAt ?? -Infinity;
  const bt = b.meta?.createdAt ?? -Infinity;

  if (at !== bt) return at < bt ? -1 : 1;
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.id === b.id) return 0;

  return a.id < b.id ? -1 : 1;
};

/**
 * The ID of every row, as a pure function of the synced rows, so every peer
 * and every read-only viewer computes the same numbers.
 *
 * A stored number is kept by the earliest row (in creation order) that holds
 * it. Rows without one, and rows that lost a tie because two peers numbered
 * a row at the same moment, take the next numbers after the highest kept one,
 * in creation order. Writers persist the result as a derived write, so a
 * number never changes once two peers have seen each other's rows.
 *
 * Known limit: deleting the highest-numbered row lets the next new row reuse
 * its number (Notion never reuses one).
 */
export const assignUniqueIds = (rows: DatabaseRow[], propertyId: string): DatabaseRow[] => {
  const ordered = [...rows].sort(byCreation);
  const claimed = new Set<number>();
  const assigned = new Map<string, number>();
  const pending: DatabaseRow[] = [];

  for (const row of ordered) {
    const stored = row.properties[propertyId];

    if (isIdNumber(stored) && !claimed.has(stored)) {
      claimed.add(stored);
      assigned.set(row.id, stored);
    } else {
      pending.push(row);
    }
  }

  const next = { value: claimed.size === 0 ? 1 : Math.max(...claimed) + 1 };

  for (const row of pending) {
    assigned.set(row.id, next.value);
    next.value += 1;
  }

  return rows.map((row) => {
    const id = assigned.get(row.id);

    return id === undefined || row.properties[propertyId] === id
      ? row
      : { ...row, properties: { ...row.properties, [propertyId]: id } };
  });
};

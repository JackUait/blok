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

export { assignUniqueIds, orderedStatusOptions, statusGroupOf, statusGroupsOf } from '../../shared/database/value-helpers';
import {
  createDefaultStatusOptions as createSharedStatusOptions,
  createDefaultStatusSettings,
  isListValueType,
} from '../../shared/database/schema-ops';
import type {
  FileValue,
  PropertyDefinition,
  PropertyType,
  PropertyValue,
  SelectOption,
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

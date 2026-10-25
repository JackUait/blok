import type { DatabaseRow, FileValue, PersonValue, PropertyDefinition, PropertyType, PropertyValue } from './types';

/*
 * Pure value helpers shared by the editor (src/tools/database/property-values.ts
 * re-exports them) and the headless type change.
 */

/** Types whose value is computed from the row block, never stored in `properties`. */
export const COMPUTED_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(['createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy', 'formula', 'rollup']);

export const isComputedType = (type: PropertyType): boolean => COMPUTED_TYPES.has(type);

/** Types a person cannot edit in a cell. */
const READ_ONLY_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>([...COMPUTED_TYPES, 'uniqueId', 'button']);

export const isReadOnlyType = (type: PropertyType): boolean => READ_ONLY_TYPES.has(type);

/** research/08: the header menus that list AI Autofill. Checkbox is read off its row ("as Select, minus…"). */
const AUTOFILL_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>([
  'title', 'text', 'number', 'select', 'multiSelect', 'status', 'date', 'person', 'relation', 'checkbox',
]);

export const offersAutofill = (type: PropertyType): boolean => AUTOFILL_TYPES.has(type);

const isoOf = (ms: number | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

const personOf = (id: string | undefined): PersonValue[] =>
  typeof id === 'string' && id !== '' ? [{ id }] : [];

/**
 * The value a property shows for a row. Formula, rollup and relation values
 * come from `row.computed` (computed-properties.ts). The four metadata types
 * read the row block's metadata: a time as an ISO instant, a person as a
 * person value.
 */
export const readPropertyValue = (row: DatabaseRow, property: PropertyDefinition): PropertyValue | undefined => {
  if (row.computed !== undefined && Object.hasOwn(row.computed, property.id)) return row.computed[property.id];
  const meta = row.meta;

  if (property.type === 'createdTime') return isoOf(meta?.createdAt);
  if (property.type === 'lastEditedTime') return isoOf(meta?.lastEditedAt);
  if (property.type === 'createdBy') return personOf(meta?.createdBy);
  if (property.type === 'lastEditedBy') return personOf(meta?.lastEditedBy);

  return row.properties[property.id];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Person ids of a value. Takes `{id}` objects and, for values written by hand, bare ids. */
export const personIdsOf = (value: PropertyValue | undefined): string[] => {
  if (!Array.isArray(value)) {
    return typeof value === 'string' && value !== '' ? [value] : [];
  }

  return value.flatMap((item: unknown) => {
    if (typeof item === 'string') return item === '' ? [] : [item];

    return isRecord(item) && typeof item.id === 'string' && item.id !== '' ? [item.id] : [];
  });
};

export const isFileValue = (item: unknown): item is FileValue =>
  isRecord(item) && typeof item.id === 'string' && typeof item.url === 'string' && typeof item.name === 'string';

export const filesOf = (value: PropertyValue | undefined): FileValue[] =>
  Array.isArray(value) ? (value as unknown[]).filter(isFileValue) : [];

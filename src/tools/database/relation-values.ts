import type { PropertyValue, RelationValue } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Related row ids, in order, each once. Takes `{id}` objects and, for values
 * written by hand, bare ids. Two peers adding the same row leave it twice in
 * the merged list; reading drops the repeat.
 */
export const relationIdsOf = (value: PropertyValue | undefined): string[] => {
  if (!Array.isArray(value)) return [];
  const ids = (value as unknown[]).flatMap((item) => {
    if (typeof item === 'string') return item === '' ? [] : [item];

    return isRecord(item) && typeof item.id === 'string' && item.id !== '' ? [item.id] : [];
  });

  return [...new Set(ids)];
};

const toValue = (ids: string[]): RelationValue[] => ids.map((id) => ({ id }));

/** The value with `rowId` added at the end. A one-page limit replaces what was there. */
export const addRelated = (value: PropertyValue | undefined, rowId: string, limit: 1 | null | undefined): RelationValue[] => {
  const ids = relationIdsOf(value);

  if (limit === 1) return toValue([rowId]);

  return toValue(ids.includes(rowId) ? ids : [...ids, rowId]);
};

export const removeRelated = (value: PropertyValue | undefined, rowId: string): RelationValue[] =>
  toValue(relationIdsOf(value).filter((id) => id !== rowId));

/**
 * Ids of rows that still exist. A row deleted while a peer related it stays
 * in the stored value; every read leaves it out.
 */
export const withoutMissing = (value: PropertyValue | undefined, existing: ReadonlySet<string>): string[] =>
  relationIdsOf(value).filter((id) => existing.has(id));

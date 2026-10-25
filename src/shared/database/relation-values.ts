import type { RelationValue } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Related row ids, in order, each once. Takes `{id}` objects and, for values
 * written by hand, bare ids. Two peers adding the same row leave it twice in
 * the merged list; reading drops the repeat.
 */
export const relationIdsOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids = (value as unknown[]).flatMap((item) => {
    if (typeof item === 'string') return item === '' ? [] : [item];

    return isRecord(item) && typeof item.id === 'string' && item.id !== '' ? [item.id] : [];
  });

  return [...new Set(ids)];
};

const toValue = (ids: string[]): RelationValue[] => ids.map((id) => ({ id }));

/** The value with `rowId` added at the end. A one-page limit replaces what was there. */
export const addRelated = (value: unknown, rowId: string, limit: 1 | null | undefined): RelationValue[] => {
  const ids = relationIdsOf(value);

  if (limit === 1) return toValue([rowId]);

  return toValue(ids.includes(rowId) ? ids : [...ids, rowId]);
};

export const removeRelated = (value: unknown, rowId: string): RelationValue[] =>
  toValue(relationIdsOf(value).filter((id) => id !== rowId));

/**
 * Ids of rows that still exist. A row deleted while a peer related it stays
 * in the stored value; every read leaves it out.
 */
export const withoutMissing = (value: unknown, existing: ReadonlySet<string>): string[] =>
  relationIdsOf(value).filter((id) => existing.has(id));

/**
 * A relation cell edit. `own` is the row's new stored list: a one-page limit
 * keeps the last id. On a two-way relation, `link` gains this row on the other
 * side and `unlink` loses it: every id the row no longer holds, including one
 * the limit dropped. `removed` is what the person took out of the shown list.
 */
export const relationEdit = (
  stored: readonly string[],
  shown: readonly string[],
  input: unknown,
  limit: 1 | null | undefined
): { own: string[]; link: string[]; unlink: string[]; removed: string[] } | null => {
  const next = relationIdsOf(input);
  const added = next.filter((id) => !shown.includes(id));
  const removed = shown.filter((id) => !next.includes(id));

  if (added.length === 0 && removed.length === 0) return null;
  const kept = [...stored.filter((id) => !removed.includes(id)), ...added.filter((id) => !stored.includes(id))];
  const own = limit === 1 ? kept.slice(-1) : kept;

  return {
    own,
    link: added.filter((id) => own.includes(id)),
    unlink: [...removed, ...stored.filter((id) => kept.includes(id) && !own.includes(id))],
    removed,
  };
};

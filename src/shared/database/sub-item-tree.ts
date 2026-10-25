import { relationIdsOf } from './relation-values';

import type { PropertyDefinition, RelationRole } from './types';

type RowValues = { id: string; properties: Readonly<Record<string, unknown>> };

/** The two sides of a self-relation pair, by their roles. */
export const relationPair = (
  schema: PropertyDefinition[],
  databaseId: string,
  forwardRole: RelationRole,
  backwardRole: RelationRole
): { forward: string; backward: string } | undefined => {
  const find = (role: RelationRole): PropertyDefinition | undefined => schema.find((p) =>
    p.type === 'relation' && p.relation?.role === role && p.relation.targetDatabaseId === databaseId && p.relation.targetDocumentId === undefined);
  const forward = find(forwardRole);
  const backward = find(backwardRole);

  return forward === undefined || backward === undefined ? undefined : { forward: forward.id, backward: backward.id };
};

/** The loop the parent chain from `start` runs into, or null when it ends at a top-level row. */
const loopFrom = (start: string, parents: Map<string, string>): string[] | null => {
  const seen: string[] = [];
  const step = (at: string | undefined): string | undefined => {
    if (at === undefined || seen.includes(at)) return at;
    seen.push(at);

    return step(parents.get(at));
  };
  const met = step(start);

  return met === undefined ? null : seen.slice(seen.indexOf(met));
};

/**
 * Each row's parent: the last row its "Parent item" names that still exists.
 * Two peers can make a loop (a under b while b goes under a); the loop
 * member with the smallest id loses its parent, so every peer settles on
 * the same tree.
 */
export const parentMap = (rows: RowValues[], parentPropertyId: string): Map<string, string> => {
  const ids = new Set(rows.map((row) => row.id));
  const parents = new Map<string, string>();

  for (const row of rows) {
    const parent = relationIdsOf(row.properties[parentPropertyId]).filter((id) => id !== row.id && ids.has(id)).pop();

    if (parent !== undefined) parents.set(row.id, parent);
  }
  for (const start of [...parents.keys()].sort()) {
    const loop = loopFrom(start, parents);

    if (loop !== null) parents.delete([...loop].sort()[0]);
  }
  return parents;
};

/** Every row under `rowId`, nearest first, each once. */
export const descendantsOf = (rowId: string, rows: RowValues[], parentPropertyId: string): string[] => {
  const parents = parentMap(rows, parentPropertyId);
  const found: string[] = [];
  const seen = new Set([rowId]);
  const visit = (at: string): void => {
    const children = rows.filter((row) => parents.get(row.id) === at && !seen.has(row.id));

    children.forEach((row) => {
      seen.add(row.id);
      found.push(row.id);
    });
    children.forEach((row) => visit(row.id));
  };

  visit(rowId);

  return found;
};

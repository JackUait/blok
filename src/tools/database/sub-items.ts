import type { DatabaseRow, DatabaseViewConfig, PropertyDefinition, RelationRole, SubItemsDisplay, SubItemsFilter } from './types';
import { relationIdsOf } from './relation-values';

/*
 * Sub-items are rows of the same database (research/05 §11.1). A sub-item
 * stays a `database-row` child of the database block; its parent is the
 * row named in its "Parent item" relation, never its parent block. A row
 * block nested under another row would join that row's page body (D5), and
 * `database-row` denies `database-row` children.
 */

/**
 * Layouts that show sub-items as a card property: parents only unless
 * flattened. Chart and feed join them: Notion says a chart counts sub-items
 * only with "Flattened list" (research/03 §1.11); a feed has no toggle.
 */
export const CARD_LAYOUTS: ReadonlySet<DatabaseViewConfig['type']> = new Set(['board', 'calendar', 'gallery', 'chart', 'feed']);

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

export const resolveSubItemsDisplay = (view: DatabaseViewConfig): SubItemsDisplay => {
  if (view.subItemsDisplay === 'flattened') return 'flattened';

  return CARD_LAYOUTS.has(view.type) ? 'card' : 'nested';
};

/** Board, calendar and gallery offer "Parents only" alone while sub-items show as a card property. */
export const resolveSubItemsFilter = (view: DatabaseViewConfig): SubItemsFilter =>
  resolveSubItemsDisplay(view) === 'card' ? 'parents' : (view.subItemsFilter ?? 'parents');

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
export const parentMap = (rows: DatabaseRow[], parentPropertyId: string): Map<string, string> => {
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
export const descendantsOf = (rowId: string, rows: DatabaseRow[], parentPropertyId: string): string[] => {
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

/** The rows a view shows once sub-items are on: its display and filter options. */
export const scopeSubItems = (rows: DatabaseRow[], view: DatabaseViewConfig, parents: Map<string, string>): DatabaseRow[] => {
  switch (resolveSubItemsFilter(view)) {
    case 'parents':
      return rows.filter((row) => !parents.has(row.id));
    case 'subItems':
      return rows.filter((row) => parents.has(row.id));
    case 'parentsAndSubItems':
      return rows;
  }
};

export interface NestedRow {
  row: DatabaseRow;
  depth: number;
  hasChildren: boolean;
}

/**
 * "Nested in toggle": every shown row whose parent is not shown starts a
 * tree, and an expanded row lists its children under it. With "Parents
 * only" a toggle shows all of a parent's sub-items; otherwise only those
 * the view's filters let through.
 */
export const nestRows = (
  shown: DatabaseRow[],
  all: DatabaseRow[],
  parents: Map<string, string>,
  view: DatabaseViewConfig,
  expanded: ReadonlySet<string>
): NestedRow[] => {
  const filter = resolveSubItemsFilter(view);

  if (resolveSubItemsDisplay(view) !== 'nested' || filter === 'subItems') {
    return shown.map((row) => ({ row, depth: 0, hasChildren: false }));
  }
  const shownIds = new Set(shown.map((row) => row.id));
  const pool = filter === 'parents' ? all : shown;
  const childrenOf = (id: string): DatabaseRow[] => pool.filter((row) => parents.get(row.id) === id);
  const out: NestedRow[] = [];
  const seen = new Set<string>();
  const walk = (row: DatabaseRow, depth: number): void => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const children = childrenOf(row.id);

    out.push({ row, depth, hasChildren: children.length > 0 });
    if (expanded.has(row.id)) {
      children.forEach((child) => walk(child, depth + 1));
    }
  };

  shown
    .filter((row) => {
      const parent = parents.get(row.id);

      return parent === undefined || !shownIds.has(parent);
    })
    .forEach((row) => walk(row, 0));

  return out;
};

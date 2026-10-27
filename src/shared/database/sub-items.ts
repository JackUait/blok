import type { DatabaseRow, DatabaseViewConfig, SubItemsDisplay, SubItemsFilter } from './types';
import { descendantsOf, parentMap, relationPair } from './sub-item-tree';

export { descendantsOf, parentMap, relationPair };

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

export const resolveSubItemsDisplay = (view: DatabaseViewConfig): SubItemsDisplay => {
  if (view.subItemsDisplay === 'flattened') return 'flattened';

  return CARD_LAYOUTS.has(view.type) ? 'card' : 'nested';
};

/** Board, calendar and gallery offer "Parents only" alone while sub-items show as a card property. */
export const resolveSubItemsFilter = (view: DatabaseViewConfig): SubItemsFilter =>
  resolveSubItemsDisplay(view) === 'card' ? 'parents' : (view.subItemsFilter ?? 'parents');


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

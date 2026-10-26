/**
 * Manual row order across views (research/22 OU17). A view with its own
 * `rowOrder` keeps its own keys; the others follow the rows' shared
 * `position`. The editor's DatabaseModel and the agent's row actions share it.
 */
import { comparePositions } from './positions';

import type { DatabaseViewConfig } from './types';

interface Ordered {
  id: string;
  position: string;
}

/** A row's manual-order key in a view: the view's own key, else the shared `position`. */
export const rowOrderKey = (row: Ordered, order: Record<string, string> | undefined): string => order?.[row.id] ?? row.position;

/** The highest key of any row or any own order, so a row placed after it goes last everywhere. */
export const lastRowKey = (rows: Ordered[], orders: Array<Record<string, string> | undefined>): string | null =>
  [...rows.map((row) => row.position), ...orders.flatMap((order) => Object.values(order ?? {}))]
    .reduce<string | null>((last, key) => (last === null || comparePositions(key, last) > 0 ? key : last), null);

/** A chart, dashboard or form shows no row order. */
export const UNORDERED_VIEW_TYPES: ReadonlySet<string> = new Set(['chart', 'dashboard', 'form']);

/**
 * Before `rows` move in the shared order: every view but `viewId` that
 * `shows` them keeps each one where it is, by taking its current
 * `position` as that view's own key. Rows that do not move keep their
 * `position`, so those views' order stays the same.
 * @returns the new rowOrder of each view that changed
 */
export const pinnedRowOrders = (
  views: DatabaseViewConfig[], viewId: string, rows: Ordered[], shows: (view: DatabaseViewConfig) => boolean
): Array<{ viewId: string; rowOrder: Record<string, string> }> =>
  views.filter((view) => view.id !== viewId && shows(view)).flatMap((view) => {
    const missing = rows.filter((row) => view.rowOrder?.[row.id] === undefined);

    return missing.length === 0 ? [] : [{ viewId: view.id, rowOrder: { ...view.rowOrder, ...Object.fromEntries(missing.map((row) => [row.id, row.position])) } }];
  });

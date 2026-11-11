import type { DashboardRow, DashboardWidget, DatabaseViewConfig } from './types';

// The server runtime (Jint) has no structuredClone. Saved data is plain JSON.
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A view is a dashboard widget only when its `dashboardViewId` names a
 * dashboard view of the same database. A stale or mispointed id keeps the
 * view a tab, so it never vanishes.
 */
export const isWidgetView = (view: DatabaseViewConfig, views: readonly DatabaseViewConfig[]): boolean =>
  view.dashboardViewId !== undefined
  && views.some((other) => other.id === view.dashboardViewId && other.type === 'dashboard');

/** The views that get a tab: every view but the dashboard widgets. */
export const tabViews = <T extends DatabaseViewConfig>(views: readonly T[]): T[] =>
  views.filter((view) => !isWidgetView(view, views));

/** The widget views a dashboard owns. Legacy widgets that point at a tab view are not owned. */
export const ownedWidgetViews = <T extends DatabaseViewConfig>(views: readonly T[], dashboardId: string): T[] =>
  views.filter((view) => view.dashboardViewId === dashboardId && view.id !== dashboardId);

/** The documented limit of {@link DashboardRow.widgets}. */
export const MAX_WIDGETS_PER_ROW = 4;

/**
 * A new widget joins the last row while that row holds fewer than this many.
 * Blok's own choice: Notion's widget editor is behind a paid plan and unmeasured.
 */
const AUTO_ROW_FILL = 2;

/** Where a widget goes: into a row at an index, or into a new row before the row at `newRowAt`. */
export type WidgetPlacement = { rowId: string; index?: number } | { newRowAt: number };

/** The 12 columns shared evenly, the first widgets taking any remainder. Blok's own choice. */
const spread = (widgets: DashboardWidget[]): DashboardWidget[] => {
  const base = Math.floor(12 / Math.max(widgets.length, 1));
  const extra = 12 - base * widgets.length;

  return widgets.map((widget, index) => ({ ...widget, width: base + (index < extra ? 1 : 0) }));
};

const insertInto = (rows: DashboardRow[], widget: DashboardWidget, placement: WidgetPlacement, mintRowId: () => string): DashboardRow[] | undefined => {
  if ('newRowAt' in placement) {
    const at = Math.max(0, Math.min(placement.newRowAt, rows.length));

    return [...rows.slice(0, at), { id: mintRowId(), widgets: [{ ...widget, width: 12 }] }, ...rows.slice(at)];
  }
  const row = rows.find((entry) => entry.id === placement.rowId);

  if (row === undefined || row.widgets.length >= MAX_WIDGETS_PER_ROW) return undefined;
  const at = Math.max(0, Math.min(placement.index ?? row.widgets.length, row.widgets.length));
  const widgets = spread([...row.widgets.slice(0, at), widget, ...row.widgets.slice(at)]);

  return rows.map((entry) => (entry === row ? { ...entry, widgets } : entry));
};

/** `rows` with `widget` added. With no placement it fills the last row up to two, else starts a row. */
export const placeWidget = (
  rows: DashboardRow[], widget: DashboardWidget, placement: WidgetPlacement | undefined, mintRowId: () => string
): DashboardRow[] => {
  const last = rows.at(-1);
  const auto: WidgetPlacement = last !== undefined && last.widgets.length < AUTO_ROW_FILL ? { rowId: last.id } : { newRowAt: rows.length };

  return insertInto(rows, widget, placement ?? auto, mintRowId) ?? insertInto(rows, widget, { newRowAt: rows.length }, mintRowId) ?? rows;
};

/** `rows` without the widget. Its row shares the columns again; an emptied row goes. */
export const removeWidget = (rows: DashboardRow[], widgetId: string): DashboardRow[] => {
  if (!rows.some((row) => row.widgets.some((widget) => widget.id === widgetId))) return rows;

  return rows
    .map((row) => (row.widgets.some((widget) => widget.id === widgetId)
      ? { ...row, widgets: spread(row.widgets.filter((widget) => widget.id !== widgetId)) }
      : row))
    .filter((row) => row.widgets.length > 0);
};

/** `rows` with the widget moved. A full target row or an unknown widget changes nothing. */
export const moveWidget = (
  rows: DashboardRow[], widgetId: string, placement: WidgetPlacement, mintRowId: () => string
): DashboardRow[] => {
  const widget = rows.flatMap((row) => row.widgets).find((entry) => entry.id === widgetId);

  if (widget === undefined) return rows;
  const without = rows.map((row) => (row.widgets.some((entry) => entry.id === widgetId)
    ? { ...row, widgets: spread(row.widgets.filter((entry) => entry.id !== widgetId)) }
    : row));
  const placed = insertInto(without, widget, placement, mintRowId);

  return placed === undefined ? rows : placed.filter((row) => row.widgets.length > 0);
};

/**
 * Copies of the widget views a dashboard owns, pointing at `copyId`, and the
 * dashboard's layout re-pointed at them. Without this a duplicated dashboard
 * would show the original's widgets, and deleting the original would empty it.
 */
export const copyDashboardWidgets = <T extends DatabaseViewConfig>(
  views: readonly T[], dashboard: DatabaseViewConfig, copyId: string, mint: () => string
): { widgets: T[]; rows: DashboardRow[] } => {
  const ids = new Map<string, string>();
  const widgets = ownedWidgetViews(views, dashboard.id).map((view) => {
    const id = mint();

    ids.set(view.id, id);

    return { ...jsonCopy(view), id, dashboardViewId: copyId };
  });
  const rows = (dashboard.dashboard?.rows ?? []).map((row) => ({
    ...jsonCopy(row),
    id: mint(),
    widgets: row.widgets.map((widget) => ({
      ...jsonCopy(widget),
      id: mint(),
      viewId: widget.databaseId === undefined ? ids.get(widget.viewId) ?? widget.viewId : widget.viewId,
    })),
  }));

  return { widgets, rows };
};

/** `rows` without the widgets that show this database's view `viewId`. */
export const removeWidgetsShowing = (rows: DashboardRow[], viewId: string): DashboardRow[] =>
  rows.flatMap((row) => row.widgets)
    .filter((widget) => widget.viewId === viewId && widget.databaseId === undefined)
    .reduce((current, widget) => removeWidget(current, widget.id), rows);

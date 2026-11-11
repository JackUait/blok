import type { DatabaseViewConfig } from './types';

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

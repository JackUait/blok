// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { copyDashboardWidgets, isWidgetView, moveWidget, placeWidget, removeWidget, tabViews } from '../../../../src/shared/database/dashboard';
import { mintDatabaseViewIds, remapDatabaseViewIds } from '../../../../src/shared/database/linked-source';
import type { DashboardRow, DashboardWidget, DatabaseViewConfig } from '../../../../src/shared/database/types';

const view = (id: string, fields: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id, name: id, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...fields,
});

const views = (): DatabaseViewConfig[] => [
  view('table'),
  view('dash', { type: 'dashboard', dashboard: { rows: [{ id: 'r', widgets: [{ id: 'w', viewId: 'chart', width: 12 }] }] } }),
  view('chart', { type: 'chart', dashboardViewId: 'dash' }),
  view('stale', { dashboardViewId: 'gone' }),
  view('wrong', { dashboardViewId: 'table' }),
  view('orphan', { type: 'chart', dashboardViewId: 'dash' }),
];

describe('dashboard widget views', () => {
  it('counts a view as a widget only when it names a dashboard of the same database', () => {
    const all = views();

    expect(all.map((entry) => isWidgetView(entry, all))).toEqual([false, false, true, false, false, false]);
  });

  it('keeps stale, mispointed and out-of-layout widget views as tabs, so nothing disappears', () => {
    expect(tabViews(views()).map((entry) => entry.id)).toEqual(['table', 'dash', 'stale', 'wrong', 'orphan']);
  });

  it('a pasted copy points its widget views at the copied dashboard, not the original', () => {
    const data = { schema: [], views: views(), activeViewId: 'dash' };
    const ids = mintDatabaseViewIds([{ id: 'db', type: 'database', data }], ((): (() => string) => {
      const state = { next: 0 };

      return () => {
        state.next += 1;

        return `new-${state.next}`;
      };
    })());
    const copy = remapDatabaseViewIds('database', 'db', data, ids);
    const byOld = (id: string): DatabaseViewConfig | undefined => copy.views[data.views.findIndex((entry) => entry.id === id)];
    const dash = byOld('dash');
    const chart = byOld('chart');

    expect(chart?.dashboardViewId).toBe(dash?.id);
    expect(dash?.dashboard?.rows[0].widgets[0].viewId).toBe(chart?.id);
    expect(isWidgetView(chart ?? view('x'), copy.views)).toBe(true);
    expect(byOld('stale')?.dashboardViewId).toBe('gone');
  });
});

describe('dashboard layout', () => {
  const ids = (rows: DashboardRow[]): string[][] => rows.map((row) => row.widgets.map((widget) => `${widget.id}:${widget.width}`));
  const mint = ((): (() => string) => {
    const state = { next: 0 };

    return () => {
      state.next += 1;

      return `row-${state.next}`;
    };
  })();
  const widget = (id: string, width = 12): DashboardWidget => ({ id, viewId: `v-${id}`, width });
  const layout = (): DashboardRow[] => [
    { id: 'r1', widgets: [widget('a', 6), widget('b', 6)] },
    { id: 'r2', widgets: [widget('c', 12)] },
  ];

  it('a new widget joins the last row while it has one widget, then starts a row', () => {
    const one = placeWidget([], widget('a'), undefined, mint);
    const two = placeWidget(one, widget('b'), undefined, mint);
    const three = placeWidget(two, widget('c'), undefined, mint);

    expect(ids(one)).toEqual([['a:12']]);
    expect(ids(two)).toEqual([['a:6', 'b:6']]);
    expect(ids(three)).toEqual([['a:6', 'b:6'], ['c:12']]);
  });

  it('moves a widget into another row, sharing its columns, and drops the row it left empty', () => {
    expect(ids(moveWidget(layout(), 'c', { rowId: 'r1', index: 1 }, mint))).toEqual([['a:4', 'c:4', 'b:4']]);
  });

  it('moves a widget within its row', () => {
    expect(ids(moveWidget(layout(), 'b', { rowId: 'r1', index: 0 }, mint))).toEqual([['b:6', 'a:6'], ['c:12']]);
  });

  it('moves a widget out to a new row of its own', () => {
    expect(ids(moveWidget(layout(), 'a', { newRowAt: 2 }, mint))).toEqual([['b:12'], ['c:12'], ['a:12']]);
    expect(ids(moveWidget(layout(), 'c', { newRowAt: 0 }, mint))).toEqual([['c:12'], ['a:6', 'b:6']]);
  });

  it('never puts a fifth widget in a row', () => {
    const full: DashboardRow[] = [{ id: 'r1', widgets: ['a', 'b', 'c', 'd'].map((id) => widget(id, 3)) }, { id: 'r2', widgets: [widget('e')] }];

    expect(ids(moveWidget(full, 'e', { rowId: 'r1', index: 0 }, mint))).toEqual(ids(full));
  });

  it('keeps an untouched row\'s saved widths', () => {
    const rows: DashboardRow[] = [{ id: 'r1', widgets: [widget('a', 7), widget('b', 5)] }, { id: 'r2', widgets: [widget('c')] }];

    expect(ids(removeWidget(rows, 'c'))).toEqual([['a:7', 'b:5']]);
    expect(ids(removeWidget(rows, 'a'))).toEqual([['b:12'], ['c:12']]);
  });

  it('an unknown widget leaves the layout as it was', () => {
    expect(moveWidget(layout(), 'zzz', { newRowAt: 0 }, mint)).toEqual(layout());
    expect(removeWidget(layout(), 'zzz')).toEqual(layout());
  });
});

describe('copying a dashboard', () => {
  it('copies its own widget views and points the copy\'s layout at them; legacy widgets keep their view', () => {
    const all = views();
    const dash = all[1];

    dash.dashboard?.rows[0].widgets.push({ id: 'legacy', viewId: 'table', width: 6 });
    const state = { next: 0 };
    const { widgets, rows } = copyDashboardWidgets(all, dash, 'copy', () => {
      state.next += 1;

      return `n${state.next}`;
    });

    expect(widgets.map((entry) => [entry.type, entry.dashboardViewId])).toEqual([['chart', 'copy']]);
    expect(rows[0].widgets.map((widget) => widget.viewId)).toEqual([widgets[0].id, 'table']);
    expect(rows[0].widgets.map((widget) => widget.id)).not.toContain('w');
    expect(dash.dashboard?.rows[0].widgets[0].viewId).toBe('chart');
  });
});

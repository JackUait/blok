// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isWidgetView, tabViews } from '../../../../src/shared/database/dashboard';
import { mintDatabaseViewIds, remapDatabaseViewIds } from '../../../../src/shared/database/linked-source';
import type { DatabaseViewConfig } from '../../../../src/shared/database/types';

const view = (id: string, fields: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id, name: id, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...fields,
});

const views = (): DatabaseViewConfig[] => [
  view('table'),
  view('dash', { type: 'dashboard', dashboard: { rows: [{ id: 'r', widgets: [{ id: 'w', viewId: 'chart', width: 12 }] }] } }),
  view('chart', { type: 'chart', dashboardViewId: 'dash' }),
  view('stale', { dashboardViewId: 'gone' }),
  view('wrong', { dashboardViewId: 'table' }),
];

describe('dashboard widget views', () => {
  it('counts a view as a widget only when it names a dashboard of the same database', () => {
    const all = views();

    expect(all.map((entry) => isWidgetView(entry, all))).toEqual([false, false, true, false, false]);
  });

  it('keeps stale and mispointed widget views as tabs, so nothing disappears', () => {
    expect(tabViews(views()).map((entry) => entry.id)).toEqual(['table', 'dash', 'stale', 'wrong']);
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

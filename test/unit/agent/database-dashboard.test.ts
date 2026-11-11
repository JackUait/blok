// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, run, seedOf, SESSIONS } from './database-seed';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = () => seedOf([{ id: 'A', schema: [property('t', 'title'), property('s', 'select', { config: { options: [] } })], rows: [], view: { sorts: [], filters: [], visibleProperties: [] } }]);

type View = { id: string; type: string; dashboardViewId?: string; dashboard?: { rows: Array<{ widgets: Array<{ viewId: string }> }> } };

const viewIdOf = (result: Awaited<ReturnType<typeof run>>): string =>
  ((result.ok ? result.results[0] : undefined) as { viewId?: string } | undefined)?.viewId ?? '';

describe.each(SESSIONS)('database dashboard widgets (%s session)', (_label, open) => {
  it('addView makes a dashboard, and dashboardViewId adds widgets to its layout without opening them', async () => {
    const session = open(seed());
    const dashboard = await run(session, 'database.addView', { id: 'A', type: 'dashboard' });
    const dash = viewIdOf(dashboard);

    expect(errorOf(dashboard)?.message).toBeUndefined();
    const chart = viewIdOf(await run(session, 'database.addView', { id: 'A', type: 'chart', dashboardViewId: dash }));
    const list = viewIdOf(await run(session, 'database.addView', { id: 'A', type: 'list', dashboardViewId: dash, placement: { newRow: true } }));
    const data = await dataOf(session, 'A');
    const views = data?.views as View[];

    expect(data?.activeViewId).toBe(dash);
    expect(views.find(view => view.id === dash)?.dashboard?.rows.map(row => row.widgets.map(widget => widget.viewId))).toEqual([[chart], [list]]);
    expect(views.filter(view => view.dashboardViewId === dash).map(view => view.id)).toEqual([chart, list]);
    await session.close();
  });

  it('refuses a widget of a layout a dashboard cannot draw', async () => {
    const session = open(seed());
    const dash = viewIdOf(await run(session, 'database.addView', { id: 'A', type: 'dashboard' }));

    expect(errorOf(await run(session, 'database.addView', { id: 'A', type: 'gallery', dashboardViewId: dash }))).toBeDefined();
    await session.close();
  });
});

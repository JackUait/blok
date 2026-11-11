import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildTool, fakeRow, makeDoc } from './tier3-harness';
import { DatabaseDashboardView } from '../../../../src/tools/database/database-dashboard-view';
import { computeCalculation } from '../../../../src/shared/database/database-calculations';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'status', name: 'Status', type: 'select', position: 'a1', config: { options: [
    { id: 'todo', label: 'To do', position: 'a0' },
    { id: 'done', label: 'Done', position: 'a1' },
  ] } },
  { id: 'amount', name: 'Amount', type: 'number', position: 'a2' },
];

const view = (id: string, fields: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id, name: id, type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...fields,
});

const tableOnly = (): DatabaseData => ({ schema, views: [view('table', { name: 'Table' })], activeViewId: 'table' });

const rows = () => [
  fakeRow('a', 'db', { title: 'Alpha', status: 'todo', amount: 10 }, 'a0'),
  fakeRow('b', 'db', { title: 'Bravo', status: 'done', amount: 25 }, 'a1'),
  fakeRow('c', 'db', { title: 'Charlie', status: 'done', amount: 40 }, 'a2'),
];

const withWidgets = (): DatabaseData => ({
  schema,
  views: [
    view('table', { name: 'Table' }),
    view('dash', { type: 'dashboard', name: 'Dashboard', position: 'a1', dashboard: { rows: [{ id: 'r1', widgets: [
      { id: 'w-chart', viewId: 'chart', width: 6 },
      { id: 'w-legacy', viewId: 'table', width: 6 },
    ] }] } }),
    view('chart', { type: 'chart', name: 'Chart', position: 'a2', dashboardViewId: 'dash', groupBy: 'status' }),
    view('stale', { name: 'Stale', position: 'a3', dashboardViewId: 'gone' }),
  ],
  activeViewId: 'dash',
});

const tools: Array<ReturnType<typeof buildTool>['tool']> = [];
const mount = (data: DatabaseData) => {
  const result = buildTool(makeDoc(rows()), {}, data);

  tools.push(result.tool);

  return result;
};

const tabIds = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('[data-blok-database-tab][data-view-id]')].map((tab) => tab.getAttribute('data-view-id') ?? '');

const savedView = (tool: ReturnType<typeof buildTool>['tool'], el: HTMLElement, id: string): DatabaseViewConfig | undefined =>
  tool.save(el).views.find((entry) => entry.id === id);

const menuItem = (name: string): HTMLElement => {
  const item = document.querySelector<HTMLElement>(`[data-blok-popover-opened] [data-blok-item-name="${name}"]`);

  if (item === null) throw new Error(`no ${name} item`);

  return item;
};

const dashboardOf = (tool: ReturnType<typeof buildTool>['tool'], el: HTMLElement, id = 'dash'): Array<Array<{ id: string; viewId: string; width: number }>> =>
  (savedView(tool, el, id)?.dashboard?.rows ?? []).map((row) => row.widgets.map((widget) => ({ id: widget.id, viewId: widget.viewId, width: widget.width })));

const emptyDashboard = (): DatabaseData => ({
  schema,
  views: [view('table', { name: 'Table' }), view('dash', { type: 'dashboard', name: 'Dashboard', position: 'a1', dashboard: { rows: [] } })],
  activeViewId: 'dash',
});

const addViewFromMenu = (tool: ReturnType<typeof buildTool>['tool'], type: DatabaseViewConfig['type']): void => {
  (tool as unknown as { addViewWithSettings: (t: DatabaseViewConfig['type']) => void }).addViewWithSettings(type);
};

describe('DatabaseTool — dashboard editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tools.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  describe('creating a dashboard', () => {
    it('Add view makes a "Dashboard" tab at once, with no settings panel (notion-motion Round 15 A)', () => {
      const { tool, el } = mount(tableOnly());

      addViewFromMenu(tool, 'dashboard');
      const saved = tool.save(el);
      const dash = saved.views.find((entry) => entry.type === 'dashboard');

      expect(dash?.name).toBe('Dashboard');
      expect(saved.activeViewId).toBe(dash?.id);
      expect(tabIds(el)).toEqual(['table', dash?.id]);
      expect(document.querySelector('[data-blok-database-settings-panel], [data-blok-database-panel]')).toBeNull();
    });
  });

  describe('toolbar', () => {
    // notion-motion Round 15 A: with Dashboard selected only ⤢ and ⚙ show.
    it('shows only View settings on a dashboard, and every control again on a table', () => {
      const { tool, el } = mount(withWidgets());
      const shown = (): string[] => [...el.querySelectorAll<HTMLElement>('[data-blok-database-view-toolbar] [data-blok-testid^="database-toolbar-"]')]
        .filter((button) => !button.hidden && button.closest('[hidden]') === null)
        .map((button) => button.getAttribute('data-blok-testid') ?? '');

      expect(shown()).toEqual(['database-toolbar-settings']);
      expect(el.querySelector<HTMLElement>('[data-blok-database-view-toolbar] [data-blok-database-new]')?.hidden).toBe(true);
      (tool as unknown as { switchView: (id: string) => void }).switchView('table');
      expect(shown()).toEqual(expect.arrayContaining(['database-toolbar-filter', 'database-toolbar-sort', 'database-toolbar-settings', 'database-toolbar-new']));
    });
  });

  describe('view settings', () => {
    // notion-motion Round 15 A: Layout, Copy link, Manage data sources, Lock. No Filter or Sort.
    it('a dashboard lists Layout, Copy link and Lock, with no row settings', () => {
      const { el } = mount(withWidgets());

      el.querySelector<HTMLElement>('[data-blok-testid="database-toolbar-settings"]')?.click();
      const rows = [...document.querySelectorAll<HTMLElement>('[data-blok-database-panel] [data-blok-testid^="database-settings-"]')]
        .map((row) => row.getAttribute('data-blok-testid'));

      expect(rows).toEqual(expect.arrayContaining(['database-settings-layout', 'database-settings-copy-link', 'database-settings-lock']));
      for (const absent of ['database-settings-filter', 'database-settings-sort', 'database-settings-group', 'database-settings-properties', 'database-settings-color', 'database-settings-edit-properties']) {
        expect(rows).not.toContain(absent);
      }
    });
  });

  describe('chart and number widgets', () => {
    const widget = (el: HTMLElement, id: string): HTMLElement | null =>
      el.querySelector<HTMLElement>(`[data-blok-database-dashboard-widget="${id}"]`);
    const shownView = (tool: ReturnType<typeof buildTool>['tool']): unknown => (tool as unknown as { view: unknown }).view;

    it('a chart widget draws beside a table widget, and a redraw keeps the dashboard', () => {
      const { tool, el } = mount(withWidgets());

      expect(widget(el, 'w-chart')?.querySelector('[data-blok-database-chart]')).not.toBeNull();
      expect(widget(el, 'w-chart')?.querySelector('[data-blok-database-dashboard-widget-error]')).toBeNull();
      expect(widget(el, 'w-legacy')?.querySelectorAll('[data-blok-database-table-row]').length).toBe(3);
      expect(shownView(tool)).toBeInstanceOf(DatabaseDashboardView);
      (tool as unknown as { rerenderView: () => void }).rerenderView();
      expect(shownView(tool)).toBeInstanceOf(DatabaseDashboardView);
      expect(widget(el, 'w-chart')?.querySelector('[data-blok-database-chart]')).not.toBeNull();
    });

    it('two chart widgets on one database both draw', () => {
      const data = withWidgets();
      const dash = data.views.find((entry) => entry.id === 'dash');

      data.views.push(view('chart2', { type: 'chart', name: 'Chart 2', position: 'a4', dashboardViewId: 'dash', chartType: 'donut', groupBy: 'status' }));
      dash?.dashboard?.rows.push({ id: 'r2', widgets: [{ id: 'w-chart2', viewId: 'chart2', width: 12 }] });
      const { el } = mount(data);

      expect(widget(el, 'w-chart')?.querySelector('[data-blok-database-chart]')).not.toBeNull();
      expect(widget(el, 'w-chart2')?.querySelector('[data-blok-database-chart]')).not.toBeNull();
    });

    it('a Number widget shows the same Sum the table footer computes', () => {
      const data = withWidgets();
      const dash = data.views.find((entry) => entry.id === 'dash');

      data.views.push(view('num', { type: 'chart', name: 'Number', position: 'a4', dashboardViewId: 'dash', chartType: 'number', chartMeasure: 'sum:amount' }));
      dash?.dashboard?.rows.push({ id: 'r2', widgets: [{ id: 'w-num', viewId: 'num', width: 12 }] });
      const { el } = mount(data);
      const footer = computeCalculation('sum', rows().map((row) => row.data.properties.amount), schema[2]);

      expect(footer).toEqual({ kind: 'number', value: 75 });
      expect(widget(el, 'w-num')?.querySelector('[data-blok-database-chart-number]')?.textContent).toBe('75');
    });
  });

  describe('adding widgets', () => {
    it('an empty dashboard says what it holds and offers Add widget', () => {
      const { el } = mount(emptyDashboard());
      const empty = el.querySelector('[data-blok-database-dashboard-empty]');

      expect(empty?.textContent).toContain('tools.database.dashboardEmpty');
      expect(empty?.querySelector('[data-blok-testid="database-dashboard-add-widget"]')?.textContent?.trim()).toBe('tools.database.dashboardAddWidget');
    });

    it('a read-only empty dashboard offers no Add widget', () => {
      const result = buildTool(makeDoc(rows()), {}, emptyDashboard(), true);

      tools.push(result.tool);
      expect(result.el.querySelector('[data-blok-database-dashboard-empty]')).not.toBeNull();
      expect(result.el.querySelector('[data-blok-testid="database-dashboard-add-widget"]')).toBeNull();
    });

    it('Add widget offers Chart, Number, Table and List', () => {
      const { el } = mount(emptyDashboard());

      el.querySelector<HTMLElement>('[data-blok-testid="database-dashboard-add-widget"]')?.click();
      const names = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-popover-item]')]
        .map((item) => item.getAttribute('data-blok-item-name'));

      expect(names).toEqual(['database-dashboard-add-chart', 'database-dashboard-add-number', 'database-dashboard-add-table', 'database-dashboard-add-list']);
    });

    it('each pick saves a widget view with no tab and places it, two to a row', () => {
      const { tool, el } = mount(emptyDashboard());
      const pick = (kind: string): void => {
        el.querySelector<HTMLElement>('[data-blok-testid="database-dashboard-add-widget"]')?.click();
        menuItem(`database-dashboard-add-${kind}`).click();
      };

      pick('chart');
      pick('number');
      pick('table');
      const saved = tool.save(el);
      const widgets = saved.views.filter((entry) => entry.dashboardViewId === 'dash');

      expect(widgets.map((entry) => [entry.type, entry.chartType, entry.groupBy])).toEqual([
        ['chart', undefined, 'status'],
        ['chart', 'number', undefined],
        ['table', undefined, undefined],
      ]);
      expect(dashboardOf(tool, el).map((row) => row.map((widget) => [widget.viewId, widget.width]))).toEqual([
        [[widgets[0].id, 6], [widgets[1].id, 6]],
        [[widgets[2].id, 12]],
      ]);
      expect(tabIds(el)).toEqual(['table', 'dash']);
      expect(el.querySelectorAll('[data-blok-database-dashboard-widget-error]')).toHaveLength(0);
      expect(el.querySelector('[data-blok-database-chart-number]')?.textContent).toBe('3');
      expect([...el.querySelectorAll('[data-blok-database-dashboard-widget-title]')].map((title) => title.textContent))
        .toEqual(['tools.database.viewTypeChart', 'tools.database.chartTypeNumber', 'tools.database.viewTypeTable']);
    });
  });

  describe('the widget menu', () => {
    const openMenu = (el: HTMLElement, widgetId: string): void => {
      el.querySelector<HTMLElement>(`[data-blok-database-dashboard-widget="${widgetId}"] [data-blok-testid="database-dashboard-widget-menu"]`)?.click();
    };

    it('lists Edit view, Duplicate and Delete', () => {
      const { el } = mount(withWidgets());

      openMenu(el, 'w-chart');
      expect([...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-popover-item]')].map((item) => item.getAttribute('data-blok-item-name')))
        .toEqual(['database-dashboard-widget-edit', 'database-dashboard-widget-duplicate', 'database-dashboard-widget-remove']);
    });

    it('Duplicate copies the widget view, owned by the dashboard, right after it', () => {
      const { tool, el } = mount(withWidgets());

      openMenu(el, 'w-legacy');
      menuItem('database-dashboard-widget-duplicate').click();
      const rows = dashboardOf(tool, el);
      const copy = savedView(tool, el, rows[0][2]?.viewId ?? '');

      expect(rows[0].map((widget) => widget.width)).toEqual([4, 4, 4]);
      expect(rows[0][2].viewId).not.toBe('table');
      expect(copy?.type).toBe('table');
      expect(copy?.dashboardViewId).toBe('dash');
      expect(tabIds(el)).toEqual(['table', 'dash', 'stale']);
    });

    it('Delete removes an owned widget view with its widget', () => {
      const { tool, el } = mount(withWidgets());

      openMenu(el, 'w-chart');
      menuItem('database-dashboard-widget-remove').click();

      expect(savedView(tool, el, 'chart')).toBeUndefined();
      expect(dashboardOf(tool, el)).toEqual([[{ id: 'w-legacy', viewId: 'table', width: 12 }]]);
    });

    it('Delete on a legacy widget keeps the tab view it showed', () => {
      const { tool, el } = mount(withWidgets());

      openMenu(el, 'w-legacy');
      menuItem('database-dashboard-widget-remove').click();

      expect(savedView(tool, el, 'table')).toBeDefined();
      expect(dashboardOf(tool, el)).toEqual([[{ id: 'w-chart', viewId: 'chart', width: 12 }]]);
      expect(tabIds(el)).toContain('table');
    });

    it('Edit view opens that widget\'s own settings, with its layout', () => {
      const { el } = mount(withWidgets());

      openMenu(el, 'w-chart');
      menuItem('database-dashboard-widget-edit').click();
      const layout = document.querySelector('[data-blok-database-panel] [data-blok-testid="database-settings-layout"]');

      expect(layout?.textContent).toContain('tools.database.viewTypeChart');
    });
  });

  describe('deleting the dashboard', () => {
    it('takes its own widget views and keeps legacy and stale ones', () => {
      const { tool, el } = mount(withWidgets());

      tool.deleteView('dash');
      const ids = tool.save(el).views.map((entry) => entry.id);

      expect(ids).toEqual(['table', 'stale']);
    });

    // The block's history keeps one entry per dispatched change, so one dispatch is one undo step.
    it('is one change: the dashboard and its widget views go in a single dispatch', () => {
      const { tool } = mount(withWidgets());
      const dispatch = (tool as unknown as { block: { dispatchChange: ReturnType<typeof vi.fn> } }).block.dispatchChange;

      dispatch.mockClear();
      tool.deleteView('dash');
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicating the dashboard', () => {
    it('copies its widgets, so deleting the original keeps the copy whole', () => {
      const { tool, el } = mount(withWidgets());

      tool.duplicateView('dash');
      const copyId = tool.save(el).activeViewId;

      tool.deleteView('dash');
      const saved = tool.save(el);
      const copy = saved.views.find((entry) => entry.id === copyId);
      const widgetIds = copy?.dashboard?.rows.flatMap((row) => row.widgets.map((widget) => widget.viewId)) ?? [];

      expect(copyId).not.toBe('dash');
      expect(widgetIds).toHaveLength(2);
      expect(widgetIds[1]).toBe('table');
      expect(saved.views.find((entry) => entry.id === widgetIds[0])?.dashboardViewId).toBe(copyId);
      expect(el.querySelectorAll('[data-blok-database-dashboard-widget-error]')).toHaveLength(0);
    });
  });

  describe('moving widgets by drag', () => {
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    const layOut = (el: HTMLElement): void => {
      const rowsEls = [...el.querySelectorAll<HTMLElement>('[data-blok-database-dashboard-row]')];

      rowsEls.forEach((row, rowIndex) => {
        const top = 100 + rowIndex * 300;
        const widgets = [...row.querySelectorAll<HTMLElement>(':scope > [data-blok-database-dashboard-widget]')];

        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(0, top, 600, 280));
        widgets.forEach((widget, index) => {
          const width = 600 / widgets.length;

          vi.spyOn(widget, 'getBoundingClientRect').mockReturnValue(rect(index * width, top, width, 280));
        });
      });
    };
    const pointer = (type: string, target: EventTarget, x: number, y: number): void => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });

      Object.defineProperty(event, 'pointerId', { value: 1 });
      target.dispatchEvent(event);
    };

    it('dragging a widget\'s header into the next row moves it there and saves the layout', () => {
      const data = withWidgets();
      const dash = data.views.find((entry) => entry.id === 'dash');

      data.views.push(view('num', { type: 'chart', name: 'Number', position: 'a4', dashboardViewId: 'dash', chartType: 'number' }));
      dash?.dashboard?.rows.push({ id: 'r2', widgets: [{ id: 'w-num', viewId: 'num', width: 12 }] });
      const { tool, el } = mount(data);

      layOut(el);
      const header = el.querySelector<HTMLElement>('[data-blok-database-dashboard-widget="w-chart"] [data-blok-database-dashboard-widget-header]');

      if (header === null) throw new Error('no header');
      pointer('pointerdown', header, 50, 110);
      pointer('pointermove', document, 500, 550);
      expect(el.querySelector('[data-blok-database-dashboard-drop="column"]')).not.toBeNull();
      pointer('pointerup', document, 500, 550);

      expect(dashboardOf(tool, el).map((row) => row.map((widget) => [widget.id, widget.width]))).toEqual([
        [['w-legacy', 12]],
        [['w-num', 6], ['w-chart', 6]],
      ]);
      expect(el.querySelector('[data-blok-database-dashboard-drop]')).toBeNull();
    });

    it('a drop near a row\'s top edge starts a new row; Escape cancels a drag', () => {
      const { tool, el } = mount(withWidgets());

      layOut(el);
      const header = (): HTMLElement => {
        const found = el.querySelector<HTMLElement>('[data-blok-database-dashboard-widget="w-legacy"] [data-blok-database-dashboard-widget-header]');

        if (found === null) throw new Error('no header');

        return found;
      };

      pointer('pointerdown', header(), 400, 110);
      pointer('pointermove', document, 300, 104);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      pointer('pointerup', document, 300, 104);
      expect(dashboardOf(tool, el)[0].map((widget) => widget.id)).toEqual(['w-chart', 'w-legacy']);

      pointer('pointerdown', header(), 400, 110);
      pointer('pointermove', document, 300, 104);
      pointer('pointerup', document, 300, 104);
      expect(dashboardOf(tool, el).map((row) => row.map((widget) => widget.id))).toEqual([['w-legacy'], ['w-chart']]);
    });
  });

  describe('widget views', () => {
    it('get no tab, while a legacy widget and a stale widget view keep theirs', () => {
      const { el } = mount(withWidgets());

      expect(tabIds(el)).toEqual(['table', 'dash', 'stale']);
    });

    it('are never the open view: a saved widget id opens the first tab', () => {
      const { tool, el } = mount({ ...withWidgets(), activeViewId: 'chart' });

      expect(tool.save(el).activeViewId).toBe('table');
    });

    it('survive save and reload with their dashboard link', () => {
      const first = mount(withWidgets());
      const saved = first.tool.save(first.el);
      const second = mount(saved);

      expect(savedView(second.tool, second.el, 'chart')?.dashboardViewId).toBe('dash');
      expect(tabIds(second.el)).toEqual(['table', 'dash', 'stale']);
    });
  });
});

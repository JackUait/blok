import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { layoutChange } from '../../../../src/shared/database/view-changes';
import { Paragraph } from '../../../../src/tools/paragraph';
import { TabsTool, TabTool } from '../../../../src/tools';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import { groupByChange, subGroupByChange } from '../../../../src/tools/database/group-keys';
import { withEntryIds } from '../../../../src/tools/database/filter-tree';
import { withCalculation, withPropertyOrder, withPropertySetting } from '../../../../src/tools/database/view-settings';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { ViewChanges } from '../../../../src/tools/database/database-model';
import type { DatabaseViewConfig, FilterConfig, PropertyDefinition, SortConfig, ViewType } from '../../../../src/tools/database/types';
import type { AgentBatch, OutputBlockData } from '../../../../types';

/*
 * A view the agent writes (database.updateView / database.setLayout) must save and
 * render exactly as the same setting written through the editor's own path
 * (DatabaseModel.updateView with the change the UI builds).
 */

let holder: HTMLDivElement | undefined;
let core: Core | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'st', name: 'Stage', type: 'select', position: 'a1',
    config: { options: [{ id: 'o1', label: 'Todo', color: 'red', position: 'a0' }, { id: 'o2', label: 'Done', color: 'green', position: 'a1' }] },
  },
  { id: 'n', name: 'Size', type: 'number', position: 'a2' },
  { id: 'd', name: 'Due', type: 'date', position: 'a3' },
  { id: 'e', name: 'End', type: 'date', position: 'a4' },
  { id: 'c', name: 'Done', type: 'checkbox', position: 'a5' },
  { id: 'dep', name: 'Blocked by', type: 'relation', position: 'a6', relation: { targetDatabaseId: 'db' } },
];

const ROWS = 12;

const rows: OutputBlockData[] = Array.from({ length: ROWS }, (_, i) => ({
  id: `r${i}`,
  type: 'database-row',
  parent: 'db',
  data: {
    position: `a${i}`,
    title: `Row ${i}`,
    properties: { t: `Row ${i}`, st: i % 3 === 0 ? 'o2' : 'o1', n: i, d: `2026-10-${String(i + 1).padStart(2, '0')}`, e: `2026-10-${String(i + 3).padStart(2, '0')}`, c: i % 2 === 0, dep: i === 1 ? [{ id: 'r0' }] : [] },
  },
}));

const seedView = (type: ViewType, extra: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'v1', name: 'View', type, position: 'a0', sorts: [], filters: [], visibleProperties: [], ...(type === 'board' ? { groupBy: 'st' } : {}), ...extra,
});

const blocksOf = (view: DatabaseViewConfig, dbSchema: PropertyDefinition[] = schema): OutputBlockData[] => [
  { id: 'db', type: 'database', content: rows.map(row => row.id ?? ''), data: { title: 'Tasks', schema: dbSchema, views: [view], activeViewId: 'v1' } },
  ...rows,
];

const boot = async (blocks: OutputBlockData[]): Promise<Core> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Core({
    holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: { paragraph: Paragraph, tabs: TabsTool, tab: TabTool, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks: structuredClone(blocks) },
  });

  core = instance;
  await instance.isReady;
  await quiet();

  return instance;
};

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null && 'markDestroyed' in value && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null && 'destroy' in value && typeof value.destroy === 'function';

const teardown = async (): Promise<void> => {
  if (core !== undefined) {
    const modules: unknown[] = Object.values(core.moduleInstances);

    modules.filter(hasMarkDestroyed).forEach((module) => module.markDestroyed());
    await Promise.all(modules.filter(hasDestroy).map((module) => module.destroy()));
  }
  core = undefined;
  holder?.remove();
  holder = undefined;
  destroyTooltip();
  document.body.innerHTML = '';
};

const runAgent = async (instance: Core, batch: AgentBatch): Promise<string | null> => {
  const agent = instance.moduleInstances.API.methods.agent;

  if (agent === undefined) throw new Error('agent API is missing');
  const turn = agent.begin({ agent: { id: 'bot', name: 'Bot' } });

  try {
    const result = await turn.execute(batch);

    return result.ok ? null : `${result.error.code}: ${result.error.message}`;
  } finally {
    turn.end();
  }
};

// Ids made at render time (nanoid) differ between two boots; everything else must match.
const RANDOM_ATTRIBUTES = /\s(id|for|aria-controls|aria-labelledby|aria-describedby|aria-owns|aria-activedescendant|data-blok-popover-id|data-tooltip-id)="[^"]*"/g;
// Each chart numbers its SVG gradients from a counter shared by the page.
const CHART_IDS = /blok-chart-\d+/g;

interface Rendered {
  saved: Record<string, unknown>;
  html: string;
}

const capture = async (instance: Core): Promise<Rendered> => {
  await quiet();
  const saved = (await instance.moduleInstances.Saver.save())?.blocks.find(block => block.id === 'db');
  const element = instance.moduleInstances.BlockManager.getBlockById('db')?.holder;

  return { saved: structuredClone<Record<string, unknown>>(saved?.data ?? {}), html: (element?.outerHTML ?? '').replace(RANDOM_ATTRIBUTES, '').replace(CHART_IDS, 'blok-chart') };
};

const TOUCH: AgentBatch['commands'][number] = { name: 'block.update', args: { id: 'db', data: { title: 'Tasks touched' } } };

/**
 * Boots, then has the agent rename the database. A first render and a render
 * after a document change differ in ways no view setting causes (the agent's
 * target mark), so every side takes both.
 */
const bootTouched = async (blocks: OutputBlockData[], commands: AgentBatch['commands'] = []): Promise<{ instance: Core; error: string | null }> => {
  const instance = await boot(blocks);
  const error = await runAgent(instance, { commands: [...commands, TOUCH] });

  return { instance, error };
};

/** The editor's write: what the UI hands DatabaseModel.updateView. */
const uiWrite = (blocks: OutputBlockData[], changes: (view: DatabaseViewConfig, schema: PropertyDefinition[]) => ViewChanges): OutputBlockData[] => {
  const [database, ...rest] = blocks;
  const data = database.data as { schema: PropertyDefinition[]; views: DatabaseViewConfig[]; activeViewId: string };
  const model = new DatabaseModel(structuredClone(data));
  const view = model.getView('v1');

  if (view === undefined) throw new Error('no view');
  model.updateView('v1', changes(structuredClone(view), model.getSchema()));

  return [{ ...database, data: { ...data, views: JSON.parse(JSON.stringify(model.getViews())) as DatabaseViewConfig[] } }, ...rest];
};

interface Case {
  setting: string;
  view: ViewType | DatabaseViewConfig;
  ui: (view: DatabaseViewConfig, schema: PropertyDefinition[]) => ViewChanges;
  agent: Record<string, unknown>;
  /** False: the setting draws nothing jsdom can see (host-only, a map, a page open, a color fill); saved data is compared alone. */
  drawn?: boolean;
}

const prop = (id: string): PropertyDefinition => {
  const found = schema.find(p => p.id === id);

  if (found === undefined) throw new Error(id);

  return found;
};

const CASES: Case[] = [
  { setting: 'name', view: 'table', ui: () => ({ name: 'Mine' }), agent: { name: 'Mine' } },
  { setting: 'frozenColumnCount', view: 'table', ui: () => ({ frozenColumnCount: 2 }), agent: { frozenColumnCount: 2 } },
  { setting: 'showPageIcon', view: 'table', ui: () => ({ showPageIcon: false }), agent: { showPageIcon: false } },
  { setting: 'wrapCells', view: 'table', ui: () => ({ wrapCells: true }), agent: { wrapCells: true } },
  { setting: 'showVerticalLines', view: 'table', ui: () => ({ showVerticalLines: false }), agent: { showVerticalLines: false } },
  { setting: 'loadLimit', view: 'table', ui: () => ({ loadLimit: 10 }), agent: { loadLimit: 10 } },
  { setting: 'calculations', view: 'table', ui: (v) => ({ calculations: withCalculation(v, 'n', 'sum') }), agent: { calculations: [{ id: 'n', fn: 'sum' }] } },
  {
    setting: 'calculations capCounts', view: 'table',
    ui: () => ({ calculations: [{ id: 't', fn: 'count', capCounts: true }] }), agent: { calculations: [{ id: 't', fn: 'count', capCounts: true }] },
  },
  {
    setting: 'properties: hide', view: 'table',
    ui: (v, s) => ({ properties: withPropertySetting(v, s, 'st', { visible: false }) }),
    agent: { properties: [{ id: 't', visible: true }, { id: 'st', visible: false }, { id: 'n', visible: true }, { id: 'd', visible: true }, { id: 'e', visible: true }, { id: 'c', visible: true }, { id: 'dep', visible: true }] },
  },
  {
    setting: 'properties: width and wrap', view: 'table',
    ui: (v, s) => ({ properties: withPropertySetting({ ...v, properties: withPropertySetting(v, s, 'n', { width: 240 }) }, s, 'n', { wrap: true }) }),
    agent: { properties: [{ id: 't', visible: true }, { id: 'st', visible: true }, { id: 'n', visible: true, width: 240, wrap: true }, { id: 'd', visible: true }, { id: 'e', visible: true }, { id: 'c', visible: true }, { id: 'dep', visible: true }] },
  },
  {
    setting: 'properties: order', view: 'table',
    ui: (v, s) => ({ properties: withPropertyOrder(v, s, 'd', 'st') }),
    agent: { properties: [{ id: 't', visible: true }, { id: 'd', visible: true }, { id: 'st', visible: true }, { id: 'n', visible: true }, { id: 'e', visible: true }, { id: 'c', visible: true }, { id: 'dep', visible: true }] },
  },
  {
    setting: 'sorts', view: 'table',
    ui: () => ({ sorts: withEntryIds<SortConfig>([{ propertyId: 'n', direction: 'desc' }]) }), agent: { sorts: [{ propertyId: 'n', direction: 'desc' }] },
  },
  {
    setting: 'filters', view: 'table',
    ui: () => ({ filters: withEntryIds<FilterConfig>([{ propertyId: 'st', operator: 'equals', value: 'o2' }]) }), agent: { filters: [{ propertyId: 'st', operator: 'equals', value: 'o2' }] },
  },
  {
    setting: 'filterTree', view: 'table',
    ui: () => ({
      filterTree: {
        id: 'g', conjunction: 'or', filterRules: [
          { id: 'f1', propertyId: 'c', operator: 'equals', value: true },
          { id: 'g2', conjunction: 'and', filterRules: [{ id: 'f2', propertyId: 'n', operator: 'greater_than', value: 9 }] },
        ],
      },
    }),
    agent: {
      filterTree: {
        id: 'g', conjunction: 'or', filterRules: [
          { id: 'f1', propertyId: 'c', operator: 'equals', value: true },
          { id: 'g2', conjunction: 'and', filterRules: [{ id: 'f2', propertyId: 'n', operator: 'greater_than', value: 9 }] },
        ],
      },
    },
  },
  {
    setting: 'colorRules', view: 'table',
    ui: () => ({ colorRules: [{ id: 'cr', propertyId: 'st', operator: 'equals', value: 'o2', color: 'green' }] }),
    agent: { colorRules: [{ id: 'cr', propertyId: 'st', operator: 'equals', value: 'o2', color: 'green' }] },
  },
  {
    setting: 'colorRules applyTo property', view: 'table',
    ui: () => ({ colorRules: [{ id: 'cr', propertyId: 'n', operator: 'greater_than', value: 5, color: 'blue', applyTo: 'property' }] }),
    agent: { colorRules: [{ id: 'cr', propertyId: 'n', operator: 'greater_than', value: 5, color: 'blue', applyTo: 'property' }] },
  },
  { setting: 'groupBy (table)', view: 'table', ui: (v) => groupByChange(v, prop('st')), agent: { groupBy: 'st' } },
  { setting: 'groupBy (board, number)', view: 'board', ui: (v) => groupByChange(v, prop('n')), agent: { groupBy: 'n' } },
  {
    setting: 'groupSettings', view: seedView('board', { groupBy: 'n', groupSettings: {} }),
    ui: () => ({ groupSettings: { numberBy: 'range', rangeStart: 0, rangeEnd: 12, rangeSize: 4 } }),
    agent: { groupSettings: { numberBy: 'range', rangeStart: 0, rangeEnd: 12, rangeSize: 4 } },
  },
  { setting: 'groupSettings sort', view: 'board', ui: () => ({ groupSettings: { sort: 'ascending' } }), agent: { groupSettings: { sort: 'ascending' } } },
  { setting: 'subGroupBy', view: 'board', ui: (v) => subGroupByChange(v, prop('c')), agent: { subGroupBy: 'c' } },
  { setting: 'hiddenGroups', view: 'board', ui: () => ({ hiddenGroups: [{ id: 'o2' }] }), agent: { hiddenGroups: [{ id: 'o2' }] } },
  { setting: 'collapsedGroups', view: seedView('table', { groupBy: 'st' }), ui: () => ({ collapsedGroups: [{ id: 'o1' }] }), agent: { collapsedGroups: [{ id: 'o1' }] } },
  { setting: 'groupOrder', view: 'board', ui: () => ({ groupOrder: { o2: 'Zz' } }), agent: { groupOrder: { o2: 'Zz' } } },
  { setting: 'noValueGroupPosition', view: 'board', ui: () => ({ noValueGroupPosition: 'a' }), agent: { noValueGroupPosition: 'a' } },
  { setting: 'hideGroupAggregation', view: 'board', ui: () => ({ hideGroupAggregation: true }), agent: { hideGroupAggregation: true } },
  { setting: 'groupCalculation', view: 'board', ui: () => ({ groupCalculation: { id: 'n', fn: 'sum' } }), agent: { groupCalculation: { id: 'n', fn: 'sum' } } },
  { setting: 'cardSize', view: 'gallery', ui: () => ({ cardSize: 'large' }), agent: { cardSize: 'large' } },
  { setting: 'cardPreview', view: 'gallery', ui: () => ({ cardPreview: 'none' }), agent: { cardPreview: 'none' } },
  { setting: 'fitImage', view: seedView('gallery', { cardPreview: 'cover' }), ui: () => ({ fitImage: true }), agent: { fitImage: true }, drawn: false },
  { setting: 'cardLayout', view: seedView('board', { properties: [{ id: 'n', visible: true }, { id: 'c', visible: true }] }), ui: () => ({ cardLayout: 'compact' }), agent: { cardLayout: 'compact' } },
  { setting: 'calendarBy', view: 'calendar', ui: () => ({ calendarBy: 'e' }), agent: { calendarBy: 'e' } },
  { setting: 'calendarRange', view: 'calendar', ui: () => ({ calendarRange: 'week' }), agent: { calendarRange: 'week' } },
  { setting: 'showWeekends', view: 'calendar', ui: () => ({ showWeekends: false }), agent: { showWeekends: false } },
  { setting: 'timelineBy', view: 'timeline', ui: () => ({ timelineBy: 'e' }), agent: { timelineBy: 'e' } },
  { setting: 'timelineEndBy', view: 'timeline', ui: () => ({ timelineEndBy: 'e' }), agent: { timelineEndBy: 'e' } },
  { setting: 'timelineZoom', view: 'timeline', ui: () => ({ timelineZoom: 'week' }), agent: { timelineZoom: 'week' } },
  { setting: 'timelineCenter', view: 'timeline', ui: () => ({ timelineCenter: '2026-10-05' }), agent: { timelineCenter: '2026-10-05' } },
  { setting: 'showTimelineTable', view: 'timeline', ui: () => ({ showTimelineTable: true }), agent: { showTimelineTable: true } },
  {
    setting: 'tableProperties', view: seedView('timeline', { showTimelineTable: true }),
    ui: () => ({ tableProperties: [{ id: 'n', visible: true, width: 120 }] }), agent: { tableProperties: [{ id: 'n', visible: true, width: 120 }] },
  },
  { setting: 'arrowsBy', view: 'timeline', ui: () => ({ arrowsBy: 'dep' }), agent: { arrowsBy: 'dep' } },
  { setting: 'chartType', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartType: 'donut' }), agent: { chartType: 'donut' } },
  { setting: 'chartMeasure', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartMeasure: 'sum:n' }), agent: { chartMeasure: 'sum:n' } },
  { setting: 'chartSort', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartSort: 'yAscending' }), agent: { chartSort: 'yAscending' } },
  { setting: 'chartColor', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartColor: 'blue' }), agent: { chartColor: 'blue' }, drawn: false },
  { setting: 'chartHeight', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartHeight: 'large' }), agent: { chartHeight: 'large' } },
  { setting: 'chartGridLines', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartGridLines: 'both' }), agent: { chartGridLines: 'both' } },
  { setting: 'chartAxisNames', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartAxisNames: true }), agent: { chartAxisNames: true } },
  { setting: 'chartDataLabels', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartDataLabels: true }), agent: { chartDataLabels: true } },
  { setting: 'chartLegend', view: seedView('chart', { groupBy: 'st', subGroupBy: 'c' }), ui: () => ({ chartLegend: 'off' }), agent: { chartLegend: 'off' } },
  { setting: 'chartOmitZero', view: seedView('chart', { groupBy: 'st' }), ui: () => ({ chartOmitZero: true }), agent: { chartOmitZero: true }, drawn: false },
  { setting: 'chartCumulative', view: seedView('chart', { groupBy: 'n', chartSort: 'xAscending' }), ui: () => ({ chartCumulative: true }), agent: { chartCumulative: true } },
  { setting: 'chartSmooth', view: seedView('chart', { groupBy: 'st', chartType: 'line' }), ui: () => ({ chartSmooth: true }), agent: { chartSmooth: true } },
  { setting: 'chartGradient', view: seedView('chart', { groupBy: 'st', chartType: 'line' }), ui: () => ({ chartGradient: true }), agent: { chartGradient: true } },
  { setting: 'chartCenterValue', view: seedView('chart', { groupBy: 'st', chartType: 'donut' }), ui: () => ({ chartCenterValue: false }), agent: { chartCenterValue: false } },
  { setting: 'openPagesIn', view: 'table', ui: () => ({ openPagesIn: 'full' }), agent: { openPagesIn: 'full' }, drawn: false },
  { setting: 'subItemsDisplay', view: 'table', ui: () => ({ subItemsDisplay: 'flattened' }), agent: { subItemsDisplay: 'flattened' }, drawn: false },
  { setting: 'subItemsFilter', view: 'table', ui: () => ({ subItemsFilter: 'subItems' }), agent: { subItemsFilter: 'subItems' }, drawn: false },
  { setting: 'showDataSourceTitle', view: 'table', ui: () => ({ showDataSourceTitle: false }), agent: { showDataSourceTitle: false }, drawn: false },
  { setting: 'groupByStatus', view: 'board', ui: () => ({ groupByStatus: 'group' }), agent: { groupByStatus: 'group' }, drawn: false },
  {
    setting: 'form', view: 'form',
    ui: () => ({ form: { submitLabel: 'Send', confirmation: 'Thanks' } }), agent: { form: { submitLabel: 'Send', confirmation: 'Thanks' } },
  },
  {
    setting: 'form questions', view: 'form',
    ui: (v, s) => ({ properties: withPropertySetting(v, s, 'n', { required: true, description: 'How big', questionName: 'Size?' }) }),
    agent: { properties: [{ id: 't', visible: true }, { id: 'st', visible: true }, { id: 'n', visible: true, required: true, description: 'How big', questionName: 'Size?' }, { id: 'd', visible: true }, { id: 'e', visible: true }, { id: 'c', visible: true }, { id: 'dep', visible: true }] },
  },
  { setting: 'mapHeight', view: 'map', ui: () => ({ mapHeight: 'large' }), agent: { mapHeight: 'large' }, drawn: false },
  {
    setting: 'dashboard', view: 'dashboard',
    ui: () => ({ dashboard: { rows: [{ id: 'row', widgets: [{ id: 'w', viewId: 'v1', width: 12 }] }] } }),
    agent: { dashboard: { rows: [{ id: 'row', widgets: [{ id: 'w', viewId: 'v1', width: 12 }] }] } }, drawn: false,
  },
];

const viewFor = (view: Case['view']): DatabaseViewConfig => (typeof view === 'string' ? seedView(view) : view);

describe('a view the agent writes saves and renders as the editor\'s own write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  });

  afterEach(async () => {
    await teardown();
    Reflect.deleteProperty(document, 'elementFromPoint');
    vi.restoreAllMocks();
  });

  it.each(CASES.map(each => [each.setting, each] as const))('%s', async (_setting, { view, ui, agent, drawn }) => {
    const seed = blocksOf(viewFor(view));
    const before = await capture((await bootTouched(seed)).instance);

    await teardown();
    const expected = await capture((await bootTouched(uiWrite(seed, ui))).instance);

    await teardown();
    const written = await bootTouched(seed, [{ name: 'database.updateView', args: { id: 'db', viewId: 'v1', changes: agent } }]);

    expect(written.error).toBeNull();
    const actual = await capture(written.instance);

    expect(actual.saved).toEqual(expected.saved);
    if (drawn !== false) {
      // The write drew something, so equal DOM is not two untouched views.
      expect(expected.html).not.toBe(before.html);
      expect(actual.html).toBe(expected.html);
    }
  }, 60_000);

  it('a views change from the document leaves one Add view button in a single view title row', async () => {
    const instance = await boot(blocksOf(seedView('table')));

    expect(await runAgent(instance, { commands: [{ name: 'database.renameView', args: { id: 'db', viewId: 'v1', name: 'Mine' } }] })).toBeNull();
    await quiet();

    expect(holder?.querySelectorAll('[data-blok-database-title-row] [data-blok-database-add-view]')).toHaveLength(1);
  }, 60_000);

  it.each([['board'], ['timeline'], ['calendar'], ['gallery'], ['list'], ['chart']] as const)('setLayout %s draws as the layout menu\'s switch', async (type) => {
    const seed = blocksOf(seedView('table'));
    const expected = await capture((await bootTouched(uiWrite(seed, (v, s) => layoutChange(v, type, s)?.changes ?? {}))).instance);

    await teardown();
    const written = await bootTouched(seed, [{ name: 'database.setLayout', args: { id: 'db', viewId: 'v1', type } }]);

    expect(written.error).toBeNull();
    const actual = await capture(written.instance);

    expect(actual.saved).toEqual(expected.saved);
    expect(actual.html).toBe(expected.html);
  }, 60_000);
});

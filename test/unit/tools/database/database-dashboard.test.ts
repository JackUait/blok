import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildTool, fakeRow, makeDoc } from './tier3-harness';

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
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a1' },
  { id: 'amount', name: 'Amount', type: 'number', position: 'a2' },
];

const view = (id: string, fields: Partial<DatabaseViewConfig>): DatabaseViewConfig => ({
  id, name: id, type: 'table', position: 'a0', sorts: [], filters: [],
  visibleProperties: [], ...fields,
});

const fixture = (): DatabaseData => ({
  schema,
  views: [
    view('todo', {
      filters: [{ propertyId: 'done', operator: 'equals', value: false }],
      sorts: [{ propertyId: 'title', direction: 'asc' }],
    }),
    view('done', {
      type: 'list',
      filters: [{ propertyId: 'done', operator: 'equals', value: true }],
    }),
    view('dash', {
      type: 'dashboard',
      dashboard: { rows: [{ id: 'row', height: 240, widgets: [
        { id: 'w-todo', viewId: 'todo', width: 7 },
        { id: 'w-done', viewId: 'done', width: 5 },
      ] }] },
    }),
  ],
  activeViewId: 'dash',
});

const rows = () => [
  fakeRow('c', 'db', { title: 'Charlie', done: false, amount: 30 }, 'a0'),
  fakeRow('b', 'db', { title: 'Bravo', done: true, amount: 20 }, 'a1'),
  fakeRow('a', 'db', { title: 'Alpha', done: false, amount: 10 }, 'a2'),
];

const tools: Array<ReturnType<typeof buildTool>['tool']> = [];
const mount = (data: DatabaseData) => {
  const result = buildTool(makeDoc(rows()), {}, data);

  tools.push(result.tool);
  return result;
};
const rowIds = (el: HTMLElement, widgetId: string): string[] =>
  [...el.querySelectorAll<HTMLElement>(
    `[data-blok-database-dashboard-widget="${CSS.escape(widgetId)}"] [data-row-id]`
  )]
    .filter((row) => row.matches('[data-blok-database-table-row], [data-blok-database-list-row]'))
    .map((row) => row.getAttribute('data-row-id') ?? '');

describe('DatabaseTool — dashboard widgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    tools.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders each stored native view with its own filter and sort', () => {
    const { tool, el } = mount(fixture());

    expect(rowIds(el, 'w-todo')).toEqual(['a', 'c']);
    expect(rowIds(el, 'w-done')).toEqual(['b']);
    expect(tool.save(el).activeViewId).toBe('dash');
    expect(el.querySelector('[data-blok-database-dashboard-placeholder]')).toBeNull();
  });

  it('renders a saved layout without changing it or minting row blocks', () => {
    const input = fixture();
    const doc = makeDoc(rows());
    const { tool, el } = buildTool(doc, {}, input);

    tools.push(tool);

    expect(rowIds(el, 'w-todo')).toEqual(['a', 'c']);
    expect(tool.save(el).views.find((entry) => entry.id === 'dash')?.dashboard)
      .toEqual(input.views.find((entry) => entry.id === 'dash')?.dashboard);
    expect(doc.api.blocks.insertAt).not.toHaveBeenCalled();
    expect(doc.rows.size).toBe(3);
  });

  it('keeps missing and dashboard references as visible errors beside valid widgets', () => {
    const input = fixture();
    const dash = input.views.find((entry) => entry.id === 'dash');

    if (dash?.dashboard === undefined) throw new Error('missing dashboard fixture');
    dash.dashboard.rows.push({ id: 'invalid', widgets: [
      { id: 'missing', viewId: 'gone', width: 4 },
      { id: 'self', viewId: 'dash', width: 4 },
      { id: 'cycle', viewId: 'other-dash', width: 4 },
    ] });
    input.views.push(view('other-dash', {
      type: 'dashboard',
      dashboard: { rows: [{ id: 'back', widgets: [{ id: 'back', viewId: 'dash', width: 12 }] }] },
    }));
    const { tool, el } = mount(input);

    expect([...el.querySelectorAll('[data-blok-database-dashboard-widget-error]')]
      .map((node) => node.getAttribute('data-blok-database-dashboard-widget-error')))
      .toEqual(['missing-view', 'dashboard-view', 'dashboard-view']);
    expect(rowIds(el, 'w-todo')).toEqual(['a', 'c']);
    expect(tool.save(el).views.find((entry) => entry.id === 'dash')?.dashboard)
      .toEqual(dash.dashboard);
  });
});

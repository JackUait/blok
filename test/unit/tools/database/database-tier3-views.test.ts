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
  { id: 'where', name: 'Where', type: 'place', position: 'a1' },
];

const dataWith = (view: Partial<DatabaseViewConfig>): DatabaseData => ({
  schema,
  views: [{ id: 'v', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
  activeViewId: 'v',
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('DatabaseTool — form, map and dashboard views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a form submit adds the answers as a row and tells the host', async () => {
    const doc = makeDoc([]);
    const onSubmit = vi.fn();
    const onTrigger = vi.fn();
    const { el } = buildTool(doc, { forms: { onSubmit }, automations: { onTrigger } }, dataWith({ type: 'form' }));
    const name = el.querySelector<HTMLInputElement>('[data-blok-database-form-question="title"] input');

    if (name === null) throw new Error('no Name question');
    name.value = 'Ada';
    el.querySelector<HTMLButtonElement>('[data-blok-database-form-submit]')?.click();
    await flush();

    const rowId = doc.order[0];

    expect(doc.rows.get(rowId)?.data.properties.title).toBe('Ada');
    expect(onSubmit).toHaveBeenCalledWith({ databaseId: 'db', viewId: 'v', values: { title: 'Ada' }, rowId, sharing: { public: false, anonymous: false, submissionAccess: 'none' } });
    expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining({ type: 'pageAdded', rowId }), expect.anything());
    expect(el.querySelector('[data-blok-database-form-confirmation]')).not.toBeNull();
  });

  it('a read-only form only hands the answers to the host', () => {
    const doc = makeDoc([]);
    const onSubmit = vi.fn();
    const { el } = buildTool(doc, { forms: { onSubmit } }, dataWith({ type: 'form' }), true);
    const name = el.querySelector<HTMLInputElement>('[data-blok-database-form-question="title"] input');

    if (name === null) throw new Error('no Name question');
    name.value = 'Ada';
    el.querySelector<HTMLButtonElement>('[data-blok-database-form-submit]')?.click();

    expect(doc.order).toEqual([]);
    expect(onSubmit).toHaveBeenCalledWith({ databaseId: 'db', viewId: 'v', values: { title: 'Ada' }, sharing: { public: false, anonymous: false, submissionAccess: 'none' } });
  });

  it('the form builder\'s Required toggle saves on the view property', () => {
    const doc = makeDoc([]);
    const { tool, el } = buildTool(doc, {}, dataWith({ type: 'form' }));

    el.querySelector<HTMLInputElement>('[data-blok-database-form-required="where"]')?.click();

    expect(tool.save(el).views[0].properties?.find((entry) => entry.id === 'where')?.required).toBe(true);
  });

  it('a map without the lever shows the empty state; with it the host draws the rows', async () => {
    const rows = [fakeRow('a', 'db', { title: 'HQ', where: { address: '1 Main St' } }, 'a0')];
    const plain = buildTool(makeDoc(rows), {}, dataWith({ type: 'map' })).el;
    const render = vi.fn();

    buildTool(makeDoc(rows), { map: { render } }, dataWith({ type: 'map' }));
    await flush();

    expect(plain.querySelector('[data-blok-database-map-empty="no-provider"]')).not.toBeNull();
    expect(render).toHaveBeenCalledWith(expect.any(HTMLElement), [{ rowId: 'a', title: 'HQ', place: { address: '1 Main St' } }], expect.anything());
  });

  it('a dashboard view draws its widget slot and keeps it on save', () => {
    const dashboard = { rows: [{ id: 'r', widgets: [{ id: 'w', viewId: 'v', width: 12 }] }] };
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith({ type: 'dashboard', dashboard }));

    expect(el.querySelector('[data-blok-database-dashboard-widget="w"]')).not.toBeNull();
    expect(tool.save(el).views[0].dashboard).toEqual(dashboard);
  });

  it('adds a form or a map view from the add-view menu types, with its default name', () => {
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith({}));

    tool.addView('form');
    tool.addView('map');

    expect(tool.save(el).views.map((view) => [view.type, view.name])).toEqual([['table', 'View'], ['form', 'Form'], ['map', 'Map']]);
  });
});

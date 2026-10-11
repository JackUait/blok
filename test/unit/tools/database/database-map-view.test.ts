import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseMapView } from '../../../../src/tools/database/database-map-view';
import type { DatabaseMapViewOptions } from '../../../../src/tools/database/database-map-view';
import type { DatabaseMapItem, DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'home', name: 'Home', type: 'place', position: 'a1' },
  { id: 'office', name: 'Office', type: 'place', position: 'a2' },
];

const rows: DatabaseRow[] = [
  { id: 'r1', position: 'a0', properties: { title: 'Ada', home: { name: 'London', lat: 51.5, lon: -0.12 }, office: { address: 'Paris' } } },
  { id: 'r2', position: 'a1', properties: { title: 'Bob', home: null } },
];

const view = (extra: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id: 'map', name: 'Map', type: 'map', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...extra,
});

const mount = (overrides: Partial<DatabaseMapViewOptions> = {}): { root: HTMLElement; mapView: DatabaseMapView; open: ReturnType<typeof vi.fn> } => {
  const open = vi.fn();
  const mapView = new DatabaseMapView({
    i18n: { t: (key: string) => key },
    view: view(),
    schema,
    rows,
    titlePropertyId: 'title',
    open,
    ...overrides,
  });
  const root = mapView.createView();

  document.body.appendChild(root);

  return { root, mapView, open };
};

const flush = (): Promise<void> => Promise.resolve();

describe('DatabaseMapView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('without a map lever shows an honest empty state, not a fake map', () => {
    const { root } = mount();

    expect(root.querySelector('[data-blok-database-map-empty]')?.getAttribute('data-blok-database-map-empty')).toBe('no-provider');
    expect(root.textContent).toContain('tools.database.mapNoProvider');
  });

  it('without a place property says a Place property is needed', () => {
    const { root } = mount({ schema: [schema[0]], render: vi.fn() });

    expect(root.querySelector('[data-blok-database-map-empty]')?.getAttribute('data-blok-database-map-empty')).toBe('no-place');
  });

  it('hands the host the rows that have a place, by the first place property, once attached', async () => {
    const render = vi.fn();
    const { root } = mount({ render });

    expect(render).not.toHaveBeenCalled();
    await flush();

    const [container, items] = render.mock.calls[0] as [HTMLElement, DatabaseMapItem[]];

    expect(container.isConnected).toBe(true);
    expect(root.contains(container)).toBe(true);
    expect(items).toEqual([{ rowId: 'r1', title: 'Ada', place: { name: 'London', lat: 51.5, lon: -0.12 } }]);
  });

  it('maps by view.mapBy, and a pin opens its row', async () => {
    const render = vi.fn((_container: HTMLElement, _items: DatabaseMapItem[], ctx: { open(rowId: string): void }) => ctx.open('r1'));
    const { open } = mount({ render, view: view({ mapBy: 'office' }) });

    await flush();

    expect(render.mock.calls[0][1]).toEqual([{ rowId: 'r1', title: 'Ada', place: { address: 'Paris' } }]);
    expect(open).toHaveBeenCalledWith('r1');
  });

  it('destroy drops the host map', async () => {
    const destroy = vi.fn();
    const { mapView } = mount({ render: () => ({ destroy }) });

    await flush();
    mapView.destroy();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('a host map that throws falls back to the empty state', async () => {
    const { root } = mount({ render: () => { throw new Error('no key'); } });

    await flush();

    expect(root.querySelector('[data-blok-database-map-empty]')?.getAttribute('data-blok-database-map-empty')).toBe('no-provider');
  });
});

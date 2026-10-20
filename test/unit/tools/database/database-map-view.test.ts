import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const draw = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/tools/database/database-maplibre', () => ({ drawMapLibreMap: draw }));

import { DatabaseMapView } from '../../../../src/tools/database/database-map-view';
import type { DatabaseMapViewOptions } from '../../../../src/tools/database/database-map-view';
import type { DatabaseMapContext, DatabaseMapItem, DatabaseRow, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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

  it('without a map style or a host map it says a map style is needed, and loads no map', async () => {
    const { root } = mount();

    await flush();
    expect(root.querySelector('[data-blok-database-map-empty]')?.getAttribute('data-blok-database-map-empty')).toBe('no-style');
    expect(root.textContent).toBe('tools.database.mapNoStyle');
    expect(draw).not.toHaveBeenCalled();
  });

  it('with a map style Blok draws its own map into the canvas, once attached', async () => {
    const style = 'https://tiles.example.test/style.json';
    const { root } = mount({ style, breadcrumb: 'Trips' });

    expect(draw).not.toHaveBeenCalled();
    await flush();
    const [container, items, ctx, options] = draw.mock.calls[0] as [HTMLElement, DatabaseMapItem[], DatabaseMapContext, { style: unknown; breadcrumb: string }];

    expect(container).toBe(root.querySelector('[data-blok-database-map-canvas]'));
    expect(container.isConnected).toBe(true);
    expect(items).toEqual([{ rowId: 'r1', title: 'Ada', place: { name: 'London', lat: 51.5, lon: -0.12 } }]);
    expect(ctx.height).toBe(400);
    expect(options).toMatchObject({ style, breadcrumb: 'Trips' });
  });

  it('a host map still wins over the map style', async () => {
    const render = vi.fn();

    mount({ render, style: 'https://tiles.example.test/style.json' });
    await flush();

    expect(render).toHaveBeenCalledTimes(1);
    expect(draw).not.toHaveBeenCalled();
  });

  it.each([
    ['no-webgl', 'tools.database.mapNoWebgl'],
    ['failed', 'tools.database.mapLoadFailed'],
  ] as const)('Blok\'s map that cannot draw (%s) shows a message in its place', async (reason, key) => {
    draw.mockImplementationOnce((_container: HTMLElement, _items: unknown, _ctx: unknown, options: { onFail(r: string): void }) => {
      options.onFail(reason);

      return { destroy: vi.fn() };
    });
    const { root } = mount({ style: 'https://tiles.example.test/style.json', writable: true, addPin: vi.fn() });

    await flush();

    expect(root.querySelector('[data-blok-database-map-canvas]')).toBeNull();
    expect(root.querySelector('[data-blok-database-map-add-pin]')).toBeNull();
    expect(root.querySelector('[data-blok-database-map-empty]')?.getAttribute('data-blok-database-map-empty')).toBe(reason);
    expect(root.textContent).toContain(key);
  });

  it('destroy drops Blok\'s map', async () => {
    const destroy = vi.fn();

    draw.mockReturnValueOnce({ destroy });
    const { mapView } = mount({ style: { version: 8, sources: {}, layers: [] } });

    await flush();
    mapView.destroy();

    expect(destroy).toHaveBeenCalledTimes(1);
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

  it('hands each pin its conditional color', async () => {
    const render = vi.fn();

    mount({ render, colors: new Map([['r1', 'purple']]) });
    await flush();

    expect(render.mock.calls[0][1]).toEqual([{ rowId: 'r1', title: 'Ada', place: { name: 'London', lat: 51.5, lon: -0.12 }, color: 'purple' }]);
  });

  it('sizes the map by its Height, Medium (400px) by default, and tells the host', async () => {
    const render = vi.fn();
    const medium = mount({ render });

    await flush();
    expect(medium.root.querySelector<HTMLElement>('[data-blok-database-map-canvas]')?.style.height).toBe('400px');
    expect(render.mock.calls[0][2]).toMatchObject({ height: 400 });

    const large = mount({ render, view: view({ mapHeight: 'extraLarge' }) });

    await flush();
    expect(large.root.querySelector<HTMLElement>('[data-blok-database-map-canvas]')?.style.height).toBe('800px');
    expect(render.mock.calls[1][2]).toMatchObject({ height: 800 });
  });

  it('hands the host at most the view\'s load limit of pins', async () => {
    const render = vi.fn();
    const many: DatabaseRow[] = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`, position: `a${i}`, properties: { title: `P${i}`, home: { address: `${i} Main St` } },
    }));

    mount({ render, rows: many, view: view({ loadLimit: 10 }) });
    await flush();

    expect(render.mock.calls[0][1]).toHaveLength(10);
  });

  it('shows a "No place (N)" chip whose list searches and opens the rows without a place (research/20 §1e)', async () => {
    const extra: DatabaseRow[] = [...rows, { id: 'r3', position: 'a2', properties: { title: 'Cid' } }];
    const { root, open } = mount({
      render: vi.fn(),
      rows: extra,
      writable: true,
      i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}:${Object.values(vars).join(',')}`) },
    });

    await flush();
    const chip = root.querySelector<HTMLButtonElement>('[data-blok-database-map-no-place]');

    expect(chip?.textContent).toBe('tools.database.mapNoPlaceCount:2');
    expect(chip?.getAttribute('aria-haspopup')).toBe('dialog');
    chip?.click();

    const search = document.querySelector<HTMLInputElement>('[data-blok-database-map-no-place-search]');

    expect(search?.placeholder).toBe('tools.database.relationSearchPlaceholder');
    const listed = (): string[] => [...document.querySelectorAll('[data-blok-database-map-no-place-row]')].map((row) => row.textContent ?? '');

    expect(listed()).toEqual(['Bob', 'Cid']);
    if (search === null) throw new Error('no search');
    search.value = 'ci';
    search.dispatchEvent(new Event('input'));
    expect(listed()).toEqual(['Cid']);

    document.querySelector<HTMLElement>('[data-blok-database-map-no-place-row]')?.click();
    expect(open).toHaveBeenCalledWith('r3');
  });

  // research/23 §5c: the list stays open under the row page; Escape closes the page, then the list.
  it('keeps the "No place" list under an opened row page and shows it again, query kept, when the page closes', async () => {
    const extra: DatabaseRow[] = [...rows, { id: 'r3', position: 'a2', properties: { title: 'Cid' } }];
    const { root, open, mapView } = mount({ render: vi.fn(), rows: extra, writable: true });
    const search = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-blok-database-map-no-place-search]');

    await flush();
    root.querySelector<HTMLButtonElement>('[data-blok-database-map-no-place]')?.click();
    const field = search();

    if (field === null) throw new Error('no search');
    field.value = 'ci';
    field.dispatchEvent(new Event('input'));
    document.querySelector<HTMLElement>('[data-blok-database-map-no-place-row]')?.click();

    expect(open).toHaveBeenCalledWith('r3');
    // Under the page: not drawn over it.
    expect(search()).toBeNull();

    mapView.rowPageClosed();
    await flush();

    expect(search()?.value).toBe('ci');
    expect(search()).toHaveFocus();
    expect([...document.querySelectorAll('[data-blok-database-map-no-place-row]')].map((row) => row.textContent)).toEqual(['Cid']);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(search()).toBeNull();
    mapView.rowPageClosed();
    await flush();
    expect(search()).toBeNull();
  });

  it('a row page closing with no list under it opens nothing', async () => {
    const { mapView } = mount({ render: vi.fn(), writable: true });

    await flush();
    mapView.rowPageClosed();
    await flush();

    expect(document.querySelector('[data-blok-database-map-no-place-search]')).toBeNull();
  });

  it('lists the rows without a place newest first (research/23 §5c)', async () => {
    const unplaced: DatabaseRow[] = [
      rows[0],
      { id: 'old', position: 'a1', properties: { title: 'Old' }, meta: { createdAt: 1 } },
      { id: 'new', position: 'a2', properties: { title: 'New' }, meta: { createdAt: 3 } },
      { id: 'mid', position: 'a3', properties: { title: 'Mid' }, meta: { createdAt: 2 } },
    ];
    const { root } = mount({ render: vi.fn(), rows: unplaced, writable: true });

    await flush();
    root.querySelector<HTMLButtonElement>('[data-blok-database-map-no-place]')?.click();

    expect([...document.querySelectorAll('[data-blok-database-map-no-place-row]')].map((row) => row.textContent)).toEqual(['New', 'Mid', 'Old']);
  });

  it('every row placed: no chip', async () => {
    const { root } = mount({ render: vi.fn(), rows: [rows[0]], writable: true });

    await flush();
    expect(root.querySelector('[data-blok-database-map-no-place]')).toBeNull();
  });

  it('read-only shows no "No place" chip and no Add pin button', async () => {
    const { root } = mount({ render: vi.fn(), writable: false, addPin: vi.fn() });

    await flush();
    expect(root.querySelector('[data-blok-database-map-no-place]')).toBeNull();
    expect(root.querySelector('[data-blok-database-map-add-pin]')).toBeNull();
  });

  it('Add pin mode: the button toggles it, and a map click in it adds a pin once', async () => {
    const addPin = vi.fn();
    const render = vi.fn();
    const { root } = mount({ render, writable: true, addPin });

    await flush();
    const ctx = render.mock.calls[0][2] as DatabaseMapContext;
    const button = root.querySelector<HTMLButtonElement>('[data-blok-database-map-add-pin]');
    const canvas = root.querySelector<HTMLElement>('[data-blok-database-map-canvas]');

    expect(button?.getAttribute('aria-label')).toBe('tools.database.mapEnableAddPin');
    ctx.onAddPin({ lng: 2.29, lat: 48.85 });
    expect(addPin).not.toHaveBeenCalled();

    button?.click();
    expect(ctx.addingPin()).toBe(true);
    expect(button?.getAttribute('aria-label')).toBe('tools.database.mapCancelAddPin');
    expect(canvas?.hasAttribute('data-blok-database-map-adding-pin')).toBe(true);

    ctx.onAddPin({ lng: 2.29, lat: 48.85 });
    ctx.onAddPin({ lng: 3, lat: 49 });

    expect(addPin).toHaveBeenCalledTimes(1);
    expect(addPin).toHaveBeenCalledWith({ lng: 2.29, lat: 48.85 });
    expect(ctx.addingPin()).toBe(false);
    expect(button?.getAttribute('aria-label')).toBe('tools.database.mapEnableAddPin');
    expect(canvas?.hasAttribute('data-blok-database-map-adding-pin')).toBe(false);
  });

  it('pressing the button again cancels Add pin mode', async () => {
    const render = vi.fn();
    const { root } = mount({ render, writable: true, addPin: vi.fn() });

    await flush();
    const ctx = render.mock.calls[0][2] as DatabaseMapContext;
    const button = root.querySelector<HTMLButtonElement>('[data-blok-database-map-add-pin]');

    button?.click();
    button?.click();
    expect(ctx.addingPin()).toBe(false);
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData, DatabaseMapContext, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { onHover } from '../../../../src/components/utils/tooltip';
import type * as Tooltip from '../../../../src/components/utils/tooltip';
import { buildTool, fakeRow, makeDoc } from './tier3-harness';

const maplibre = vi.hoisted(() => ({ map: vi.fn(), place: vi.fn() }));

vi.mock('../../../../src/tools/database/database-maplibre', () => ({ drawMapLibreMap: maplibre.map, drawMapLibrePlace: maplibre.place }));

vi.mock('../../../../src/components/utils/tooltip', async (importOriginal) => ({
  ...await importOriginal<typeof Tooltip>(),
  onHover: vi.fn(),
}));

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const noPlace: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
];

const dataWith = (schema: PropertyDefinition[], view: Partial<DatabaseViewConfig> = {}): DatabaseData => ({
  schema,
  views: [{ id: 'v', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
  activeViewId: 'v',
});

const click = (id: string): void => {
  const target = document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

  if (target === null) throw new Error(`no ${id}`);
  target.click();
};

describe('DatabaseTool — map view (research/20 §1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a new map view adds a "Place" property when the database has none', () => {
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(noPlace));

    tool.addView('map');

    const places = tool.save(el).schema.filter((p) => p.type === 'place');

    expect(places.map((p) => p.name)).toEqual(['tools.database.propertyTypePlace']);
  });

  it('switching a view to the map layout adds a "Place" property when the database has none', () => {
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(noPlace));

    click('database-toolbar-settings');
    click('database-settings-layout');
    click('database-layout-map');

    expect(tool.save(el).schema.filter((p) => p.type === 'place')).toHaveLength(1);
    expect(tool.save(el).views[0].type).toBe('map');
  });

  it('a database that already has a place property gets no second one', () => {
    const withPlace: PropertyDefinition[] = [...noPlace, { id: 'where', name: 'Where', type: 'place', position: 'a2' }];
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(withPlace));

    tool.addView('map');

    expect(tool.save(el).schema.filter((p) => p.type === 'place').map((p) => p.id)).toEqual(['where']);
  });

  it('conditional color colors the pins the host draws', async () => {
    const withPlace: PropertyDefinition[] = [...noPlace, { id: 'where', name: 'Where', type: 'place', position: 'a2' }];
    const rows = [
      fakeRow('a', 'db', { title: 'Urgent HQ', where: { address: '1 Main St' } }, 'a0'),
      fakeRow('b', 'db', { title: 'Depot', where: { address: '2 Main St' } }, 'a1'),
    ];
    const render = vi.fn();

    buildTool(makeDoc(rows), { map: { render } }, dataWith(withPlace, {
      type: 'map',
      colorRules: [{ id: 'c', propertyId: 'title', operator: 'contains', value: 'Urgent', color: 'red' }],
    }));
    await Promise.resolve();

    expect(render.mock.calls[0][1]).toEqual([
      { rowId: 'a', title: 'Urgent HQ', place: { address: '1 Main St' }, color: 'red' },
      { rowId: 'b', title: 'Depot', place: { address: '2 Main St' } },
    ]);
  });

  const withPlace: PropertyDefinition[] = [...noPlace, { id: 'where', name: 'Where', type: 'place', position: 'a2' }];
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('a pin click opens the row in a center peek, the map default (research/20 §1e)', async () => {
    const rows = [fakeRow('a', 'db', { title: 'HQ', where: { address: '1 Main St' } }, 'a0')];
    const render = vi.fn();

    buildTool(makeDoc(rows), { map: { render } }, dataWith(withPlace, { type: 'map' }));
    await settle();
    (render.mock.calls[0][2] as DatabaseMapContext).open('a');

    expect(document.querySelector('[data-blok-database-drawer]')?.getAttribute('data-peek-mode')).toBe('center');
  });

  it('add-pin mode adds a row named by the host reverse geocoder, opens it, and ends the mode', async () => {
    const doc = makeDoc([]);
    const render = vi.fn();
    const reverseGeocode = vi.fn(() => Promise.resolve({ name: '5 Avenue Anatole France', address: '5 Avenue Anatole France, 75007 Paris, France' }));

    buildTool(doc, { map: { render, reverseGeocode } }, dataWith(withPlace, { type: 'map' }));
    await settle();
    const ctx = render.mock.calls[0][2] as DatabaseMapContext;

    document.querySelector<HTMLButtonElement>('[data-blok-database-map-add-pin]')?.click();
    ctx.onAddPin({ lng: 2.29, lat: 48.85 });
    await settle();

    expect(reverseGeocode).toHaveBeenCalledWith({ lng: 2.29, lat: 48.85 });
    expect(doc.order).toHaveLength(1);
    expect(doc.rows.get(doc.order[0])?.data.properties).toMatchObject({
      title: '5 Avenue Anatole France',
      where: { name: '5 Avenue Anatole France', address: '5 Avenue Anatole France, 75007 Paris, France', lat: 48.85, lon: 2.29 },
    });
    expect(document.querySelector('[data-blok-database-drawer]')?.getAttribute('data-peek-mode')).toBe('center');
  });

  it('without a reverse geocoder, or when it fails, the pin keeps the point and no title', async () => {
    const doc = makeDoc([]);
    const render = vi.fn();

    buildTool(doc, { map: { render, reverseGeocode: () => Promise.reject(new Error('offline')) } }, dataWith(withPlace, { type: 'map' }));
    await settle();
    document.querySelector<HTMLButtonElement>('[data-blok-database-map-add-pin]')?.click();
    (render.mock.calls[0][2] as DatabaseMapContext).onAddPin({ lng: 2.29, lat: 48.85 });
    await settle();

    expect(doc.rows.get(doc.order[0])?.data.properties.where).toEqual({ lat: 48.85, lon: 2.29 });
  });

  it('config.map.styleUrl alone: Blok draws the map with that style, named after the database', async () => {
    const rows = [fakeRow('a', 'db', { title: 'HQ', where: { name: 'HQ', lat: 1, lon: 2 } }, 'a0')];
    const styleUrl = 'https://tiles.example.test/style.json';

    buildTool(makeDoc(rows), { map: { styleUrl } }, { ...dataWith(withPlace, { type: 'map' }), title: 'Trips' });
    await settle();

    const [container, items, , options] = maplibre.map.mock.calls[0] as [HTMLElement, unknown[], DatabaseMapContext, { style: unknown; breadcrumb: string }];

    expect(container.matches('[data-blok-database-map-canvas]')).toBe(true);
    expect(items).toEqual([{ rowId: 'a', title: 'HQ', place: { name: 'HQ', lat: 1, lon: 2 } }]);
    expect(options).toMatchObject({ style: styleUrl, breadcrumb: 'Trips' });
  });

  it('no style and no host map: the map says a style is needed and draws nothing', async () => {
    buildTool(makeDoc([]), {}, dataWith(withPlace, { type: 'map' }));
    await settle();

    expect(document.querySelector('[data-blok-database-map-empty]')?.getAttribute('data-blok-database-map-empty')).toBe('no-style');
    expect(maplibre.map).not.toHaveBeenCalled();
  });

  const placeCard = (): HTMLElement | undefined => {
    const cell = document.querySelector<HTMLElement>('[data-row-id="a"] [role="gridcell"][data-property-id="where"] [data-blok-database-cell-content], [data-row-id="a"] [role="gridcell"][data-property-id="where"]');
    const call = vi.mocked(onHover).mock.calls.find(([element]) => cell !== null && (element === cell || cell.contains(element)));

    return call?.[1] instanceof HTMLElement ? call[1] : undefined;
  };

  it('with a style, the Place hover card gets Blok\'s mini-map', async () => {
    const rows = [fakeRow('a', 'db', { title: 'HQ', where: { name: 'HQ', lat: 1, lon: 2 } }, 'a0')];

    buildTool(makeDoc(rows), {}, dataWith(withPlace));
    expect(placeCard()?.querySelector('[data-blok-database-place-card-map]')).toBeNull();
    document.body.innerHTML = '';
    vi.mocked(onHover).mockClear();

    buildTool(makeDoc(rows), { map: { styleUrl: 'https://tiles.example.test/style.json' } }, dataWith(withPlace));
    expect(placeCard()?.querySelector('[data-blok-database-place-card-map]')).not.toBeNull();
  });

  it('the Place editor searches with config.map.geocode', async () => {
    vi.useFakeTimers();
    try {
      const rows = [fakeRow('a', 'db', { title: 'HQ' }, 'a0')];
      const geocode = vi.fn(() => [{ name: 'Eiffel Tower', address: 'Paris', lat: 48.8, lon: 2.3 }]);

      buildTool(makeDoc(rows), { map: { geocode } }, dataWith(withPlace));
      document.querySelector<HTMLElement>('[data-row-id="a"] [role="gridcell"][data-property-id="where"]')?.click();
      const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]');

      if (field === null) throw new Error('no place editor');
      field.value = 'Eiffel';
      field.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(300);

      expect(geocode).toHaveBeenCalledWith('Eiffel');
      expect(document.querySelector('[data-blok-database-place-result-name]')?.textContent).toBe('Eiffel Tower');
    } finally {
      vi.useRealTimers();
    }
  });

  it('read-only draws no Add pin button and no "No place" chip', async () => {
    const rows = [fakeRow('a', 'db', { title: 'Nowhere' }, 'a0')];

    buildTool(makeDoc(rows), { map: { render: vi.fn() } }, dataWith(withPlace, { type: 'map' }), true);
    await settle();

    expect(document.querySelector('[data-blok-database-map-add-pin]')).toBeNull();
    expect(document.querySelector('[data-blok-database-map-no-place]')).toBeNull();
  });

  it('a writable map shows the "No place" chip for rows without a place', async () => {
    const rows = [fakeRow('a', 'db', { title: 'Nowhere' }, 'a0')];

    buildTool(makeDoc(rows), { map: { render: vi.fn() } }, dataWith(withPlace, { type: 'map' }));
    await settle();

    expect(document.querySelector('[data-blok-database-map-no-place]')).not.toBeNull();
    expect(document.querySelector('[data-blok-database-map-add-pin]')).not.toBeNull();
  });
});

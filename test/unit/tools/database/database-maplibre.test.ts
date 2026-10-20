import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseMapContext, DatabaseMapItem } from '../../../../src/tools/database/types';

type Handler = (event?: unknown) => void;

const env = { webgl: true, maps: [] as FakeMap[], markers: [] as FakeMarker[], load: null as Promise<unknown> | null };

class FakeMap {
  readonly handlers = new Map<string, Handler[]>();
  readonly fitBounds = vi.fn();
  readonly resize = vi.fn();
  readonly remove = vi.fn();
  readonly addControl = vi.fn();
  readonly setCenter = vi.fn();
  readonly canvasContainer = document.createElement('div');

  constructor(readonly options: Record<string, unknown> & { container: HTMLElement }) {
    if (!env.webgl) throw new Error('Failed to initialize WebGL');
    options.container.appendChild(this.canvasContainer);
    env.maps.push(this);
  }

  on(type: string, handler: Handler): this {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);

    return this;
  }

  off(type: string, handler: Handler): this {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter((h) => h !== handler));

    return this;
  }

  fire(type: string, event?: unknown): void {
    (this.handlers.get(type) ?? []).forEach((handler) => handler(event));
  }

  getCanvasContainer(): HTMLElement {
    return this.canvasContainer;
  }
}

class FakeMarker {
  lngLat: [number, number] | null = null;
  readonly element: HTMLElement;
  readonly anchor: string;

  constructor(options: { element: HTMLElement; anchor: string }) {
    this.element = options.element;
    this.anchor = options.anchor;
  }

  setLngLat(lngLat: [number, number]): this {
    this.lngLat = lngLat;

    return this;
  }

  addTo(map: FakeMap): this {
    map.canvasContainer.appendChild(this.element);
    env.markers.push(this);

    return this;
  }
}

class FakeBounds {
  readonly points: Array<[number, number]> = [];

  extend(point: [number, number]): this {
    this.points.push(point);

    return this;
  }
}

class FakeAttribution {
  constructor(readonly options: unknown) {}
}

const fakeModule = { Map: FakeMap, Marker: FakeMarker, LngLatBounds: FakeBounds, AttributionControl: FakeAttribution };

vi.mock('../../../../src/tools/database/maplibre-loader', () => ({
  loadMapLibre: () => env.load ?? Promise.resolve(fakeModule),
  supportsWebGL: () => env.webgl,
}));

const hover = vi.fn();

vi.mock('../../../../src/components/utils/tooltip', () => ({
  MIN_HINT_DELAY: 300,
  onHover: (...args: unknown[]): void => {
    hover(...args);
  },
}));

const { drawMapLibreMap, drawMapLibrePlace } = await import('../../../../src/tools/database/database-maplibre');

const i18n = { t: (key: string) => key };
const style = { version: 8, sources: {}, layers: [] };

const items: DatabaseMapItem[] = [
  { rowId: 'r1', title: 'Eiffel Tower', place: { name: 'Eiffel Tower', lat: 48.858, lon: 2.294 } },
  { rowId: 'r 2', title: '', place: { name: 'Statue', lat: 40.689, lon: -74.044 }, color: 'red' },
  { rowId: 'r3', title: 'Somewhere', place: { address: '1 Main St' } },
];

const context = (overrides: Partial<DatabaseMapContext> = {}): DatabaseMapContext => ({
  open: vi.fn(),
  height: 400,
  addingPin: () => false,
  onAddPin: vi.fn(),
  ...overrides,
});

const observers: Array<{ fire(width: number, height: number): void; disconnect: ReturnType<typeof vi.fn> }> = [];

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Blok\'s own map (MapLibre)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.webgl = true;
    env.maps.length = 0;
    env.markers.length = 0;
    env.load = null;
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      readonly disconnect = vi.fn();

      constructor(private readonly callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) {
        observers.push({ fire: (width, height) => this.callback([{ contentRect: { width, height } }]), disconnect: this.disconnect });
      }

      observe(): void {}

      unobserve(): void {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const draw = (ctx = context(), onFail = vi.fn()): { container: HTMLElement; handle: { destroy(): void }; onFail: ReturnType<typeof vi.fn>; ctx: DatabaseMapContext } => {
    const container = document.createElement('div');

    document.body.appendChild(container);

    return { container, handle: drawMapLibreMap(container, items, ctx, { style, i18n, breadcrumb: 'Trips', onFail }), onFail, ctx };
  };

  it('draws with the host style, wheel zoom and drag pan on, no zoom buttons, the attribution compact', async () => {
    const { container } = draw();

    await settle();
    const [map] = env.maps;

    expect(map.options.style).toBe(style);
    expect(map.options.attributionControl).toBe(false);
    expect(map.options.scrollZoom).not.toBe(false);
    expect(map.options.cooperativeGestures).not.toBe(true);
    expect(map.addControl).toHaveBeenCalledTimes(1);
    expect((map.addControl.mock.calls[0][0] as FakeAttribution).options).toEqual({ compact: true });
    expect(map.addControl.mock.calls[0][1]).toBe('bottom-right');
    expect(container.hasAttribute('data-blok-maplibre')).toBe(true);
  });

  it('names the map and its controls in the editor language', async () => {
    draw();
    await settle();

    expect(env.maps[0].options.locale).toEqual({
      'Map.Title': 'tools.database.mapLabel',
      'Marker.Title': 'tools.database.mapMarker',
      'AttributionControl.ToggleAttribution': 'tools.database.mapAttribution',
    });
  });

  it('keeps map keys and DOM churn to itself', () => {
    const { container } = draw();

    expect(container.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    expect(container.getAttribute('data-blok-mutation-free')).toBe('true');
  });

  it('a pin per placed point: a link to its row, anchored at the bottom, in its conditional color', async () => {
    draw();
    await settle();

    expect(env.markers.map((marker) => marker.lngLat)).toEqual([[2.294, 48.858], [-74.044, 40.689]]);
    expect(env.markers.every((marker) => marker.anchor === 'bottom')).toBe(true);
    const [eiffel, statue] = env.markers.map((marker) => marker.element);

    expect(eiffel.tagName).toBe('A');
    expect(eiffel.getAttribute('href')).toBe('#r1');
    expect(statue.getAttribute('href')).toBe('#r%202');
    expect(eiffel.hasAttribute('data-color')).toBe(false);
    expect(statue.getAttribute('data-color')).toBe('red');
    expect(eiffel.getAttribute('aria-label')).toBe('Eiffel Tower');
    expect(statue.getAttribute('aria-label')).toBe('tools.database.mapMarker');
  });

  it('a pin click opens its row instead of following the link, and does not reach the map', async () => {
    const { ctx } = draw();

    await settle();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    const reached = vi.fn();

    env.maps[0].canvasContainer.addEventListener('click', reached);
    env.markers[0].element.dispatchEvent(click);

    expect(ctx.open).toHaveBeenCalledWith('r1');
    expect(click.defaultPrevented).toBe(true);
    expect(reached).not.toHaveBeenCalled();
  });

  it('hovering a pin shows a page preview: the database, then the row title', async () => {
    draw();
    await settle();

    const [element, card] = hover.mock.calls[0] as [HTMLElement, HTMLElement];

    expect(element).toBe(env.markers[0].element);
    expect(card.querySelector('[data-blok-database-map-pin-card-crumb]')?.textContent).toBe('Trips');
    expect(card.querySelector('[data-blok-database-map-pin-card-title]')?.textContent).toBe('Eiffel Tower');
  });

  // research/23 §5a: Notion shows the card ≈160ms after hover. The hint law keeps 300ms as the floor.
  it('shows the pin card after the shortest hint delay', async () => {
    draw();
    await settle();

    expect(hover.mock.calls[0]?.[2]).toStrictEqual({ delay: 300 });
  });

  it('fits every pin once, at the first real size, not while hidden', async () => {
    draw();
    await settle();
    const [map] = env.maps;
    const [observer] = observers;

    observer.fire(0, 0);
    expect(map.fitBounds).not.toHaveBeenCalled();

    observer.fire(684, 400);
    observer.fire(700, 400);

    expect(map.resize).toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    expect((map.fitBounds.mock.calls[0][0] as FakeBounds).points).toEqual([[2.294, 48.858], [-74.044, 40.689]]);
    expect(map.fitBounds.mock.calls[0][1]).toMatchObject({ animate: false });
  });

  it('with no pins it keeps the style\'s own view', async () => {
    const container = document.createElement('div');

    document.body.appendChild(container);
    drawMapLibreMap(container, [], context(), { style, i18n, breadcrumb: '', onFail: vi.fn() });
    await settle();
    observers[0].fire(684, 400);

    expect(env.maps[0].fitBounds).not.toHaveBeenCalled();
  });

  it('a map click adds a pin there (the view ignores it outside add-pin mode)', async () => {
    const { ctx } = draw();

    await settle();
    env.maps[0].fire('click', { lngLat: { lng: 2.3, lat: 48.9 } });

    expect(ctx.onAddPin).toHaveBeenCalledWith({ lng: 2.3, lat: 48.9 });
  });

  it('shows a crosshair over the map while add-pin mode is on', async () => {
    const adding = { on: false };

    draw(context({ addingPin: () => adding.on }));
    await settle();
    const surface = env.maps[0].canvasContainer;

    surface.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(surface.style.cursor).toBe('');
    adding.on = true;
    surface.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(surface.style.cursor).toBe('crosshair');
  });

  it('collapses the attribution to its button once the map loads', async () => {
    draw();
    await settle();
    const attribution = document.createElement('details');

    attribution.className = 'maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show';
    env.maps[0].canvasContainer.appendChild(attribution);
    env.maps[0].fire('load');

    expect(attribution.classList.contains('maplibregl-compact-show')).toBe(false);
  });

  it('no WebGL: says so and never builds a map', async () => {
    env.webgl = false;
    const { onFail } = draw();

    await settle();

    expect(onFail).toHaveBeenCalledWith('no-webgl');
    expect(env.maps).toHaveLength(0);
  });

  it('a map that fails to start reports it instead of throwing', async () => {
    env.load = Promise.resolve({ ...fakeModule, Map: class { constructor() { throw new Error('context lost'); } } });
    const { onFail } = draw();

    await settle();

    expect(onFail).toHaveBeenCalledWith('no-webgl');
  });

  it('a style that fails to load reports it; a later tile error does not', async () => {
    const { onFail } = draw();

    await settle();
    const [map] = env.maps;

    map.fire('error', { error: new Error('404') });
    expect(onFail).toHaveBeenCalledWith('failed');
    expect(map.remove).toHaveBeenCalled();

    const second = draw();

    await settle();
    env.maps[1].fire('style.load');
    env.maps[1].fire('error', { error: new Error('tile 404') });
    expect(second.onFail).not.toHaveBeenCalled();
  });

  it('MapLibre that fails to download reports it', async () => {
    env.load = Promise.reject(new Error('chunk'));
    const { onFail } = draw();

    await settle();

    expect(onFail).toHaveBeenCalledWith('failed');
  });

  it('destroy removes the map and stops watching its size; destroyed before load, it builds nothing', async () => {
    const { handle } = draw();

    await settle();
    handle.destroy();

    expect(env.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(observers[0].disconnect).toHaveBeenCalled();

    const early = draw();

    early.handle.destroy();
    await settle();
    expect(env.maps).toHaveLength(1);
  });
});

describe('Blok\'s own Place mini-map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.webgl = true;
    env.maps.length = 0;
    env.markers.length = 0;
    env.load = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a still, zoomed-in map of the place with one pin', async () => {
    const container = document.createElement('div');

    document.body.appendChild(container);
    drawMapLibrePlace(container, { name: 'Eiffel Tower', lat: 48.858, lon: 2.294 }, { style, i18n });
    await settle();
    const [map] = env.maps;

    expect(map.options.interactive).toBe(false);
    expect(map.options.center).toEqual([2.294, 48.858]);
    expect(map.options.style).toBe(style);
    expect(env.markers.map((marker) => marker.lngLat)).toEqual([[2.294, 48.858]]);
    expect(env.markers[0].element.tagName).not.toBe('A');
    expect(container.hasAttribute('data-blok-maplibre')).toBe(true);
  });

  it('a place without a point, or no WebGL, leaves no empty map box', async () => {
    const container = document.createElement('div');

    document.body.appendChild(container);
    drawMapLibrePlace(container, { address: '1 Main St' }, { style, i18n });
    expect(container.isConnected).toBe(false);

    env.webgl = false;
    const other = document.createElement('div');

    document.body.appendChild(other);
    drawMapLibrePlace(other, { lat: 1, lon: 2 }, { style, i18n });
    await settle();
    expect(other.isConnected).toBe(false);
    expect(env.maps).toHaveLength(0);
  });

  it('destroy removes the mini-map', async () => {
    const container = document.createElement('div');

    document.body.appendChild(container);
    const handle = drawMapLibrePlace(container, { lat: 1, lon: 2 }, { style, i18n });

    await settle();
    handle.destroy();

    expect(env.maps[0].remove).toHaveBeenCalledTimes(1);
  });
});

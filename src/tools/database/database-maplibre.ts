import type { I18n } from '../../../types';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconPage } from '../../components/icons';
import { MIN_HINT_DELAY, onHover } from '../../components/utils/tooltip';
import { loadMapLibre, supportsWebGL } from './maplibre-loader';
import type { MapLibreModule } from './maplibre-loader';
import type { DatabaseMapContext, DatabaseMapItem, PlaceValue } from './types';

type MapStyle = string | Record<string, unknown>;
type LibreMap = InstanceType<MapLibreModule['Map']>;

/** Why Blok's map did not draw. The view shows a message instead. */
export type MapFailure = 'no-webgl' | 'failed';

export interface MapLibreMapOptions {
  style: MapStyle;
  i18n: Pick<I18n, 't'>;
  /** The database name, shown above the row title in a pin's hover card. */
  breadcrumb: string;
  onFail(reason: MapFailure): void;
}

export interface MapLibrePlaceOptions {
  style: MapStyle;
  i18n: Pick<I18n, 't'>;
}

/** Same as the runtime's MAPLIBRE_SCOPE: kept here so this module does not pull MapLibre in. */
const SCOPE = 'data-blok-maplibre';

/** Our choice: Notion's mini-map zoom is unmeasured (research/20 §1d: "zoomed in"). */
const PLACE_ZOOM = 14;

/** Our choice: keeps the outer pins clear of the edge and the Add pin button. */
const FIT_PADDING = 48;

/** Our choice: one pin, or pins at one spot, would otherwise zoom to the tile limit. */
const FIT_MAX_ZOOM = 14;

const pointOf = (place: PlaceValue): [number, number] | null =>
  typeof place.lat === 'number' && typeof place.lon === 'number' && Number.isFinite(place.lat) && Number.isFinite(place.lon)
    ? [place.lon, place.lat]
    : null;

const prepare = (container: HTMLElement): void => {
  container.setAttribute(SCOPE, '');
  // The map owns its keys (arrows pan, +/- zoom) and rewrites its DOM every frame.
  container.setAttribute(DATA_ATTR.keyboardOwner, '');
  container.setAttribute(DATA_ATTR.mutationFree, 'true');
};

const locale = (i18n: Pick<I18n, 't'>): Record<string, string> => ({
  'Map.Title': i18n.t('tools.database.mapLabel'),
  'Marker.Title': i18n.t('tools.database.mapMarker'),
  'AttributionControl.ToggleAttribution': i18n.t('tools.database.mapAttribution'),
});

/** Measured: a blue drop pin (research/20 §1e). The shape is CSS, colored by the row's rule. */
const pinElement = (tag: 'a' | 'span', color?: string): HTMLElement => {
  const pin = document.createElement(tag);

  pin.setAttribute('data-blok-database-map-pin', '');
  if (color !== undefined) pin.setAttribute('data-color', color);

  return pin;
};

/** Measured: page icon, "<page> / <database>" crumb, row title (research/20 §1e). */
const pinCard = (item: DatabaseMapItem, breadcrumb: string): HTMLElement => {
  const card = document.createElement('div');
  const icon = document.createElement('span');
  const text = document.createElement('div');
  const crumb = document.createElement('div');
  const title = document.createElement('div');

  card.setAttribute('data-blok-database-map-pin-card', '');
  icon.setAttribute('data-blok-database-map-pin-card-icon', '');
  icon.innerHTML = IconPage;
  crumb.setAttribute('data-blok-database-map-pin-card-crumb', '');
  crumb.textContent = breadcrumb;
  title.setAttribute('data-blok-database-map-pin-card-title', '');
  title.textContent = item.title;
  text.append(crumb, title);
  card.append(icon, text);

  return card;
};

/**
 * MapLibre's compact attribution starts open and only closes on a drag. Notion
 * shows none (research/20 §1b); the licence text stays one "ⓘ" press away.
 */
const collapseAttribution = (map: LibreMap): (() => void) => {
  const collapse = (): void => {
    const open = map.getCanvasContainer().parentElement?.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show');

    if (open === null || open === undefined) return;
    open.classList.remove('maplibregl-compact-show');
    open.setAttribute('open', '');
    map.off('load', collapse);
    map.off('resize', collapse);
  };

  map.on('load', collapse);
  map.on('resize', collapse);

  return collapse;
};

/**
 * Blok's own map (research/20 §1): the host's style, pins as links to their
 * rows, fit to all pins at first show, wheel zoom and drag pan, no zoom buttons.
 */
export const drawMapLibreMap = (
  container: HTMLElement,
  items: DatabaseMapItem[],
  ctx: DatabaseMapContext,
  options: MapLibreMapOptions
): { destroy(): void } => {
  const state: { destroyed: boolean; map: LibreMap | null; observer: ResizeObserver | null } = { destroyed: false, map: null, observer: null };
  const fail = (reason: MapFailure): void => {
    if (state.destroyed) return;
    state.observer?.disconnect();
    state.map?.remove();
    state.map = null;
    options.onFail(reason);
  };

  prepare(container);
  if (!supportsWebGL()) {
    fail('no-webgl');

    return { destroy: () => undefined };
  }
  const placed = items.flatMap((item) => {
    const point = pointOf(item.place);

    return point === null ? [] : [{ item, point }];
  });

  const start = (maplibre: MapLibreModule): void => {
    if (state.destroyed) return;
    const host = document.createElement('div');

    host.setAttribute('data-blok-database-map-gl', '');
    container.appendChild(host);
    try {
      state.map = new maplibre.Map({
        container: host,
        // A style object is the host's: MapLibre validates it and reports through 'error'.
        style: options.style as ConstructorParameters<MapLibreModule['Map']>[0]['style'],
        attributionControl: false,
        locale: locale(options.i18n),
      });
    } catch {
      fail('no-webgl');

      return;
    }
    const map = state.map;
    const styleLoaded = { done: false };
    const rtl = getComputedStyle(container).direction === 'rtl';

    map.addControl(new maplibre.AttributionControl({ compact: true }), rtl ? 'bottom-left' : 'bottom-right');
    collapseAttribution(map);
    map.on('style.load', () => {
      styleLoaded.done = true;
    });
    // Before the style loads, an error is the style itself; later ones are single tiles.
    map.on('error', () => {
      if (!styleLoaded.done) fail('failed');
    });
    map.on('click', (event: { lngLat: { lng: number; lat: number } }) => ctx.onAddPin({ lng: event.lngLat.lng, lat: event.lngLat.lat }));
    const surface = map.getCanvasContainer();

    surface.addEventListener('mousemove', () => {
      surface.style.cursor = ctx.addingPin() ? 'crosshair' : '';
    });

    placed.forEach(({ item, point }) => {
      const pin = pinElement('a', item.color);

      pin.setAttribute('href', `#${encodeURIComponent(item.rowId)}`);
      pin.setAttribute('aria-label', item.title !== '' ? item.title : options.i18n.t('tools.database.mapMarker'));
      pin.addEventListener('click', (event) => {
        event.preventDefault();
        // The map would read it as a click on the canvas (add-pin mode).
        event.stopPropagation();
        ctx.open(item.rowId);
      });
      // Notion shows after ≈160ms and hides ≈55ms after leaving (research/23 §5a); the hint-delay law makes 300ms the show floor.
      onHover(pin, pinCard(item, options.breadcrumb), { delay: MIN_HINT_DELAY, hideDelay: 55 });
      new maplibre.Marker({ element: pin, anchor: 'bottom' }).setLngLat(point).addTo(map);
    });

    // The view can render detached or in a hidden tab: fit at the first real size.
    const fitted = { done: placed.length === 0 };

    state.observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;

      if (fitted.done || box === undefined || box.width === 0 || box.height === 0) return;
      fitted.done = true;
      map.resize();
      const bounds = placed.reduce((all, { point }) => all.extend(point), new maplibre.LngLatBounds());

      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, animate: false });
    });
    state.observer.observe(container);
  };

  void loadMapLibre().then(start, () => fail('failed'));

  return {
    destroy: () => {
      state.destroyed = true;
      state.observer?.disconnect();
      state.map?.remove();
      state.map = null;
    },
  };
};

/** The Place hover card's map: still, zoomed in, one pin (research/20 §1d). */
export const drawMapLibrePlace = (container: HTMLElement, place: PlaceValue, options: MapLibrePlaceOptions): { destroy(): void } => {
  const point = pointOf(place);
  const state: { destroyed: boolean; map: LibreMap | null } = { destroyed: false, map: null };

  // No point to show, or no way to draw it: no empty box in the card.
  if (point === null || !supportsWebGL()) {
    container.remove();

    return { destroy: () => undefined };
  }
  prepare(container);
  void loadMapLibre().then((maplibre) => {
    if (state.destroyed) return;
    try {
      state.map = new maplibre.Map({
        container,
        style: options.style as ConstructorParameters<MapLibreModule['Map']>[0]['style'],
        center: point,
        zoom: PLACE_ZOOM,
        interactive: false,
        attributionControl: false,
        locale: locale(options.i18n),
      });
    } catch {
      container.remove();

      return;
    }
    state.map.addControl(new maplibre.AttributionControl({ compact: true }));
    collapseAttribution(state.map);
    new maplibre.Marker({ element: pinElement('span'), anchor: 'bottom' }).setLngLat(point).addTo(state.map);
  }, () => container.remove());

  return {
    destroy: () => {
      state.destroyed = true;
      state.map?.remove();
      state.map = null;
    },
  };
};

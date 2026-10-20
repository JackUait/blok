import type { I18n } from '../../../types';
import { IconCross, IconMap } from '../../components/icons';
import { onHover } from '../../components/utils/tooltip';
import { CellPopover } from './cells/cell-popover';
import { drawMapLibreMap } from './database-maplibre';
import type { MapFailure } from './database-maplibre';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { isPlaceValue, placeText } from './tier3-values';
import { resolveLoadLimit } from './view-settings';
import type { DatabaseMap, DatabaseMapContext, DatabaseMapItem, DatabaseMapLngLat, DatabaseRow, DatabaseViewConfig, MapHeight, PropertyDefinition } from './types';

export interface DatabaseMapViewOptions {
  i18n: Pick<I18n, 't'>;
  view: DatabaseViewConfig;
  schema: PropertyDefinition[];
  /** The view's rows, filtered and sorted. */
  rows: DatabaseRow[];
  titlePropertyId: string;
  /** The host's map (`config.map.render`). It wins over `style`. */
  render?: DatabaseMap['render'];
  /** The host's MapLibre style (`config.map.styleUrl`). Without it, or `render`, the view says a style is needed. */
  style?: DatabaseMap['styleUrl'];
  /** The database name, for Blok's pin hover card. */
  breadcrumb?: string;
  open: (rowId: string) => void;
  /** Conditional color name per row id. */
  colors?: ReadonlyMap<string, string>;
  /** Rows can be added: shows the "No place" chip and, with `addPin`, the Add pin button. */
  writable?: boolean;
  /** Adds a row at a point. Called once per add-pin click. */
  addPin?: (lngLat: DatabaseMapLngLat) => void;
}

export const MAP_HEIGHTS: readonly MapHeight[] = ['small', 'medium', 'large', 'extraLarge'];

/** Measured map canvas heights (research/20 §1f). */
export const MAP_HEIGHT_PX: Readonly<Record<MapHeight, number>> = { small: 300, medium: 400, large: 600, extraLarge: 800 };

export const resolveMapHeight = (view: DatabaseViewConfig): MapHeight =>
  MAP_HEIGHTS.find((height) => height === view.mapHeight) ?? 'medium';

/** The place property a map uses: `mapBy`, else the first place property. */
export const resolveMapBy = (view: DatabaseViewConfig, schema: PropertyDefinition[]): PropertyDefinition | undefined =>
  schema.find((p) => p.id === view.mapBy && p.type === 'place')
  ?? [...schema].sort((a, b) => (a.position < b.position ? -1 : 1)).find((p) => p.type === 'place');

/** A place the host can draw: a name or address to geocode, or a point. */
const hasPlace = (value: DatabaseRow['properties'][string] | undefined): boolean =>
  isPlaceValue(value) && (placeText(value) !== '' || (value.lat !== undefined && value.lon !== undefined));

/**
 * Notion's map view (research/20 §1). Blok draws it with MapLibre and the host's
 * style, or the host draws it with `config.map.render`. Blok geocodes nothing.
 */
export class DatabaseMapView implements DatabaseViewRenderer {
  private handle: { destroy(): void } | null = null;
  private destroyed = false;
  private addingPin = false;
  private syncAddPin: (() => void) | null = null;
  private noPlacePopover: CellPopover | null = null;
  /** The "No place" list a row page opened over, shown again when that page closes. */
  private underPage: { anchor: HTMLElement; unplaced: DatabaseRow[]; query: string } | null = null;

  constructor(private readonly options: DatabaseMapViewOptions) {}

  createView(): HTMLDivElement {
    const root = document.createElement('div');
    const placeBy = resolveMapBy(this.options.view, this.options.schema);
    const render = this.drawer();

    root.setAttribute('data-blok-database-map', '');
    if (placeBy === undefined) {
      root.appendChild(this.empty('no-place', 'tools.database.mapNoPlace'));

      return root;
    }
    if (render === undefined) {
      root.appendChild(this.empty('no-style', 'tools.database.mapNoStyle'));

      return root;
    }

    const frame = document.createElement('div');
    const canvas = document.createElement('div');
    const height = MAP_HEIGHT_PX[resolveMapHeight(this.options.view)];
    // Newest first, not the view's order (research/23 §5c).
    const unplaced = this.options.rows.filter((row) => !hasPlace(row.properties[placeBy.id]))
      .sort((a, b) => (b.meta?.createdAt ?? 0) - (a.meta?.createdAt ?? 0));

    if (this.options.writable === true && unplaced.length > 0) {
      root.appendChild(this.noPlaceChip(unplaced));
    }
    frame.setAttribute('data-blok-database-map-frame', '');
    canvas.setAttribute('data-blok-database-map-canvas', '');
    canvas.style.height = `${height}px`;
    frame.appendChild(canvas);
    if (this.options.writable === true && this.options.addPin !== undefined) {
      frame.appendChild(this.addPinButton(canvas));
    }
    root.appendChild(frame);
    const ctx: DatabaseMapContext = {
      open: (rowId) => this.options.open(rowId),
      height,
      addingPin: () => this.addingPin,
      onAddPin: (lngLat) => {
        if (!this.addingPin || this.destroyed) return;
        this.setAddingPin(false);
        this.options.addPin?.(lngLat);
      },
    };

    // The tool attaches the view right after this returns; map libraries need it attached to measure.
    queueMicrotask(() => {
      if (this.destroyed) return;
      try {
        this.handle = render(canvas, this.items(placeBy), ctx) ?? null;
      } catch {
        frame.replaceWith(this.empty('no-provider', 'tools.database.mapNoProvider'));
      }
    });

    return root;
  }

  appendRow(_container: HTMLElement, _row: DatabaseRow): void {}

  removeRow(_wrapper: HTMLElement, _rowId: string): void {}

  updateRowTitle(_wrapper: HTMLElement, _rowId: string, _title: string): void {}

  /**
   * The row page closed. A "No place" list it opened over comes back (research/23
   * §5c: it stays open under the page, so a second Escape closes it).
   */
  rowPageClosed(): void {
    const under = this.underPage;

    this.underPage = null;
    if (under === null) return;
    // After the page's own focus return, which would close the list again.
    queueMicrotask(() => {
      if (!this.destroyed && under.anchor.isConnected) this.openNoPlaceList(under.anchor, under.unplaced, under.query);
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.underPage = null;
    this.noPlacePopover?.close();
    this.noPlacePopover = null;
    this.handle?.destroy();
    this.handle = null;
  }

  /** The host's map, else Blok's own map when the host gave a style. */
  private drawer(): DatabaseMap['render'] | undefined {
    const { render, style } = this.options;

    if (render !== undefined) return render;
    if (style === undefined) return undefined;

    return (container, items, ctx) => drawMapLibreMap(container, items, ctx, {
      style,
      i18n: this.options.i18n,
      breadcrumb: this.options.breadcrumb ?? '',
      onFail: (reason) => this.fail(container, reason),
    });
  }

  private fail(canvas: HTMLElement, reason: MapFailure): void {
    const frame = canvas.closest('[data-blok-database-map-frame]');

    if (this.destroyed || frame === null) return;
    frame.replaceWith(this.empty(reason, reason === 'no-webgl' ? 'tools.database.mapNoWebgl' : 'tools.database.mapLoadFailed'));
  }

  private items(placeBy: PropertyDefinition): DatabaseMapItem[] {
    return this.options.rows.flatMap((row) => {
      const place = row.properties[placeBy.id];

      if (!isPlaceValue(place) || !hasPlace(place)) return [];
      const title = row.properties[this.options.titlePropertyId];
      const color = this.options.colors?.get(row.id);

      return [{ rowId: row.id, title: typeof title === 'string' ? title : '', place, ...(color !== undefined ? { color } : {}) }];
    // Our choice: the load limit caps the pins. Notion's cap is unmeasured (research/20, UNMEASURED).
    }).slice(0, resolveLoadLimit(this.options.view));
  }

  private setAddingPin(on: boolean): void {
    this.addingPin = on;
    this.syncAddPin?.();
  }

  /** Top-right of the map (research/20 §1b, §1e). */
  private addPinButton(canvas: HTMLElement): HTMLButtonElement {
    const button = document.createElement('button');
    const t = (key: string): string => this.options.i18n.t(key);

    button.type = 'button';
    button.setAttribute('data-blok-database-map-add-pin', '');
    this.syncAddPin = () => {
      button.innerHTML = this.addingPin ? IconCross : IconMap;
      button.setAttribute('aria-label', this.addingPin ? t('tools.database.mapCancelAddPin') : t('tools.database.mapEnableAddPin'));
      button.toggleAttribute('data-active', this.addingPin);
      canvas.toggleAttribute('data-blok-database-map-adding-pin', this.addingPin);
      onHover(button, this.addingPin ? t('tools.database.mapCancelAddPin') : t('tools.database.mapAddPin'));
    };
    this.syncAddPin();
    button.addEventListener('click', () => this.setAddingPin(!this.addingPin));

    return button;
  }

  /** Measured: a grey chip, a 320-wide list with "Search for a page..." (research/20 §1e). */
  private noPlaceChip(unplaced: DatabaseRow[]): HTMLButtonElement {
    const chip = document.createElement('button');

    chip.type = 'button';
    chip.setAttribute('data-blok-database-map-no-place', '');
    chip.setAttribute('aria-haspopup', 'dialog');
    chip.textContent = this.options.i18n.t('tools.database.mapNoPlaceCount', { count: unplaced.length });
    chip.addEventListener('click', () => this.openNoPlaceList(chip, unplaced));

    return chip;
  }

  private openNoPlaceList(anchor: HTMLElement, unplaced: DatabaseRow[], query = ''): void {
    this.noPlacePopover?.close();
    this.underPage = null;
    const content = document.createElement('div');
    const search = document.createElement('input');
    const list = document.createElement('div');
    const placeholder = this.options.i18n.t('tools.database.relationSearchPlaceholder');
    const titleOf = (row: DatabaseRow): string => {
      const title = row.properties[this.options.titlePropertyId];

      return typeof title === 'string' ? title : '';
    };
    const popover = new CellPopover({
      anchor,
      content,
      minWidth: '320px',
      onEscape: () => {
        popover.close();
        this.noPlacePopover = null;
        anchor.focus();
      },
      onDismiss: () => {
        this.noPlacePopover = null;
      },
    });
    const fill = (): void => {
      const query = search.value.trim().toLocaleLowerCase();

      list.replaceChildren(...unplaced.filter((row) => titleOf(row).toLocaleLowerCase().includes(query)).map((row) => {
        const item = document.createElement('button');

        item.type = 'button';
        item.setAttribute('data-blok-database-map-no-place-row', '');
        item.textContent = titleOf(row);
        item.addEventListener('click', () => {
          // A top-layer popover would draw over the page, so it waits under it closed.
          popover.close();
          this.noPlacePopover = null;
          this.options.open(row.id);
          this.underPage = { anchor, unplaced, query: search.value };
        });

        return item;
      }));
    };

    content.setAttribute('data-blok-database-map-no-place-list', '');
    search.type = 'text';
    search.placeholder = placeholder;
    search.setAttribute('aria-label', placeholder);
    search.setAttribute('data-blok-database-map-no-place-search', '');
    search.value = query;
    search.addEventListener('input', fill);
    content.append(search, list);
    fill();
    this.noPlacePopover = popover;
    popover.show();
    search.focus();
  }

  private empty(reason: 'no-place' | 'no-provider' | 'no-style' | MapFailure, key: string): HTMLElement {
    const empty = document.createElement('p');

    empty.setAttribute('data-blok-database-map-empty', reason);
    empty.textContent = this.options.i18n.t(key);

    return empty;
  }
}

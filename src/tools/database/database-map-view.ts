import type { I18n } from '../../../types';
import type { DatabaseViewRenderer } from './database-view-renderer';
import { isPlaceValue, placeText } from './tier3-values';
import type { DatabaseMap, DatabaseMapItem, DatabaseRow, DatabaseViewConfig, PropertyDefinition } from './types';

export interface DatabaseMapViewOptions {
  i18n: Pick<I18n, 't'>;
  view: DatabaseViewConfig;
  schema: PropertyDefinition[];
  /** The view's rows, filtered and sorted. */
  rows: DatabaseRow[];
  titlePropertyId: string;
  /** The host's map (`config.map.render`). Without it the view shows an empty state. */
  render?: DatabaseMap['render'];
  open: (rowId: string) => void;
}

/** Notion shows up to 100 items on a map at once (research/03 §10). */
const MAX_ITEMS = 100;

/** The place property a map uses: `mapBy`, else the first place property. */
export const resolveMapBy = (view: DatabaseViewConfig, schema: PropertyDefinition[]): PropertyDefinition | undefined =>
  schema.find((p) => p.id === view.mapBy && p.type === 'place')
  ?? [...schema].sort((a, b) => (a.position < b.position ? -1 : 1)).find((p) => p.type === 'place');

/**
 * Notion's map view. Blok draws no map and geocodes nothing: the host's
 * `config.map.render` draws the pins.
 */
export class DatabaseMapView implements DatabaseViewRenderer {
  private handle: { destroy(): void } | null = null;
  private destroyed = false;

  constructor(private readonly options: DatabaseMapViewOptions) {}

  createView(): HTMLDivElement {
    const root = document.createElement('div');
    const placeBy = resolveMapBy(this.options.view, this.options.schema);
    const render = this.options.render;

    root.setAttribute('data-blok-database-map', '');
    if (placeBy === undefined) {
      root.appendChild(this.empty('no-place', 'tools.database.mapNoPlace'));

      return root;
    }
    if (render === undefined) {
      root.appendChild(this.empty('no-provider', 'tools.database.mapNoProvider'));

      return root;
    }

    const canvas = document.createElement('div');

    canvas.setAttribute('data-blok-database-map-canvas', '');
    root.appendChild(canvas);
    // The tool attaches the view right after this returns; map libraries need it attached to measure.
    queueMicrotask(() => {
      if (this.destroyed) return;
      try {
        this.handle = render(canvas, this.items(placeBy), { open: (rowId) => this.options.open(rowId) }) ?? null;
      } catch {
        canvas.replaceWith(this.empty('no-provider', 'tools.database.mapNoProvider'));
      }
    });

    return root;
  }

  appendRow(_container: HTMLElement, _row: DatabaseRow): void {}

  removeRow(_wrapper: HTMLElement, _rowId: string): void {}

  updateRowTitle(_wrapper: HTMLElement, _rowId: string, _title: string): void {}

  destroy(): void {
    this.destroyed = true;
    this.handle?.destroy();
    this.handle = null;
  }

  private items(placeBy: PropertyDefinition): DatabaseMapItem[] {
    return this.options.rows.flatMap((row) => {
      const place = row.properties[placeBy.id];

      if (!isPlaceValue(place) || (placeText(place) === '' && (place.lat === undefined || place.lon === undefined))) return [];
      const title = row.properties[this.options.titlePropertyId];

      return [{ rowId: row.id, title: typeof title === 'string' ? title : '', place }];
    }).slice(0, MAX_ITEMS);
  }

  private empty(reason: 'no-place' | 'no-provider', key: string): HTMLElement {
    const empty = document.createElement('p');

    empty.setAttribute('data-blok-database-map-empty', reason);
    empty.textContent = this.options.i18n.t(key);

    return empty;
  }
}

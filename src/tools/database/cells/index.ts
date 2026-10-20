import type { PlaceValue, PropertyDefinition, PropertyValue } from '../types';
import { openDateEditor } from './date-editor';
import { openFilesEditor } from './files-editor';
import { openPersonEditor } from './person-editor';
import { openRelationEditor } from './relation-editor';
import { openSelectEditor } from './select-editor';
import { openTextEditor } from './text-editor';
import type { CellEditorContext, CellEditorHandle } from './types';
import { isPlaceValue, verificationStatus } from '../tier3-values';
import { safeHref } from '../../../components/utils/sanitize-url';
import { IconCross } from '../../../components/icons';

export { renderCellValue, createOptionPill } from './display';
export type { CellContext, CellEditorCallbacks, CellEditorContext, CellEditorHandle, CellRenderer } from './types';
export { DATE_VALUE_FORMAT, formatDateValue, parseDateValue } from './date-value';
export type { ParsedDateValue } from './date-value';
export { OPTION_COLORS, optionColorOf, pickOptionColor } from './option-colors';
export type { OptionColor } from './option-colors';

/** Measured: a plain link to a Google Maps search for "<name>,<address>" (research/20 §1c). */
const googleMapsLink = (value: PropertyValue | undefined, ctx: CellEditorContext): HTMLElement | undefined => {
  if (!isPlaceValue(value)) return undefined;
  const parts = [value.name, value.address].filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  const point = value.lat !== undefined && value.lon !== undefined ? `${value.lat},${value.lon}` : '';
  const query = parts.length > 0 ? parts.join(',') : point;
  const href = query === '' ? null : safeHref(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);

  if (href === null) return undefined;
  const link = document.createElement('a');

  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = ctx.i18n.t('tools.database.placeOpenInGoogleMaps');
  link.setAttribute('data-blok-database-place-google-maps', '');

  return link;
};

/** Our choice: Notion searches on every keystroke (research/20 §1c); a pause spares the host's geocoder. */
const SEARCH_DELAY = 250;

/** Keeps only what a place stores: a host result may carry its own fields. */
const cleanPlace = (value: unknown): PlaceValue | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (field: unknown): string | undefined => (typeof field === 'string' && field.trim() !== '' ? field.trim() : undefined);
  const number = (field: unknown): number | undefined => (typeof field === 'number' && Number.isFinite(field) ? field : undefined);
  const name = text(raw.name);
  const address = text(raw.address);
  const lat = number(raw.lat);
  const lon = number(raw.lon);
  const point = lat !== undefined && lon !== undefined ? { lat, lon } : {};

  if (name === undefined && address === undefined && lat === undefined) return null;

  return { ...(name !== undefined ? { name } : {}), ...(address !== undefined ? { address } : {}), ...point };
};

/**
 * "Current Location" first, then "Loading..." or the host's results, each its
 * name over its address (research/20 §1d). Without the host hooks: nothing.
 */
const placeSearch = (ctx: CellEditorContext, pick: (place: PlaceValue) => void): { list: HTMLElement; attach(field: HTMLInputElement | HTMLTextAreaElement, isOpen: () => boolean): void } | undefined => {
  const { geocode, currentLocation } = ctx;

  if (geocode === undefined && currentLocation === undefined) return undefined;
  const list = document.createElement('div');
  const found = document.createElement('div');
  const t = (key: string): string => ctx.i18n.t(key);

  list.setAttribute('data-blok-database-place-results', '');
  if (currentLocation !== undefined) {
    const current = document.createElement('button');

    current.type = 'button';
    current.setAttribute('data-blok-database-place-current', '');
    current.textContent = t('tools.database.placeCurrentLocation');
    current.addEventListener('click', () => {
      void Promise.resolve().then(() => currentLocation()).then((place) => {
        const clean = cleanPlace(place);

        if (clean !== null) pick(clean);
      }, () => undefined);
    });
    list.appendChild(current);
  }
  list.appendChild(found);

  return {
    list,
    attach: (field, isOpen) => {
      if (geocode === undefined) return;
      const search = { timer: 0, latest: 0 };
      const show = (places: PlaceValue[]): void => {
        found.replaceChildren(...places.map((place) => {
          const row = document.createElement('button');
          const name = document.createElement('span');
          const address = document.createElement('span');

          row.type = 'button';
          row.setAttribute('data-blok-database-place-result', '');
          name.setAttribute('data-blok-database-place-result-name', '');
          name.textContent = place.name ?? place.address ?? '';
          address.setAttribute('data-blok-database-place-result-address', '');
          address.textContent = place.name === undefined ? '' : place.address ?? '';
          row.append(name, address);
          row.addEventListener('click', () => pick(place));

          return row;
        }));
      };
      const run = (query: string, id: number): void => {
        const loading = document.createElement('div');

        loading.setAttribute('data-blok-database-place-loading', '');
        loading.textContent = t('tools.database.placeSearching');
        found.replaceChildren(loading);
        void Promise.resolve().then(() => geocode(query)).then((places) => (Array.isArray(places) ? places : []), () => []).then((places) => {
          if (id !== search.latest || !isOpen()) return;
          show(places.map(cleanPlace).filter((place): place is PlaceValue => place !== null && (place.name !== undefined || place.address !== undefined)));
        });
      };

      field.setAttribute('placeholder', t('tools.database.placeSearch'));
      field.addEventListener('input', () => {
        const query = field.value.trim();

        window.clearTimeout(search.timer);
        search.latest += 1;
        if (query === '') {
          found.replaceChildren();

          return;
        }
        const id = search.latest;

        search.timer = window.setTimeout(() => run(query, id), SEARCH_DELAY);
      });
    },
  };
};

/**
 * The field holds the stored address; a stored name shows as a chip with ×
 * (research/20 §1d). Text equal to the stored address writes nothing, so a
 * name and a point the user never touched stay. Other text is a new place:
 * the old name and point no longer match it, and Blok cannot geocode it.
 */
const openPlaceEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle => {
  const place = isPlaceValue(value) ? value : undefined;
  const address = place?.address ?? '';
  const name = place?.name?.trim() ?? '';
  const state: { cleared: boolean; picked: PlaceValue | null } = { cleared: false, picked: null };
  const header = name === '' ? undefined : document.createElement('div');
  const search = placeSearch(ctx, (picked) => {
    state.picked = picked;
    handle.close();
  });
  const link = googleMapsLink(value, ctx);
  const footer = search === undefined ? link : document.createElement('div');

  if (search !== undefined && footer !== undefined) footer.append(...[search.list, link].filter((part): part is HTMLElement => part !== undefined));
  // Escape on a place is unmeasured: it cancels, unlike a text.
  const handle = openTextEditor({ ...property, type: 'text' }, address, anchor, {
    ...ctx,
    onCommit: (text) => {
      const typed = typeof text === 'string' ? text.trim() : '';

      if (state.picked !== null) ctx.onCommit(state.picked);
      else if (state.cleared) ctx.onCommit(null);
      else if (typed === address.trim()) ctx.onCancel?.();
      else ctx.onCommit(typed === '' ? null : { address: typed });
    },
    // The × and a picked result leave the text as it was, so the text editor sees no change.
    onCancel: () => {
      if (state.picked !== null) ctx.onCommit(state.picked);
      else if (state.cleared) ctx.onCommit(null);
      else ctx.onCancel?.();
    },
  }, footer, header, true);
  const field = footer?.parentElement?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input]');

  if (search !== undefined && field !== null && field !== undefined) search.attach(field, () => handle.isOpen);

  if (header !== undefined) {
    const chip = document.createElement('span');
    const label = document.createElement('span');
    const clear = document.createElement('button');

    header.setAttribute('data-blok-database-place-head', '');
    chip.setAttribute('data-blok-database-option-pill', '');
    chip.setAttribute('data-blok-database-place-chip', '');
    label.setAttribute('data-blok-database-place-name', '');
    label.textContent = name;
    chip.appendChild(label);
    clear.type = 'button';
    clear.tabIndex = -1;
    clear.setAttribute('data-blok-database-place-clear', '');
    clear.setAttribute('aria-label', ctx.i18n.t('tools.database.placeClear'));
    clear.innerHTML = IconCross;
    clear.addEventListener('click', () => {
      state.cleared = true;
      handle.close();
    });
    chip.appendChild(clear);
    header.appendChild(chip);
  }

  return handle;
};

const CLOSED: CellEditorHandle = { isOpen: false, close: () => undefined, cancel: () => undefined };

/**
 * Opens the editor for one cell under `anchor`. Read-only does nothing.
 * Checkbox has no editor: it commits the flipped value at once.
 */
export const openCellEditor = (
  property: PropertyDefinition,
  value: PropertyValue | undefined,
  anchor: HTMLElement,
  ctx: CellEditorContext
): CellEditorHandle => {
  if (ctx.readOnly) {
    return CLOSED;
  }

  switch (property.type) {
    case 'checkbox':
      ctx.onCommit(value !== true);
      ctx.onClose?.();

      return CLOSED;
    case 'select':
    case 'multiSelect':
    case 'status':
      return openSelectEditor(property, value, anchor, ctx);
    case 'date':
      return openDateEditor(property, value, anchor, ctx);
    case 'title':
    case 'text':
    case 'number':
    case 'url':
    case 'richText':
    case 'email':
    case 'phone':
      return openTextEditor(property, value, anchor, ctx);
    case 'person':
      return openPersonEditor(property, value, anchor, ctx) ?? CLOSED;
    case 'files':
      return openFilesEditor(property, value, anchor, ctx);
    case 'relation':
      return openRelationEditor(property, value, anchor, ctx);
    case 'place':
      return openPlaceEditor(property, value, anchor, ctx);
    case 'verification':
      // Expired verifies again, as Notion's "Verify" does.
      ctx.onCommit(verificationStatus(value) === 'verified'
        ? { state: 'unverified' }
        : { state: 'verified', ...(ctx.me !== undefined ? { verifiedBy: ctx.me } : {}) });
      ctx.onClose?.();

      return CLOSED;
    case 'createdTime':
    case 'lastEditedTime':
    case 'createdBy':
    case 'lastEditedBy':
    case 'uniqueId':
    case 'formula':
    case 'rollup':
    case 'button':
      return CLOSED;
    default:
      // A type from a newer client has no editor.
      return CLOSED;
  }
};

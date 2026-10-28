import { IconGlobe, IconSearch } from '../../components/icons';
import { syncPortalDirection } from '../../components/utils/portal-direction';
import { overlayMountFor } from '../../components/utils/top-layer';
import { markEscapeConsumed } from '../../components/utils/consumed-escape';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import type { I18n } from '../../../types';
import type { PropertyType } from './types';
import { addablePropertyTypes, headerPickerTypes, propertyTypeMeta } from './database-property-types';
import {
  createPositionTracker,
  positionFixedAnchored,
  type PositionTracker,
} from '../../components/utils/popover/anchored-position';

/** Top margin; it matches the CSS max-height margin. Notion's is unmeasured. */
const VIEWPORT_MARGIN = 12;
/** The type row the arrows are on. */
const OPTION_ACTIVE = 'data-blok-database-property-type-option-active';
/** notion-spec-2 §18.5 measured these two. */
const VIEWPORT_BOTTOM_MARGIN = 11;
const ABOVE_GAP = 1;
/** Notion's gap below the button is unmeasured. */
const BELOW_GAP = 4;
/** Past the 200ms close motion. */
const CLOSE_FALLBACK_MS = 300;

export interface PropertyTypePopoverOptions {
  /** `name` is the name field's text, '' without the field. */
  onSelect: (type: PropertyType, name: string) => void;
  i18n?: I18n;
  /** Offer Person: the host gave a people directory. */
  hasPeople?: boolean;
  /** Show Notion's "Property name" field above the types. */
  withNameField?: boolean;
  /** The host has AI Autofill: Summarize and Translate head the list. `name` as in onSelect. */
  onAutofill?: (mode: 'summary' | 'translate', name: string) => void;
  /**
   * 'grid': the table header "+" picker, 400 wide with two columns under "Select type" (research/08, research/12 §1).
   * 'list' (default): the row page's one column under "Type" (notion-spec-2 §18.5).
   */
  layout?: 'list' | 'grid';
}

export class DatabasePropertyTypePopover {
  private readonly onSelect: (type: PropertyType, name: string) => void;
  private readonly i18n: I18n | undefined;
  private readonly hasPeople: boolean;
  private readonly withNameField: boolean;
  private readonly onAutofill: PropertyTypePopoverOptions['onAutofill'];
  private readonly grid: boolean;
  private popoverEl: HTMLElement | null = null;
  private boundOutsideClick: ((e: MouseEvent) => void) | null = null;
  private positionTracker: PositionTracker | null = null;
  /** Removes a menu still playing its close motion. */
  private fading: (() => void) | null = null;

  constructor(options: PropertyTypePopoverOptions) {
    this.onSelect = options.onSelect;
    this.i18n = options.i18n;
    this.hasPeople = options.hasPeople === true;
    this.withNameField = options.withNameField === true;
    this.onAutofill = options.onAutofill;
    this.grid = options.layout === 'grid';
  }

  get isOpen(): boolean {
    return this.popoverEl !== null;
  }

  open(anchor: HTMLElement): void {
    this.close();
    this.fading?.();

    const popover = document.createElement('div');
    popover.setAttribute('data-blok-popover', '');
    popover.setAttribute('data-blok-popover-opened', '');
    popover.setAttribute('data-blok-database-property-type-popover', '');
    if (this.grid) popover.setAttribute('data-blok-database-property-type-layout', 'grid');
    popover.style.zIndex = '1000';
    // Blok's editor keydown would blur the field on Escape instead of closing the menu.
    popover.setAttribute(DATA_ATTR.keyboardOwner, '');
    // One Escape closes the menu only; the mark keeps the peek under it open.
    popover.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      markEscapeConsumed(e);
      this.close(true);
      anchor.focus({ preventScroll: true });
    });

    const nameField = this.withNameField ? document.createElement('input') : null;

    if (nameField !== null) {
      const header = document.createElement('div');

      header.setAttribute('data-blok-database-property-type-header', '');
      const glyph = document.createElement('div');

      // A new property starts as Text.
      glyph.setAttribute('data-blok-database-property-type-glyph', '');
      glyph.innerHTML = propertyTypeMeta('text').icon;
      header.appendChild(glyph);
      nameField.type = 'text';
      nameField.setAttribute('data-blok-database-property-name-input', '');
      nameField.setAttribute('data-blok-field', 'text');
      // research/14 §1: the header "+" field reads "Type property name…".
      const placeholderKey = this.grid ? 'tools.database.propertyNamePlaceholder' : 'tools.database.propertyName';

      nameField.placeholder = this.i18n?.t(placeholderKey) ?? placeholderKey;
      nameField.setAttribute('aria-label', this.i18n?.t('tools.database.propertyName') ?? 'tools.database.propertyName');
      header.appendChild(nameField);
      popover.appendChild(header);
    }

    // The name field stays put; only the types scroll (feel/findings-table T12).
    const body = document.createElement('div');
    const grid = document.createElement('div');

    body.setAttribute('data-blok-database-property-type-body', '');
    grid.setAttribute('data-blok-database-property-type-grid', '');

    const heading = this.typeListHeading(grid);
    const onAutofill = this.onAutofill;

    if (onAutofill !== undefined) {
      body.appendChild(this.autofillSection((mode) => {
        onAutofill(mode, nameField?.value.trim() ?? '');
        this.close();
      }));
    }
    body.append(heading, grid);
    popover.appendChild(body);

    for (const type of this.grid ? headerPickerTypes(this.hasPeople) : addablePropertyTypes(this.hasPeople)) {
      const meta = propertyTypeMeta(type);
      const item = document.createElement('div');
      item.setAttribute('data-blok-database-property-type-option', type);

      const iconEl = document.createElement('div');
      iconEl.setAttribute('data-blok-database-property-type-option-icon', '');
      iconEl.innerHTML = meta.icon;
      item.appendChild(iconEl);

      const label = document.createElement('span');
      label.textContent = this.i18n?.t(meta.labelKey) ?? meta.labelKey;
      item.appendChild(label);

      item.addEventListener('click', () => {
        this.onSelect(type, nameField?.value.trim() ?? '');
        this.close();
      });

      grid.appendChild(item);
    }

    popover.addEventListener('keydown', (e) => this.onKey(e, body, nameField));

    // Inside a top-layer panel (a peek, the layout builder): on body the panel covers the menu, and a modal's focus trap takes the name field.
    overlayMountFor(anchor).appendChild(popover);
    // The side is picked once: a search shrinks the menu and it keeps its bottom (notion-spec-2 §18.5).
    const picked: { side?: 'below' | 'above' | 'cover' } = {};
    const reposition = (): void => {
      positionFixedAnchored(popover, anchor, { side: 'bottom', offset: BELOW_GAP });
      // notion-spec-2 §18.5: above, the bottom sits 1px over the button; fitting neither side, it covers the button, bottom pinned 11px up.
      const { top, bottom } = anchor.getBoundingClientRect();
      const height = popover.offsetHeight;
      const bottomLimit = window.innerHeight - VIEWPORT_BOTTOM_MARGIN;
      const fitsAbove = top - ABOVE_GAP - height >= VIEWPORT_MARGIN;

      const away = fitsAbove ? 'above' : 'cover';

      picked.side ??= bottom + BELOW_GAP + height <= bottomLimit ? 'below' : away;
      const below = picked.side === 'below';
      const above = picked.side === 'above';
      const covering = Math.max(VIEWPORT_MARGIN, bottomLimit - height);
      const awayTop = above ? top - ABOVE_GAP - height : covering;

      popover.style.top = `${below ? bottom + BELOW_GAP : awayTop}px`;
      popover.setAttribute('data-side', above ? 'top' : 'bottom');
    };

    // The anchor mirrors with the editor, so a flip re-places the menu.
    syncPortalDirection(popover, { source: anchor, onResync: reposition });
    this.popoverEl = popover;

    reposition();
    // The drawer slides in with a transform, carrying the anchor along.
    this.positionTracker = createPositionTracker(popover, reposition, anchor);
    this.positionTracker.attach();

    this.boundOutsideClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!popover.contains(target) && !anchor.contains(target)) {
        // Notion's fade is measured on Escape only (notion-spec-2 §19.22).
        this.close(true);
      }
    };

    document.addEventListener('mousedown', this.boundOutsideClick);
    nameField?.focus();
  }

  /**
   * notion-spec-2 §18.5, §19.8: arrows walk the menu from its top (AI Autofill rows, then the shown types) and Enter takes the highlighted row at once.
   * With none highlighted, a typed name then Enter makes a Text property; on an empty name it is unmeasured, so it does nothing.
   */
  private onKey(e: KeyboardEvent, body: HTMLElement, nameField: HTMLInputElement | null): void {
    if (e.isComposing) return;
    const shown = [...body.querySelectorAll<HTMLElement>('[data-blok-database-property-autofill-option], [data-blok-database-property-type-option]')].filter((option) => !option.hidden);
    const current = shown.findIndex((option) => option.hasAttribute(OPTION_ACTIVE));
    const name = nameField?.value.trim() ?? '';

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      shown[current]?.removeAttribute(OPTION_ACTIVE);
      const next = shown[e.key === 'ArrowDown' ? Math.min(current + 1, shown.length - 1) : Math.max(current - 1, 0)];

      next?.setAttribute(OPTION_ACTIVE, '');
      next?.scrollIntoView({ block: 'nearest' });

      return;
    }
    if (e.key !== 'Enter') return;
    const highlighted = shown[current];

    // Notion's Enter on a highlighted AI row is unmeasured; it takes the row as a click does.
    if (highlighted?.hasAttribute('data-blok-database-property-autofill-option')) {
      e.preventDefault();
      highlighted.click();

      return;
    }
    const type = highlighted?.getAttribute('data-blok-database-property-type-option') as PropertyType | undefined;

    if (type === undefined && (e.target !== nameField || name === '')) return;
    e.preventDefault();
    this.onSelect(type ?? 'text', name);
    this.close();
  }

  private typeListHeading(grid: HTMLElement): HTMLElement {
    // notion-spec-2 §17.9: the grid's magnifier turns "Select type" into the field; the list adds it under "Type".
    const t = (key: string): string => {
      const shown = this.grid && key === 'tools.database.propertyTypeListHeading' ? 'tools.database.formSelectType' : key;

      return this.i18n?.t(shown) ?? shown;
    };

    const heading = typeSearchHeading(t, (query) => {
      for (const option of grid.querySelectorAll<HTMLElement>('[data-blok-database-property-type-option]')) {
        option.hidden = !(option.textContent ?? '').toLowerCase().includes(query);
        option.removeAttribute(OPTION_ACTIVE);
      }
    }, !this.grid);

    // notion-spec-2 §19.8: opening "Search types" drops the highlight, so the next ArrowDown starts at the menu's top.
    heading.querySelector('[data-blok-database-property-type-search]')?.addEventListener('click', () => {
      heading.closest('[data-blok-database-property-type-popover]')?.querySelectorAll(`[${OPTION_ACTIVE}]`).forEach((row) => row.removeAttribute(OPTION_ACTIVE));
    });

    return heading;
  }

  /** Notion's "AI Autofill" rows: a glyph, the preset's name and a gray "Basic" tag. */
  private autofillSection(pick: (mode: 'summary' | 'translate') => void): HTMLElement {
    const t = (key: string): string => this.i18n?.t(key) ?? key;
    const section = document.createElement('div');
    const heading = document.createElement('div');

    heading.setAttribute('data-blok-database-property-type-heading', '');
    heading.textContent = t('tools.database.aiAutofill');
    section.appendChild(heading);
    const presets = [
      // Notion draws Summarize with the same lines as Text.
      { mode: 'summary', icon: propertyTypeMeta('text').icon, labelKey: 'tools.database.aiAutofillSummarize' },
      { mode: 'translate', icon: IconGlobe, labelKey: 'tools.database.aiAutofillTranslate' },
    ] as const;

    for (const preset of presets) {
      const item = document.createElement('div');
      const iconEl = document.createElement('div');
      const label = document.createElement('span');
      const tag = document.createElement('span');

      item.setAttribute('data-blok-database-property-autofill-option', preset.mode);
      iconEl.setAttribute('data-blok-database-property-type-option-icon', '');
      iconEl.innerHTML = preset.icon;
      label.textContent = t(preset.labelKey);
      tag.setAttribute('data-blok-database-property-autofill-tag', '');
      tag.textContent = t('tools.database.aiAutofillBasic');
      item.append(iconEl, label, tag);
      item.addEventListener('click', () => pick(preset.mode));
      section.appendChild(item);
    }

    return section;
  }

  /**
   * `animate`: notion-spec-2 §19.22, the open plays in reverse before the menu leaves.
   * A pick removes it at once: the property's own panel takes its place.
   */
  close(animate = false): void {
    const popover = this.popoverEl;

    this.popoverEl = null;
    this.positionTracker?.detach();
    this.positionTracker = null;
    if (this.boundOutsideClick !== null) {
      document.removeEventListener('mousedown', this.boundOutsideClick);
      this.boundOutsideClick = null;
    }
    if (popover === null) return;
    if (!animate) {
      popover.remove();

      return;
    }
    // Closed for every purpose but paint: no keys, clicks or focus while it fades.
    popover.removeAttribute('data-blok-popover-opened');
    popover.setAttribute('data-blok-closing', '');
    popover.setAttribute('inert', '');
    if (document.activeElement instanceof HTMLElement && popover.contains(document.activeElement)) document.activeElement.blur();
    // No running animation (jsdom, reduced motion): nothing to wait for.
    const animations = popover.getAnimations?.() ?? [];

    if (animations.length === 0) {
      popover.remove();

      return;
    }
    const remove = (): void => {
      window.clearTimeout(timer);
      popover.remove();
      if (this.fading === remove) this.fading = null;
    };
    // A cancelled animation never settles.
    const timer = window.setTimeout(remove, CLOSE_FALLBACK_MS);

    this.fading = remove;
    void Promise.all(animations.map((animation) => animation.finished)).then(remove, remove);
  }

  destroy(): void {
    this.close();
    this.fading?.();
  }
}

/**
 * Notion's "Type 🔍": the magnifier turns the heading into a field, or with `below`
 * adds the field under the heading (notion-spec-2 §18.5). `filter` gets
 * its text, trimmed and lower case, on each change.
 */
export const typeSearchHeading = (t: (key: string) => string, filter: (query: string) => void, below = false): HTMLElement => {
  const heading = document.createElement('div');
  const label = document.createElement('span');
  const search = document.createElement('button');

  heading.setAttribute('data-blok-database-property-type-heading', '');
  heading.setAttribute('data-blok-database-property-type-list-heading', '');
  label.textContent = t('tools.database.propertyTypeListHeading');
  search.type = 'button';
  search.setAttribute('data-blok-database-property-type-search', '');
  search.setAttribute('aria-label', t('tools.database.csvSearchTypes'));
  search.innerHTML = IconSearch;
  heading.append(label, search);
  search.addEventListener('click', () => {
    const open = heading.nextElementSibling;

    if (open instanceof HTMLInputElement && open.hasAttribute('data-blok-database-property-type-search-input')) {
      open.focus();

      return;
    }
    const field = document.createElement('input');

    field.type = 'text';
    field.setAttribute('data-blok-database-property-type-search-input', '');
    field.setAttribute('data-blok-field', 'text');
    field.setAttribute('aria-label', t('tools.database.csvSearchTypes'));
    field.placeholder = t('tools.database.csvSearchTypes');
    field.addEventListener('input', () => filter(field.value.trim().toLowerCase()));
    if (below) heading.after(field);
    else heading.replaceChildren(field);
    field.focus();
  });

  return heading;
};

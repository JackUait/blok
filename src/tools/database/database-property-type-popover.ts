import { IconGlobe, IconSearch } from '../../components/icons';
import { syncPortalDirection } from '../../components/utils/portal-direction';
import { overlayMountFor } from '../../components/utils/top-layer';
import { markEscapeConsumed } from '../../components/utils/consumed-escape';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import type { I18n } from '../../../types';
import type { PropertyType } from './types';
import { addablePropertyTypes, propertyTypeMeta } from './database-property-types';
import {
  createPositionTracker,
  positionFixedAnchored,
  type PositionTracker,
} from '../../components/utils/popover/anchored-position';

/** Top margin; it matches the CSS max-height margin. Notion's is unmeasured. */
const VIEWPORT_MARGIN = 12;
/** notion-spec-2 §18.5 measured these two. */
const VIEWPORT_BOTTOM_MARGIN = 11;
const ABOVE_GAP = 1;
/** Notion's gap below the button is unmeasured. */
const BELOW_GAP = 4;

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
}

export class DatabasePropertyTypePopover {
  private readonly onSelect: (type: PropertyType, name: string) => void;
  private readonly i18n: I18n | undefined;
  private readonly hasPeople: boolean;
  private readonly withNameField: boolean;
  private readonly onAutofill: PropertyTypePopoverOptions['onAutofill'];
  private popoverEl: HTMLElement | null = null;
  private boundOutsideClick: ((e: MouseEvent) => void) | null = null;
  private positionTracker: PositionTracker | null = null;

  constructor(options: PropertyTypePopoverOptions) {
    this.onSelect = options.onSelect;
    this.i18n = options.i18n;
    this.hasPeople = options.hasPeople === true;
    this.withNameField = options.withNameField === true;
    this.onAutofill = options.onAutofill;
  }

  get isOpen(): boolean {
    return this.popoverEl !== null;
  }

  open(anchor: HTMLElement): void {
    this.close();

    const popover = document.createElement('div');
    popover.setAttribute('data-blok-popover', '');
    popover.setAttribute('data-blok-popover-opened', '');
    popover.setAttribute('data-blok-database-property-type-popover', '');
    popover.style.zIndex = '1000';
    // Blok's editor keydown would blur the field on Escape instead of closing the menu.
    popover.setAttribute(DATA_ATTR.keyboardOwner, '');
    // One Escape closes the menu only; the mark keeps the peek under it open.
    popover.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      markEscapeConsumed(e);
      this.close();
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
      nameField.placeholder = this.i18n?.t('tools.database.propertyName') ?? 'tools.database.propertyName';
      nameField.setAttribute('aria-label', this.i18n?.t('tools.database.propertyName') ?? 'tools.database.propertyName');
      // notion-spec-2 §18.5: a name then Enter makes a Text property. Enter on an empty field is unmeasured, so it does nothing.
      nameField.addEventListener('keydown', (e) => {
        const name = nameField.value.trim();

        if (e.key !== 'Enter' || e.isComposing || name === '') return;
        e.preventDefault();
        this.onSelect('text', name);
        this.close();
      });
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

    for (const type of addablePropertyTypes(this.hasPeople)) {
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

    // Inside a top-layer panel (a peek, the layout builder): on body the panel covers the menu, and a modal's focus trap takes the name field.
    overlayMountFor(anchor).appendChild(popover);
    const reposition = (): void => {
      positionFixedAnchored(popover, anchor, { side: 'bottom', offset: BELOW_GAP });
      // notion-spec-2 §18.5: above, the bottom sits 1px over the button; fitting neither side, it covers the button, bottom pinned 11px up.
      const { top, bottom } = anchor.getBoundingClientRect();
      const height = popover.offsetHeight;
      const bottomLimit = window.innerHeight - VIEWPORT_BOTTOM_MARGIN;

      const below = bottom + BELOW_GAP + height <= bottomLimit;
      const above = !below && top - ABOVE_GAP - height >= VIEWPORT_MARGIN;
      const covering = Math.max(VIEWPORT_MARGIN, bottomLimit - height);
      const away = above ? top - ABOVE_GAP - height : covering;

      popover.style.top = `${below ? bottom + BELOW_GAP : away}px`;
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
        this.close();
      }
    };

    document.addEventListener('mousedown', this.boundOutsideClick);
    nameField?.focus();
  }

  private typeListHeading(grid: HTMLElement): HTMLElement {
    return typeSearchHeading((key) => this.i18n?.t(key) ?? key, (query) => {
      for (const option of grid.querySelectorAll<HTMLElement>('[data-blok-database-property-type-option]')) {
        option.hidden = !(option.textContent ?? '').toLowerCase().includes(query);
      }
    }, true);
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

  close(): void {
    const popover = this.popoverEl;

    this.popoverEl = null;
    this.positionTracker?.detach();
    this.positionTracker = null;
    popover?.remove();
    if (this.boundOutsideClick !== null) {
      document.removeEventListener('mousedown', this.boundOutsideClick);
      this.boundOutsideClick = null;
    }
  }

  destroy(): void {
    this.close();
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

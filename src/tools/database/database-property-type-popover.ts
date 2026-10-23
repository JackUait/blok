import { syncPortalDirection } from '../../components/utils/portal-direction';
import { overlayMountFor } from '../../components/utils/top-layer';
import type { I18n } from '../../../types';
import type { PropertyType } from './types';
import { addablePropertyTypes, propertyTypeMeta } from './database-property-types';
import {
  createPositionTracker,
  positionFixedAnchored,
  type PositionTracker,
} from '../../components/utils/popover/anchored-position';

export interface PropertyTypePopoverOptions {
  /** `name` is the name field's text, '' without the field. */
  onSelect: (type: PropertyType, name: string) => void;
  i18n?: I18n;
  /** Offer Person: the host gave a people directory. */
  hasPeople?: boolean;
  /** Show Notion's "Type property name…" field above the types. */
  withNameField?: boolean;
}

export class DatabasePropertyTypePopover {
  private readonly onSelect: (type: PropertyType, name: string) => void;
  private readonly i18n: I18n | undefined;
  private readonly hasPeople: boolean;
  private readonly withNameField: boolean;
  private popoverEl: HTMLElement | null = null;
  private boundOutsideClick: ((e: MouseEvent) => void) | null = null;
  private positionTracker: PositionTracker | null = null;

  constructor(options: PropertyTypePopoverOptions) {
    this.onSelect = options.onSelect;
    this.i18n = options.i18n;
    this.hasPeople = options.hasPeople === true;
    this.withNameField = options.withNameField === true;
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

    const nameField = this.withNameField ? document.createElement('input') : null;

    if (nameField !== null) {
      const header = document.createElement('div');

      header.setAttribute('data-blok-database-property-type-header', '');
      nameField.type = 'text';
      nameField.setAttribute('data-blok-database-property-name-input', '');
      nameField.placeholder = this.i18n?.t('tools.database.propertyNamePlaceholder') ?? 'tools.database.propertyNamePlaceholder';
      nameField.setAttribute('aria-label', this.i18n?.t('tools.database.propertyName') ?? 'tools.database.propertyName');
      header.appendChild(nameField);
      popover.appendChild(header);
    }

    // The name field stays put; only the types scroll (feel/findings-table T12).
    const body = document.createElement('div');
    const grid = document.createElement('div');

    body.setAttribute('data-blok-database-property-type-body', '');
    grid.setAttribute('data-blok-database-property-type-grid', '');

    const heading = document.createElement('div');
    heading.setAttribute('data-blok-database-property-type-heading', '');
    heading.textContent = this.i18n?.t('tools.database.propertyTypeHeading') ?? 'tools.database.propertyTypeHeading';
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
      positionFixedAnchored(popover, anchor, { side: 'bottom', offset: 4 });
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

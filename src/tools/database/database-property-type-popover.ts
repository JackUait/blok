import { syncPortalDirection } from '../../components/utils/portal-direction';
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

  open(anchor: HTMLElement): void {
    this.close();

    const popover = document.createElement('div');
    popover.setAttribute('data-blok-popover', '');
    popover.setAttribute('data-blok-popover-opened', '');
    popover.setAttribute('data-blok-database-property-type-popover', '');
    popover.style.zIndex = '1000';

    const nameField = this.withNameField ? document.createElement('input') : null;

    if (nameField !== null) {
      nameField.type = 'text';
      nameField.setAttribute('data-blok-database-property-name-input', '');
      nameField.placeholder = this.i18n?.t('tools.database.propertyNamePlaceholder') ?? 'tools.database.propertyNamePlaceholder';
      nameField.setAttribute('aria-label', this.i18n?.t('tools.database.propertyName') ?? 'tools.database.propertyName');
      popover.appendChild(nameField);
    }

    const heading = document.createElement('div');
    heading.setAttribute('data-blok-database-property-type-heading', '');
    heading.textContent = this.i18n?.t('tools.database.propertyTypeHeading') ?? 'tools.database.propertyTypeHeading';
    popover.appendChild(heading);

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

      popover.appendChild(item);
    }

    document.body.appendChild(popover);
    const reposition = (): void => {
      positionFixedAnchored(popover, anchor, { side: 'bottom', offset: 4 });
    };

    // The anchor mirrors with the editor, so a flip re-places the menu.
    syncPortalDirection(popover, { source: anchor, onResync: reposition });
    this.popoverEl = popover;

    reposition();
    // The drawer grows its width as it slides in, carrying the anchor along.
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
    this.positionTracker?.detach();
    this.positionTracker = null;

    if (this.popoverEl !== null) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
    if (this.boundOutsideClick !== null) {
      document.removeEventListener('mousedown', this.boundOutsideClick);
      this.boundOutsideClick = null;
    }
  }

  destroy(): void {
    this.close();
  }
}

import { PopoverDesktop } from '../../../components/utils/popover';
import { PopoverItemType } from '../../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '../../../../types/utils/popover/popover-event';

export interface CellPopoverOptions {
  anchor: HTMLElement;
  content: HTMLElement;
  minWidth?: string;
  /** Escape pressed while open. The owner decides: close, or step back a panel. */
  onEscape: () => void;
  /** The popover closed itself: an outside press, or focus moved away. */
  onDismiss: () => void;
}

/**
 * The popover every cell editor sits in. One Html item, no flipper: each
 * editor owns its own keys under `data-blok-keyboard-owner`.
 */
export class CellPopover {
  private popover: PopoverDesktop | null = null;
  private readonly options: CellPopoverOptions;

  constructor(options: CellPopoverOptions) {
    this.options = options;
    options.content.setAttribute('data-blok-database-cell-editor', '');
    options.content.setAttribute('data-blok-keyboard-owner', '');
  }

  get isOpen(): boolean {
    return this.popover !== null;
  }

  show(): void {
    const popover = new PopoverDesktop({
      items: [{ type: PopoverItemType.Html, element: this.options.content }],
      trigger: this.options.anchor,
      flippable: false,
      width: 'auto',
      autoFocusFirstItem: false,
      ...(this.options.minWidth !== undefined ? { minWidth: this.options.minWidth } : {}),
    });

    this.popover = popover;
    popover.on(PopoverEvent.Closed, () => {
      if (this.popover === popover) {
        this.teardown();
        this.options.onDismiss();
      }
    });
    // Window capture runs before the popover registry's document-capture
    // Escape and before the row drawer's document Escape, so one press
    // reaches only this editor.
    window.addEventListener('keydown', this.handleEscape, true);
    popover.show();
  }

  /** Closes without calling onDismiss. */
  close(): void {
    const popover = this.popover;

    if (popover === null) {
      return;
    }
    this.teardown();
    popover.hide();
    popover.destroy();
  }

  private teardown(): void {
    const popover = this.popover;

    this.popover = null;
    window.removeEventListener('keydown', this.handleEscape, true);
    if (popover !== null) {
      queueMicrotask(() => popover.destroy());
    }
  }

  private readonly handleEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || this.popover === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.options.onEscape();
  };
}

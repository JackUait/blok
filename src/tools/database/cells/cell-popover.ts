import { PopoverDesktop } from '../../../components/utils/popover';
import { PopoverItemType } from '../../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '../../../../types/utils/popover/popover-event';
import type { PopoverParams } from '../../../../types/utils/popover/popover';

export interface CellPopoverOptions {
  anchor: HTMLElement;
  content: HTMLElement;
  minWidth?: string;
  /** Open over the anchor (a table cell) instead of below it. */
  cover?: boolean;
  /** Escape pressed while open. The owner decides: close, or step back a panel. */
  onEscape: () => void;
  /** The popover closed itself: an outside press, or focus moved away. */
  onDismiss: () => void;
}

/** Styles the box: radius, shadow and padding live in database.css. */
const CELL_EDITOR_CLASS = 'blok-database-cell-editor';

/**
 * research/22 §4: the box's corner sits 1px past the cell's, so its 1px ring
 * lands on the cell border. A box that does not fit slides and stops 12px from
 * the viewport edge.
 */
const COVER_OUTSET = 1;
const COVER_VIEWPORT_MARGIN = 12;

const coverPlacement = (anchor: HTMLElement): Pick<PopoverParams, 'cover' | 'viewportMargin'> & { position: DOMRect; positionContext: HTMLElement } => {
  const cell = anchor.getBoundingClientRect();

  return {
    cover: true,
    viewportMargin: COVER_VIEWPORT_MARGIN,
    position: new DOMRect(
      cell.x - COVER_OUTSET,
      cell.y - COVER_OUTSET,
      cell.width + 2 * COVER_OUTSET,
      cell.height + 2 * COVER_OUTSET
    ),
    positionContext: anchor,
  };
};

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
    const { anchor, cover } = this.options;
    const base: PopoverParams = {
      items: [{ type: PopoverItemType.Html, element: this.options.content }],
      trigger: anchor,
      flippable: false,
      width: 'auto',
      autoFocusFirstItem: false,
      class: CELL_EDITOR_CLASS,
      ...(this.options.minWidth !== undefined ? { minWidth: this.options.minWidth } : {}),
    };
    const popover = new PopoverDesktop(cover === true ? { ...base, ...coverPlacement(anchor) } : base);

    this.popover = popover;
    popover.on(PopoverEvent.Closed, () => {
      if (this.popover === popover) {
        this.teardown();
        // Destroying inside the popover's own Closed emit would re-enter it.
        queueMicrotask(() => popover.destroy());
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
    popover.destroy();
  }

  private teardown(): void {
    this.popover = null;
    window.removeEventListener('keydown', this.handleEscape, true);
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

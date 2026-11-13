import { PopoverDesktop } from '../../../components/utils/popover';
import type { PopoverDesktopParams } from '../../../components/utils/popover/popover-desktop';
import { PopoverItemType } from '../../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '../../../../types/utils/popover/popover-event';
import type { PopoverParams } from '../../../../types/utils/popover/popover';

export interface CellPopoverOptions {
  anchor: HTMLElement;
  content: HTMLElement;
  minWidth?: string;
  /** Open over the anchor instead of below it (see CellEditorContext.coverCell). */
  cover?: boolean | 'value';
  /** With `cover: true`, open under the anchor instead of over it, still kept inside the window. */
  below?: boolean;
  /**
   * Dock at the window's end edge, top level with the anchor, like Notion's view settings (research/26 §1a).
   * `'page'`: a full-page database's side panel, from under `dockRow` to the window bottom (research/35 §2.3).
   */
  docked?: boolean | 'page';
  /** With `docked: 'page'`: the toolbar row the panel starts under. */
  dockRow?: HTMLElement;
  /** A menu-like panel (DatabasePanel), not a cell editor: Notion's menu corner (database.css). */
  panel?: boolean;
  /** Space under the anchor, PANEL_GAP when unset. */
  gap?: number;
  /** Opens beside the anchor instead: this far right of it, top level with it. */
  beside?: number;
  /** Opens above the anchor, `gap` over it, when it fits there and not below. */
  flip?: boolean;
  /** Escape pressed while open. The owner decides: close, or step back a panel. */
  onEscape: () => void;
  /** The popover closed itself: an outside press, or focus moved away. */
  onDismiss: () => void;
}

/** Styles the box: radius, shadow and padding live in database.css. */
const CELL_EDITOR_CLASS = 'blok-database-cell-editor';
/** The row page's look on top of it (database.css). */
const VALUE_EDITOR_CLASS = 'blok-database-value-editor';
/** research/08 Motion: a table cell editor mounts at its final size, with no fade (database.css). */
const TABLE_EDITOR_CLASS = 'blok-database-table-cell-editor';
/** On the anchor while its editor is open. */
const EDITOR_OPEN_ATTR = 'data-blok-database-editor-open';

/**
 * research/22 §4: the box's corner sits 1px past the cell's, so its 1px ring
 * lands on the cell border. A box that does not fit slides and stops 12px from
 * the viewport edge.
 */
const COVER_OUTSET = 1;
const COVER_VIEWPORT_MARGIN = 12;

const coverPlacement = (anchor: HTMLElement, value: boolean, below: boolean): Pick<PopoverParams, 'cover' | 'viewportMargin'> & { position: DOMRect; positionContext: HTMLElement } => {
  const cell = anchor.getBoundingClientRect();
  // notion-spec §7: a row page value has no border to land on, so the box keeps its top.
  const top = value ? 0 : COVER_OUTSET;
  // notion-spec-2 §19.9: the box's top sits 1px over the cell's bottom line.
  const y = below ? cell.bottom - COVER_OUTSET : cell.y - top;

  return {
    cover: true,
    viewportMargin: COVER_VIEWPORT_MARGIN,
    position: new DOMRect(
      cell.x - COVER_OUTSET,
      y,
      cell.width + 2 * COVER_OUTSET,
      cell.height + 2 * top
    ),
    positionContext: anchor,
  };
};

/** The usual gap under a trigger (PopoverDesktop's default offset). */
const PANEL_GAP = 8;

/**
 * Under the anchor, as a trigger menu opens, but through the cover clamp: a
 * panel that would run past the window slides up to stay inside it, as view
 * settings does (side-by-side-v1.md "Filter / Sort popovers").
 */
const fitPlacement = (anchor: HTMLElement, gap = PANEL_GAP, flip = false): Pick<PopoverDesktopParams, 'cover' | 'viewportMargin' | 'coverFlipOffset'> & { position: DOMRect; positionContext: HTMLElement } => {
  const rect = anchor.getBoundingClientRect();

  return {
    cover: true,
    viewportMargin: COVER_VIEWPORT_MARGIN,
    position: new DOMRect(rect.x, rect.bottom + gap, rect.width, 0),
    positionContext: anchor,
    // Above, its bottom sits `gap` over the anchor's top (r21-cc-date-val.raw, r21-cc-add3.raw).
    ...(flip ? { coverFlipOffset: rect.height + 2 * gap } : {}),
  };
};

/** Beside the anchor, top level with it, through the same clamp (notion-motion.md Round 18 §2, the rule ⋯ menu). */
const besidePlacement = (anchor: HTMLElement, gap: number): Pick<PopoverParams, 'cover' | 'viewportMargin'> & { position: DOMRect; positionContext: HTMLElement } => {
  const rect = anchor.getBoundingClientRect();

  return {
    cover: true,
    viewportMargin: COVER_VIEWPORT_MARGIN,
    position: new DOMRect(rect.right + gap, rect.top, 0, 0),
    positionContext: anchor,
  };
};

/**
 * An editor's min-width: the cell's width, never under `floor`. Over a row
 * page value the box starts 1px left and still ends on the value's right edge.
 */
export const coverMinWidth = (anchor: HTMLElement, cover: boolean | 'value' | undefined, floor: number): string => {
  const width = anchor.getBoundingClientRect().width + (cover === 'value' ? COVER_OUTSET : 0);

  return `${Math.max(width, floor)}px`;
};

/** research/26 §1a: the panel ends at x 1500 of a 1512 window. */
const DOCK_VIEWPORT_MARGIN = 12;
const DOCKED_CLASS = 'blok-database-docked-panel';
const DOCKED_PAGE_CLASS = 'blok-database-docked-page';
const PANEL_CLASS = 'blok-database-panel';

/**
 * Cover placement from a zero-size rect past the window's end: the clamp
 * pulls the box back in, so it hugs that edge and slides up only to fit.
 */
const dockPlacement = (anchor: HTMLElement, top: number, margin: number): Pick<PopoverParams, 'cover' | 'viewportMargin'> & { position: DOMRect; positionContext: HTMLElement } => {
  const rtl = getComputedStyle(anchor).direction === 'rtl';

  return {
    cover: true,
    viewportMargin: margin,
    position: new DOMRect(rtl ? 0 : window.innerWidth, top, 0, 0),
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
  /** A surface opened from the editor owns focus, presses and Escape. */
  private held = false;

  constructor(options: CellPopoverOptions) {
    this.options = options;
    options.content.setAttribute('data-blok-database-cell-editor', '');
    options.content.setAttribute('data-blok-keyboard-owner', '');
  }

  get isOpen(): boolean {
    return this.popover !== null;
  }

  show(): void {
    const { anchor, cover, docked, panel } = this.options;
    const base: PopoverParams = {
      items: [{ type: PopoverItemType.Html, element: this.options.content }],
      trigger: anchor,
      flippable: false,
      width: 'auto',
      autoFocusFirstItem: false,
      // Fades out like the database menus; an editor with no motion (database.css) still goes at once.
      animateClose: true,
      class: [CELL_EDITOR_CLASS, ...(panel === true ? [PANEL_CLASS] : []), ...(docked !== undefined && docked !== false ? [DOCKED_CLASS] : []), ...(docked === 'page' ? [DOCKED_PAGE_CLASS] : []), ...(cover === 'value' ? [VALUE_EDITOR_CLASS] : []), ...(cover === true ? [TABLE_EDITOR_CLASS] : [])].join(' '),
      ...(this.options.minWidth !== undefined ? { minWidth: this.options.minWidth } : {}),
    };
    const fit = this.options.beside !== undefined ? besidePlacement(anchor, this.options.beside) : fitPlacement(anchor, this.options.gap, this.options.flip);
    const coverOrFit = cover === true || cover === 'value' ? coverPlacement(anchor, cover === 'value', cover === true && this.options.below === true) : fit;
    const docks = {
      page: () => dockPlacement(anchor, (this.options.dockRow ?? anchor).getBoundingClientRect().bottom, 0),
      card: () => dockPlacement(anchor, anchor.getBoundingClientRect().top, DOCK_VIEWPORT_MARGIN),
    };
    const dock = docked === 'page' ? docks.page : docks.card;
    const placement = docked === undefined || docked === false ? coverOrFit : dock();
    const popover = new PopoverDesktop({ ...base, ...placement });

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
    // database.css hides the anchor cell's hover box while this is set.
    anchor.setAttribute(EDITOR_OPEN_ATTR, '');
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

  /**
   * Keeps the editor open under a surface it opened, such as a row peek, until
   * the release. Outside presses, focus and Escape go to that surface meanwhile.
   */
  hold(): () => void {
    const popover = this.popover;

    if (popover === null) {
      return () => undefined;
    }
    const release = popover.holdOpen();

    this.held = true;

    return () => {
      if (this.popover !== popover || !this.held) return;
      this.held = false;
      release();
    };
  }

  private teardown(): void {
    this.options.anchor.removeAttribute(EDITOR_OPEN_ATTR);
    this.popover = null;
    this.held = false;
    window.removeEventListener('keydown', this.handleEscape, true);
  }

  private readonly handleEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || this.popover === null || this.held) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.options.onEscape();
  };
}

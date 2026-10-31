/**
 * @class RectangleSelection
 * @classdesc Manages Block selection with mouse
 * @module RectangleSelection
 * @version 1.0.0
 */
import { Module } from '../__module';
import type { Block } from '../block';
import {
  INLINE_TOOLBAR_INTERFACE_SELECTOR,
  DATA_ATTR,
  createSelector,
} from '../constants';
import { Dom as $ } from '../dom';
import { SelectionUtils } from '../selection/index';
import { announce } from '../utils/announcer';
import { throttle } from '../utils';

import { findScrollableAncestor } from './drag/utils/findScrollableAncestor';

import { CELL_BLOCKS_SELECTOR, CHILD_TOOLBAR_SELECTOR } from './uiControllers/hovered-block-resolution';

/** Fired on a {@link DATA_ATTR.selectionOwner} element; see its doc. */
const LASSO_EVENT = 'blok-lasso';

/** The band in client coordinates. */
interface LassoRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface LassoDetail {
  rect: LassoRect | null;
}

/**
 *
 */
export class RectangleSelection extends Module {
  /**
   * CSS classes for the Block - kept for backward compatibility
   * @returns {{wrapper: string, content: string}}
   * @deprecated Use data attributes via constants instead (BLOK_OVERLAY_ATTR, BLOK_OVERLAY_CONTAINER_ATTR, etc.)
   */
  public static get CSS(): {[name: string]: string} {
    return {
      overlay: '',
      overlayContainer: '',
      rect: '',
      topScrollZone: '',
      bottomScrollZone: '',
    };
  }

  /**
   * Using the selection rectangle
   * @type {boolean}
   */
  private isRectSelectionActivated = false;

  /**
   * Speed of an auto-scroll run when it starts, in px per ms. Speeds are per
   * ms, not per loop tick: the tick rate follows the CPU, so a per-tick step
   * scrolls slower on a busy or slow machine.
   */
  private readonly SCROLL_SPEED: number = 0.5;

  /**
   * An unbroken auto-scroll run speeds up from SCROLL_SPEED to this over
   * SCROLL_RAMP_MS, so a long way off-screen is reached without a slow crawl.
   */
  private readonly MAX_SCROLL_SPEED = 2.5;
  private readonly SCROLL_RAMP_MS = 2000;

  /**
   * Longest gap between two ticks that counts in full. After a longer stall
   * the band moves this much, not a jump of hundreds of px. A 6x CPU-throttled
   * Chrome ticks about every 50 ms here, so a lower cap slows slow machines again.
   */
  private readonly MAX_SCROLL_TICK_MS = 100;

  /**
   * When the run last ticked, and the part of a pixel it still owes. Only
   * whole pixels are scrolled, so a tiny step is never read as "cannot move".
   */
  private scrollLastTick = 0;
  private scrollRemainder = 0;

  /**
   * The current auto-scroll run and when it began. A run ends when the pointer
   * leaves the edge zone, the button is released or the scroller cannot move;
   * the next one starts at SCROLL_SPEED again. A loop whose run is no longer
   * current stops, so re-entering the zone never leaves two loops scrolling.
   */
  private scrollRun = 0;
  private scrollRunStart = 0;

  /**
   *  Height of scroll zone on boundary of screen
   */
  private readonly HEIGHT_OF_SCROLL_ZONE = 40;

  /**
   *  Scroll zone type indicators
   */
  private readonly BOTTOM_SCROLL_ZONE = 1;
  private readonly TOP_SCROLL_ZONE = 2;

  /**
   * Id of main button for event.button
   */
  private readonly MAIN_MOUSE_BUTTON = 0;

  /**
   *  Mouse is clamped
   */
  private mousedown = false;

  /**
   * Set when mousedown starts from a contentEditable element that is within the
   * editor's horizontal content bounds.  Prevents the toolbar from re-opening via
   * the BlockHovered event while the user is dragging.  Cleared on mouseup.
   */
  private mouseDownWithinBoundsFromContentEditable = false;

  /**
   * Set when the user mousedowns in a position that should eventually close the toolbar
   * if a drag begins, but NOT immediately (to avoid interfering with button clicks like
   * the plus button). The toolbar is closed on the first mousemove after mousedown.
   * Cleared on mouseup / endSelection.
   */
  private pendingToolbarClose = false;

  /**
   *  Is scrolling now
   */
  private isScrolling = false;

  /**
   *  Mouse is in scroll zone
   */
  private inScrollZone: number | null = null;

  /**
   * Band anchor, relative to the redactor's top-left. It moves with the
   * redactor, so it stays on its row whatever scrolls the editor: the window,
   * an overflow box, or both.
   */
  private startX = 0;
  private startY = 0;

  /**
   * Last pointer position, in client coordinates. A scroll moves the content
   * under the pointer, never the pointer itself.
   */
  private mouseX = 0;
  private mouseY = 0;

  /**
   * What auto-scroll moves: the editor's scrolling ancestor, or null for the
   * window.
   */
  private scroller: HTMLElement | null = null;

  /**
   * Blocks the lasso selected, in document order. Kept as blocks, not
   * indexes, so a block inserted mid-drag does not shift them.
   */
  private stackOfSelected: Block[] = [];

  /**
   * Stacked blocks a peer deleted mid-drag. They stay in the stack but are
   * never swapped for a later block with the same id.
   */
  private deletedStackBlocks = new WeakSet<Block>();

  /**
   * Does the rectangle intersect blocks
   */
  private rectCrossesBlocks = false;

  /**
   * Selection rectangle
   */
  private overlayRectangle: HTMLDivElement | null = null;

  /**
   * Listener identifiers
   */
  private listenerIds: string[] = [];

  /**
   * The item area that took the band on the last move, if any.
   */
  private lassoTaker: HTMLElement | null = null;

  /**
   * Module Preparation
   * Creating rect and hang handlers
   */
  public prepare(): void {
    this.enableModuleBindings();
  }

  /**
   * Init rect params
   * @param {number} pageX - X coord of mouse
   * @param {number} pageY - Y coord of mouse
   * @param {boolean} shiftKey - whether Shift key is held for additive selection
   */
  public startSelection(pageX: number, pageY: number, shiftKey = false): void {
    const { UI } = this.Blok;
    const redactor = UI.nodes.redactor;

    if (!redactor) {
      return;
    }

    const editorRect = redactor.getBoundingClientRect();
    const scrollTop = this.getScrollTop();
    const pointerY = pageY - scrollTop;

    // Check if pointer is within editor's vertical bounds
    const withinEditorVertically = pointerY >= editorRect.top && pointerY <= editorRect.bottom;

    if (!withinEditorVertically) {
      return;
    }

    const scrollLeft = this.getScrollLeft();
    const pointerX = pageX - scrollLeft;

    /**
     * Check if pointer is within the content area's horizontal bounds.
     * This determines whether we should close the toolbar when starting selection.
     * Clicks outside the content area (to the left or right, in the margin/toolbar zone)
     * should NOT close the toolbar. Uses UI.contentRect which queries the first block's
     * content element and caches the result.
     */
    const contentRect = this.Blok.UI.contentRect;
    const withinEditorHorizontally = pointerX >= contentRect.left && pointerX <= contentRect.right;

    const elemWhereSelectionStart = document.elementFromPoint(pageX - scrollLeft, pointerY);

    // The find bar floats over the content: pressing its buttons is not a drag.
    if (!elemWhereSelectionStart || elemWhereSelectionStart.closest('[data-blok-find]') !== null) {
      return;
    }

    /**
     * Don't clear selected block by clicks on the Block settings
     * because we need to keep highlighting working block
     */
    const startsInsideToolbar = elemWhereSelectionStart.closest(createSelector(DATA_ATTR.toolbar));

    /**
     * When Shift is held, preserve existing selection for additive behavior.
     * Otherwise, clear selection state.
     */
    if (!startsInsideToolbar && !shiftKey) {
      this.Blok.BlockSelection.allBlocksSelected = false;
      this.Blok.BlockSelection.disableNavigationMode();
      this.clearSelection();
      this.stackOfSelected = [];
    }

    const selectorsToAvoid = [
      createSelector(DATA_ATTR.elementContent),
      createSelector(DATA_ATTR.settingsToggler),
      createSelector(DATA_ATTR.popover),
      INLINE_TOOLBAR_INTERFACE_SELECTOR,
    ];

    const startsInSelectorToAvoid = selectorsToAvoid.some((selector) => !!elemWhereSelectionStart.closest(selector));

    /**
     * If selection starts inside the blocks content or on Blok UI elements, do not handle it
     */
    if (startsInSelectorToAvoid) {
      return;
    }

    /**
     * The block toolbar hovers ABOVE block content — e.g. at the left edge of
     * a line inside a table cell. A mousedown that lands on the toolbar while
     * a nested-blocks container (a table cell's content) sits under the
     * pointer is a text-selection gesture inside that cell, never a lasso;
     * arming the lasso here made such a drag select (and a following
     * Backspace delete) the whole table. Toolbar mousedowns over the page
     * margin remain valid rubber-band starts.
     */
    if (startsInsideToolbar) {
      const nestedBlocksSelector = createSelector(DATA_ATTR.nestedBlocks);
      const startsOverNestedBlocks = document
        .elementsFromPoint(pageX - scrollLeft, pointerY)
        .some((el) => el.matches(nestedBlocksSelector));

      if (startsOverNestedBlocks) {
        return;
      }
    }

    /**
     * Schedule toolbar close for the first mousemove (i.e. when the user actually drags).
     * Deferring prevents a plain click (e.g. on the plus button) from accidentally closing
     * the toolbar before its own click handler fires.
     * Only close if starting within the horizontal bounds of the editor.
     */
    if (withinEditorHorizontally) {
      this.pendingToolbarClose = true;
    }

    this.mousedown = true;
    this.startX = pointerX - editorRect.left;
    this.startY = pointerY - editorRect.top;
    this.mouseX = pointerX;
    this.mouseY = pointerY;
    this.scroller = findScrollableAncestor(redactor);
  }

  /**
   * Clear all params to end selection
   */
  public endSelection(): void {
    this.mousedown = false;
    this.mouseDownWithinBoundsFromContentEditable = false;
    this.pendingToolbarClose = false;
    this.startX = 0;
    this.startY = 0;
    this.isScrolling = false;
    this.inScrollZone = null;
    this.scroller = null;
    this.stackOfSelected = [];
    this.lassoTaker = null;
    if (this.overlayRectangle !== null) {
      this.overlayRectangle.style.display = 'none';
    }
  }

  /**
   * is RectSelection Activated
   */
  public isRectActivated(): boolean {
    return this.isRectSelectionActivated || this.mousedown;
  }

  /**
   * Returns true when the user pressed down a mouse button within the editor's horizontal
   * content bounds, even if the click originated on a contentEditable element (in which
   * case rubber-band selection is not started but the toolbar is still closed).
   *
   * Used by the Toolbar module to suppress toolbar reopening while the user is dragging
   * inside the editor content area.
   */
  public get isMouseDownWithinBounds(): boolean {
    return this.mouseDownWithinBoundsFromContentEditable;
  }

  /**
   * Mark that selection is end
   */
  public clearSelection(): void {
    this.isRectSelectionActivated = false;
  }

  /**
   * Cancel active rectangle selection.
   * Used when another selection system (e.g., table cell selection) takes priority.
   */
  public cancelActiveSelection(): void {
    if (!this.mousedown && !this.isRectSelectionActivated) {
      return;
    }

    this.clearSelection();
    this.endSelection();
  }

  /**
   * Sets Module necessary event handlers
   */
  private enableModuleBindings(): void {
    this.genHTML();

    this.listeners.on(document.body, 'mousedown', (event: Event) => {
      this.processMouseDown(event as MouseEvent);
    }, false);

    const throttledMouseMove = throttle((event: unknown) => {
      if (event instanceof MouseEvent) {
        this.processMouseMove(event);
      }

    }, 10) as EventListener;

    this.listeners.on(document.body, 'mousemove', throttledMouseMove, {
      passive: true,
    });

    const throttledScroll = throttle(() => {
      this.processScroll();
    }, 10) as EventListener;

    /**
     * Capture on document: an element's scroll event does not bubble, so a
     * window listener never hears the overflow box the editor may sit in.
     */
    this.listeners.on(document, 'scroll', throttledScroll, {
      capture: true,
      passive: true,
    });

    this.listeners.on(document, 'mouseup', (event: Event) => {
      this.processMouseUp(event as MouseEvent);
    }, false);
  }

  /**
   * Handle mouse down events
   * @param {MouseEvent} mouseEvent - mouse event payload
   */
  private processMouseDown(mouseEvent: MouseEvent): void {
    if (mouseEvent.button !== this.MAIN_MOUSE_BUTTON) {
      return;
    }

    /**
     * Do not enable the Rectangle Selection when mouse dragging started some editable input
     * Used to prevent Rectangle Selection on Block Tune wrappers' inputs that also can be inside the Block
     */
    const startedFromContentEditable = (mouseEvent.target as Element).closest($.allInputsSelector) !== null;

    if (!startedFromContentEditable) {
      this.startSelection(mouseEvent.pageX, mouseEvent.pageY, mouseEvent.shiftKey);

      return;
    }

    /**
     * When dragging starts from a contentEditable element, track whether the
     * pointer is within the editor's horizontal content bounds.
     * On the first subsequent mousemove (i.e. when the user actually drags rather
     * than just clicking), the toolbar will be closed and hover-based reopening
     * will be suppressed while the mouse button is held.
     */
    const scrollLeft = this.getScrollLeft();
    const pointerX = mouseEvent.pageX - scrollLeft;
    const contentRect = this.Blok.UI.contentRect;
    const withinEditorHorizontally = pointerX >= contentRect.left && pointerX <= contentRect.right;

    if (withinEditorHorizontally) {
      this.mouseDownWithinBoundsFromContentEditable = true;
    }
  }

  /**
   * Handle mouse move events
   * @param {MouseEvent} mouseEvent - mouse event payload
   */
  private processMouseMove(mouseEvent: MouseEvent): void {
    /**
     * The button came up where no mouseup reached the document. Leaving the
     * body is NOT the end: a band dragged below a short page must live on.
     */
    if (this.mousedown && (mouseEvent.buttons & 1) === 0) {
      this.clearSelection();
      this.endSelection();

      return;
    }

    /**
     * When the user clicked inside a contentEditable element within the editor's
     * horizontal bounds and is now dragging, close the toolbar on the first move.
     * We defer this to mousemove (rather than mousedown) so that a plain click
     * does not accidentally close the toolbar.
     */
    if (this.mouseDownWithinBoundsFromContentEditable) {
      this.Blok.Toolbar.close();
    }

    /**
     * Close the toolbar on the first actual drag movement after a mousedown
     * that was scheduled to close it. Using mousemove instead of mousedown ensures
     * plain button clicks (e.g. the plus button) don't close the toolbar prematurely.
     */
    if (this.pendingToolbarClose) {
      this.pendingToolbarClose = false;
      this.Blok.Toolbar.close();
    }

    this.changingRectangle(mouseEvent);

    if (this.mousedown) {
      this.scrollByZones(mouseEvent.clientY);
    }
  }

  /**
   * Any scroller moved: the pointer now sits over different content.
   */
  private processScroll(): void {
    this.changingRectangle();
  }

  /**
   * Handle mouse up
   * @param mouseEvent - the release; its position is the band's final corner
   */
  private processMouseUp(mouseEvent?: MouseEvent): void {
    /**
     * A throttled move or scroll may still be queued, and it runs after
     * mousedown is cleared, so it can no longer grow the band.
     */
    if (this.isRectSelectionActivated && mouseEvent !== undefined) {
      this.changingRectangle(mouseEvent);
    }

    /**
     * Show toolbar for multi-block selection after mouse up
     */
    const selectedBlocks = this.Blok.BlockSelection.selectedBlocks;

    if (selectedBlocks.length > 1) {
      /**
       * The lasso drags THROUGH the rows it selects, so by mouseup the hover
       * controller's last-hovered block is the one under the pointer and a
       * throttled mousemove for it may still be queued. Without this the
       * toolbar the line below anchors at the first selected block is yanked
       * onto that block a frame later, and the user's first deliberate hover of
       * it is then swallowed as a duplicate. Mirrors CrossBlockSelection.onMouseUp.
       */
      this.Blok.UI.disableHoverForCooldown();
      this.Blok.UI.resetBlockHoverState();

      this.Blok.Toolbar.moveAndOpenForMultipleBlocks();

      /**
       * Announce the resulting selection size once the lasso is released.
       */
      announce(
        this.Blok.I18n.t('a11y.blocksSelected', { count: selectedBlocks.length }),
        { politeness: 'polite' }
      );
    }

    this.clearSelection();
    this.endSelection();
  }

  /**
   * Scroll If mouse in scroll zone
   * @param {number} clientY - Y coord of mouse
   */
  private scrollByZones(clientY: number): void {
    const visible = this.visibleScrollArea();

    this.inScrollZone = null;
    if (clientY <= visible.top + this.HEIGHT_OF_SCROLL_ZONE) {
      this.inScrollZone = this.TOP_SCROLL_ZONE;
    }
    if (visible.bottom - clientY <= this.HEIGHT_OF_SCROLL_ZONE) {
      this.inScrollZone = this.BOTTOM_SCROLL_ZONE;
    }

    if (!this.inScrollZone) {
      this.isScrolling = false;

      return;
    }

    if (!this.isScrolling) {
      this.isScrolling = true;
      this.scrollVertical(this.inScrollZone === this.TOP_SCROLL_ZONE ? -this.SCROLL_SPEED : this.SCROLL_SPEED);
    }
  }

  /**
   * Client-space top and bottom of what auto-scroll can reveal: the
   * scroller's box, cut to the viewport.
   */
  private visibleScrollArea(): { top: number; bottom: number } {
    const viewportBottom = document.documentElement.clientHeight;

    if (this.scroller === null) {
      return { top: 0, bottom: viewportBottom };
    }

    const rect = this.scroller.getBoundingClientRect();

    return { top: Math.max(rect.top, 0), bottom: Math.min(rect.bottom, viewportBottom) };
  }

  /**
   * Generates required HTML elements
   * @returns {Record<string, Element>}
   */
  private genHTML(): {container: Element; overlay: Element} {
    const { UI } = this.Blok;

    const container = UI.nodes.holder.querySelector(createSelector(DATA_ATTR.editor));
    const overlay = $.make('div', [
      'fixed',
      'inset-0',
      'z-overlay',
      'pointer-events-none',
      'overflow-hidden',
    ], {});
    const overlayContainer = $.make('div', [
      'relative',
      'pointer-events-auto',
      'z-0',
    ], {});
    const overlayRectangle = $.make('div', [
      'absolute',
      'pointer-events-none',
      'bg-selection-highlight',
      'border',
      'border-transparent',
    ], {});

    overlay.setAttribute(DATA_ATTR.overlay, '');
    /**
     * The lasso overlay is purely decorative — its selection outcome is conveyed
     * to assistive technology via the block-count announcement on mouseup, so
     * hide the whole overlay subtree from the AT tree.
     */
    overlay.setAttribute('aria-hidden', 'true');
    overlayContainer.setAttribute(DATA_ATTR.overlayContainer, '');
    overlayRectangle.setAttribute(DATA_ATTR.overlayRectangle, '');
    // Its border and fill paint a 2px dot at the origin until a drag shows it.
    overlayRectangle.style.display = 'none';
    overlay.setAttribute('data-blok-testid', 'overlay');
    overlayRectangle.setAttribute('data-blok-testid', 'overlay-rectangle');

    if (!container) {
      throw new Error('RectangleSelection: blok wrapper not found');
    }

    overlayContainer.appendChild(overlayRectangle);
    overlay.appendChild(overlayContainer);
    container.appendChild(overlay);

    this.overlayRectangle = overlayRectangle as HTMLDivElement;

    return {
      container,
      overlay,
    };
  }

  /**
   * Starts an auto-scroll run, or continues `run`, while the pointer is held in a scroll zone
   * @param {number} speed - starting speed of the run in px per ms, its sign the direction
   * @param run - the run this tick belongs to; omitted to start a new run
   */
  private scrollVertical(speed: number, run?: number): void {
    const now = Date.now();

    if (run === undefined) {
      this.scrollRun++;
      this.scrollRunStart = now;
      this.scrollLastTick = now;
      this.scrollRemainder = 0;
    } else if (run !== this.scrollRun) {
      return;
    }

    const currentRun = this.scrollRun;

    if (!(this.inScrollZone && this.mousedown)) {
      this.isScrolling = false;

      return;
    }

    const ramp = Math.min(1, (now - this.scrollRunStart) / this.SCROLL_RAMP_MS);
    const velocity = Math.sign(speed) * (Math.abs(speed) + (this.MAX_SCROLL_SPEED - Math.abs(speed)) * ramp);

    this.scrollRemainder += velocity * Math.min(now - this.scrollLastTick, this.MAX_SCROLL_TICK_MS);
    this.scrollLastTick = now;

    const step = Math.trunc(this.scrollRemainder);

    if (step !== 0) {
      this.scrollRemainder -= step;

      const scroller = this.scroller;
      const offset = (): number => scroller === null ? this.getScrollTop() : scroller.scrollTop;
      const before = offset();

      // 'instant': a host's `scroll-behavior: smooth` would defer the move and read as "cannot scroll".
      if (scroller === null) {
        window.scrollBy({ top: step, behavior: 'instant' });
      } else {
        scroller.scrollBy({ top: step, behavior: 'instant' });
      }

      // At the end of the content: stop until the pointer moves again.
      if (offset() === before) {
        this.isScrolling = false;

        return;
      }

      this.changingRectangle();
    }

    setTimeout(() => {
      this.scrollVertical(speed, currentRun);
    }, 0);
  }

  /**
   * Rebuilds the band from the anchor and the pointer, then the selection
   * from the band. Every input — move, scroll, auto-scroll tick, release —
   * comes here, and nothing here depends on which one it was.
   * @param event - a pointer event carrying a new pointer position, if any
   */
  private changingRectangle(event?: Pick<MouseEvent, 'clientX' | 'clientY'>): void {
    if (!this.mousedown) {
      return;
    }

    const overlayRectangle = this.overlayRectangle;

    if (overlayRectangle === null) {
      return;
    }

    if (event !== undefined) {
      this.mouseX = event.clientX;
      this.mouseY = event.clientY;
    }

    if (!this.isRectSelectionActivated) {
      this.isRectSelectionActivated = true;
      this.shrinkRectangleToPoint();
      overlayRectangle.style.display = 'block';
    }

    const band = this.band();

    this.rectCrossesBlocks = this.bandCrossesEditor(band);
    this.updateRectangleSize();

    /**
     * Hide Block Settings Toggler (along with the Toolbar) (if showed) when the Rectangle Selection is activated
     */
    this.Blok.Toolbar.close();

    this.trySelectNextBlock();
    // For case, when rect is out from blocks
    this.inverseSelection();

    const selection = SelectionUtils.get();

    if (selection) {
      selection.removeAllRanges();
    }
  }

  /**
   * The band in client coordinates, from the anchor (re-read off the
   * redactor's live position) to the pointer.
   */
  private band(): LassoRect {
    const anchor = this.anchorPoint();

    return {
      left: Math.min(anchor.x, this.mouseX),
      top: Math.min(anchor.y, this.mouseY),
      right: Math.max(anchor.x, this.mouseX),
      bottom: Math.max(anchor.y, this.mouseY),
    };
  }

  /**
   * The anchor in client coordinates.
   */
  private anchorPoint(): { x: number; y: number } {
    const redactorRect = this.Blok.UI.nodes.redactor.getBoundingClientRect();

    return { x: redactorRect.left + this.startX, y: redactorRect.top + this.startY };
  }

  /**
   * Whether the band reaches the editor horizontally. The redactor's gutter
   * (--blok-editor-gutter-* padding housing the floating +/⠿ controls) is part
   * of every row; true page margins OUTSIDE the editor stay non-selecting.
   * @param band - the band in client coordinates
   */
  private bandCrossesEditor(band: LassoRect): boolean {
    const redactorRect = this.Blok.UI.nodes.redactor.getBoundingClientRect();
    // A display:none holder (a collapsed toggle's child) measures 0,0,0,0 and would stretch the span to x=0.
    const spans = this.Blok.BlockManager.blocks
      .map((block) => block.holder.getBoundingClientRect())
      .filter((rect) => rect.width > 0 || rect.height > 0);
    const left = Math.min(redactorRect.left, ...spans.map((rect) => rect.left));
    const right = Math.max(redactorRect.right, ...spans.map((rect) => rect.right));

    return band.right >= left && band.left <= right;
  }

  /**
   * Shrink rect to singular point
   */
  private shrinkRectangleToPoint(): void {
    const anchor = this.anchorPoint();

    this.positionRectangle(anchor.x, anchor.y, anchor.x, anchor.y);
  }

  /**
   * Select or unselect all of blocks in array if rect is out or in selectable area
   */
  private inverseSelection(): void {
    if (this.stackOfSelected.length === 0) {
      return;
    }

    const indexes = this.blockIndexes();

    this.followConvertedStackBlocks(indexes);

    const firstBlockInStack = this.stackOfSelected[0];

    if (!indexes.has(firstBlockInStack)) {
      return;
    }

    const isSelectedMode = firstBlockInStack.selected;
    const stackIndices = this.stackIndices(indexes);

    if (this.rectCrossesBlocks && !isSelectedMode) {
      for (const index of stackIndices) {
        this.Blok.BlockSelection.selectBlockByIndex(index);
      }
    }

    if (!this.rectCrossesBlocks && isSelectedMode) {
      for (const index of stackIndices) {
        this.Blok.BlockSelection.unSelectBlockByIndex(index);
      }
    }
  }

  /**
   * Updates size of rectangle
   */
  private updateRectangleSize(): void {
    const band = this.band();

    this.positionRectangle(band.left, band.top, band.right, band.bottom);
  }

  /**
   * Positions and sizes the overlay rectangle so it spans two client points.
   *
   * Coordinates are converted into the overlay container's own local space (its
   * top-left, measured live via getBoundingClientRect) rather than assumed to be
   * the viewport. The overlay is `position: fixed`, but `fixed` only resolves
   * against the viewport when no ancestor establishes a containing block — any
   * ancestor with a non-`none` transform/filter/perspective/contain/will-change/
   * backdrop-filter re-anchors the overlay to that ancestor's box. Measuring the
   * container's actual origin keeps the rectangle under the pointer in every case
   * (when nothing re-anchors it, the origin is 0,0 and this is a no-op).
   * @param ax - client x of the first corner
   * @param ay - client y of the first corner
   * @param bx - client x of the second corner
   * @param by - client y of the second corner
   */
  private positionRectangle(ax: number, ay: number, bx: number, by: number): void {
    if (this.overlayRectangle === null) {
      return;
    }

    const origin = this.getOverlayOrigin();
    const left = Math.min(ax, bx) - origin.left;
    const top = Math.min(ay, by) - origin.top;

    const { style } = this.overlayRectangle;

    style.left = `${left}px`;
    style.top = `${top}px`;
    style.width = `${Math.abs(bx - ax)}px`;
    style.height = `${Math.abs(by - ay)}px`;
  }

  /**
   * Returns the client-space top-left of the overlay rectangle's positioning
   * context (its container). All rectangle coordinates are expressed relative to
   * this origin so the rectangle is drawn under the pointer regardless of what
   * anchors the fixed overlay. See positionRectangle for the rationale.
   * @returns {{ left: number; top: number }} container origin in client coords
   */
  private getOverlayOrigin(): { left: number; top: number } {
    const container = this.overlayRectangle?.parentElement ?? null;

    if (!container) {
      return { left: 0, top: 0 };
    }

    const rect = container.getBoundingClientRect();

    return { left: rect.left, top: rect.top };
  }

  /**
   * Normalized vertical scroll value that does not rely on deprecated APIs.
   */
  private getScrollTop(): number {
    if (typeof window.scrollY === 'number') {
      return window.scrollY;
    }

    return document.documentElement?.scrollTop ?? document.body?.scrollTop ?? 0;
  }

  /**
   * Normalized horizontal scroll value that does not rely on deprecated APIs.
   */
  private getScrollLeft(): number {
    if (typeof window.scrollX === 'number') {
      return window.scrollX;
    }

    return document.documentElement?.scrollLeft ?? document.body?.scrollLeft ?? 0;
  }

  /**
   * Flat index of every block, for lookups within one pointer event.
   */
  private blockIndexes(): Map<Block, number> {
    const indexes = new Map<Block, number>();

    this.Blok.BlockManager.blocks.forEach((block, index) => indexes.set(block, index));

    return indexes;
  }

  /**
   * Swap each stacked block a peer convert replaced (same id, new Block
   * object) for its replacement. Removed blocks stay, so callers can see them.
   * @param indexes - flat index of every block
   */
  private followConvertedStackBlocks(indexes: Map<Block, number>): void {
    this.stackOfSelected = this.stackOfSelected.map((block) =>
      indexes.has(block) || this.deletedStackBlocks.has(block)
        ? block
        : this.Blok.BlockManager.getBlockById(block.id) ?? block
    );
  }

  /**
   * Stop following a lassoed block a remote peer deleted, matched by id, so
   * a later block with the same id is not taken for a convert of it.
   * @param block - the block being deleted
   */
  public forgetRemovedBlock(block: Block): void {
    for (const stacked of this.stackOfSelected) {
      if (stacked.id === block.id) {
        this.deletedStackBlocks.add(stacked);
      }
    }
  }

  /**
   * Current flat indexes of the stacked blocks, skipping any removed since.
   * @param indexes - flat index of every block
   */
  private stackIndices(indexes: Map<Block, number>): number[] {
    return this.stackOfSelected
      .map((block) => indexes.get(block))
      .filter((index): index is number => index !== undefined);
  }

  /**
   * Selects exactly the SELECTION UNITS the rubber band covers, dropping any
   * unit that another selected unit already represents.
   */
  private trySelectNextBlock(): void {
    const blocks = this.Blok.BlockManager.blocks;

    /**
     * The drawn rectangle IS the selection. Clamping it further to the holders
     * of the anchor and current blocks only ever shrinks it, and the anchor is
     * whatever sat under the pointer on the first THROTTLED mousemove — so a
     * fast drag used to drop every row above that block while the overlay still
     * covered them.
     */
    const band = this.band();
    const minY = band.top;
    const maxY = band.bottom;
    const rubberBandMinX = band.left;
    const rubberBandMaxX = band.right;

    const crossedIndices = new Set<number>();

    blocks.forEach((block, i) => {
      /**
       * Only SELECTION UNITS are lasso-selectable — the same blocks the ⠿
       * handle anchors to (see BlockRepository.isSelectionUnit, the model twin
       * of resolveHoveredBlockWrapper). Table cells and column layout
       * containers are not units; a toggle's, callout's or column's plain
       * children are.
       */
      if (!this.Blok.BlockManager.isSelectionUnit(block)) {
        return;
      }

      const blockRect = block.holder.getBoundingClientRect();
      const blockContentEl = block.holder.querySelector<HTMLElement>('[data-blok-element-content]');
      const blockContentRect = (blockContentEl ?? block.holder).getBoundingClientRect();
      const rowBounds = this.rowHitBounds(block);

      const hitLeft = rowBounds === null ? blockContentRect.left : Math.min(blockContentRect.left, rowBounds.left);
      const hitRight = rowBounds === null ? blockContentRect.right : Math.max(blockContentRect.right, rowBounds.right);

      const xOverlaps = rubberBandMinX === rubberBandMaxX || (hitRight > rubberBandMinX && hitLeft < rubberBandMaxX);

      // Include blocks that have visual height and overlap the selection range
      if (blockRect.height > 0 && blockRect.bottom > minY && blockRect.top < maxY && xOverlaps) {
        crossedIndices.add(i);
      }
    });

    const expectedIndices = this.dropRepresentedUnits(crossedIndices, minY, maxY);

    const indexes = this.blockIndexes();

    this.followConvertedStackBlocks(indexes);

    const previousStack = new Set(this.stackIndices(indexes));

    if (this.handBandToItems(expectedIndices, { left: rubberBandMinX, top: minY, right: rubberBandMaxX, bottom: maxY })) {
      previousStack.forEach((index) => this.Blok.BlockSelection.unSelectBlockByIndex(index));
      this.stackOfSelected = [];

      return;
    }

    // Deselect blocks no longer in range
    for (const prevIndex of previousStack) {
      if (!expectedIndices.has(prevIndex) && this.rectCrossesBlocks) {
        this.Blok.BlockSelection.unSelectBlockByIndex(prevIndex);
      }
    }

    // Select blocks newly in range
    for (const expectedIndex of expectedIndices) {
      if (!previousStack.has(expectedIndex) && this.rectCrossesBlocks) {
        this.Blok.BlockSelection.selectBlockByIndex(expectedIndex);
      }
    }

    // Replace stack with the visually selected blocks
    this.stackOfSelected = Array.from(expectedIndices)
      .sort((a, b) => a - b)
      .map((index) => blocks[index]);
  }

  /**
   * Offers the band to a block whose items take the lasso
   * ({@link DATA_ATTR.selectionOwner}), when it is the only block crossed and
   * the band reaches its item area. A taker that stops getting the band hears
   * `rect: null` once.
   * @param expectedIndices - the blocks the band would select
   * @param band - the band in client coordinates
   * @returns true when the tool took the band, so no block is selected
   */
  private handBandToItems(expectedIndices: Set<number>, band: LassoRect): boolean {
    const [index] = expectedIndices;
    const holder = expectedIndices.size === 1 ? this.Blok.BlockManager.blocks[index]?.holder : undefined;
    const area = holder === undefined
      ? undefined
      : Array.from(holder.querySelectorAll<HTMLElement>(createSelector(DATA_ATTR.selectionOwner)))
        .find((el) => el.closest(createSelector(DATA_ATTR.element)) === holder && this.bandReaches(el, band));
    const taken = area !== undefined && !area.dispatchEvent(new CustomEvent<LassoDetail>(LASSO_EVENT, { cancelable: true, detail: { rect: band } }));

    if (this.lassoTaker !== null && (!taken || this.lassoTaker !== area)) {
      this.lassoTaker.dispatchEvent(new CustomEvent<LassoDetail>(LASSO_EVENT, { detail: { rect: null } }));
    }
    this.lassoTaker = taken ? area : null;

    return taken;
  }

  /**
   * Whether the band overlaps an element's box.
   * @param el - the element
   * @param band - the band in client coordinates
   */
  private bandReaches(el: HTMLElement, band: LassoRect): boolean {
    const rect = el.getBoundingClientRect();

    return rect.right > band.left && rect.left < band.right && rect.bottom > band.top && rect.top < band.bottom;
  }

  /**
   * Horizontal bounds of the ROW a block occupies, which is wider than the
   * block's own content column: the redactor's gutter (the
   * --blok-editor-gutter-* padding housing the floating +/⠿ controls) belongs
   * to the row beside it, exactly as `rectCrossesBlocks` already assumes. A
   * nested row's content starts further right than its container's, so
   * measuring only the content box left every nested row unreachable from the
   * gutter and the lasso matched the container instead.
   *
   * The row stops early inside a tool-owned layout: a column does NOT own the
   * space beside it, so blocks in the left column stay distinguishable from
   * those in the right one.
   * @param block - the block whose row to measure
   */
  private rowHitBounds(block: Block): { left: number; right: number } | null {
    const parent = block.parentId === null ? undefined : this.Blok.BlockManager.getBlockById(block.parentId);

    if (parent !== undefined && parent.tool.ownsChildren) {
      return block.holder.getBoundingClientRect();
    }

    if (parent !== undefined) {
      return this.rowHitBounds(parent);
    }

    const redactor = this.Blok.UI.nodes.redactor;

    /**
     * Only the redactor's OWN box may widen a row — the page margin outside the
     * editor must never select. With no redactor to measure, the content column
     * is the row.
     */
    return redactor ? redactor.getBoundingClientRect() : null;
  }

  /**
   * A container's holder spans its whole subtree, so a band reaching any child
   * crosses the container too. Selecting both means "Duplicate" duplicates the
   * container AND its children again, so exactly one of them must survive:
   *
   * - the band crosses the container's OWN line → the container represents its
   *   whole subtree, drop the descendants;
   * - the band only reaches rows the container merely hosts → the child on that
   *   line owns the row, drop the container.
   *
   * Resolved outermost-first so a chain (toggle → callout → paragraph) collapses
   * to the shallowest container whose own line the band actually touches.
   * @param crossedIndices - indices of selection units the band intersects
   * @param minY - top of the effective band, in client coordinates
   * @param maxY - bottom of the effective band, in client coordinates
   */
  private dropRepresentedUnits(crossedIndices: Set<number>, minY: number, maxY: number): Set<number> {
    const blocks = this.Blok.BlockManager.blocks;
    const survivors = new Set(crossedIndices);

    const outermostFirst = Array.from(crossedIndices)
      .sort((a, b) => this.Blok.BlockManager.getBlockDepth(blocks[a]) - this.Blok.BlockManager.getBlockDepth(blocks[b]));

    for (const index of outermostFirst) {
      if (!survivors.has(index)) {
        continue;
      }

      const container = blocks[index];
      const represented = Array.from(survivors)
        .filter((candidate) => candidate !== index && this.isDescendantOf(blocks[candidate], container));

      if (represented.length === 0) {
        continue;
      }

      const ownLine = this.ownLineBounds(container);

      if (ownLine.bottom > minY && ownLine.top < maxY) {
        represented.forEach((candidate) => survivors.delete(candidate));
      } else {
        survivors.delete(index);
      }
    }

    return survivors;
  }

  /**
   * Vertical bounds of the rows a block renders ITSELF, i.e. its holder minus
   * the slot its child blocks are mounted into. A toggle heading's own line is
   * its title; a callout's own line IS its first child (the callout's text —
   * same rule resolveHoveredBlockWrapper applies via [data-blok-child-toolbar]);
   * a table's cell slots are its own machinery, so its whole holder counts.
   * @param block - the container block to measure
   */
  private ownLineBounds(block: Block): { top: number; bottom: number } {
    const holderRect = block.holder.getBoundingClientRect();
    const ownSlot = this.ownChildrenSlot(block);

    if (ownSlot === null) {
      return { top: holderRect.top, bottom: holderRect.bottom };
    }

    if (ownSlot.matches(CHILD_TOOLBAR_SELECTOR)) {
      const firstChild = ownSlot.querySelector<HTMLElement>(`:scope > ${createSelector(DATA_ATTR.element)}`);
      const firstChildRect = firstChild?.getBoundingClientRect();

      if (firstChildRect !== undefined && firstChildRect.height > 0) {
        return { top: firstChildRect.top, bottom: firstChildRect.bottom };
      }
    }

    const slotRect = ownSlot.getBoundingClientRect();

    if (slotRect.height <= 0) {
      return { top: holderRect.top, bottom: holderRect.bottom };
    }

    return { top: holderRect.top, bottom: Math.max(holderRect.top, slotRect.top) };
  }

  /**
   * The nested-blocks slot this block mounts its OWN children into — not a
   * table cell's (cells are the table's machinery) and not a descendant
   * block's.
   * @param block - the container block
   */
  private ownChildrenSlot(block: Block): HTMLElement | null {
    const slots = block.holder.querySelectorAll<HTMLElement>(createSelector(DATA_ATTR.nestedBlocks));

    for (const slot of slots) {
      if (slot.matches(CELL_BLOCKS_SELECTOR)) {
        continue;
      }

      if (slot.closest(createSelector(DATA_ATTR.element)) === block.holder) {
        return slot;
      }
    }

    return null;
  }

  /**
   * Whether `block` sits anywhere below `ancestor` in the parentId tree.
   * @param block - the candidate descendant
   * @param ancestor - the candidate ancestor
   * @param seen - ids already walked, guarding a malformed parent cycle
   */
  private isDescendantOf(block: Block, ancestor: Block, seen: Set<string> = new Set<string>()): boolean {
    if (block.parentId === null || seen.has(block.id)) {
      return false;
    }

    if (block.parentId === ancestor.id) {
      return true;
    }

    seen.add(block.id);

    const parent = this.Blok.BlockManager.getBlockById(block.parentId);

    return parent === undefined ? false : this.isDescendantOf(parent, ancestor, seen);
  }
}

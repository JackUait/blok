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

import { CELL_BLOCKS_SELECTOR, CHILD_TOOLBAR_SELECTOR } from './uiControllers/hovered-block-resolution';

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
   *  Speed of Scrolling
   */
  private readonly SCROLL_SPEED: number = 3;

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
   *  Coords of rect
   */
  private startX = 0;
  private startY = 0;
  private mouseX = 0;
  private mouseY = 0;

  /**
   * Selected blocks
   */
  private stackOfSelected: number[] = [];

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

    if (!elemWhereSelectionStart) {
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
    this.startX = pageX;
    this.startY = pageY;
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
    this.stackOfSelected = [];
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

    this.listeners.on(document.body, 'mouseleave', () => {
      this.processMouseLeave();
    });

    const throttledScroll = throttle((event: unknown) => {
      this.processScroll(event as MouseEvent);

    }, 10) as EventListener;

    this.listeners.on(window, 'scroll', throttledScroll, {
      passive: true,
    });

    this.listeners.on(document, 'mouseup', () => {
      this.processMouseUp();
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
    this.scrollByZones(mouseEvent.clientY);
  }

  /**
   * Handle mouse leave
   */
  private processMouseLeave(): void {
    this.clearSelection();
    this.endSelection();
  }

  /**
   * @param {MouseEvent} mouseEvent - mouse event payload
   */
  private processScroll(mouseEvent: MouseEvent): void {
    this.changingRectangle(mouseEvent);
  }

  /**
   * Handle mouse up
   */
  private processMouseUp(): void {
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
    this.inScrollZone = null;
    if (clientY <= this.HEIGHT_OF_SCROLL_ZONE) {
      this.inScrollZone = this.TOP_SCROLL_ZONE;
    }
    if (document.documentElement.clientHeight - clientY <= this.HEIGHT_OF_SCROLL_ZONE) {
      this.inScrollZone = this.BOTTOM_SCROLL_ZONE;
    }

    if (!this.inScrollZone) {
      this.isScrolling = false;

      return;
    }

    if (!this.isScrolling) {
      this.scrollVertical(this.inScrollZone === this.TOP_SCROLL_ZONE ? -this.SCROLL_SPEED : this.SCROLL_SPEED);
      this.isScrolling = true;
    }
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
   * Activates scrolling if blockSelection is active and mouse is in scroll zone
   * @param {number} speed - speed of scrolling
   */
  private scrollVertical(speed: number): void {
    if (!(this.inScrollZone && this.mousedown)) {
      return;
    }
    const lastOffset = this.getScrollTop();

    window.scrollBy(0, speed);
    this.mouseY += this.getScrollTop() - lastOffset;
    setTimeout(() => {
      this.scrollVertical(speed);
    }, 0);
  }

  /**
   * Handles the change in the rectangle and its effect
   * @param {MouseEvent} event - mouse event
   */
  private changingRectangle(event: MouseEvent): void {
    if (!this.mousedown) {
      return;
    }

    const overlayRectangle = this.overlayRectangle;

    if (overlayRectangle === null) {
      return;
    }

    if (event.pageY !== undefined) {
      this.mouseX = event.pageX;
      this.mouseY = event.pageY;
    }

    if (!this.isRectSelectionActivated) {
      this.isRectSelectionActivated = true;
      this.shrinkRectangleToPoint();
      overlayRectangle.style.display = 'block';
    }

    const { index } = this.genInfoForMouseSelection();

    /**
     * Check if the selection rectangle intersects the block holder horizontally.
     * For page-wide selection, we need to verify the rectangle actually reaches the block,
     * not just that the mouse Y position is at the same height as a block.
     */
    this.rectCrossesBlocks = false;
    const block = index !== undefined ? this.Blok.BlockManager.getBlockByIndex(index) : undefined;
    const rootBlock = block !== undefined
      ? this.Blok.BlockManager.resolveToSelectableBlock(block)
      : undefined;

    if (rootBlock) {
      const holderRect = rootBlock.holder.getBoundingClientRect();
      const redactorRect = this.Blok.UI.nodes.redactor.getBoundingClientRect();
      const scrollLeft = this.getScrollLeft();

      // Selection rectangle horizontal bounds (in page coordinates)
      const rectLeft = Math.min(this.startX, this.mouseX);
      const rectRight = Math.max(this.startX, this.mouseX);

      /**
       * Block holder horizontal bounds (converted from viewport to page
       * coordinates), extended to the redactor's own box. The redactor's
       * gutter (--blok-editor-gutter-start/-end padding that houses the
       * floating +/⠿ controls) belongs to the block's row: a lasso drawn
       * inside the gutter must select the rows it spans, exactly like it
       * did when block holders reached the editor edge themselves. True
       * page margins OUTSIDE the editor stay non-selecting.
       */
      const holderLeft = Math.min(holderRect.left, redactorRect.left) + scrollLeft;
      const holderRight = Math.max(holderRect.right, redactorRect.right) + scrollLeft;

      // Check for horizontal intersection
      this.rectCrossesBlocks = rectRight >= holderLeft && rectLeft <= holderRight;
    }

    this.updateRectangleSize();

    /**
     * Hide Block Settings Toggler (along with the Toolbar) (if showed) when the Rectangle Selection is activated
     */
    this.Blok.Toolbar.close();

    if (index === undefined) {
      return;
    }

    this.trySelectNextBlock();
    // For case, when rect is out from blocks
    this.inverseSelection();

    const selection = SelectionUtils.get();

    if (selection) {
      selection.removeAllRanges();
    }
  }

  /**
   * Shrink rect to singular point
   */
  private shrinkRectangleToPoint(): void {
    this.positionRectangle(this.startX, this.startY, this.startX, this.startY);
  }

  /**
   * Select or unselect all of blocks in array if rect is out or in selectable area
   */
  private inverseSelection(): void {
    if (this.stackOfSelected.length === 0) {
      return;
    }

    const firstBlockInStack = this.Blok.BlockManager.getBlockByIndex(this.stackOfSelected[0]);

    if (!firstBlockInStack) {
      return;
    }

    const isSelectedMode = firstBlockInStack.selected;

    if (this.rectCrossesBlocks && !isSelectedMode) {
      for (const it of this.stackOfSelected) {
        this.Blok.BlockSelection.selectBlockByIndex(it);
      }
    }

    if (!this.rectCrossesBlocks && isSelectedMode) {
      for (const it of this.stackOfSelected) {
        this.Blok.BlockSelection.unSelectBlockByIndex(it);
      }
    }
  }

  /**
   * Updates size of rectangle
   */
  private updateRectangleSize(): void {
    this.positionRectangle(this.startX, this.startY, this.mouseX, this.mouseY);
  }

  /**
   * Positions and sizes the overlay rectangle so it spans two page-space points.
   *
   * Coordinates are converted into the overlay container's own local space (its
   * top-left, measured live via getBoundingClientRect) rather than assumed to be
   * the viewport. The overlay is `position: fixed`, but `fixed` only resolves
   * against the viewport when no ancestor establishes a containing block — any
   * ancestor with a non-`none` transform/filter/perspective/contain/will-change/
   * backdrop-filter re-anchors the overlay to that ancestor's box. Measuring the
   * container's actual origin keeps the rectangle under the pointer in every case
   * (when nothing re-anchors it, the origin is 0,0 and this is a no-op).
   * @param {number} pageAX - X page-coordinate of the first corner
   * @param {number} pageAY - Y page-coordinate of the first corner
   * @param {number} pageBX - X page-coordinate of the second corner
   * @param {number} pageBY - Y page-coordinate of the second corner
   */
  private positionRectangle(pageAX: number, pageAY: number, pageBX: number, pageBY: number): void {
    if (this.overlayRectangle === null) {
      return;
    }

    const scrollLeft = this.getScrollLeft();
    const scrollTop = this.getScrollTop();
    const origin = this.getOverlayOrigin();

    const ax = pageAX - scrollLeft - origin.left;
    const ay = pageAY - scrollTop - origin.top;
    const bx = pageBX - scrollLeft - origin.left;
    const by = pageBY - scrollTop - origin.top;

    const { style } = this.overlayRectangle;

    style.left = `${Math.min(ax, bx)}px`;
    style.top = `${Math.min(ay, by)}px`;
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
   * Collects information needed to determine the behavior of the rectangle
   * For page-wide selection, we check blocks at the redactor's center X position but at the actual mouse Y position
   * @returns {object} index - index of the Block at the current mouse Y position
   */
  private genInfoForMouseSelection(): {index: number | undefined} {
    const { UI } = this.Blok;
    const redactor = UI.nodes.redactor;
    const redactorRect = redactor.getBoundingClientRect();
    const centerOfRedactor = redactorRect.left + redactorRect.width / 2;
    const scrollTop = this.getScrollTop();
    const y = this.mouseY - scrollTop;

    // For page-wide selection: check what block is at the center X, but at the mouse's Y position
    // This allows selection to work even when mouse is in the left/right margins
    const elementUnderMouse = document.elementFromPoint(centerOfRedactor, y);

    if (!elementUnderMouse) {
      return {
        index: undefined,
      };
    }
    const blockInCurrentPos = this.Blok.BlockManager.getBlockByChildNode(elementUnderMouse);

    const index = blockInCurrentPos !== undefined
      ? this.Blok.BlockManager.blocks.indexOf(blockInCurrentPos)
      : undefined;

    return {
      index,
    };
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
   * Select block with index index
   * @param index - index of block in redactor
   */
  private addBlockInSelection(index: number): void {
    if (this.rectCrossesBlocks) {
      this.Blok.BlockSelection.selectBlockByIndex(index);
    }
    this.stackOfSelected.push(index);
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
    const scrollTop = this.getScrollTop();
    const minY = Math.min(this.startY, this.mouseY) - scrollTop;
    const maxY = Math.max(this.startY, this.mouseY) - scrollTop;

    const scrollLeft = this.getScrollLeft();
    const rubberBandMinX = Math.min(this.startX, this.mouseX) - scrollLeft;
    const rubberBandMaxX = Math.max(this.startX, this.mouseX) - scrollLeft;

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

    const previousStack = new Set(this.stackOfSelected);

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

    // Replace stack with the visually selected indices
    this.stackOfSelected = Array.from(expectedIndices).sort((a, b) => a - b);
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

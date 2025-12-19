/**
 * @class RectangleSelection
 * @classdesc Manages Block selection with mouse
 * @module RectangleSelection
 * @version 1.0.0
 */
import { Module } from '../__module';
import { Dom as $ } from '../dom';

import { SelectionUtils } from '../selection';
import { throttle } from '../utils';
import {
  INLINE_TOOLBAR_INTERFACE_SELECTOR,
  DATA_ATTR,
  createSelector,
} from '../constants';

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
   */
  public startSelection(pageX: number, pageY: number): void {
    const scrollLeft = this.getScrollLeft();
    const scrollTop = this.getScrollTop();
    const elemWhereSelectionStart = document.elementFromPoint(pageX - scrollLeft, pageY - scrollTop);

    if (!elemWhereSelectionStart) {
      return;
    }

    /**
     * Don't clear selected block by clicks on the Block settings
     * because we need to keep highlighting working block
     */
    const startsInsideToolbar = elemWhereSelectionStart.closest(createSelector(DATA_ATTR.toolbar));

    if (!startsInsideToolbar) {
      this.Blok.BlockSelection.allBlocksSelected = false;
      this.clearSelection();
      this.stackOfSelected = [];
    }

    const selectorsToAvoid = [
      createSelector(DATA_ATTR.elementContent),
      createSelector(DATA_ATTR.toolbar),
      INLINE_TOOLBAR_INTERFACE_SELECTOR,
    ];

    const startsInsideBlok = elemWhereSelectionStart.closest(createSelector(DATA_ATTR.editor));
    const startsInSelectorToAvoid = selectorsToAvoid.some((selector) => !!elemWhereSelectionStart.closest(selector));

    /**
     * If selection starts outside of the blok or inside the blocks or on Blok UI elements, do not handle it
     */
    if (!startsInsideBlok || startsInSelectorToAvoid) {
      return;
    }

    /**
     * Hide the toolbar immediately so it does not obstruct drag selection.
     */
    this.Blok.Toolbar.close();

    this.mousedown = true;
    this.startX = pageX;
    this.startY = pageY;
  }

  /**
   * Clear all params to end selection
   */
  public endSelection(): void {
    this.mousedown = false;
    this.startX = 0;
    this.startY = 0;
    if (this.overlayRectangle !== null) {
      this.overlayRectangle.style.display = 'none';
    }
  }

  /**
   * is RectSelection Activated
   */
  public isRectActivated(): boolean {
    return this.isRectSelectionActivated;
  }

  /**
   * Mark that selection is end
   */
  public clearSelection(): void {
    this.isRectSelectionActivated = false;
  }

  /**
   * Sets Module necessary event handlers
   */
  private enableModuleBindings(): void {
    const { container } = this.genHTML();

    this.listeners.on(container, 'mousedown', (event: Event) => {
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

    this.listeners.on(document.body, 'mouseup', () => {
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
      this.startSelection(mouseEvent.pageX, mouseEvent.pageY);
    }
  }

  /**
   * Handle mouse move events
   * @param {MouseEvent} mouseEvent - mouse event payload
   */
  private processMouseMove(mouseEvent: MouseEvent): void {
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
      this.Blok.Toolbar.moveAndOpenForMultipleBlocks();
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

    const { rightPos, leftPos, index } = this.genInfoForMouseSelection();
    // There is not new block in selection

    const rectIsOnRighSideOfredactor = this.startX > rightPos && this.mouseX > rightPos;
    const rectISOnLeftSideOfRedactor = this.startX < leftPos && this.mouseX < leftPos;

    this.rectCrossesBlocks = !(rectIsOnRighSideOfredactor || rectISOnLeftSideOfRedactor);

    if (!this.isRectSelectionActivated) {
      this.rectCrossesBlocks = false;
      this.isRectSelectionActivated = true;
      this.shrinkRectangleToPoint();
      overlayRectangle.style.display = 'block';
    }

    this.updateRectangleSize();

    /**
     * Hide Block Settings Toggler (along with the Toolbar) (if showed) when the Rectangle Selection is activated
     */
    this.Blok.Toolbar.close();

    if (index === undefined) {
      return;
    }

    this.trySelectNextBlock(index);
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
    if (this.overlayRectangle === null) {
      return;
    }

    const scrollLeft = this.getScrollLeft();
    const scrollTop = this.getScrollTop();

    this.overlayRectangle.style.left = `${this.startX - scrollLeft}px`;
    this.overlayRectangle.style.top = `${this.startY - scrollTop}px`;
    this.overlayRectangle.style.bottom = `calc(100% - ${this.startY - scrollTop}px)`;
    this.overlayRectangle.style.right = `calc(100% - ${this.startX - scrollLeft}px)`;
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
    if (this.overlayRectangle === null) {
      return;
    }

    const scrollLeft = this.getScrollLeft();
    const scrollTop = this.getScrollTop();

    // Depending on the position of the mouse relative to the starting point,
    // change this.e distance from the desired edge of the screen*/
    if (this.mouseY >= this.startY) {
      this.overlayRectangle.style.top = `${this.startY - scrollTop}px`;
      this.overlayRectangle.style.bottom = `calc(100% - ${this.mouseY - scrollTop}px)`;
    } else {
      this.overlayRectangle.style.bottom = `calc(100% - ${this.startY - scrollTop}px)`;
      this.overlayRectangle.style.top = `${this.mouseY - scrollTop}px`;
    }

    if (this.mouseX >= this.startX) {
      this.overlayRectangle.style.left = `${this.startX - scrollLeft}px`;
      this.overlayRectangle.style.right = `calc(100% - ${this.mouseX - scrollLeft}px)`;
    } else {
      this.overlayRectangle.style.right = `calc(100% - ${this.startX - scrollLeft}px)`;
      this.overlayRectangle.style.left = `${this.mouseX - scrollLeft}px`;
    }
  }

  /**
   * Collects information needed to determine the behavior of the rectangle
   * @returns {object} index - index next Block, leftPos - start of left border of Block, rightPos - right border
   */
  private genInfoForMouseSelection(): {index: number | undefined; leftPos: number; rightPos: number} {
    const widthOfRedactor = document.body.offsetWidth;
    const centerOfRedactor = widthOfRedactor / 2;
    const scrollTop = this.getScrollTop();
    const y = this.mouseY - scrollTop;
    const elementUnderMouse = document.elementFromPoint(centerOfRedactor, y);
    const lastBlockHolder = this.Blok.BlockManager.lastBlock?.holder;
    const contentElement = lastBlockHolder?.querySelector(createSelector(DATA_ATTR.elementContent));
    const contentWidth = contentElement ? Number.parseInt(window.getComputedStyle(contentElement).width, 10) : 0;
    const centerOfBlock = contentWidth / 2;
    const leftPos = centerOfRedactor - centerOfBlock;
    const rightPos = centerOfRedactor + centerOfBlock;

    if (!elementUnderMouse) {
      return {
        index: undefined,
        leftPos,
        rightPos,
      };
    }
    const blockInCurrentPos = this.Blok.BlockManager.getBlockByChildNode(elementUnderMouse);

    const index = blockInCurrentPos !== undefined
      ? this.Blok.BlockManager.blocks.findIndex((block) => block.holder === blockInCurrentPos.holder)
      : undefined;

    return {
      index,
      leftPos,
      rightPos,
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
   * Adds a block to the selection and determines which blocks should be selected
   * @param {object} index - index of new block in the reactor
   */
  private trySelectNextBlock(index: number): void {
    const sizeStack = this.stackOfSelected.length;
    const lastSelected = this.stackOfSelected[sizeStack - 1];
    const sameBlock = lastSelected === index;

    if (sameBlock) {
      return;
    }

    const previousSelected = this.stackOfSelected[sizeStack - 2];
    const blockNumbersIncrease = previousSelected !== undefined && lastSelected !== undefined
      ? lastSelected - previousSelected > 0
      : false;
    const isInitialSelection = sizeStack <= 1;
    const selectionInDownDirection = lastSelected !== undefined && index > lastSelected && blockNumbersIncrease;
    const selectionInUpDirection = lastSelected !== undefined && index < lastSelected && sizeStack > 1 && !blockNumbersIncrease;
    const generalSelection = selectionInDownDirection || selectionInUpDirection || isInitialSelection;
    const reduction = !generalSelection;

    // When the selection is too fast, some blocks do not have time to be noticed. Fix it.
    if (!reduction && (lastSelected === undefined || index > lastSelected)) {
      const startIndex = lastSelected !== undefined ? lastSelected + 1 : index;

      Array.from({ length: index - startIndex + 1 }, (_unused, offset) => startIndex + offset)
        .forEach((ind) => {
          this.addBlockInSelection(ind);
        });

      return;
    }

    // for both directions
    if (!reduction && lastSelected !== undefined && index < lastSelected) {
      Array.from(
        { length: lastSelected - index },
        (_unused, offset) => lastSelected - 1 - offset
      ).forEach((ind) => {
        this.addBlockInSelection(ind);
      });

      return;
    }

    if (!reduction) {
      return;
    }

    const shouldRemove = (stackIndex: number): boolean => {
      if (lastSelected === undefined) {
        return false;
      }

      if (index > lastSelected) {
        return index > stackIndex;
      }

      return index < stackIndex;
    };

    const indicesToRemove: number[] = [];

    for (const stackIndex of [ ...this.stackOfSelected ].reverse()) {
      if (!shouldRemove(stackIndex)) {
        break;
      }

      if (this.rectCrossesBlocks) {
        this.Blok.BlockSelection.unSelectBlockByIndex(stackIndex);
      }
      indicesToRemove.push(stackIndex);
    }

    if (indicesToRemove.length > 0) {
      this.stackOfSelected.splice(this.stackOfSelected.length - indicesToRemove.length, indicesToRemove.length);
    }
  }
}

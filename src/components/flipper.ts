import { DomIterator } from './domIterator';
import * as _ from './utils';

/**
 * Flipper construction options
 * @interface FlipperOptions
 * @internal
 */
export interface FlipperOptions {
  /**
   * CSS-modifier for focused item
   */
  focusedItemClass?: string;

  /**
   * Allow handling keyboard events dispatched from contenteditable elements
   */
  handleContentEditableTargets?: boolean;

  /**
   * If flipping items are the same for all Block (for ex. Toolbox), ypu can pass it on constructing
   */
  items?: HTMLElement[];

  /**
   * Optional callback for button click
   */
  activateCallback?: (item: HTMLElement) => void;

  /**
   * List of keys allowed for handling.
   * Can include codes of the following keys:
   *  - Tab
   *  - Enter
   *  - Arrow up
   *  - Arrow down
   *  - Arrow right
   *  - Arrow left
   * If not specified all keys are enabled
   */
  allowedKeys?: number[];

  /**
   * Callback fired when ArrowLeft is pressed.
   * Used by nested popovers to close and return focus to parent.
   */
  onArrowLeft?: () => void;
}

/**
 * Flipper is a component that iterates passed items array by TAB or Arrows and clicks it by ENTER
 * @internal
 */
export class Flipper {
  /**
   * True if flipper is currently activated
   */
  public get isActivated(): boolean {
    return this.activated;
  }

  /**
   * Instance of flipper iterator
   */
  private readonly iterator: DomIterator | null = null;

  /**
   * Flag that defines activation status
   */
  private activated = false;

  /**
   * Skip moving focus on the next Tab press when initial focus was pre-set
   */
  private skipNextTabFocus = false;

  /**
   * True if flipper should handle events coming from contenteditable elements
   */
  private handleContentEditableTargets: boolean;

  /**
   * List codes of the keys allowed for handling
   */
  private readonly allowedKeys: number[];

  /**
   * Call back for button click/enter
   */
  private readonly activateCallback?: (item: HTMLElement) => void;

  /**
   * Contains list of callbacks to be executed on each flip
   */
  private flipCallbacks: Array<() => void> = [];

  /**
   * Callback fired when ArrowLeft is pressed.
   * Used by nested popovers to close and return focus to parent.
   */
  private readonly onArrowLeftCallback?: () => void;

  /**
   * @param options - different constructing settings
   */
  constructor(options: FlipperOptions) {
    this.iterator = new DomIterator(options.items || [], options.focusedItemClass ?? '');
    this.activateCallback = options.activateCallback;
    this.allowedKeys = options.allowedKeys || Flipper.usedKeys;
    this.handleContentEditableTargets = options.handleContentEditableTargets ?? false;
    this.onArrowLeftCallback = options.onArrowLeft;
  }

  /**
   * Array of keys (codes) that is handled by Flipper
   * Used to:
   *  - preventDefault only for this keys, not all keydowns (@see constructor)
   *  - to skip external behaviours only for these keys, when filler is activated (@see BlockEvents@arrowRightAndDown)
   */
  public static get usedKeys(): number[] {
    return [
      _.keyCodes.TAB,
      _.keyCodes.LEFT,
      _.keyCodes.RIGHT,
      _.keyCodes.ENTER,
      _.keyCodes.UP,
      _.keyCodes.DOWN,
    ];
  }

  /**
   * Active tab/arrows handling by flipper
   * @param items - Some modules (like, InlineToolbar, BlockSettings) might refresh buttons dynamically
   * @param cursorPosition - index of the item that should be focused once flipper is activated
   */
  public activate(items?: HTMLElement[], cursorPosition?: number): void {
    this.activated = true;
    if (items) {
      this.iterator?.setItems(items);
    }

    if (cursorPosition !== undefined) {
      this.iterator?.setCursor(cursorPosition);
    }

    /**
     * Listening all keydowns on document and react on TAB/Enter press
     * TAB will leaf iterator items
     * ENTER will click the focused item
     *
     * Note: the event should be handled in capturing mode on following reasons:
     * - prevents plugins inner keydown handlers from being called while keyboard navigation
     * - otherwise this handler will be called at the moment it is attached which causes false flipper firing (see https://techread.me/js-addeventlistener-fires-for-past-events/)
     */
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  /**
   * Disable tab/arrows handling by flipper
   */
  public deactivate(): void {
    this.activated = false;
    this.dropCursor();
    this.skipNextTabFocus = false;

    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  /**
   * Focus first item
   */
  public focusFirst(): void {
    this.dropCursor();
    this.flipRight();
  }

  /**
   * Focus item at specified position without triggering flip callbacks
   * @param position - index of item to focus. Negative value clears focus.
   * @param options - optional settings for focus behavior
   * @param options.skipNextTab - if true, skip the next Tab press (default: true for position 0 when no current item)
   */
  public focusItem(position: number, options?: { skipNextTab?: boolean }): void {
    const iterator = this.iterator;

    if (!iterator) {
      return;
    }

    if (!iterator.hasItems()) {
      return;
    }

    if (position < 0) {
      iterator.dropCursor();

      return;
    }

    const shouldSkipNextTab = options?.skipNextTab ?? (!iterator.currentItem && position === 0);

    if (shouldSkipNextTab) {
      this.skipNextTabFocus = true;
    }

    iterator.setCursor(position);
  }

  /**
   * Focuses previous flipper iterator item
   */
  public flipLeft(): void {
    this.iterator?.previous();
    this.flipCallback();
  }

  /**
   * Focuses next flipper iterator item
   */
  public flipRight(): void {
    this.iterator?.next();
    this.flipCallback();
  }

  /**
   * Return true if some button is focused
   */
  public hasFocus(): boolean {
    return !!this.iterator?.currentItem;
  }

  /**
   * Checks if current focused item has children (nested menu)
   * Looks for data-blok-has-children attribute on the current item
   */
  private currentItemHasChildren(): boolean {
    const currentItem = this.iterator?.currentItem;

    if (!currentItem) {
      return false;
    }

    return currentItem.hasAttribute('data-blok-has-children');
  }

  /**
   * Registers a function that should be executed on each navigation action
   * @param cb - function to execute
   */
  public onFlip(cb: () => void): void {
    this.flipCallbacks.push(cb);
  }

  /**
   * Unregisters a function that is executed on each navigation action
   * @param cb - function to stop executing
   */
  public removeOnFlip(cb: () => void): void {
    this.flipCallbacks = this.flipCallbacks.filter(fn => fn !== cb);
  }

  /**
   * Drops flipper's iterator cursor
   * @see DomIterator#dropCursor
   */
  private dropCursor(): void {
    this.iterator?.dropCursor();
  }

  /**
   * Get numeric keyCode from KeyboardEvent.key for backward compatibility
   * @param event - keyboard event
   * @returns numeric keyCode or null if not recognized
   */
  private getKeyCode(event: KeyboardEvent): number | null {
    const keyToCodeMap: Record<string, number> = {
      'Tab': _.keyCodes.TAB,
      'Enter': _.keyCodes.ENTER,
      'ArrowLeft': _.keyCodes.LEFT,
      'ArrowRight': _.keyCodes.RIGHT,
      'ArrowUp': _.keyCodes.UP,
      'ArrowDown': _.keyCodes.DOWN,
    };

    return keyToCodeMap[event.key] ?? null;
  }

  /**
   * KeyDown event handler
   * @param event - keydown event
   */
  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;

    if (this.shouldSkipTarget(target, event)) {
      return;
    }

    const keyCode = this.getKeyCode(event);
    const isDirectionalArrow = keyCode === _.keyCodes.LEFT
      || keyCode === _.keyCodes.RIGHT
      || keyCode === _.keyCodes.UP
      || keyCode === _.keyCodes.DOWN;

    /**
     * Allow selecting text with Shift combined with arrow keys by delegating handling to the browser.
     * Other Shift-based combinations (for example Shift+Tab) are still handled by Flipper.
     */
    if (event.shiftKey && isDirectionalArrow) {
      return;
    }

    const isReady = this.isEventReadyForHandling(event);

    if (!isReady) {
      return;
    }

    /**
     * For Enter key, only handle it if there's a focused item.
     * Otherwise, let the event propagate to allow block splitting etc.
     */
    if (keyCode === _.keyCodes.ENTER && !this.iterator?.currentItem) {
      return;
    }

    /**
     * Stop propagation to prevent plugin-level handlers from being called
     * while Flipper manages keyboard navigation.
     */
    event.stopPropagation();
    event.stopImmediatePropagation();


    /**
     * Prevent only used keys default behaviour
     * (allows to navigate by ARROW DOWN, for example)
     */
    if (keyCode !== null && Flipper.usedKeys.includes(keyCode)) {
      event.preventDefault();
    }

    switch (keyCode) {
      case _.keyCodes.TAB:
        this.handleTabPress(event);
        break;
      case _.keyCodes.LEFT:
        // ArrowLeft triggers callback only if callback is set (for nested popovers)
        if (this.onArrowLeftCallback) {
          this.onArrowLeftCallback();
        }
        break;
      case _.keyCodes.UP:
        this.flipLeft();
        break;
      case _.keyCodes.RIGHT:
        // ArrowRight clicks the focused item to open nested popover, but only if item has children
        // Otherwise, do nothing (don't activate items without nested menu)
        if (this.iterator?.currentItem && this.currentItemHasChildren()) {
          this.handleEnterPress(event);
        }
        break;
      case _.keyCodes.DOWN:
        this.flipRight();
        break;
      case _.keyCodes.ENTER:
        this.handleEnterPress(event);
        break;
    }
  };

  /**
   * This function is fired before handling flipper keycodes
   * The result of this function defines if it is need to be handled or not
   * @param {KeyboardEvent} event - keydown keyboard event
   * @returns {boolean}
   */
  private isEventReadyForHandling(event: KeyboardEvent): boolean {
    const keyCode = this.getKeyCode(event);

    return this.activated && keyCode !== null && this.allowedKeys.includes(keyCode);
  }

  /**
   * Enables or disables handling events dispatched from contenteditable elements
   * @param value - true if events from contenteditable elements should be handled
   */
  public setHandleContentEditableTargets(value: boolean): void {
    this.handleContentEditableTargets = value;
  }

  /**
   * When flipper is activated tab press will leaf the items
   * @param {KeyboardEvent} event - tab keydown event
   */
  private handleTabPress(event: KeyboardEvent): void {
    /** this property defines leaf direction */
    const shiftKey = event.shiftKey;
    const direction = shiftKey ? DomIterator.directions.LEFT : DomIterator.directions.RIGHT;

    if (this.skipNextTabFocus) {
      this.skipNextTabFocus = false;

      return;
    }

    switch (direction) {
      case DomIterator.directions.RIGHT:
        this.flipRight();
        break;
      case DomIterator.directions.LEFT:
        this.flipLeft();
        break;
    }
  }

  /**
   * Delegates external keyboard events to the flipper handler.
   * @param event - keydown event captured outside the flipper
   */
  public handleExternalKeydown(event: KeyboardEvent): void {
    this.onKeyDown(event);
  }

  /**
   * Enter press will click current item if flipper is activated
   * @param {KeyboardEvent} event - enter keydown event
   */
  private handleEnterPress(event: KeyboardEvent): void {
    if (!this.activated) {
      return;
    }

    if (this.iterator?.currentItem) {
      /**
       * Stop Enter propagation only if flipper is ready to select focused item
       */
      event.stopPropagation();
      event.preventDefault();
      this.iterator.currentItem.click();
    }

    if (_.isFunction(this.activateCallback) && this.iterator?.currentItem) {
      this.activateCallback(this.iterator.currentItem);
    }
  }

  /**
   * Fired after flipping in any direction
   */
  private flipCallback(): void {
    if (this.iterator?.currentItem) {
      this.iterator.currentItem.scrollIntoViewIfNeeded?.();
    }

    this.flipCallbacks.forEach(cb => cb());
  }

  /**
   * Determine if keyboard events coming from a target should be skipped
   * @param target - event target element
   * @param event - keyboard event being handled
   */
  private shouldSkipTarget(target: HTMLElement | null, event: KeyboardEvent): boolean {
    if (!target) {
      return false;
    }

    const isNativeInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const isNavigationKey = event.key === 'Tab' || event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter' || event.key === 'ArrowRight' || event.key === 'ArrowLeft';
    const shouldHandleNativeInput = target.getAttribute('data-blok-flipper-navigation-target') === 'true' && isNavigationKey;
    const isContentEditable = target.isContentEditable;
    const isInlineToolInput = target.closest('[data-blok-link-tool-input-opened="true"]') !== null;

    const shouldSkipContentEditable = isContentEditable && !this.handleContentEditableTargets;

    return (isNativeInput && !shouldHandleNativeInput) || shouldSkipContentEditable || isInlineToolInput;
  }
}

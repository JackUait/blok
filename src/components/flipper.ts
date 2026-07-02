import { DATA_ATTR } from './constants';
import { DomIterator } from './domIterator';
import { isFunction, keyCodes } from './utils';

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

  /**
   * Optional host element that receives aria-activedescendant so the virtual
   * focus is perceivable to screen readers without moving real DOM focus.
   */
  activeDescendantHost?: HTMLElement;

  /**
   * When enabled, printable single-character keydowns accumulate into a short
   * buffer and focus moves to the first item whose accessible label matches.
   */
  typeAhead?: boolean;
}

/**
 * Flipper is a component that iterates passed items array by TAB or Arrows and clicks it by ENTER
 * @internal
 */
export class Flipper {
  /**
   * Time window (ms) during which consecutive printable keystrokes accumulate
   * into a single typeahead buffer before it resets.
   */
  private static readonly TYPEAHEAD_TIMEOUT = 500;

  /**
   * Attribute holding an item's accessible label used for typeahead matching.
   * Falls back to the item's textContent when absent.
   */
  private static readonly LABEL_ATTR = 'data-blok-flipper-label';

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
   * True when opt-in typeahead navigation is enabled
   */
  private readonly typeAhead: boolean;

  /**
   * Accumulated printable characters for the current typeahead window
   */
  private typeAheadBuffer = '';

  /**
   * Timer that resets the typeahead buffer once the window elapses
   */
  private typeAheadTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param options - different constructing settings
   */
  constructor(options: FlipperOptions) {
    this.iterator = new DomIterator(options.items || [], options.focusedItemClass ?? '', options.activeDescendantHost ?? null);
    this.activateCallback = options.activateCallback;
    this.allowedKeys = options.allowedKeys || Flipper.usedKeys;
    this.handleContentEditableTargets = options.handleContentEditableTargets ?? false;
    this.onArrowLeftCallback = options.onArrowLeft;
    this.typeAhead = options.typeAhead ?? false;
  }

  /**
   * Array of keys (codes) that is handled by Flipper
   * Used to:
   *  - preventDefault only for this keys, not all keydowns (@see constructor)
   *  - to skip external behaviours only for these keys, when filler is activated (@see BlockEvents@arrowRightAndDown)
   */
  public static get usedKeys(): number[] {
    return [
      keyCodes.TAB,
      keyCodes.LEFT,
      keyCodes.RIGHT,
      keyCodes.ENTER,
      keyCodes.UP,
      keyCodes.DOWN,
      keyCodes.HOME,
      keyCodes.END,
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
   * Sets (or clears) the aria-activedescendant host element
   * @param host - element that should receive aria-activedescendant, or null to disable
   */
  public setActiveDescendantHost(host: HTMLElement | null): void {
    this.iterator?.setActiveDescendantHost(host);
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
   * Focuses the first (non-disabled) flipper iterator item (Home key)
   */
  public flipToFirst(): void {
    this.iterator?.setCursorToFirst();
    this.flipCallback();
  }

  /**
   * Focuses the last (non-disabled) flipper iterator item (End key)
   */
  public flipToLast(): void {
    this.iterator?.setCursorToLast();
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
      'Tab': keyCodes.TAB,
      'Enter': keyCodes.ENTER,
      'ArrowLeft': keyCodes.LEFT,
      'ArrowRight': keyCodes.RIGHT,
      'ArrowUp': keyCodes.UP,
      'ArrowDown': keyCodes.DOWN,
      'Home': keyCodes.HOME,
      'End': keyCodes.END,
    };

    return keyToCodeMap[event.key] ?? null;
  }

  /**
   * KeyDown event handler
   * @param event - keydown event
   */
  private onKeyDown = (event: KeyboardEvent): void => {
    /**
     * Another handler (e.g. the inline toolbar's window-capture keydown
     * listener) has already consumed this event. Since Flipper listens on both
     * document and window in capture mode, stopPropagation() from a same-node
     * listener does not shield us — honor preventDefault() to avoid processing
     * the same keystroke twice.
     */
    if (event.defaultPrevented) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (this.shouldSkipTarget(target, event)) {
      return;
    }

    const keyCode = this.getKeyCode(event);
    const isDirectionalArrow = keyCode === keyCodes.LEFT
      || keyCode === keyCodes.RIGHT
      || keyCode === keyCodes.UP
      || keyCode === keyCodes.DOWN;

    /**
     * Allow selecting text with Shift combined with arrow keys by delegating handling to the browser.
     * Other Shift-based combinations (for example Shift+Tab) are still handled by Flipper.
     */
    if (event.shiftKey && isDirectionalArrow) {
      return;
    }

    /**
     * Opt-in typeahead: printable single-character keys (that are not Flipper
     * navigation keys) move focus to the first matching item.
     */
    if (this.typeAhead && this.handleTypeAhead(event)) {
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
    if (keyCode === keyCodes.ENTER && !this.iterator?.currentItem) {
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
      case keyCodes.TAB:
        this.handleTabPress(event);
        break;
      case keyCodes.LEFT:
        // ArrowLeft triggers callback only if callback is set (for nested popovers)
        if (this.onArrowLeftCallback) {
          this.onArrowLeftCallback();
        }
        break;
      case keyCodes.UP:
        this.flipLeft();
        break;
      case keyCodes.RIGHT:
        // ArrowRight clicks the focused item to open nested popover, but only if item has children
        // Otherwise, do nothing (don't activate items without nested menu)
        if (this.iterator?.currentItem && this.currentItemHasChildren()) {
          this.handleEnterPress(event);
        }
        break;
      case keyCodes.DOWN:
        this.flipRight();
        break;
      case keyCodes.HOME:
        this.flipToFirst();
        break;
      case keyCodes.END:
        this.flipToLast();
        break;
      case keyCodes.ENTER:
        this.handleEnterPress(event);
        break;
      case null:
        // keyCode is null - unrecognized key, nothing to do
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
   * Returns true if flipper handles events from contenteditable elements
   */
  public getHandleContentEditableTargets(): boolean {
    return this.handleContentEditableTargets;
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

    if (isFunction(this.activateCallback) && this.iterator?.currentItem) {
      this.activateCallback(this.iterator.currentItem);
    }
  }

  /**
   * Scrolls the given element into view using the best available method
   * @param element - element to scroll into view
   */
  private scrollElementIntoView(element: HTMLElement): void {
    const el = element as HTMLElement & { scrollIntoViewIfNeeded?: (centerIfNeeded?: boolean) => void };

    if (typeof el.scrollIntoViewIfNeeded === 'function') {
      el.scrollIntoViewIfNeeded();

      return;
    }

    el.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Handles printable keydowns for typeahead navigation.
   * @param event - keydown event
   * @returns true when the event was consumed as a typeahead keystroke
   */
  private handleTypeAhead(event: KeyboardEvent): boolean {
    if (!this.activated) {
      return false;
    }

    /**
     * Ignore modifier combinations and non-printable keys. Single-character
     * `event.key` values are printable; navigation keys ('Tab', 'ArrowDown',
     * 'Home', …) all have multi-character names and are therefore excluded.
     */
    if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    this.typeAheadBuffer += event.key.toLowerCase();

    if (this.typeAheadTimer) {
      clearTimeout(this.typeAheadTimer);
    }

    this.typeAheadTimer = setTimeout(() => {
      this.typeAheadBuffer = '';
      this.typeAheadTimer = null;
    }, Flipper.TYPEAHEAD_TIMEOUT);

    const matchIndex = this.findTypeAheadMatch(this.typeAheadBuffer);

    if (matchIndex !== -1) {
      this.iterator?.setCursor(matchIndex);
      this.flipCallback();
    }

    return true;
  }

  /**
   * Finds the first non-disabled item whose accessible label starts with the
   * given buffer (case-insensitive).
   * @param buffer - accumulated lowercase typeahead buffer
   * @returns index of the matching item, or -1 when none match
   */
  private findTypeAheadMatch(buffer: string): number {
    const items = this.iterator?.getItems() ?? [];

    return items.findIndex((item) => {
      if (item.hasAttribute(DATA_ATTR.disabled)) {
        return false;
      }

      const label = (item.getAttribute(Flipper.LABEL_ATTR) ?? item.textContent ?? '')
        .trim()
        .toLowerCase();

      return label.startsWith(buffer);
    });
  }

  /**
   * Fired after flipping in any direction
   */
  private flipCallback(): void {
    if (this.iterator?.currentItem) {
      this.scrollElementIntoView(this.iterator.currentItem);
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

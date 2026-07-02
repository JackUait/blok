import { DATA_ATTR } from './constants';
import { Dom } from './dom';
import { SelectionUtils } from './selection/index';
import { delay } from './utils';
import { generateId } from './utils/id-generator';

/**
 * Iterator above passed Elements list.
 * Each next or previous action adds provides CSS-class and sets cursor to this item
 * @internal
 */
export class DomIterator {
  /**
   * This is a static property that defines iteration directions
   * @type {{RIGHT: string, LEFT: string}}
   */
  public static directions = {
    RIGHT: 'right',
    LEFT: 'left',
  };

  /**
   * User-provided CSS-class name for focused button
   */
  private focusedCssClass: string;

  /**
   * Focused button index.
   * Default is -1 which means nothing is active
   * @type {number}
   */
  private cursor = -1;

  /**
   * Items to flip
   */
  private items: HTMLElement[] = [];

  /**
   * Optional host element that mirrors the virtual focus to assistive tech
   * via aria-activedescendant, without moving real DOM focus.
   */
  private activeDescendantHost: HTMLElement | null = null;

  /**
   * @param {HTMLElement[]} nodeList — the list of iterable HTML-items
   * @param {string} focusedCssClass - user-provided CSS-class that will be set in flipping process
   * @param {HTMLElement | null} activeDescendantHost - optional host for aria-activedescendant
   */
  constructor(
    nodeList: HTMLElement[] | null | undefined,
    focusedCssClass: string,
    activeDescendantHost?: HTMLElement | null
  ) {
    this.items = nodeList ?? [];
    this.focusedCssClass = focusedCssClass;
    this.activeDescendantHost = activeDescendantHost ?? null;
  }

  /**
   * Sets (or clears) the aria-activedescendant host element
   * @param host - element that should receive aria-activedescendant, or null to disable
   */
  public setActiveDescendantHost(host: HTMLElement | null): void {
    if (host === this.activeDescendantHost) {
      return;
    }

    const previousHost = this.activeDescendantHost;
    const currentItem = this.currentItem;

    /**
     * Detach the stale aria-activedescendant from the previous host so it never
     * points at an option that no longer belongs to an open combobox.
     */
    if (previousHost !== null) {
      previousHost.removeAttribute('aria-activedescendant');
    }

    this.activeDescendantHost = host;

    if (host === null) {
      /**
       * With no combobox referencing the virtual focus, the aria-selected marker
       * is meaningless. Drop it, but leave the focus class / data attribute / id
       * intact (id reuse is intended, styling is owned by dropCursor).
       */
      if (currentItem !== null) {
        currentItem.removeAttribute('aria-selected');
      }

      return;
    }

    /**
     * Mirror the existing virtual focus onto the new host so swapping hosts keeps
     * a valid aria-activedescendant → option relationship.
     */
    if (currentItem !== null) {
      if (!currentItem.id) {
        currentItem.id = generateId('blok-flipper-item-');
      }

      currentItem.setAttribute('aria-selected', 'true');
      host.setAttribute('aria-activedescendant', currentItem.id);
    }
  }

  /**
   * Returns Focused button Node
   * @returns {HTMLElement | null}
   */
  public get currentItem(): HTMLElement | null {
    if (this.cursor === -1) {
      return null;
    }

    return this.items[this.cursor];
  }

  /**
   * Sets cursor to specified position
   * @param cursorPosition - new cursor position
   */
  public setCursor(cursorPosition: number): void {
    if (cursorPosition < this.items.length && cursorPosition >= -1) {
      this.applyCursor(cursorPosition, { setCaret: false });
    }
  }

  /**
   * Sets items. Can be used when iterable items changed dynamically
   * @param {HTMLElement[]} nodeList - nodes to iterate
   */
  public setItems(nodeList: HTMLElement[]): void {
    this.items = nodeList;
  }

  /**
   * Returns true if iterator has items to navigate
   */
  public hasItems(): boolean {
    return this.items.length > 0;
  }

  /**
   * Returns the current list of iterable items
   */
  public getItems(): HTMLElement[] {
    return this.items;
  }

  /**
   * Moves cursor to the first non-disabled item (Home navigation).
   * Routes through the caret-aware path like arrow navigation. Leaves the
   * cursor unchanged when every item is disabled.
   */
  public setCursorToFirst(): void {
    this.setCursorToEdge('first');
  }

  /**
   * Moves cursor to the last non-disabled item (End navigation).
   * Routes through the caret-aware path like arrow navigation. Leaves the
   * cursor unchanged when every item is disabled.
   */
  public setCursorToLast(): void {
    this.setCursorToEdge('last');
  }

  /**
   * Sets cursor next to the current
   */
  public next(): void {
    this.cursor = this.leafNodesAndReturnIndex(DomIterator.directions.RIGHT);
  }

  /**
   * Sets cursor before current
   */
  public previous(): void {
    this.cursor = this.leafNodesAndReturnIndex(DomIterator.directions.LEFT);
  }

  /**
   * Sets cursor to the default position and removes CSS-class from previously focused item
   */
  public dropCursor(): void {
    if (this.cursor === -1) {
      return;
    }

    this.removeFocusMarkers(this.items[this.cursor]);
    this.cursor = -1;

    if (this.activeDescendantHost) {
      this.activeDescendantHost.removeAttribute('aria-activedescendant');
    }
  }

  /**
   * Removes all focus markers from the previously-focused item (if any),
   * moves the virtual cursor to the given index and applies all focus markers
   * to the newly-focused item.
   * @param index - target item index
   * @param options - focus behavior options
   * @param options.setCaret - when true, moves the editor caret to the item (arrow/tab path)
   */
  private applyCursor(index: number, options?: { setCaret?: boolean }): void {
    if (this.cursor !== -1) {
      this.removeFocusMarkers(this.items[this.cursor]);
    }

    this.cursor = index;

    if (index === -1) {
      if (this.activeDescendantHost) {
        this.activeDescendantHost.removeAttribute('aria-activedescendant');
      }

      return;
    }

    const item = this.items[index];

    if (options?.setCaret && Dom.canSetCaret(item)) {
      /**
       * Focus input with micro-delay to ensure DOM is updated
       */
      delay(() => SelectionUtils.setCursor(item), 50)();
    }

    this.addFocusMarkers(item);
  }

  /**
   * Applies all focus markers (CSS class, data attribute, and — when a host is
   * present — aria-selected + aria-activedescendant) to the given item.
   * @param item - item to focus
   */
  private addFocusMarkers(item: HTMLElement): void {
    item.classList.add(this.focusedCssClass);
    item.setAttribute('data-blok-focused', 'true');

    if (this.activeDescendantHost) {
      if (!item.id) {
        item.id = generateId('blok-flipper-item-');
      }

      /**
       * aria-selected is not allowed on menuitem roles (axe: aria-allowed-attr);
       * for those, aria-activedescendant alone conveys the highlight. Keep
       * aria-selected for option-like items (listbox popovers).
       */
      const role = item.getAttribute('role');
      const isMenuItemRole = role === 'menuitem' || role === 'menuitemradio' || role === 'menuitemcheckbox';

      if (isMenuItemRole) {
        item.removeAttribute('aria-selected');
      } else {
        item.setAttribute('aria-selected', 'true');
      }

      this.activeDescendantHost.setAttribute('aria-activedescendant', item.id);
    }
  }

  /**
   * Removes all focus markers from the given item.
   * @param item - item to unfocus
   */
  private removeFocusMarkers(item: HTMLElement): void {
    item.classList.remove(this.focusedCssClass);
    item.removeAttribute('data-blok-focused');

    if (this.activeDescendantHost) {
      item.removeAttribute('aria-selected');
    }
  }

  /**
   * Returns true when the item is marked as disabled and should be skipped
   * during navigation.
   * @param item - candidate item
   */
  private isDisabled(item: HTMLElement | undefined): boolean {
    return !!item && item.hasAttribute(DATA_ATTR.disabled);
  }

  /**
   * Moves the cursor to the first (or last) non-disabled item.
   * @param edge - 'first' scans forward from index 0, 'last' scans backward
   */
  private setCursorToEdge(edge: 'first' | 'last'): void {
    const length = this.items.length;

    if (length === 0) {
      return;
    }

    if (edge === 'first') {
      for (let index = 0; index < length; index++) {
        if (!this.isDisabled(this.items[index])) {
          this.applyCursor(index, { setCaret: true });

          return;
        }
      }

      return;
    }

    for (let index = length - 1; index >= 0; index--) {
      if (!this.isDisabled(this.items[index])) {
        this.applyCursor(index, { setCaret: true });

        return;
      }
    }
  }

  /**
   * Leafs nodes inside the target list from active element
   * @param {string} direction - leaf direction. Can be 'left' or 'right'
   * @returns {number} index of focused node
   */
  private leafNodesAndReturnIndex(direction: string): number {
    /**
     * if items are empty then there is nothing to leaf
     */
    if (this.items.length === 0) {
      return this.cursor;
    }

    /**
     * If activeButtonIndex === -1 then we have no chosen Tool in Toolbox
     * Normalize "previous" Tool index depending on direction.
     * We need to do this to highlight "first" Tool correctly
     *
     * Order of Tools: [0] [1] ... [n - 1]
     * [0 = n] because of: n % n = 0 % n
     *
     * Direction 'right': for [0] the [n - 1] is a previous index
     * [n - 1] -> [0]
     *
     * Direction 'left': for [n - 1] the [0] is a previous index
     * [n - 1] <- [0]
     */
    const defaultIndex = direction === DomIterator.directions.RIGHT ? -1 : 0;
    const startingIndex = this.cursor === -1 ? defaultIndex : this.cursor;
    const length = this.items.length;

    /**
     * Step is +1 to the right and -1 to the left.
     * `length` is added before the modulo to avoid "The JavaScript Modulo Bug"
     * for negative operands.
     */
    const step = direction === DomIterator.directions.RIGHT ? 1 : -1;

    /**
     * Advance in the chosen direction skipping any disabled items. The scan is
     * bounded by the number of items, so if every item is disabled we bail out
     * and leave the cursor unchanged (guards against an infinite loop).
     */
    let focusedButtonIndex = startingIndex;

    for (let scanned = 0; scanned < length; scanned++) {
      focusedButtonIndex = (focusedButtonIndex + step + length) % length;

      if (!this.isDisabled(this.items[focusedButtonIndex])) {
        /**
         * Remove markers from the old item and apply them (plus the caret) to the new one
         */
        this.applyCursor(focusedButtonIndex, { setCaret: true });

        return focusedButtonIndex;
      }
    }

    /**
     * All items are disabled — keep the current cursor position.
     */
    return this.cursor;
  }
}

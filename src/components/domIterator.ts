import Dom from './dom';
import * as _ from './utils';
import SelectionUtils from './selection';

/**
 * Iterator above passed Elements list.
 * Each next or previous action adds provides CSS-class and sets cursor to this item
 */
export default class DomIterator {
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
   * @param {HTMLElement[]} nodeList — the list of iterable HTML-items
   * @param {string} focusedCssClass - user-provided CSS-class that will be set in flipping process
   */
  constructor(
    nodeList: HTMLElement[] | null | undefined,
    focusedCssClass: string
  ) {
    this.items = nodeList ?? [];
    this.focusedCssClass = focusedCssClass;
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
      this.dropCursor();
      this.cursor = cursorPosition;
      this.items[this.cursor].classList.add(this.focusedCssClass);
      this.items[this.cursor].setAttribute('data-focused', 'true');
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

    this.items[this.cursor].classList.remove(this.focusedCssClass);
    this.items[this.cursor].removeAttribute('data-focused');
    this.cursor = -1;
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

    /**
     * If we have chosen Tool then remove highlighting
     */
    if (startingIndex !== -1) {
      this.items[startingIndex].classList.remove(this.focusedCssClass);
      this.items[startingIndex].removeAttribute('data-focused');
    }

    /**
     * Count index for next Tool
     */
    const focusedButtonIndex = direction === DomIterator.directions.RIGHT
      ? /**
         * If we go right then choose next (+1) Tool
         * @type {number}
         */
      (startingIndex + 1) % this.items.length
      : /**
         * If we go left then choose previous (-1) Tool
         * Before counting module we need to add length before because of "The JavaScript Modulo Bug"
         * @type {number}
         */
      (this.items.length + startingIndex - 1) % this.items.length;

    if (Dom.canSetCaret(this.items[focusedButtonIndex])) {
      /**
       * Focus input with micro-delay to ensure DOM is updated
       */
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      _.delay(() => SelectionUtils.setCursor(this.items[focusedButtonIndex]), 50)();
    }

    /**
     * Highlight new chosen Tool
     */
    this.items[focusedButtonIndex].classList.add(this.focusedCssClass);
    this.items[focusedButtonIndex].setAttribute('data-focused', 'true');

    /**
     * Return focused button's index
     */
    return focusedButtonIndex;
  }
}

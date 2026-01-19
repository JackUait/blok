import { SelectionCore } from './core';
import { SelectionCursor } from './cursor';
import { FakeBackgroundManager } from './fake-background';
import { SelectionFakeCursor } from './fake-cursor';
import { SelectionNavigation } from './navigation';

/**
 * Working with selection
 * @typedef {SelectionUtils} SelectionUtils
 *
 * This is the backward-compatible facade that delegates to focused modules.
 */
export class SelectionUtils {
  /**
   * Selection instances
   * @todo Check if this is still relevant
   */
  public instance: Selection | null = null;
  public selection: Selection | null = null;

  /**
   * This property can store SelectionUtils's range for restoring later
   * @type {Range|null}
   */
  public savedSelectionRange: Range | null = null;

  /**
   * Fake background is active
   * @returns {boolean}
   */
  public isFakeBackgroundEnabled = false;

  /**
   * Fake background manager instance
   */
  private fakeBackgroundManager: FakeBackgroundManager;

  constructor() {
    this.fakeBackgroundManager = new FakeBackgroundManager(this);
  }

  // ========================
  // Static getters - delegate to core module
  // ========================

  /**
   * Returns selected anchor
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/Selection/anchorNode}
   * @returns {Node|null}
   */
  public static get anchorNode(): Node | null {
    return SelectionCore.getAnchorNode();
  }

  /**
   * Returns selected anchor element
   * @returns {Element|null}
   */
  public static get anchorElement(): Element | null {
    return SelectionCore.getAnchorElement();
  }

  /**
   * Returns selection offset according to the anchor node
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/Selection/anchorOffset}
   * @returns {number|null}
   */
  public static get anchorOffset(): number | null {
    return SelectionCore.getAnchorOffset();
  }

  /**
   * Is current selection range collapsed
   * @returns {boolean|null}
   */
  public static get isCollapsed(): boolean | null {
    return SelectionCore.getIsCollapsed();
  }

  /**
   * Check current selection if it is at Blok's zone
   * @returns {boolean}
   */
  public static get isAtBlok(): boolean {
    return SelectionCore.getIsAtBlok();
  }

  /**
   * Check if passed selection is at Blok's zone
   * @param selection - Selection object to check
   */
  public static isSelectionAtBlok(selection: Selection | null): boolean {
    return SelectionCore.isSelectionAtBlok(selection);
  }

  /**
   * Check if passed range at Blok zone
   * @param range - range to check
   */
  public static isRangeAtBlok(range: Range): boolean | void {
    return SelectionCore.isRangeAtBlok(range);
  }

  /**
   * Methods return boolean that true if selection exists on the page
   */
  public static get isSelectionExists(): boolean {
    return SelectionCore.getIsSelectionExists();
  }

  /**
   * Return first range
   * @returns {Range|null}
   */
  public static get range(): Range | null {
    return SelectionCore.getRange();
  }

  /**
   * Returns range from passed Selection object
   * @param selection - Selection object to get Range from
   */
  public static getRangeFromSelection(selection: Selection | null): Range | null {
    return SelectionCore.getRangeFromSelection(selection);
  }

  /**
   * Calculates position and size of selected text
   * @returns {DOMRect}
   */
  public static get rect(): DOMRect {
    return SelectionCore.getRect();
  }

  /**
   * Returns selected text as String
   * @returns {string}
   */
  public static get text(): string {
    return SelectionCore.getText();
  }

  /**
   * Returns window Selection
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/Window/getSelection}
   * @returns {Selection}
   */
  public static get(): Selection | null {
    return SelectionCore.get();
  }

  // ========================
  // Static methods - delegate to appropriate modules
  // ========================

  /**
   * Set focus to contenteditable or native input element
   * @param element - element where to set focus
   * @param offset - offset of cursor
   */
  public static setCursor(element: HTMLElement, offset = 0): DOMRect {
    return SelectionCursor.setCursor(element, offset);
  }

  /**
   * Check if current range exists and belongs to container
   * @param container - where range should be
   */
  public static isRangeInsideContainer(container: HTMLElement): boolean {
    return SelectionCursor.isRangeInsideContainer(container);
  }

  /**
   * Adds fake cursor to the current range
   */
  public static addFakeCursor(): void {
    SelectionFakeCursor.addFakeCursor();
  }

  /**
   * Check if passed element contains a fake cursor
   * @param el - where to check
   */
  public static isFakeCursorInsideContainer(el: HTMLElement): boolean {
    return SelectionFakeCursor.isFakeCursorInsideContainer(el);
  }

  /**
   * Removes fake cursor from a container
   * @param container - container to look for
   */
  public static removeFakeCursor(container: HTMLElement = document.body): void {
    SelectionFakeCursor.removeFakeCursor(container);
  }

  // ========================
  // Instance methods - delegate to FakeBackgroundManager or use instance state
  // ========================

  /**
   * Removes fake background
   * Unwraps the highlight spans and restores the selection
   */
  public removeFakeBackground(): void {
    this.fakeBackgroundManager.removeFakeBackground();
  }

  /**
   * Removes any fake background elements from the DOM that are not tracked
   * This handles cleanup after undo/redo operations that may restore fake background elements
   * Also provides backwards compatibility with old fake background approach
   */
  public removeOrphanedFakeBackgroundElements(): void {
    this.fakeBackgroundManager.removeOrphanedFakeBackgroundElements();
  }

  /**
   * Clears all fake background state - both DOM elements and internal flags
   * This is useful for cleanup after undo/redo operations or when the selection context has been lost
   */
  public clearFakeBackground(): void {
    this.fakeBackgroundManager.clearFakeBackground();
  }

  /**
   * Sets fake background by wrapping selected text in highlight spans
   * Uses a gray background color to simulate the "unfocused selection" appearance
   * similar to how Notion shows selections when focus moves to another element
   */
  public setFakeBackground(): void {
    this.fakeBackgroundManager.setFakeBackground();
  }

  /**
   * Save Selection's range
   */
  public save(): void {
    this.savedSelectionRange = SelectionCore.getRange();
  }

  /**
   * Restore saved Selection's range
   */
  public restore(): void {
    if (!this.savedSelectionRange) {
      return;
    }

    const sel = window.getSelection();

    if (!sel) {
      return;
    }

    sel.removeAllRanges();
    sel.addRange(this.savedSelectionRange);
  }

  /**
   * Clears saved selection
   */
  public clearSaved(): void {
    this.savedSelectionRange = null;
  }

  /**
   * Collapse current selection
   */
  public collapseToEnd(): void {
    SelectionCursor.collapseToEnd();
  }

  /**
   * Looks ahead to find passed tag from current selection
   * @param tagName - tag to found
   * @param className - tag's class name (optional)
   * @param searchDepth - count of tags that can be included. For better performance.
   * @returns {HTMLElement|null}
   */
  public findParentTag(tagName: string, className?: string, searchDepth = 10): HTMLElement | null {
    return SelectionNavigation.findParentTag(tagName, className, searchDepth);
  }

  /**
   * Expands selection range to the passed parent node
   * @param element - element which contents should be selected
   */
  public expandToTag(element: HTMLElement): void {
    SelectionNavigation.expandToTag(element);
  }
}

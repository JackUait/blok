import type { InlineTool, SanitizerConfig } from '../../../types';
import { IconBold } from '../icons';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR, createSelector } from '../constants';
import { CollapsedBoldExitHandler } from './collapsed-bold-exit-handler';
import {
  isBoldTag,
  isBoldElement,
  isElementEmpty,
  findBoldElement,
  ensureStrongElement,
  isNodeWithin,
} from './utils/bold-dom-utils';
import {
  isRangeFormatted,
  collectFormattingAncestors,
} from './utils/formatting-range-utils';

/**
 * Bold Tool
 *
 * Inline Toolbar Tool
 *
 * Makes selected text bolder
 */
export class BoldInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Bold';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'bold';

  /**
   * Sanitizer Rule
   * Leave <strong> tags
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      strong: {},
      b: {},
    } as SanitizerConfig;
  }

  /**
   * Normalize any remaining legacy <b> tags within the blok wrapper
   */
  private static normalizeAllBoldTags(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const selector = `${createSelector(DATA_ATTR.interface)} b, ${createSelector(DATA_ATTR.editor)} b`;

    document.querySelectorAll(selector).forEach((boldNode) => {
      ensureStrongElement(boldNode as HTMLElement);
    });
  }

  /**
   * Normalize bold tags within a mutated node if it belongs to the blok
   * @param node - The node affected by mutation
   */
  private static normalizeBoldInNode(node: Node): void {
    const element = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;

    if (!element || typeof element.closest !== 'function') {
      return;
    }

    const blokRoot = element.closest(`${createSelector(DATA_ATTR.interface)}, ${createSelector(DATA_ATTR.editor)}`);

    if (!blokRoot) {
      return;
    }

    if (element.tagName === 'B') {
      ensureStrongElement(element as HTMLElement);
    }

    element.querySelectorAll?.('b').forEach((boldNode) => {
      ensureStrongElement(boldNode as HTMLElement);
    });
  }

  private static shortcutListenerRegistered = false;
  private static selectionListenerRegistered = false;
  private static inputListenerRegistered = false;
  private static beforeInputListenerRegistered = false;
  private static readonly globalListenersInitialized = BoldInlineTool.initializeGlobalListeners();
  private static markerSequence = 0;
  private static mutationObserver?: MutationObserver;
  private static isProcessingMutation = false;
  private static readonly DATA_ATTR_COLLAPSED_LENGTH = 'data-blok-bold-collapsed-length';
  private static readonly DATA_ATTR_COLLAPSED_ACTIVE = 'data-blok-bold-collapsed-active';
  private static readonly DATA_ATTR_PREV_LENGTH = 'data-blok-bold-prev-length';
  private static readonly DATA_ATTR_LEADING_WHITESPACE = 'data-blok-bold-leading-ws';
  private static readonly instances = new Set<BoldInlineTool>();

  /**
   *
   */
  constructor() {
    if (typeof document === 'undefined') {
      return;
    }

    BoldInlineTool.instances.add(this);

    BoldInlineTool.initializeGlobalListeners();
  }

  /**
   * Ensure global event listeners are registered once per document
   */
  private static initializeGlobalListeners(): boolean {
    if (typeof document === 'undefined') {
      return false;
    }

    if (!BoldInlineTool.shortcutListenerRegistered) {
      document.addEventListener('keydown', BoldInlineTool.handleShortcut, true);
      BoldInlineTool.shortcutListenerRegistered = true;
    }

    if (!BoldInlineTool.selectionListenerRegistered) {
      document.addEventListener('selectionchange', BoldInlineTool.handleGlobalSelectionChange, true);
      BoldInlineTool.selectionListenerRegistered = true;
    }

    if (!BoldInlineTool.inputListenerRegistered) {
      document.addEventListener('input', BoldInlineTool.handleGlobalInput, true);
      BoldInlineTool.inputListenerRegistered = true;
    }

    if (!BoldInlineTool.beforeInputListenerRegistered) {
      document.addEventListener('beforeinput', BoldInlineTool.handleBeforeInput, true);
      BoldInlineTool.beforeInputListenerRegistered = true;
    }

    BoldInlineTool.ensureMutationObserver();

    return true;
  }

  /**
   * Merge two strong elements by moving children from right to left
   * @param left - The left strong element to merge into
   * @param right - The right strong element to merge from
   */
  private static mergeStrongNodes(left: HTMLElement, right: HTMLElement): HTMLElement {
    const leftStrong = ensureStrongElement(left);
    const rightStrong = ensureStrongElement(right);

    while (rightStrong.firstChild) {
      leftStrong.appendChild(rightStrong.firstChild);
    }

    rightStrong.remove();

    return leftStrong;
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconBold,
      name: 'bold',
      onActivate: () => {
        this.toggleBold();
      },
      isActive: () => {
        const selection = window.getSelection();

        return selection ? this.isSelectionVisuallyBold(selection) : false;
      },
    };
  }

  /**
   * Apply or remove bold formatting using modern Selection API
   */
  private toggleBold(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      this.toggleCollapsedSelection();

      return;
    }

    // Check if selection is visually bold (ignoring whitespace) to match button state
    // If visually bold, unwrap; otherwise wrap
    const shouldUnwrap = this.isRangeBold(range, { ignoreWhitespace: true });

    if (shouldUnwrap) {
      this.unwrapBoldTags(range);
    } else {
      this.wrapWithBold(range);
    }
  }

  /**
   * Check if current selection is within a bold tag (<strong>)
   * @param selection - The Selection object to check
   */
  private isSelectionVisuallyBold(selection: Selection): boolean {
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);

    return this.isRangeBold(range, { ignoreWhitespace: true });
  }

  /**
   * Wrap selection with <strong> tag
   * @param range - The Range object containing the selection to wrap
   */
  private wrapWithBold(range: Range): void {
    const html = this.getRangeHtmlWithoutBold(range);
    const insertedRange = this.replaceRangeWithHtml(range, `<strong>${html}</strong>`);
    const selection = window.getSelection();

    if (selection && insertedRange) {
      selection.removeAllRanges();
      selection.addRange(insertedRange);
    }

    BoldInlineTool.normalizeAllBoldTags();

    /**
     * Find the bold element from the inserted range.
     * After insertion, selection.focusNode may point to the parent container (e.g., DIV)
     * rather than inside the <strong> element, so we need to look at the range's
     * startContainer or commonAncestorContainer to find the bold element.
     */
    const boldElement = this.findBoldElementFromRangeOrSelection(insertedRange, selection);

    if (!boldElement) {
      /**
       * Even if we can't find the bold element, we should still notify selection change
       * to update the toolbar button state based on the current selection.
       */
      this.notifySelectionChange();

      return;
    }

    const merged = this.mergeAdjacentBold(boldElement);

    this.normalizeWhitespaceAround(merged);

    this.selectElementContents(merged);
    BoldInlineTool.normalizeBoldTagsWithinBlok(window.getSelection());
    BoldInlineTool.replaceNbspInBlock(window.getSelection());
    this.notifySelectionChange();
  }

  /**
   * Remove bold tags (<strong>) while preserving content
   * @param range - The Range object containing the selection to unwrap
   */
  private unwrapBoldTags(range: Range): void {
    const boldAncestors = this.collectBoldAncestors(range);
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const marker = document.createElement('span');
    const fragment = range.extractContents();

    marker.setAttribute('data-blok-bold-marker', `unwrap-${BoldInlineTool.markerSequence++}`);
    marker.appendChild(fragment);
    this.removeNestedBold(marker);

    range.insertNode(marker);

    const markerRange = document.createRange();

    markerRange.selectNodeContents(marker);
    selection.removeAllRanges();
    selection.addRange(markerRange);

    for (; ;) {
      const currentBold = findBoldElement(marker);

      if (!currentBold) {
        break;
      }

      this.moveMarkerOutOfBold(marker, currentBold);
    }

    const firstChild = marker.firstChild;
    const lastChild = marker.lastChild;

    this.unwrapElement(marker);

    const finalRange = firstChild && lastChild ? (() => {
      const newRange = document.createRange();

      newRange.setStartBefore(firstChild);
      newRange.setEndAfter(lastChild);

      selection.removeAllRanges();
      selection.addRange(newRange);

      return newRange;
    })() : undefined;

    if (!finalRange) {
      selection.removeAllRanges();
    }

    this.replaceNbspWithinRange(finalRange);
    BoldInlineTool.normalizeBoldTagsWithinBlok(selection);
    BoldInlineTool.replaceNbspInBlock(selection);
    BoldInlineTool.removeEmptyBoldElements(selection);

    boldAncestors.forEach((element) => {
      if (isElementEmpty(element)) {
        element.remove();
      }
    });

    this.notifySelectionChange();
  }

  /**
   * Replace the current range contents with provided HTML snippet
   * @param range - Range to replace
   * @param html - HTML string to insert
   * @returns range spanning inserted content
   */
  private replaceRangeWithHtml(range: Range, html: string): Range | undefined {
    const fragment = BoldInlineTool.createFragmentFromHtml(html);
    const firstInserted = fragment.firstChild ?? null;
    const lastInserted = fragment.lastChild ?? null;

    range.deleteContents();

    if (!firstInserted || !lastInserted) {
      return;
    }

    range.insertNode(fragment);

    const newRange = document.createRange();

    newRange.setStartBefore(firstInserted);
    newRange.setEndAfter(lastInserted);

    return newRange;
  }

  /**
   * Move a temporary marker element outside of a bold ancestor while preserving content order
   * @param marker - Marker element wrapping the selection contents
   * @param boldElement - Bold ancestor containing the marker
   */
  private moveMarkerOutOfBold(marker: HTMLElement, boldElement: HTMLElement): void {
    const parent = boldElement.parentNode;

    if (!parent) {
      return;
    }

    Array.from(boldElement.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').length === 0) {
        node.remove();
      }
    });

    const isOnlyChild = boldElement.childNodes.length === 1 && boldElement.firstChild === marker;

    if (isOnlyChild) {
      boldElement.replaceWith(marker);

      return;
    }

    const isFirstChild = boldElement.firstChild === marker;

    if (isFirstChild) {
      parent.insertBefore(marker, boldElement);

      return;
    }

    const isLastChild = boldElement.lastChild === marker;

    if (isLastChild) {
      parent.insertBefore(marker, boldElement.nextSibling);

      return;
    }

    const trailingClone = boldElement.cloneNode(false) as HTMLElement;

    while (marker.nextSibling) {
      trailingClone.appendChild(marker.nextSibling);
    }

    parent.insertBefore(trailingClone, boldElement.nextSibling);
    parent.insertBefore(marker, trailingClone);
  }

  /**
   * Select all contents of an element
   * @param element - The element whose contents should be selected
   */
  private selectElementContents(element: HTMLElement): void {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const newRange = document.createRange();

    newRange.selectNodeContents(element);

    selection.removeAllRanges();
    selection.addRange(newRange);
  }

  /**
   * Shortcut for bold tool
   */
  public static shortcut = 'CMD+B';

  /**
   * Check if a range contains bold text
   * @param range - The range to check
   * @param options - Options for checking bold status
   * @param options.ignoreWhitespace - Whether to ignore whitespace-only text nodes
   */
  private isRangeBold(range: Range, options: { ignoreWhitespace: boolean }): boolean {
    return isRangeFormatted(range, isBoldTag, options);
  }

  /**
   * Remove nested bold tags from a root node
   * @param root - The root node to process
   */
  private removeNestedBold(root: ParentNode): void {
    const boldNodes = root.querySelectorAll?.('b,strong');

    if (!boldNodes) {
      return;
    }

    boldNodes.forEach((node) => {
      this.unwrapElement(node);
    });
  }

  /**
   * Unwrap an element by moving its children to the parent
   * @param element - The element to unwrap
   */
  private unwrapElement(element: Element): void {
    const parent = element.parentNode;

    if (!parent) {
      element.remove();

      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
  }

  /**
   * Find bold element from an inserted range or fall back to selection
   * @param insertedRange - Range spanning inserted content
   * @param selection - Current selection as fallback
   */
  private findBoldElementFromRangeOrSelection(insertedRange: Range | undefined, selection: Selection | null): HTMLElement | null {
    if (!insertedRange) {
      return selection ? findBoldElement(selection.focusNode) : null;
    }

    const fromStart = findBoldElement(insertedRange.startContainer);

    if (fromStart) {
      return fromStart;
    }

    const fromAncestor = findBoldElement(insertedRange.commonAncestorContainer);

    if (fromAncestor) {
      return fromAncestor;
    }

    const isStartContainerBold = insertedRange.startContainer.nodeType === Node.ELEMENT_NODE &&
      isBoldTag(insertedRange.startContainer as Element);

    return isStartContainerBold ? insertedRange.startContainer as HTMLElement : null;
  }

  /**
   * Merge adjacent bold elements into a single element
   * @param element - The bold element to merge with adjacent elements
   */
  private mergeAdjacentBold(element: HTMLElement): HTMLElement {
    const initialTarget = ensureStrongElement(element);

    const previous = initialTarget.previousSibling;
    const targetAfterPrevious = previous && previous.nodeType === Node.ELEMENT_NODE && isBoldTag(previous as Element)
      ? BoldInlineTool.mergeStrongNodes(previous as HTMLElement, initialTarget)
      : initialTarget;

    const next = targetAfterPrevious.nextSibling;
    const finalTarget = next && next.nodeType === Node.ELEMENT_NODE && isBoldTag(next as Element)
      ? BoldInlineTool.mergeStrongNodes(targetAfterPrevious, next as HTMLElement)
      : targetAfterPrevious;

    return finalTarget;
  }

  /**
   * Toggle bold formatting for a collapsed selection (caret position)
   * Exits bold if caret is inside a bold element, otherwise starts a new bold element
   */
  private toggleCollapsedSelection(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const insideBold = findBoldElement(range.startContainer);

    const updatedRange = (() => {
      if (insideBold && insideBold.getAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE) !== 'true') {
        return CollapsedBoldExitHandler.getInstance().exitBold(selection, insideBold);
      }

      const boundaryBold = insideBold ?? BoldInlineTool.getBoundaryBold(range);

      return boundaryBold
        ? CollapsedBoldExitHandler.getInstance().exitBold(selection, boundaryBold)
        : this.startCollapsedBold(range);
    })();

    document.dispatchEvent(new Event('selectionchange'));

    if (updatedRange) {
      selection.removeAllRanges();
      selection.addRange(updatedRange);
    }

    BoldInlineTool.normalizeBoldTagsWithinBlok(selection);
    BoldInlineTool.replaceNbspInBlock(selection);
    BoldInlineTool.removeEmptyBoldElements(selection);
    this.notifySelectionChange();
  }

  /**
   * Insert a bold wrapper at the caret so newly typed text becomes bold
   * @param range - Current collapsed range
   */
  private startCollapsedBold(range: Range): Range | undefined {
    if (!range.collapsed) {
      return;
    }

    const strong = document.createElement('strong');
    const textNode = document.createTextNode('');

    strong.appendChild(textNode);
    strong.setAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE, 'true');

    const container = range.startContainer;
    const offset = range.startOffset;

    const insertionSucceeded = (() => {
      if (container.nodeType === Node.TEXT_NODE) {
        return this.insertCollapsedBoldIntoText(container as Text, strong, offset);
      }

      if (container.nodeType === Node.ELEMENT_NODE) {
        this.insertCollapsedBoldIntoElement(container as Element, strong, offset);

        return true;
      }

      return false;
    })();

    if (!insertionSucceeded) {
      return;
    }

    const selection = window.getSelection();
    const newRange = document.createRange();

    newRange.setStart(textNode, 0);
    newRange.collapse(true);

    const merged = this.mergeAdjacentBold(strong);

    BoldInlineTool.normalizeBoldTagsWithinBlok(selection);
    BoldInlineTool.replaceNbspInBlock(selection);
    BoldInlineTool.removeEmptyBoldElements(selection);

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    this.notifySelectionChange();

    return merged.firstChild instanceof Text ? (() => {
      const caretRange = document.createRange();

      caretRange.setStart(merged.firstChild, merged.firstChild.textContent?.length ?? 0);
      caretRange.collapse(true);

      return caretRange;
    })() : newRange;
  }

  /**
   * Insert a collapsed bold wrapper when the caret resides inside a text node
   * @param text - Text node containing the caret
   * @param strong - Strong element to insert
   * @param offset - Caret offset within the text node
   * @returns true when insertion succeeded
   */
  private insertCollapsedBoldIntoText(text: Text, strong: HTMLElement, offset: number): boolean {
    const textNode = text;
    const parent = textNode.parentNode;

    if (!parent) {
      return false;
    }

    const content = textNode.textContent ?? '';
    const before = content.slice(0, offset);
    const after = content.slice(offset);

    textNode.textContent = before;

    const afterNode = after.length ? document.createTextNode(after) : null;

    if (afterNode) {
      parent.insertBefore(afterNode, textNode.nextSibling);
    }

    parent.insertBefore(strong, afterNode ?? textNode.nextSibling);
    strong.setAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH, before.length.toString());

    return true;
  }

  /**
   * Insert a collapsed bold wrapper directly into an element container
   * @param element - Container element
   * @param strong - Strong element to insert
   * @param offset - Index at which to insert the strong element
   */
  private insertCollapsedBoldIntoElement(element: Element, strong: HTMLElement, offset: number): void {
    const referenceNode = element.childNodes[offset] ?? null;

    element.insertBefore(strong, referenceNode);
    strong.setAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH, '0');
  }

  /**
   * Check if an element is empty (has no text content)
   * @param element - The element to check
   */
  private static isElementEmpty(element: HTMLElement): boolean {
    return (element.textContent ?? '').length === 0;
  }

  /**
   *
   */
  private notifySelectionChange(): void {
    BoldInlineTool.enforceCollapsedBoldLengths(window.getSelection());
    document.dispatchEvent(new Event('selectionchange'));
    this.updateToolbarButtonState();
  }

  /**
   * Ensure inline toolbar button reflects the actual bold state after programmatic toggles
   */
  private updateToolbarButtonState(): void {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const anchor = selection.anchorNode;
    const anchorElement = anchor?.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor?.parentElement;
    const blokWrapper = anchorElement?.closest(createSelector(DATA_ATTR.editor));

    if (!blokWrapper) {
      return;
    }

    const toolbar = blokWrapper.querySelector('[data-blok-testid=inline-toolbar]');
    if (!(toolbar instanceof HTMLElement)) {
      return;
    }

    const button = toolbar.querySelector('[data-blok-item-name="bold"]');

    if (!(button instanceof HTMLElement)) {
      return;
    }

    const isActive = this.isSelectionVisuallyBold(selection);

    if (isActive) {
      button.setAttribute('data-blok-popover-item-active', 'true');
    } else {
      button.removeAttribute('data-blok-popover-item-active');
    }
  }

  /**
   * Normalize whitespace around a bold element
   * @param element - The bold element to normalize whitespace around
   */
  private normalizeWhitespaceAround(element: HTMLElement): void {
    BoldInlineTool.replaceNbspWithSpace(element.previousSibling);
    BoldInlineTool.replaceNbspWithSpace(element.nextSibling);
  }

  /**
   * Replace non-breaking spaces with regular spaces in a text node
   * @param node - The text node to process
   */
  private static replaceNbspWithSpace(node: Node | null): void {
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const textNode = node as Text;
    const text = textNode.textContent ?? '';

    if (!text.includes('\u00A0')) {
      return;
    }

    textNode.textContent = text.replace(/\u00A0/g, ' ');
  }

  /**
   * Replace non-breaking spaces with regular spaces within a range
   * @param range - The range to process
   */
  private replaceNbspWithinRange(range?: Range): void {
    if (!range) {
      return;
    }

    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          try {
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          } catch (_error) {
            const nodeRange = document.createRange();

            nodeRange.selectNodeContents(node);

            const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0;
            const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0;

            return (startsBeforeEnd && endsAfterStart) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        },
      }
    );

    while (walker.nextNode()) {
      BoldInlineTool.replaceNbspWithSpace(walker.currentNode);
    }
  }

  /**
   * Normalize all bold tags within the blok to <strong> tags
   * Converts any legacy <b> tags to <strong> tags
   * @param selection - The current selection to determine the blok context
   */
  private static normalizeBoldTagsWithinBlok(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const root = element?.closest(createSelector(DATA_ATTR.editor));

    if (!root) {
      return;
    }

    // Convert any legacy <b> tags to <strong> tags
    root.querySelectorAll('b').forEach((boldNode) => {
      ensureStrongElement(boldNode as HTMLElement);
    });
  }

  /**
   * Replace non-breaking spaces with regular spaces in the block containing the selection
   * @param selection - The current selection to determine the block context
   */
  private static replaceNbspInBlock(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const block = element?.closest('[data-blok-component="paragraph"]');

    if (!block) {
      return;
    }

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      BoldInlineTool.replaceNbspWithSpace(walker.currentNode);
    }

    block.querySelectorAll('b').forEach((boldNode) => {
      ensureStrongElement(boldNode as HTMLElement);
    });
  }

  /**
   * Remove empty bold elements within the current block
   * @param selection - The current selection to determine the block context
   */
  private static removeEmptyBoldElements(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const block = element?.closest('[data-blok-component="paragraph"]');

    if (!block) {
      return;
    }

    const focusNode = selection?.focusNode ?? null;

    block.querySelectorAll('strong').forEach((strong) => {
      const isCollapsedPlaceholder = strong.getAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE) === 'true';
      const hasTrackedLength = strong.hasAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_LENGTH);

      if (isCollapsedPlaceholder || hasTrackedLength) {
        return;
      }

      if ((strong.textContent ?? '').length === 0 && !isNodeWithin(focusNode, strong)) {
        strong.remove();
      }
    });
  }

  /**
   * Ensure collapsed bold placeholders absorb newly typed text
   * @param selection - The current selection to determine the blok context
   */
  private static synchronizeCollapsedBold(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;
    const element = node && node.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
    const root = element?.closest(createSelector(DATA_ATTR.editor)) ?? element?.ownerDocument;

    if (!root) {
      return;
    }

    const selector = `strong[${BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE}="true"]`;

    root.querySelectorAll<HTMLElement>(selector).forEach((boldElement) => {
      const prevLengthAttr = boldElement.getAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH);
      const prevNode = boldElement.previousSibling;

      if (!prevLengthAttr || !prevNode || prevNode.nodeType !== Node.TEXT_NODE) {
        return;
      }

      const prevLength = Number(prevLengthAttr);

      if (!Number.isFinite(prevLength)) {
        return;
      }

      const prevTextNode = prevNode as Text;
      const prevText = prevTextNode.textContent ?? '';

      if (prevText.length <= prevLength) {
        return;
      }

      const preserved = prevText.slice(0, prevLength);
      const extra = prevText.slice(prevLength);

      prevTextNode.textContent = preserved;

      const leadingMatch = extra.match(/^[\u00A0\s]+/);

      if (leadingMatch && !boldElement.hasAttribute(BoldInlineTool.DATA_ATTR_LEADING_WHITESPACE)) {
        boldElement.setAttribute(BoldInlineTool.DATA_ATTR_LEADING_WHITESPACE, leadingMatch[0]);
      }

      if (extra.length === 0) {
        return;
      }

      const existingContent = boldElement.textContent ?? '';
      const newContent = existingContent + extra;
      const storedLeading = boldElement.getAttribute(BoldInlineTool.DATA_ATTR_LEADING_WHITESPACE) ?? '';
      const shouldPrefixLeading = storedLeading.length > 0 && existingContent.length === 0 && !newContent.startsWith(storedLeading);
      const adjustedContent = shouldPrefixLeading ? storedLeading + newContent : newContent;
      const updatedTextNode = document.createTextNode(adjustedContent);

      while (boldElement.firstChild) {
        boldElement.removeChild(boldElement.firstChild);
      }

      boldElement.appendChild(updatedTextNode);

      if (!selection?.isCollapsed || !isNodeWithin(selection.focusNode, prevTextNode)) {
        return;
      }

      const newRange = document.createRange();
      const caretOffset = updatedTextNode.textContent?.length ?? 0;

      newRange.setStart(updatedTextNode, caretOffset);
      newRange.collapse(true);

      selection.removeAllRanges();
      selection.addRange(newRange);
    });
  }

  /**
   * Ensure caret is positioned after boundary bold elements when toggling collapsed selections
   * @param selection - Current selection
   */
  private static moveCaretAfterBoundaryBold(selection: Selection): void {
    if (!selection.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (!range.collapsed) {
      return;
    }

    const activePlaceholder = findBoldElement(range.startContainer);

    if (activePlaceholder?.getAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE) === 'true') {
      return;
    }

    if (BoldInlineTool.moveCaretFromElementContainer(selection, range)) {
      return;
    }

    BoldInlineTool.moveCaretFromTextContainer(selection, range);
  }

  /**
   * Adjust caret when selection container is an element adjacent to bold content
   * @param selection - Current selection
   * @param range - Collapsed range to inspect
   * @returns true when caret position was updated
   */
  private static moveCaretFromElementContainer(selection: Selection, range: Range): boolean {
    if (range.startContainer.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const element = range.startContainer as Element;
    const movedAfterPrevious = BoldInlineTool.moveCaretAfterPreviousBold(selection, element, range.startOffset);

    if (movedAfterPrevious) {
      return true;
    }

    return BoldInlineTool.moveCaretBeforeNextBold(selection, element, range.startOffset);
  }

  /**
   * Move caret after the bold node that precedes the caret when possible
   * @param selection - Current selection
   * @param element - Container element
   * @param offset - Caret offset within the container
   */
  private static moveCaretAfterPreviousBold(selection: Selection, element: Element, offset: number): boolean {
    const beforeNode = offset > 0 ? element.childNodes[offset - 1] ?? null : null;

    if (!isBoldElement(beforeNode)) {
      return false;
    }

    const textNode = BoldInlineTool.ensureFollowingTextNode(beforeNode as Element, beforeNode.nextSibling);

    if (!textNode) {
      return false;
    }

    const textOffset = textNode.textContent?.length ?? 0;

    BoldInlineTool.setCaret(selection, textNode, textOffset);

    return true;
  }

  /**
   * Move caret before the bold node that follows the caret, ensuring there's a text node to receive input
   * @param selection - Current selection
   * @param element - Container element
   * @param offset - Caret offset within the container
   */
  private static moveCaretBeforeNextBold(selection: Selection, element: Element, offset: number): boolean {
    const nextNode = element.childNodes[offset] ?? null;

    if (!isBoldElement(nextNode)) {
      return false;
    }

    const textNode = BoldInlineTool.ensureFollowingTextNode(nextNode as Element, nextNode.nextSibling);

    if (!textNode) {
      BoldInlineTool.setCaretAfterNode(selection, nextNode);

      return true;
    }

    BoldInlineTool.setCaret(selection, textNode, 0);

    return true;
  }

  /**
   * Adjust caret when selection container is a text node adjacent to bold content
   * @param selection - Current selection
   * @param range - Collapsed range to inspect
   */
  private static moveCaretFromTextContainer(selection: Selection, range: Range): void {
    if (range.startContainer.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const textNode = range.startContainer as Text;
    const previousSibling = textNode.previousSibling;
    const textContent = textNode.textContent ?? '';
    const startsWithWhitespace = /^\s/.test(textContent);

    if (
      range.startOffset === 0 &&
      isBoldElement(previousSibling) &&
      (textContent.length === 0 || startsWithWhitespace)
    ) {
      BoldInlineTool.setCaret(selection, textNode, textContent.length);

      return;
    }

    const boldElement = findBoldElement(textNode);

    if (!boldElement || range.startOffset !== (textNode.textContent?.length ?? 0)) {
      return;
    }

    const textNodeAfter = BoldInlineTool.ensureFollowingTextNode(boldElement, boldElement.nextSibling);

    if (textNodeAfter) {
      BoldInlineTool.setCaret(selection, textNodeAfter, 0);

      return;
    }

    BoldInlineTool.setCaretAfterNode(selection, boldElement);
  }

  /**
   * Ensure caret is positioned at the end of a collapsed boundary text node before the browser processes a printable keydown
   * @param event - Keydown event fired before browser input handling
   */
  private static guardCollapsedBoundaryKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const key = event.key;

    if (key.length !== 1) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.startContainer.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const textNode = range.startContainer as Text;
    const textContent = textNode.textContent ?? '';

    if (textContent.length === 0 || range.startOffset !== 0) {
      return;
    }

    const previousSibling = textNode.previousSibling;

    if (!isBoldElement(previousSibling)) {
      return;
    }

    if (!/^\s/.test(textContent)) {
      return;
    }

    BoldInlineTool.setCaret(selection, textNode, textContent.length);
  }

  /**
   * Determine whether a node is a bold element (<strong>/<b>)
   * @param node - Node to inspect
   */
  private static isBoldElement(node: Node | null): node is Element {
    return Boolean(node && node.nodeType === Node.ELEMENT_NODE && isBoldTag(node as Element));
  }

  /**
   * Place caret at the provided offset within a text node
   * @param selection - Current selection
   * @param node - Target text node
   * @param offset - Offset within the text node
   */
  private static setCaret(selection: Selection, node: Text, offset: number): void {
    const newRange = document.createRange();

    newRange.setStart(node, offset);
    newRange.collapse(true);

    selection.removeAllRanges();
    selection.addRange(newRange);
  }

  /**
   * Position caret immediately after the provided node
   * @param selection - Current selection
   * @param node - Reference node
   */
  private static setCaretAfterNode(selection: Selection, node: Node | null): void {
    if (!node) {
      return;
    }

    const newRange = document.createRange();

    newRange.setStartAfter(node);
    newRange.collapse(true);

    selection.removeAllRanges();
    selection.addRange(newRange);
  }

  /**
   * Ensure there is a text node immediately following a bold element to accept new input
   * @param boldElement - Bold element after which text should be inserted
   * @param referenceNode - Node that currently follows the bold element
   */
  private static ensureFollowingTextNode(boldElement: Element, referenceNode: Node | null): Text | null {
    const parent = boldElement.parentNode;

    if (!parent) {
      return null;
    }

    if (referenceNode && referenceNode.nodeType === Node.TEXT_NODE) {
      return referenceNode as Text;
    }

    const textNode = document.createTextNode('');

    parent.insertBefore(textNode, referenceNode);

    return textNode;
  }

  /**
   * Enforce length limits on collapsed bold elements
   * @param selection - The current selection to determine the blok context
   */
  private static enforceCollapsedBoldLengths(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const root = element?.closest(createSelector(DATA_ATTR.editor));

    if (!root) {
      return;
    }

    const tracked = root.querySelectorAll<HTMLElement>(`strong[${BoldInlineTool.DATA_ATTR_COLLAPSED_LENGTH}]`);

    tracked.forEach((boldElement) => {
      const boldEl = boldElement;
      const lengthAttr = boldEl.getAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_LENGTH);

      if (!lengthAttr) {
        return;
      }

      const allowedLength = Number(lengthAttr);
      const currentText = boldEl.textContent ?? '';

      if (!Number.isFinite(allowedLength)) {
        return;
      }

      const shouldRemoveCurrentLength = currentText.length > allowedLength;
      const newTextNodeAfterSplit = shouldRemoveCurrentLength
        ? BoldInlineTool.splitCollapsedBoldText(boldEl, allowedLength, currentText)
        : null;

      const prevLengthAttr = boldEl.getAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH);
      const prevLength = prevLengthAttr ? Number(prevLengthAttr) : NaN;
      const prevNode = boldEl.previousSibling;
      const previousTextNode = prevNode?.nodeType === Node.TEXT_NODE ? prevNode as Text : null;
      const prevText = previousTextNode?.textContent ?? '';
      const shouldRemovePrevLength = Boolean(
        prevLengthAttr &&
        Number.isFinite(prevLength) &&
        previousTextNode &&
        prevText.length > prevLength
      );

      if (shouldRemovePrevLength && previousTextNode) {
        const preservedPrev = prevText.slice(0, prevLength);
        const extraPrev = prevText.slice(prevLength);

        previousTextNode.textContent = preservedPrev;
        const extraNode = document.createTextNode(extraPrev);

        boldEl.parentNode?.insertBefore(extraNode, boldEl.nextSibling);
      }

      if (shouldRemovePrevLength) {
        boldEl.removeAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH);
      }

      if (selection?.isCollapsed && newTextNodeAfterSplit && isNodeWithin(selection.focusNode, boldEl)) {
        const caretRange = document.createRange();
        const caretOffset = newTextNodeAfterSplit.textContent?.length ?? 0;

        caretRange.setStart(newTextNodeAfterSplit, caretOffset);
        caretRange.collapse(true);

        selection.removeAllRanges();
        selection.addRange(caretRange);
      }

      if (shouldRemoveCurrentLength) {
        boldEl.removeAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_LENGTH);
      }
    });
  }

  /**
   * Split text content exceeding the allowed collapsed bold length and move the excess outside
   * @param boldEl - Bold element hosting the collapsed selection
   * @param allowedLength - Maximum allowed length for the collapsed bold
   * @param currentText - Current text content inside the bold element
   */
  private static splitCollapsedBoldText(boldEl: HTMLElement, allowedLength: number, currentText: string): Text | null {
    const targetBoldElement = boldEl;
    const parent = targetBoldElement.parentNode;

    if (!parent) {
      return null;
    }

    const preserved = currentText.slice(0, allowedLength);
    const extra = currentText.slice(allowedLength);

    targetBoldElement.textContent = preserved;

    const textNode = document.createTextNode(extra);

    parent.insertBefore(textNode, targetBoldElement.nextSibling);

    return textNode;
  }

  /**
   * Check if a node is within the provided container
   * @param target - Node to test
   * @param container - Potential ancestor container
   */
  private static isNodeWithin(target: Node | null, container: Node): boolean {
    if (!target) {
      return false;
    }

    return target === container || container.contains(target);
  }

  /**
   *
   */
  private static handleGlobalSelectionChange(): void {
    BoldInlineTool.refreshSelectionState('selectionchange');
  }

  /**
   *
   */
  private static handleGlobalInput(): void {
    BoldInlineTool.refreshSelectionState('input');
  }

  /**
   * Normalize selection state after blok input or selection updates
   * @param source - The event source triggering the refresh
   */
  private static refreshSelectionState(source: 'selectionchange' | 'input'): void {
    const selection = window.getSelection();

    BoldInlineTool.enforceCollapsedBoldLengths(selection);
    CollapsedBoldExitHandler.getInstance().maintain();
    BoldInlineTool.synchronizeCollapsedBold(selection);
    BoldInlineTool.normalizeBoldTagsWithinBlok(selection);
    BoldInlineTool.removeEmptyBoldElements(selection);

    if (source === 'input' && selection) {
      BoldInlineTool.moveCaretAfterBoundaryBold(selection);
    }

    BoldInlineTool.normalizeAllBoldTags();
  }

  /**
   * Ensure mutation observer is registered to convert legacy <b> tags
   */
  private static ensureMutationObserver(): void {
    if (typeof MutationObserver === 'undefined') {
      return;
    }

    if (BoldInlineTool.mutationObserver) {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (BoldInlineTool.isProcessingMutation) {
        return;
      }

      BoldInlineTool.isProcessingMutation = true;

      try {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            BoldInlineTool.normalizeBoldInNode(node);
          });

          if (mutation.type === 'characterData' && mutation.target) {
            BoldInlineTool.normalizeBoldInNode(mutation.target);
          }
        });
      } finally {
        BoldInlineTool.isProcessingMutation = false;
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    BoldInlineTool.mutationObserver = observer;
  }

  /**
   * Prevent the browser's native bold command to avoid <b> wrappers
   * @param event - BeforeInput event fired by the browser
   */
  private static handleBeforeInput(event: InputEvent): void {
    if (event.inputType !== 'formatBold') {
      return;
    }

    const selection = window.getSelection();
    const isSelectionInside = Boolean(selection && BoldInlineTool.isSelectionInsideBlok(selection));
    const isTargetInside = BoldInlineTool.isEventTargetInsideBlok(event.target);

    if (!isSelectionInside && !isTargetInside) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    BoldInlineTool.normalizeAllBoldTags();
  }

  /**
   * Get a bold element at the boundary of a collapsed range
   * @param range - The collapsed range to check
   */
  private static getBoundaryBold(range: Range): HTMLElement | null {
    const container = range.startContainer;

    if (container.nodeType === Node.TEXT_NODE) {
      return BoldInlineTool.getBoundaryBoldForText(range, container as Text);
    }

    if (container.nodeType === Node.ELEMENT_NODE) {
      return BoldInlineTool.getBoundaryBoldForElement(range, container as Element);
    }

    return null;
  }

  /**
   * Get boundary bold when caret resides inside a text node
   * @param range - Collapsed range
   * @param textNode - Text container
   */
  private static getBoundaryBoldForText(range: Range, textNode: Text): HTMLElement | null {
    const length = textNode.textContent?.length ?? 0;

    if (range.startOffset === length) {
      return findBoldElement(textNode);
    }

    if (range.startOffset !== 0) {
      return null;
    }

    const previous = textNode.previousSibling;

    return isBoldElement(previous) ? previous as HTMLElement : null;
  }

  /**
   * Get boundary bold when caret container is an element
   * @param range - Collapsed range
   * @param element - Element container
   */
  private static getBoundaryBoldForElement(range: Range, element: Element): HTMLElement | null {
    if (range.startOffset <= 0) {
      return null;
    }

    const previous = element.childNodes[range.startOffset - 1];

    return isBoldElement(previous) ? previous as HTMLElement : null;
  }

  /**
   * Handle keyboard shortcut for bold when selection is collapsed
   * @param event - The keyboard event
   */
  private static handleShortcut(event: KeyboardEvent): void {
    BoldInlineTool.guardCollapsedBoundaryKeydown(event);

    if (!BoldInlineTool.isBoldShortcut(event)) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || !selection.rangeCount || !BoldInlineTool.isSelectionInsideBlok(selection)) {
      return;
    }

    const instance = BoldInlineTool.instances.values().next().value ?? new BoldInlineTool();

    if (!instance) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    instance.toggleBold();
  }

  /**
   * Check if a keyboard event is the bold shortcut (Cmd/Ctrl+B)
   * @param event - The keyboard event to check
   */
  private static isBoldShortcut(event: KeyboardEvent): boolean {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const isMac = userAgent.includes('mac');
    const primaryModifier = isMac ? event.metaKey : event.ctrlKey;

    if (!primaryModifier || event.altKey) {
      return false;
    }

    return event.key.toLowerCase() === 'b';
  }

  /**
   * Check if a selection is inside the blok
   * @param selection - The selection to check
   */
  private static isSelectionInsideBlok(selection: Selection): boolean {
    const anchor = selection.anchorNode;

    if (!anchor) {
      return false;
    }

    const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;

    return Boolean(element?.closest(createSelector(DATA_ATTR.editor)));
  }

  /**
   * Check if an event target resides inside the blok wrapper
   * @param target - Event target to inspect
   */
  private static isEventTargetInsideBlok(target: EventTarget | null): boolean {
    if (!target || typeof Node === 'undefined') {
      return false;
    }

    if (target instanceof Element) {
      return Boolean(target.closest(createSelector(DATA_ATTR.editor)));
    }

    if (target instanceof Text) {
      return Boolean(target.parentElement?.closest(createSelector(DATA_ATTR.editor)));
    }

    if (typeof ShadowRoot !== 'undefined' && target instanceof ShadowRoot) {
      return BoldInlineTool.isEventTargetInsideBlok(target.host);
    }

    if (!(target instanceof Node)) {
      return false;
    }

    const parentNode = target.parentNode;

    if (!parentNode) {
      return false;
    }

    if (parentNode instanceof Element) {
      return Boolean(parentNode.closest(createSelector(DATA_ATTR.editor)));
    }

    return BoldInlineTool.isEventTargetInsideBlok(parentNode);
  }

  /**
   * Get HTML content of a range with bold tags removed
   * @param range - The range to extract HTML from
   */
  private getRangeHtmlWithoutBold(range: Range): string {
    const contents = range.cloneContents();

    this.removeNestedBold(contents);

    const container = document.createElement('div');

    container.appendChild(contents);

    return container.innerHTML;
  }

  /**
   * Convert an HTML snippet to a document fragment
   * @param html - HTML string to convert
   */
  private static createFragmentFromHtml(html: string): DocumentFragment {
    const template = document.createElement('template');

    template.innerHTML = html;

    return template.content;
  }

  /**
   * Collect all bold ancestor elements within a range
   * @param range - The range to search for bold ancestors
   */
  private collectBoldAncestors(range: Range): HTMLElement[] {
    return collectFormattingAncestors(range, isBoldTag);
  }
}

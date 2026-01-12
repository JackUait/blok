import type { CollapsedExitRecord } from '../types';
import { DATA_ATTR, createSelector } from '../../constants';
import { ensureStrongElement, isElementEmpty, isNodeWithin, resolveBoundary } from '../utils/bold-dom-utils';

/**
 * Centralized data attributes for collapsed bold state tracking
 */
const ATTR = {
  COLLAPSED_LENGTH: 'data-blok-bold-collapsed-length',
  COLLAPSED_ACTIVE: 'data-blok-bold-collapsed-active',
  PREV_LENGTH: 'data-blok-bold-prev-length',
  LEADING_WHITESPACE: 'data-blok-bold-leading-ws',
} as const;

/**
 * Unified manager for collapsed bold selection behavior.
 * Consolidates enter/exit logic, typeahead absorption, and boundary guards.
 */
export class CollapsedBoldManager {
  private static instance: CollapsedBoldManager | null = null;
  private readonly records = new Set<CollapsedExitRecord>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): CollapsedBoldManager {
    if (!CollapsedBoldManager.instance) {
      CollapsedBoldManager.instance = new CollapsedBoldManager();
    }

    return CollapsedBoldManager.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    if (CollapsedBoldManager.instance) {
      CollapsedBoldManager.instance.records.clear();
    }
    CollapsedBoldManager.instance = null;
  }

  /**
   * Check if there are any active exit records
   */
  public hasActiveRecords(): boolean {
    return this.records.size > 0;
  }

  /**
   * Check if an element is an active collapsed bold placeholder
   * Used by BoldNormalizationPass to avoid removing elements in use
   * @param element - The element to check
   */
  public isActivePlaceholder(element: HTMLElement): boolean {
    return element.getAttribute(ATTR.COLLAPSED_ACTIVE) === 'true' ||
           element.hasAttribute(ATTR.COLLAPSED_LENGTH);
  }

  /**
   * Get the ATTR constants for external use
   */
  public static get ATTR(): typeof ATTR {
    return ATTR;
  }

  /**
   * Enter collapsed bold mode by inserting an empty <strong> for typing
   * @param range - Current collapsed range
   * @param mergeCallback - Callback to merge adjacent bold elements
   */
  public enter(
    range: Range,
    mergeCallback: (element: HTMLElement) => HTMLElement
  ): Range | undefined {
    if (!range.collapsed) {
      return;
    }

    const strong = document.createElement('strong');
    const textNode = document.createTextNode('');

    strong.appendChild(textNode);
    strong.setAttribute(ATTR.COLLAPSED_ACTIVE, 'true');

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

    const newRange = document.createRange();

    newRange.setStart(textNode, 0);
    newRange.collapse(true);

    const merged = mergeCallback(strong);

    return merged.firstChild instanceof Text ? (() => {
      const caretRange = document.createRange();

      caretRange.setStart(merged.firstChild, merged.firstChild.textContent?.length ?? 0);
      caretRange.collapse(true);

      return caretRange;
    })() : newRange;
  }

  /**
   * Insert a collapsed bold wrapper when the caret resides inside a text node
   */
  private insertCollapsedBoldIntoText(text: Text, strong: HTMLElement, offset: number): boolean {
    const parent = text.parentNode;

    if (!parent) {
      return false;
    }

    const content = text.textContent ?? '';
    const before = content.slice(0, offset);
    const after = content.slice(offset);

    text.textContent = before;

    const afterNode = after.length ? document.createTextNode(after) : null;

    if (afterNode) {
      parent.insertBefore(afterNode, text.nextSibling);
    }

    parent.insertBefore(strong, afterNode ?? text.nextSibling);
    strong.setAttribute(ATTR.PREV_LENGTH, before.length.toString());

    return true;
  }

  /**
   * Insert a collapsed bold wrapper directly into an element container
   */
  private insertCollapsedBoldIntoElement(element: Element, strong: HTMLElement, offset: number): void {
    const referenceNode = element.childNodes[offset] ?? null;

    element.insertBefore(strong, referenceNode);
    strong.setAttribute(ATTR.PREV_LENGTH, '0');
  }

  /**
   * Exit a collapsed bold selection by moving caret outside the bold element
   * @param selection - The current selection
   * @param boldElement - The bold element to exit from
   */
  public exit(selection: Selection, boldElement: HTMLElement): Range | undefined {
    const normalizedBold = ensureStrongElement(boldElement);
    const parent = normalizedBold.parentNode;

    if (!parent) {
      return;
    }

    if (isElementEmpty(normalizedBold)) {
      return this.removeEmptyBoldElement(selection, normalizedBold, parent);
    }

    return this.exitBoldWithContent(selection, normalizedBold, parent);
  }

  private removeEmptyBoldElement(selection: Selection, boldElement: HTMLElement, parent: ParentNode): Range {
    const newRange = document.createRange();

    newRange.setStartBefore(boldElement);
    newRange.collapse(true);

    parent.removeChild(boldElement);

    selection.removeAllRanges();
    selection.addRange(newRange);

    return newRange;
  }

  private exitBoldWithContent(selection: Selection, boldElement: HTMLElement, parent: ParentNode): Range {
    boldElement.setAttribute(ATTR.COLLAPSED_LENGTH, (boldElement.textContent?.length ?? 0).toString());
    boldElement.removeAttribute(ATTR.PREV_LENGTH);
    boldElement.removeAttribute(ATTR.COLLAPSED_ACTIVE);
    boldElement.removeAttribute(ATTR.LEADING_WHITESPACE);

    const initialNextSibling = boldElement.nextSibling;
    const needsNewNode = !initialNextSibling || initialNextSibling.nodeType !== Node.TEXT_NODE;
    const newNode = needsNewNode ? document.createTextNode('\u200B') : null;

    if (newNode) {
      parent.insertBefore(newNode, initialNextSibling);
    }

    const boundary = (newNode ?? initialNextSibling) as Text;

    if (!needsNewNode && (boundary.textContent ?? '').length === 0) {
      boundary.textContent = '\u200B';
    }

    const newRange = document.createRange();
    const boundaryContent = boundary.textContent ?? '';
    const caretOffset = boundaryContent.startsWith('\u200B') ? 1 : 0;

    newRange.setStart(boundary, caretOffset);
    newRange.collapse(true);

    selection.removeAllRanges();
    selection.addRange(newRange);

    this.records.add({
      boundary,
      boldElement,
      allowedLength: boldElement.textContent?.length ?? 0,
      hasLeadingSpace: false,
      hasTypedContent: false,
      leadingWhitespace: '',
    });

    return newRange;
  }

  /**
   * Maintain the collapsed exit state by enforcing text boundaries
   */
  public maintain(): void {
    if (typeof document === 'undefined') {
      return;
    }

    for (const record of Array.from(this.records)) {
      const resolved = resolveBoundary(record);

      if (!resolved) {
        this.records.delete(record);
        continue;
      }

      record.boundary = resolved.boundary;
      record.boldElement = resolved.boldElement;

      this.enforceTextBoundary(record);
      this.cleanupZeroWidthSpace(record);
      this.updateRecordState(record);
      this.checkForRecordDeletion(record);
    }
  }

  private enforceTextBoundary(record: CollapsedExitRecord): void {
    const { boundary, boldElement, allowedLength } = record;
    const currentText = boldElement.textContent ?? '';

    if (currentText.length > allowedLength) {
      const preserved = currentText.slice(0, allowedLength);
      const extra = currentText.slice(allowedLength);

      boldElement.textContent = preserved;
      boundary.textContent = extra + (boundary.textContent ?? '');
    }
  }

  private cleanupZeroWidthSpace(record: CollapsedExitRecord): void {
    const { boundary } = record;
    const boundaryContent = boundary.textContent ?? '';

    if (boundaryContent.length > 1 && boundaryContent.startsWith('\u200B')) {
      boundary.textContent = boundaryContent.slice(1);
    }
  }

  private updateRecordState(record: CollapsedExitRecord): void {
    const { boundary } = record;
    const boundaryText = boundary.textContent ?? '';
    const sanitizedBoundary = boundaryText.replace(/\u200B/g, '');
    const leadingMatch = sanitizedBoundary.match(/^\s+/);
    const containsTypedContent = /\S/.test(sanitizedBoundary);

    if (leadingMatch) {
      record.hasLeadingSpace = true;
      record.leadingWhitespace = leadingMatch[0];
    }

    if (containsTypedContent) {
      record.hasTypedContent = true;
    }
  }

  private checkForRecordDeletion(record: CollapsedExitRecord): void {
    const { boundary, boldElement, allowedLength } = record;
    const boundaryText = boundary.textContent ?? '';
    const sanitizedBoundary = boundaryText.replace(/\u200B/g, '');
    const selectionStartsWithZws = boundaryText.startsWith('\u200B');
    const boundaryHasVisibleLeading = /^\s/.test(sanitizedBoundary);

    const meetsDeletionCriteria = record.hasTypedContent &&
      !selectionStartsWithZws &&
      (boldElement.textContent ?? '').length <= allowedLength;

    const shouldRestoreLeadingSpace = record.hasLeadingSpace &&
      record.hasTypedContent &&
      !boundaryHasVisibleLeading;

    if (meetsDeletionCriteria && shouldRestoreLeadingSpace) {
      const trimmedActual = boundaryText.replace(/^[\u200B\s]+/, '');
      const leadingWhitespace = record.leadingWhitespace || ' ';

      boundary.textContent = `${leadingWhitespace}${trimmedActual}`;
    }

    if (meetsDeletionCriteria) {
      this.records.delete(record);
    }
  }

  /**
   * Ensure collapsed bold placeholders absorb newly typed text
   * @param selection - The current selection to determine the blok context
   */
  public synchronize(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;
    const element = node && node.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
    const root = element?.closest(createSelector(DATA_ATTR.editor)) ?? element?.ownerDocument;

    if (!root) {
      return;
    }

    const selector = `strong[${ATTR.COLLAPSED_ACTIVE}="true"]`;

    root.querySelectorAll<HTMLElement>(selector).forEach((boldElement) => {
      const prevLengthAttr = boldElement.getAttribute(ATTR.PREV_LENGTH);
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

      if (leadingMatch && !boldElement.hasAttribute(ATTR.LEADING_WHITESPACE)) {
        boldElement.setAttribute(ATTR.LEADING_WHITESPACE, leadingMatch[0]);
      }

      if (extra.length === 0) {
        return;
      }

      const existingContent = boldElement.textContent ?? '';
      const newContent = existingContent + extra;
      const storedLeading = boldElement.getAttribute(ATTR.LEADING_WHITESPACE) ?? '';
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
   * Enforce length limits on collapsed bold elements
   * @param selection - The current selection to determine the blok context
   */
  public enforceLengths(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const root = element?.closest(createSelector(DATA_ATTR.editor));

    if (!root) {
      return;
    }

    const tracked = root.querySelectorAll<HTMLElement>(`strong[${ATTR.COLLAPSED_LENGTH}]`);

    tracked.forEach((boldEl) => {
      const lengthAttr = boldEl.getAttribute(ATTR.COLLAPSED_LENGTH);

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
        ? this.splitCollapsedBoldText(boldEl, allowedLength, currentText)
        : null;

      const prevLengthAttr = boldEl.getAttribute(ATTR.PREV_LENGTH);
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
        boldEl.removeAttribute(ATTR.PREV_LENGTH);
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
        boldEl.removeAttribute(ATTR.COLLAPSED_LENGTH);
      }
    });
  }

  /**
   * Split text content exceeding the allowed collapsed bold length
   */
  private splitCollapsedBoldText(boldEl: HTMLElement, allowedLength: number, currentText: string): Text | null {
    const parent = boldEl.parentNode;

    if (!parent) {
      return null;
    }

    const preserved = currentText.slice(0, allowedLength);
    const extra = currentText.slice(allowedLength);

    boldEl.textContent = preserved;

    const textNode = document.createTextNode(extra);

    parent.insertBefore(textNode, boldEl.nextSibling);

    return textNode;
  }

  /**
   * Guard collapsed boundary keydown events to ensure proper caret positioning
   * Prevents typed characters from being inserted at wrong positions near bold elements
   * @param event - Keydown event fired before browser input handling
   */
  public guardBoundaryKeydown(event: KeyboardEvent): void {
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

    if (!previousSibling || previousSibling.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const prevElement = previousSibling as Element;

    if (prevElement.tagName !== 'STRONG' && prevElement.tagName !== 'B') {
      return;
    }

    if (!/^\s/.test(textContent)) {
      return;
    }

    this.setCaret(selection, textNode, textContent.length);
  }

  /**
   * Place caret at the provided offset within a text node
   * @param selection - Current selection
   * @param node - Target text node
   * @param offset - Offset within the text node
   */
  private setCaret(selection: Selection, node: Text, offset: number): void {
    const newRange = document.createRange();

    newRange.setStart(node, offset);
    newRange.collapse(true);

    selection.removeAllRanges();
    selection.addRange(newRange);
  }
}

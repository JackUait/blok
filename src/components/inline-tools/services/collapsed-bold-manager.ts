import type { CollapsedExitRecord } from '../types';
import { ensureStrongElement, isElementEmpty, resolveBoundary } from '../utils/bold-dom-utils';

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
}

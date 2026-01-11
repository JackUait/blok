import type { CollapsedExitRecord } from './types';
import { ensureStrongElement, isElementEmpty } from './utils/bold-dom-utils';

const DATA_ATTR_COLLAPSED_LENGTH = 'data-blok-bold-collapsed-length';
const DATA_ATTR_COLLAPSED_ACTIVE = 'data-blok-bold-collapsed-active';
const DATA_ATTR_PREV_LENGTH = 'data-blok-bold-prev-length';
const DATA_ATTR_LEADING_WHITESPACE = 'data-blok-bold-leading-ws';

/**
 * Singleton handler for managing collapsed bold exit state.
 * When user toggles bold off with a collapsed caret, this tracks
 * the boundary where subsequent typing should appear.
 */
export class CollapsedBoldExitHandler {
  private static instance: CollapsedBoldExitHandler | null = null;
  private readonly records = new Set<CollapsedExitRecord>();

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): CollapsedBoldExitHandler {
    if (!CollapsedBoldExitHandler.instance) {
      CollapsedBoldExitHandler.instance = new CollapsedBoldExitHandler();
    }

    return CollapsedBoldExitHandler.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    if (CollapsedBoldExitHandler.instance) {
      CollapsedBoldExitHandler.instance.records.clear();
    }
    CollapsedBoldExitHandler.instance = null;
  }

  /**
   * Check if there are any active exit records
   */
  public hasActiveRecords(): boolean {
    return this.records.size > 0;
  }

  /**
   * Exit a collapsed bold selection by moving caret outside the bold element
   * @param selection - The current selection
   * @param boldElement - The bold element to exit from
   */
  public exitBold(selection: Selection, boldElement: HTMLElement): Range | undefined {
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
    boldElement.setAttribute(DATA_ATTR_COLLAPSED_LENGTH, (boldElement.textContent?.length ?? 0).toString());
    boldElement.removeAttribute(DATA_ATTR_PREV_LENGTH);
    boldElement.removeAttribute(DATA_ATTR_COLLAPSED_ACTIVE);
    boldElement.removeAttribute(DATA_ATTR_LEADING_WHITESPACE);

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
}

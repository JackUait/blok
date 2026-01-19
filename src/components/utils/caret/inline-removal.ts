/**
 * Empty inline element removal tracking utilities.
 *
 * This module tracks empty inline element removal via MutationObserver
 * to detect when non-breaking spaces should be preserved after inline deletion.
 */

import { isCollapsedWhitespaces, Dom as $ } from '../../dom';

import { getCaretNodeAndOffset } from './selection';

const NBSP_CHAR = '\u00A0';

/**
 * WeakSet tracking text nodes that follow removed empty inline elements.
 * Used to detect when whitespace should be preserved after inline deletion.
 */
export const whitespaceFollowingRemovedEmptyInline = new WeakSet<Text>();

/**
 * MutationObserver for tracking empty inline element removal.
 * Initialized at module load time if the environment supports it.
 */
const inlineRemovalObserver = typeof window !== 'undefined' && typeof window.MutationObserver !== 'undefined'
  ? new window.MutationObserver((records) => {
    for (const record of records) {
      const referenceNextSibling = record.nextSibling;

      record.removedNodes.forEach((node) => {
        if (!(node instanceof Element)) {
          return;
        }

        if (!isElementVisuallyEmpty(node)) {
          return;
        }

        const candidate = referenceNextSibling instanceof Text ? referenceNextSibling : null;

        if (candidate === null) {
          return;
        }

        if (!candidate.isConnected) {
          return;
        }

        const parentElement = candidate.parentElement;

        if (!(parentElement?.isContentEditable ?? false)) {
          return;
        }

        const firstChar = candidate.textContent?.[0] ?? null;
        const isWhitespace = firstChar === NBSP_CHAR || firstChar === ' ';

        if (!isWhitespace) {
          return;
        }

        whitespaceFollowingRemovedEmptyInline.add(candidate);
      });
    }
  })
  : null;

const observedDocuments = new WeakSet<Document>();

/**
 * Ensures the inline removal observer is watching the given document.
 * Called lazily when needed rather than at module load time for all documents.
 *
 * @param doc - The document to observe
 */
export const ensureInlineRemovalObserver = (doc: Document): void => {
  if (inlineRemovalObserver === null || observedDocuments.has(doc)) {
    return;
  }

  const startObserving = (): void => {
    if (doc.body === null) {
      return;
    }

    inlineRemovalObserver.observe(doc.body, {
      childList: true,
      subtree: true,
    });
    observedDocuments.add(doc);
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', startObserving, { once: true });
  } else {
    startObserving();
  }
};

/**
 * Initialize observer for the main document if we're in a browser environment.
 */
if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
  ensureInlineRemovalObserver(window.document);
}

/**
 * Checks if an element is visually empty (no visible content).
 * Used to determine if an inline element's removal should trigger whitespace tracking.
 *
 * @param element - The element to check
 * @returns true if the element is visually empty
 */
export const isElementVisuallyEmpty = (element: Element): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if ($.isSingleTag(element) || $.isNativeInput(element)) {
    return false;
  }

  if (element.childNodes.length === 0) {
    return true;
  }

  const textContent = element.textContent ?? '';

  if (textContent.includes(NBSP_CHAR)) {
    return false;
  }

  if (!isCollapsedWhitespaces(textContent)) {
    return false;
  }

  return Array.from(element.children).every((child) => {
    return isElementVisuallyEmpty(child);
  });
};

/**
 * Finds a non-breaking space that appears after an empty inline element was removed.
 * This is used to preserve whitespace during inline deletion operations.
 *
 * @param root - The root element to search within
 * @returns Object with node and offset, or null if no NBSP found
 */
export const findNbspAfterEmptyInline = (root: HTMLElement): { node: Text; offset: number } | null => {
  ensureInlineRemovalObserver(root.ownerDocument);

  const [caretNode, caretOffset] = getCaretNodeAndOffset();

  if (caretNode === null || !root.contains(caretNode)) {
    return null;
  }

  if (caretNode.nodeType === Node.TEXT_NODE && caretOffset < ((caretNode.textContent ?? '').length)) {
    return null;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  walker.currentNode = caretNode;

  for (; ;) {
    const nextTextNode = walker.nextNode() as Text | null;

    if (nextTextNode === null) {
      return null;
    }

    const textContent = nextTextNode.textContent ?? '';

    if (textContent.length === 0) {
      continue;
    }

    const firstChar = textContent[0];
    const isTargetWhitespace = firstChar === NBSP_CHAR || firstChar === ' ';

    if (!isTargetWhitespace) {
      return null;
    }

    if (nextTextNode === caretNode) {
      return null;
    }

    const pathRange = document.createRange();

    try {
      pathRange.setStart(caretNode, caretOffset);
      pathRange.setEnd(nextTextNode, 0);
    } catch (_error) {
      return null;
    }

    const betweenFragment = pathRange.cloneContents();
    const container = document.createElement('div');

    container.appendChild(betweenFragment);

    const hasEmptyElementBetween = Array.from(container.querySelectorAll('*')).some((element) => {
      const text = element.textContent ?? '';

      return text.length === 0 || isCollapsedWhitespaces(text);
    });

    const wasEmptyInlineRemoved = whitespaceFollowingRemovedEmptyInline.has(nextTextNode);

    if (!hasEmptyElementBetween && !wasEmptyInlineRemoved) {
      continue;
    }

    if (wasEmptyInlineRemoved) {
      whitespaceFollowingRemovedEmptyInline.delete(nextTextNode);
    }

    return {
      node: nextTextNode,
      offset: 0,
    };
  }
};

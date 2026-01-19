import { FakeBackgroundShadows } from './shadows';
import { FakeBackgroundTextNodes } from './text-nodes';
import { FakeBackgroundWrappers } from './wrappers';

/**
 * Interface for the SelectionUtils facade to allow FakeBackgroundManager
 * to read/write state.
 */
export interface SelectionUtilsState {
  savedSelectionRange: Range | null;
  isFakeBackgroundEnabled: boolean;
}

/**
 * FakeBackgroundManager - Manages fake background selection highlights.
 *
 * This class handles creating, removing, and managing fake background elements
 * that simulate selection appearance when focus is lost (similar to Notion).
 */
export class FakeBackgroundManager {
  /**
   * Reference to the SelectionUtils facade for state management.
   */
  private selectionUtils: SelectionUtilsState;

  constructor(selectionUtils: SelectionUtilsState) {
    this.selectionUtils = selectionUtils;
  }

  /**
   * Sets fake background by wrapping selected text in highlight spans
   * Uses a gray background color to simulate the "unfocused selection" appearance
   * similar to how Notion shows selections when focus moves to another element
   */
  setFakeBackground(): void {
    this.removeFakeBackground();

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      return;
    }

    // Collect text nodes and wrap them with highlight spans
    const textNodes = FakeBackgroundTextNodes.collectTextNodes(range);

    if (textNodes.length === 0) {
      return;
    }

    const anchorStartNode = range.startContainer;
    const anchorStartOffset = range.startOffset;
    const anchorEndNode = range.endContainer;
    const anchorEndOffset = range.endOffset;

    const highlightSpans: HTMLElement[] = [];

    textNodes.forEach((textNode) => {
      const segmentRange = document.createRange();
      const isStartNode = textNode === anchorStartNode;
      const isEndNode = textNode === anchorEndNode;
      const startOffset = isStartNode ? anchorStartOffset : 0;
      const nodeTextLength = textNode.textContent?.length ?? 0;
      const endOffset = isEndNode ? anchorEndOffset : nodeTextLength;

      if (startOffset === endOffset) {
        return;
      }

      segmentRange.setStart(textNode, startOffset);
      segmentRange.setEnd(textNode, endOffset);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(segmentRange);

      if (wrapper) {
        highlightSpans.push(wrapper);
      }
    });

    if (highlightSpans.length === 0) {
      return;
    }

    // Post-process: split multi-line spans and apply box-shadow styling
    const processedSpans = FakeBackgroundWrappers.postProcessHighlightWrappers(highlightSpans);

    // Apply additional line-height extensions for gaps between separate spans
    FakeBackgroundShadows.applyLineHeightExtensions(processedSpans);

    // Create a visual range spanning all highlight spans
    const visualRange = document.createRange();

    visualRange.setStartBefore(processedSpans[0]);
    visualRange.setEndAfter(processedSpans[processedSpans.length - 1]);

    // Save the range for later restoration
    this.selectionUtils.savedSelectionRange = visualRange.cloneRange();

    // Update the browser selection to span the fake background elements
    // Re-get selection in case it was cleared earlier
    const currentSelection = window.getSelection();

    if (currentSelection) {
      currentSelection.removeAllRanges();
      currentSelection.addRange(visualRange);
    }

    this.selectionUtils.isFakeBackgroundEnabled = true;
  }

  /**
   * Removes fake background
   * Unwraps the highlight spans and restores the selection
   */
  removeFakeBackground(): void {
    // Always clean up any orphaned fake background elements in the DOM
    // This handles cleanup after undo/redo operations that may restore fake background elements
    this.removeOrphanedFakeBackgroundElements();

    if (!this.selectionUtils.isFakeBackgroundEnabled) {
      return;
    }

    // Remove the highlight spans
    this.removeHighlightSpans();

    this.selectionUtils.isFakeBackgroundEnabled = false;
  }

  /**
   * Removes any fake background elements from the DOM that are not tracked
   * This handles cleanup after undo/redo operations that may restore fake background elements
   * Also provides backwards compatibility with old fake background approach
   */
  removeOrphanedFakeBackgroundElements(): void {
    const orphanedElements = document.querySelectorAll('[data-blok-fake-background="true"]');

    orphanedElements.forEach((element) => {
      FakeBackgroundWrappers.unwrapFakeBackground(element as HTMLElement);
    });
  }

  /**
   * Clears all fake background state - both DOM elements and internal flags
   * This is useful for cleanup after undo/redo operations or when the selection context has been lost
   */
  clearFakeBackground(): void {
    this.removeOrphanedFakeBackgroundElements();
    this.selectionUtils.isFakeBackgroundEnabled = false;
  }

  /**
   * Removes highlight spans and reconstructs the saved selection range
   */
  private removeHighlightSpans(): void {
    const highlightSpans = document.querySelectorAll('[data-blok-fake-background="true"]');

    if (highlightSpans.length === 0) {
      return;
    }

    const firstSpan = highlightSpans[0] as HTMLElement;
    const lastSpan = highlightSpans[highlightSpans.length - 1] as HTMLElement;

    const firstChild = firstSpan.firstChild;
    const lastChild = lastSpan.lastChild;

    highlightSpans.forEach((element) => {
      FakeBackgroundWrappers.unwrapFakeBackground(element as HTMLElement);
    });

    // Reconstruct the selection range after unwrapping
    if (firstChild && lastChild) {
      const newRange = document.createRange();

      newRange.setStart(firstChild, 0);
      newRange.setEnd(lastChild, lastChild.textContent?.length || 0);
      this.selectionUtils.savedSelectionRange = newRange;
    }
  }
}

import { DATA_ATTR, createSelector } from '../../constants';
import { isBoldElement, ensureStrongElement, isNodeWithin } from '../utils/bold-dom-utils';

import { CollapsedBoldManager } from './collapsed-bold-manager';

/**
 * Configuration options for bold normalization pass
 */
export interface NormalizationOptions {
  /** Convert <b> to <strong> (default: true) */
  convertLegacyTags?: boolean;
  /** Replace non-breaking spaces with regular spaces (default: true) */
  normalizeWhitespace?: boolean;
  /** Remove empty <strong> elements (default: true) */
  removeEmpty?: boolean;
  /** Merge adjacent <strong> elements (default: true) */
  mergeAdjacent?: boolean;
  /** Node to exclude from empty-removal (e.g., caret position) */
  preserveNode?: Node | null;
}

/**
 * Default normalization options
 */
const DEFAULT_OPTIONS: Required<NormalizationOptions> = {
  convertLegacyTags: true,
  normalizeWhitespace: true,
  removeEmpty: true,
  mergeAdjacent: true,
  preserveNode: null,
};

/**
 * Performs comprehensive DOM normalization for bold formatting in a single pass.
 * Consolidates multiple normalization operations to minimize DOM traversals.
 *
 * Operations performed (when enabled):
 * 1. Convert legacy <b> tags to <strong>
 * 2. Replace non-breaking spaces (\u00A0) with regular spaces
 * 3. Remove empty <strong> elements
 * 4. Merge adjacent <strong> elements
 *
 * @example
 * // Normalize entire block with default options
 * const pass = new BoldNormalizationPass();
 * pass.run(blockElement);
 *
 * @example
 * // Normalize selection with preserved caret node
 * BoldNormalizationPass.normalizeAroundSelection(window.getSelection(), {
 *   preserveNode: caretElement
 * });
 */
export class BoldNormalizationPass {
  private readonly options: Required<NormalizationOptions>;

  /**
   * Create a new normalization pass with specified options
   * @param options - Configuration for the normalization pass
   */
  constructor(options?: NormalizationOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Run normalization on a scoped element
   * @param scope - The root element to normalize (typically a block or editor root)
   */
  public run(scope: Element): void {
    if (typeof document === 'undefined') {
      return;
    }

    // Phase 1: Single TreeWalker pass to process text nodes and collect elements
    const { bElements, strongElements } = this.traverseAndNormalize(scope);

    // Phase 2: Structural operations on collected elements
    this.processCollectedElements(bElements, strongElements);
  }

  /**
   * Convenience method to normalize the block containing the current selection
   * @param selection - The current selection (or null)
   * @param options - Optional normalization configuration
   */
  public static normalizeAroundSelection(
    selection: Selection | null,
    options?: NormalizationOptions
  ): void {
    const scope = BoldNormalizationPass.findScopeFromSelection(selection);

    if (!scope) {
      return;
    }

    const pass = new BoldNormalizationPass(options);

    pass.run(scope);
  }

  /**
   * Phase 1: Traverse the scope and normalize text nodes while collecting elements
   * @param scope - Root element to traverse
   * @returns Collections of <b> and <strong> elements found
   */
  private traverseAndNormalize(scope: Element): {
    bElements: HTMLElement[];
    strongElements: HTMLElement[];
  } {
    const bElements: HTMLElement[] = [];
    const strongElements: HTMLElement[] = [];

    const walker = document.createTreeWalker(
      scope,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      null
    );

    // eslint-disable-next-line no-restricted-syntax -- TreeWalker requires iteration with nextNode()
    for (let currentNode: Node | null = walker.currentNode; currentNode; currentNode = walker.nextNode()) {
      this.processNode(currentNode, bElements, strongElements);
    }

    return { bElements, strongElements };
  }

  /**
   * Process a single node during traversal
   * @param node - Node to process
   * @param bElements - Collection to add <b> elements to
   * @param strongElements - Collection to add <strong> elements to
   */
  private processNode(
    node: Node,
    bElements: HTMLElement[],
    strongElements: HTMLElement[]
  ): void {
    if (node.nodeType === Node.TEXT_NODE && this.options.normalizeWhitespace) {
      this.replaceNbspInTextNode(node as Text);

      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as Element;

    if (this.options.convertLegacyTags && element.tagName === 'B') {
      bElements.push(element as HTMLElement);

      return;
    }

    if (element.tagName === 'STRONG') {
      strongElements.push(element as HTMLElement);
    }
  }

  /**
   * Phase 2: Process collected elements (convert, merge, remove empty)
   * @param bElements - List of <b> elements to convert
   * @param strongElements - List of <strong> elements to process
   */
  private processCollectedElements(
    bElements: HTMLElement[],
    strongElements: HTMLElement[]
  ): void {
    // Convert <b> to <strong> first
    if (this.options.convertLegacyTags) {
      bElements.forEach((b) => {
        if (b.isConnected) {
          const strong = ensureStrongElement(b);

          // Add converted element to strongElements for subsequent processing
          strongElements.push(strong);
        }
      });
    }

    // Process <strong> elements: merge adjacent and remove empty
    strongElements.forEach((strong) => {
      // Skip if element was already removed/merged
      if (!strong.isConnected) {
        return;
      }

      // Remove empty elements (unless it contains the preserved node)
      if (this.options.removeEmpty && this.isEmptyAndSafe(strong)) {
        strong.remove();

        return;
      }

      // Merge with adjacent <strong> elements
      if (this.options.mergeAdjacent) {
        this.mergeWithAdjacent(strong);
      }
    });
  }

  /**
   * Replace non-breaking spaces with regular spaces in a text node
   * @param textNode - The text node to process
   */
  private replaceNbspInTextNode(textNode: Text): void {
    const text = textNode.textContent ?? '';

    if (!text.includes('\u00A0')) {
      return;
    }

    const normalizedText = text.replace(/\u00A0/g, ' ');

    // eslint-disable-next-line no-param-reassign
    textNode.textContent = normalizedText;
  }

  /**
   * Check if a <strong> element is empty and safe to remove
   * @param strong - The element to check
   * @returns true if the element is empty and doesn't contain the preserved node
   */
  private isEmptyAndSafe(strong: HTMLElement): boolean {
    const isEmpty = (strong.textContent ?? '').length === 0;

    if (!isEmpty) {
      return false;
    }

    // Don't remove collapsed bold placeholders (used for typing new bold text)
    if (CollapsedBoldManager.getInstance().isActivePlaceholder(strong)) {
      return false;
    }

    // Don't remove if it contains the preserved node (e.g., caret position)
    const containsPreservedNode = this.options.preserveNode && isNodeWithin(this.options.preserveNode, strong);

    return !containsPreservedNode;
  }

  /**
   * Merge a <strong> element with adjacent <strong> siblings
   * @param strong - The element to merge with adjacent elements
   */
  private mergeWithAdjacent(strong: HTMLElement): void {
    // Try to merge with previous sibling
    const previous = strong.previousSibling;

    if (previous && isBoldElement(previous)) {
      this.mergeStrongNodes(previous as HTMLElement, strong);

      // strong is now merged into previous, no need to check next
      return;
    }

    // Try to merge with next sibling
    const next = strong.nextSibling;

    if (next && isBoldElement(next)) {
      this.mergeStrongNodes(strong, next as HTMLElement);
    }
  }

  /**
   * Merge two <strong> elements by moving children from right to left
   * @param left - The left strong element to merge into
   * @param right - The right strong element to merge from
   */
  private mergeStrongNodes(left: HTMLElement, right: HTMLElement): void {
    const leftStrong = ensureStrongElement(left);
    const rightStrong = ensureStrongElement(right);

    while (rightStrong.firstChild) {
      leftStrong.appendChild(rightStrong.firstChild);
    }

    rightStrong.remove();
  }

  /**
   * Find the appropriate scope element from a selection
   * @param selection - The current selection
   * @returns The scope element (block or editor root) or null if not found
   */
  private static findScopeFromSelection(selection: Selection | null): Element | null {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return null;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;

    if (!element) {
      return null;
    }

    // Try to find the containing block first (more specific scope)
    const block = element.closest('[data-blok-component="paragraph"]') ??
                  element.closest(createSelector(DATA_ATTR.elementContent));

    if (block) {
      return block;
    }

    // Fallback to editor root
    const editor = element.closest(createSelector(DATA_ATTR.editor));

    return editor;
  }
}

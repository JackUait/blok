import type { InlineTool, SanitizerConfig } from '../../../types';
import { IconBold } from '../icons';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR, createSelector } from '../constants';
import { CollapsedBoldManager } from './services/collapsed-bold-manager';
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
import { InlineToolEventManager } from './services/inline-tool-event-manager';
import { BoldNormalizationPass } from './services/bold-normalization-pass';

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

  private static guardKeydownListenerRegistered = false;

  /**
   * Ensure global event listeners are registered once per document
   */
  private static initializeGlobalListeners(): boolean {
    if (typeof document === 'undefined') {
      return false;
    }

    const manager = InlineToolEventManager.getInstance();

    if (manager.hasHandler('bold')) {
      return true;
    }

    manager.register('bold', {
      shortcut: { key: 'b', meta: true },
      onShortcut: (_event, _selection) => {
        const instance = BoldInlineTool.instances.values().next().value;

        if (instance) {
          instance.toggleBold();
        }
      },
      onSelectionChange: (_selection) => {
        BoldInlineTool.refreshSelectionState('selectionchange');
      },
      onInput: (_event, _selection) => {
        BoldInlineTool.refreshSelectionState('input');
      },
      onBeforeInput: (event) => {
        if (event.inputType !== 'formatBold') {
          return false;
        }

        BoldNormalizationPass.normalizeAroundSelection(window.getSelection());

        return true;
      },
      isRelevant: (selection) => BoldInlineTool.isSelectionInsideBlok(selection),
    });

    // Register a dedicated keydown listener for boundary guard (runs on all printable keys)
    if (!BoldInlineTool.guardKeydownListenerRegistered) {
      document.addEventListener('keydown', BoldInlineTool.guardCollapsedBoundaryKeydown, true);
      BoldInlineTool.guardKeydownListenerRegistered = true;
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
      BoldNormalizationPass.normalizeAroundSelection(selection);
      this.notifySelectionChange();

      return;
    }

    const merged = this.mergeAdjacentBold(boldElement);

    this.selectElementContents(merged);
    BoldNormalizationPass.normalizeAroundSelection(selection);
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

    BoldNormalizationPass.normalizeAroundSelection(selection);

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
        return CollapsedBoldManager.getInstance().exit(selection, insideBold);
      }

      const boundaryBold = insideBold ?? BoldInlineTool.getBoundaryBold(range);

      return boundaryBold
        ? CollapsedBoldManager.getInstance().exit(selection, boundaryBold)
        : this.startCollapsedBold(range);
    })();

    document.dispatchEvent(new Event('selectionchange'));

    if (updatedRange) {
      selection.removeAllRanges();
      selection.addRange(updatedRange);
    }

    BoldNormalizationPass.normalizeAroundSelection(selection);
    this.notifySelectionChange();
  }

  /**
   * Insert a bold wrapper at the caret so newly typed text becomes bold
   * @param range - Current collapsed range
   */
  private startCollapsedBold(range: Range): Range | undefined {
    const manager = CollapsedBoldManager.getInstance();
    const resultRange = manager.enter(range, (strong) => this.mergeAdjacentBold(strong));

    const selection = window.getSelection();

    BoldNormalizationPass.normalizeAroundSelection(selection);

    if (selection && resultRange) {
      selection.removeAllRanges();
      selection.addRange(resultRange);
    }

    this.notifySelectionChange();

    return resultRange;
  }

  /**
   * Notify listeners that the selection state has changed
   */
  private notifySelectionChange(): void {
    CollapsedBoldManager.getInstance().enforceLengths(window.getSelection());
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
   * Normalize selection state after blok input or selection updates
   * @param source - The event source triggering the refresh
   */
  private static refreshSelectionState(source: 'selectionchange' | 'input'): void {
    const selection = window.getSelection();

    CollapsedBoldManager.getInstance().enforceLengths(selection);
    CollapsedBoldManager.getInstance().maintain();
    CollapsedBoldManager.getInstance().synchronize(selection);
    BoldNormalizationPass.normalizeAroundSelection(selection, { normalizeWhitespace: false });

    if (source === 'input' && selection) {
      BoldInlineTool.moveCaretAfterBoundaryBold(selection);
    }
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
        const processScope = (scope: Element | null): void => {
          if (scope) {
            new BoldNormalizationPass({ mergeAdjacent: false, removeEmpty: false, normalizeWhitespace: false }).run(scope);
          }
        };

        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            processScope(BoldInlineTool.findBlokScopeFromNode(node));
          });

          if (mutation.type === 'characterData' && mutation.target) {
            processScope(BoldInlineTool.findBlokScopeFromNode(mutation.target));
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
   * Find the blok scope element from a node for normalization
   * @param node - The node to find the scope from
   * @returns The scope element or null if not within blok
   */
  private static findBlokScopeFromNode(node: Node): Element | null {
    const element = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;

    if (!element || typeof element.closest !== 'function') {
      return null;
    }

    return element.closest(`${createSelector(DATA_ATTR.interface)}, ${createSelector(DATA_ATTR.editor)}`);
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

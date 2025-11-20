import type { InlineTool, SanitizerConfig } from '../../../types';
import { IconBold } from '@codexteam/icons';
import type { MenuConfig } from '../../../types/tools';
import { EDITOR_INTERFACE_SELECTOR } from '../constants';
import SelectionUtils from '../selection';

/**
 * Bold Tool
 *
 * Inline Toolbar Tool
 *
 * Makes selected text bolder
 */
export default class BoldInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   *
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * Title for hover-tooltip
   */
  public static title = 'Bold';

  /**
   * Sanitizer Rule
   * Leave <strong> tags
   *
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      strong: {},
      b: {},
    } as SanitizerConfig;
  }

  /**
   * Normalize any remaining legacy <b> tags within the editor wrapper
   */
  private static normalizeAllBoldTags(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const editorWrapperClass = SelectionUtils.CSS.editorWrapper;
    const selector = `${EDITOR_INTERFACE_SELECTOR} b, .${editorWrapperClass} b`;

    document.querySelectorAll(selector).forEach((boldNode) => {
      BoldInlineTool.ensureStrongElement(boldNode as HTMLElement);
    });
  }

  /**
   * Normalize bold tags within a mutated node if it belongs to the editor
   *
   * @param node - The node affected by mutation
   */
  private static normalizeBoldInNode(node: Node): void {
    const element = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;

    if (!element || typeof element.closest !== 'function') {
      return;
    }

    const editorWrapperClass = SelectionUtils.CSS.editorWrapper;
    const editorRoot = element.closest(`${EDITOR_INTERFACE_SELECTOR}, .${editorWrapperClass}`);

    if (!editorRoot) {
      return;
    }

    if (element.tagName === 'B') {
      BoldInlineTool.ensureStrongElement(element as HTMLElement);
    }

    element.querySelectorAll?.('b').forEach((boldNode) => {
      BoldInlineTool.ensureStrongElement(boldNode as HTMLElement);
    });
  }

  private static shortcutListenerRegistered = false;
  private static selectionListenerRegistered = false;
  private static inputListenerRegistered = false;
  private static beforeInputListenerRegistered = false;
  private static readonly globalListenersInitialized = BoldInlineTool.initializeGlobalListeners();
  private static readonly collapsedExitRecords = new Set<{
    boundary: Text;
    boldElement: HTMLElement;
    allowedLength: number;
    hasLeadingSpace: boolean;
    hasTypedContent: boolean;
    leadingWhitespace: string;
  }>();
  private static markerSequence = 0;
  private static mutationObserver?: MutationObserver;
  private static isProcessingMutation = false;
  private static readonly DATA_ATTR_COLLAPSED_LENGTH = 'data-bold-collapsed-length';
  private static readonly DATA_ATTR_COLLAPSED_ACTIVE = 'data-bold-collapsed-active';
  private static readonly DATA_ATTR_PREV_LENGTH = 'data-bold-prev-length';
  private static readonly DATA_ATTR_LEADING_WHITESPACE = 'data-bold-leading-ws';
  private static readonly instances = new Set<BoldInlineTool>();
  private static readonly pendingBoundaryCaretAdjustments = new WeakSet<Text>();

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
   * Ensure that text typed after exiting a collapsed bold selection stays outside of the bold element
   */
  private static maintainCollapsedExitState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    for (const record of Array.from(BoldInlineTool.collapsedExitRecords)) {
      const resolved = BoldInlineTool.resolveBoundary(record);

      if (!resolved) {
        BoldInlineTool.collapsedExitRecords.delete(record);

        continue;
      }

      record.boundary = resolved.boundary;
      record.boldElement = resolved.boldElement;

      const boundary = resolved.boundary;
      const boldElement = resolved.boldElement;
      const allowedLength = record.allowedLength;
      const currentText = boldElement.textContent ?? '';

      if (currentText.length > allowedLength) {
        const preserved = currentText.slice(0, allowedLength);
        const extra = currentText.slice(allowedLength);

        boldElement.textContent = preserved;
        boundary.textContent = (boundary.textContent ?? '') + extra;
      }

      const boundaryContent = boundary.textContent ?? '';

      if (boundaryContent.length > 1 && boundaryContent.startsWith('\u200B')) {
        boundary.textContent = boundaryContent.slice(1);
      }

      const selection = window.getSelection();

      BoldInlineTool.ensureCaretAtBoundary(selection, boundary);
      BoldInlineTool.scheduleBoundaryCaretAdjustment(boundary);

      const boundaryText = boundary.textContent ?? '';
      const sanitizedBoundary = boundaryText.replace(/\u200B/g, '');
      const leadingMatch = sanitizedBoundary.match(/^\s+/);
      const containsTypedContent = /\S/.test(sanitizedBoundary);
      const selectionStartsWithZws = boundaryText.startsWith('\u200B');

      if (leadingMatch) {
        record.hasLeadingSpace = true;
        record.leadingWhitespace = leadingMatch[0];
      }

      if (containsTypedContent) {
        record.hasTypedContent = true;
      }

      const boundaryHasVisibleLeading = /^\s/.test(sanitizedBoundary);
      const meetsDeletionCriteria = record.hasTypedContent && !selectionStartsWithZws && (boldElement.textContent ?? '').length <= allowedLength;
      const shouldRestoreLeadingSpace = record.hasLeadingSpace && record.hasTypedContent && !boundaryHasVisibleLeading;

      if (meetsDeletionCriteria && shouldRestoreLeadingSpace) {
        const trimmedActual = boundaryText.replace(/^[\u200B\s]+/, '');
        const leadingWhitespace = record.leadingWhitespace || ' ';

        boundary.textContent = `${leadingWhitespace}${trimmedActual}`;
        BoldInlineTool.ensureCaretAtBoundary(selection, boundary);
      }

      if (meetsDeletionCriteria) {
        BoldInlineTool.collapsedExitRecords.delete(record);
      }
    }
  }

  /**
   * Ensure the caret remains at the end of the boundary text node when exiting bold
   *
   * @param selection - Current document selection
   * @param boundary - Text node following the bold element
   */
  private static ensureCaretAtBoundary(selection: Selection | null, boundary: Text): void {
    if (!selection || !selection.isCollapsed) {
      return;
    }

    BoldInlineTool.setCaretToBoundaryEnd(selection, boundary);
  }

  /**
   * Ensure the caret remains at the end of the boundary text node after the current microtask queue is flushed
   *
   * @param boundary - Boundary text node that should keep the caret at its end
   */
  private static scheduleBoundaryCaretAdjustment(boundary: Text): void {
    if (BoldInlineTool.pendingBoundaryCaretAdjustments.has(boundary)) {
      return;
    }

    BoldInlineTool.pendingBoundaryCaretAdjustments.add(boundary);

    setTimeout(() => {
      BoldInlineTool.pendingBoundaryCaretAdjustments.delete(boundary);

      const ownerDocument = boundary.ownerDocument ?? (typeof document !== 'undefined' ? document : null);

      if (!ownerDocument) {
        return;
      }

      const selection = ownerDocument.getSelection();

      if (!selection || !selection.isCollapsed || selection.anchorNode !== boundary) {
        return;
      }

      const targetOffset = boundary.textContent?.length ?? 0;

      if (selection.anchorOffset === targetOffset) {
        return;
      }

      BoldInlineTool.setCaret(selection, boundary, targetOffset);
    }, 0);
  }

  /**
   * Ensure there is a text node immediately following the provided bold element.
   * Creates one when necessary.
   *
   * @param boldElement - Bold element that precedes the boundary
   * @returns The text node following the bold element or null if it cannot be created
   */
  private static ensureTextNodeAfter(boldElement: HTMLElement): Text | null {
    const existingNext = boldElement.nextSibling;

    if (existingNext?.nodeType === Node.TEXT_NODE) {
      return existingNext as Text;
    }

    const parent = boldElement.parentNode;

    if (!parent) {
      return null;
    }

    const documentRef = boldElement.ownerDocument ?? (typeof document !== 'undefined' ? document : null);

    if (!documentRef) {
      return null;
    }

    const newNode = documentRef.createTextNode('');

    parent.insertBefore(newNode, existingNext);

    return newNode;
  }

  /**
   * Resolve the boundary text node tracked for a collapsed exit record.
   *
   * @param record - Collapsed exit tracking record
   * @returns The aligned boundary text node or null when it cannot be determined
   */
  private static resolveBoundary(record: { boundary: Text; boldElement: HTMLElement }): { boundary: Text; boldElement: HTMLElement } | null {
    if (!record.boldElement.isConnected) {
      return null;
    }

    const strong = BoldInlineTool.ensureStrongElement(record.boldElement);
    const boundary = record.boundary;
    const isAligned = boundary.isConnected && boundary.previousSibling === strong;
    const resolvedBoundary = isAligned ? boundary : BoldInlineTool.ensureTextNodeAfter(strong);

    if (!resolvedBoundary) {
      return null;
    }

    return {
      boundary: resolvedBoundary,
      boldElement: strong,
    };
  }

  /**
   * Move caret to the end of the provided boundary text node
   *
   * @param selection - Current selection to update
   * @param boundary - Boundary text node that hosts the caret
   */
  private static setCaretToBoundaryEnd(selection: Selection, boundary: Text): void {
    const range = document.createRange();
    const caretOffset = boundary.textContent?.length ?? 0;

    range.setStart(boundary, caretOffset);
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * Recursively check if a node or any of its parents is a bold tag (<strong>)
   *
   * @param node - The node to check
   */
  private static hasBoldParent(node: Node | null): boolean {
    if (!node) {
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE && BoldInlineTool.isBoldTag(node as Element)) {
      return true;
    }

    return BoldInlineTool.hasBoldParent(node.parentNode);
  }

  /**
   * Recursively find a bold element (<strong>) in the parent chain
   *
   * @param node - The node to start searching from
   */
  private static findBoldElement(node: Node | null): HTMLElement | null {
    if (!node) {
      return null;
    }

    if (node.nodeType === Node.ELEMENT_NODE && BoldInlineTool.isBoldTag(node as Element)) {
      return BoldInlineTool.ensureStrongElement(node as HTMLElement);
    }

    return BoldInlineTool.findBoldElement(node.parentNode);
  }

  /**
   * Check if an element is a bold tag (<strong> for conversion)
   *
   * @param node - The element to check
   */
  private static isBoldTag(node: Element): boolean {
    const tag = node.tagName;

    return tag === 'B' || tag === 'STRONG';
  }

  /**
   * Ensure an element is a <strong> tag, converting from <b> if needed
   *
   * @param element - The element to ensure is a strong tag
   */
  private static ensureStrongElement(element: HTMLElement): HTMLElement {
    if (element.tagName === 'STRONG') {
      return element;
    }

    const strong = document.createElement('strong');

    if (element.hasAttributes()) {
      Array.from(element.attributes).forEach((attr) => {
        strong.setAttribute(attr.name, attr.value);
      });
    }

    while (element.firstChild) {
      strong.appendChild(element.firstChild);
    }

    element.replaceWith(strong);

    return strong;
  }

  /**
   * Merge two strong elements by moving children from right to left
   *
   * @param left - The left strong element to merge into
   * @param right - The right strong element to merge from
   */
  private static mergeStrongNodes(left: HTMLElement, right: HTMLElement): HTMLElement {
    const leftStrong = BoldInlineTool.ensureStrongElement(left);
    const rightStrong = BoldInlineTool.ensureStrongElement(right);

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
   *
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
   *
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

    const boldElement = selection ? BoldInlineTool.findBoldElement(selection.focusNode) : null;

    if (!boldElement) {
      return;
    }

    const merged = this.mergeAdjacentBold(boldElement);

    this.normalizeWhitespaceAround(merged);

    this.selectElementContents(merged);
    BoldInlineTool.normalizeBoldTagsWithinEditor(window.getSelection());
    BoldInlineTool.replaceNbspInBlock(window.getSelection());
    this.notifySelectionChange();
  }

  /**
   * Remove bold tags (<strong>) while preserving content
   *
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

    marker.dataset.boldMarker = `unwrap-${BoldInlineTool.markerSequence++}`;
    marker.appendChild(fragment);
    this.removeNestedBold(marker);

    range.insertNode(marker);

    const markerRange = document.createRange();

    markerRange.selectNodeContents(marker);
    selection.removeAllRanges();
    selection.addRange(markerRange);

    for (; ;) {
      const currentBold = BoldInlineTool.findBoldElement(marker);

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
    BoldInlineTool.normalizeBoldTagsWithinEditor(selection);
    BoldInlineTool.replaceNbspInBlock(selection);
    BoldInlineTool.removeEmptyBoldElements(selection);

    boldAncestors.forEach((element) => {
      if (BoldInlineTool.isElementEmpty(element)) {
        element.remove();
      }
    });

    this.notifySelectionChange();
  }

  /**
   * Replace the current range contents with provided HTML snippet
   *
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
   *
   * @param marker - Marker element wrapping the selection contents
   * @param boldElement - Bold ancestor containing the marker
   */
  private moveMarkerOutOfBold(marker: HTMLElement, boldElement: HTMLElement): void {
    const parent = boldElement.parentNode;

    if (!parent) {
      return;
    }

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
   *
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
   * Set a shortcut
   *
   * @returns {boolean}
   */
  public get shortcut(): string {
    return 'CMD+B';
  }

  /**
   * Check if a range contains bold text
   *
   * @param range - The range to check
   * @param options - Options for checking bold status
   * @param options.ignoreWhitespace - Whether to ignore whitespace-only text nodes
   */
  private isRangeBold(range: Range, options: { ignoreWhitespace: boolean }): boolean {
    if (range.collapsed) {
      return Boolean(BoldInlineTool.findBoldElement(range.startContainer));
    }

    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          try {
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          } catch (error) {
            /**
             * Safari might throw if node is detached from DOM.
             * In that case, fall back to manual comparison by wrapping node into a range.
             */
            const nodeRange = document.createRange();

            nodeRange.selectNodeContents(node);

            const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) > 0;
            const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0;

            return (startsBeforeEnd && endsAfterStart) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        },
      }
    );

    const textNodes: Text[] = [];

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const value = textNode.textContent ?? '';

      if (options.ignoreWhitespace && value.trim().length === 0) {
        continue;
      }

      if (value.length === 0) {
        continue;
      }

      textNodes.push(textNode);
    }

    if (textNodes.length === 0) {
      return Boolean(BoldInlineTool.findBoldElement(range.startContainer));
    }

    return textNodes.every((textNode) => BoldInlineTool.hasBoldParent(textNode));
  }

  /**
   * Remove nested bold tags from a root node
   *
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
   *
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
   * Merge adjacent bold elements into a single element
   *
   * @param element - The bold element to merge with adjacent elements
   */
  private mergeAdjacentBold(element: HTMLElement): HTMLElement {
    const initialTarget = BoldInlineTool.ensureStrongElement(element);

    const previous = initialTarget.previousSibling;
    const targetAfterPrevious = previous && previous.nodeType === Node.ELEMENT_NODE && BoldInlineTool.isBoldTag(previous as Element)
      ? BoldInlineTool.mergeStrongNodes(previous as HTMLElement, initialTarget)
      : initialTarget;

    const next = targetAfterPrevious.nextSibling;
    const finalTarget = next && next.nodeType === Node.ELEMENT_NODE && BoldInlineTool.isBoldTag(next as Element)
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
    const insideBold = BoldInlineTool.findBoldElement(range.startContainer);

    const updatedRange = (() => {
      if (insideBold && insideBold.getAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE) !== 'true') {
        return BoldInlineTool.exitCollapsedBold(selection, insideBold);
      }

      const boundaryBold = insideBold ?? BoldInlineTool.getBoundaryBold(range);

      return boundaryBold
        ? BoldInlineTool.exitCollapsedBold(selection, boundaryBold)
        : this.startCollapsedBold(range);
    })();

    document.dispatchEvent(new Event('selectionchange'));

    if (updatedRange) {
      selection.removeAllRanges();
      selection.addRange(updatedRange);
    }

    BoldInlineTool.normalizeBoldTagsWithinEditor(selection);
    BoldInlineTool.replaceNbspInBlock(selection);
    BoldInlineTool.removeEmptyBoldElements(selection);
    this.notifySelectionChange();
  }

  /**
   * Insert a bold wrapper at the caret so newly typed text becomes bold
   *
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

    BoldInlineTool.normalizeBoldTagsWithinEditor(selection);
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
   *
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
   *
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
   *
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
    const editorWrapper = anchorElement?.closest(`.${SelectionUtils.CSS.editorWrapper}`);

    if (!editorWrapper) {
      return;
    }

    const toolbar = editorWrapper.querySelector('[data-cy=inline-toolbar]');

    if (!(toolbar instanceof HTMLElement)) {
      return;
    }

    const button = toolbar.querySelector('[data-item-name="bold"]');

    if (!(button instanceof HTMLElement)) {
      return;
    }

    const isActive = this.isSelectionVisuallyBold(selection);

    button.classList.toggle('ce-popover-item--active', isActive);

    if (isActive) {
      button.setAttribute('data-popover-item-active', 'true');
    } else {
      button.removeAttribute('data-popover-item-active');
    }
  }

  /**
   * Normalize whitespace around a bold element
   *
   * @param element - The bold element to normalize whitespace around
   */
  private normalizeWhitespaceAround(element: HTMLElement): void {
    BoldInlineTool.replaceNbspWithSpace(element.previousSibling);
    BoldInlineTool.replaceNbspWithSpace(element.nextSibling);
  }

  /**
   * Replace non-breaking spaces with regular spaces in a text node
   *
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
   * Restore a selection range from marker elements
   *
   * @param markerId - The ID of the markers used to mark the selection
   */
  private restoreSelectionFromMarkers(markerId: string): Range | undefined {
    const startMarker = document.querySelector(`[data-bold-marker="${markerId}-start"]`);
    const endMarker = document.querySelector(`[data-bold-marker="${markerId}-end"]`);

    if (!startMarker || !endMarker) {
      startMarker?.remove();
      endMarker?.remove();

      return;
    }

    const selection = window.getSelection();

    if (!selection) {
      startMarker.remove();
      endMarker.remove();

      return;
    }

    const newRange = document.createRange();

    newRange.setStartAfter(startMarker);
    newRange.setEndBefore(endMarker);

    selection.removeAllRanges();
    selection.addRange(newRange);

    startMarker.remove();
    endMarker.remove();

    return newRange;
  }

  /**
   * Replace non-breaking spaces with regular spaces within a range
   *
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
          } catch (error) {
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
   * Normalize all bold tags within the editor to <strong> tags
   * Converts any legacy <b> tags to <strong> tags
   *
   * @param selection - The current selection to determine the editor context
   */
  private static normalizeBoldTagsWithinEditor(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const root = element?.closest(`.${SelectionUtils.CSS.editorWrapper}`);

    if (!root) {
      return;
    }

    // Convert any legacy <b> tags to <strong> tags
    root.querySelectorAll('b').forEach((boldNode) => {
      BoldInlineTool.ensureStrongElement(boldNode as HTMLElement);
    });
  }

  /**
   * Replace non-breaking spaces with regular spaces in the block containing the selection
   *
   * @param selection - The current selection to determine the block context
   */
  private static replaceNbspInBlock(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const block = element?.closest('[data-block-tool="paragraph"]');

    if (!block) {
      return;
    }

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      BoldInlineTool.replaceNbspWithSpace(walker.currentNode);
    }

    block.querySelectorAll('b').forEach((boldNode) => {
      BoldInlineTool.ensureStrongElement(boldNode as HTMLElement);
    });
  }

  /**
   * Remove empty bold elements within the current block
   *
   * @param selection - The current selection to determine the block context
   */
  private static removeEmptyBoldElements(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const block = element?.closest('[data-block-tool="paragraph"]');

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

      if ((strong.textContent ?? '').length === 0 && !BoldInlineTool.isNodeWithin(focusNode, strong)) {
        strong.remove();
      }
    });
  }

  /**
   * Ensure collapsed bold placeholders absorb newly typed text
   *
   * @param selection - The current selection to determine the editor context
   */
  private static synchronizeCollapsedBold(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;
    const element = node && node.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
    const root = element?.closest(`.${SelectionUtils.CSS.editorWrapper}`) ?? element?.ownerDocument;

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

      if (!selection?.isCollapsed || !BoldInlineTool.isNodeWithin(selection.focusNode, prevTextNode)) {
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
   *
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

    const activePlaceholder = BoldInlineTool.findBoldElement(range.startContainer);

    if (activePlaceholder?.getAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE) === 'true') {
      return;
    }

    if (BoldInlineTool.moveCaretFromElementContainer(selection, range)) {
      return;
    }

    BoldInlineTool.moveCaretFromTextContainer(selection, range);
  }

  /**
   * Locate a bold element adjacent to a collapsed range
   *
   * @param range - Range to inspect
   */
  private static getAdjacentBold(range: Range): HTMLElement | null {
    const container = range.startContainer;

    if (container.nodeType === Node.TEXT_NODE) {
      return BoldInlineTool.getBoldAdjacentToText(range, container as Text);
    }

    if (container.nodeType === Node.ELEMENT_NODE) {
      return BoldInlineTool.getBoldAdjacentToElement(range, container as Element);
    }

    return null;
  }

  /**
   * Get bold element adjacent to a text node container
   *
   * @param range - Current collapsed range
   * @param textNode - Text node hosting the caret
   */
  private static getBoldAdjacentToText(range: Range, textNode: Text): HTMLElement | null {
    const textLength = textNode.textContent?.length ?? 0;
    const previous = textNode.previousSibling;

    if (range.startOffset === 0 && BoldInlineTool.isBoldElement(previous)) {
      return previous as HTMLElement;
    }

    if (range.startOffset !== textLength) {
      return null;
    }

    const next = textNode.nextSibling;

    return BoldInlineTool.isBoldElement(next) ? next as HTMLElement : null;
  }

  /**
   * Get bold element adjacent to an element container
   *
   * @param range - Current collapsed range
   * @param element - Element containing the caret
   */
  private static getBoldAdjacentToElement(range: Range, element: Element): HTMLElement | null {
    const previous = range.startOffset > 0 ? element.childNodes[range.startOffset - 1] ?? null : null;

    if (BoldInlineTool.isBoldElement(previous)) {
      return previous as HTMLElement;
    }

    const next = element.childNodes[range.startOffset] ?? null;

    return BoldInlineTool.isBoldElement(next) ? next as HTMLElement : null;
  }

  /**
   * Exit collapsed bold state when caret no longer resides within bold content
   *
   * @param selection - Current selection
   * @param range - Collapsed range after toggling bold
   */
  private static exitCollapsedIfNeeded(selection: Selection, range: Range): void {
    const insideBold = Boolean(BoldInlineTool.findBoldElement(range.startContainer));

    if (insideBold) {
      return;
    }

    const boundaryBold = BoldInlineTool.getBoundaryBold(range) ?? BoldInlineTool.getAdjacentBold(range);

    if (!boundaryBold) {
      return;
    }

    const caretRange = BoldInlineTool.exitCollapsedBold(selection, boundaryBold);

    if (!caretRange) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(caretRange);
  }

  /**
   * Adjust caret when selection container is an element adjacent to bold content
   *
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
   *
   * @param selection - Current selection
   * @param element - Container element
   * @param offset - Caret offset within the container
   */
  private static moveCaretAfterPreviousBold(selection: Selection, element: Element, offset: number): boolean {
    const beforeNode = offset > 0 ? element.childNodes[offset - 1] ?? null : null;

    if (!BoldInlineTool.isBoldElement(beforeNode)) {
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
   *
   * @param selection - Current selection
   * @param element - Container element
   * @param offset - Caret offset within the container
   */
  private static moveCaretBeforeNextBold(selection: Selection, element: Element, offset: number): boolean {
    const nextNode = element.childNodes[offset] ?? null;

    if (!BoldInlineTool.isBoldElement(nextNode)) {
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
   *
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
      BoldInlineTool.isBoldElement(previousSibling) &&
      (textContent.length === 0 || startsWithWhitespace)
    ) {
      BoldInlineTool.setCaret(selection, textNode, textContent.length);

      return;
    }

    const boldElement = BoldInlineTool.findBoldElement(textNode);

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
   *
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

    if (!BoldInlineTool.isBoldElement(previousSibling)) {
      return;
    }

    if (!/^\s/.test(textContent)) {
      return;
    }

    BoldInlineTool.setCaret(selection, textNode, textContent.length);
  }

  /**
   * Determine whether a node is a bold element (<strong>/<b>)
   *
   * @param node - Node to inspect
   */
  private static isBoldElement(node: Node | null): node is Element {
    return Boolean(node && node.nodeType === Node.ELEMENT_NODE && BoldInlineTool.isBoldTag(node as Element));
  }

  /**
   * Place caret at the provided offset within a text node
   *
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
   *
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
   *
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
   *
   * @param selection - The current selection to determine the editor context
   */
  private static enforceCollapsedBoldLengths(selection: Selection | null): void {
    const node = selection?.anchorNode ?? selection?.focusNode;

    if (!node) {
      return;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const root = element?.closest(`.${SelectionUtils.CSS.editorWrapper}`);

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

      if (selection?.isCollapsed && newTextNodeAfterSplit && BoldInlineTool.isNodeWithin(selection.focusNode, boldEl)) {
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
   *
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
   *
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
   * Normalize selection state after editor input or selection updates
   *
   * @param source - The event source triggering the refresh
   */
  private static refreshSelectionState(source: 'selectionchange' | 'input'): void {
    const selection = window.getSelection();

    BoldInlineTool.enforceCollapsedBoldLengths(selection);
    BoldInlineTool.maintainCollapsedExitState();
    BoldInlineTool.synchronizeCollapsedBold(selection);
    BoldInlineTool.normalizeBoldTagsWithinEditor(selection);
    BoldInlineTool.replaceNbspInBlock(selection);
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
   *
   * @param event - BeforeInput event fired by the browser
   */
  private static handleBeforeInput(event: InputEvent): void {
    if (event.inputType !== 'formatBold') {
      return;
    }

    const selection = window.getSelection();
    const isSelectionInside = Boolean(selection && BoldInlineTool.isSelectionInsideEditor(selection));
    const isTargetInside = BoldInlineTool.isEventTargetInsideEditor(event.target);

    if (!isSelectionInside && !isTargetInside) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    BoldInlineTool.normalizeAllBoldTags();
  }

  /**
   * Attempt to toggle bold via the browser's native command
   *
   * @param selection - Current selection
   */
  /**
   * Exit a collapsed bold selection by moving the caret outside the bold element
   *
   * @param selection - The current selection
   * @param boldElement - The bold element to exit from
   */
  private static exitCollapsedBold(selection: Selection, boldElement: HTMLElement): Range | undefined {
    const normalizedBold = BoldInlineTool.ensureStrongElement(boldElement);
    const parent = normalizedBold.parentNode;

    if (!parent) {
      return;
    }

    if (BoldInlineTool.isElementEmpty(normalizedBold)) {
      return BoldInlineTool.removeEmptyBoldElement(selection, normalizedBold, parent);
    }

    return BoldInlineTool.exitCollapsedBoldWithContent(selection, normalizedBold, parent);
  }

  /**
   * Remove an empty bold element and place the caret before its position
   *
   * @param selection - Current selection
   * @param boldElement - Bold element to remove
   * @param parent - Parent node that hosts the bold element
   */
  private static removeEmptyBoldElement(selection: Selection, boldElement: HTMLElement, parent: ParentNode): Range {
    const newRange = document.createRange();

    newRange.setStartBefore(boldElement);
    newRange.collapse(true);

    parent.removeChild(boldElement);

    selection.removeAllRanges();
    selection.addRange(newRange);

    return newRange;
  }

  /**
   * Exit a collapsed bold state when the bold element still contains text
   *
   * @param selection - Current selection
   * @param boldElement - Bold element currently wrapping the caret
   * @param parent - Parent node that hosts the bold element
   */
  private static exitCollapsedBoldWithContent(selection: Selection, boldElement: HTMLElement, parent: ParentNode): Range {
    boldElement.setAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_LENGTH, (boldElement.textContent?.length ?? 0).toString());
    boldElement.removeAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH);
    boldElement.removeAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE);
    boldElement.removeAttribute(BoldInlineTool.DATA_ATTR_LEADING_WHITESPACE);

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

    const trackedBold = BoldInlineTool.ensureStrongElement(boldElement);

    BoldInlineTool.collapsedExitRecords.add({
      boundary,
      boldElement: trackedBold,
      allowedLength: trackedBold.textContent?.length ?? 0,
      hasLeadingSpace: false,
      hasTypedContent: false,
      leadingWhitespace: '',
    });

    return newRange;
  }

  /**
   * Get a bold element at the boundary of a collapsed range
   *
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
   *
   * @param range - Collapsed range
   * @param textNode - Text container
   */
  private static getBoundaryBoldForText(range: Range, textNode: Text): HTMLElement | null {
    const length = textNode.textContent?.length ?? 0;

    if (range.startOffset === length) {
      return BoldInlineTool.findBoldElement(textNode);
    }

    if (range.startOffset !== 0) {
      return null;
    }

    const previous = textNode.previousSibling;

    return BoldInlineTool.isBoldElement(previous) ? previous as HTMLElement : null;
  }

  /**
   * Get boundary bold when caret container is an element
   *
   * @param range - Collapsed range
   * @param element - Element container
   */
  private static getBoundaryBoldForElement(range: Range, element: Element): HTMLElement | null {
    if (range.startOffset <= 0) {
      return null;
    }

    const previous = element.childNodes[range.startOffset - 1];

    return BoldInlineTool.isBoldElement(previous) ? previous as HTMLElement : null;
  }

  /**
   * Handle keyboard shortcut for bold when selection is collapsed
   *
   * @param event - The keyboard event
   */
  private static handleShortcut(event: KeyboardEvent): void {
    BoldInlineTool.guardCollapsedBoundaryKeydown(event);

    if (!BoldInlineTool.isBoldShortcut(event)) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || !selection.rangeCount || !BoldInlineTool.isSelectionInsideEditor(selection)) {
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
   *
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
   * Check if a selection is inside the editor
   *
   * @param selection - The selection to check
   */
  private static isSelectionInsideEditor(selection: Selection): boolean {
    const anchor = selection.anchorNode;

    if (!anchor) {
      return false;
    }

    const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;

    return Boolean(element?.closest(`.${SelectionUtils.CSS.editorWrapper}`));
  }

  /**
   * Check if an event target resides inside the editor wrapper
   *
   * @param target - Event target to inspect
   */
  private static isEventTargetInsideEditor(target: EventTarget | null): boolean {
    if (!target || typeof Node === 'undefined') {
      return false;
    }

    if (target instanceof Element) {
      return Boolean(target.closest(`.${SelectionUtils.CSS.editorWrapper}`));
    }

    if (target instanceof Text) {
      return Boolean(target.parentElement?.closest(`.${SelectionUtils.CSS.editorWrapper}`));
    }

    if (typeof ShadowRoot !== 'undefined' && target instanceof ShadowRoot) {
      return BoldInlineTool.isEventTargetInsideEditor(target.host);
    }

    if (!(target instanceof Node)) {
      return false;
    }

    const parentNode = target.parentNode;

    if (!parentNode) {
      return false;
    }

    if (parentNode instanceof Element) {
      return Boolean(parentNode.closest(`.${SelectionUtils.CSS.editorWrapper}`));
    }

    return BoldInlineTool.isEventTargetInsideEditor(parentNode);
  }

  /**
   * Get HTML content of a range with bold tags removed
   *
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
   *
   * @param html - HTML string to convert
   */
  private static createFragmentFromHtml(html: string): DocumentFragment {
    const template = document.createElement('template');

    template.innerHTML = html;

    return template.content;
  }

  /**
   * Collect all bold ancestor elements within a range
   *
   * @param range - The range to search for bold ancestors
   */
  private collectBoldAncestors(range: Range): HTMLElement[] {
    const ancestors = new Set<HTMLElement>();
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          try {
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          } catch (error) {
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
      const boldElement = BoldInlineTool.findBoldElement(walker.currentNode);

      if (boldElement) {
        ancestors.add(boldElement);
      }
    }

    return Array.from(ancestors);
  }
}

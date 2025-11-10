import type { InlineTool, SanitizerConfig } from '../../../types';
import { IconBold } from '@codexteam/icons';
import type { MenuConfig } from '../../../types/tools';
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
    } as SanitizerConfig;
  }

  private static shortcutListenerRegistered = false;
  private static selectionListenerRegistered = false;
  private static inputListenerRegistered = false;
  private static markerSequence = 0;
  private static readonly DATA_ATTR_COLLAPSED_LENGTH = 'data-bold-collapsed-length';
  private static readonly DATA_ATTR_COLLAPSED_ACTIVE = 'data-bold-collapsed-active';
  private static readonly DATA_ATTR_PREV_LENGTH = 'data-bold-prev-length';
  private static readonly instances = new Set<BoldInlineTool>();

  /**
   *
   */
  constructor() {
    if (typeof document === 'undefined') {
      return;
    }

    BoldInlineTool.instances.add(this);

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
      return node as HTMLElement;
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

    for (;;) {
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
    const boldElement = BoldInlineTool.findBoldElement(range.startContainer) ?? BoldInlineTool.getBoundaryBold(range);

    if (boldElement) {
      const caretRange = BoldInlineTool.exitCollapsedBold(selection, boldElement);

      if (caretRange) {
        selection.removeAllRanges();
        selection.addRange(caretRange);
      }
    } else {
      const newRange = this.startCollapsedBold(range);

      if (newRange) {
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
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

    if (container.nodeType === Node.TEXT_NODE) {
      const text = container as Text;
      const parent = text.parentNode;

      if (!parent) {
        return;
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
      strong.setAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH, before.length.toString());
    } else if (container.nodeType === Node.ELEMENT_NODE) {
      const element = container as Element;
      const referenceNode = element.childNodes[offset] ?? null;

      element.insertBefore(strong, referenceNode);
      strong.setAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH, '0');
    } else {
      return;
    }

    const newRange = document.createRange();

    newRange.setStart(textNode, 0);
    newRange.collapse(true);

    return newRange;
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

      const boldTextNode = boldElement.firstChild instanceof Text
        ? boldElement.firstChild as Text
        : boldElement.appendChild(document.createTextNode('')) as Text;

      boldTextNode.textContent = (boldTextNode.textContent ?? '') + extra;

      if (selection?.isCollapsed && BoldInlineTool.isNodeWithin(selection.focusNode, prevTextNode)) {
        const newRange = document.createRange();
        const caretOffset = boldTextNode.textContent?.length ?? 0;

        newRange.setStart(boldTextNode, caretOffset);
        newRange.collapse(true);

        selection.removeAllRanges();
        selection.addRange(newRange);
      }
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
      const textNode = container as Text;
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

    if (container.nodeType === Node.ELEMENT_NODE) {
      const element = container as Element;
      const previous = range.startOffset > 0 ? element.childNodes[range.startOffset - 1] ?? null : null;

      if (BoldInlineTool.isBoldElement(previous)) {
        return previous as HTMLElement;
      }

      const next = element.childNodes[range.startOffset] ?? null;

      return BoldInlineTool.isBoldElement(next) ? next as HTMLElement : null;
    }

    return null;
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
    const beforeNode = range.startOffset > 0 ? element.childNodes[range.startOffset - 1] ?? null : null;

    if (BoldInlineTool.isBoldElement(beforeNode)) {
      const textNode = BoldInlineTool.ensureFollowingTextNode(beforeNode as Element, beforeNode.nextSibling);

      if (textNode) {
        BoldInlineTool.setCaret(selection, textNode, 0);

        return true;
      }
    }

    const nextNode = element.childNodes[range.startOffset] ?? null;

    if (!BoldInlineTool.isBoldElement(nextNode)) {
      return false;
    }

    const textNode = BoldInlineTool.ensureFollowingTextNode(nextNode as Element, nextNode.nextSibling);

    if (textNode) {
      BoldInlineTool.setCaret(selection, textNode, 0);

      return true;
    }

    BoldInlineTool.setCaretAfterNode(selection, nextNode);

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

      const newTextNodeAfterSplit: Text | null = (() => {
        if (shouldRemoveCurrentLength) {
          const preserved = currentText.slice(0, allowedLength);
          const extra = currentText.slice(allowedLength);

          boldEl.textContent = preserved;

          const textNode = document.createTextNode(extra);

          if (boldEl.parentNode) {
            boldEl.parentNode.insertBefore(textNode, boldEl.nextSibling);

            return textNode;
          }
        }

        return null;
      })();

      const prevLengthAttr = boldEl.getAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH);

      const shouldRemovePrevLength = (() => {
        if (!prevLengthAttr) {
          return false;
        }

        const prevLength = Number(prevLengthAttr);
        const prevNode = boldEl.previousSibling;

        if (!prevNode || prevNode.nodeType !== Node.TEXT_NODE || !Number.isFinite(prevLength)) {
          return false;
        }

        const prevText = prevNode.textContent ?? '';

        if (prevText.length <= prevLength) {
          return false;
        }

        const preservedPrev = prevText.slice(0, prevLength);
        const extraPrev = prevText.slice(prevLength);

        prevNode.textContent = preservedPrev;
        const extraNode = document.createTextNode(extraPrev);

        boldEl.parentNode?.insertBefore(extraNode, boldEl.nextSibling);

        return true;
      })();

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
    BoldInlineTool.enforceCollapsedBoldLengths(window.getSelection());
    BoldInlineTool.synchronizeCollapsedBold(window.getSelection());
  }

  /**
   *
   */
  private static handleGlobalInput(): void {
    BoldInlineTool.enforceCollapsedBoldLengths(window.getSelection());
    BoldInlineTool.synchronizeCollapsedBold(window.getSelection());
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
    if (BoldInlineTool.isElementEmpty(boldElement)) {
      const newRange = document.createRange();
      const parent = boldElement.parentNode;

      if (!parent) {
        return;
      }

      newRange.setStartBefore(boldElement);
      newRange.collapse(true);

      parent.removeChild(boldElement);

      selection.removeAllRanges();
      selection.addRange(newRange);

      return newRange;
    }

    boldElement.setAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_LENGTH, (boldElement.textContent?.length ?? 0).toString());
    boldElement.removeAttribute(BoldInlineTool.DATA_ATTR_PREV_LENGTH);
    boldElement.removeAttribute(BoldInlineTool.DATA_ATTR_COLLAPSED_ACTIVE);

    const parent = boldElement.parentNode;

    if (!parent) {
      return;
    }

    const initialNextSibling = boldElement.nextSibling;
    const needsNewNode = !initialNextSibling || initialNextSibling.nodeType !== Node.TEXT_NODE;
    const newNode = needsNewNode ? document.createTextNode('') : null;

    if (newNode) {
      parent.insertBefore(newNode, initialNextSibling);
    }

    const nextSibling = newNode ?? initialNextSibling;

    const textNode = nextSibling as Text;
    const newRange = document.createRange();

    newRange.setStart(textNode, 0);
    newRange.collapse(true);

    selection.removeAllRanges();
    selection.addRange(newRange);

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
      const textNode = container as Text;
      const length = textNode.textContent?.length ?? 0;

      if (range.startOffset === length) {
        return BoldInlineTool.findBoldElement(textNode);
      }

      const previous = range.startOffset === 0 ? textNode.previousSibling : null;

      if (previous?.nodeType === Node.ELEMENT_NODE && BoldInlineTool.isBoldTag(previous as Element)) {
        return previous as HTMLElement;
      }

      return null;
    }

    if (container.nodeType === Node.ELEMENT_NODE && range.startOffset > 0) {
      const element = container as Element;
      const previous = element.childNodes[range.startOffset - 1];

      if (previous && previous.nodeType === Node.ELEMENT_NODE && BoldInlineTool.isBoldTag(previous as Element)) {
        return previous as HTMLElement;
      }
    }

    return null;
  }

  /**
   * Handle keyboard shortcut for bold when selection is collapsed
   *
   * @param event - The keyboard event
   */
  private static handleShortcut(event: KeyboardEvent): void {
    if (!BoldInlineTool.isBoldShortcut(event)) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || !selection.rangeCount || !BoldInlineTool.isSelectionInsideEditor(selection)) {
      return;
    }

    const instance = BoldInlineTool.instances.values().next().value;

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
    const platform = typeof navigator !== 'undefined' ? navigator.platform : '';
    const isMac = platform.toUpperCase().includes('MAC');
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

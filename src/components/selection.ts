/**
 * TextRange interface for IE9-
 */
import * as _ from './utils';
import $ from './dom';
import { BLOK_FAKE_CURSOR_ATTR, BLOK_FAKE_CURSOR_SELECTOR, BLOK_REDACTOR_SELECTOR } from './constants';

interface TextRange {
  boundingTop: number;
  boundingLeft: number;
  boundingBottom: number;
  boundingRight: number;
  boundingHeight: number;
  boundingWidth: number;
}

/**
 * Interface for object returned by document.selection in IE9-
 */
interface MSSelection {
  createRange: () => TextRange;
  type: string;
}

/**
 * Extends Document interface for IE9-
 */
interface Document {
  selection?: MSSelection;
}

/**
 * Working with selection
 * @typedef {SelectionUtils} SelectionUtils
 */
export default class SelectionUtils {
  /**
   * Selection instances
   * @todo Check if this is still relevant
   */
  public instance: Selection | null = null;
  public selection: Selection | null = null;

  /**
   * This property can store SelectionUtils's range for restoring later
   * @type {Range|null}
   */
  public savedSelectionRange: Range | null = null;

  /**
   * Fake background is active
   * @returns {boolean}
   */
  public isFakeBackgroundEnabled = false;

  /**
   * The contenteditable element that had the selection when fake background was enabled
   * Used to restore focus and selection when fake background is removed
   */
  private selectionContainer: HTMLElement | null = null;

  /**
   * Returns selected anchor
   * {@link https://developer.mozilla.org/ru/docs/Web/API/Selection/anchorNode}
   * @returns {Node|null}
   */
  public static get anchorNode(): Node | null {
    const selection = window.getSelection();

    return selection ? selection.anchorNode : null;
  }

  /**
   * Returns selected anchor element
   * @returns {Element|null}
   */
  public static get anchorElement(): Element | null {
    const selection = window.getSelection();

    if (!selection) {
      return null;
    }

    const anchorNode = selection.anchorNode;

    if (!anchorNode) {
      return null;
    }

    if (!$.isElement(anchorNode)) {
      return anchorNode.parentElement;
    } else {
      return anchorNode;
    }
  }

  /**
   * Returns selection offset according to the anchor node
   * {@link https://developer.mozilla.org/ru/docs/Web/API/Selection/anchorOffset}
   * @returns {number|null}
   */
  public static get anchorOffset(): number | null {
    const selection = window.getSelection();

    return selection ? selection.anchorOffset : null;
  }

  /**
   * Is current selection range collapsed
   * @returns {boolean|null}
   */
  public static get isCollapsed(): boolean | null {
    const selection = window.getSelection();

    return selection ? selection.isCollapsed : null;
  }

  /**
   * Check current selection if it is at Blok's zone
   * @returns {boolean}
   */
  public static get isAtBlok(): boolean {
    return this.isSelectionAtBlok(SelectionUtils.get());
  }

  /**
   * Check if passed selection is at Blok's zone
   * @param selection - Selection object to check
   */
  public static isSelectionAtBlok(selection: Selection | null): boolean {
    if (!selection) {
      return false;
    }

    /**
     * Something selected on document
     */
    const initialNode = selection.anchorNode || selection.focusNode;
    const selectedNode = initialNode && initialNode.nodeType === Node.TEXT_NODE
      ? initialNode.parentNode
      : initialNode;

    const blokZone = selectedNode && selectedNode instanceof Element
      ? selectedNode.closest(BLOK_REDACTOR_SELECTOR)
      : null;

    /**
     * SelectionUtils is not out of Blok because Blok's wrapper was found
     */
    return blokZone ? blokZone.nodeType === Node.ELEMENT_NODE : false;
  }

  /**
   * Check if passed range at Blok zone
   * @param range - range to check
   */
  public static isRangeAtBlok(range: Range): boolean | void {
    if (!range) {
      return;
    }

    const selectedNode: Node | null =
      range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentNode
        : range.startContainer;

    const blokZone =
      selectedNode && selectedNode instanceof Element
        ? selectedNode.closest(BLOK_REDACTOR_SELECTOR)
        : null;

    /**
     * SelectionUtils is not out of Blok because Blok's wrapper was found
     */
    return blokZone ? blokZone.nodeType === Node.ELEMENT_NODE : false;
  }

  /**
   * Methods return boolean that true if selection exists on the page
   */
  public static get isSelectionExists(): boolean {
    const selection = SelectionUtils.get();

    return !!selection?.anchorNode;
  }

  /**
   * Return first range
   * @returns {Range|null}
   */
  public static get range(): Range | null {
    return this.getRangeFromSelection(this.get());
  }

  /**
   * Returns range from passed Selection object
   * @param selection - Selection object to get Range from
   */
  public static getRangeFromSelection(selection: Selection | null): Range | null {
    return selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  }

  /**
   * Calculates position and size of selected text
   * @returns {DOMRect}
   */
  public static get rect(): DOMRect {
    const ieSel: Selection | MSSelection | undefined | null = (document as Document).selection;

    const rect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    } as DOMRect;

    if (ieSel && ieSel.type !== 'Control') {
      const msSel = ieSel as MSSelection;
      const range = msSel.createRange() as TextRange;

      rect.x = range.boundingLeft;
      rect.y = range.boundingTop;
      rect.width = range.boundingWidth;
      rect.height = range.boundingHeight;

      return rect;
    }

    const sel = window.getSelection();

    if (!sel) {
      _.log('Method window.getSelection returned null', 'warn');

      return rect;
    }

    if (sel.rangeCount === null || isNaN(sel.rangeCount)) {
      _.log('Method SelectionUtils.rangeCount is not supported', 'warn');

      return rect;
    }

    if (sel.rangeCount === 0) {
      return rect;
    }

    const range = sel.getRangeAt(0).cloneRange() as Range;

    const initialRect = range.getBoundingClientRect() as DOMRect;

    // Fall back to inserting a temporary element
    if (initialRect.x === 0 && initialRect.y === 0) {
      const span = document.createElement('span');

      // Ensure span has dimensions and position by
      // adding a zero-width space character
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      const boundingRect = span.getBoundingClientRect() as DOMRect;

      const spanParent = span.parentNode;

      spanParent?.removeChild(span);

      // Glue any broken text nodes back together
      spanParent?.normalize();

      return boundingRect;
    }

    return initialRect;
  }

  /**
   * Returns selected text as String
   * @returns {string}
   */
  public static get text(): string {
    const selection = window.getSelection();

    return selection?.toString() ?? '';
  }

  /**
   * Returns window SelectionUtils
   * {@link https://developer.mozilla.org/ru/docs/Web/API/Window/getSelection}
   * @returns {Selection}
   */
  public static get(): Selection | null  {
    return window.getSelection();
  }

  /**
   * Set focus to contenteditable or native input element
   * @param element - element where to set focus
   * @param offset - offset of cursor
   */
  public static setCursor(element: HTMLElement, offset = 0): DOMRect {
    const range = document.createRange();
    const selection = window.getSelection();

    const isNativeInput = $.isNativeInput(element);

    /** if found deepest node is native input */
    if (isNativeInput && !$.canSetCaret(element)) {
      return element.getBoundingClientRect();
    }

    if (isNativeInput) {
      const inputElement = element as HTMLInputElement | HTMLTextAreaElement;

      inputElement.focus();
      inputElement.selectionStart = offset;
      inputElement.selectionEnd = offset;

      return inputElement.getBoundingClientRect();
    }

    range.setStart(element, offset);
    range.setEnd(element, offset);

    if (!selection) {
      return element.getBoundingClientRect();
    }

    selection.removeAllRanges();
    selection.addRange(range);

    return range.getBoundingClientRect();
  }

  /**
   * Check if current range exists and belongs to container
   * @param container - where range should be
   */
  public static isRangeInsideContainer(container: HTMLElement): boolean {
    const range = SelectionUtils.range;

    if (range === null) {
      return false;
    }

    return container.contains(range.startContainer);
  }

  /**
   * Adds fake cursor to the current range
   */
  public static addFakeCursor(): void {
    const range = SelectionUtils.range;

    if (range === null) {
      return;
    }

    const fakeCursor = $.make('span');

    fakeCursor.setAttribute(BLOK_FAKE_CURSOR_ATTR, '');
    fakeCursor.setAttribute('data-blok-mutation-free', 'true');

    range.collapse();
    range.insertNode(fakeCursor);
  }

  /**
   * Check if passed element contains a fake cursor
   * @param el - where to check
   */
  public static isFakeCursorInsideContainer(el: HTMLElement): boolean {
    return $.find(el, BLOK_FAKE_CURSOR_SELECTOR) !== null;
  }

  /**
   * Removes fake cursor from a container
   * @param container - container to look for
   */
  public static removeFakeCursor(container: HTMLElement = document.body): void {
    const fakeCursor = $.find(container, BLOK_FAKE_CURSOR_SELECTOR);

    if (!fakeCursor) {
      return;
    }

    fakeCursor.remove();
  }

  /**
   * Removes fake background
   * Unwraps the highlight spans and restores the selection
   */
  public removeFakeBackground(): void {
    // Always clean up any orphaned fake background elements in the DOM
    // This handles cleanup after undo/redo operations that may restore fake background elements
    this.removeOrphanedFakeBackgroundElements();

    if (!this.isFakeBackgroundEnabled) {
      return;
    }

    // Remove the highlight spans
    this.removeHighlightSpans();

    this.isFakeBackgroundEnabled = false;
    this.selectionContainer = null;
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
      this.unwrapFakeBackground(element as HTMLElement);
    });

    // Reconstruct the selection range after unwrapping
    if (firstChild && lastChild) {
      const newRange = document.createRange();

      newRange.setStart(firstChild, 0);
      newRange.setEnd(lastChild, lastChild.textContent?.length || 0);
      this.savedSelectionRange = newRange;
    }
  }

  /**
   * Removes any fake background elements from the DOM that are not tracked
   * This handles cleanup after undo/redo operations that may restore fake background elements
   * Also provides backwards compatibility with old fake background approach
   */
  private removeOrphanedFakeBackgroundElements(): void {
    const orphanedElements = document.querySelectorAll('[data-blok-fake-background="true"]');

    orphanedElements.forEach((element) => {
      this.unwrapFakeBackground(element as HTMLElement);
    });
  }

  /**
   * Sets fake background by wrapping selected text in highlight spans
   * Uses a gray background color to simulate the "unfocused selection" appearance
   * similar to how Notion shows selections when focus moves to another element
   */
  public setFakeBackground(): void {
    this.removeFakeBackground();

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      return;
    }

    // Find the contenteditable container that holds the selection
    const container = range.commonAncestorContainer;
    const element = container.nodeType === Node.ELEMENT_NODE
      ? container as HTMLElement
      : container.parentElement;

    this.selectionContainer = element?.closest('[contenteditable="true"]') as HTMLElement | null;

    // Collect text nodes and wrap them with highlight spans
    const textNodes = this.collectTextNodes(range);

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

      const wrapper = this.wrapRangeWithHighlight(segmentRange);

      if (wrapper) {
        highlightSpans.push(wrapper);
      }
    });

    if (highlightSpans.length === 0) {
      return;
    }

    // Post-process: split multi-line spans and apply box-shadow styling
    const processedSpans = this.postProcessHighlightWrappers(highlightSpans);

    // Apply additional line-height extensions for gaps between separate spans
    this.applyLineHeightExtensions(processedSpans);

    // Create a visual range spanning all highlight spans
    const visualRange = document.createRange();

    visualRange.setStartBefore(processedSpans[0]);
    visualRange.setEndAfter(processedSpans[processedSpans.length - 1]);

    // Save the range for later restoration
    this.savedSelectionRange = visualRange.cloneRange();

    selection.removeAllRanges();
    selection.addRange(visualRange);

    this.isFakeBackgroundEnabled = true;
  }

  /**
   * Collects text nodes that intersect with the passed range
   * @param range - selection range
   */
  private collectTextNodes(range: Range): Text[] {
    const nodes: Text[] = [];
    const { commonAncestorContainer } = range;

    if (commonAncestorContainer.nodeType === Node.TEXT_NODE) {
      nodes.push(commonAncestorContainer as Text);

      return nodes;
    }

    const walker = document.createTreeWalker(
      commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Node): number => {
          if (!range.intersectsNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          return node.textContent && node.textContent.length > 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    while (walker.nextNode()) {
      nodes.push(walker.currentNode as Text);
    }

    return nodes;
  }

  /**
   * Wraps passed range with a highlight span styled like an unfocused selection (gray)
   * @param range - range to wrap
   */
  private wrapRangeWithHighlight(range: Range): HTMLElement | null {
    if (range.collapsed) {
      return null;
    }

    const wrapper = $.make('span');

    wrapper.setAttribute('data-blok-testid', 'fake-background');
    wrapper.setAttribute('data-blok-fake-background', 'true');
    wrapper.setAttribute('data-blok-mutation-free', 'true');
    // Don't use background-color here - we'll use box-shadow only to avoid overlap issues
    // The box-shadow will be applied later in applyLineHeightExtensions
    wrapper.style.color = 'inherit';
    // box-decoration-break: clone ensures background/padding applies per-line for multi-line inline elements
    wrapper.style.boxDecorationBreak = 'clone';
    (wrapper.style as unknown as Record<string, string>)['-webkit-box-decoration-break'] = 'clone';
    // Preserve trailing whitespace so the highlight covers spaces at end of lines
    wrapper.style.whiteSpace = 'pre-wrap';

    const contents = range.extractContents();

    if (contents.childNodes.length === 0) {
      return null;
    }

    wrapper.appendChild(contents);
    range.insertNode(wrapper);

    return wrapper;
  }

  /**
   * Post-processes highlight wrappers to split multi-line spans and apply proper styling
   * @param wrappers - array of wrapper elements
   * @returns array of all wrapper elements (may be more than input if splits occurred)
   */
  private postProcessHighlightWrappers(wrappers: HTMLElement[]): HTMLElement[] {
    const allWrappers: HTMLElement[] = [];

    wrappers.forEach((wrapper) => {
      const splitWrappers = this.splitMultiLineWrapper(wrapper);

      allWrappers.push(...splitWrappers);
    });

    return allWrappers;
  }

  /**
   * Splits a multi-line wrapper into separate spans per line and applies box-shadow to each
   * This ensures gaps between lines are properly filled
   * @param wrapper - the highlight wrapper element
   * @returns array of wrapper elements (original if single line, or new per-line wrappers)
   */
  private splitMultiLineWrapper(wrapper: HTMLElement): HTMLElement[] {
    const clientRects = wrapper.getClientRects();

    // If single line, just apply box-shadow and return
    if (clientRects.length <= 1) {
      this.applyBoxShadowToWrapper(wrapper);

      return [wrapper];
    }

    // Multi-line: we need to split the text into separate spans per line
    // This is done by using Range to find line breaks
    const textContent = wrapper.textContent || '';
    const parent = wrapper.parentNode;

    if (!parent || !textContent) {
      this.applyBoxShadowToWrapper(wrapper);

      return [wrapper];
    }

    // Create a temporary range to measure character positions
    const wrappers: HTMLElement[] = [];
    const textNode = wrapper.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      this.applyBoxShadowToWrapper(wrapper);

      return [wrapper];
    }

    // Find line break positions by checking character rects
    const lineBreaks = this.findLineBreakPositions(textNode as Text, clientRects.length);

    if (lineBreaks.length === 0) {
      this.applyBoxShadowToWrapper(wrapper);

      return [wrapper];
    }

    // Split the text at line breaks and create new wrappers
    const segments = this.splitTextAtPositions(textContent, lineBreaks);

    // Replace the original wrapper with multiple wrappers
    const fragment = document.createDocumentFragment();

    segments.forEach((segment) => {
      if (segment.length === 0) {
        return;
      }

      const newWrapper = $.make('span');

      newWrapper.setAttribute('data-blok-testid', 'fake-background');
      newWrapper.setAttribute('data-blok-fake-background', 'true');
      newWrapper.setAttribute('data-blok-mutation-free', 'true');
      // Don't use background-color - box-shadow will be applied later
      newWrapper.style.color = 'inherit';
      newWrapper.style.boxDecorationBreak = 'clone';
      (newWrapper.style as unknown as Record<string, string>)['-webkit-box-decoration-break'] = 'clone';
      // Preserve trailing whitespace so the highlight covers spaces at end of lines
      newWrapper.style.whiteSpace = 'pre-wrap';
      newWrapper.textContent = segment;

      fragment.appendChild(newWrapper);
      wrappers.push(newWrapper);
    });

    parent.replaceChild(fragment, wrapper);

    return wrappers;
  }

  /**
   * Splits text content at given positions
   */
  private splitTextAtPositions(text: string, positions: number[]): string[] {
    const breakPoints = [0, ...positions, text.length];

    return breakPoints.slice(0, -1).map((start, idx) => {
      return text.substring(start, breakPoints[idx + 1]);
    }).filter((segment) => segment.length > 0);
  }

  /**
   * Finds positions in text where line breaks occur
   * @param textNode - the text node to analyze
   * @param expectedLines - expected number of lines
   */
  private findLineBreakPositions(textNode: Text, expectedLines: number): number[] {
    const text = textNode.textContent || '';
    const range = document.createRange();
    const indices = Array.from({ length: text.length }, (_, i) => i);

    const result = indices.reduce(
      (acc: { positions: number[]; lastTop: number }, i: number) => {
        if (acc.positions.length >= expectedLines - 1) {
          return acc;
        }

        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);

        const rect = range.getBoundingClientRect();
        const isLineBreak = acc.lastTop !== -1 && Math.abs(rect.top - acc.lastTop) > 5;

        if (isLineBreak) {
          acc.positions.push(i);
        }

        return { positions: acc.positions, lastTop: rect.top };
      },
      { positions: [], lastTop: -1 }
    );

    return result.positions;
  }

  /**
   * Applies box-shadow to a wrapper to extend the background to fill line-height
   * @param wrapper - the wrapper element
   */
  private applyBoxShadowToWrapper(wrapper: HTMLElement): void {
    const parent = wrapper.parentElement;

    if (!parent) {
      return;
    }

    const parentStyle = window.getComputedStyle(parent);
    const wrapperStyle = window.getComputedStyle(wrapper);

    const lineHeight = parseFloat(parentStyle.lineHeight);
    const fontSize = parseFloat(wrapperStyle.fontSize);

    // If lineHeight is NaN (e.g., "normal"), estimate it as 1.2 * fontSize
    const effectiveLineHeight = isNaN(lineHeight) ? fontSize * 1.2 : lineHeight;

    // Calculate extension needed to fill the line-height
    const rect = wrapper.getBoundingClientRect();
    const extension = Math.max(0, (effectiveLineHeight - rect.height) / 2);

    if (extension > 0) {
      const bgColor = 'rgba(0, 0, 0, 0.08)';

      // eslint-disable-next-line no-param-reassign
      wrapper.style.boxShadow = `0 ${extension}px 0 ${bgColor}, 0 -${extension}px 0 ${bgColor}`;
    }
  }

  /**
   * Applies additional box-shadow extensions to fill gaps between separate spans
   * This is only needed when there are multiple spans that may have gaps between them
   * @param spans - array of highlight span elements
   */
  private applyLineHeightExtensions(spans: HTMLElement[]): void {

    const bgColor = 'rgba(0, 0, 0, 0.08)';

    // Collect all line rects from all spans
    const allLineRects = this.collectAllLineRects(spans);

    if (allLineRects.length === 0) {
      return;
    }

    // Sort by vertical position
    allLineRects.sort((a, b) => a.top - b.top);

    // Group rects that are on the same visual line
    const lineGroups = this.groupRectsByLine(allLineRects);

    // Apply box-shadow to each span based on its line position (for inter-span gaps)
    spans.forEach((span) => {
      this.applyMultiLineBoxShadow(span, lineGroups, bgColor);
    });
  }

  /**
   * Collects all line rectangles from all spans using getClientRects()
   */
  private collectAllLineRects(spans: HTMLElement[]): Array<{ top: number; bottom: number; span: HTMLElement }> {
    const rects: Array<{ top: number; bottom: number; span: HTMLElement }> = [];

    spans.forEach((span) => {
      const clientRects = span.getClientRects();

      Array.from(clientRects).forEach((rect) => {
        rects.push({
          top: rect.top,
          bottom: rect.bottom,
          span,
        });
      });
    });

    return rects;
  }

  /**
   * Groups rectangles by their visual line
   */
  private groupRectsByLine(
    rects: Array<{ top: number; bottom: number; span: HTMLElement }>
  ): Array<{ top: number; bottom: number }> {
    const lines: Array<{ top: number; bottom: number }> = [];

    rects.forEach((rect) => {
      // Find if this rect belongs to an existing line
      const existingLine = lines.find((line) => Math.abs(line.top - rect.top) < 2);

      if (existingLine) {
        // Extend the line if needed
        existingLine.top = Math.min(existingLine.top, rect.top);
        existingLine.bottom = Math.max(existingLine.bottom, rect.bottom);
      } else {
        lines.push({ top: rect.top, bottom: rect.bottom });
      }
    });

    // Sort lines by top position
    lines.sort((a, b) => a.top - b.top);

    return lines;
  }

  /**
   * Applies box-shadow to a span that may span multiple lines
   * Calculates extensions based on the span's position within the overall selection
   */
  private applyMultiLineBoxShadow(
    span: HTMLElement,
    lineGroups: Array<{ top: number; bottom: number }>,
    bgColor: string
  ): void {
    const clientRects = span.getClientRects();

    if (clientRects.length === 0) {
      return;
    }

    const parent = span.parentElement;

    if (!parent) {
      return;
    }

    // Calculate base extension from line-height
    const parentStyle = window.getComputedStyle(parent);
    const lineHeight = parseFloat(parentStyle.lineHeight);
    const fontSize = parseFloat(window.getComputedStyle(span).fontSize);
    const effectiveLineHeight = isNaN(lineHeight) ? fontSize * 1.2 : lineHeight;

    // Get first and last rects (same for single-line, different for multi-line)
    const firstRect = clientRects[0];
    const lastRect = clientRects[clientRects.length - 1];

    const firstLineIndex = this.findLineIndex(firstRect.top, lineGroups);
    const lastLineIndex = this.findLineIndex(lastRect.top, lineGroups);

    // Check if this span itself spans multiple lines (not just part of a multi-line selection)
    const spanSpansMultipleLines = clientRects.length > 1 && firstLineIndex !== lastLineIndex;

    const isFirstLine = firstLineIndex === 0;
    const isLastLine = lastLineIndex === lineGroups.length - 1;

    // Calculate extension based on line-height
    const baseExtension = Math.max(0, (effectiveLineHeight - firstRect.height) / 2);

    // Only apply gap-filling logic if this span itself spans multiple lines
    // For single-line spans, just use base extension for both top and bottom
    const topExtension = spanSpansMultipleLines
      ? this.calculateLineTopExtension(baseExtension, isFirstLine, lineGroups, firstLineIndex)
      : baseExtension;
    const bottomExtension = spanSpansMultipleLines
      ? this.calculateLineBottomExtension(baseExtension, isLastLine, lineGroups, lastLineIndex)
      : baseExtension;

    const boxShadow = this.buildBoxShadow(topExtension, bottomExtension, bgColor);

    // eslint-disable-next-line no-param-reassign
    span.style.boxShadow = boxShadow;
  }

  /**
   * Finds the line index for a given top position
   */
  private findLineIndex(top: number, lineGroups: Array<{ top: number; bottom: number }>): number {
    const index = lineGroups.findIndex((line) => Math.abs(line.top - top) < 5);

    return index >= 0 ? index : 0;
  }

  /**
   * Calculates top extension for a line
   * Only uses base extension - gaps are filled by the previous line's bottom extension
   */
  private calculateLineTopExtension(
    baseExtension: number,
    _isFirstLine: boolean,
    _lineGroups: Array<{ top: number; bottom: number }>,
    _lineIndex: number
  ): number {
    // Top extension is always just the base extension
    // The gap between lines is filled entirely by the previous line's bottom extension
    // This prevents overlapping shadows that would cause darker bands
    return baseExtension;
  }

  /**
   * Calculates bottom extension for a line, accounting for gap to next line
   * The bottom extension fills the gap up to where the next line's top extension begins
   * This prevents overlap: line N's bottom shadow meets line N+1's top shadow exactly
   */
  private calculateLineBottomExtension(
    baseExtension: number,
    isLastLine: boolean,
    lineGroups: Array<{ top: number; bottom: number }>,
    lineIndex: number
  ): number {
    if (isLastLine) {
      return baseExtension;
    }

    const currentLine = lineGroups[lineIndex];
    const nextLine = lineGroups[lineIndex + 1];

    // The next line's span will have its own top extension (baseExtension)
    // So we only need to extend to meet that point, not overlap it
    // Gap = nextLine.top - currentLine.bottom
    // Next line's top extension covers: nextLine.top - baseExtension to nextLine.top
    // So we extend from currentLine.bottom to (nextLine.top - baseExtension)
    const gapToNextLine = nextLine.top - currentLine.bottom;
    const nextLineTopExtension = baseExtension; // Next line will also extend up by baseExtension

    // We extend: baseExtension (our own) + gap - nextLineTopExtension
    // This way: our bottom = currentLine.bottom + baseExtension + gap - baseExtension
    //         = currentLine.bottom + gap = nextLine.top - baseExtension + baseExtension...
    // Actually simpler: extend to fill gap minus what next line covers
    const gapWeNeedToCover = Math.max(0, gapToNextLine - nextLineTopExtension);

    return baseExtension + gapWeNeedToCover;
  }



  /**
   * Builds box-shadow CSS value from top and bottom extensions
   * Uses inset shadow for the element's own background (to avoid using background-color)
   * and regular shadows for vertical extensions
   */
  private buildBoxShadow(topExtension: number, bottomExtension: number, bgColor: string): string {
    const shadows: string[] = [];

    // Use inset shadow to create the background color effect
    // This replaces background-color to avoid overlap issues between spans
    shadows.push(`inset 0 0 0 9999px ${bgColor}`);

    // Add vertical extensions
    if (bottomExtension > 0) {
      shadows.push(`0 ${bottomExtension}px 0 ${bgColor}`);
    }
    if (topExtension > 0) {
      shadows.push(`0 -${topExtension}px 0 ${bgColor}`);
    }

    return shadows.join(', ');
  }

  /**
   * Removes fake background wrapper (legacy support)
   * @param element - wrapper element
   */
  private unwrapFakeBackground(element: HTMLElement): void {
    const parent = element.parentNode;

    if (!parent) {
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
  }

  /**
   * Save SelectionUtils's range
   */
  public save(): void {
    this.savedSelectionRange = SelectionUtils.range;
  }

  /**
   * Restore saved SelectionUtils's range
   */
  public restore(): void {
    if (!this.savedSelectionRange) {
      return;
    }

    const sel = window.getSelection();

    if (!sel) {
      return;
    }

    sel.removeAllRanges();
    sel.addRange(this.savedSelectionRange);
  }

  /**
   * Clears saved selection
   */
  public clearSaved(): void {
    this.savedSelectionRange = null;
  }

  /**
   * Collapse current selection
   */
  public collapseToEnd(): void {
    const sel = window.getSelection();

    if (!sel || !sel.focusNode) {
      return;
    }

    const range = document.createRange();

    range.selectNodeContents(sel.focusNode);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * Looks ahead to find passed tag from current selection
   * @param  {string} tagName       - tag to found
   * @param  {string} [className]   - tag's class name
   * @param  {number} [searchDepth] - count of tags that can be included. For better performance.
   * @returns {HTMLElement|null}
   */
  public findParentTag(tagName: string, className?: string, searchDepth = 10): HTMLElement | null {
    const selection = window.getSelection();

    /**
     * If selection is missing or no anchorNode or focusNode were found then return null
     */
    if (!selection || !selection.anchorNode || !selection.focusNode) {
      return null;
    }

    /**
     * Define Nodes for start and end of selection
     */
    const boundNodes = [
      /** the Node in which the selection begins */
      selection.anchorNode as HTMLElement,
      /** the Node in which the selection ends */
      selection.focusNode as HTMLElement,
    ];

    /**
     * Helper function to find parent tag starting from a given node
     * @param {HTMLElement} startNode - node to start searching from
     * @returns {HTMLElement | null}
     */
    const findTagFromNode = (startNode: HTMLElement): HTMLElement | null => {
      const searchUpTree = (node: HTMLElement, depth: number): HTMLElement | null => {
        if (depth <= 0 || !node) {
          return null;
        }

        /**
         * Check if the current node itself matches the tag (for element nodes).
         * This handles the case when the selection anchor/focus is the target element.
         */
        const isCurrentNodeMatch = node.nodeType === Node.ELEMENT_NODE && node.tagName === tagName;
        const currentNodeHasMatchingClass = !className || (node.classList && node.classList.contains(className));

        if (isCurrentNodeMatch && currentNodeHasMatchingClass) {
          return node;
        }

        if (!node.parentNode) {
          return null;
        }

        const parent = node.parentNode as HTMLElement;

        const hasMatchingClass = !className || (parent.classList && parent.classList.contains(className));
        const hasMatchingTag = parent.tagName === tagName;

        if (hasMatchingTag && hasMatchingClass) {
          return parent;
        }

        return searchUpTree(parent, depth - 1);
      };

      return searchUpTree(startNode, searchDepth);
    };

    /**
     * For each selection parent Nodes we try to find target tag [with target class name]
     */
    for (const node of boundNodes) {
      const foundTag = findTagFromNode(node);

      if (foundTag) {
        return foundTag;
      }
    }

    /**
     * Return null if tag was not found
     */
    return null;
  }

  /**
   * Expands selection range to the passed parent node
   * @param {HTMLElement} element - element which contents should be selected
   */
  public expandToTag(element: HTMLElement): void {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    const range = document.createRange();

    range.selectNodeContents(element);
    selection.addRange(range);
  }
}

import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { I18n, InlineToolbar } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { IconMarker } from '../icons';
import { SelectionUtils } from '../selection/index';
import { PopoverItemType } from '../utils/popover';
import { isMarkTag, findMarkElement } from './utils/marker-dom-utils';
import {
  isRangeFormatted,
  collectFormattingAncestors,
} from './utils/formatting-range-utils';
import { createColorPicker } from '../shared/color-picker';
import type { ColorPickerHandle } from '../shared/color-picker';

/**
 * Color mode type — either text color or background color
 */
type ColorMode = 'color' | 'background-color';

/**
 * The opposite color mode key for checking remaining styles
 */
const OPPOSITE_MODE: Record<ColorMode, ColorMode> = {
  'color': 'background-color',
  'background-color': 'color',
};

/**
 * Marker Color Inline Tool
 *
 * Wraps selected text in <mark> with color or background-color styles.
 */
export class MarkerInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Color';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'marker';

  /**
   * Keyboard shortcut to open the marker color picker
   */
  public static shortcut = 'CMD+SHIFT+H';

  /**
   * CSS properties allowed on <mark> elements.
   * All other properties are stripped during sanitization to prevent
   * style-based attacks (e.g. position:fixed overlays via pasted HTML).
   */
  private static readonly ALLOWED_STYLE_PROPS = new Set(['color', 'background-color']);

  /**
   * Sanitizer Rule — preserve <mark> tags with only color-related style properties.
   *
   * Uses a function-based rule so HTMLJanitor calls it with the live DOM node,
   * allowing in-place filtering of CSS properties before the node is serialized.
   */
  public static get sanitize(): SanitizerConfig {
    return {
      mark: (node: Element): { [attr: string]: boolean | string } => {
        const el = node as HTMLElement;
        const style = el.style;

        /**
         * Collect property names first, then remove disallowed ones.
         * This avoids mutating the CSSStyleDeclaration while iterating its indices.
         */
        const props = Array.from({ length: style.length }, (_, i) => style.item(i));

        for (const prop of props) {
          if (!MarkerInlineTool.ALLOWED_STYLE_PROPS.has(prop)) {
            style.removeProperty(prop);
          }
        }

        return style.length > 0 ? { style: true } : {};
      },
    } as SanitizerConfig;
  }

  /**
   * I18n API
   */
  private i18n: I18n;

  /**
   * Inline toolbar API
   */
  private inlineToolbar: InlineToolbar;

  /**
   * SelectionUtils instance for saving/restoring selection
   */
  private selection: SelectionUtils;

  /**
   * Currently active color mode, updated by the shared picker via callback
   */
  private colorMode: ColorMode = 'color';

  /**
   * The color picker handle with element and control methods
   */
  private picker: ColorPickerHandle;

  /**
   * @param options - Inline tool constructor options with API
   */
  constructor({ api }: InlineToolConstructorOptions) {
    this.i18n = api.i18n;
    this.inlineToolbar = api.inlineToolbar;
    this.selection = new SelectionUtils();

    this.picker = createColorPicker({
      i18n: this.i18n,
      testIdPrefix: 'marker',
      defaultModeIndex: 0,
      modes: [
        { key: 'color', labelKey: 'tools.marker.textColor', presetField: 'text' },
        { key: 'background-color', labelKey: 'tools.marker.background', presetField: 'bg' },
      ],
      onColorSelect: (color, modeKey) => {
        this.colorMode = modeKey as ColorMode;

        if (color !== null) {
          this.applyColor(this.colorMode, color);
        } else {
          this.removeColor(this.colorMode);
        }
        this.selection.setFakeBackground();
        this.selection.save();
      },
    });
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconMarker,
      name: 'marker',
      isActive: () => {
        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          return false;
        }

        const range = selection.getRangeAt(0);

        return isRangeFormatted(range, isMarkTag, { ignoreWhitespace: true });
      },
      children: {
        hideChevron: true,
        width: '200px',
        items: [
          {
            type: PopoverItemType.Html,
            element: this.picker.element,
          },
        ],
        onOpen: () => {
          this.onPickerOpen();
        },
        onClose: () => {
          this.onPickerClose();
        },
      },
    };
  }

  /**
   * Apply a color to the current selection by wrapping in <mark>
   * @param mode - 'color' or 'background-color'
   * @param value - CSS color value
   */
  public applyColor(mode: ColorMode, value: string): void {
    this.restoreSelectionIfSaved();

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      return;
    }

    /**
     * Check if the entire selection is already inside a single mark element
     */
    const existingMark = this.findContainingMark(range);

    if (existingMark) {
      /**
       * If the selection covers the entire mark content, update in-place
       */
      const markRange = document.createRange();

      markRange.selectNodeContents(existingMark);

      const coversAll =
        range.compareBoundaryPoints(Range.START_TO_START, markRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, markRange) >= 0;

      if (coversAll) {
        existingMark.style.setProperty(mode, value);
        this.ensureTransparentBg(existingMark);

        return;
      }

      /**
       * Partial selection: split the mark around the selection
       * so the new color applies only to the selected text
       */
      this.splitMarkAroundRange(existingMark, range, mode, value);

      return;
    }

    /**
     * Split any marks that extend beyond the selection boundaries
     * so removeNestedMarkStyle only processes the portion within the range
     */
    this.splitMarksAtBoundaries(range);

    /**
     * Remove any nested marks with the same mode before wrapping
     */
    this.removeNestedMarkStyle(range, mode);

    const mark = document.createElement('mark');

    mark.style.setProperty(mode, value);
    this.ensureTransparentBg(mark);
    mark.appendChild(range.extractContents());
    range.insertNode(mark);

    /**
     * Select the newly inserted mark contents
     */
    selection.removeAllRanges();
    const newRange = document.createRange();

    newRange.selectNodeContents(mark);
    selection.addRange(newRange);
  }

  /**
   * Remove a color style from the current selection's mark elements
   * @param mode - 'color' or 'background-color'
   */
  public removeColor(mode: ColorMode): void {
    this.restoreSelectionIfSaved();

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    /**
     * Capture range anchors before DOM mutations so we can restore the selection
     * after marks are unwrapped (browsers may collapse selection on DOM changes)
     */
    const startContainer = range.startContainer;
    const startOffset = range.startOffset;
    const endContainer = range.endContainer;
    const endOffset = range.endOffset;

    /**
     * Also capture the selected text and a surviving parent node so we
     * can fall back to offset-based restoration when anchors become stale.
     * The commonAncestorContainer may itself be the mark element being removed,
     * so walk up to find a parent that will survive the unwrap.
     */
    const selectedText = range.toString();
    const ancestor = range.commonAncestorContainer;
    const ancestorEl = ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor as HTMLElement
      : ancestor.parentElement;
    const survivingParent = ancestorEl?.closest('mark')
      ? ancestorEl.closest('mark')?.parentElement ?? ancestorEl
      : ancestorEl;

    const markAncestors = collectFormattingAncestors(range, isMarkTag);

    for (const mark of markAncestors) {
      mark.style.removeProperty(mode);

      const oppositeMode = OPPOSITE_MODE[mode];
      const oppositeValue = mark.style.getPropertyValue(oppositeMode);
      const hasOtherStyle = oppositeValue !== '' && oppositeValue !== 'transparent';

      if (!hasOtherStyle) {
        this.unwrapElement(mark);
      } else {
        this.ensureTransparentBg(mark);
      }
    }

    /**
     * Re-establish the selection after DOM mutations.
     * When the range was anchored to text nodes (moved, not cloned by unwrapElement),
     * the original anchors remain valid. When the range was anchored to the mark
     * element itself (e.g. via selectNodeContents), the node is now detached.
     * Check connectivity before attempting restoration; fall back to text-offset
     * restoration when anchors are stale.
     */
    const startConnected = startContainer.isConnected;
    const endConnected = endContainer.isConnected;

    if (startConnected && endConnected) {
      try {
        const restoredRange = document.createRange();

        restoredRange.setStart(startContainer, startOffset);
        restoredRange.setEnd(endContainer, endOffset);
        selection.removeAllRanges();
        selection.addRange(restoredRange);
      } catch {
        this.restoreSelectionByText(selection, survivingParent, selectedText);
      }
    } else {
      this.restoreSelectionByText(selection, survivingParent, selectedText);
    }
  }

  /**
   * Called when the picker popover opens — save selection, reset tab state,
   * and detect the current selection's color to highlight the active swatch.
   */
  private onPickerOpen(): void {
    this.picker.reset();

    const activeColor = this.detectSelectionColor();

    if (activeColor) {
      this.picker.setActiveColor(activeColor.value, activeColor.mode);
    }

    this.selection.setFakeBackground();
    this.selection.save();
  }

  /**
   * Called when the picker popover closes — clean up selection state
   */
  private onPickerClose(): void {
    this.selection.removeFakeBackground();

    if (this.selection.savedSelectionRange) {
      this.selection.restore();
    }

    this.selection.clearSaved();
  }

  /**
   * Detect the color of the current selection's mark element.
   * Returns the first color mode found (text color preferred over background).
   */
  private detectSelectionColor(): { value: string; mode: string } | null {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const mark = findMarkElement(range.startContainer);

    if (!mark) {
      return null;
    }

    const textColor = mark.style.getPropertyValue('color');

    if (textColor && textColor !== 'transparent') {
      return { value: textColor, mode: 'color' };
    }

    const bgColor = mark.style.getPropertyValue('background-color');

    if (bgColor && bgColor !== 'transparent') {
      return { value: bgColor, mode: 'background-color' };
    }

    return null;
  }

  /**
   * Restore selection from saved state if available
   */
  private restoreSelectionIfSaved(): void {
    if (this.selection.savedSelectionRange) {
      this.selection.removeFakeBackground();
      this.selection.restore();
      this.selection.clearSaved();
    }
  }

  /**
   * Find a single mark element that fully contains the range
   * @param range - The range to check
   */
  private findContainingMark(range: Range): HTMLElement | null {
    const startMark = findMarkElement(range.startContainer);
    const endMark = findMarkElement(range.endContainer);

    if (startMark && startMark === endMark) {
      return startMark;
    }

    return null;
  }

  /**
   * Remove a specific style property from nested mark elements within a range
   * @param range - The range to process
   * @param mode - The style property to remove
   */
  private removeNestedMarkStyle(range: Range, mode: ColorMode): void {
    const liveMarks = collectFormattingAncestors(range, isMarkTag);

    for (const mark of liveMarks) {
      mark.style.removeProperty(mode);

      const oppositeMode = OPPOSITE_MODE[mode];
      const oppositeValue = mark.style.getPropertyValue(oppositeMode);
      const hasOtherStyle = oppositeValue !== '' && oppositeValue !== 'transparent';

      if (!hasOtherStyle) {
        this.unwrapElement(mark);
      } else {
        this.ensureTransparentBg(mark);
      }
    }
  }

  /**
   * Split a mark element around a range so only the selected portion gets the new style.
   * Produces up to three segments: before (original style), selected (new style), after (original style).
   * @param mark - The existing mark element to split
   * @param range - The selection range within the mark
   * @param mode - The style property to set on the selected portion
   * @param value - The CSS value for the style property
   */
  private splitMarkAroundRange(mark: HTMLElement, range: Range, mode: ColorMode, value: string): void {
    const parent = mark.parentNode;

    if (!parent) {
      return;
    }

    const beforeRange = document.createRange();

    beforeRange.setStart(mark, 0);
    beforeRange.setEnd(range.startContainer, range.startOffset);

    const afterRange = document.createRange();

    afterRange.setStart(range.endContainer, range.endOffset);
    afterRange.setEnd(mark, mark.childNodes.length);

    const beforeContents = beforeRange.extractContents();
    const selectedContents = range.extractContents();
    const afterContents = afterRange.extractContents();

    const newMark = document.createElement('mark');

    newMark.style.cssText = mark.style.cssText;
    newMark.style.setProperty(mode, value);
    this.ensureTransparentBg(newMark);
    newMark.appendChild(selectedContents);

    const fragment = document.createDocumentFragment();

    if (beforeContents.textContent) {
      const beforeMark = document.createElement('mark');

      beforeMark.style.cssText = mark.style.cssText;
      this.ensureTransparentBg(beforeMark);
      beforeMark.appendChild(beforeContents);
      fragment.appendChild(beforeMark);
    }

    fragment.appendChild(newMark);

    if (afterContents.textContent) {
      const afterMark = document.createElement('mark');

      afterMark.style.cssText = mark.style.cssText;
      this.ensureTransparentBg(afterMark);
      afterMark.appendChild(afterContents);
      fragment.appendChild(afterMark);
    }

    parent.replaceChild(fragment, mark);

    const selection = window.getSelection();

    if (selection) {
      selection.removeAllRanges();

      const newRange = document.createRange();

      newRange.selectNodeContents(newMark);
      selection.addRange(newRange);
    }
  }

  /**
   * Split mark elements at range boundaries so that marks extending
   * beyond the selection are separated into inside/outside portions.
   * This preserves mark styling on text outside the selection range.
   * @param range - The selection range
   */
  private splitMarksAtBoundaries(range: Range): void {
    const marks = collectFormattingAncestors(range, isMarkTag);

    for (const mark of marks) {
      const markRange = document.createRange();

      markRange.selectNodeContents(mark);

      const rangeStartsBeforeMark = range.compareBoundaryPoints(Range.START_TO_START, markRange) <= 0;
      const rangeEndsAfterMark = range.compareBoundaryPoints(Range.END_TO_END, markRange) >= 0;

      if (rangeStartsBeforeMark && rangeEndsAfterMark) {
        /**
         * Range fully contains the mark — no split needed
         */
        continue;
      }

      if (!mark.parentNode) {
        continue;
      }

      /**
       * Split at the end boundary first (to avoid invalidating start offsets)
       */
      if (!rangeEndsAfterMark) {
        this.extractTrailingMark(mark, range.endContainer, range.endOffset);
      }

      /**
       * Split at the start boundary
       */
      if (!rangeStartsBeforeMark) {
        this.extractLeadingMark(mark, range.startContainer, range.startOffset);
      }
    }
  }

  /**
   * Extract content after a boundary point from a mark into a new sibling mark.
   * @param mark - The mark to split
   * @param boundaryNode - The node at the boundary
   * @param boundaryOffset - The offset at the boundary
   */
  private extractTrailingMark(mark: HTMLElement, boundaryNode: Node, boundaryOffset: number): void {
    const trailingRange = document.createRange();

    trailingRange.setStart(boundaryNode, boundaryOffset);
    trailingRange.setEnd(mark, mark.childNodes.length);

    const contents = trailingRange.extractContents();

    if (!contents.textContent) {
      return;
    }

    const trailingMark = document.createElement('mark');

    trailingMark.style.cssText = mark.style.cssText;
    trailingMark.appendChild(contents);
    mark.after(trailingMark);
  }

  /**
   * Extract content before a boundary point from a mark into a new sibling mark.
   * @param mark - The mark to split
   * @param boundaryNode - The node at the boundary
   * @param boundaryOffset - The offset at the boundary
   */
  private extractLeadingMark(mark: HTMLElement, boundaryNode: Node, boundaryOffset: number): void {
    const leadingRange = document.createRange();

    leadingRange.setStart(mark, 0);
    leadingRange.setEnd(boundaryNode, boundaryOffset);

    const contents = leadingRange.extractContents();

    if (!contents.textContent) {
      return;
    }

    const leadingMark = document.createElement('mark');

    leadingMark.style.cssText = mark.style.cssText;
    leadingMark.appendChild(contents);
    mark.before(leadingMark);
  }

  /**
   * Restore selection by finding the selected text within a surviving parent.
   * Used as a fallback when range anchors become stale after DOM mutations.
   * @param selection - The window selection to restore
   * @param parent - A parent element that survived the DOM mutation
   * @param text - The text content that was selected before mutation
   */
  private restoreSelectionByText(
    selection: Selection,
    parent: HTMLElement | null,
    text: string
  ): void {
    if (!parent || text.length === 0) {
      return;
    }

    const fullText = parent.textContent ?? '';
    const startIdx = fullText.indexOf(text);

    if (startIdx === -1) {
      return;
    }

    const endIdx = startIdx + text.length;

    /**
     * Walk text nodes to find the nodes and offsets corresponding
     * to the character positions in the parent's textContent
     */
    const { startNode, startNodeOffset, endNode, endNodeOffset } = this.findTextBoundaries(parent, startIdx, endIdx);

    if (startNode && endNode) {
      const restoredRange = document.createRange();

      restoredRange.setStart(startNode, startNodeOffset);
      restoredRange.setEnd(endNode, endNodeOffset);
      selection.removeAllRanges();
      selection.addRange(restoredRange);
    }
  }

  /**
   * Walk text nodes within a parent to find the nodes and offsets
   * corresponding to character positions in the parent's textContent.
   * @param parent - The parent element to walk
   * @param startIdx - The start character index
   * @param endIdx - The end character index
   * @returns An object with the start/end nodes and their offsets
   */
  private findTextBoundaries(
    parent: HTMLElement,
    startIdx: number,
    endIdx: number
  ): { startNode: Text | null; startNodeOffset: number; endNode: Text | null; endNodeOffset: number } {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    const result = { startNode: null as Text | null, startNodeOffset: 0, endNode: null as Text | null, endNodeOffset: 0 };
    const charCounter = { value: 0 };

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const nodeLength = node.textContent?.length ?? 0;

      if (result.startNode === null && charCounter.value + nodeLength > startIdx) {
        result.startNode = node;
        result.startNodeOffset = startIdx - charCounter.value;
      }

      if (charCounter.value + nodeLength >= endIdx) {
        result.endNode = node;
        result.endNodeOffset = endIdx - charCounter.value;
        break;
      }

      charCounter.value += nodeLength;
    }

    return result;
  }

  /**
   * Unwrap an element, moving its children to its parent
   * @param element - Element to unwrap
   */
  private unwrapElement(element: HTMLElement): void {
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
   * Ensure a mark with text color has an explicit transparent background
   * to override the browser's default yellow <mark> background.
   * @param mark - The mark element to check
   */
  private ensureTransparentBg(mark: HTMLElement): void {
    if (
      mark.style.getPropertyValue('color') &&
      !mark.style.getPropertyValue('background-color')
    ) {
      mark.style.setProperty('background-color', 'transparent');
    }
  }
}

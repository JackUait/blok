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
   * Sanitizer Rule — preserve <mark> tags with style attribute
   */
  public static get sanitize(): SanitizerConfig {
    return {
      mark: { style: true },
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
   * The picker UI element
   */
  private pickerElement: HTMLDivElement;

  /**
   * @param options - Inline tool constructor options with API
   */
  constructor({ api }: InlineToolConstructorOptions) {
    this.i18n = api.i18n;
    this.inlineToolbar = api.inlineToolbar;
    this.selection = new SelectionUtils();

    this.pickerElement = createColorPicker({
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
            element: this.pickerElement,
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

    const markAncestors = collectFormattingAncestors(range, isMarkTag);

    for (const mark of markAncestors) {
      mark.style.removeProperty(mode);

      const oppositeMode = OPPOSITE_MODE[mode];
      const hasOtherStyle = mark.style.getPropertyValue(oppositeMode) !== '';

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
     * element itself (e.g. via selectNodeContents), the node is now detached
     * and setStart/setEnd will throw — in that case the browser's own
     * selection adjustment is sufficient.
     */
    try {
      const restoredRange = document.createRange();

      restoredRange.setStart(startContainer, startOffset);
      restoredRange.setEnd(endContainer, endOffset);
      selection.removeAllRanges();
      selection.addRange(restoredRange);
    } catch {
      /* Range anchors were invalidated by DOM mutation — browser selection is used as-is */
    }
  }

  /**
   * Called when the picker popover opens — save selection for later restoration
   */
  private onPickerOpen(): void {
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
      const hasOtherStyle = mark.style.getPropertyValue(oppositeMode) !== '';

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

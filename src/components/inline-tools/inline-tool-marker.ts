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
import { twMerge } from '../utils/tw';
import { isMarkTag, findMarkElement } from './utils/marker-dom-utils';
import {
  isRangeFormatted,
  collectFormattingAncestors,
} from './utils/formatting-range-utils';
import { COLOR_PRESETS } from '../shared/color-presets';
import type { ColorPreset } from '../shared/color-presets';

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
 * Base Tailwind classes shared by tab buttons
 */
const TAB_BASE_CLASSES = 'flex-1 py-1.5 text-xs text-center rounded-md cursor-pointer border-none transition-colors';

/**
 * Neutral background for text-mode swatches so they render as visible buttons
 */
const SWATCH_NEUTRAL_BG = '#f7f7f5';

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
   * Currently active color mode tab
   */
  private colorMode: ColorMode = 'color';

  /**
   * The picker UI element
   */
  private pickerElement: HTMLDivElement;

  /**
   * Tab buttons for toggling mode
   */
  private tabButtons: { color: HTMLButtonElement; background: HTMLButtonElement };

  /**
   * @param options - Inline tool constructor options with API
   */
  constructor({ api }: InlineToolConstructorOptions) {
    this.i18n = api.i18n;
    this.inlineToolbar = api.inlineToolbar;
    this.selection = new SelectionUtils();

    const { picker, tabs } = this.createPickerElement();

    this.pickerElement = picker;
    this.tabButtons = tabs;
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
    const markAncestors = collectFormattingAncestors(range, isMarkTag);

    for (const mark of markAncestors) {
      mark.style.removeProperty(mode);

      const oppositeMode = OPPOSITE_MODE[mode];
      const hasOtherStyle = mark.style.getPropertyValue(oppositeMode) !== '';

      if (!hasOtherStyle) {
        this.unwrapElement(mark);
      }
    }
  }

  /**
   * Create the color picker UI element with tabs, swatches, and default button
   */
  private createPickerElement(): {
    picker: HTMLDivElement;
    tabs: { color: HTMLButtonElement; background: HTMLButtonElement };
  } {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-testid', 'marker-color-picker');
    wrapper.className = 'flex flex-col gap-2 p-2';

    /**
     * Tab row
     */
    const tabRow = document.createElement('div');

    tabRow.className = 'flex gap-0.5 mb-0.5';

    const colorTab = this.createTab(
      'tools.marker.textColor',
      'marker-tab-color',
      true
    );
    const bgTab = this.createTab(
      'tools.marker.background',
      'marker-tab-background-color',
      false
    );

    colorTab.addEventListener('click', () => {
      this.switchMode('color');
    });

    bgTab.addEventListener('click', () => {
      this.switchMode('background-color');
    });

    tabRow.appendChild(colorTab);
    tabRow.appendChild(bgTab);

    /**
     * Color grid
     */
    const grid = document.createElement('div');

    grid.setAttribute('data-blok-testid', 'marker-color-grid');
    grid.className = 'grid grid-cols-5 gap-1.5';

    for (const preset of COLOR_PRESETS) {
      const swatch = this.createSwatch(preset);

      grid.appendChild(swatch);
    }

    /**
     * Default button
     */
    const defaultBtn = document.createElement('button');

    defaultBtn.setAttribute('data-blok-testid', 'marker-default-btn');
    defaultBtn.className = twMerge(
      'w-full py-1.5 text-xs text-center rounded-md cursor-pointer',
      'bg-transparent border-none hover:bg-item-hover-bg',
      'mt-0.5 transition-colors'
    );
    defaultBtn.textContent = this.i18n.t('tools.marker.default');
    defaultBtn.addEventListener('click', () => {
      this.removeColor(this.colorMode);
      this.inlineToolbar.close();
    });

    wrapper.appendChild(tabRow);
    wrapper.appendChild(grid);
    wrapper.appendChild(defaultBtn);

    return {
      picker: wrapper,
      tabs: { color: colorTab, background: bgTab },
    };
  }

  /**
   * Create a tab button
   * @param i18nKey - Translation key for button text
   * @param testId - data-blok-testid value
   * @param active - Whether this tab is initially active
   */
  private createTab(i18nKey: string, testId: string, active: boolean): HTMLButtonElement {
    const btn = document.createElement('button');

    btn.setAttribute('data-blok-testid', testId);
    btn.className = twMerge(
      TAB_BASE_CLASSES,
      active ? 'bg-item-hover-bg font-medium' : 'bg-transparent hover:bg-item-hover-bg/50'
    );
    btn.textContent = this.i18n.t(i18nKey);

    return btn;
  }

  /**
   * Create a color swatch button
   * @param preset - Color preset to render
   */
  private createSwatch(preset: ColorPreset): HTMLButtonElement {
    const btn = document.createElement('button');

    btn.setAttribute('data-blok-testid', `marker-swatch-${preset.name}`);
    btn.className = twMerge(
      'w-8 h-8 rounded-md cursor-pointer border-none',
      'flex items-center justify-center text-sm font-semibold',
      'transition-shadow ring-inset hover:ring-2 hover:ring-black/10'
    );
    btn.textContent = 'A';
    this.updateSwatchAppearance(btn, preset);

    btn.addEventListener('click', () => {
      const value = this.colorMode === 'color' ? preset.text : preset.bg;

      this.applyColor(this.colorMode, value);
      this.inlineToolbar.close();
    });

    return btn;
  }

  /**
   * Update swatch button appearance based on current color mode
   * @param btn - Swatch button element
   * @param preset - Color preset
   */
  private updateSwatchAppearance(btn: HTMLButtonElement, preset: ColorPreset): void {
    if (this.colorMode === 'color') {
      btn.style.setProperty('color', preset.text);
      btn.style.setProperty('background-color', SWATCH_NEUTRAL_BG);
    } else {
      btn.style.setProperty('color', '');
      btn.style.setProperty('background-color', preset.bg);
    }
  }

  /**
   * Switch between text color and background color modes
   * @param mode - The color mode to switch to
   */
  private switchMode(mode: ColorMode): void {
    this.colorMode = mode;

    const isColorMode = mode === 'color';

    this.tabButtons.color.className = twMerge(
      TAB_BASE_CLASSES,
      isColorMode ? 'bg-item-hover-bg font-medium' : 'bg-transparent hover:bg-item-hover-bg/50'
    );

    this.tabButtons.background.className = twMerge(
      TAB_BASE_CLASSES,
      isColorMode ? 'bg-transparent hover:bg-item-hover-bg/50' : 'bg-item-hover-bg font-medium'
    );

    /**
     * Update all swatches to reflect the current mode
     */
    for (const preset of COLOR_PRESETS) {
      const swatch = this.pickerElement.querySelector<HTMLButtonElement>(
        `[data-blok-testid="marker-swatch-${preset.name}"]`
      );

      if (swatch) {
        this.updateSwatchAppearance(swatch, preset);
      }
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
    newMark.appendChild(selectedContents);

    const fragment = document.createDocumentFragment();

    if (beforeContents.textContent) {
      const beforeMark = document.createElement('mark');

      beforeMark.style.cssText = mark.style.cssText;
      beforeMark.appendChild(beforeContents);
      fragment.appendChild(beforeMark);
    }

    fragment.appendChild(newMark);

    if (afterContents.textContent) {
      const afterMark = document.createElement('mark');

      afterMark.style.cssText = mark.style.cssText;
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
}

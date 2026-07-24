import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { I18n, InlineToolbar, MarkSpec } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { IconMarker } from '../icons';
import { applyMark, findMark, hasMark, removeMark } from '../marks/mark-engine';
import { SelectionUtils } from '../selection/index';
import { PopoverItemType } from '../utils/popover';
import { createColorPicker } from '../shared/color-picker';
import type { ColorPickerHandle } from '../shared/color-picker';
import { colorVarName } from '../shared/color-presets';
import { mapToNearestPresetName } from '../utils/color-mapping';
import { isInvisibleBackground } from '../utils/default-page-colors';

/**
 * Color mode type — either text color or background color
 */
type ColorMode = 'color' | 'background-color';

/**
 * The two marker modes as mark-engine specs. Same family (both plain <mark>),
 * so text colour and background compose on one element instead of nesting.
 */
const MARKER_SPECS: Record<ColorMode, MarkSpec<string>> = {
  'color': { tag: 'mark', style: { color: (value: string): string => value } },
  'background-color': { tag: 'mark', style: { 'background-color': (value: string): string => value } },
};

/**
 * Family-level spec matching ANY <mark>, whichever mode(s) it carries —
 * used for active-state detection and colour reads.
 */
const ANY_MARK: MarkSpec = { tag: 'mark' };

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
   * Keyboard shortcut to apply the last-used marker color directly (Notion parity).
   * Unlike clicking the toolbar button, the shortcut never opens the picker.
   */
  public static shortcut = 'CMD+SHIFT+H';

  /**
   * Last color picked from the swatch picker, persisted across tool instances
   * (a fresh instance is created on every shortcut press) so the shortcut can
   * re-apply it directly. Null until the user picks a color at least once.
   */
  private static lastColor: { mode: ColorMode; value: string } | null = null;

  /**
   * Highlight applied by the shortcut on first use, before any color is picked.
   * Matches Notion, which applies a default highlight (yellow background).
   */
  private static readonly DEFAULT_SHORTCUT_COLOR: { mode: ColorMode; value: string } = {
    mode: 'background-color',
    value: colorVarName('yellow', 'bg'),
  };

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

        /**
         * Strip invisible background-colors (transparent, near-white light-page
         * bg, near-black dark-page bg) so a pasted <mark> from another editor
         * (Notion/Word/Summernote/old Blok) doesn't persist a bg that produced
         * no visible highlight — otherwise it lands as a spurious empty <mark>.
         */
        const bg = style.getPropertyValue('background-color');

        if (bg && isInvisibleBackground(bg)) {
          style.removeProperty('background-color');
        }

        /**
         * When text color is set without an explicit background-color,
         * add transparent background to override the browser's default
         * <mark> background (yellow/Mark system color). This handles
         * pasted content where the browser may have dropped the
         * transparent value during clipboard serialization.
         */
        if (style.getPropertyValue('color') && !style.getPropertyValue('background-color')) {
          style.setProperty('background-color', 'transparent');
        }

        return style.length > 0 ? { style: true } : {};
      },
    };
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
   * Active text color for bar indicator (null = default/none)
   */
  private activeTextColor: string | null = null;

  /**
   * Active background color for bar indicator (null = default/none)
   */
  private activeBgColor: string | null = null;

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
      modes: [
        { key: 'color', labelKey: 'tools.marker.textColor', presetField: 'text' },
        { key: 'background-color', labelKey: 'tools.marker.background', presetField: 'bg' },
      ],
      onColorSelect: (color, modeKey) => {
        this.colorMode = modeKey as ColorMode;

        if (color !== null) {
          this.applyColor(this.colorMode, color);
          MarkerInlineTool.lastColor = { mode: this.colorMode, value: color };
        } else {
          this.removeColor(this.colorMode);
        }

        if (modeKey === 'color') {
          this.activeTextColor = color;
        } else {
          this.activeBgColor = color;
        }

        this.picker.setActiveColor(color, modeKey);
        this.updateToolbarColors(this.activeTextColor, this.activeBgColor);

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
        const formatted = hasMark(ANY_MARK, range);

        if (formatted) {
          const colors = this.detectBothSelectionColors(range);

          this.updateToolbarColors(colors.text, colors.bg);
        }

        return formatted;
      },
      children: {
        hideChevron: true,
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
   * Apply the last-used color directly to the current selection without opening
   * the picker. Driven by the keyboard shortcut (Cmd/Ctrl+Shift+H). On first use
   * — before any color has been picked — applies a sensible default highlight,
   * matching Notion.
   */
  public applyShortcut(): void {
    const { mode, value } = MarkerInlineTool.lastColor ?? MarkerInlineTool.DEFAULT_SHORTCUT_COLOR;

    this.applyColor(mode, value);
    MarkerInlineTool.lastColor = { mode, value };
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

    const resolvedValue = this.resolveToVar(value, mode);
    const applied = applyMark(MARKER_SPECS[mode], resolvedValue, range);

    /**
     * Marker-specific normalization the generic engine does not own:
     * a text-coloured <mark> needs an explicit transparent background to
     * override the browser's default yellow highlight. The engine's splits
     * leave siblings (before/after segments) and nested marks that kept only
     * a text colour — normalize the whole neighbourhood, not just the
     * returned wrappers.
     */
    for (const mark of applied) {
      this.ensureTransparentBg(mark);

      const scope = mark.parentElement ?? mark;

      for (const neighbour of Array.from(scope.querySelectorAll<HTMLElement>('mark'))) {
        this.ensureTransparentBg(neighbour);
      }
    }
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
    const survivors = removeMark(MARKER_SPECS[mode], range);

    /**
     * Marks that kept the other mode still need the UA-yellow override when
     * only a text colour remains
     */
    for (const mark of survivors) {
      this.ensureTransparentBg(mark);
    }
  }

  /**
   * Called when the picker popover opens — save selection, reset tab state,
   * and detect the current selection's color to highlight the active swatch.
   */
  private onPickerOpen(): void {
    this.activeTextColor = null;
    this.activeBgColor = null;

    this.picker.reset();

    const colors = this.detectBothSelectionComputedColors();

    if (colors.text !== null) {
      this.picker.setActiveColor(colors.text, 'color');
      this.activeTextColor = colors.text;
    }

    if (colors.bg !== null) {
      this.picker.setActiveColor(colors.bg, 'background-color');
      this.activeBgColor = colors.bg;
    }

    this.updateToolbarColors(this.activeTextColor, this.activeBgColor);

    this.selection.setFakeBackground();
    this.selection.save();
  }

  /**
   * Update the color indicator on the inline toolbar marker button.
   * Background color is applied via SVG rect fill so it stays clipped to the rounded square.
   * Button background-color is set to transparent to suppress active-state Tailwind selectors.
   * @param textColor - CSS color value for the icon/text, or null to reset
   * @param bgColor - CSS color value for the button background, or null to reset
   */
  private updateToolbarColors(textColor: string | null, bgColor: string | null): void {
    const btn = document.querySelector<HTMLElement>('[data-blok-item-name="marker"]');

    if (!btn) {
      return;
    }

    if (textColor !== null) {
      btn.style.setProperty('color', textColor);
    } else if (bgColor !== null) {
      // Suppress active-state blue (text-icon-active-text) when only a background color is set.
      btn.style.setProperty('color', 'var(--blok-text-primary)');
    } else {
      btn.style.removeProperty('color');
    }

    const rect = btn.querySelector<SVGRectElement>('svg rect');

    if (bgColor !== null) {
      // Fill the SVG rect so the color is clipped to the rounded square shape.
      // Transparent on the button suppresses active-state bg-icon-active-bg.
      if (rect) {
        rect.style.fill = bgColor;
      }
      btn.style.setProperty('background-color', 'transparent');
    } else if (textColor !== null) {
      // Use a neutral fill when only text color is applied so that:
      // (a) the active-state blue (data-blok-popover-item-active:bg-icon-active-bg) is suppressed, and
      // (b) light text colors remain visible regardless of the toolbar's own background.
      if (rect) {
        rect.style.fill = 'var(--blok-swatch-neutral-bg)';
      }
      btn.style.setProperty('background-color', 'transparent');
    } else {
      if (rect) {
        rect.style.fill = '';
      }
      btn.style.removeProperty('background-color');
    }
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
   * Detect both text and background colors from the mark at the start of a range.
   * Uses the raw inline style value directly. CSS variables are passed through and
   * resolve correctly in a real browser; resolved rgb values are used as-is.
   * @param range - The selection range to inspect
   */
  private detectBothSelectionColors(range: Range): { text: string | null; bg: string | null } {
    const mark = findMark(ANY_MARK, range.startContainer);

    if (!mark) {
      return { text: null, bg: null };
    }

    const pickRaw = (prop: string): string | null => {
      const raw = mark.style.getPropertyValue(prop);

      return raw && raw !== 'transparent' ? raw : null;
    };

    return {
      text: pickRaw('color'),
      bg: pickRaw('background-color'),
    };
  }

  /**
   * Detect both text and background colors from the current selection's mark element
   * using computed values (resolves CSS variables via getComputedStyle).
   * Used by onPickerOpen() to highlight the correct swatches in both picker sections.
   */
  private detectBothSelectionComputedColors(): { text: string | null; bg: string | null } {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return { text: null, bg: null };
    }

    const range = selection.getRangeAt(0);
    const mark = findMark(ANY_MARK, range.startContainer);

    if (!mark) {
      return { text: null, bg: null };
    }

    const computedStyle = window.getComputedStyle(mark);

    const resolveColor = (prop: string): string | null => {
      const raw = mark.style.getPropertyValue(prop);

      if (!raw || raw === 'transparent') {
        return null;
      }

      const computed = computedStyle.getPropertyValue(prop);

      return computed && computed !== 'transparent' ? computed : null;
    };

    return {
      text: resolveColor('color'),
      bg: resolveColor('background-color'),
    };
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

  /**
   * Translate a raw hex color value to its CSS custom property equivalent.
   * If the value is already a CSS var or cannot be mapped, returns it unchanged.
   * @param value - CSS color value from the picker
   * @param mode - 'color' or 'background-color'
   */
  private resolveToVar(value: string, mode: ColorMode): string {
    if (value.startsWith('var(')) {
      return value;
    }

    const presetMode = mode === 'color' ? 'text' : 'bg';
    const name = mapToNearestPresetName(value, presetMode);

    return name !== null ? colorVarName(name, presetMode) : value;
  }
}

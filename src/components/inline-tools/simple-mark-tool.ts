import type { InlineTool, SanitizerConfig } from '../../../types';
import type { MarkSpec } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { applyMark, hasMark, removeMark, toggleMarkAtCaret } from '../marks/mark-engine';

/**
 * Everything that distinguishes one plain tag-based formatting tool from
 * another: which wrapper it produces and how the toolbar presents it.
 */
interface SimpleMarkToolOptions {
  /**
   * Toolbar item name (also the popover item's data attribute)
   */
  name: string;

  /**
   * Toolbar icon SVG string
   */
  icon: string;

  /**
   * Human-readable title
   */
  title: string;

  /**
   * Translation key for i18n
   */
  titleKey: string;

  /**
   * Keyboard shortcut, e.g. `CMD+I`
   */
  shortcut: string;

  /**
   * The mark the tool toggles (tag + recognized alias tags)
   */
  spec: MarkSpec;
}

/**
 * Constructable shape of a generated simple mark tool
 */
export interface SimpleMarkToolClass {
  new (): InlineTool;

  /**
   * Specifies Tool as Inline Toolbar Tool
   */
  isInline: boolean;

  /**
   * Title for the Inline Tool
   */
  title: string;

  /**
   * Translation key for i18n
   */
  titleKey: string;

  /**
   * Keyboard shortcut
   */
  shortcut: string;

  /**
   * Sanitizer rule keeping the mark's tag and aliases
   */
  sanitize: SanitizerConfig;
}

/**
 * Replace non-breaking spaces (\u00A0) with regular spaces in all text nodes
 * of an element. The browser's contenteditable engine re-inserts nbsp where
 * rendering needs it (trailing/consecutive spaces) on the next input event.
 * @param element - element to normalize
 */
const normalizeNbspIn = (element: HTMLElement): void => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  while (true) {
    const node = walker.nextNode();

    if (node === null) {
      break;
    }

    if (!node.textContent?.includes('\u00A0')) {
      continue;
    }

    node.textContent = node.textContent.replace(/\u00A0/g, ' ');
  }
};

/**
 * Build an inline tool that toggles a plain tag-based mark (italic,
 * underline, strikethrough) through the shared mark engine: range-aware
 * apply/remove with boundary splitting, and the zero-width-space
 * pending-format protocol at a collapsed caret.
 * @param options - tag, aliases and toolbar presentation of the tool
 */
export const createSimpleMarkTool = (options: SimpleMarkToolOptions): SimpleMarkToolClass => {
  const { spec } = options;

  return class implements InlineTool {
    public static isInline = true;

    public static title = options.title;

    public static titleKey = options.titleKey;

    public static shortcut = options.shortcut;

    /**
     * Sanitizer Rule: leave the mark's tag and its aliases
     */
    public static get sanitize(): SanitizerConfig {
      const tags = [spec.tag, ...(spec.aliasTags ?? [])];

      return Object.fromEntries(tags.map((tag) => [tag, {}]));
    }

    /**
     * Create button for Inline Toolbar
     */
    public render(): MenuConfig {
      return {
        icon: options.icon,
        name: options.name,
        onActivate: (): void => {
          this.toggle();
        },
        isActive: (): boolean => {
          const selection = window.getSelection();

          if (!selection || selection.rangeCount === 0) {
            return false;
          }

          return hasMark(spec, selection.getRangeAt(0));
        },
      };
    }

    /**
     * Apply or remove the mark on the current selection
     */
    private toggle(): void {
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);

      if (range.collapsed) {
        toggleMarkAtCaret(spec, undefined, range);

        return;
      }

      if (hasMark(spec, range)) {
        removeMark(spec, range);

        return;
      }

      applyMark(spec, undefined, range).forEach(normalizeNbspIn);
    }
  };
};

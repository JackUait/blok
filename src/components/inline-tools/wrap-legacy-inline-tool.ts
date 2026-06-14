import type { API, InlineTool, SanitizerConfig, ToolConfig } from '../../../types';
import type { MenuConfig } from '../../../types/tools';

/**
 * Subset of the legacy (Editor.js-style) inline tool instance contract.
 * Blok's inline tools differ: their render() returns a MenuConfig, not an HTMLElement.
 * This describes the methods a legacy tool instance MAY expose so we can adapt them.
 */
interface LegacyInlineToolInstance {
  /**
   * Legacy render returns the toolbar button element (icon lives in its innerHTML).
   */
  render(): HTMLElement | null | undefined;

  /**
   * Applies/removes the formatting to the given range. The legacy action.
   */
  surround?(range: Range): void;

  /**
   * Reports whether the formatting is active for the current selection.
   */
  checkState?(selection: Selection | null): boolean;
}

/**
 * Constructor shape for a legacy inline tool class plus its optional static metadata.
 */
interface LegacyInlineToolConstructable {
  new (options: { api: API; config?: ToolConfig }): LegacyInlineToolInstance;
  title?: string;
  shortcut?: string;
  sanitize?: SanitizerConfig;
  isInline?: boolean;
}

/**
 * Derive a stable, lowercased identifier for the wrapped tool.
 * Prefers the legacy static `title`, falling back to the class name.
 * @param LegacyToolClass - the legacy inline tool class being wrapped
 */
function deriveToolName(LegacyToolClass: LegacyInlineToolConstructable): string {
  const source = LegacyToolClass.title ?? LegacyToolClass.name;

  return source.toLowerCase();
}

/**
 * Extract the icon markup from a legacy tool's render() output.
 * The legacy contract returns a button element whose innerHTML is the icon.
 * @param legacyInstance - the instantiated legacy inline tool
 */
function extractIcon(legacyInstance: LegacyInlineToolInstance): string {
  const rendered = typeof legacyInstance.render === 'function'
    ? legacyInstance.render()
    : null;

  if (rendered instanceof HTMLElement) {
    return rendered.innerHTML;
  }

  return '';
}

/**
 * Adapt an Editor.js-style inline tool class into a Blok-compatible inline tool.
 *
 * Blok inline tools expose `render(): MenuConfig` (a plain object), whereas Editor.js
 * tools expose `render(): HTMLElement` plus `surround(range)` / `checkState(selection)`.
 * Blok silently skips raw HTMLElement render results, so an un-wrapped legacy tool
 * vanishes from the inline toolbar. This shim bridges the two contracts.
 * @param LegacyToolClass - an Editor.js-style inline tool class
 * @returns a class implementing Blok's InlineTool interface
 */
export function wrapLegacyInlineTool(
  LegacyToolClass: LegacyInlineToolConstructable
): { new (options: { api: API; config?: ToolConfig }): InlineTool } & {
  isInline: boolean;
  title?: string;
  shortcut?: string;
  sanitize?: SanitizerConfig;
} {
  const toolName = deriveToolName(LegacyToolClass);

  class WrappedLegacyInlineTool implements InlineTool {
    public static isInline = true;
    public static title = LegacyToolClass.title;
    public static shortcut = LegacyToolClass.shortcut;
    public static sanitize = LegacyToolClass.sanitize;

    private readonly legacyInstance: LegacyInlineToolInstance;

    constructor(options: { api: API; config?: ToolConfig }) {
      this.legacyInstance = new LegacyToolClass(options);
    }

    /**
     * Build the Blok MenuConfig from the legacy instance.
     */
    public render(): MenuConfig {
      return {
        name: toolName,
        title: LegacyToolClass.title,
        icon: extractIcon(this.legacyInstance),
        onActivate: (): void => {
          if (typeof this.legacyInstance.surround !== 'function') {
            return;
          }

          const selection = window.getSelection();

          if (!selection || selection.rangeCount === 0) {
            return;
          }

          this.legacyInstance.surround(selection.getRangeAt(0));
        },
        isActive: (): boolean => {
          if (typeof this.legacyInstance.checkState !== 'function') {
            return false;
          }

          return Boolean(this.legacyInstance.checkState(window.getSelection()));
        },
      };
    }
  }

  return WrappedLegacyInlineTool;
}

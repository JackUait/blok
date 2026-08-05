import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { I18n, MarkSpec } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR, createSelector } from '../constants';
import { IconSubscript, IconSuperscript } from '../icons';
import { applyMark, hasMark, removeMark, toggleMarkAtCaret } from '../marks/mark-engine';
import { SelectionUtils } from '../selection/index';

import { InlineToolEventManager } from './services/inline-tool-event-manager';
import { normalizeNbspIn } from './simple-mark-tool';

/**
 * The two baseline-shift modes
 */
type ScriptMode = 'superscript' | 'subscript';

/**
 * Superscript and subscript as plain tag marks. Different tags mean different
 * mark-engine families, so exclusivity between the two is enforced by the
 * tool (see toggle), not the engine.
 */
const SCRIPT_SPECS: Record<ScriptMode, MarkSpec> = {
  superscript: { tag: 'sup' },
  subscript: { tag: 'sub' },
};

const OPPOSITE: Record<ScriptMode, ScriptMode> = {
  superscript: 'subscript',
  subscript: 'superscript',
};

/**
 * Superscript/Subscript Inline Tool
 *
 * One toolbar button opening a two-item nested popover. Applying one mode
 * removes the other first — <sup> and <sub> never nest.
 */
export class SupSubInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Superscript & subscript';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'supSub';

  /**
   * Sanitizer Rule — keep plain <sup>/<sub> wrappers
   */
  public static get sanitize(): SanitizerConfig {
    return {
      sup: {},
      sub: {},
    };
  }

  /**
   * Live instances so the document-level shortcut handlers can reach a
   * toggle implementation (same pattern as Bold).
   */
  private static readonly instances = new Set<SupSubInlineTool>();

  /**
   * I18n API
   */
  private i18n: I18n;

  /**
   * SelectionUtils instance for saving/restoring selection across the popover
   */
  private selection: SelectionUtils;

  /**
   * @param options - Inline tool constructor options with API
   */
  constructor({ api }: InlineToolConstructorOptions) {
    this.i18n = api.i18n;
    this.selection = new SelectionUtils();

    if (typeof document === 'undefined') {
      return;
    }

    SupSubInlineTool.instances.add(this);
    SupSubInlineTool.registerShortcuts();
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconSuperscript,
      name: 'sup-sub',
      isActive: () => this.isModeActive('superscript') || this.isModeActive('subscript'),
      children: {
        hideChevron: true,
        items: [
          this.modeItem('superscript', IconSuperscript, 'tools.supSub.superscript'),
          this.modeItem('subscript', IconSubscript, 'tools.supSub.subscript'),
        ],
        onOpen: () => {
          this.selection.setFakeBackground();
          this.selection.save();
        },
        onClose: () => {
          this.selection.removeFakeBackground();

          if (this.selection.savedSelectionRange) {
            this.selection.restore();
          }

          this.selection.clearSaved();
        },
      },
    };
  }

  /**
   * Toggle a mode on the current selection. Applying one mode strips the
   * other first so <sup> and <sub> never nest.
   * @param mode - which baseline shift to toggle
   */
  public toggle(mode: ScriptMode): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const spec = SCRIPT_SPECS[mode];
    const oppositeSpec = SCRIPT_SPECS[OPPOSITE[mode]];
    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      if (hasMark(oppositeSpec, range)) {
        toggleMarkAtCaret(oppositeSpec, undefined, range);
      }

      toggleMarkAtCaret(spec, undefined, this.currentRange() ?? range);

      return;
    }

    if (hasMark(spec, range)) {
      removeMark(spec, range);

      return;
    }

    if (hasMark(oppositeSpec, range)) {
      removeMark(oppositeSpec, range);
    }

    applyMark(spec, undefined, this.currentRange() ?? range).forEach(normalizeNbspIn);
  }

  /**
   * Whether the current selection carries the given mode's mark
   * @param mode - which baseline shift to check
   */
  private isModeActive(mode: ScriptMode): boolean {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    return hasMark(SCRIPT_SPECS[mode], selection.getRangeAt(0));
  }

  /**
   * Build one nested popover toggle item
   * @param mode - the mode the item toggles
   * @param icon - item icon
   * @param titleKey - i18n key for the item label
   */
  private modeItem(mode: ScriptMode, icon: string, titleKey: string): {
    icon: string;
    name: ScriptMode;
    title: string;
    closeOnActivate: boolean;
    isActive: () => boolean;
    onActivate: () => void;
  } {
    return {
      icon,
      name: mode,
      title: this.i18n.t(titleKey),
      closeOnActivate: true,
      isActive: () => this.isModeActive(mode),
      onActivate: () => {
        this.restoreSelectionIfSaved();
        this.toggle(mode);
      },
    };
  }

  /**
   * Current selection range, if any
   */
  private currentRange(): Range | null {
    const selection = window.getSelection();

    return selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  }

  /**
   * Restore selection saved on popover open (same contract as the Color tool)
   */
  private restoreSelectionIfSaved(): void {
    if (this.selection.savedSelectionRange) {
      this.selection.removeFakeBackground();
      this.selection.restore();
      this.selection.clearSaved();
    }
  }

  /**
   * Register ⌘/Ctrl+Period (superscript) and ⌘/Ctrl+Comma (subscript) on the
   * shared document-level event manager. The static-shortcut system supports
   * one shortcut per tool, hence the Bold-style path. Safe to call repeatedly.
   */
  private static registerShortcuts(): void {
    const manager = InlineToolEventManager.getInstance();

    if (manager.hasHandler('sup-sub:superscript')) {
      return;
    }

    const registerModeShortcut = (mode: ScriptMode, key: string): void => {
      manager.register(`sup-sub:${mode}`, {
        shortcut: { key, meta: true },
        onShortcut: () => {
          const instance = SupSubInlineTool.instances.values().next().value;

          instance?.toggle(mode);
        },
        isRelevant: (selection) => SupSubInlineTool.isSelectionInsideBlok(selection),
      });
    };

    registerModeShortcut('superscript', '.');
    registerModeShortcut('subscript', ',');
  }

  /**
   * Check if a selection is inside a Blok editor
   * @param selection - the selection to check
   */
  private static isSelectionInsideBlok(selection: Selection): boolean {
    const anchor = selection.anchorNode;

    if (!anchor) {
      return false;
    }

    const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;

    return Boolean(element?.closest(createSelector(DATA_ATTR.editor)));
  }
}

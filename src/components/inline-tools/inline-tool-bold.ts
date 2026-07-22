import type { InlineTool, SanitizerConfig } from '../../../types';
import type { MarkSpec } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR, createSelector } from '../constants';
import { IconBold } from '../icons';
import { hasMark, toggleMark } from '../marks/mark-engine';

import { BoldNormalizationPass } from './services/bold-normalization-pass';
import { InlineToolEventManager } from './services/inline-tool-event-manager';

/**
 * Bold as a mark: canonical <strong>, with legacy <b> recognized as the same
 * mark (the normalization pass converts stragglers to <strong> continuously)
 */
const BOLD_SPEC: MarkSpec = {
  tag: 'strong',
  aliasTags: ['b'],
};

/**
 * Bold Tool
 *
 * Inline Toolbar Tool
 *
 * Makes selected text bolder. Range/wrap/unwrap mechanics live in the shared
 * mark engine; this class keeps what is genuinely bold-specific — the native
 * pending-format deferral at a collapsed caret, the global shortcut/selection
 * listeners, and the <b>→<strong> normalization passes.
 */
export class BoldInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   * @returns {boolean}
   */
  public static isInline = true;

  /**
   * At a collapsed caret, defer Cmd/Ctrl+B to the browser's native pending-bold
   * handler instead of intercepting it (see InlineShortcutManager). This is the
   * only race-free, cross-engine way to get "toggle bold then type".
   */
  public static nativeCaretShortcut = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Bold';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'bold';

  /**
   * Sanitizer Rule
   * Leave <strong> tags
   * @returns {object}
   */
  public static get sanitize(): SanitizerConfig {
    return {
      strong: {},
      b: {},
    };
  }

  private static mutationObserver?: MutationObserver;
  private static isProcessingMutation = false;
  private static readonly instances = new Set<BoldInlineTool>();

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

    const manager = InlineToolEventManager.getInstance();

    if (manager.hasHandler('bold')) {
      return true;
    }

    manager.register('bold', {
      shortcut: { key: 'b', meta: true },
      // Only intercept Cmd/Ctrl+B when there is a selection to wrap/unwrap. On a
      // collapsed caret we let the keystroke fall through to the browser, whose
      // native handler applies pending inline bold to the next typed characters
      // synchronously — race-free and consistent across engines (WebKit only
      // applies pending format via its own default handler, never via scripted
      // execCommand).
      shouldHandleShortcut: (selection) => selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed,
      onShortcut: (_event, _selection) => {
        const instance = BoldInlineTool.instances.values().next().value;

        if (instance) {
          instance.toggleBold();
        }
      },
      onSelectionChange: (_selection) => {
        BoldInlineTool.refreshSelectionState();
      },
      onInput: (_event, _selection) => {
        BoldInlineTool.refreshSelectionState();
      },
      isRelevant: (selection) => BoldInlineTool.isSelectionInsideBlok(selection),
    });

    BoldInlineTool.ensureStyleWithCssDisabled();
    BoldInlineTool.ensureMutationObserver();

    return true;
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
   * Apply or remove bold formatting through the shared mark engine
   */
  private toggleBold(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      // Collapsed-caret bold is handled by the browser's native pending-format
      // state (the Cmd/Ctrl+B shortcut deliberately falls through to it — see
      // shouldHandleShortcut in initializeGlobalListeners). There is nothing to
      // wrap/unwrap here, so this is a no-op. (The inline toolbar's bold button
      // is only ever shown for a non-collapsed selection.)
      return;
    }

    toggleMark(BOLD_SPEC, undefined, range);

    BoldNormalizationPass.normalizeAroundSelection(selection);
    this.notifySelectionChange();
  }

  /**
   * Check if current selection is within a bold tag (<strong>)
   * @param selection - The Selection object to check
   */
  private isSelectionVisuallyBold(selection: Selection): boolean {
    if (selection.rangeCount === 0) {
      return false;
    }

    return hasMark(BOLD_SPEC, selection.getRangeAt(0));
  }

  /**
   * Shortcut for bold tool
   */
  public static shortcut = 'CMD+B';

  /**
   * Notify listeners that the selection state has changed
   */
  private notifySelectionChange(): void {
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
    const blokWrapper = anchorElement?.closest(createSelector(DATA_ATTR.editor));

    if (!blokWrapper) {
      return;
    }

    const toolbar = blokWrapper.querySelector('[data-blok-testid=inline-toolbar]');
    if (!(toolbar instanceof HTMLElement)) {
      return;
    }

    const button = toolbar.querySelector('[data-blok-item-name="bold"]');

    if (!(button instanceof HTMLElement)) {
      return;
    }

    const isActive = this.isSelectionVisuallyBold(selection);

    if (isActive) {
      button.setAttribute('data-blok-popover-item-active', 'true');
    } else {
      button.removeAttribute('data-blok-popover-item-active');
    }
  }

  /**
   * Normalize bold markup after blok input or selection updates.
   *
   * Converts any legacy <b> emitted by the browser's native bold command to
   * <strong> (and merges adjacent / drops empty) so the serialized data model
   * stays consistent. Deliberately performs NO caret repositioning: the browser
   * owns caret placement while typing, and re-positioning it here asynchronously
   * is exactly what used to race with fast input.
   */
  private static refreshSelectionState(): void {
    const selection = window.getSelection();

    BoldNormalizationPass.normalizeAroundSelection(selection, {
      normalizeWhitespace: false,
      preserveNode: selection?.anchorNode ?? null,
    });
  }

  private static styleWithCssDisabled = false;

  /**
   * Ask the browser to emit tag-based markup (<b>) rather than inline
   * `style="font-weight"` spans for its native bold command, so the output
   * normalizes cleanly to <strong>. Safe to call repeatedly; only runs once.
   */
  private static ensureStyleWithCssDisabled(): void {
    if (BoldInlineTool.styleWithCssDisabled || typeof document === 'undefined') {
      return;
    }

    try {
      // execCommand is deprecated but remains the only way to steer the
      // browser's native bold command toward <b> (rather than styled spans).
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- no non-deprecated equivalent exists
      document.execCommand('styleWithCSS', false, 'false');
    } catch {
      // Some environments (e.g. jsdom) do not implement execCommand; ignore.
    }

    BoldInlineTool.styleWithCssDisabled = true;
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
        const processScope = (scope: Element | null): void => {
          if (scope) {
            // Never convert the <b> holding the caret (see BoldNormalizationPass):
            // reparenting it mid-typing displaces the caret. It converts once the
            // caret moves out.
            const preserveNode = window.getSelection()?.anchorNode ?? null;

            new BoldNormalizationPass({ mergeAdjacent: false, removeEmpty: false, normalizeWhitespace: false, preserveNode }).run(scope);
          }
        };

        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            processScope(BoldInlineTool.findBlokScopeFromNode(node));
          });

          if (mutation.type === 'characterData') {
            processScope(BoldInlineTool.findBlokScopeFromNode(mutation.target));
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
   * Find the blok scope element from a node for normalization
   * @param node - The node to find the scope from
   * @returns The scope element or null if not within blok
   */
  private static findBlokScopeFromNode(node: Node): Element | null {
    const element = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;

    if (!element || typeof element.closest !== 'function') {
      return null;
    }

    return element.closest(`${createSelector(DATA_ATTR.interface)}, ${createSelector(DATA_ATTR.editor)}`);
  }

  /**
   * Check if a selection is inside the blok
   * @param selection - The selection to check
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

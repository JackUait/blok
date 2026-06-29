import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { I18n, InlineToolbar } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { IconEquation } from '../icons';
import { SelectionUtils } from '../selection/index';
import { PopoverItemType } from '../utils/popover';
import { renderLatex } from '../../tools/code/katex-loader';

/**
 * Marks a rendered inline equation. The original LaTeX source is kept in the
 * `data-latex` attribute so the formula round-trips through save/load while the
 * span's inner HTML holds the KaTeX-rendered markup for display.
 */
const EQUATION_ATTR = 'data-latex';

/**
 * Equation Inline Tool
 *
 * Notion-parity inline math (Cmd+Shift+E). Wraps the selected text — or a
 * formula typed into the popover input — in a `<span data-latex="…">` whose
 * contents are rendered with KaTeX.
 */
export class EquationInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Equation';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'equation';

  /**
   * Keyboard shortcut — mirrors Notion's inline-equation shortcut
   */
  public static shortcut = 'CMD+SHIFT+E';

  /**
   * The equation inserts a fresh formula at the caret, so its shortcut may open
   * the menu even with nothing selected (Notion's "New equation"). Selection-
   * wrapping tools (Link, Marker) leave this false and require a range.
   */
  public static allowCaretShortcut = true;

  /**
   * Sanitizer Rule — keep equation spans, preserving only the LaTeX source.
   * The rendered KaTeX markup is regenerated on load, so any other attribute
   * (class names, inline styles produced by KaTeX) is dropped at save time.
   */
  public static get sanitize(): SanitizerConfig {
    return {
      span: {
        [EQUATION_ATTR]: true,
      },
    } as SanitizerConfig;
  }

  /**
   * Re-render every equation span inside a root element. Used on load so that
   * persisted `data-latex` sources are turned back into KaTeX markup.
   * @param root - element to search for equation spans
   */
  public static async hydrate(root: HTMLElement): Promise<void> {
    const spans = Array.from(root.querySelectorAll<HTMLElement>(`span[${EQUATION_ATTR}]`));

    await Promise.all(spans.map(async (span) => {
      const latex = span.getAttribute(EQUATION_ATTR);

      if (latex) {
        await EquationInlineTool.renderInto(span, latex);
      }
    }));
  }

  /**
   * Render a LaTeX source into a span: sets the rendered markup and persists
   * the source on the `data-latex` attribute.
   * @param span - target span element
   * @param latex - LaTeX source string
   */
  private static async renderInto(span: HTMLElement, latex: string): Promise<void> {
    span.setAttribute(EQUATION_ATTR, latex);

    const html = await renderLatex(latex, { displayMode: false });

    // Use method-based DOM mutation (not innerHTML assignment) so the passed
    // element is updated without reassigning a parameter property.
    const template = document.createElement('template');

    template.innerHTML = html;
    span.replaceChildren(template.content);
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
   * Popover input + live preview elements
   */
  private nodes: {
    wrapper: HTMLElement;
    input: HTMLInputElement;
    preview: HTMLElement;
  };

  /**
   * @param options - Inline tool constructor options with API
   */
  constructor({ api }: InlineToolConstructorOptions) {
    this.i18n = api.i18n;
    this.inlineToolbar = api.inlineToolbar;
    this.selection = new SelectionUtils();
    this.nodes = this.createUi();
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconEquation,
      name: 'equation',
      isActive: () => Boolean(this.selection.findParentTag('SPAN')?.hasAttribute(EQUATION_ATTR)),
      children: {
        hideChevron: true,
        items: [
          {
            type: PopoverItemType.Html,
            element: this.nodes.wrapper,
          },
        ],
        onOpen: () => {
          this.onOpen();
        },
        onClose: () => {
          this.onClose();
        },
      },
    };
  }

  /**
   * Apply the equation to the current selection.
   *
   * The selected text (or an explicit latex argument) becomes the formula
   * source: it is wrapped in a `<span data-latex="…">` and rendered with KaTeX.
   * @param latex - optional explicit LaTeX source; defaults to the selected text
   */
  public async applyEquation(latex?: string): Promise<void> {
    this.restoreSelectionIfSaved();

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const source = (latex ?? range.toString()).trim();

    if (source === '') {
      return;
    }

    const span = document.createElement('span');

    span.setAttribute(EQUATION_ATTR, source);
    span.textContent = source;

    range.deleteContents();
    range.insertNode(span);

    /**
     * Place the caret right after the inserted equation so typing continues
     * outside the math span.
     */
    selection.removeAllRanges();
    const after = document.createRange();

    after.setStartAfter(span);
    after.collapse(true);
    selection.addRange(after);

    await EquationInlineTool.renderInto(span, source);
  }

  /**
   * Build the popover UI: a formula input with a live KaTeX preview below it.
   */
  private createUi(): { wrapper: HTMLElement; input: HTMLInputElement; preview: HTMLElement } {
    const wrapper = document.createElement('div');

    wrapper.className = 'flex flex-col gap-1 p-1';
    wrapper.setAttribute('data-blok-equation-tool', '');

    const input = document.createElement('input');

    input.type = 'text';
    input.placeholder = this.i18n.t('tools.equation.placeholder');
    input.enterKeyHint = 'done';
    input.className = 'w-[220px] m-0 px-2 py-1 text-sm leading-[22px] font-medium text-text-primary bg-item-hover-bg border border-link-input-border rounded-lg! outline-hidden box-border appearance-none font-[inherit] placeholder:text-gray-text';
    input.setAttribute('data-blok-testid', 'inline-equation-input');

    const preview = document.createElement('div');

    preview.className = 'min-h-[22px] px-2 text-sm text-text-primary';
    preview.setAttribute('data-blok-equation-preview', '');

    input.addEventListener('input', () => {
      void this.updatePreview(input.value);
    });
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.confirm();
      }
    });

    wrapper.append(input, preview);

    return { wrapper, input, preview };
  }

  /**
   * Live-render the typed formula into the preview area
   * @param value - current input value
   */
  private async updatePreview(value: string): Promise<void> {
    const source = value.trim();

    if (source === '') {
      this.nodes.preview.textContent = '';

      return;
    }

    this.nodes.preview.innerHTML = await renderLatex(source, { displayMode: false });
  }

  /**
   * Confirm the typed formula: apply it to the saved selection and close.
   */
  private confirm(): void {
    const value = this.nodes.input.value.trim();

    if (value === '') {
      this.inlineToolbar.close();

      return;
    }

    this.selection.removeFakeBackground();
    this.selection.restore();
    void this.applyEquation(value);
    this.inlineToolbar.close();
  }

  /**
   * Popover opened: seed the input from an existing equation under the caret
   * and remember the selection so it survives the focus move into the input.
   */
  private onOpen(): void {
    const existing = this.selection.findParentTag('SPAN');
    const source = existing?.getAttribute(EQUATION_ATTR) ?? window.getSelection()?.toString() ?? '';

    this.nodes.input.value = source;
    void this.updatePreview(source);

    this.selection.setFakeBackground();
    this.selection.save();
    this.focusInputWithRetry();
  }

  /**
   * Focus the formula input, retrying on the next tick. The popover runs its own
   * focus management when it opens (after this onOpen callback), which steals
   * focus back from the input; a deferred re-focus reclaims it. Mirrors the Link
   * inline tool's input-focus handling.
   */
  private focusInputWithRetry(): void {
    this.nodes.input.focus();

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    window.setTimeout(() => {
      if (document.activeElement !== this.nodes.input) {
        this.nodes.input.focus();
      }
    }, 0);
  }

  /**
   * Popover closed: clean up the fake-background selection highlight.
   */
  private onClose(): void {
    this.selection.removeFakeBackground();
    this.selection.clearSaved();
    this.nodes.input.value = '';
    this.nodes.preview.textContent = '';
  }

  /**
   * Restore the saved selection (set when the popover opened) before applying.
   */
  private restoreSelectionIfSaved(): void {
    if (this.selection.savedSelectionRange) {
      this.selection.removeFakeBackground();
      this.selection.restore();
    }
  }
}

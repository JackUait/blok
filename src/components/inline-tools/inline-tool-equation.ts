import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { Blocks, I18n, InlineToolbar } from '../../../types/api';
import type { MenuConfig } from '../../../types/tools';
import { DATA_ATTR } from '../constants/data-attributes';
import { IconEquation, IconReturn } from '../icons';
import { SelectionUtils } from '../selection/index';
import { PopoverItemType } from '../utils/popover';
import { renderLatex } from '../../shared/katex';

/**
 * Marks a rendered inline equation. The original LaTeX source is kept in the
 * `data-latex` attribute so the formula round-trips through save/load while the
 * span's inner HTML holds the KaTeX-rendered markup for display.
 */
const EQUATION_ATTR = 'data-latex';

/**
 * Marks the chip the popover is editing, so CSS can paint it as selected.
 * Written on the mutation-free span itself, so it is not an edit, and the
 * sanitizer drops it on save.
 */
const EDITING_ATTR = 'data-blok-equation-editing';

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
   * The toolbar button opens the equation menu on its own, like the shortcut.
   */
  public static replacesToolbar = true;

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
    };
  }

  /**
   * Re-render every equation span inside a freshly rendered block — the
   * `InlineToolConstructable.hydrate` hook. Saving keeps only the `data-latex`
   * source (the KaTeX markup is derived), so without this step a loaded,
   * pasted or undone document shows the source as inert text.
   * @param root - the block's rendered tool element
   */
  public static async hydrate(root: HTMLElement): Promise<void> {
    const spans = Array.from(root.querySelectorAll<HTMLElement>(`span[${EQUATION_ATTR}]`));

    await Promise.all(spans.map(async (span) => {
      const latex = span.getAttribute(EQUATION_ATTR);

      /**
       * A span holding element children is already rendered — the source is
       * stored as TEXT, so an unrendered one has no element child. Skipping
       * keeps the hook cheap on the paths that re-run it after every in-place
       * data update (undo/redo, a controlled host typing).
       */
      if (latex && span.firstElementChild === null) {
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

    /**
     * The markup below is REGENERATED from `data-latex` on every render and is
     * dropped again on save, so writing it must not count as an edit: marking
     * the span mutation-free keeps the block-level observer (and with it
     * `onChange` / the "document modified" state) out of it. Set BEFORE the
     * children change so the batched mutation records already see it.
     */
    span.setAttribute(DATA_ATTR.mutationFree, 'true');

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
   * Blocks API, to report an edit the block observer cannot see
   */
  private blocks: Blocks;

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
   * The chip being edited. It shows the typed formula live; its `data-latex`
   * changes only on confirm, so closing without confirming reverts it.
   */
  private chip: HTMLElement | null = null;

  /**
   * @param options - Inline tool constructor options with API
   */
  constructor({ api }: InlineToolConstructorOptions) {
    this.i18n = api.i18n;
    this.inlineToolbar = api.inlineToolbar;
    this.blocks = api.blocks;
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

    const span = this.insertChip(selection, latex);

    if (span !== null) {
      await EquationInlineTool.renderInto(span, span.getAttribute(EQUATION_ATTR) ?? '');
    }
  }

  /**
   * Replace the selection with an unrendered equation span and put the caret
   * after it. Synchronous, so onOpen can turn a selection into a chip at once.
   * @param selection - current window selection, with at least one range
   * @param latex - optional explicit LaTeX source; defaults to the selected text
   */
  private insertChip(selection: Selection, latex?: string): HTMLElement | null {
    const range = selection.getRangeAt(0);
    const source = (latex ?? range.toString()).trim();

    if (source === '') {
      return null;
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

    return span;
  }

  /**
   * Build the popover UI: one row with a code-font formula input and a Done
   * button. The rendered formula shows in the chip itself; the preview here is
   * only read out to screen readers.
   */
  private createUi(): { wrapper: HTMLElement; input: HTMLInputElement; preview: HTMLElement } {
    const wrapper = document.createElement('div');

    // The wrapper is the field; Done sits inside it, inset 4px from the edge.
    wrapper.className = 'relative flex items-center gap-2 w-[300px] h-9 pl-3 pr-[3px] rounded-[10px] border border-transparent bg-item-hover-bg transition-[background-color,border-color] duration-150 ease-out focus-within:bg-popover-bg focus-within:border-search-input-focus-border';
    wrapper.setAttribute('data-blok-equation-tool', '');

    const input = document.createElement('input');

    input.type = 'text';
    input.placeholder = this.i18n.t('tools.equation.placeholder');
    input.enterKeyHint = 'done';
    input.className = 'flex-1 min-w-0 m-0 p-0 font-mono text-sm leading-[22px] text-text-primary bg-transparent border-0 outline-hidden appearance-none placeholder:text-gray-text';
    input.setAttribute('data-blok-testid', 'inline-equation-input');

    const done = document.createElement('button');

    done.type = 'button';
    done.className = 'shrink-0 inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-md border-0 text-[13px] font-medium text-popover-bg bg-text-primary can-hover:hover:opacity-85 focus-visible:opacity-85 outline-hidden cursor-pointer transition-opacity font-[inherit] [&_svg]:size-3.5 [&_svg]:opacity-60';
    done.setAttribute('data-blok-testid', 'inline-equation-done');
    // Styling hook for the button's entrance, so CSS never keys off a test id.
    done.setAttribute('data-blok-equation-done', '');
    done.innerHTML = IconReturn;
    done.prepend(this.i18n.t('tools.equation.done'));
    // Keep focus in the input so the popover and the saved caret survive the click.
    done.addEventListener('mousedown', (event) => event.preventDefault());
    done.addEventListener('click', () => this.confirm());

    const preview = document.createElement('div');

    preview.className = 'sr-only';
    preview.setAttribute('data-blok-equation-preview', '');
    // Announce the rendered formula and, crucially, KaTeX parse errors as the
    // user types, so screen-reader users learn the equation is malformed.
    preview.setAttribute('aria-live', 'polite');

    input.addEventListener('input', () => {
      void this.updatePreview(input.value);
    });
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.confirm();
      }
    });

    wrapper.append(input, done, preview);

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

    const html = await renderLatex(source, { displayMode: false });

    this.nodes.preview.innerHTML = html;

    if (this.chip !== null) {
      // A preview, not an edit: keep the block observer out of it.
      this.chip.setAttribute(DATA_ATTR.mutationFree, 'true');
      const template = document.createElement('template');

      template.innerHTML = html;
      this.chip.replaceChildren(template.content);
    }
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

    const chip = this.chip;

    if (chip !== null) {
      this.chip = null;
      chip.removeAttribute(EDITING_ATTR);
      void EquationInlineTool.renderInto(chip, value);
      // The chip is mutation-free, so the block observer skips this change.
      this.blocks.getBlockByElement(chip)?.dispatchChange();
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
    const stored = existing?.getAttribute(EQUATION_ATTR);

    this.chip = stored !== null && stored !== undefined ? existing : this.chipFromSelection();

    const source = this.chip?.getAttribute(EQUATION_ATTR) ?? '';

    this.nodes.input.value = source;
    void this.updatePreview(source);

    if (this.chip !== null) {
      this.chip.setAttribute(EDITING_ATTR, '');
    } else {
      // A bare caret: nothing to show yet, so keep it for the insert on confirm.
      this.selection.setFakeBackground();
      this.selection.save();
    }

    this.focusInputWithRetry();
  }

  /**
   * Turn the selected text into an equation chip, as Notion does when the
   * equation menu opens, so the chip can show the formula while it is edited.
   */
  private chipFromSelection(): HTMLElement | null {
    const selection = typeof window === 'undefined' ? null : window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    return this.insertChip(selection);
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

    // Select the formula so typing replaces it.
    this.nodes.input.select();

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
    const chip = this.chip;

    this.chip = null;

    if (chip !== null) {
      chip.removeAttribute(EDITING_ATTR);
      void EquationInlineTool.renderInto(chip, chip.getAttribute(EQUATION_ATTR) ?? '');
    }

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

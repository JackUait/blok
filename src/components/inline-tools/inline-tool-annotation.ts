import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig
} from '../../../types';
import type { I18n, InlineToolbar } from '../../../types/api';
import type { MarkSpec } from '../../../types/api/marks';
import type { MenuConfig } from '../../../types/tools';
import { ANNOTATION_ATTR, ANNOTATION_SUBTITLE_ATTR } from '../../shared/annotation-mark';
import { IconAnnotation, IconCheck, IconTrash } from '../icons';
import { applyMark, removeMark } from '../marks/mark-engine';
import { SelectionUtils } from '../selection/index';
import { PopoverItemType } from '../utils/popover';

/** Any span carrying the attribute is the mark; its value is the hint text. */
const ANNOTATION_MARK: MarkSpec<string> = {
  tag: 'span',
  attributes: { [ANNOTATION_ATTR]: (text) => text },
};

interface AnnotationNodes {
  wrapper: HTMLElement;
  /** Invisible copy of the text; it gives the card its width. */
  sizer: HTMLElement;
  text: HTMLTextAreaElement;
  subtitle: HTMLInputElement;
  remove: HTMLButtonElement;
}

/**
 * Annotation ("Hint") Inline Tool
 * Attaches a plain-text note, and an optional subtitle, to the selected text.
 * Readers see a dotted underline and a card; that part is core
 * (`annotation-card.ts`), so this tool only writes and edits the mark.
 */
export class AnnotationInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   */
  public static isInline = true;

  /**
   * Title for the Inline Tool
   */
  public static title = 'Hint';

  /**
   * Translation key for i18n
   */
  public static titleKey = 'annotation';

  /**
   * The toolbar button opens the hint card on its own.
   */
  public static replacesToolbar = true;

  /**
   * Empty on purpose. The span survives through the shared text-field rule
   * (`preserveInlineSpan`); a `span` rule here would replace the equation
   * tool's, because inline tool rules merge later-wins per tag.
   */
  public static get sanitize(): SanitizerConfig {
    return {};
  }

  private readonly i18n: I18n;

  private readonly inlineToolbar: InlineToolbar;

  private readonly selection: SelectionUtils;

  /** Pre-fills the subtitle line of a new hint. */
  private readonly defaultSubtitle: string;

  private readonly nodes: AnnotationNodes;

  /** The hint being edited; null while a new one is being written. */
  private hint: HTMLElement | null = null;

  /** Closing the menu saves, so a save that already happened must not repeat. */
  private settled = true;

  /**
   * @param options - Inline tool constructor options with API and the tool's config
   */
  constructor({ api, config }: InlineToolConstructorOptions) {
    const defaultSubtitle: unknown = (config as { defaultSubtitle?: unknown } | undefined)?.defaultSubtitle;

    this.i18n = api.i18n;
    this.inlineToolbar = api.inlineToolbar;
    this.selection = new SelectionUtils();
    this.defaultSubtitle = typeof defaultSubtitle === 'string' ? defaultSubtitle.trim() : '';
    this.nodes = this.createUi();
  }

  /**
   * Create button for Inline Toolbar
   */
  public render(): MenuConfig {
    return {
      icon: IconAnnotation,
      name: 'annotation',
      isActive: () => this.hintAtSelection() !== null,
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

  private hintAtSelection(): HTMLElement | null {
    const node = window.getSelection()?.anchorNode ?? null;
    const element = node instanceof Element ? node : node?.parentElement ?? null;

    return element?.closest<HTMLElement>(`span[${ANNOTATION_ATTR}]`) ?? null;
  }

  private onOpen(): void {
    const selection = window.getSelection();

    this.hint = this.hintAtSelection();

    if (this.hint === null && (selection === null || selection.rangeCount === 0 || selection.isCollapsed)) {
      // Nothing to attach a hint to.
      this.inlineToolbar.close();

      return;
    }

    this.settled = false;

    this.nodes.text.value = this.hint?.getAttribute(ANNOTATION_ATTR) ?? '';
    this.nodes.subtitle.value = this.hint === null
      ? this.defaultSubtitle
      : this.hint.getAttribute(ANNOTATION_SUBTITLE_ATTR) ?? '';
    this.nodes.remove.hidden = this.hint === null;
    this.nodes.remove.style.display = this.hint === null ? 'none' : '';
    this.fitText();

    if (this.hint === null) {
      // Keeps the phrase looking selected while focus sits in the card.
      this.selection.setFakeBackground();
      this.selection.save();
    }

    this.focusWithRetry(this.nodes.text);
  }

  /**
   * Escape and a click elsewhere close the menu, and both save.
   */
  private onClose(): void {
    this.commit();
    this.selection.removeFakeBackground();
    this.selection.clearSaved();
    this.hint = null;
    this.nodes.text.value = '';
    this.nodes.subtitle.value = '';
  }

  private confirm(): void {
    this.commit();
    this.inlineToolbar.close();
  }

  private commit(): void {
    if (this.settled) {
      return;
    }

    this.settled = true;

    const text = this.nodes.text.value.trim();
    const subtitle = this.nodes.subtitle.value.trim();

    if (this.hint !== null) {
      if (text === '') {
        this.unwrap(this.hint);
      } else {
        this.write(this.hint, text, subtitle);
      }

      return;
    }

    const range = this.takeSavedRange();

    if (range === null || text === '') {
      return;
    }

    for (const element of applyMark(ANNOTATION_MARK, text, range)) {
      this.write(element, text, subtitle);
    }
  }

  private removeHint(): void {
    if (this.hint !== null && !this.settled) {
      this.settled = true;
      this.unwrap(this.hint);
    }

    this.inlineToolbar.close();
  }

  private write(element: HTMLElement, text: string, subtitle: string): void {
    element.setAttribute(ANNOTATION_ATTR, text);

    if (subtitle === '') {
      element.removeAttribute(ANNOTATION_SUBTITLE_ATTR);
    } else {
      element.setAttribute(ANNOTATION_SUBTITLE_ATTR, subtitle);
    }
  }

  private unwrap(hint: HTMLElement): void {
    const range = document.createRange();

    // The engine unwraps only a bare span, and it knows one attribute.
    hint.removeAttribute(ANNOTATION_SUBTITLE_ATTR);
    range.selectNodeContents(hint);
    removeMark(ANNOTATION_MARK, range);
  }

  /**
   * The phrase the writer selected before focus moved into the card.
   */
  private takeSavedRange(): Range | null {
    if (this.selection.savedSelectionRange === null) {
      return null;
    }

    this.selection.removeFakeBackground();
    this.selection.restore();

    const selection = window.getSelection();

    return selection !== null && selection.rangeCount > 0 && !selection.isCollapsed ? selection.getRangeAt(0) : null;
  }

  /** The text field grows with its content instead of scrolling. */
  private fitText(): void {
    // Width first: the height depends on where the lines wrap.
    this.nodes.sizer.textContent = this.nodes.text.value === '' ? this.nodes.text.placeholder : this.nodes.text.value;
    this.nodes.text.style.height = 'auto';
    this.nodes.text.style.height = `${this.nodes.text.scrollHeight}px`;
  }

  /**
   * The popover runs its own focus management after onOpen and takes focus
   * back, so the field reclaims it on the next tick (as the link tool does).
   * @param field - the field to focus
   */
  private focusWithRetry(field: HTMLElement): void {
    field.focus();

    window.setTimeout(() => {
      // The card may not be laid out yet when onOpen runs.
      this.fitText();

      if (this.settled || document.activeElement === field || this.nodes.wrapper.contains(document.activeElement)) {
        return;
      }

      field.focus();
    }, 0);
  }

  private createUi(): AnnotationNodes {
    const wrapper = document.createElement('div');

    // As wide as the text, between 240 and 340px.
    wrapper.className = 'flex flex-col w-max min-w-[240px] max-w-[min(340px,100%)]';
    wrapper.setAttribute('data-blok-annotation-tool', '');
    wrapper.setAttribute('data-blok-testid', 'inline-annotation');

    const body = document.createElement('div');

    body.className = 'flex flex-col gap-2 px-2.5 pt-2 pb-1';

    const text = document.createElement('textarea');

    text.rows = 1;
    text.placeholder = this.i18n.t('tools.annotation.placeholder');
    text.setAttribute('aria-label', this.i18n.t('toolNames.annotation'));
    text.className = 'block w-0 min-w-full m-0 p-0 resize-none overflow-hidden bg-transparent border-0 outline-hidden appearance-none font-[inherit] text-[15px] leading-[22px] text-text-primary placeholder:text-gray-text';
    text.setAttribute('data-blok-testid', 'inline-annotation-text');
    text.addEventListener('input', () => this.fitText());
    text.addEventListener('keydown', (event: KeyboardEvent) => {
      // A plain Enter is a line break in the hint.
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.confirm();
      }
    });

    const subtitle = document.createElement('input');

    subtitle.type = 'text';
    subtitle.placeholder = this.i18n.t('tools.annotation.subtitle');
    subtitle.setAttribute('aria-label', this.i18n.t('tools.annotation.subtitle'));
    subtitle.enterKeyHint = 'done';
    subtitle.className = 'block w-full m-0 p-0 bg-transparent border-0 outline-hidden appearance-none font-[inherit] text-[12px] leading-[1.5] text-gray-text placeholder:text-gray-text';
    subtitle.setAttribute('data-blok-testid', 'inline-annotation-subtitle');
    subtitle.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.confirm();
      }
    });

    // Same short rule the reader's card draws before the subtitle.
    const subtitleRow = document.createElement('div');

    subtitleRow.className = 'flex items-center gap-2 text-gray-text before:content-[""] before:shrink-0 before:w-[14px] before:h-px before:bg-current';
    // w-0: a native input is ~20 characters wide and would set the card's width.
    subtitle.classList.remove('w-full');
    subtitle.classList.add('flex-1', 'w-0', 'min-w-0');

    const sizer = document.createElement('div');

    // Zero height, real width. MUST keep the text field's font size, or the two wrap differently.
    sizer.className = 'h-0 overflow-hidden invisible whitespace-pre-wrap break-words text-[15px] leading-[22px]';
    sizer.setAttribute('aria-hidden', 'true');
    subtitleRow.append(subtitle);
    body.append(sizer, text, subtitleRow);

    const footer = document.createElement('div');

    footer.className = 'flex items-center gap-1 px-1 pt-1.5 pb-0.5';

    const button = 'shrink-0 inline-flex items-center justify-center size-7 p-0 m-0 rounded-full border-0 font-[inherit] text-[13px] font-medium cursor-pointer outline-hidden transition-colors';
    const quiet = 'bg-transparent text-gray-text can-hover:hover:bg-item-hover-bg can-hover:hover:text-text-primary focus-visible:bg-item-hover-bg';
    // Focus stays in the field, so the popover and the saved selection survive the click.
    const keepFocus = (event: Event): void => event.preventDefault();

    const remove = document.createElement('button');

    remove.type = 'button';
    remove.className = `${button} ${quiet} [&_svg]:size-4 can-hover:hover:text-item-destructive-text`;
    remove.innerHTML = IconTrash;
    remove.setAttribute('aria-label', this.i18n.t('tools.annotation.remove'));
    remove.setAttribute('data-blok-testid', 'inline-annotation-remove');
    remove.addEventListener('mousedown', keepFocus);
    remove.addEventListener('click', () => this.removeHint());

    const spacer = document.createElement('span');

    spacer.className = 'flex-1';

    const done = document.createElement('button');

    done.type = 'button';
    done.className = `${button} [&_svg]:size-4 text-popover-bg bg-text-primary can-hover:hover:scale-108 focus-visible:scale-108 transition-[scale] motion-reduce:transition-none`;
    done.innerHTML = IconCheck;
    done.setAttribute('aria-label', this.i18n.t('tools.annotation.done'));
    done.setAttribute('data-blok-testid', 'inline-annotation-done');
    done.addEventListener('mousedown', keepFocus);
    done.addEventListener('click', () => this.confirm());

    footer.append(remove, spacer, done);
    wrapper.append(body, footer);

    return { wrapper, sizer, text, subtitle, remove };
  }
}

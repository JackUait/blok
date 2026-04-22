import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  PasteConfig,
  PasteEvent,
  ToolboxConfig,
  ConversionConfig,
  ToolSanitizerConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import type { CodeData } from '../../../types/tools/code';
import { IconCodeBlock, IconCheck, IconWand } from '../../components/icons';
import { buildCodeDOM, setActiveViewMode } from './dom-builder';
import type { CodeDOMRefs } from './dom-builder';
import { handleCodeKeydown } from './code-keyboard';
import { PopoverDesktop } from '../../components/utils/popover';
import { onHover as tooltipOnHover } from '../../components/utils/tooltip';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  COPY_CODE_KEY,
  COPIED_KEY,
  LANGUAGE_KEY,
  SEARCH_LANGUAGE_KEY,
  COPIED_FEEDBACK_STYLES,
  PREVIEWABLE_LANGUAGES,
  CODE_TAB_KEY,
  PREVIEW_TAB_KEY,
  SIDE_BY_SIDE_KEY,
  PREVIEW_AREA_STYLES,
  GUTTER_LINE_STYLES,
  SPLIT_CONTAINER_STYLES,
  SPLIT_CONTAINER_SPLIT_STYLES,
} from './constants';
import type { CodeViewMode } from './constants';
import { renderLatex } from './katex-loader';
import { renderMermaid } from './mermaid-loader';
import { tokenizePrism, isHighlightable } from './prism-loader';
import { applyPrismHighlight, disposePrismStyles } from './prism-applier';
import { detectLanguage } from './language-detector';

const COPIED_FEEDBACK_DURATION = 1500;

/**
 * Walk text nodes under root to resolve a flat character offset into a
 * (node, offset) pair usable with Range. Recurses instead of mutating locals.
 */
function findTextPosition(root: Node, targetOffset: number): { node: Node; offset: number } {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const step = (consumed: number): { node: Node; offset: number } => {
    const next = walker.nextNode() as Text | null;

    if (!next) {
      return { node: root, offset: 0 };
    }

    const len = next.nodeValue?.length ?? 0;

    if (consumed + len >= targetOffset) {
      return { node: next, offset: targetOffset - consumed };
    }

    return step(consumed + len);
  };

  return step(0);
}

export class CodeTool implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private _data: CodeData;
  private _dom: CodeDOMRefs | null = null;
  private _lineNumbers = true;
  private _picker: PopoverDesktop | null = null;
  private _viewMode: CodeViewMode = 'preview';
  private _previewContainer: HTMLElement | null = null;
  private _highlightRafId: number | null = null;
  private _detectedLanguage: string | null = null;
  private _detectionTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _highlightCleanup: (() => void) | null = null;
  private _highlightedLang: string | null = null;

  constructor({ data, api, readOnly }: BlockToolConstructorOptions<CodeData>) {
    this.api = api;
    this.readOnly = readOnly;
    this._data = {
      code: data?.code ?? '',
      language: data?.language ?? DEFAULT_LANGUAGE,
      lineNumbers: data?.lineNumbers,
    };
    this._lineNumbers = data?.lineNumbers ?? true;
  }

  public render(): HTMLElement {
    const isPreviewable = PREVIEWABLE_LANGUAGES.has(this._data.language);

    const dom = buildCodeDOM({
      code: this._data.code,
      languageName: this.getLanguageName(this._data.language),
      readOnly: this.readOnly,
      copyLabel: this.api.i18n.t(COPY_CODE_KEY),
      previewable: this.readOnly ? false : isPreviewable,
      viewModeLabels: this.readOnly ? undefined : {
        code: this.api.i18n.t(CODE_TAB_KEY),
        preview: this.api.i18n.t(PREVIEW_TAB_KEY),
        split: this.api.i18n.t(SIDE_BY_SIDE_KEY),
      },
    });

    this._dom = dom;

    // Line numbers gutter visibility
    dom.gutterElement.hidden = !this._lineNumbers;

    // Read-only + previewable: show preview only, hide code, no toggle
    if (this.readOnly && isPreviewable) {
      const previewEl = document.createElement('div');

      previewEl.className = PREVIEW_AREA_STYLES;
      previewEl.setAttribute('data-blok-testid', 'code-preview');
      dom.wrapper.appendChild(previewEl);
      dom.preElement.hidden = true;
      dom.gutterElement.hidden = true;
      this._previewContainer = previewEl;
      void this.renderPreview();
    }

    // Edit mode + previewable: default to preview mode and render
    if (!this.readOnly && isPreviewable && dom.previewElement) {
      this._viewMode = 'preview';
      this._previewContainer = dom.previewElement;

      // Apply initial state: preview mode
      this.applyViewMode();
      void this.renderPreview();
    }

    // Edit mode: wire view mode button listeners (buttons always present in edit mode)
    if (!this.readOnly && dom.viewModeContainer) {
      const modeButtons = Array.from(dom.viewModeContainer.querySelectorAll<HTMLButtonElement>('[data-mode]'));

      for (const btn of modeButtons) {
        const label = btn.getAttribute('aria-label') ?? '';

        tooltipOnHover(btn, label, { placement: 'bottom' });

        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-mode') as CodeViewMode;

          if (mode && mode !== this._viewMode) {
            this.setViewMode(mode);
          }
        });
      }
    }

    if (!this.readOnly) {
      dom.gutterElement.addEventListener('mousedown', (event: MouseEvent) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-line-index]');

        if (!target) return;

        const idx = Number(target.getAttribute('data-line-index'));

        event.preventDefault();
        this.focusLineEnd(idx);
      });

      dom.codeElement.addEventListener('keydown', (event: KeyboardEvent) => {
        const handled = handleCodeKeydown(event, dom.codeElement, () => this.exitBlock());

        if (handled) {
          event.preventDefault();
          this.syncTrailingBr();
          this.updateGutter();
          this.scheduleHighlight();
          this.scheduleDetection();
        }
      });

      dom.codeElement.addEventListener('input', () => {
        this.syncTrailingBr();
        this.updateGutter();
        this.scheduleHighlight();
        this.scheduleDetection();
      });

      // Chrome skips the `input` event on native paste into a plaintext-only
      // contenteditable that already holds syntax-highlight spans — the DOM
      // mutates but our gutter/highlight/detection refresh never runs.
      // Re-run the refresh after the browser's native paste completes.
      dom.codeElement.addEventListener('paste', () => {
        requestAnimationFrame(() => {
          this.syncTrailingBr();
          this.updateGutter();
          this.scheduleHighlight();
          this.scheduleDetection();
        });
      });
    }

    dom.copyButton.addEventListener('click', () => this.copyCode());
    tooltipOnHover(dom.copyButton, this.api.i18n.t(COPY_CODE_KEY), { placement: 'bottom' });

    if (!this.readOnly) {
      this._picker = this.buildLanguagePicker(dom.languageButton, dom.wrapper);

      dom.languageButton.addEventListener('click', () => {
        if (this._picker?.isShown) {
          this._picker.hide();
        } else {
          this._picker?.show();
        }
      });
    }

    return dom.wrapper;
  }

  /**
   * Returns the wrapper element as the toolbar anchor so the toolbar
   * centers on the block's visual top, not on the deeply nested
   * contenteditable code element below the header bar.
   */
  public getToolbarAnchorElement(): HTMLElement | undefined {
    return this._dom?.wrapper;
  }

  public rendered(): void {
    void this.highlightCode();
  }

  private setViewMode(mode: CodeViewMode): void {
    this._viewMode = mode;
    this.applyViewMode();

    if (mode === 'preview' || mode === 'split') {
      void this.renderPreview();
    }
  }

  private applyViewMode(): void {
    if (!this._dom?.previewElement || !this._dom.viewModeContainer || !this._dom.splitContainer) {
      return;
    }

    // Update segmented control active state
    setActiveViewMode(this._dom.viewModeContainer, this._viewMode);

    const codeBody = this._dom.preElement.parentElement?.parentElement;

    switch (this._viewMode) {
      case 'code':
        this._dom.preElement.hidden = false;
        this._dom.gutterElement.hidden = !this._lineNumbers;
        this._dom.previewElement.hidden = true;
        if (codeBody) {
          codeBody.hidden = false;
        }
        this._dom.splitContainer.className = SPLIT_CONTAINER_STYLES;
        break;

      case 'preview':
        this._dom.preElement.hidden = true;
        this._dom.gutterElement.hidden = true;
        this._dom.previewElement.hidden = false;
        if (codeBody) {
          codeBody.hidden = true;
        }
        this._dom.splitContainer.className = SPLIT_CONTAINER_STYLES;
        break;

      case 'split':
        this._dom.preElement.hidden = false;
        this._dom.gutterElement.hidden = !this._lineNumbers;
        this._dom.previewElement.hidden = false;
        if (codeBody) {
          codeBody.hidden = false;
        }
        this._dom.splitContainer.className = SPLIT_CONTAINER_SPLIT_STYLES;
        break;
    }
  }

  private async renderPreview(): Promise<void> {
    // Capture the container reference before the async gap so that if the language
    // changes mid-flight (nulling _previewContainer), we don't write to null.
    const container = this._previewContainer;

    if (!container) {
      return;
    }

    const code = this._dom?.codeElement.textContent ?? this._data.code;
    const rendered = this._data.language === 'mermaid'
      ? await renderMermaid(code)
      : await renderLatex(code);

    container.innerHTML = rendered;
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    if (!this._dom) {
      return;
    }

    if (state) {
      this._dom.codeElement.setAttribute('contenteditable', 'false');
      this._dom.codeElement.removeAttribute('spellcheck');
    } else {
      this._dom.codeElement.setAttribute('contenteditable', 'plaintext-only');
      this._dom.codeElement.setAttribute('spellcheck', 'false');
    }
  }

  public save(_blockContent: HTMLElement): CodeData {
    return {
      code: this._dom?.codeElement.textContent ?? '',
      language: this._data.language,
      lineNumbers: this._lineNumbers,
    };
  }

  /**
   * In-place data update for undo/redo. Preserves view mode and DOM state.
   */
  public setData(newData: CodeData): boolean {
    const oldLanguage = this._data.language;

    this._data = {
      code: newData.code ?? '',
      language: newData.language ?? DEFAULT_LANGUAGE,
      lineNumbers: newData.lineNumbers,
    };

    if (!this._dom) {
      return true;
    }

    this._dom.codeElement.textContent = this._data.code;
    this.syncTrailingBr();

    this._lineNumbers = newData.lineNumbers ?? true;
    this._dom.gutterElement.hidden = !this._lineNumbers;
    this.updateGutter();

    if (newData.language !== oldLanguage) {
      this.applyLanguageChange(this._data.language);
    } else if (this._viewMode === 'preview' || this._viewMode === 'split') {
      void this.renderPreview();
    }

    void this.highlightCode();

    return true;
  }

  /**
   * Update DOM for a language change during setData, preserving current view mode.
   */
  private applyLanguageChange(languageId: string): void {
    if (!this._dom) {
      return;
    }

    const textSpan = this._dom.languageButton.querySelector('span');

    if (textSpan) {
      textSpan.textContent = this.getLanguageName(languageId);
    }

    const isPreviewable = PREVIEWABLE_LANGUAGES.has(languageId);

    if (this._dom.viewModeContainer) {
      this._dom.viewModeContainer.hidden = !isPreviewable;
    }

    if (isPreviewable && this._dom.previewElement) {
      this._previewContainer = this._dom.previewElement;

      if (this._viewMode === 'preview' || this._viewMode === 'split') {
        void this.renderPreview();
      }
    } else if (!isPreviewable) {
      this._previewContainer = null;

      if (this._viewMode !== 'code') {
        this._viewMode = 'code';
        this.applyViewMode();
      }
    }

    if (this._picker) {
      this._picker.destroy();
    }
    this._picker = this.buildLanguagePicker(this._dom.languageButton, this._dom.wrapper);
  }

  public validate(savedData: CodeData): boolean {
    return savedData.code.trim() !== '';
  }

  public merge(data: CodeData): void {
    this._data.code += '\n' + data.code;

    if (this._dom) {
      this._dom.codeElement.textContent = this._data.code;
      this.syncTrailingBr();
      this.updateGutter();
    }

    void this.highlightCode();
  }

  public renderSettings(): MenuConfig {
    const selectedId = this._data.language;
    const detectedId = this._detectedLanguage;
    const showDetected = detectedId !== null && detectedId !== selectedId;

    const childItems: PopoverItemParams[] = [];

    if (showDetected) {
      const detectedLanguage = LANGUAGES.find((lang) => lang.id === detectedId);
      if (detectedLanguage) {
        childItems.push({
          title: detectedLanguage.name,
          secondaryLabel: 'auto',
          icon: IconWand,
          onActivate: (): void => this.setLanguage(detectedLanguage.id),
          closeOnActivate: true,
          isActive: (): boolean => this._data.language === detectedLanguage.id,
        });
        childItems.push({ type: PopoverItemType.Separator });
      }
    }

    childItems.push(...LANGUAGES.map((lang) => ({
      title: lang.name,
      trailingIcon: lang.id === selectedId ? IconCheck : undefined,
      onActivate: (): void => this.setLanguage(lang.id),
      closeOnActivate: true,
    })));

    return [
      {
        icon: IconCodeBlock,
        title: this.api.i18n.t(LANGUAGE_KEY),
        name: 'code-language',
        children: { items: childItems },
      },
    ];
  }

  public onPaste(event: PasteEvent): void {
    const detail = event.detail;

    if ('data' in detail) {
      const content = detail.data;

      if (content instanceof HTMLElement) {
        this._data.code = content.textContent ?? '';
      } else if (typeof content === 'string') {
        // Pattern match — strip triple backtick fences
        const stripped = content.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');

        this._data.code = stripped;
      }
    }

    if (this._dom) {
      this._dom.codeElement.textContent = this._data.code;
      this.syncTrailingBr();
      this.updateGutter();
    }

    void this.highlightCode();
  }

  private setLanguage(id: string): void {
    this._data.language = id;
    const isPreviewable = PREVIEWABLE_LANGUAGES.has(id);

    if (this._dom) {
      // Update the text span inside the language button (first child)
      const textSpan = this._dom.languageButton.querySelector('span');

      if (textSpan) {
        textSpan.textContent = this.getLanguageName(id);
      }

      // Show or hide the view mode segmented control based on previewability
      if (this._dom.viewModeContainer) {
        this._dom.viewModeContainer.hidden = !isPreviewable;
      }

      // When switching to a previewable language, activate preview mode
      if (isPreviewable && this._dom.previewElement) {
        this._previewContainer = this._dom.previewElement;
        this._viewMode = 'preview';
        this.applyViewMode();
        void this.renderPreview();
      }

      // When switching away from a previewable language, reset to code mode
      if (!isPreviewable) {
        this._previewContainer = null;
        this._viewMode = 'code';
        this.applyViewMode();
      }

      // Rebuild the language picker so the selected language check icon updates
      if (this._picker) {
        this._picker.destroy();
      }
      this._picker = this.buildLanguagePicker(this._dom.languageButton, this._dom.wrapper);
    }

    void this.highlightCode();
  }

  /**
   * Builds the language items array. When a detected language differs from the
   * chosen one, it appears first with a wand icon and "auto" secondary label.
   * The currently selected language is shown with a check icon and active state
   * in its natural position in the full language list.
   */
  private buildLanguagePickerItems(): PopoverItemParams[] {
    const selectedId = this._data.language;
    const detectedId = this._detectedLanguage;
    const showDetected = detectedId !== null && detectedId !== selectedId;

    const items: PopoverItemParams[] = [];

    if (showDetected) {
      const detectedLanguage = LANGUAGES.find((lang) => lang.id === detectedId);
      if (detectedLanguage) {
        items.push({
          title: detectedLanguage.name,
          name: detectedLanguage.id,
          icon: IconWand,
          toggle: 'language',
          isActive: (): boolean => this._data.language === detectedLanguage.id,
          closeOnActivate: true,
          onActivate: (): void => this.setLanguage(detectedLanguage.id),
        });
        items.push({ type: PopoverItemType.Separator });
      }
    }

    items.push(...LANGUAGES.map((lang) => ({
      title: lang.name,
      name: lang.id,
      trailingIcon: lang.id === selectedId ? IconCheck : undefined,
      toggle: 'language',
      closeOnActivate: true,
      onActivate: (): void => this.setLanguage(lang.id),
    })));

    return items;
  }

  /**
   * Creates a new PopoverDesktop instance for the language picker.
   */
  private buildLanguagePicker(trigger: HTMLElement, leftAlignElement: HTMLElement): PopoverDesktop {
    return new PopoverDesktop({
      items: this.buildLanguagePickerItems(),
      trigger,
      leftAlignElement,
      searchable: true,
      width: '200px',
      messages: {
        search: this.api.i18n.t(SEARCH_LANGUAGE_KEY),
      },
    });
  }

  private getLanguageName(id: string): string {
    const entry = LANGUAGES.find((lang) => lang.id === id);

    return entry ? entry.name : id;
  }

  private copyCode(): void {
    const code = this._dom?.codeElement.textContent ?? '';

    void navigator.clipboard.writeText(code).then(() => {
      if (!this._dom) {
        return;
      }

      const btn = this._dom.copyButton;
      const originalHTML = btn.innerHTML;

      btn.innerHTML = `<span class="${COPIED_FEEDBACK_STYLES}">${this.api.i18n.t(COPIED_KEY)}</span>`;

      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, COPIED_FEEDBACK_DURATION);
    }).catch(() => { /* clipboard unavailable */ });
  }

  private updateGutter(): void {
    if (!this._dom) {
      return;
    }

    const code = this._dom.codeElement.textContent ?? '';
    const lineCount = code ? code.split('\n').length : 1;
    const gutter = this._dom.gutterElement;
    const currentCount = gutter.children.length;

    if (currentCount === lineCount) {
      return;
    }

    // Rebuild gutter lines
    gutter.innerHTML = '';
    Array.from({ length: lineCount }, (_, idx) => {
      const lineEl = document.createElement('div');
      lineEl.className = GUTTER_LINE_STYLES;
      lineEl.textContent = String(idx + 1);
      lineEl.setAttribute('data-line-index', String(idx));
      gutter.appendChild(lineEl);
    });
  }

  /**
   * Ensure a trailing <br> exists when the text content ends with '\n'.
   * Browsers collapse a trailing newline in contenteditable — no visible
   * empty line is rendered, so the caret has nowhere to go.  A sentinel
   * <br> forces the browser to create the line box.  It is invisible to
   * textContent, so save() and updateGutter() need no changes.
   */
  private syncTrailingBr(): void {
    if (!this._dom) {
      return;
    }

    const code = this._dom.codeElement;
    const text = code.textContent ?? '';
    const hasBr = code.lastChild instanceof HTMLBRElement;

    if (text.endsWith('\n') && !hasBr) {
      code.appendChild(document.createElement('br'));
    } else if (!text.endsWith('\n') && hasBr) {
      code.lastChild.remove();
    }
  }

  private scheduleHighlight(): void {
    if (this._highlightRafId !== null) {
      return;
    }

    this._highlightRafId = requestAnimationFrame(() => {
      this._highlightRafId = null;
      void this.highlightCode();
    });
  }

  private scheduleDetection(): void {
    if (this._detectionTimeoutId !== null) {
      clearTimeout(this._detectionTimeoutId);
    }

    this._detectionTimeoutId = setTimeout(() => {
      this._detectionTimeoutId = null;
      const code = this._dom?.codeElement.textContent ?? '';
      void detectLanguage(code).then((detected) => {
        if (detected === this._detectedLanguage) {
          return;
        }
        this._detectedLanguage = detected;
        // Rebuild picker so the detected language section updates
        if (this._dom) {
          if (this._picker) {
            this._picker.destroy();
          }
          this._picker = this.buildLanguagePicker(this._dom.languageButton, this._dom.wrapper);
        }
      });
    }, 600);
  }

  private async highlightCode(): Promise<void> {
    const lang = this._data.language;

    if (!isHighlightable(lang)) return;

    const code = this._dom?.codeElement.textContent ?? '';

    if (!code.trim()) return;

    const html = await tokenizePrism(code, lang);

    if (!html || !this._dom) return;

    // Text may have changed during the async tokenize (e.g. user pressed
    // Enter). Applying a stale html would overwrite the newer content.
    if (this._dom.codeElement.textContent !== code) return;

    // Dispose only when language changes — cleanup wipes innerHTML to plain
    // text, which destroys the caret before applyPrismHighlight can save it.
    // Same-lang re-highlight lets applyPrismHighlight's own innerHTML swap
    // preserve the caret via its internal save/restore.
    if (this._highlightCleanup && this._highlightedLang !== lang) {
      this._highlightCleanup();
      this._highlightCleanup = null;
    }

    this._highlightCleanup = applyPrismHighlight(this._dom.codeElement, html, lang);
    this._highlightedLang = lang;

    // applyPrismHighlight rewrites innerHTML, dropping the trailing <br>
    // sentinel that the keydown handler installed. Without it, a final
    // newline collapses and the caret has no line box on the new line.
    this.syncTrailingBr();
  }

  /**
   * Place caret at end of the Nth text line inside the code element.
   * Line index is 0-based. Out-of-range indices are clamped.
   */
  private focusLineEnd(lineIndex: number): void {
    if (!this._dom) return;

    const codeEl = this._dom.codeElement;
    const text = codeEl.textContent ?? '';
    const lines = text.split('\n');
    const clamped = Math.max(0, Math.min(lineIndex, lines.length - 1));
    const targetOffset = lines
      .slice(0, clamped)
      .reduce((acc, line) => acc + line.length + 1, 0) + lines[clamped].length;

    const position = findTextPosition(codeEl, targetOffset);
    const range = codeEl.ownerDocument.createRange();

    range.setStart(position.node, position.offset);
    range.setEnd(position.node, position.offset);

    const selection = codeEl.ownerDocument.getSelection();

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }

    codeEl.focus({ preventScroll: true });
  }

  private exitBlock(): void {
    const currentIndex = this.api.blocks.getCurrentBlockIndex();

    this.api.blocks.insert(undefined, undefined, undefined, currentIndex + 1);
  }

  public removed(): void {
    if (this._highlightCleanup) {
      this._highlightCleanup();
      this._highlightCleanup = null;
    }
    this._highlightedLang = null;

    disposePrismStyles();

    if (this._highlightRafId !== null) {
      cancelAnimationFrame(this._highlightRafId);
      this._highlightRafId = null;
    }

    if (this._detectionTimeoutId !== null) {
      clearTimeout(this._detectionTimeoutId);
      this._detectionTimeoutId = null;
    }

    if (this._picker) {
      this._picker.destroy();
      this._picker = null;
    }

    this._dom = null;
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconCodeBlock,
      titleKey: 'code',
      shortcut: '```',
      searchTerms: ['code', 'pre', 'snippet', 'program'],
      searchTermKeys: ['code', 'pre', 'snippet', 'program'],
    };
  }

  public static get conversionConfig(): ConversionConfig {
    return {
      export: 'code',
      import: 'code',
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      code: true,
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * CodeTool handles Enter and Tab itself (see handleCodeKeydown). Declaring
   * this flag tells KeyboardNavigation to skip its own Enter handling — without
   * it, the global handler would run on top of the tool's handler, splitting
   * the block and yanking the caret out of the code element on every newline.
   */
  public static get enableLineBreaks(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['PRE'],
      patterns: {
        code: /^```/,
      },
    };
  }
}

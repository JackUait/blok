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
import { IconCodeBlock } from '../../components/icons';
import { buildCodeDOM } from './dom-builder';
import type { CodeDOMRefs } from './dom-builder';
import { handleCodeKeydown } from './code-keyboard';
import { LanguagePicker } from './language-picker';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  CODE_AREA_STYLES,
  COPY_CODE_KEY,
  WRAP_LINES_KEY,
  LINE_NUMBERS_KEY,
  COPIED_KEY,
  LANGUAGE_KEY,
  COPIED_FEEDBACK_STYLES,
  PREVIEWABLE_LANGUAGES,
  CODE_TAB_KEY,
  PREVIEW_TAB_KEY,
  TAB_STYLES,
  TAB_ACTIVE_STYLES,
  TAB_INACTIVE_STYLES,
  PREVIEW_AREA_STYLES,
  GUTTER_LINE_STYLES,
} from './constants';
import { renderLatex } from './katex-loader';
import { renderMermaid } from './mermaid-loader';
import { tokenizeCode, isHighlightable } from './shiki-loader';
import { applyHighlights, isHighlightingSupported } from './highlight-applier';

const COPIED_FEEDBACK_DURATION = 1500;

export class CodeTool implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private _data: CodeData;
  private _dom: CodeDOMRefs | null = null;
  private _wrapping = true;
  private _lineNumbers = true;
  private _picker: LanguagePicker | null = null;
  private _previewActive = false;
  private _previewContainer: HTMLElement | null = null;
  private _disposeHighlights: (() => void) | null = null;
  private _highlightRafId: number | null = null;

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
      wrapLabel: this.api.i18n.t(WRAP_LINES_KEY),
      lineNumbersLabel: this.api.i18n.t(LINE_NUMBERS_KEY),
      previewable: this.readOnly ? false : isPreviewable,
      codeTabLabel: this.api.i18n.t(CODE_TAB_KEY),
      previewTabLabel: this.api.i18n.t(PREVIEW_TAB_KEY),
    });

    this._dom = dom;

    // Line numbers gutter visibility
    dom.gutterElement.hidden = !this._lineNumbers;
    dom.lineNumbersButton.addEventListener('click', () => this.toggleLineNumbers());

    // Read-only + previewable: show preview only, hide code, no tabs
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

    // Edit mode + previewable: show tabs, default to preview
    if (!this.readOnly && isPreviewable && dom.codeTab && dom.previewTab && dom.previewElement) {
      this._previewActive = true;
      dom.preElement.hidden = true;
      dom.gutterElement.hidden = true;
      dom.previewElement.hidden = false;
      this._previewContainer = dom.previewElement;
      void this.renderPreview();

      dom.codeTab.addEventListener('click', () => this.showCode());
      dom.previewTab.addEventListener('click', () => this.showPreview());
    }

    if (!this.readOnly) {
      dom.codeElement.addEventListener('keydown', (event: KeyboardEvent) => {
        const handled = handleCodeKeydown(event, dom.codeElement, () => this.exitBlock());

        if (handled) {
          event.preventDefault();
        }
      });

      dom.codeElement.addEventListener('input', () => {
        this.updateGutter();
        this.scheduleHighlight();
      });
    }

    dom.copyButton.addEventListener('click', () => this.copyCode());
    dom.wrapButton.addEventListener('click', () => this.toggleWrap());

    if (!this.readOnly) {
      this._picker = new LanguagePicker({
        languages: LANGUAGES,
        onSelect: (id: string) => this.setLanguage(id),
        i18n: this.api.i18n,
        activeLanguageId: this._data.language,
      });

      document.body.appendChild(this._picker.getElement());

      dom.languageButton.addEventListener('click', () => {
        this._picker?.open(dom.languageButton);
      });
    }

    return dom.wrapper;
  }

  public rendered(): void {
    void this.highlightCode();
  }

  private showCode(): void {
    if (!this._dom?.previewElement || !this._dom.codeTab || !this._dom.previewTab) {
      return;
    }

    this._previewActive = false;
    this._dom.preElement.hidden = false;
    this._dom.gutterElement.hidden = !this._lineNumbers;
    this._dom.previewElement.hidden = true;
    this._dom.codeTab.className = `${TAB_STYLES} ${TAB_ACTIVE_STYLES}`;
    this._dom.previewTab.className = `${TAB_STYLES} ${TAB_INACTIVE_STYLES}`;
  }

  private showPreview(): void {
    if (!this._dom?.previewElement || !this._dom.codeTab || !this._dom.previewTab) {
      return;
    }

    this._previewActive = true;
    this._dom.preElement.hidden = true;
    this._dom.gutterElement.hidden = true;
    this._dom.previewElement.hidden = false;
    this._dom.codeTab.className = `${TAB_STYLES} ${TAB_INACTIVE_STYLES}`;
    this._dom.previewTab.className = `${TAB_STYLES} ${TAB_ACTIVE_STYLES}`;

    // Re-render preview with current code content
    void this.renderPreview();
  }

  private async renderPreview(): Promise<void> {
    if (!this._previewContainer) {
      return;
    }

    const code = this._dom?.codeElement.textContent ?? this._data.code;
    const rendered = this._data.language === 'mermaid'
      ? await renderMermaid(code)
      : await renderLatex(code);

    this._previewContainer.innerHTML = rendered;
  }

  public save(_blockContent: HTMLElement): CodeData {
    return {
      code: this._dom?.codeElement.textContent ?? '',
      language: this._data.language,
      lineNumbers: this._lineNumbers,
    };
  }

  public validate(savedData: CodeData): boolean {
    return savedData.code.trim() !== '';
  }

  public merge(data: CodeData): void {
    this._data.code += '\n' + data.code;

    if (this._dom) {
      this._dom.codeElement.textContent = this._data.code;
    }

    void this.highlightCode();
  }

  public renderSettings(): MenuConfig {
    return [
      {
        icon: IconCodeBlock,
        title: this.api.i18n.t(LANGUAGE_KEY),
        name: 'code-language',
        children: {
          items: LANGUAGES.map((lang) => ({
            title: lang.name,
            onActivate: (): void => this.setLanguage(lang.id),
            closeOnActivate: true,
            isActive: this._data.language === lang.id,
          })),
        },
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
    }

    void this.highlightCode();
  }

  private setLanguage(id: string): void {
    this._data.language = id;

    if (this._dom) {
      this._dom.languageButton.textContent = this.getLanguageName(id);
    }

    this._picker?.setActiveLanguage(id);
    void this.highlightCode();
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

  private toggleWrap(): void {
    this._wrapping = !this._wrapping;

    if (!this._dom) {
      return;
    }

    if (this._wrapping) {
      this._dom.codeElement.className = CODE_AREA_STYLES;
    } else {
      this._dom.codeElement.className = CODE_AREA_STYLES.replace('whitespace-pre-wrap', 'whitespace-pre');
    }
  }

  private toggleLineNumbers(): void {
    this._lineNumbers = !this._lineNumbers;

    if (this._dom) {
      this._dom.gutterElement.hidden = !this._lineNumbers;
    }
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
      gutter.appendChild(lineEl);
    });
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

  private async highlightCode(): Promise<void> {
    if (!isHighlightingSupported() || !isHighlightable(this._data.language)) {
      this._disposeHighlights?.();
      this._disposeHighlights = null;
      return;
    }

    const code = this._dom?.codeElement.textContent ?? '';

    if (!code.trim()) {
      this._disposeHighlights?.();
      this._disposeHighlights = null;
      return;
    }

    const tokens = await tokenizeCode(code, this._data.language);

    if (!tokens || !this._dom) {
      return;
    }

    // Clean up previous highlights before applying new ones
    this._disposeHighlights?.();
    this._disposeHighlights = applyHighlights(this._dom.codeElement, tokens);
  }

  private exitBlock(): void {
    const currentIndex = this.api.blocks.getCurrentBlockIndex();

    this.api.blocks.insert(undefined, undefined, undefined, currentIndex + 1);
  }

  public removed(): void {
    this._disposeHighlights?.();
    this._disposeHighlights = null;

    if (this._highlightRafId !== null) {
      cancelAnimationFrame(this._highlightRafId);
      this._highlightRafId = null;
    }

    if (this._picker) {
      this._picker.getElement().remove();
      this._picker = null;
    }
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconCodeBlock,
      title: 'Code',
      titleKey: 'code',
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

  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['PRE'],
      patterns: {
        code: /^```/,
      },
    };
  }
}

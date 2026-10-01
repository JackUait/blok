import type {
  API,
  BlockTool,
  BlockAPI,
  BlockToolConstructorOptions,
  PasteConfig,
  PasteEvent,
  ToolboxConfig,
  ConversionConfig,
  ToolSanitizerConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import type { CodeData } from '../../../types/tools/code';
import { IconCodeBlock, IconCheck, IconCopy, IconWand } from '../../components/icons';
import { buildCodeDOM, setActiveViewMode, setFilenameDisplay } from './dom-builder';
import { caretLineIndex, measureLineRows, rowHeight } from './line-geometry';
import type { CodeDOMRefs } from './dom-builder';
import { handleCodeKeydown } from './code-keyboard';
import { PopoverDesktop } from '../../components/utils/popover';
import { PLAINTEXT } from '../../components/utils/sanitizer';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { onHover as tooltipOnHover } from '../../components/utils/tooltip';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  COPY_CODE_KEY,
  COPIED_KEY,
  LANGUAGE_KEY,
  SEARCH_LANGUAGE_KEY,
  AUTO_DETECTED_KEY,
  PLAIN_TEXT_KEY,
  FILENAME_KEY,
  FILENAME_INPUT_STYLES,
  LANGUAGE_COLORS,
  LANGUAGE_DOT_FALLBACK,
  LANGUAGE_BUTTON_STYLES,
  LANGUAGE_LABEL_STYLES,
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
import { renderLatex } from '../../shared/katex';
import { renderMermaid } from './mermaid-loader';
import { tokenizePrism, isHighlightable } from './prism-loader';
import { applyPrismHighlight, disposePrismStyles, ensurePrismStyles } from './prism-applier';
import {
  buildLanguagePickerItems as buildPickerItems,
  loadLanguageLogos,
  loadedLanguageLogos,
  readRecentLanguages,
  rememberLanguage,
  repaintBadges,
  resolvePickerTheme,
} from './language-picker';
import { detectLanguage } from './language-detector';
import { renderCodePreview } from './preview';
import { normalizeFenceLang } from '../../markdown/fence-language';
import { CODE_LANGUAGE_ATTR } from '../../components/modules/paste/constants';

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
  private block: BlockAPI | undefined;
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
  private _lineRows: number[] = [];
  private _activeLineIndex: number | null = null;
  private _rowHeight = 0;
  private _paddingTop = 0;
  private _geometryRafId: number | null = null;
  private _previewRequest = 0;
  private _resizeObserver: ResizeObserver | null = null;
  private _copiedTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly onSelectionChange = (): void => this.updateActiveLine();

  constructor({ data, api, readOnly, block }: BlockToolConstructorOptions<CodeData>) {
    this.api = api;
    this.block = block;
    this.readOnly = readOnly;
    this._data = {
      code: data?.code ?? '',
      language: data?.language ?? DEFAULT_LANGUAGE,
      lineNumbers: data?.lineNumbers,
      ...(data?.filename ? { filename: data.filename } : {}),
    };
    this._lineNumbers = data?.lineNumbers ?? true;
  }

  public render(): HTMLElement {
    const isPreviewable = PREVIEWABLE_LANGUAGES.has(this._data.language);

    const dom = buildCodeDOM({
      code: this._data.code,
      languageName: this.getLanguageName(this._data.language),
      languageColor: CodeTool.languageColor(this._data.language),
      filename: this._data.filename ?? '',
      filenamePlaceholder: this.api.i18n.t(FILENAME_KEY),
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
      previewEl.setAttribute(DATA_ATTR.chrome, '');
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

      // One document listener per focused block, not per rendered block.
      dom.codeElement.addEventListener('focus', () => {
        document.addEventListener('selectionchange', this.onSelectionChange);
        this.updateActiveLine();
      });

      dom.codeElement.addEventListener('blur', () => {
        document.removeEventListener('selectionchange', this.onSelectionChange);
        this.updateActiveLine();
      });

      this.wireFilenameEditing(dom.filenameElement);

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

    dom.languageButton.addEventListener('click', () => {
      if (this.readOnly) {
        return;
      }

      if (this._picker?.isShown) {
        this._picker.hide();

        return;
      }

      // Suggestions depend on recent picks in other blocks and on the filename,
      // so the rows are rebuilt on every open.
      this.rebuildLanguagePicker()?.show();
      this.setLanguagePickerExpanded(true);
    });

    if (!this.readOnly) {
      this.ensureLanguagePicker();
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

    if (this._dom && typeof ResizeObserver !== 'undefined') {
      // Width changes rewrap lines, which moves every gutter number below.
      this._resizeObserver = new ResizeObserver(() => this.scheduleLineGeometry());
      this._resizeObserver.observe(this._dom.codeElement);
    }

    this.scheduleLineGeometry();
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
      this._picker?.hide();
      this._dom.languageButton.removeAttribute('aria-haspopup');
      this._dom.languageButton.removeAttribute('aria-expanded');
      this._dom.languageButton.className = LANGUAGE_LABEL_STYLES;
      this._dom.languageButton.tabIndex = -1;
    } else {
      this._dom.codeElement.setAttribute('contenteditable', 'plaintext-only');
      this._dom.codeElement.setAttribute('spellcheck', 'false');
      this._dom.languageButton.setAttribute('aria-haspopup', 'listbox');
      this._dom.languageButton.setAttribute('aria-expanded', 'false');
      this._dom.languageButton.className = LANGUAGE_BUTTON_STYLES;
      this._dom.languageButton.removeAttribute('tabindex');
    }

    // The chevron advertises an openable picker — there is none in read-only
    this._dom.languageChevron.hidden = state;

    const filenameElement = document.createElement(state ? 'span' : 'button');

    filenameElement.setAttribute('data-blok-testid', 'code-filename');
    this._dom.filenameElement.replaceWith(filenameElement);
    this._dom.filenameElement = filenameElement;
    this.renderFilename();

    if (!state) {
      this.wireFilenameEditing(filenameElement);
    }

    this.updateActiveLine();
  }

  private renderFilename(): void {
    if (!this._dom) {
      return;
    }

    setFilenameDisplay(this._dom.filenameElement, this._data.filename ?? '', this.api.i18n.t(FILENAME_KEY), this.readOnly);
  }

  private wireFilenameEditing(display: HTMLElement): void {
    display.addEventListener('click', () => this.startFilenameEdit());
  }

  /**
   * Swap the filename button for an input while editing. The input owns its
   * keys: Enter commits and moves into the code, Escape reverts.
   */
  private startFilenameEdit(): void {
    const dom = this._dom;

    if (!dom || this.readOnly) {
      return;
    }

    const display = dom.filenameElement;
    const input = document.createElement('input');
    const previous = this._data.filename ?? '';
    // Chrome blurs the input synchronously while replaceWith removes it; the
    // flag keeps that nested blur from finishing a second time.
    const state = { done: false };
    const finish = (commit: boolean, focusCode: boolean): void => {
      if (state.done) {
        return;
      }

      state.done = true;

      const next = commit ? input.value.trim() : previous;

      input.replaceWith(display);

      if (next) {
        this._data.filename = next;
      } else {
        delete this._data.filename;
      }

      this.renderFilename();

      if (next !== previous) {
        this.block?.dispatchChange();
      }

      if (focusCode) {
        dom.codeElement.focus();
      }
    };

    input.type = 'text';
    input.value = previous;
    input.className = FILENAME_INPUT_STYLES;
    input.placeholder = this.api.i18n.t(FILENAME_KEY);
    input.setAttribute('aria-label', this.api.i18n.t(FILENAME_KEY));
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute(DATA_ATTR.keyboardOwner, '');
    input.setAttribute('data-blok-testid', 'code-filename-input');

    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true, true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false, false);
      }
    });
    input.addEventListener('blur', () => finish(true, false));

    display.replaceWith(input);
    input.focus();
    input.select();
  }

  private rebuildLanguagePicker(): PopoverDesktop | null {
    this._picker?.destroy();
    this._picker = this._dom ? this.buildLanguagePicker(this._dom.languageButton, this._dom.wrapper) : null;

    return this._picker;
  }

  private ensureLanguagePicker(): void {
    if (this._picker || !this._dom) {
      return;
    }

    this._picker = this.buildLanguagePicker(this._dom.languageButton, this._dom.wrapper);
  }

  public save(_blockContent: HTMLElement): CodeData {
    return {
      code: this._dom?.codeElement.textContent ?? '',
      language: this._data.language,
      lineNumbers: this._lineNumbers,
      // Omitted when empty so documents without one keep their saved shape.
      ...(this._data.filename ? { filename: this._data.filename } : {}),
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
      ...(newData.filename ? { filename: newData.filename } : {}),
    };

    if (!this._dom) {
      return true;
    }

    this.renderFilename();

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

    this.renderLanguageLabel(languageId);

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

  /**
   * `validate()` is a data-integrity predicate, not an emptiness filter — a
   * false return makes the Saver drop the block entirely. An intentionally
   * empty code block is valid content the user asked for, so only a missing
   * or non-string `code` field (a bad migration) is rejected. Mirrors the
   * house convention in list/header.
   */
  public validate(savedData: CodeData): boolean {
    return typeof savedData.code === 'string';
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
          title: this.getLanguageName(detectedLanguage.id),
          secondaryLabel: this.api.i18n.t(AUTO_DETECTED_KEY),
          icon: IconWand,
          onActivate: (): void => this.setLanguage(detectedLanguage.id),
          closeOnActivate: true,
          isActive: (): boolean => this._data.language === detectedLanguage.id,
        });
        childItems.push({ type: PopoverItemType.Separator });
      }
    }

    childItems.push(...LANGUAGES.map((lang) => ({
      title: this.getLanguageName(lang.id),
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
        this._data.code = CodeTool.textWithLineBreaks(content);
        this._data.language =
          normalizeFenceLang(content.getAttribute(CODE_LANGUAGE_ATTR) ?? '') ?? this._data.language;
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

  /**
   * Text of a pasted element with each `<br>` read as a newline
   * (`textContent` drops them).
   * @param element - the pasted element
   */
  private static textWithLineBreaks(element: HTMLElement): string {
    const copy = element.cloneNode(true) as HTMLElement;

    copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));

    return copy.textContent ?? '';
  }

  private setLanguage(id: string): void {
    this._data.language = id;
    const isPreviewable = PREVIEWABLE_LANGUAGES.has(id);

    if (this._dom) {
      this.renderLanguageLabel(id);

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

  private buildLanguagePickerItems(): PopoverItemParams[] {
    return buildPickerItems({
      theme: resolvePickerTheme(),
      logos: loadedLanguageLogos(),
      selectedId: this._data.language,
      detectedId: this._detectedLanguage,
      filename: this._data.filename ?? '',
      recent: readRecentLanguages(),
      nameOf: (id) => this.getLanguageName(id),
      t: (key) => this.api.i18n.t(key),
      onPick: (id) => {
        rememberLanguage(id);
        this.setLanguage(id);
      },
    });
  }

  /**
   * Creates a new PopoverDesktop instance for the language picker.
   */
  private buildLanguagePicker(trigger: HTMLElement, leftAlignElement: HTMLElement): PopoverDesktop {
    const picker = new PopoverDesktop({
      items: this.buildLanguagePickerItems(),
      trigger,
      leftAlignElement,
      searchable: true,
      width: '240px',
      messages: {
        search: this.api.i18n.t(SEARCH_LANGUAGE_KEY),
        nothingFound: this.api.i18n.t('popover.nothingFound'),
        actions: this.api.i18n.t('popover.actions'),
        // Result-count announcement template for screen readers (parity with
        // the Block Settings / Toolbox searchable popovers).
        searchResults: this.api.i18n.t('a11y.searchResults'),
      },
    });

    // Covers every close path the trigger's own click handler cannot see:
    // outside click, Escape, and picking a language.
    picker.on(PopoverEvent.Closed, () => {
      this.setLanguagePickerExpanded(false);
      void this.previewLanguage(null);
    });
    picker.onCurrentItemChange((current) => {
      void this.previewLanguage(current?.name ?? null);
    });

    if (loadedLanguageLogos() === null) {
      // First open: rows show mono marks, then swap to logos in place.
      void loadLanguageLogos()
        .then((logos) => repaintBadges(picker.getElement(), { theme: resolvePickerTheme(), logos }))
        .catch(() => { /* logos unavailable: the monograms stay */ });
    }

    this.setLanguagePickerExpanded(false);

    return picker;
  }

  /**
   * Recolor the code as `id` would, on the overlay layer only. `null`, the
   * current language, or a hidden code area clears it. A newer call wins over
   * a tokenize still in flight.
   */
  private async previewLanguage(id: string | null): Promise<void> {
    const layer = this._dom?.previewLayer;

    if (!layer || !this._dom) {
      return;
    }

    const request = ++this._previewRequest;
    const code = this._dom.codeElement.textContent ?? '';

    if (id === null || id === this._data.language || this._dom.preElement.hidden || code === '') {
      layer.hidden = true;
      layer.textContent = '';

      return;
    }

    const html = isHighlightable(id) ? await tokenizePrism(code, id) : null;

    if (request !== this._previewRequest || !this._dom) {
      return;
    }

    ensurePrismStyles();
    layer.className = layer.className.replace(/\s?(blok-code|lang-\S+)/g, '');
    layer.classList.add('blok-code', `lang-${id.replace(/\s+/g, '-')}`);

    if (html === null) {
      layer.textContent = code;
    } else {
      layer.innerHTML = html;
    }

    layer.hidden = false;
  }

  /**
   * Mirrors the picker's open state onto the trigger. Read-only strips the
   * popup contract entirely, so the state has nothing to attach to there.
   */
  private setLanguagePickerExpanded(expanded: boolean): void {
    if (this.readOnly || !this._dom) {
      return;
    }

    this._dom.languageButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  private renderLanguageLabel(id: string): void {
    if (!this._dom) {
      return;
    }

    const textSpan = this._dom.languageDot.nextElementSibling;

    if (textSpan) {
      textSpan.textContent = this.getLanguageName(id);
    }

    this._dom.languageDot.style.backgroundColor = CodeTool.languageColor(id);
  }

  private static languageColor(id: string): string {
    return LANGUAGE_COLORS[id] ?? LANGUAGE_DOT_FALLBACK;
  }

  private getLanguageName(id: string): string {
    if (id === DEFAULT_LANGUAGE) {
      return this.api.i18n.t(PLAIN_TEXT_KEY);
    }

    const entry = LANGUAGES.find((lang) => lang.id === id);

    return entry ? entry.name : id;
  }

  private copyCode(): void {
    const code = this._dom?.codeElement.textContent ?? '';

    void navigator.clipboard.writeText(code).then(() => {
      if (!this._dom) {
        return;
      }

      this.setCopied(true);

      if (this._copiedTimeoutId !== null) {
        clearTimeout(this._copiedTimeoutId);
      }

      this._copiedTimeoutId = setTimeout(() => {
        this._copiedTimeoutId = null;
        this.setCopied(false);
      }, COPIED_FEEDBACK_DURATION);
    }).catch(() => { /* clipboard unavailable */ });
  }

  private setCopied(copied: boolean): void {
    if (!this._dom) {
      return;
    }

    const { copyButton, copyLabel } = this._dom;

    copyButton.querySelector('svg')?.remove();
    copyButton.insertAdjacentHTML('afterbegin', copied ? IconCheck : IconCopy);
    copyButton.setAttribute('data-copied', String(copied));
    copyLabel.textContent = this.api.i18n.t(copied ? COPIED_KEY : COPY_CODE_KEY);
  }

  private updateGutter(): void {
    if (!this._dom) {
      return;
    }

    const code = this._dom.codeElement.textContent ?? '';
    const lineCount = code ? code.split('\n').length : 1;
    const gutter = this._dom.gutterElement;
    const currentCount = gutter.children.length;

    if (currentCount !== lineCount) {
      this.rebuildGutter(lineCount);
    }

    this.scheduleLineGeometry();
  }

  private rebuildGutter(lineCount: number): void {
    if (!this._dom) {
      return;
    }

    const gutter = this._dom.gutterElement;

    // Rebuild gutter lines
    gutter.innerHTML = '';
    Array.from({ length: lineCount }, (_, idx) => {
      const lineEl = document.createElement('div');
      lineEl.className = GUTTER_LINE_STYLES;
      lineEl.textContent = String(idx + 1);
      lineEl.setAttribute('data-line-index', String(idx));
      gutter.appendChild(lineEl);
    });
    this._lineRows = [];
    this._activeLineIndex = null;
  }

  /** One layout read per frame, however many edits, highlights and resizes land in it. */
  private scheduleLineGeometry(): void {
    if (this._geometryRafId !== null) {
      return;
    }

    this._geometryRafId = requestAnimationFrame(() => {
      this._geometryRafId = null;
      this.syncLineGeometry();
    });
  }

  /**
   * Give each gutter number the height of its wrapped line, then move the
   * active-line band. Reads layout, so it runs after the DOM settles.
   */
  private syncLineGeometry(): void {
    if (!this._dom) {
      return;
    }

    const rows = measureLineRows(this._dom.codeElement);
    const changed = rows.length !== this._lineRows.length || rows.some((r, i) => r !== this._lineRows[i]);
    const row = rowHeight(this._dom.codeElement);

    this._paddingTop = parseFloat(getComputedStyle(this._dom.codeElement).paddingTop || '0');

    if (changed || row !== this._rowHeight) {

      Array.from(this._dom.gutterElement.children).forEach((line, index) => {
        if (line instanceof HTMLElement) {
          if ((rows[index] ?? 1) > 1) {
            line.style.setProperty('height', `${rows[index] * row}px`);
          } else {
            line.style.removeProperty('height');
          }
        }
      });
      this._lineRows = rows;
      this._rowHeight = row;
    }

    this.updateActiveLine();
  }

  private updateActiveLine(): void {
    const dom = this._dom;

    if (!dom) {
      return;
    }

    const isFocused = dom.codeElement.ownerDocument.activeElement === dom.codeElement;
    const index = isFocused && !this.readOnly ? caretLineIndex(dom.codeElement) : null;

    if (index !== this._activeLineIndex) {
      const rows = dom.gutterElement.children;

      if (this._activeLineIndex !== null) {
        rows[this._activeLineIndex]?.removeAttribute('data-active');
      }

      if (index !== null) {
        rows[index]?.setAttribute('data-active', 'true');
      }

      this._activeLineIndex = index;
    }

    if (!dom.activeLine) {
      return;
    }

    if (index === null || dom.preElement.hidden) {
      dom.activeLine.hidden = true;

      return;
    }

    const rowsBefore = this._lineRows.slice(0, index).reduce((sum, r) => sum + r, 0);
    const transform = `translateY(${this._paddingTop + rowsBefore * this._rowHeight}px)`;
    const height = `${(this._lineRows[index] ?? 1) * this._rowHeight}px`;

    // Each write invalidates layout for the whole block; skip unchanged ones.
    if (dom.activeLine.style.transform !== transform) {
      dom.activeLine.style.transform = transform;
    }

    if (dom.activeLine.style.height !== height) {
      dom.activeLine.style.height = height;
    }

    dom.activeLine.hidden = false;
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
      const br = document.createElement('br');
      code.appendChild(br);
      this.pinCaretBeforeSentinelBr(code, br);
    } else if (!text.endsWith('\n') && hasBr) {
      code.lastChild.remove();
    }
  }

  /**
   * WebKit collapses the boundary `...\n|<br>` on the next native text
   * insertion — it strips both the trailing '\n' and the sentinel <br>,
   * so typing lands on the previous line. If the caret is currently
   * sitting at the end of a text node whose final char is '\n' and the
   * <br> we just appended is its next sibling, pin the caret *before*
   * the <br> (a stable boundary WebKit preserves).
   */
  private pinCaretBeforeSentinelBr(code: HTMLElement, br: HTMLBRElement): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const { startContainer, startOffset } = range;
    if (startContainer.nodeType !== Node.TEXT_NODE) return;
    if (!code.contains(startContainer)) return;

    const text = startContainer as Text;
    if (startOffset !== text.length) return;
    if (!text.data.endsWith('\n')) return;
    if (text.nextSibling !== br) return;

    const fixed = document.createRange();
    fixed.setStartBefore(br);
    fixed.collapse(true);
    sel.removeAllRanges();
    sel.addRange(fixed);
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
    this.scheduleLineGeometry();
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

    const newBlock = this.api.blocks.insert(undefined, undefined, undefined, currentIndex + 1);

    // insert() does not move the caret: without this the next keystrokes land
    // back in the code.
    this.api.caret.setToBlock(newBlock.id, 'start');
  }

  public removed(): void {
    document.removeEventListener('selectionchange', this.onSelectionChange);
    this._resizeObserver?.disconnect();

    if (this._geometryRafId !== null) {
      cancelAnimationFrame(this._geometryRafId);
      this._geometryRafId = null;
    }
    this._resizeObserver = null;

    if (this._copiedTimeoutId !== null) {
      clearTimeout(this._copiedTimeoutId);
      this._copiedTimeoutId = null;
    }

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
      section: 'media',
      preview: { render: renderCodePreview, descriptionKey: 'toolbox.preview.code' },
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
      /**
       * `code` is literal source text, not markup. `true` would route it
       * through the HTML parser, which entity-encodes `<`/`&` and deletes
       * anything shaped like a stray end tag — irrecoverable corruption.
       */
      code: PLAINTEXT,
      filename: PLAINTEXT,
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get frameRadius(): string {
    return 'var(--blok-radius-block)';
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
      /**
       * The language attribute must be listed here or the paste sanitizer drops
       * it, since it keeps only the attributes a tool names for its own tags.
       */
      tags: [{ PRE: { [CODE_LANGUAGE_ATTR]: true } }],
      patterns: {
        code: /^```/,
      },
    };
  }
}


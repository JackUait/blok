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
  COPIED_KEY,
  LANGUAGE_KEY,
  COPIED_FEEDBACK_STYLES,
} from './constants';

const COPIED_FEEDBACK_DURATION = 1500;

export class CodeTool implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private _data: CodeData;
  private _dom: CodeDOMRefs | null = null;
  private _wrapping = true;
  private _picker: LanguagePicker | null = null;

  constructor({ data, api, readOnly }: BlockToolConstructorOptions<CodeData>) {
    this.api = api;
    this.readOnly = readOnly;
    this._data = {
      code: data?.code ?? '',
      language: data?.language ?? DEFAULT_LANGUAGE,
    };
  }

  public render(): HTMLElement {
    const dom = buildCodeDOM({
      code: this._data.code,
      languageName: this.getLanguageName(this._data.language),
      readOnly: this.readOnly,
      copyLabel: this.api.i18n.t(COPY_CODE_KEY),
      wrapLabel: this.api.i18n.t(WRAP_LINES_KEY),
    });

    this._dom = dom;

    if (!this.readOnly) {
      dom.codeElement.addEventListener('keydown', (event: KeyboardEvent) => {
        const handled = handleCodeKeydown(event, dom.codeElement, () => this.exitBlock());

        if (handled) {
          event.preventDefault();
        }
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

  public save(_blockContent: HTMLElement): CodeData {
    return {
      code: this._dom?.codeElement.textContent ?? '',
      language: this._data.language,
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
  }

  private setLanguage(id: string): void {
    this._data.language = id;

    if (this._dom) {
      this._dom.languageButton.textContent = this.getLanguageName(id);
    }

    this._picker?.setActiveLanguage(id);
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

  private exitBlock(): void {
    const currentIndex = this.api.blocks.getCurrentBlockIndex();

    this.api.blocks.insert(undefined, undefined, undefined, currentIndex + 1);
  }

  public removed(): void {
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

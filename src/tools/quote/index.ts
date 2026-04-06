import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  BlockToolData,
  PasteEvent,
  ToolboxConfig,
  ConversionConfig,
  ToolSanitizerConfig,
  PasteConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { DATA_ATTR } from '../../components/constants';
import { IconQuote } from '../../components/icons';
import { stripFakeBackgroundElements } from '../../components/utils';
import { isContentEmpty, PLACEHOLDER_FOCUS_ONLY_CLASSES, setupPlaceholder } from '../../components/utils/placeholder';
import { twMerge } from '../../components/utils/tw';

export interface QuoteData extends BlockToolData {
  text: string;
  size: 'default' | 'large';
}

const DEFAULT_PLACEHOLDER = 'tools.quote.placeholder';

const BASE_CLASSES = [
  'border-l-[3px]',
  'border-current',
  'pl-[0.9em]',
  'pr-[0.9em]',
  'py-[0.2em]',
  'leading-[1.5]',
  'outline-hidden',
  'mt-[0.3em]',
  'mb-[0.3em]',
];

const LARGE_CLASS = 'text-[1.2em]';

export class Quote implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private placeholderCleanup: (() => void) | null = null;
  private _data: QuoteData;
  private _element: HTMLQuoteElement | null = null;

  constructor({ data, api, readOnly }: BlockToolConstructorOptions<QuoteData>) {
    this.api = api;
    this.readOnly = readOnly;
    this._data = {
      text: data?.text ?? '',
      size: data?.size ?? 'default',
    };

    this.onKeyUp = this.onKeyUp.bind(this);
  }

  public onKeyUp(e: KeyboardEvent): void {
    if (e.code !== 'Backspace' && e.code !== 'Delete') {
      return;
    }

    if (!this._element) {
      return;
    }

    if (this._element.textContent === '') {
      this._element.innerHTML = '';
    }
  }

  private drawView(): HTMLQuoteElement {
    const el = document.createElement('blockquote');

    el.className = twMerge(
      this.api.styles.block,
      BASE_CLASSES,
      PLACEHOLDER_FOCUS_ONLY_CLASSES,
      this._data.size === 'large' ? LARGE_CLASS : ''
    );
    el.setAttribute(DATA_ATTR.tool, 'quote');
    el.contentEditable = 'false';

    if (this._data.text) {
      el.innerHTML = this._data.text;
    } else if (this.readOnly) {
      el.innerHTML = '<br>';
    }

    if (!this.readOnly) {
      el.contentEditable = 'true';
      el.addEventListener('keyup', this.onKeyUp);
      this.placeholderCleanup = setupPlaceholder(el, this.api.i18n.t(DEFAULT_PLACEHOLDER), 'data-blok-placeholder-active');
    }

    return el;
  }

  public render(): HTMLQuoteElement {
    if (!this._element) {
      this._element = this.drawView();
    }

    return this._element;
  }

  public setReadOnly(state: boolean): void {
    if (!this._element) {
      return;
    }

    this.readOnly = state;

    if (state) {
      this._element.contentEditable = 'false';
      this._element.removeEventListener('keyup', this.onKeyUp);

      if (this.placeholderCleanup) {
        this.placeholderCleanup();
        this.placeholderCleanup = null;
      }

      if (isContentEmpty(this._element)) {
        this._element.innerHTML = '<br>';
      }
    } else {
      this._element.contentEditable = 'true';
      this._element.addEventListener('keyup', this.onKeyUp);
      this.placeholderCleanup = setupPlaceholder(this._element, this.api.i18n.t(DEFAULT_PLACEHOLDER), 'data-blok-placeholder-active');

      if (this._element.innerHTML === '<br>') {
        this._element.innerHTML = '';
      }
    }
  }

  public save(blockContent: HTMLQuoteElement): QuoteData {
    return {
      text: stripFakeBackgroundElements(blockContent.innerHTML),
      size: this._data.size,
    };
  }

  public validate(savedData: QuoteData): boolean {
    return savedData.text.trim() !== '';
  }

  public merge(data: QuoteData): void {
    if (!this._element) {
      return;
    }

    this._data.text += data.text;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = data.text.trim();
    const fragment = document.createDocumentFragment();
    fragment.append(...Array.from(wrapper.childNodes));

    this._element.appendChild(fragment);
    this._element.normalize();
  }

  public renderSettings(): MenuConfig {
    return [
      {
        icon: IconQuote,
        title: this.api.i18n.t('tools.quote.size'),
        name: 'quote-size',
        children: {
          items: [
            {
              icon: IconQuote,
              title: this.api.i18n.t('tools.quote.defaultSize'),
              onActivate: (): void => this.setSize('default'),
              closeOnActivate: true,
              isActive: this._data.size === 'default',
            },
            {
              icon: IconQuote,
              title: this.api.i18n.t('tools.quote.largeSize'),
              onActivate: (): void => this.setSize('large'),
              closeOnActivate: true,
              isActive: this._data.size === 'large',
            },
          ],
        },
      },
    ];
  }

  private setSize(size: 'default' | 'large'): void {
    this._data.size = size;

    if (this._element) {
      this._element.className = twMerge(
        this.api.styles.block,
        BASE_CLASSES,
        PLACEHOLDER_FOCUS_ONLY_CLASSES,
        size === 'large' ? LARGE_CLASS : ''
      );
    }
  }

  public onPaste(event: PasteEvent): void {
    const detail = event.detail;

    if (!('data' in detail)) {
      return;
    }

    const content = detail.data as HTMLElement;

    this._data = {
      text: content.innerHTML,
      size: this._data.size,
    };

    if (this._element) {
      this._element.innerHTML = this._data.text || '';
    }
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconQuote,
      title: 'Quote',
      titleKey: 'quote',
      searchTerms: ['quote', 'blockquote', 'citation'],
      searchTermKeys: ['quote', 'blockquote', 'citation'],
    };
  }

  public static get conversionConfig(): ConversionConfig {
    return {
      export: 'text',
      import: 'text',
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      text: {
        br: true,
        b: true,
        i: true,
        a: true,
        mark: {
          style: true,
        },
      },
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }

  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['BLOCKQUOTE'],
    };
  }
}

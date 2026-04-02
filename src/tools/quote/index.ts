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
import { PLACEHOLDER_FOCUS_ONLY_CLASSES, setupPlaceholder } from '../../components/utils/placeholder';
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
  'mt-px',
  'mb-px',
];

const LARGE_CLASS = 'text-[1.2em]';

export class Quote implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private _data: QuoteData;
  private _element: HTMLQuoteElement | null = null;

  constructor({ data, api, readOnly }: BlockToolConstructorOptions<QuoteData>) {
    this.api = api;
    this.readOnly = readOnly;
    this._data = {
      text: data?.text ?? '',
      size: data?.size ?? 'default',
    };

    if (!this.readOnly) {
      this.onKeyUp = this.onKeyUp.bind(this);
    }
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

  public render(): HTMLQuoteElement {
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
      setupPlaceholder(el, this.api.i18n.t(DEFAULT_PLACEHOLDER), 'data-blok-placeholder-active');
    }

    this._element = el;

    return el;
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

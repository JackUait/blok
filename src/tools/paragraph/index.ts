/**
 * Paragraph Tool for the Blok Editor
 * Provides Text Block
 *
 * Based on @editorjs/paragraph by CodeX
 * @license MIT
 */
import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  BlockToolData,
  PasteEvent,
  ToolboxConfig,
  ConversionConfig,
  SanitizerConfig,
  PasteConfig,
} from '../../../types';
import { DATA_ATTR } from '../../components/constants';
import { IconText } from '../../components/icons';
import { stripFakeBackgroundElements } from '../../components/utils';
import { PLACEHOLDER_FOCUS_ONLY_CLASSES, setupPlaceholder } from '../../components/utils/placeholder';
import { twMerge } from '../../components/utils/tw';

/**
 * Tool's input and output data format
 */
export interface ParagraphData extends BlockToolData {
  /** Paragraph's content. Can include HTML tags: <a><b><i> */
  text: string;
}

/**
 * Style overrides for paragraph customization
 */
export interface ParagraphStyleConfig {
  /** Custom font size (e.g., '16px', '1rem') */
  size?: string;
  /** Custom line height (e.g., '1.6', '24px') */
  lineHeight?: string;
  /** Custom margin top (e.g., '10px', '0.5rem') */
  marginTop?: string;
  /** Custom margin bottom (e.g., '10px', '0.5rem') */
  marginBottom?: string;
}

/**
 * Tool's config from Editor
 *
 * To customize the toolbox icon, use the `toolbox` property in the tool settings:
 * @example
 * ```typescript
 * tools: {
 *   paragraph: {
 *     toolbox: {
 *       icon: '<svg>...</svg>',
 *       title: 'Custom Text'
 *     }
 *   }
 * }
 * ```
 */
export interface ParagraphConfig {
  /** Placeholder for the empty paragraph */
  placeholder?: string;
  /** Whether or not to keep blank paragraphs when saving editor data */
  preserveBlank?: boolean;
  /** Style overrides for paragraph customization */
  styles?: ParagraphStyleConfig;
}

/**
 * Helper function to parse HTML string into DocumentFragment
 *
 * @param html - HTML string to parse
 * @returns DocumentFragment with parsed nodes
 */
const parseHtml = (html: string): DocumentFragment => {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html.trim();

  const fragment = document.createDocumentFragment();

  fragment.append(...Array.from(wrapper.childNodes));

  return fragment;
};

/**
 * Paragraph block for the Blok Editor.
 * Represents a regular text block
 *
 * @author CodeX (team@codex.so)
 * @copyright CodeX 2018
 * @license MIT
 */
export class Paragraph implements BlockTool {
  /**
   * Default placeholder for Paragraph Tool
   *
   * @returns translation key for the default placeholder
   */
  public static get DEFAULT_PLACEHOLDER(): string {
    return 'tools.paragraph.placeholder';
  }

  /**
   * Editor API
   */
  private api: API;

  /**
   * Read-only mode flag
   */
  private readOnly: boolean;

  /**
   * Placeholder for Paragraph Tool
   */
  private _placeholder: string;

  /**
   * Paragraph's data
   */
  private _data: ParagraphData;

  /**
   * Paragraph's main Element
   */
  private _element: HTMLDivElement | null;

  /**
   * Whether or not to keep blank paragraphs when saving editor data
   */
  private _preserveBlank: boolean;

  /**
   * Style configuration for paragraph customization
   */
  private _styles: ParagraphStyleConfig;



  /**
   * Render plugin's main Element and fill it with saved data
   *
   * @param options - constructor options
   * @param options.data - previously saved data
   * @param options.config - user config for Tool
   * @param options.api - editor.js api
   * @param options.readOnly - read only mode flag
   */
  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions<ParagraphData, ParagraphConfig>) {
    this.api = api;
    this.readOnly = readOnly;

    if (!this.readOnly) {
      this.onKeyUp = this.onKeyUp.bind(this);
    }

    this._placeholder = config?.placeholder ?? Paragraph.DEFAULT_PLACEHOLDER;
    this._data = data ?? { text: '' };
    this._element = null;
    this._preserveBlank = config?.preserveBlank ?? false;
    this._styles = config?.styles ?? {};
  }

  /**
   * Check if text content is empty and set empty string to inner html.
   * We need this because some browsers (e.g. Safari) insert <br> into empty contenteditable elements
   *
   * @param e - key up event
   */
  public onKeyUp(e: KeyboardEvent): void {
    if (e.code !== 'Backspace' && e.code !== 'Delete') {
      return;
    }

    if (!this._element) {
      return;
    }

    const { textContent } = this._element;

    if (textContent === '') {
      this._element.innerHTML = '';
    }
  }

  /**
   * Create Tool's view
   *
   * @returns HTMLDivElement
   */
  /**
   * Paragraph wrapper styling classes using Tailwind.
   */
  private static readonly WRAPPER_CLASSES = [
    'leading-[1.6em]',
    'outline-none',
    'mt-[2px]',
    'mb-px',
    '[&>p:first-of-type]:mt-0',
    '[&>p:last-of-type]:mb-0',
  ];



  /**
   * Build inline styles from style configuration
   *
   * @returns Partial CSSStyleDeclaration with custom styles
   */
  private buildInlineStyles(): Partial<CSSStyleDeclaration> {
    const inlineStyles: Partial<CSSStyleDeclaration> = {};

    if (this._styles.size) {
      inlineStyles.fontSize = this._styles.size;
    }
    if (this._styles.lineHeight) {
      inlineStyles.lineHeight = this._styles.lineHeight;
    }
    if (this._styles.marginTop) {
      inlineStyles.marginTop = this._styles.marginTop;
    }
    if (this._styles.marginBottom) {
      inlineStyles.marginBottom = this._styles.marginBottom;
    }

    return inlineStyles;
  }

  private drawView(): HTMLDivElement {
    const div = document.createElement('DIV') as HTMLDivElement;

    div.className = twMerge(
      this.api.styles.block,
      Paragraph.WRAPPER_CLASSES,
      PLACEHOLDER_FOCUS_ONLY_CLASSES
    );
    div.setAttribute(DATA_ATTR.tool, 'paragraph');
    div.contentEditable = 'false';

    /**
     * Apply inline styles for custom overrides (dynamic values from config)
     */
    const inlineStyles = this.buildInlineStyles();

    if (Object.keys(inlineStyles).length > 0) {
      Object.assign(div.style, inlineStyles);
    }

    if (this._data.text) {
      div.innerHTML = this._data.text;
    }

    if (!this.readOnly) {
      div.contentEditable = 'true';
      div.addEventListener('keyup', this.onKeyUp);
      setupPlaceholder(div, this.api.i18n.t(this._placeholder), 'data-blok-placeholder-active');
    } else {
      div.setAttribute('data-blok-placeholder-active', this.api.i18n.t(this._placeholder));
    }

    return div;
  }

  /**
   * Return Tool's view
   *
   * @returns HTMLDivElement
   */
  public render(): HTMLDivElement {
    this._element = this.drawView();

    return this._element;
  }

  /**
   * Method that specified how to merge two Text blocks.
   * Called by Editor by backspace at the beginning of the Block
   *
   * @param data - saved data to merge with current block
   */
  public merge(data: ParagraphData): void {
    if (!this._element) {
      return;
    }

    this._data.text += data.text;

    const fragment = parseHtml(data.text);

    this._element.appendChild(fragment);
    this._element.normalize();
  }

  /**
   * Validate Paragraph block data:
   * - check for emptiness
   *
   * @param savedData - data received after saving
   * @returns false if saved data is not correct, otherwise true
   */
  public validate(savedData: ParagraphData): boolean {
    if (savedData.text.trim() === '' && !this._preserveBlank) {
      return false;
    }

    return true;
  }

  /**
   * Extract Tool's data from the view
   *
   * @param toolsContent - Paragraph tools rendered view
   * @returns saved data
   */
  public save(toolsContent: HTMLDivElement): ParagraphData {
    return {
      text: stripFakeBackgroundElements(toolsContent.innerHTML),
    };
  }

  /**
   * On paste callback fired from Editor.
   *
   * @param event - event with pasted data
   */
  public onPaste(event: PasteEvent): void {
    const detail = event.detail;

    if (!('data' in detail)) {
      return;
    }

    const content = detail.data as HTMLElement;

    const data: ParagraphData = {
      text: content.innerHTML,
    };

    this._data = data;

    window.requestAnimationFrame(() => {
      if (this._element) {
        this._element.innerHTML = this._data.text || '';
      }
    });
  }

  /**
   * Enable Conversion Toolbar. Paragraph can be converted to/from other tools
   *
   * @returns ConversionConfig
   */
  public static get conversionConfig(): ConversionConfig {
    return {
      export: 'text', // to convert Paragraph to other block, use 'text' property of saved data
      import: 'text', // to convert other block's exported string to Paragraph, fill 'text' property of tool data
    };
  }

  /**
   * Sanitizer rules
   *
   * @returns SanitizerConfig
   */
  public static get sanitize(): SanitizerConfig {
    return {
      text: {
        br: true,
      },
    };
  }

  /**
   * Returns true to notify the core that read-only mode is supported
   *
   * @returns true
   */
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * Used by Editor paste handling API.
   * Provides configuration to handle P tags.
   *
   * @returns PasteConfig
   */
  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['P'],
    };
  }

  /**
   * Icon and title for displaying at the Toolbox
   *
   * @returns ToolboxConfig
   */
  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconText,
      title: 'Text',
      titleKey: 'text',
      searchTerms: ['p', 'paragraph', 'plain'],
    };
  }
}

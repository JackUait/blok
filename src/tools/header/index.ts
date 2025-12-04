/**
 * Header Tool for the Blok Editor
 * Provides Headings Blocks (H1-H6)
 *
 * Based on @editorjs/header by CodeX
 * @license MIT
 */
import { IconH1, IconH2, IconH3, IconH4, IconH5, IconH6, IconHeading } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';
import { BLOK_TOOL_ATTR } from '../../components/constants';
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
import type { MenuConfig } from '../../../types/tools/menu-config';

/**
 * Tool's input and output data format
 */
export interface HeaderData extends BlockToolData {
  /** Header's content */
  text: string;
  /** Header's level from 1 to 6 */
  level: number;
}

/**
 * Tool's config from Editor
 */
export interface HeaderConfig {
  /** Block's placeholder */
  placeholder?: string;
  /** Heading levels */
  levels?: number[];
  /** Default level */
  defaultLevel?: number;
}

/**
 * Heading level information
 */
interface Level {
  /** Level number */
  number: number;
  /** HTML tag corresponding with level number */
  tag: string;
  /** Icon */
  svg: string;
  /** Tailwind classes for styling */
  styles: string;
}

/**
 * Header block for the Blok Editor.
 *
 * @author CodeX (team@ifmo.su)
 * @copyright CodeX 2018
 * @license MIT
 * @version 2.0.0
 */
export default class Header implements BlockTool {
  /**
   * Editor API
   */
  private api: API;

  /**
   * Read-only mode flag
   */
  private readOnly: boolean;

  /**
   * Tool's settings passed from Editor
   */
  private _settings: HeaderConfig;

  /**
   * Block's data
   */
  private _data: HeaderData;

  /**
   * Main Block wrapper
   */
  private _element: HTMLHeadingElement;

  /**
   * Render plugin's main Element and fill it with saved data
   *
   * @param options - constructor options
   * @param options.data - previously saved data
   * @param options.config - user config for Tool
   * @param options.api - Editor API
   * @param options.readOnly - read only mode flag
   */
  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions<HeaderData, HeaderConfig>) {
    this.api = api;
    this.readOnly = readOnly;

    this._settings = config || {};
    this._data = this.normalizeData(data);
    this._element = this.getTag();
  }

  /**
   * Base styles for all header levels
   */
  private static readonly BASE_STYLES = 'py-[0.6em] pb-[3px] px-0 m-0 leading-[1.25em] outline-none [&_p]:!p-0 [&_p]:!m-0 [&_div]:!p-0 [&_div]:!m-0';

  /**
   * Styles
   * @deprecated Use data-blok-tool attribute instead (BLOK_TOOL_ATTR)
   */
  private get _CSS(): { block: string; wrapper: string } {
    return {
      block: this.api.styles.block,
      wrapper: '',
    };
  }

  /**
   * Check if data is valid HeaderData
   *
   * @param data - data to check
   * @returns true if data is HeaderData
   */
  private isHeaderData(data: unknown): data is HeaderData {
    return typeof data === 'object' && data !== null && 'text' in data;
  }

  /**
   * Normalize input data
   *
   * @param data - saved data to process
   * @returns normalized HeaderData
   */
  private normalizeData(data: HeaderData | Record<string, never>): HeaderData {
    if (!this.isHeaderData(data)) {
      return { text: '', level: this.defaultLevel.number };
    }

    const parsedLevel = parseInt(String(data.level));
    const isValidLevel = data.level !== undefined && !isNaN(parsedLevel);

    return {
      text: data.text || '',
      level: isValidLevel ? parsedLevel : this.defaultLevel.number,
    };
  }

  /**
   * Return Tool's view
   *
   * @returns HTMLHeadingElement
   */
  public render(): HTMLHeadingElement {
    return this._element;
  }

  /**
   * Returns header block tunes config
   *
   * @returns MenuConfig array
   */
  public renderSettings(): MenuConfig {
    return this.levels.map(level => {
      return {
        icon: level.svg,
        label: this.api.i18n.t(`Heading ${level.number}`),
        onActivate: (): void => this.setLevel(level.number),
        closeOnActivate: true,
        isActive: this.currentLevel.number === level.number,
      };
    });
  }

  /**
   * Callback for Block's settings buttons
   *
   * @param level - level to set
   */
  private setLevel(level: number): void {
    this.data = {
      level: level,
      text: this.data.text,
    };
  }

  /**
   * Method that specified how to merge two Text blocks.
   * Called by Editor by backspace at the beginning of the Block
   *
   * @param data - saved data to merge with current block
   */
  public merge(data: HeaderData): void {
    this._element.insertAdjacentHTML('beforeend', data.text);
  }

  /**
   * Validate Text block data:
   * - check for emptiness
   *
   * @param blockData - data received after saving
   * @returns false if saved data is not correct, otherwise true
   */
  public validate(blockData: HeaderData): boolean {
    return blockData.text.trim() !== '';
  }

  /**
   * Extract Tool's data from the view
   *
   * @param toolsContent - Text tools rendered view
   * @returns saved data
   */
  public save(toolsContent: HTMLHeadingElement): HeaderData {
    return {
      text: toolsContent.innerHTML,
      level: this.currentLevel.number,
    };
  }

  /**
   * Allow Header to be converted to/from other blocks
   */
  public static get conversionConfig(): ConversionConfig {
    return {
      export: 'text', // use 'text' property for other blocks
      import: 'text', // fill 'text' property from other block's export string
    };
  }

  /**
   * Sanitizer Rules
   */
  public static get sanitize(): SanitizerConfig {
    return {
      level: false,
      text: {},
    };
  }

  /**
   * Returns true to notify core that read-only is supported
   *
   * @returns true
   */
  public static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * Get current Tool's data
   *
   * @returns Current data
   */
  public get data(): HeaderData {
    this._data.text = this._element.innerHTML;
    this._data.level = this.currentLevel.number;

    return this._data;
  }

  /**
   * Store data in plugin:
   * - at the this._data property
   * - at the HTML
   *
   * @param data - data to set
   */
  public set data(data: HeaderData) {
    this._data = this.normalizeData(data);

    /**
     * If level is set and block in DOM
     * then replace it to a new block
     */
    if (data.level !== undefined && this._element.parentNode) {
      /**
       * Create a new tag
       */
      const newHeader = this.getTag();

      /**
       * Save Block's content
       */
      newHeader.innerHTML = this._element.innerHTML;

      /**
       * Replace blocks
       */
      this._element.parentNode.replaceChild(newHeader, this._element);

      /**
       * Save new block to private variable
       */
      this._element = newHeader;
    }

    /**
     * If data.text was passed then update block's content
     */
    if (data.text !== undefined) {
      this._element.innerHTML = this._data.text || '';
    }
  }

  /**
   * Get tag for target level
   * By default returns second-leveled header
   *
   * @returns HTMLHeadingElement
   */
  private getTag(): HTMLHeadingElement {
    /**
     * Create element for current Block's level
     */
    const tag = document.createElement(this.currentLevel.tag) as HTMLHeadingElement;

    /**
     * Add text to block
     */
    tag.innerHTML = this._data.text || '';

    /**
     * Add styles class using twMerge to combine base and level-specific styles
     */
    tag.className = twMerge(Header.BASE_STYLES, this.currentLevel.styles);

    /**
     * Set data attribute for tool identification
     */
    tag.setAttribute(BLOK_TOOL_ATTR, 'header');

    /**
     * Make tag editable
     */
    tag.contentEditable = this.readOnly ? 'false' : 'true';

    /**
     * Add Placeholder
     */
    tag.setAttribute('data-placeholder', this.api.i18n.t(this._settings.placeholder || ''));

    return tag;
  }

  /**
   * Get current level
   *
   * @returns Level object
   */
  private get currentLevel(): Level {
    const level = this.levels.find(levelItem => levelItem.number === this._data.level);

    return level ?? this.defaultLevel;
  }

  /**
   * Return default level
   *
   * @returns Level object
   */
  private get defaultLevel(): Level {
    /**
     * User can specify own default level value
     */
    if (!this._settings.defaultLevel) {
      /**
       * With no additional options, there will be H2 by default
       */
      return this.levels[1];
    }

    const userSpecified = this.levels.find(levelItem => {
      return levelItem.number === this._settings.defaultLevel;
    });

    if (userSpecified) {
      return userSpecified;
    }

    console.warn('(ง\'̀-\'́)ง Heading Tool: the default level specified was not found in available levels');

    return this.levels[1];
  }

  /**
   * Available header levels
   *
   * @returns Level array
   */
  private get levels(): Level[] {
    const availableLevels: Level[] = [
      {
        number: 1,
        tag: 'H1',
        svg: IconH1,
        styles: 'text-[2.5em] leading-tight font-bold',
      },
      {
        number: 2,
        tag: 'H2',
        svg: IconH2,
        styles: 'text-[2em] leading-tight font-semibold',
      },
      {
        number: 3,
        tag: 'H3',
        svg: IconH3,
        styles: 'text-[1.75em] leading-tight font-semibold',
      },
      {
        number: 4,
        tag: 'H4',
        svg: IconH4,
        styles: 'text-[1.5em] leading-tight font-semibold',
      },
      {
        number: 5,
        tag: 'H5',
        svg: IconH5,
        styles: 'text-[1.25em] leading-tight font-semibold',
      },
      {
        number: 6,
        tag: 'H6',
        svg: IconH6,
        styles: 'text-base leading-tight font-semibold',
      },
    ];

    return this._settings.levels
      ? availableLevels.filter(l => this._settings.levels!.includes(l.number))
      : availableLevels;
  }

  /**
   * Handle H1-H6 tags on paste to substitute it with header Tool
   *
   * @param event - event with pasted content
   */
  public onPaste(event: PasteEvent): void {
    const detail = event.detail;

    if (!('data' in detail)) {
      return;
    }

    const content = detail.data as HTMLElement;

    /**
     * Map tag names to level numbers
     */
    const tagToLevel: Record<string, number> = {
      H1: 1,
      H2: 2,
      H3: 3,
      H4: 4,
      H5: 5,
      H6: 6,
    };

    /**
     * Define default level value
     */
    const parsedLevel = tagToLevel[content.tagName] ?? this.defaultLevel.number;

    /**
     * If levels are restricted, find the nearest allowed level
     */
    const level = this._settings.levels
      ? this._settings.levels.reduce((prevLevel, currLevel) => {
        return Math.abs(currLevel - parsedLevel) < Math.abs(prevLevel - parsedLevel) ? currLevel : prevLevel;
      })
      : parsedLevel;

    this.data = {
      level,
      text: content.innerHTML,
    };
  }

  /**
   * Used by Editor paste handling API.
   * Provides configuration to handle H1-H6 tags.
   *
   * @returns PasteConfig
   */
  public static get pasteConfig(): PasteConfig {
    return {
      tags: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'],
    };
  }

  /**
   * Get Tool toolbox settings
   * icon - Tool icon's SVG
   * title - title to show in toolbox
   *
   * @returns ToolboxConfig
   */
  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconHeading,
      title: 'Heading',
    };
  }
}

/**
 * Header Tool for the Blok Editor
 * Provides Headings Blocks (H1-H6)
 *
 * Based on @editorjs/header by CodeX
 * @license MIT
 */
import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  BlockToolData,
  PasteEvent,
  ToolboxConfig,
  ToolboxConfigEntry,
  ConversionConfig,
  SanitizerConfig,
  PasteConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { DATA_ATTR } from '../../components/constants';
import { IconH1, IconH2, IconH3, IconH4, IconH5, IconH6, IconHeading } from '../../components/icons';
import { PLACEHOLDER_CLASSES, setupPlaceholder } from '../../components/utils/placeholder';
import { translateToolTitle } from '../../components/utils/tools';
import { twMerge } from '../../components/utils/tw';

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
 * Level-specific overrides for customization
 */
export interface HeaderLevelConfig {
  /** Custom HTML tag to use (e.g., 'div', 'p', 'span') */
  tag?: string;
  /** Custom display name for this level */
  name?: string;
  /** Custom font size (e.g., '3em', '24px') */
  size?: string;
  /** Custom margin top (e.g., '20px', '1rem') */
  marginTop?: string;
  /** Custom margin bottom (e.g., '10px', '0.5rem') */
  marginBottom?: string;
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
  /** Level-specific overrides keyed by level number (1-6) */
  levelOverrides?: Record<number, HeaderLevelConfig>;
  /** Custom shortcuts per level. If undefined, uses default markdown (#, ##, etc). If empty {}, disables all shortcuts. */
  shortcuts?: Record<number, string>;
  /**
   * @internal Injected by BlockToolAdapter - merged toolbox entries.
   * When present, renderSettings() will use these entries instead of the default levels.
   */
  _toolboxEntries?: ToolboxConfigEntry[];
}

/**
 * Heading level information
 */
interface Level {
  /** Level number */
  number: number;
  /** HTML tag corresponding with level number */
  tag: string;
  /** Translation key for this level (e.g., 'tools.header.heading1') */
  nameKey: string;
  /** Display name for this level (user override or fallback) */
  name: string;
  /** Icon */
  icon: string;
  /** Tailwind classes for styling */
  styles: string;
  /** Inline styles for custom overrides */
  inlineStyles: Partial<CSSStyleDeclaration>;
}

/**
 * Header block for the Blok Editor.
 *
 * @author CodeX (team@ifmo.su)
 * @copyright CodeX 2018
 * @license MIT
 * @version 2.0.0
 */
export class Header implements BlockTool {
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
  private static readonly BASE_STYLES = 'py-[3px] px-[2px] m-0 !leading-[1.3] outline-none [&_p]:!p-0 [&_p]:!m-0 [&_div]:!p-0 [&_div]:!m-0';

  /**
   * Styles
   * @deprecated Use data-blok-tool attribute instead (DATA_ATTR.tool)
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
    const toolboxEntries = this._settings._toolboxEntries;

    /**
     * If user provided custom toolbox entries, use them to build settings menu.
     * This ensures block settings match the toolbox configuration.
     * Entries without explicit level data will default to the configured defaultLevel.
     *
     * Only fall back to levels config when _toolboxEntries is not provided or empty,
     * or when using the default single "Heading" toolbox entry (detected by having
     * exactly one entry with no level data and no custom title or the default "Heading" title).
     */
    const isDefaultToolboxEntry = toolboxEntries?.length === 1 &&
      toolboxEntries[0].data === undefined &&
      (toolboxEntries[0].title === undefined || toolboxEntries[0].title === 'Heading');

    if (toolboxEntries !== undefined && toolboxEntries.length > 0 && !isDefaultToolboxEntry) {
      return this.buildSettingsFromToolboxEntries(toolboxEntries);
    }

    /**
     * Fall back to existing behavior using levels config
     */
    return this.levels.map(level => {
      const translated = this.api.i18n.t(level.nameKey);
      const title = translated !== level.nameKey ? translated : level.name;

      return {
        icon: level.icon,
        title,
        onActivate: (): void => this.setLevel(level.number),
        closeOnActivate: true,
        isActive: this.currentLevel.number === level.number,
        dataset: {
          'blok-header-level': String(level.number),
        },
      };
    });
  }

  /**
   * Build settings menu items from toolbox entries.
   * This allows users to customize which levels appear in block settings
   * by configuring the toolbox.
   *
   * @param entries - Merged toolbox entries from user config
   * @returns MenuConfig array
   */
  private buildSettingsFromToolboxEntries(entries: ToolboxConfigEntry[]): MenuConfig {
    return entries.map(entry => {
      const entryData = entry.data as { level?: number } | undefined;
      const level = entryData?.level ?? this.defaultLevel.number;
      const defaultLevel = Header.DEFAULT_LEVELS.find(l => l.number === level);
      const fallbackTitle = defaultLevel?.name ?? `Heading ${level}`;

      const title = this.resolveToolboxEntryTitle(entry, fallbackTitle);
      const icon = entry.icon ?? defaultLevel?.icon ?? IconHeading;

      return {
        icon,
        title,
        onActivate: (): void => this.setLevel(level),
        closeOnActivate: true,
        isActive: this.currentLevel.number === level,
        dataset: {
          'blok-header-level': String(level),
        },
      };
    });
  }

  /**
   * Resolves the title for a toolbox entry using the shared translation utility.
   *
   * @param entry - Toolbox entry
   * @param fallback - Fallback title if no custom title or translation found
   * @returns Resolved title string
   */
  private resolveToolboxEntryTitle(entry: ToolboxConfigEntry, fallback: string): string {
    return translateToolTitle(this.api.i18n, entry, fallback);
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
    tag.className = twMerge(Header.BASE_STYLES, this.currentLevel.styles, PLACEHOLDER_CLASSES);

    /**
     * Apply inline styles for custom overrides (dynamic values from config)
     */
    const { inlineStyles } = this.currentLevel;

    if (inlineStyles) {
      Object.assign(tag.style, inlineStyles);
    }

    /**
     * Set data attribute for tool identification
     */
    tag.setAttribute(DATA_ATTR.tool, 'header');

    /**
     * Make tag editable
     */
    tag.contentEditable = this.readOnly ? 'false' : 'true';

    /**
     * Add Placeholder with caret positioning support
     */
    if (!this.readOnly) {
      setupPlaceholder(tag, this.api.i18n.t(this._settings.placeholder || ''));
    } else {
      tag.setAttribute('data-placeholder', this.api.i18n.t(this._settings.placeholder || ''));
    }

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
   * Default level configurations using Tailwind CSS classes
   */
  private static readonly DEFAULT_LEVELS: Array<{
    number: number;
    tag: string;
    nameKey: string;
    name: string;
    icon: string;
    styles: string;
  }> = [
    { number: 1, tag: 'H1', nameKey: 'tools.header.heading1', name: 'Heading 1', icon: IconH1, styles: 'text-4xl font-bold mt-8 mb-1' },
    { number: 2, tag: 'H2', nameKey: 'tools.header.heading2', name: 'Heading 2', icon: IconH2, styles: 'text-3xl font-semibold mt-6 mb-px' },
    { number: 3, tag: 'H3', nameKey: 'tools.header.heading3', name: 'Heading 3', icon: IconH3, styles: 'text-2xl font-semibold mt-4 mb-px' },
    { number: 4, tag: 'H4', nameKey: 'tools.header.heading4', name: 'Heading 4', icon: IconH4, styles: 'text-xl font-semibold mt-3 mb-px' },
    { number: 5, tag: 'H5', nameKey: 'tools.header.heading5', name: 'Heading 5', icon: IconH5, styles: 'text-base font-semibold mt-3 mb-px' },
    { number: 6, tag: 'H6', nameKey: 'tools.header.heading6', name: 'Heading 6', icon: IconH6, styles: 'text-sm font-semibold mt-3 mb-px' },
  ];

  /**
   * Available header levels
   *
   * @returns Level array
   */
  private get levels(): Level[] {
    const overrides = this._settings.levelOverrides || {};

    const availableLevels: Level[] = Header.DEFAULT_LEVELS.map(defaultLevel => {
      const override = overrides[defaultLevel.number] || {};

      // Build inline styles for custom overrides (dynamic values don't work with Tailwind)
      const inlineStyles: Partial<CSSStyleDeclaration> = {};

      if (override.size) {
        inlineStyles.fontSize = override.size;
      }
      if (override.marginTop) {
        inlineStyles.marginTop = override.marginTop;
      }
      if (override.marginBottom) {
        inlineStyles.marginBottom = override.marginBottom;
      }

      return {
        number: defaultLevel.number,
        tag: override.tag?.toUpperCase() || defaultLevel.tag,
        nameKey: defaultLevel.nameKey,
        name: override.name || defaultLevel.name,
        icon: defaultLevel.icon,
        styles: defaultLevel.styles,
        inlineStyles,
      };
    });

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
   * Returns an array of all 6 heading levels, each with its own icon and title.
   * The BlockToolAdapter will filter these based on the `levels` config if specified.
   *
   * @returns ToolboxConfig array with entries for H1-H6
   */
  public static get toolbox(): ToolboxConfig {
    return Header.DEFAULT_LEVELS.map(level => ({
      icon: level.icon,
      title: level.name,
      titleKey: level.nameKey,
      name: `header-${level.number}`,
      data: { level: level.number },
      searchTerms: [`h${level.number}`, 'title', 'header', 'heading'],
      shortcut: '#'.repeat(level.number),
    }));
  }
}

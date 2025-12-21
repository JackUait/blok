import { BaseToolAdapter,  InternalBlockToolSettings, UserSettings  } from './base';
import type {
  BlockAPI,
  BlockTool as IBlockTool,
  BlockToolData,
  BlockToolConstructable,
  ConversionConfig,
  PasteConfig, SanitizerConfig, ToolboxConfig,
  ToolboxConfigEntry
} from '@/types';
import { isEmpty, isObject } from '../utils';
import type { InlineToolAdapter } from './inline';
import type { BlockTuneAdapter } from './tune';
import { ToolsCollection } from './collection';
import type { BlockToolAdapter as BlockToolAdapterInterface } from '@/types/tools/adapters/block-tool-adapter';
import { ToolType } from '@/types/tools/adapters/tool-type';

/**
 * Class to work with Block tools constructables
 */
export class BlockToolAdapter extends BaseToolAdapter<ToolType.Block, IBlockTool> implements BlockToolAdapterInterface {
  /**
   * Tool type — Block
   */
  public type: ToolType.Block = ToolType.Block;

  /**
   * InlineTool collection for current Block Tool
   */
  public inlineTools: ToolsCollection<InlineToolAdapter> = new ToolsCollection<InlineToolAdapter>();

  /**
   * BlockTune collection for current Block Tool
   */
  public tunes: ToolsCollection<BlockTuneAdapter> = new ToolsCollection<BlockTuneAdapter>();

  /**
   * Cache for sanitize configuration
   */
  private _sanitizeConfig: SanitizerConfig | undefined;

  /**
   * Cache for base sanitize configuration
   */
  private _baseSanitizeConfig: SanitizerConfig | undefined;

  /**
   * Creates new Tool instance
   * @param data - Tool data
   * @param block - BlockAPI for current Block
   * @param readOnly - True if Blok is in read-only mode
   */
  public create(data: BlockToolData, block: BlockAPI, readOnly: boolean): IBlockTool {
    const toolboxEntries = this.toolbox;

    /**
     * Inject merged toolbox entries into config so tools can use them in renderSettings().
     * This allows tools like Header to show the same options in block settings as in the toolbox.
     */
    const configWithToolbox = toolboxEntries !== undefined
      ? { ...this.settings, _toolboxEntries: toolboxEntries }
      : this.settings;

    return new this.constructable({
      data,
      block,
      readOnly,
      api: this.api,
      config: configWithToolbox,
    }) as IBlockTool;
  }

  /**
   * Returns true if read-only mode is supported by Tool
   */
  public get isReadOnlySupported(): boolean {
    return (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.IsReadOnlySupported] === true;
  }

  /**
   * Returns true if Tool supports linebreaks
   */
  public get isLineBreaksEnabled(): boolean {
    return (this.constructable as unknown as Record<string, boolean | undefined>)[InternalBlockToolSettings.IsEnabledLineBreaks] ?? false;
  }

  /**
   * Returns Tool toolbox configuration (internal or user-specified).
   *
   * Merges internal and user-defined toolbox configs based on the following rules:
   *
   * - If both internal and user-defined toolbox configs are arrays their items are merged.
   * Length of the second one is kept.
   *
   * - If both are objects their properties are merged.
   *
   * - If one is an object and another is an array than internal config is replaced with user-defined
   * config. This is made to allow user to override default tool's toolbox representation (single/multiple entries)
   *
   * Additionally, if the tool's config contains a `toolboxStyles` array, only toolbox entries
   * whose `data.style` matches one of the specified styles will be included.
   */
  public get toolbox(): ToolboxConfigEntry[] | undefined {
    const toolToolboxSettings = (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.Toolbox] as ToolboxConfig | undefined;
    const userToolboxSettings = this.config[UserSettings.Toolbox];

    if (!toolToolboxSettings || isEmpty(toolToolboxSettings)) {
      return;
    }
    if (userToolboxSettings === false) {
      return;
    }

    const mergedEntries = this.mergeToolboxSettings(toolToolboxSettings, userToolboxSettings);
    const filteredByStyles = this.filterToolboxEntriesByStyles(mergedEntries);

    return this.filterToolboxEntriesByLevels(filteredByStyles);
  }

  /**
   * Merges tool's internal toolbox settings with user-defined settings
   */
  private mergeToolboxSettings(
    toolSettings: ToolboxConfig,
    userSettings: ToolboxConfig | undefined | null
  ): ToolboxConfigEntry[] {
    /**
     * Return tool's toolbox settings if user settings are not defined
     */
    if (userSettings === undefined || userSettings === null) {
      return Array.isArray(toolSettings) ? toolSettings : [ toolSettings ];
    }

    /**
     * User provided single entry to override array of tool entries
     */
    if (!Array.isArray(userSettings) && Array.isArray(toolSettings)) {
      return [ userSettings ];
    }

    /**
     * Both are single entries - merge them
     */
    if (!Array.isArray(userSettings)) {
      return [
        {
          ...toolSettings,
          ...userSettings,
        },
      ];
    }

    /**
     * User provided array but tool has single entry
     */
    if (!Array.isArray(toolSettings)) {
      return userSettings;
    }

    /**
     * Both are arrays - merge item by item
     */
    return userSettings.map((item, i) => {
      const toolToolboxEntry = toolSettings[i];

      if (toolToolboxEntry) {
        return {
          ...toolToolboxEntry,
          ...item,
        };
      }

      return item;
    });
  }

  /**
   * Filters toolbox entries based on toolboxStyles config if specified.
   * This allows tools like List to show only specific variants in the toolbox.
   */
  private filterToolboxEntriesByStyles(entries: ToolboxConfigEntry[]): ToolboxConfigEntry[] {
    const toolboxStyles = this.settings.toolboxStyles as string[] | undefined;

    if (!toolboxStyles || !Array.isArray(toolboxStyles) || toolboxStyles.length === 0) {
      return entries;
    }

    return entries.filter(entry => {
      const entryData = entry.data as { style?: string } | undefined;

      if (!entryData || !entryData.style) {
        return true; // Keep entries without style data
      }

      return toolboxStyles.includes(entryData.style);
    });
  }

  /**
   * Filters toolbox entries based on levels config if specified.
   * This allows tools like Header to show only configured heading levels in the toolbox.
   */
  private filterToolboxEntriesByLevels(entries: ToolboxConfigEntry[]): ToolboxConfigEntry[] {
    const levels = this.settings.levels as number[] | undefined;

    if (!levels || !Array.isArray(levels) || levels.length === 0) {
      return entries;
    }

    return entries.filter(entry => {
      const entryData = entry.data as { level?: number } | undefined;

      if (!entryData || entryData.level === undefined) {
        return true; // Keep entries without level data
      }

      return levels.includes(entryData.level);
    });
  }

  /**
   * Returns Tool conversion configuration
   */
  public get conversionConfig(): ConversionConfig | undefined {
    return (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.ConversionConfig];
  }

  /**
   * Returns enabled inline tools for Tool.
   * Defaults to true (all inline tools) unless explicitly set to false or array.
   */
  public get enabledInlineTools(): boolean | string[] {
    const setting = this.config[UserSettings.EnabledInlineTools];

    // Default to true if not specified
    if (setting === undefined) {
      return true;
    }

    return setting;
  }

  /**
   * Returns enabled tunes for Tool
   */
  public get enabledBlockTunes(): boolean | string[] | undefined {
    return this.config[UserSettings.EnabledBlockTunes];
  }

  /**
   * Returns Tool paste configuration
   */
  public get pasteConfig(): PasteConfig {
    return (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.PasteConfig] ?? {};
  }

  /**
   * Returns true if Tool has onPaste handler
   */
  public get hasOnPasteHandler(): boolean {
    const prototype = (this.constructable as unknown as { prototype?: { onPaste?: unknown } })?.prototype;

    return typeof prototype?.onPaste === 'function';
  }

  /**
   * Returns sanitize configuration for Block Tool including configs from related Inline Tools and Block Tunes
   */
  public get sanitizeConfig(): SanitizerConfig {
    if (this._sanitizeConfig) {
      return this._sanitizeConfig;
    }

    const toolRules = super.sanitizeConfig;
    const baseConfig = this.baseSanitizeConfig;

    if (isEmpty(toolRules)) {
      this._sanitizeConfig = baseConfig;

      return baseConfig;
    }

    const toolConfig = {} as SanitizerConfig;

    for (const fieldName in toolRules) {
      if (!Object.prototype.hasOwnProperty.call(toolRules, fieldName)) {
        continue;
      }

      const rule = toolRules[fieldName];

      /**
       * If rule is object, merge it with Inline Tools configuration
       *
       * Otherwise pass as it is
       */
      if (isObject(rule)) {
        toolConfig[fieldName] = Object.assign({}, baseConfig, rule);
      } else {
        toolConfig[fieldName] = rule;
      }
    }

    this._sanitizeConfig = toolConfig;

    return toolConfig;
  }

  /**
   * Returns sanitizer configuration composed from sanitize config of Inline Tools enabled for Tool
   */
  public get baseSanitizeConfig(): SanitizerConfig {
    if (this._baseSanitizeConfig) {
      return this._baseSanitizeConfig;
    }

    const baseConfig = {};

    Array
      .from(this.inlineTools.values())
      .forEach(tool => Object.assign(baseConfig, tool.sanitizeConfig));

    Array
      .from(this.tunes.values())
      .forEach(tune => Object.assign(baseConfig, tune.sanitizeConfig));

    this._baseSanitizeConfig = baseConfig;

    return baseConfig;
  }
}

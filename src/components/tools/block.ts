import BaseToolAdapter, { InternalBlockToolSettings, UserSettings } from './base';
import type {
  BlockAPI,
  BlockTool as IBlockTool,
  BlockToolData,
  BlockToolConstructable,
  ConversionConfig,
  PasteConfig, SanitizerConfig, ToolboxConfig,
  ToolboxConfigEntry
} from '@/types';
import * as _ from '../utils';
import type InlineToolAdapter from './inline';
import type BlockTuneAdapter from './tune';
import ToolsCollection from './collection';
import type { BlockToolAdapter as BlockToolAdapterInterface } from '@/types/tools/adapters/block-tool-adapter';
import { ToolType } from '@/types/tools/adapters/tool-type';

/**
 * Class to work with Block tools constructables
 */
export default class BlockToolAdapter extends BaseToolAdapter<ToolType.Block, IBlockTool> implements BlockToolAdapterInterface {
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
   * @param readOnly - True if Editor is in read-only mode
   */
  public create(data: BlockToolData, block: BlockAPI, readOnly: boolean): IBlockTool {
     
    return new this.constructable({
      data,
      block,
      readOnly,
      api: this.api,
      config: this.settings,
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
   */
  public get toolbox(): ToolboxConfigEntry[] | undefined {
    const toolToolboxSettings = (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.Toolbox] as ToolboxConfig | undefined;
    const userToolboxSettings = this.config[UserSettings.Toolbox];

    if (!toolToolboxSettings || _.isEmpty(toolToolboxSettings)) {
      return;
    }
    if (userToolboxSettings === false) {
      return;
    }
    /**
     * Return tool's toolbox settings if user settings are not defined
     */
    if (userToolboxSettings === undefined || userToolboxSettings === null) {
      return Array.isArray(toolToolboxSettings) ? toolToolboxSettings : [ toolToolboxSettings ];
    }

    /**
     * Otherwise merge user settings with tool's settings
     */
    if (!Array.isArray(userToolboxSettings) && Array.isArray(toolToolboxSettings)) {
      return [ userToolboxSettings ];
    }

    if (!Array.isArray(userToolboxSettings)) {
      return [
        {
          ...toolToolboxSettings,
          ...userToolboxSettings,
        },
      ];
    }

    if (!Array.isArray(toolToolboxSettings)) {
      return userToolboxSettings;
    }

    return userToolboxSettings.map((item, i) => {
      const toolToolboxEntry = toolToolboxSettings[i];

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
   * Returns Tool conversion configuration
   */
  public get conversionConfig(): ConversionConfig | undefined {
    return (this.constructable as BlockToolConstructable)[InternalBlockToolSettings.ConversionConfig];
  }

  /**
   * Returns enabled inline tools for Tool
   */
  public get enabledInlineTools(): boolean | string[] {
    return this.config[UserSettings.EnabledInlineTools] || false;
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

    if (_.isEmpty(toolRules)) {
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
      if (_.isObject(rule)) {
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

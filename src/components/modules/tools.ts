import { Module } from '../__module';
import { deepMerge, isFunction, isObject, isUndefined, log } from '../utils';
import { PromiseQueue } from '../utils/promise-queue';
import type { SanitizerConfig, ToolConfig, ToolConstructable, ToolSettings } from '../../../types';
import { Stub } from '../../tools/stub';
import { ToolsFactory } from '../tools/factory';
import type { InlineToolAdapter } from '../tools/inline';
import type { BlockToolAdapter } from '../tools/block';
import type { BlockTuneAdapter } from '../tools/tune';
import { DeleteTune } from '../block-tunes/block-tune-delete';
import { ConvertInlineTool } from '../inline-tools/inline-tool-convert';
import { ToolsCollection } from '../tools/collection';
import { CriticalError } from '../errors/critical';

/**
 * @typedef {object} ChainData
 * @property {object} data - data that will be passed to the success or fallback
 * @property {Function} function - function's that must be called asynchronously
 * @interface ChainData
 */
export interface ChainData {
  data?: object;
  function: (data?: object) => unknown;
}

type ToolPrepareData = {
  toolName: string;
  config: ToolConfig;
};

type ToolPrepareFunction = (data: ToolPrepareData) => void | Promise<void>;

const toToolConstructable = (constructable: unknown): ToolConstructable => {
  if (!isFunction(constructable)) {
    throw new Error('Tool constructable must be a function');
  }

  return constructable as unknown as ToolConstructable;
};

/**
 * @module Blok Tools Submodule
 *
 * Creates Instances from Plugins and binds external config to the instances
 */

/**
 * Modules that works with tools classes
 */
export class Tools extends Module {
  /**
   * Name of Stub Tool
   * Stub Tool is used to substitute unavailable block Tools and store their data
   * @type {string}
   */
  public stubTool = 'stub';

  /**
   * Returns available Tools
   */
  public get available(): ToolsCollection {
    return this.toolsAvailable;
  }

  /**
   * Returns unavailable Tools
   */
  public get unavailable(): ToolsCollection {
    return this.toolsUnavailable;
  }

  /**
   * Return Tools for the Inline Toolbar
   */
  public get inlineTools(): ToolsCollection<InlineToolAdapter> {
    return this.available.inlineTools;
  }

  /**
   * Return blok block tools
   */
  public get blockTools(): ToolsCollection<BlockToolAdapter> {
    return this.available.blockTools;
  }

  /**
   * Return available Block Tunes
   * @returns {object} - object of Inline Tool's classes
   */
  public get blockTunes(): ToolsCollection<BlockTuneAdapter> {
    return this.available.blockTunes;
  }

  /**
   * Returns default Tool object
   */
  public get defaultTool(): BlockToolAdapter {
    const defaultBlockName = this.config.defaultBlock;

    if (!defaultBlockName) {
      throw new Error('Default block tool name is not configured');
    }

    const tool = this.blockTools.get(defaultBlockName);

    if (!tool) {
      throw new Error(`Default block tool "${defaultBlockName}" not found in available block tools`);
    }

    return tool;
  }

  /**
   * Tools objects factory
   */
  private factory: ToolsFactory | null = null;

  /**
   * Tools` classes available to use
   */
  private readonly toolsAvailable: ToolsCollection = new ToolsCollection();

  /**
   * Tools` classes not available to use because of preparation failure
   */
  private readonly toolsUnavailable: ToolsCollection = new ToolsCollection();

  /**
   * Cache for the sanitizer config
   */
  private inlineToolsSanitizeConfigCache: SanitizerConfig | null = null;

  /**
   * Returns internal tools
   */
  public get internal(): ToolsCollection {
    return this.available.internalTools;
  }

  /**
   * Creates instances via passed or default configuration
   * @returns {Promise<void>}
   */
  public async prepare(): Promise<void> {
    /**
     * Assign internal tools before validation so required fallbacks (like stub) are always present
     */
    const userTools = this.config.tools ?? {};

    this.config.tools = deepMerge({}, this.internalTools, userTools);

    this.validateTools();

    const toolsConfig = this.config.tools;

    if (!toolsConfig || Object.keys(toolsConfig).length === 0) {
      throw Error('Can\'t start without tools');
    }

    const config = this.prepareConfig(toolsConfig);

    this.factory = new ToolsFactory(config, this.config, this.Blok.API);

    /**
     * getting classes that has prepare method
     */
    const sequenceData = this.getListOfPrepareFunctions(config);

    /**
     * if sequence data contains nothing then resolve current chain and run other module prepare
     */
    if (sequenceData.length === 0) {
      return Promise.resolve();
    }

    const handlePrepareSuccess = (data: object): void => {
      if (!this.isToolPrepareData(data)) {
        return;
      }

      this.toolPrepareMethodSuccess({ toolName: data.toolName });
    };

    const handlePrepareFallback = (data: object): void => {
      if (!this.isToolPrepareData(data)) {
        return;
      }

      this.toolPrepareMethodFallback({ toolName: data.toolName });
    };

    const queue = new PromiseQueue();

    sequenceData.forEach(chainData => {
      void queue.add(async () => {
        const callbackData = !isUndefined(chainData.data) ? chainData.data : {};

        try {
          await chainData.function(chainData.data);
          handlePrepareSuccess(callbackData);
        } catch (_error) {
          handlePrepareFallback(callbackData);
        }
      });
    });

    await queue.completed;

    this.prepareBlockTools();
  }

  /**
   * Return general Sanitizer config for all inline tools
   */
  public getAllInlineToolsSanitizeConfig(): SanitizerConfig {
    if (this.inlineToolsSanitizeConfigCache) {
      return this.inlineToolsSanitizeConfigCache;
    }

    const config: SanitizerConfig = {} as SanitizerConfig;

    Array.from(this.inlineTools.values())
      .forEach(inlineTool => {
        Object.assign(config, inlineTool.sanitizeConfig);
      });

    this.inlineToolsSanitizeConfigCache = config;

    return config;
  }

  /**
   * Calls each Tool reset method to clean up anything set by Tool
   */
  public destroy(): void {
    for (const tool of this.available.values()) {
      const resetResult = (() => {
        try {
          return tool.reset();
        } catch (error) {
          log(`Tool "${tool.name}" reset failed`, 'warn', error);

          return undefined;
        }
      })();

      if (resetResult instanceof Promise) {
        resetResult.catch(error => {
          log(`Tool "${tool.name}" reset failed`, 'warn', error);
        });
      }
    }
  }

  /**
   * Returns essential internal tools that are always bundled.
   * Includes:
   * - stub: for graceful handling of unknown block types
   * - delete: fundamental block operation in settings menu
   * - convertTo: inline tool for converting blocks between types
   *
   * Other tools (paragraph, header, list, bold, italic, link) are optional
   * and should be imported from '@jackuait/blok/tools' or '@jackuait/blok/full'.
   */
  private get internalTools(): { [toolName: string]: ToolConstructable | ToolSettings & { isInternal?: boolean } } {
    return {
      stub: {
        class: toToolConstructable(Stub),
        isInternal: true,
      },
      delete: {
        class: toToolConstructable(DeleteTune),
        isInternal: true,
      },
      convertTo: {
        class: toToolConstructable(ConvertInlineTool),
        isInternal: true,
      },
    };
  }

  /**
   * Tool prepare method success callback
   * @param {object} data - append tool to available list
   */
  private toolPrepareMethodSuccess(data: { toolName: string }): void {
    const tool = this.getFactory().get(data.toolName);

    if (!tool.isInline()) {
      this.toolsAvailable.set(tool.name, tool);

      return;
    }

    /**
     * Some Tools validation
     */
    const inlineToolRequiredMethods = [ 'render' ];
    const notImplementedMethods = tool.getMissingMethods(inlineToolRequiredMethods);

    if (notImplementedMethods.length) {
      log(
        `Incorrect Inline Tool: ${tool.name}. Some of required methods is not implemented %o`,
        'warn',
        notImplementedMethods
      );

      this.toolsUnavailable.set(tool.name, tool);

      return;
    }

    this.toolsAvailable.set(tool.name, tool);
  }

  /**
   * Tool prepare method fail callback
   * @param {object} data - append tool to unavailable list
   */
  private toolPrepareMethodFallback(data: { toolName: string }): void {
    const factory = this.getFactory();

    this.toolsUnavailable.set(data.toolName, factory.get(data.toolName));
  }

  /**
   * Binds prepare function of plugins with user or default config
   * @returns {Array} list of functions that needs to be fired sequentially
   * @param config - tools config
   */
  private getListOfPrepareFunctions(config: Record<string, ToolSettings>): ChainData[] {
    return Object
      .entries(config)
      .map(([toolName, settings]): ChainData => {
        const toolData: ToolPrepareData = {
          toolName,
          config: (settings.config ?? {}) as ToolConfig,
        };

        const prepareFunction: ChainData['function'] = async (payload?: unknown) => {
          const constructable = settings.class;

          if (!constructable || !isFunction(constructable.prepare)) {
            return;
          }

          const data = (payload ?? toolData) as ToolPrepareData;
          const prepareMethod = constructable.prepare as unknown as ToolPrepareFunction;

          return prepareMethod.call(constructable, data);
        };

        return {
          function: prepareFunction,
          data: toolData,
        };
      });
  }

  /**
   * Assign enabled Inline Tools and Block Tunes for Block Tool
   */
  private prepareBlockTools(): void {
    Array.from(this.blockTools.values()).forEach(tool => {
      this.assignInlineToolsToBlockTool(tool);
      this.assignBlockTunesToBlockTool(tool);
    });
  }

  /**
   * Assign enabled Inline Tools for Block Tool
   * @param tool - Block Tool
   */
  private assignInlineToolsToBlockTool(tool: BlockToolAdapter): void {
    const blockTool = tool;

    /**
     * If common inlineToolbar property is false no Inline Tools should be assigned
     */
    if (this.config.inlineToolbar === false) {
      return;
    }

    /**
     * If user pass just 'true' for tool, get common inlineToolbar settings
     * - if common settings is an array, use it
     * - if common settings is 'true' or not specified, get default order
     */
    if (blockTool.enabledInlineTools === true) {
      const inlineTools = Array.isArray(this.config.inlineToolbar)
        ? this.createInlineToolsCollection(this.config.inlineToolbar)
        /**
         * If common settings is 'true' or not specified (will be set as true at core.ts), get the default order.
         * Prepend convertTo so it appears first (same as when explicit array is passed).
         */
        : this.createInlineToolsCollection(['convertTo', ...this.inlineTools.keys()]);

      blockTool.inlineTools = inlineTools;

      return;
    }

    /**
     * If user pass the list of inline tools for the particular tool, return it.
     */
    if (Array.isArray(blockTool.enabledInlineTools)) {
      /** Prepend ConvertTo Inline Tool */
      const inlineTools = this.createInlineToolsCollection(['convertTo', ...blockTool.enabledInlineTools]);

      blockTool.inlineTools = inlineTools;
    }
  }

  /**
   * Assign enabled Block Tunes for Block Tool
   * @param tool — Block Tool
   */
  private assignBlockTunesToBlockTool(tool: BlockToolAdapter): void {
    const blockTool = tool;

    if (blockTool.enabledBlockTunes === false) {
      return;
    }

    if (Array.isArray(blockTool.enabledBlockTunes)) {
      const userTunes = this.createBlockTunesCollection(blockTool.enabledBlockTunes);
      const combinedEntries = [
        ...Array.from(userTunes.entries()),
        ...Array.from(this.blockTunes.internalTools.entries()),
      ];

      blockTool.tunes = new ToolsCollection<BlockTuneAdapter>(combinedEntries);

      return;
    }

    if (Array.isArray(this.config.tunes)) {
      const userTunes = this.createBlockTunesCollection(this.config.tunes);
      const combinedEntries = [
        ...Array.from(userTunes.entries()),
        ...Array.from(this.blockTunes.internalTools.entries()),
      ];

      blockTool.tunes = new ToolsCollection<BlockTuneAdapter>(combinedEntries);

      return;
    }

    blockTool.tunes = new ToolsCollection<BlockTuneAdapter>(
      Array.from(this.blockTunes.internalTools.entries())
    );
  }

  /**
   * Validate Tools configuration objects and throw Error for user if it is invalid
   */
  private validateTools(): void {
    const toolsConfig = this.config.tools;

    if (!toolsConfig) {
      return;
    }

    const internalTools = this.internalTools;

    /**
     * Check Tools for a class containing
     */
    for (const toolName in toolsConfig) {
      if (!Object.prototype.hasOwnProperty.call(toolsConfig, toolName)) {
        continue;
      }

      if (toolName in internalTools) {
        continue;
      }

      const tool = toolsConfig[toolName];
      const isConstructorFunction = isFunction(tool);
      const toolSettings = tool as ToolSettings;
      const hasToolClass = isFunction(toolSettings.class);

      if (!isConstructorFunction && !hasToolClass) {
        throw new CriticalError(
          `Tool «${toolName}» must be a constructor function or an object with function in the «class» property`
        );
      }
    }
  }

  /**
   * Unify tools config
   * @param toolsConfig - raw tools configuration
   */
  private prepareConfig(toolsConfig: Record<string, ToolConstructable | ToolSettings>): Record<string, ToolSettings> {
    const config: Record<string, ToolSettings> = {};

    /**
     * Save Tools settings to a map
     */
    for (const toolName in toolsConfig) {
      /**
       * If Tool is an object not a Tool's class then
       * save class and settings separately
       */
      if (!Object.prototype.hasOwnProperty.call(toolsConfig, toolName)) {
        continue;
      }

      const tool = toolsConfig[toolName];

      if (isObject(tool)) {
        config[toolName] = tool as ToolSettings;

        continue;
      }

      config[toolName] = { class: tool as ToolConstructable };
    }

    return config;
  }

  /**
   * Type guard that ensures provided data contains tool preparation metadata.
   * @param data - data passed to prepare sequence callbacks
   */
  private isToolPrepareData(data: object): data is ToolPrepareData {
    const candidate = data as Partial<ToolPrepareData>;

    return typeof candidate?.toolName === 'string';
  }

  /**
   * Returns initialized tools factory instance.
   * @returns tools factory
   */
  private getFactory(): ToolsFactory {
    if (this.factory === null) {
      throw new Error('Tools factory is not initialized');
    }

    return this.factory;
  }

  /**
   * Builds inline tools collection for provided tool names, skipping unavailable ones.
   * @param toolNames - inline tool names to include
   * @returns tools collection containing available inline tools
   */
  private createInlineToolsCollection(toolNames: Iterable<string>): ToolsCollection<InlineToolAdapter> {
    const entries: [string, InlineToolAdapter][] = [];

    for (const name of toolNames) {
      const inlineTool = this.inlineTools.get(name);

      if (!inlineTool) {
        log(`Inline tool "${name}" is not available and will be skipped`, 'warn');
        continue;
      }

      entries.push([name, inlineTool]);
    }

    return new ToolsCollection<InlineToolAdapter>(entries);
  }

  /**
   * Builds block tunes collection for provided tune names, skipping unavailable ones.
   * @param tuneNames - block tune names to include
   * @returns tools collection containing available block tunes
   */
  private createBlockTunesCollection(tuneNames: Iterable<string>): ToolsCollection<BlockTuneAdapter> {
    const entries: [string, BlockTuneAdapter][] = [];

    for (const name of tuneNames) {
      const tune = this.blockTunes.get(name);

      if (!tune) {
        log(`Block tune "${name}" is not available and will be skipped`, 'warn');
        continue;
      }

      entries.push([name, tune]);
    }

    return new ToolsCollection<BlockTuneAdapter>(entries);
  }
}

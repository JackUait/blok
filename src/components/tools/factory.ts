import type { ToolConstructable, ToolSettings } from '../../../types/tools';
import { InternalInlineToolSettings, InternalTuneSettings } from './base';
import { InlineToolAdapter } from './inline';
import { BlockTuneAdapter } from './tune';
import { BlockToolAdapter } from './block';
import type { API as ApiModule } from '../modules/api';
import type { BlokConfig } from '../../../types/configs';
import type { API as ApiMethods, I18n } from '../../../types';

type ToolConstructor = typeof InlineToolAdapter | typeof BlockToolAdapter | typeof BlockTuneAdapter;

/**
 * Factory to construct classes to work with tools
 */
export class ToolsFactory {
  /**
   * Tools configuration specified by user
   */
  private config: {[name: string]: ToolSettings & { isInternal?: boolean }};

  /**
   * Blok API Module
   */
  private api: ApiModule;

  /**
   * Blok configuration
   */
  private blokConfig: BlokConfig;

  /**
   * @class
   * @param config - tools config
   * @param blokConfig - Blok config
   * @param api - Blok API module
   */
  constructor(
    config: {[name: string]: ToolSettings & { isInternal?: boolean }},
    blokConfig: BlokConfig,
    api: ApiModule
  ) {
    this.api = api;
    this.config = config;
    this.blokConfig = blokConfig;
  }

  /**
   * Returns Tool object based on it's type
   * @param name - tool name
   */
  public get(name: string): InlineToolAdapter | BlockToolAdapter | BlockTuneAdapter {
    const { class: constructableCandidate, isInternal = false, ...config } = this.config[name];
    const constructable = constructableCandidate as ToolConstructable | undefined;

    if (constructable === undefined) {
      throw new Error(`Tool "${name}" does not provide a class.`);
    }

    const Constructor = this.getConstructor(constructable);
    const toolApi = this.createToolApi(name);

    return new Constructor({
      name,
      constructable,
      config,
      api: toolApi,
      isDefault: name === this.blokConfig.defaultBlock,
      defaultPlaceholder: this.blokConfig.placeholder,
      isInternal,
    });
  }

  /**
   * Creates a tool-specific API with namespaced i18n.
   *
   * EditorJS tools expect `api.i18n.t('key')` to automatically look up
   * `tools.{toolName}.key`. This wrapper provides that behavior while
   * falling back to direct key lookup for Blok internal tools that use
   * fully-qualified keys like `tools.stub.error`.
   *
   * @param toolName - Name of the tool
   * @returns API object with tool-namespaced i18n
   */
  private createToolApi(toolName: string): ApiMethods {
    const baseApi = this.api.methods;
    const namespace = `tools.${toolName}`;

    const namespacedI18n: I18n = {
      t: (dictKey: string): string => {
        /**
         * Try namespaced key first for EditorJS compatibility.
         * External tools call t('Add row') expecting lookup of 'tools.table.Add row'.
         */
        const namespacedKey = `${namespace}.${dictKey}`;

        if (baseApi.i18n.has(namespacedKey)) {
          return baseApi.i18n.t(namespacedKey);
        }

        /**
         * Fall back to direct key lookup for Blok internal tools.
         * Internal tools use fully-qualified keys like 'tools.stub.error'.
         */
        return baseApi.i18n.t(dictKey);
      },

      has: (dictKey: string): boolean => {
        const namespacedKey = `${namespace}.${dictKey}`;

        return baseApi.i18n.has(namespacedKey) || baseApi.i18n.has(dictKey);
      },
    };

    return {
      ...baseApi,
      i18n: namespacedI18n,
    };
  }

  /**
   * Find appropriate Tool object constructor for Tool constructable
   * @param constructable - Tools constructable
   */
  private getConstructor(constructable: ToolConstructable): ToolConstructor {
    switch (true) {
      case Boolean(Reflect.get(constructable, InternalInlineToolSettings.IsInline)):
        return InlineToolAdapter;
      case Boolean(Reflect.get(constructable, InternalTuneSettings.IsTune)):
        return BlockTuneAdapter;
      default:
        return BlockToolAdapter;
    }
  }
}

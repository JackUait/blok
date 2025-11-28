import type { ToolConstructable, ToolSettings } from '../../../types/tools';
import { InternalInlineToolSettings, InternalTuneSettings } from './base';
import InlineToolAdapter from './inline';
import BlockTuneAdapter from './tune';
import BlockToolAdapter from './block';
import type ApiModule from '../modules/api';
import type { BlokConfig } from '../../../types/configs';

type ToolConstructor = typeof InlineToolAdapter | typeof BlockToolAdapter | typeof BlockTuneAdapter;

/**
 * Factory to construct classes to work with tools
 */
export default class ToolsFactory {
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
    const isTune = Boolean(Reflect.get(constructable, InternalTuneSettings.IsTune));

    return new Constructor({
      name,
      constructable,
      config,
      api: this.api.getMethodsForTool(name, isTune),
      isDefault: name === this.blokConfig.defaultBlock,
      defaultPlaceholder: this.blokConfig.placeholder,
      isInternal,
    });
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

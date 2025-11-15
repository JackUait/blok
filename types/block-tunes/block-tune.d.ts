import {API, BlockAPI, ToolConfig} from '../index';
import { BlockTuneData } from './block-tune-data';
import { BaseToolConstructable, MenuConfig } from '../tools';

/**
 * Describes BLockTune blueprint
 */
export interface BlockTune {
  /**
   * Returns BlockTune's UI.
   * Should return either MenuConfig (recommended) (@see https://editorjs.io/menu-config/)
   * or an HTMLElement (UI consistency is not guaranteed)
   */
  render(): HTMLElement | MenuConfig;

  /**
   * Method called on Tool render. Pass Tool content as an argument.
   *
   * You can wrap Tool's content with any wrapper you want to provide Tune's UI
   *
   * @param {HTMLElement} pluginsContent — Tool's content wrapper
   */
  wrap?(pluginsContent: HTMLElement): HTMLElement;

  /**
   * Called on Tool's saving. Should return any data Tune needs to save
   *
   * @return {BlockTuneData}
   */
  save?(): BlockTuneData;
}

/**
 * Describes BlockTune class constructor function
 */
export interface BlockTuneConstructable extends BaseToolConstructable {

  /**
   * Flag show Tool is Block Tune
   */
  isTune: boolean;

  /**
   * @constructor
   *
   * @param config - Block Tune config
   */
  new(config: {
    api: API,
    config?: ToolConfig,
    block: BlockAPI,
    data: BlockTuneData,
  }): BlockTune;

  /**
   * Tune`s prepare method. Can be async
   * @param data
   */
  prepare?(data: { toolName: string; config: ToolConfig }): Promise<void> | void;
}

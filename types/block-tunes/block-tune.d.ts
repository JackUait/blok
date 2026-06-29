import {API, BlockAPI, ToolConfig} from '../index';
import { BlockTuneData } from './block-tune-data';
import { BaseToolConstructable, MenuConfig } from '../tools';

/**
 * Context passed to a Block Tune's `render()` method, giving the tune a handle
 * on the popover it is rendered into — so custom tunes can anchor sub-menus or
 * portals inside Blok's tune popover instead of reaching into the DOM via
 * `closest('[data-blok-popover]')`.
 */
export interface BlockTuneRenderContext {
  /**
   * Returns the popover element (`[data-blok-popover]`) the tune is rendered
   * into, or `null` when accessed before the popover has mounted.
   *
   * `render()` itself runs *before* the popover exists, so calling this
   * synchronously inside `render()` returns `null`. Capture the context and
   * call this later (e.g. when opening a sub-menu) to get the live element.
   */
  getPopoverElement(): HTMLElement | null;
}

/**
 * Describes BLockTune blueprint
 */
export interface BlockTune {
  /**
   * Returns BlockTune's UI.
   * Should return either MenuConfig (recommended)
   * or an HTMLElement (UI consistency is not guaranteed)
   *
   * @param context - render context exposing the host tune popover element
   */
  render(context?: BlockTuneRenderContext): HTMLElement | MenuConfig;

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

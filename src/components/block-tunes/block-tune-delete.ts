/**
 * @class DeleteTune
 * @classdesc Blok's default tune that moves up selected block
 * @copyright <CodeX Team> 2018
 */
import type { API, BlockTune } from '../../../types';
import { IconCross } from '../icons';
import type { MenuConfig } from '../../../types/tools/menu-config';

/**
 *
 */
export default class DeleteTune implements BlockTune {
  /**
   * Set Tool is Tune
   */
  public static readonly isTune = true;

  /**
   * Property that contains Blok API methods
   * @see {@link docs/api.md}
   */
  private readonly api: API;

  /**
   * DeleteTune constructor
   * @param {API} api - Blok's API
   */
  constructor({ api }: { api: API }) {
    this.api = api;
  }

  /**
   * Tune's appearance in block settings menu
   */
  public render(): MenuConfig {
    return {
      icon: IconCross,
      title: this.api.i18n.t('blockSettings.delete'),
      name: 'delete',
      onActivate: (): void => this.handleClick(),
    };
  }

  /**
   * Delete block conditions passed
   */
  public handleClick(): void {
    this.api.blocks.delete();
  }
}

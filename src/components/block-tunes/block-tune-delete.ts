/**
 * @class DeleteTune
 * @classdesc Blok's default tune that moves up selected block
 * @copyright <CodeX Team> 2018
 */
import { BUILT_IN_TUNE_DESCRIPTIONS } from '../../shared/tool-descriptions/inline';
import type { API, BlockTune } from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { IconTrash } from '../icons';
import { announceDeletedRoots } from '../utils/selection-roots';
import { beautifyShortcut } from '../utils/string';

/**
 *
 */
export class DeleteTune implements BlockTune {
  public static describe = BUILT_IN_TUNE_DESCRIPTIONS.delete;

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
      icon: IconTrash,
      title: this.api.i18n.t('blockSettings.delete'),
      name: 'delete',
      isDestructive: true,
      secondaryLabel: beautifyShortcut('DELETE'),
      onActivate: (): void => {
        void this.handleClick();
      },
    };
  }

  /**
   * Delete block conditions passed
   */
  public async handleClick(): Promise<void> {
    const index = this.api.blocks.getCurrentBlockIndex();
    const id = this.api.blocks.getBlockByIndex(index)?.id;

    // Notion leaves no caret after a menu Delete (U104).
    await this.api.blocks.delete(index, false);

    if (id !== undefined) {
      announceDeletedRoots(this.api.i18n, [{ id, parentId: null }], (blockId) => this.api.blocks.getById(blockId) !== null);
    }
  }
}

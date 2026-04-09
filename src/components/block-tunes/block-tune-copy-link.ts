import type { API, BlockAPI, BlockTune } from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { IconLink } from '../icons';

/**
 * @class CopyLinkTune
 * @classdesc Blok's default tune that copies a direct link to the block to the clipboard
 */
export class CopyLinkTune implements BlockTune {
  /**
   * Set Tool is Tune
   */
  public static readonly isTune = true;

  /**
   * Property that contains Blok API methods
   */
  private readonly api: API;

  /**
   * The block this tune is attached to
   */
  private readonly block: BlockAPI;

  /**
   * Bound keydown handler for cleanup in destroy()
   */
  private readonly onKeydown: (event: KeyboardEvent) => void;

  /**
   * @param params - constructor params
   * @param params.api - Blok's API
   * @param params.block - BlockAPI for the current block
   */
  constructor({ api, block }: { api: API; block: BlockAPI }) {
    this.api = api;
    this.block = block;

    this.onKeydown = (event: KeyboardEvent): void => {
      if (event.metaKey && event.ctrlKey && event.code === 'KeyL' && this.block.selected) {
        void this.handleClick();
      }
    };

    document.addEventListener('keydown', this.onKeydown);
  }

  /**
   * Tune's appearance in block settings menu
   */
  public render(): MenuConfig {
    return {
      icon: IconLink,
      title: this.api.i18n.t('blockSettings.copyLink'),
      name: 'copy-link',
      secondaryLabel: '⌃⌘L',
      onActivate: (): Promise<void> => this.handleClick(),
    };
  }

  /**
   * Remove the keyboard shortcut listener
   */
  public destroy(): void {
    document.removeEventListener('keydown', this.onKeydown);
  }

  /**
   * Copy block link to clipboard and notify user
   */
  public async handleClick(): Promise<void> {
    const baseUrl = window.location.href.split('#')[0];
    const url = `${baseUrl}#${this.block.id}`;

    try {
      await navigator.clipboard.writeText(url);
      this.api.notifier.show({ message: 'Link copied to clipboard', style: 'success', time: 2000 });
    } catch {
      this.api.notifier.show({ message: 'Could not copy link to block', style: 'error', time: 3000 });
    }
  }
}

import { BUILT_IN_TUNE_DESCRIPTIONS } from '../../shared/tool-descriptions/inline';
import type { API, BlockAPI, BlockTune } from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { IconLink } from '../icons';
import { beautifyShortcut } from '../utils/string';

/** Live tunes, in creation order. Every block has one. */
const liveTunes = new Set<CopyLinkTune>();

/**
 * One document listener serves every tune: a listener per block made adding
 * and removing them grow with the document.
 * @param event - document keydown
 */
const onDocumentKeydown = (event: KeyboardEvent): void => {
  if (!(event.metaKey && event.ctrlKey && event.code === 'KeyL')) {
    return;
  }

  // A tune destroyed by an earlier one in this loop must not fire, as a removed listener would not.
  [...liveTunes].forEach((tune) => {
    if (liveTunes.has(tune)) {
      tune.handleShortcut();
    }
  });
};

/**
 * @class CopyLinkTune
 * @classdesc Blok's default tune that copies a direct link to the block to the clipboard
 */
export class CopyLinkTune implements BlockTune {
  public static describe = BUILT_IN_TUNE_DESCRIPTIONS.copyLink;

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
   * @param params - constructor params
   * @param params.api - Blok's API
   * @param params.block - BlockAPI for the current block
   */
  constructor({ api, block }: { api: API; block: BlockAPI }) {
    this.api = api;
    this.block = block;

    if (liveTunes.size === 0) {
      document.addEventListener('keydown', onDocumentKeydown);
    }
    liveTunes.add(this);
  }

  /**
   * Copy the link on Ctrl+Cmd+L while this block is selected
   */
  public handleShortcut(): void {
    if (this.block.selected) {
      void this.handleClick();
    }
  }

  /**
   * Tune's appearance in block settings menu
   */
  public render(): MenuConfig {
    /**
     * Read-only never selects a block on its own, so the shortcut can only ever
     * fire while this very menu is open. Advertising it there — in the visible
     * label and in the aria-keyshortcuts the popover derives from it — promises
     * a keystroke the user cannot reach from the page.
     */
    const secondaryLabel = this.api.readOnly.isEnabled ? undefined : beautifyShortcut('CTRL+CMD+L');

    return {
      icon: IconLink,
      title: this.api.i18n.t('blockSettings.copyLink'),
      name: 'copy-link',
      secondaryLabel,
      onActivate: (): Promise<void> => this.handleClick(),
    };
  }

  /**
   * Remove the keyboard shortcut listener
   */
  public destroy(): void {
    if (liveTunes.delete(this) && liveTunes.size === 0) {
      document.removeEventListener('keydown', onDocumentKeydown);
    }
  }

  /**
   * Copy block link to clipboard and notify user. A block that stands for
   * something else, like a page, copies that thing's url instead.
   */
  public async handleClick(): Promise<void> {
    const copyLink = this.block.copyLink;
    const baseUrl = window.location.href.split('#')[0];
    const url = typeof copyLink === 'string' ? copyLink : `${baseUrl}#${encodeURIComponent(this.block.id)}`;

    try {
      await navigator.clipboard.writeText(url);
      this.api.notifier.show({ message: this.api.i18n.t('blockSettings.copyLinkSuccess'), style: 'success', time: 2000 });
    } catch {
      this.api.notifier.show({ message: this.api.i18n.t('blockSettings.copyLinkError'), style: 'error', time: 3000 });
    }
  }
}

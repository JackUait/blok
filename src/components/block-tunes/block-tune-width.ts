import type { API, BlockTune } from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { IconWidthNarrow, IconWidthFull } from '../icons';

/**
 * WidthTune — opt-in block tune for toggling editor width mode.
 *
 * Register via:
 *   import Blok, { WidthTune } from '@blok/editor'
 *   new Blok({ tools: { width: WidthTune }, tunes: ['width'] })
 */
export class WidthTune implements BlockTune {
  public static readonly isTune = true;

  private readonly api: API;

  constructor({ api }: { api: API }) {
    this.api = api;
  }

  /**
   * Tune's appearance in block settings menu
   */
  public render(): MenuConfig {
    const current = this.api.width.get();

    return {
      name: 'toggle-width',
      icon: current === 'full' ? IconWidthFull : IconWidthNarrow,
      title: this.api.i18n.t('blockSettings.toggleWidth'),
      isActive: current === 'full',
      toggle: true,
      closeOnActivate: true,
      onActivate: (): void => {
        this.api.width.toggle();
      },
    };
  }
}

import type { API, BlockTune } from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';

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

  public render(): MenuConfig {
    const current = this.api.width.get();

    return [
      {
        name: 'width-narrow',
        icon: this.narrowIcon,
        title: this.api.i18n.t('blockSettings.widthNarrow'),
        isActive: current === 'narrow',
        onActivate: (): void => {
          this.api.width.set('narrow');
        },
      },
      {
        name: 'width-full',
        icon: this.fullIcon,
        title: this.api.i18n.t('blockSettings.widthFull'),
        isActive: current === 'full',
        onActivate: (): void => {
          this.api.width.set('full');
        },
      },
    ];
  }

  // ─── Icons ─────────────────────────────────────────────────────────────────

  private get narrowIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <line x1="7" y1="9" x2="17" y2="9"/>
      <line x1="7" y1="12" x2="17" y2="12"/>
      <line x1="7" y1="15" x2="13" y2="15"/>
    </svg>`;
  }

  private get fullIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <line x1="5" y1="9" x2="19" y2="9"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
      <line x1="5" y1="15" x2="19" y2="15"/>
    </svg>`;
  }
}

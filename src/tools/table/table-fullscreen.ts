import { IconCross, IconExpandDiagonal } from '../../components/icons';
import { DATA_ATTR } from '../../components/constants';
import { ScrollLocker } from '../../components/utils/scroll-locker';
import { promoteToTopLayer, removeFromTopLayer, TOP_LAYER_MARKER_ATTR } from '../../components/utils/top-layer';
import { onHover } from '../../components/utils/tooltip';

export const FULLSCREEN_ATTR = 'data-blok-table-fullscreen';
const BACKDROP_ATTR = 'data-blok-table-fullscreen-backdrop';
const TOGGLE_ATTR = 'data-blok-table-fullscreen-toggle';

interface TableFullscreenOptions {
  /** The block holder. It goes to the top layer, not the tool root: writes on the root count as edits. */
  getHost: () => HTMLElement | null;
  t: (key: string) => string;
}

const isOpenPopover = (el: HTMLElement): boolean => {
  try {
    return el.matches(':popover-open');
  } catch {
    // No Popover API: nothing is in the top layer.
    return false;
  }
};

/**
 * Shows the live table in a modal over the page. The table never moves in the
 * DOM, so editing, saving and the block tree work as they do inline.
 */
export class TableFullscreen {
  public readonly button: HTMLButtonElement;

  private host: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  private readonly scroll = new ScrollLocker();

  constructor(private readonly options: TableFullscreenOptions) {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(TOGGLE_ATTR, '');
    // Its label and icon swap on open; the table must not see that as an edit.
    button.setAttribute(DATA_ATTR.mutationFree, 'true');
    button.contentEditable = 'false';
    button.addEventListener('click', () => {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });
    this.button = button;
    this.syncButton();
  }

  public get isOpen(): boolean {
    return this.host !== null;
  }

  public open(): void {
    const host = this.options.getHost();

    if (host === null || this.isOpen) {
      return;
    }

    const backdrop = document.createElement('div');

    backdrop.setAttribute(BACKDROP_ATTR, '');
    backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(backdrop);
    // The top layer stacks in show order: the backdrop goes first.
    promoteToTopLayer(backdrop);
    this.backdrop = backdrop;

    host.setAttribute(FULLSCREEN_ATTR, '');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', this.options.t('tools.table.title'));
    promoteToTopLayer(host);
    window.addEventListener('keydown', this.onKeydown, true);
    this.host = host;

    this.scroll.lock();
    this.syncButton();
  }

  public close(): void {
    const host = this.host;

    if (host === null) {
      return;
    }
    this.host = null;

    window.removeEventListener('keydown', this.onKeydown, true);
    removeFromTopLayer(host);
    host.removeAttribute(FULLSCREEN_ATTR);
    host.removeAttribute('role');
    host.removeAttribute('aria-modal');
    host.removeAttribute('aria-label');

    if (this.backdrop !== null) {
      removeFromTopLayer(this.backdrop);
      this.backdrop.remove();
      this.backdrop = null;
    }

    this.scroll.unlock();
    this.syncButton();

    if (this.button.isConnected) {
      this.button.focus({ preventScroll: true });
    }
  }

  public destroy(): void {
    this.close();
    this.button.remove();
  }

  /**
   * Window capture runs before every document handler. Blok's Escape there stops
   * the event before it reaches the holder, and a menu's Escape closes the menu
   * before hasLayerAbove could see it. A menu above the table closes first.
   */
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.hasLayerAbove()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private hasLayerAbove(): boolean {
    const host = this.host;

    return Array.from(document.querySelectorAll<HTMLElement>(`[${TOP_LAYER_MARKER_ATTR}]`)).some(el =>
      el !== host
      && el !== this.backdrop
      && el.getAttribute('role') !== 'tooltip'
      && host?.contains(el) !== true
      && isOpenPopover(el)
    );
  }

  private syncButton(): void {
    const label = this.options.t(this.isOpen ? 'tools.table.closeFullScreen' : 'tools.table.openFullScreen');

    this.button.innerHTML = this.isOpen ? IconCross : IconExpandDiagonal;
    this.button.setAttribute('aria-label', label);
    onHover(this.button, label);
  }
}

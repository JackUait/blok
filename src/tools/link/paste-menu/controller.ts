import { PopoverDesktop } from '../../../components/utils/popover';
import { PopoverEvent } from '../../../../types/utils/popover/popover-event';

import { buildPasteMenuItems, type PasteMenuI18n } from './items';
import { buildPasteMenuOptions, type PasteMenuActionType } from './options';

export interface PasteMenuOpenParams {
  /** The pasted URL the menu acts on. */
  url: string;
  /** Whether the paste landed on a non-collapsed selection. */
  hasSelection: boolean;
  /** Caret rect to anchor the popover at, or null to let the popover self-place. */
  position: DOMRect | null;
  /**
   * Element the popover is bound to. Registers it with the popover registry so
   * the global Escape handler can dismiss it; placement still uses `position`.
   */
  trigger?: HTMLElement;
  /** Called with the chosen action when the user picks an item. */
  onSelect: (type: PasteMenuActionType) => void;
  /** Called when the menu closes without a pick (e.g. Escape) so the paste isn't lost. */
  onDismiss: () => void;
}

export interface LinkPasteMenu {
  open(params: PasteMenuOpenParams): void;
}

/**
 * Actions the live menu currently serves. `mention` is built and unit-tested but
 * its save round-trip needs a registered inline tool (per-block sanitize), so it
 * is filtered out here until that lands.
 */
const LIVE_ACTIONS: ReadonlySet<PasteMenuActionType> = new Set<PasteMenuActionType>([
  'plain',
  'bookmark',
  'embed',
]);

/**
 * Notion-style popover shown on URL paste. Builds the applicable options, renders
 * them via the editor Popover at the caret, and reports the user's choice.
 */
export class PasteMenuController implements LinkPasteMenu {
  private popover: PopoverDesktop | null = null;

  constructor(private readonly i18n: PasteMenuI18n) {}

  public open(params: PasteMenuOpenParams): void {
    this.closeExisting();

    const options = buildPasteMenuOptions(params.url, { hasSelection: params.hasSelection })
      .filter((option) => LIVE_ACTIONS.has(option.type));

    // Mutable flags held on a const object (the lint config forbids `let`).
    const state = { picked: false, closed: false };

    const items = buildPasteMenuItems(options, this.i18n, (type) => {
      state.picked = true;
      params.onSelect(type);
    });

    const popover = new PopoverDesktop({
      items,
      flippable: true,
      ...(params.trigger ? { trigger: params.trigger } : {}),
      ...(params.position ? { position: params.position } : {}),
    });

    this.popover = popover;

    // Own our Escape dismissal: the menu lives in the top layer where the
    // editor's global Escape→registry chain doesn't reliably reach it. Listen on
    // window (capture) so we run before the editor's document-level handler, and
    // stop the event so it doesn't also drive navigation mode / selection.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        popover.hide();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);

    // Reentrancy-guarded: destroy() calls hide(), which re-emits Closed. The
    // guard makes finalize idempotent so we neither recurse nor dismiss twice.
    const finalize = (): void => {
      if (state.closed) {
        return;
      }

      state.closed = true;
      window.removeEventListener('keydown', onKeyDown, true);

      if (this.popover === popover) {
        this.popover = null;
      }

      if (!state.picked) {
        params.onDismiss();
      }

      popover.destroy();
    };

    popover.on(PopoverEvent.Closed, finalize);

    popover.show();
  }

  private closeExisting(): void {
    if (this.popover) {
      this.popover.hide();
    }
  }
}

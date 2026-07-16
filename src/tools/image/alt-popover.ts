import { openModalDialog } from '../../components/utils/modal-dialog';
import { positionFixedAnchored, createPositionTracker } from '../../components/utils/popover/anchored-position';
import { tr } from './i18n';
import type { I18nInstance } from '../../components/utils/tools';

export interface OpenAltPopoverOptions {
  anchor: HTMLElement;
  value: string;
  onSave(next: string): void;
  onCancel(): void;
  i18n?: I18nInstance;
}

/**
 * Incrementing counter minting unique ids for the description paragraph so it
 * can be referenced via `aria-describedby`.
 */
const descriptionIdSeq = { current: 0 };

/**
 * How long (ms) after an outside-pointer dismissal a re-open on the same
 * anchor is ignored. The modal primitive marks the editor subtree `inert`
 * while the popover is open, so in real browsers a pointerdown on the trigger
 * retargets to `body` and dismisses the popover; by the time the paired
 * `click` fires the inert marker is gone, the trigger's handler runs, and the
 * popover would instantly re-open. The guard swallows that bounce.
 */
const REOPEN_GUARD_MS = 200;

/**
 * Timestamps of the last outside-pointer dismissal, keyed by the anchor whose
 * popover was dismissed, so only the dismiss→click bounce on the same trigger
 * is suppressed.
 */
const lastOutsideDismissal = new WeakMap<HTMLElement, number>();

export function openAltPopover(opts: OpenAltPopoverOptions): () => void {
  const dismissedAt = lastOutsideDismissal.get(opts.anchor);

  if (dismissedAt !== undefined && Date.now() - dismissedAt < REOPEN_GUARD_MS) {
    return () => {};
  }

  const popover = document.createElement('div');
  popover.className = 'blok-image-alt-popover';
  popover.setAttribute('data-role', 'image-alt-popover');

  const description = document.createElement('p');
  descriptionIdSeq.current += 1;
  description.id = `blok-image-alt-popover-description-${descriptionIdSeq.current}`;
  description.className = 'blok-image-alt-popover__description';
  description.textContent = tr(opts.i18n, 'tools.image.altDescription');
  popover.appendChild(description);

  const textarea = document.createElement('textarea');
  textarea.className = 'blok-image-alt-popover__input';
  textarea.rows = 2;
  textarea.value = opts.value;
  textarea.placeholder = tr(opts.i18n, 'tools.image.altPlaceholder');
  popover.appendChild(textarea);

  const state = { detached: false };

  // The shared modal primitive owns mounting, Top Layer promotion, background
  // `inert`, the focus trap, focus restore, and dismissal wiring. Escape cancels
  // (discards edits); a pointer press outside the popover and its anchor commits
  // (mirrors the field's blur-to-save behaviour). Presses on the anchor itself
  // are treated as inside so re-clicking the trigger does not immediately close.
  const dialogHandle = openModalDialog({
    content: popover,
    role: 'dialog',
    label: tr(opts.i18n, 'tools.image.altEdit'),
    describedBy: description.id,
    initialFocus: () => textarea,
    anchor: opts.anchor,
    onDismiss: (reason) => {
      if (reason === 'escape') {
        cancel();
      } else {
        lastOutsideDismissal.set(opts.anchor, Date.now());
        commit();
      }
    },
    onClose: () => {
      tracker.detach();
    },
  });

  // Shared anchored-positioning engine: preferred side below the anchor,
  // flipping above when there is not enough room, stamping `data-side` for
  // the connector styling. The tracker re-runs it on scroll / resize / own
  // size changes while the dialog is open.
  const tracker = createPositionTracker(popover, reposition);

  reposition();
  tracker.attach();

  // The primitive focuses the textarea synchronously; place the caret at the end.
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const detach = (): void => {
    if (state.detached) {
      return;
    }
    state.detached = true;
    dialogHandle.close();
  };

  const commit = (): void => {
    if (state.detached) {
      return;
    }
    const next = textarea.value;
    detach();
    opts.onSave(next);
  };

  const cancel = (): void => {
    if (state.detached) {
      return;
    }
    detach();
    opts.onCancel();
  };

  function reposition(): void {
    if (state.detached) {
      return;
    }

    positionFixedAnchored(popover, opts.anchor, {
      side: 'bottom',
      offset: 8,
    });
  }

  textarea.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  });

  return detach;
}

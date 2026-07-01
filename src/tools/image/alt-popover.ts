import { openModalDialog } from '../../components/utils/modal-dialog';
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
let descriptionIdCounter = 0;

export function openAltPopover(opts: OpenAltPopoverOptions): () => void {
  const popover = document.createElement('div');
  popover.className = 'blok-image-alt-popover';
  popover.setAttribute('data-role', 'image-alt-popover');

  const description = document.createElement('p');
  descriptionIdCounter += 1;
  description.id = `blok-image-alt-popover-description-${descriptionIdCounter}`;
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
        commit();
      }
    },
    onClose: () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    },
  });

  positionPopover(popover, opts.anchor);

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
    positionPopover(popover, opts.anchor);
  }

  textarea.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  });

  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  return detach;
}

/**
 * Positions the popover under its anchor, flipping above when it would overflow
 * the viewport's bottom edge. The chosen side is exposed via `data-side` for
 * styling hooks (e.g. flipping the connector direction).
 * @param {HTMLElement} popover - the popover element
 * @param {HTMLElement} anchor - the element the popover is attached to
 */
function positionPopover(popover: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  const { style } = popover;

  style.position = 'fixed';
  style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  style.left = 'auto';

  // Flip above the anchor when the popover's own height would push it past the
  // bottom edge and there is more room above than below.
  const popoverHeight = popover.offsetHeight;
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const flipsAbove = popoverHeight > 0 && spaceBelow < popoverHeight + gap && spaceAbove > spaceBelow;

  if (flipsAbove) {
    style.top = 'auto';
    style.bottom = `${Math.max(8, viewportHeight - rect.top + gap)}px`;
    popover.setAttribute('data-side', 'top');
  } else {
    style.bottom = 'auto';
    style.top = `${rect.bottom + gap}px`;
    popover.setAttribute('data-side', 'bottom');
  }
}

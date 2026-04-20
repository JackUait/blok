import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';

export interface OpenAltPopoverOptions {
  anchor: HTMLElement;
  value: string;
  onSave(next: string): void;
  onCancel(): void;
}

const DESCRIPTION =
  'Add alt text to describe this image. This makes your page more accessible to people who are vision-impaired or blind.';

export function openAltPopover(opts: OpenAltPopoverOptions): () => void {
  const popover = document.createElement('div');
  popover.className = 'blok-image-alt-popover';
  popover.setAttribute('data-role', 'image-alt-popover');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Edit alt text');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'blok-image-alt-popover__close';
  closeBtn.setAttribute('data-action', 'close');
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  popover.appendChild(closeBtn);

  const description = document.createElement('p');
  description.className = 'blok-image-alt-popover__description';
  description.textContent = DESCRIPTION;
  popover.appendChild(description);

  const textarea = document.createElement('textarea');
  textarea.className = 'blok-image-alt-popover__input';
  textarea.rows = 2;
  textarea.value = opts.value;
  textarea.placeholder = 'Alt text';
  popover.appendChild(textarea);

  document.body.appendChild(popover);
  promoteToTopLayer(popover);
  positionPopover(popover, opts.anchor);

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const state = { detached: false };

  const detach = (): void => {
    if (state.detached) return;
    state.detached = true;
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('mousedown', onOutside);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    removeFromTopLayer(popover);
    popover.remove();
  };

  const commit = (): void => {
    const next = textarea.value;
    detach();
    opts.onSave(next);
  };

  const cancel = (): void => {
    detach();
    opts.onCancel();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  };

  const onOutside = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && (popover.contains(target) || opts.anchor.contains(target))) return;
    commit();
  };

  function reposition(): void {
    if (state.detached) return;
    positionPopover(popover, opts.anchor);
  }

  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    commit();
  });

  textarea.addEventListener('keydown', onKeyDown);
  document.addEventListener('mousedown', onOutside);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  return detach;
}

function positionPopover(popover: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  const { style } = popover;
  style.position = 'fixed';
  style.top = `${rect.bottom + gap}px`;
  style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  style.left = 'auto';
}

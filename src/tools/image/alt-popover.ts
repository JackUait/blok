import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { tr } from './i18n';
import type { I18nInstance } from '../../components/utils/tools';

export interface OpenAltPopoverOptions {
  anchor: HTMLElement;
  value: string;
  onSave(next: string): void;
  onCancel(): void;
  i18n?: I18nInstance;
}

export function openAltPopover(opts: OpenAltPopoverOptions): () => void {
  const popover = document.createElement('div');
  popover.className = 'blok-image-alt-popover';
  popover.setAttribute('data-role', 'image-alt-popover');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', tr(opts.i18n, 'tools.image.altEdit'));

  const description = document.createElement('p');
  description.className = 'blok-image-alt-popover__description';
  description.textContent = tr(opts.i18n, 'tools.image.altDescription');
  popover.appendChild(description);

  const textarea = document.createElement('textarea');
  textarea.className = 'blok-image-alt-popover__input';
  textarea.rows = 2;
  textarea.value = opts.value;
  textarea.placeholder = tr(opts.i18n, 'tools.image.altPlaceholder');
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

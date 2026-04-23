import type { ImageCrop } from '../../../types/tools/image';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import type { I18nInstance } from '../../components/utils/tools';
import { mountCropEditor } from './crop-editor';
import { tr } from './i18n';

function readAnimationName(el: Element): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.getComputedStyle(el).animationName || '';
  } catch {
    return '';
  }
}

function supportsAnimations(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !/jsdom/i.test(navigator.userAgent);
}

export interface OpenCropModalOptions {
  url: string;
  alt?: string;
  initial?: ImageCrop;
  onApply(rect: ImageCrop | null): void;
  onCancel(): void;
  i18n?: I18nInstance;
}

export function openCropModal(opts: OpenCropModalOptions): () => void {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const backdrop = document.createElement('div');
  backdrop.className = 'blok-image-crop-modal-backdrop';
  backdrop.setAttribute('role', 'presentation');
  backdrop.setAttribute('data-blok-testid', 'image-crop-backdrop');

  const dialog = document.createElement('div');
  dialog.className = 'blok-image-crop-modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', tr(opts.i18n, 'tools.image.cropDialogLabel'));
  dialog.tabIndex = -1;

  const body = document.createElement('div');
  body.className = 'blok-image-crop-modal-body';
  dialog.appendChild(body);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  promoteToTopLayer(backdrop);

  const state: { detached: boolean; closing: boolean; editorDetach: (() => void) | null } = {
    detached: false,
    closing: false,
    editorDetach: null,
  };

  const pointerState = { downOnBackdrop: false };

  const finalize = (): void => {
    if (state.detached) return;
    state.detached = true;
    state.editorDetach?.();
    state.editorDetach = null;
    removeFromTopLayer(backdrop);
    backdrop.remove();
    previousFocus?.focus?.();
  };

  const detach = (): void => {
    if (state.detached) return;
    state.closing = true;
    backdrop.removeEventListener('mousedown', onBackdropPointerDown);
    backdrop.removeEventListener('click', onBackdropClick);
    finalize();
  };

  const closeAnimated = (): void => {
    if (state.detached || state.closing) return;
    state.closing = true;
    backdrop.removeEventListener('mousedown', onBackdropPointerDown);
    backdrop.removeEventListener('click', onBackdropClick);

    const reduceMotion = typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    backdrop.setAttribute('data-blok-closing', 'true');

    if (reduceMotion || !supportsAnimations()) {
      finalize();
      return;
    }

    const animName = readAnimationName(dialog);
    const hasAnimation = !!animName && animName !== 'none';
    if (!hasAnimation) {
      finalize();
      return;
    }

    const settleState: { settled: boolean; fallback: number } = {
      settled: false,
      fallback: 0,
    };
    const settle = (): void => {
      if (settleState.settled) return;
      settleState.settled = true;
      dialog.removeEventListener('animationend', onAnimationEnd);
      if (settleState.fallback !== 0) window.clearTimeout(settleState.fallback);
      finalize();
    };
    const onAnimationEnd = (event: AnimationEvent): void => {
      if (event.target !== dialog) return;
      settle();
    };
    dialog.addEventListener('animationend', onAnimationEnd);
    settleState.fallback = window.setTimeout(settle, 260);
  };

  const onBackdropPointerDown = (event: MouseEvent): void => {
    pointerState.downOnBackdrop = event.target === backdrop;
  };

  const onBackdropClick = (event: MouseEvent): void => {
    const shouldClose = event.target === backdrop && pointerState.downOnBackdrop;
    pointerState.downOnBackdrop = false;
    if (!shouldClose) return;
    closeAnimated();
    opts.onCancel();
  };

  backdrop.addEventListener('mousedown', onBackdropPointerDown);
  backdrop.addEventListener('click', onBackdropClick);

  state.editorDetach = mountCropEditor(body, {
    url: opts.url,
    alt: opts.alt,
    initial: opts.initial,
    i18n: opts.i18n,
    onApply: (rect) => {
      closeAnimated();
      opts.onApply(rect);
    },
    onCancel: () => {
      closeAnimated();
      opts.onCancel();
    },
  });

  const done = dialog.querySelector<HTMLButtonElement>('[data-action="done"]');
  done?.focus();

  return detach;
}

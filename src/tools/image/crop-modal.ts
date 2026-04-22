import type { ImageCrop } from '../../../types/tools/image';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import type { I18nInstance } from '../../components/utils/tools';
import { mountCropEditor } from './crop-editor';
import { tr } from './i18n';

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

  const state: { detached: boolean; editorDetach: (() => void) | null } = {
    detached: false,
    editorDetach: null,
  };

  const pointerState = { downOnBackdrop: false };

  const detach = (): void => {
    if (state.detached) return;
    state.detached = true;
    backdrop.removeEventListener('mousedown', onBackdropPointerDown);
    backdrop.removeEventListener('click', onBackdropClick);
    state.editorDetach?.();
    state.editorDetach = null;
    removeFromTopLayer(backdrop);
    backdrop.remove();
    previousFocus?.focus?.();
  };

  const onBackdropPointerDown = (event: MouseEvent): void => {
    pointerState.downOnBackdrop = event.target === backdrop;
  };

  const onBackdropClick = (event: MouseEvent): void => {
    const shouldClose = event.target === backdrop && pointerState.downOnBackdrop;
    pointerState.downOnBackdrop = false;
    if (!shouldClose) return;
    detach();
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
      detach();
      opts.onApply(rect);
    },
    onCancel: () => {
      detach();
      opts.onCancel();
    },
  });

  const done = dialog.querySelector<HTMLButtonElement>('[data-action="done"]');
  done?.focus();

  return detach;
}

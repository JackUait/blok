import type { ImageCrop } from '../../../types/tools/image';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { mountCropEditor } from './crop-editor';

export interface OpenCropModalOptions {
  url: string;
  alt?: string;
  initial?: ImageCrop;
  onApply(rect: ImageCrop | null): void;
  onCancel(): void;
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
  dialog.setAttribute('aria-label', 'Crop image');
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

  const detach = (): void => {
    if (state.detached) return;
    state.detached = true;
    backdrop.removeEventListener('click', onBackdropClick);
    state.editorDetach?.();
    state.editorDetach = null;
    removeFromTopLayer(backdrop);
    backdrop.remove();
    previousFocus?.focus?.();
  };

  const onBackdropClick = (event: MouseEvent): void => {
    if (event.target !== backdrop) return;
    detach();
    opts.onCancel();
  };

  backdrop.addEventListener('click', onBackdropClick);

  state.editorDetach = mountCropEditor(body, {
    url: opts.url,
    alt: opts.alt,
    initial: opts.initial,
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

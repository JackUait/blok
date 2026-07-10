import type { ImageCrop } from '../../../types/tools/image';
import { openModalDialog } from '../../components/utils/modal-dialog';
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
  const backdrop = document.createElement('div');
  backdrop.className = 'blok-image-crop-modal-backdrop';
  backdrop.setAttribute('role', 'presentation');
  backdrop.setAttribute('data-blok-testid', 'image-crop-backdrop');

  const dialog = document.createElement('div');
  dialog.className = 'blok-image-crop-modal-dialog';
  dialog.tabIndex = -1;

  const body = document.createElement('div');
  body.className = 'blok-image-crop-modal-body';
  dialog.appendChild(body);
  backdrop.appendChild(dialog);

  const state: { editorDetach: (() => void) | null } = { editorDetach: null };

  // The shared modal primitive owns mounting, Top Layer promotion, background
  // `inert`, the focus trap, focus restore (with an isConnected guard) and the
  // exit-animation settle. A pointerdown on the dim backdrop counts as
  // "outside" the dialog surface; a press that starts on a crop handle (inside
  // the surface) never dismisses, which subsumes the old down-on-backdrop
  // tracking used to survive drag-releases over the backdrop.
  const dialogHandle = openModalDialog({
    content: backdrop,
    surface: dialog,
    role: 'dialog',
    label: tr(opts.i18n, 'tools.image.cropDialogLabel'),
    initialFocus: () => dialog.querySelector<HTMLButtonElement>('[data-action="done"]'),
    onDismiss: () => {
      dialogHandle.closeAnimated();
      opts.onCancel();
    },
    onClose: () => {
      state.editorDetach?.();
      state.editorDetach = null;
    },
  });

  state.editorDetach = mountCropEditor(body, {
    url: opts.url,
    alt: opts.alt,
    initial: opts.initial,
    i18n: opts.i18n,
    onApply: (rect) => {
      dialogHandle.closeAnimated();
      opts.onApply(rect);
    },
    onCancel: () => {
      dialogHandle.closeAnimated();
      opts.onCancel();
    },
  });

  // Host teardown (e.g. block re-render) is immediate — no exit animation.
  return dialogHandle.close;
}

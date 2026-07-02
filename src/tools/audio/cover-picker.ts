import { matchesMime } from '../../components/utils/mime-match';
import type { I18nInstance } from '../../components/utils/tools';
import { tr } from './i18n';
import { COVER_TYPES, COVER_MAX_SIZE } from './constants';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { getTabbables } from '../../components/utils/modal-dialog';
import {
  renderMediaEmptyState,
  type MediaEmptyStateElement,
} from '../../components/utils/media-empty-state';

/** Validate a chosen cover file. Returns an error message, or null when valid. */
export function validateCoverFile(file: File, i18n?: I18nInstance): string | null {
  if (file.type && !matchesMime(file.type, [...COVER_TYPES])) {
    return tr(i18n, 'tools.audio.coverErrorType', 'Choose an image file');
  }
  if (file.size > COVER_MAX_SIZE) {
    return tr(i18n, 'tools.audio.coverErrorTooLarge', 'Image is too large');
  }
  return null;
}

export interface OpenCoverPickerOptions {
  anchor: HTMLElement;
  onFile(file: File): void;
  onUrl(url: string): void;
  onClose?(): void;
  i18n?: I18nInstance;
}

export interface CoverPickerHandle {
  close(): void;
  setError(message: string | null): void;
}

export function openCoverPicker(opts: OpenCoverPickerOptions): CoverPickerHandle {
  const dialog = document.createElement('div');
  dialog.className = 'blok-audio-cover-picker';
  dialog.setAttribute('data-role', 'audio-cover-picker');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', tr(opts.i18n, 'tools.audio.coverSet', 'Set cover image'));

  const surface: MediaEmptyStateElement = renderMediaEmptyState({
    acceptTypes: [...COVER_TYPES],
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    // The picker is a floating popover, so the inline height tween only reads as
    // lag here. Slide the incoming panel in from the travel direction instead —
    // the swap keeps its personality while the popover resizes instantly.
    swap: 'slide',
    labels: {
      add: tr(opts.i18n, 'tools.audio.coverAdd', 'Add a cover'),
      upload: tr(opts.i18n, 'tools.audio.coverUpload', 'Upload'),
      embed: tr(opts.i18n, 'tools.audio.coverLink', 'Link'),
      chooseFile: tr(opts.i18n, 'tools.audio.coverChooseFile', 'Choose file'),
      orDropHere: tr(opts.i18n, 'tools.audio.coverOrDropHere', 'or drop an image here'),
      dropToUpload: tr(opts.i18n, 'tools.audio.coverDropToUpload', 'Drop to upload'),
      urlPlaceholder: tr(opts.i18n, 'tools.audio.coverUrlPlaceholder', 'Paste an image URL…'),
      urlAria: tr(opts.i18n, 'tools.audio.coverUrlAria', 'Image URL'),
      submit: tr(opts.i18n, 'tools.audio.coverInsert', 'Insert'),
      sourceAria: tr(opts.i18n, 'tools.audio.coverSourceAria', 'Cover source'),
    },
  });
  dialog.appendChild(surface);

  // Capture the element to hand focus back to before we mount + move focus into
  // the picker. Restored on close only when still connected (an isConnected
  // guard — the anchor's block may have been torn down mid-session).
  const previouslyFocused = document.activeElement;

  document.body.appendChild(dialog);
  promoteToTopLayer(dialog);
  position(dialog, opts.anchor);

  // The picker is an anchored, non-modal dialog, so it advertises its open state
  // on the trigger (mirrors the alt-text popover) rather than inert-ing the page.
  opts.anchor.setAttribute('aria-expanded', 'true');

  // Pull focus into the picker so keyboard + screen-reader users land inside it.
  getTabbables(dialog)[0]?.focus();

  const state = { detached: false };

  const detach = (): void => {
    if (state.detached) return;
    state.detached = true;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousedown', onOutside);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    removeFromTopLayer(dialog);
    dialog.remove();
    opts.anchor.setAttribute('aria-expanded', 'false');
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
  };

  const close = (): void => {
    detach();
    opts.onClose?.();
  };

  // Soft focus trap: keep Tab / Shift+Tab cycling within the picker's own
  // tabbables (it is non-modal, so nothing inert-s the background).
  const trapTab = (event: KeyboardEvent): void => {
    const focusables = getTabbables(dialog);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  const onOutside = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && (dialog.contains(target) || opts.anchor.contains(target))) return;
    close();
  };

  function reposition(): void {
    if (state.detached) return;
    position(dialog, opts.anchor);
  }

  // Capture phase for Escape so it beats the editor's own key handling.
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('mousedown', onOutside);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  return {
    close,
    setError: (message) => surface.setError(message),
  };
}

function position(dialog: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  const { style } = dialog;
  style.position = 'fixed';
  style.top = `${rect.bottom + gap}px`;
  style.left = `${Math.max(8, rect.left)}px`;
  style.right = 'auto';
}

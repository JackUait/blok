import { matchesMime } from '../../components/utils/mime-match';
import type { I18nInstance } from '../../components/utils/tools';
import { tr } from './i18n';
import { COVER_TYPES, COVER_MAX_SIZE } from './constants';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { getTabbables } from '../../components/utils/modal-dialog';
import { registerLayer } from '../../components/utils/dismissable-layer';
import {
  positionAnchored,
  createPositionTracker,
} from '../../components/utils/popover/anchored-position';
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
  /** Element the picker is visually anchored to (the cover art). */
  anchor: HTMLElement;
  /**
   * The button that opened the picker. It carries the aria-haspopup /
   * aria-expanded state (a role-less anchor div is mute to AT) and regains
   * focus when the picker closes. Falls back to `anchor` when omitted.
   */
  trigger?: HTMLElement;
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

  // The element that owns the picker's ARIA state and regains focus on close.
  const trigger = opts.trigger ?? opts.anchor;

  // Fallback focus target for when the trigger's block was torn down
  // mid-session (an isConnected guard covers that on close).
  const previouslyFocused = document.activeElement;

  document.body.appendChild(dialog);
  promoteToTopLayer(dialog);

  // Anchored positioning via the shared engine: prefers the space below the
  // anchor, flips above when the viewport bottom would clip the picker, and
  // clamps horizontally. Coordinates are document-relative → absolute.
  dialog.style.position = 'absolute';
  const reposition = (): void => {
    positionAnchored(dialog, opts.anchor, { side: 'bottom', offset: 8 });
  };
  reposition();

  // The picker is an anchored, non-modal dialog, so it advertises its open state
  // on the trigger button (mirrors the alt-text popover) rather than inert-ing
  // the page.
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'true');

  // Pull focus into the picker so keyboard + screen-reader users land inside it.
  getTabbables(dialog)[0]?.focus();

  const state = { detached: false };

  // Keep the picker glued to the anchor across scroll / resize / own-size
  // changes (shared autoUpdate-style tracker).
  const tracker = createPositionTracker(dialog, () => {
    if (!state.detached) reposition();
  });
  tracker.attach();

  const detach = (): void => {
    if (state.detached) return;
    state.detached = true;
    document.removeEventListener('keydown', onKeyDown, true);
    tracker.detach();
    unregisterLayer();
    removeFromTopLayer(dialog);
    dialog.remove();
    trigger.setAttribute('aria-expanded', 'false');
    if (trigger.isConnected) {
      trigger.focus();
    } else if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
  };

  const close = (): void => {
    detach();
    opts.onClose?.();
  };

  // Escape + outside-press dismissal via the shared dismissable-layer stack
  // (one capture-phase listener pair for all floating surfaces; only the
  // topmost layer is peeled per interaction).
  const unregisterLayer = registerLayer({
    element: dialog,
    anchor: opts.anchor,
    onDismiss: () => close(),
  });

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

  // Capture phase so the trap wins over the editor's own key handling.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') {
      trapTab(event);
    }
  };

  document.addEventListener('keydown', onKeyDown, true);

  return {
    close,
    setError: (message) => surface.setError(message),
  };
}

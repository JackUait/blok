import { matchesMime } from '../../components/utils/mime-match';
import { syncPortalDirection } from '../../components/utils/portal-direction';
import type { I18nInstance } from '../../components/utils/tools';
import { tr } from './i18n';
import { COVER_TYPES, COVER_MAX_SIZE } from './constants';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { safeImageSrc } from '../../shared/sanitize-url';
import { getTabbables } from '../../components/utils/modal-dialog';
import { isSheetLoaded, loadSheet } from '../../components/utils/lazy-styles';
import { registerLayer } from '../../components/utils/dismissable-layer';
import {
  positionAnchored,
  createPositionTracker,
} from '../../components/utils/popover/anchored-position';
import { renderMediaEmptyState, type MediaEmptyStateLabels } from '../../components/utils/media-empty-state';
import { renderInkWell } from './ink-well';

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

export interface CoverGalleryGroup {
  label: string;
  items: ReadonlyArray<{label: string; url: string}>;
}

export interface OpenCoverPickerOptions {
  /** Optional host-owned gallery, alongside the existing upload and link paths. */
  gallery?: ReadonlyArray<CoverGalleryGroup>;
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
  /**
   * `ink-well` is the audio block's own picker: the ink drop beside the uploader.
   * `card` is the uploader alone. Defaults to `card`.
   */
  surface?: 'card' | 'ink-well';
  /** The cover set now. The ink well shows it from the start. */
  current?: string;
}

export interface CoverPickerHandle {
  close(): void;
  setError(message: string | null): void;
  /**
   * Resolves once the ink well has finished opening onto a new picture.
   * Wait for it before closing, or the picture is never seen. At once on `card`.
   */
  settle(): Promise<void>;
}

/** What the dialog shows inside. */
interface PickerSurface {
  element: HTMLElement;
  setError(message: string | null): void;
  settle(): Promise<void>;
  destroy(): void;
}

function uploaderLabels(opts: OpenCoverPickerOptions): MediaEmptyStateLabels {
  return {
    add: tr(opts.i18n, 'tools.audio.coverAdd', 'Add a cover'),
    hint: tr(opts.i18n, 'tools.audio.coverHint', 'Drag an image here, choose one, or paste a link.'),
    dropAnywhere: tr(opts.i18n, 'tools.image.emptyDropAnywhere', 'Let go anywhere in this block.'),
    cancelLink: tr(opts.i18n, 'notifier.cancel', 'Cancel'),
    embed: tr(opts.i18n, 'tools.audio.coverLink', 'Link'),
    chooseFile: tr(opts.i18n, 'tools.audio.coverChooseFile', 'Choose file'),
    dropToUpload: tr(opts.i18n, 'tools.audio.coverDropToUpload', 'Drop to upload'),
    urlPlaceholder: tr(opts.i18n, 'tools.audio.coverUrlPlaceholder', 'Paste an image URL…'),
    urlAria: tr(opts.i18n, 'tools.audio.coverUrlAria', 'Image URL'),
    submit: tr(opts.i18n, 'tools.audio.coverInsert', 'Insert'),
  };
}

function inkWellSurface(opts: OpenCoverPickerOptions): PickerSurface {
  const element = renderInkWell({
    acceptTypes: [...COVER_TYPES],
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    ...(opts.current ? { current: opts.current } : {}),
    labels: {
      ...uploaderLabels(opts),
      ...(opts.current ? { add: tr(opts.i18n, 'tools.audio.coverChange', 'Change cover') } : {}),
      // The same words as the audio block's own uploader.
      embed: tr(opts.i18n, 'tools.audio.emptyLink', 'From a link'),
      submit: tr(opts.i18n, 'tools.audio.emptyInsert', 'Add'),
      wellAria: tr(opts.i18n, 'tools.audio.coverSet', 'Set cover image'),
    },
  });

  return {
    element,
    setError: (message) => element.setError(message),
    settle: () => element.settle(),
    destroy: () => element.destroy(),
  };
}

function cardSurface(opts: OpenCoverPickerOptions, sources?: 'upload' | 'url'): PickerSurface {
  const element = renderMediaEmptyState({
    ...(sources ? {sources} : {}),
    acceptTypes: [...COVER_TYPES],
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    labels: uploaderLabels(opts),
  });

  return {
    element,
    setError: (message) => element.setError(message),
    settle: () => Promise.resolve(),
    destroy: () => undefined,
  };
}

/** Gallery composition keeps the uploader and link controls owned by the shared media surface. */
function gallerySurface(opts: OpenCoverPickerOptions): PickerSurface {
  const element = document.createElement('div');
  const tabs = document.createElement('div');
  tabs.className = 'blok-cover-gallery-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', tr(opts.i18n, 'tools.audio.coverSet', 'Set cover image'));
  const gallery = document.createElement('div');
  gallery.className = 'blok-cover-gallery';
  const upload = cardSurface(opts, 'upload');
  const link = cardSurface(opts, 'url');
  const panels = [gallery, upload.element, link.element];
  const buttons: HTMLButtonElement[] = [];
  const key = Math.random().toString(36).slice(2);
  const labels = [tr(opts.i18n, 'tools.database.galleryLabel', 'Gallery'),
    tr(opts.i18n, 'tools.audio.coverUpload', 'Upload'), tr(opts.i18n, 'tools.audio.coverLink', 'Link')];
  const select = (index: number): void => {
    panels.forEach((panel, current) => { panel.hidden = current !== index; });
    buttons.forEach((button, current) => { button.setAttribute('aria-selected', String(current === index)); button.tabIndex = current === index ? 0 : -1; });
    upload.setError(null); link.setError(null);
  };
  labels.forEach((label, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    button.setAttribute('role', 'tab');
    button.id = `cover-${key}-tab-${index}`;
    panels[index].id = `cover-${key}-panel-${index}`;
    panels[index].setAttribute('role', 'tabpanel');
    panels[index].setAttribute('aria-labelledby', button.id);
    button.setAttribute('aria-controls', panels[index].id);
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
      select(next); buttons[next].focus();
    });
    buttons.push(button); tabs.append(button);
  });
  for (const group of opts.gallery ?? []) {
    const section = document.createElement('section');
    const heading = document.createElement('h3'); heading.textContent = group.label;
    const grid = document.createElement('div'); grid.className = 'blok-cover-gallery__grid';
    for (const item of group.items) {
      const url = safeImageSrc(item.url);
      if (url === null) continue;
      const option = document.createElement('button'); option.type = 'button';
      option.setAttribute('aria-label', item.label); option.title = item.label;
      const image = document.createElement('img'); image.src = url; image.alt = ''; image.loading = 'lazy';
      option.append(image); option.addEventListener('click', () => opts.onUrl(item.url)); grid.append(option);
    }
    section.append(heading, grid); gallery.append(section);
  }
  element.append(tabs, ...panels);
  select(0);
  return {element, setError: (message) => {upload.setError(message); link.setError(message);},
    settle: () => Promise.resolve(), destroy: () => {upload.destroy(); link.destroy();}};
}

export function openCoverPicker(opts: OpenCoverPickerOptions): CoverPickerHandle {
  const dialog = document.createElement('div');
  dialog.className = 'blok-audio-cover-picker';
  dialog.setAttribute('data-role', 'audio-cover-picker');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', tr(opts.i18n, 'tools.audio.coverSet', 'Set cover image'));

  const kind = opts.surface ?? 'card';
  const surface = kind === 'ink-well' ? inkWellSurface(opts)
    : opts.gallery?.length ? gallerySurface(opts) : cardSurface(opts);

  dialog.setAttribute('data-surface', kind);
  dialog.appendChild(surface.element);

  // The element that owns the picker's ARIA state and regains focus on close.
  const trigger = opts.trigger ?? opts.anchor;

  // Fallback focus target for when the trigger's block was torn down
  // mid-session (an isConnected guard covers that on close).
  const previouslyFocused = document.activeElement;

  const state = { detached: false };
  // Anchored positioning via the shared engine: prefers the space below the
  // anchor, flips above when the viewport bottom would clip the picker, and
  // clamps horizontally. Coordinates are document-relative → absolute.
  const reposition = (): void => {
    if (!state.detached) {
      positionAnchored(dialog, opts.anchor, { side: 'bottom', offset: 8 });
    }
  };

  // A database row opens it too, before the media sheet may be in. Unstyled it
  // would flash at full size, so it stays invisible and unfocused until then.
  const styled = isSheetLoaded('media');

  if (!styled) {
    dialog.style.visibility = 'hidden';
  }

  document.body.appendChild(dialog);
  // The anchor mirrors with the editor, so a flip re-places the picker.
  syncPortalDirection(dialog, { source: opts.anchor, onResync: reposition });
  promoteToTopLayer(dialog);
  dialog.style.position = 'absolute';
  reposition();

  // The picker is an anchored, non-modal dialog, so it advertises its open state
  // on the trigger button (mirrors the alt-text popover) rather than inert-ing
  // the page.
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'true');

  // Pull focus into the picker so keyboard + screen-reader users land inside it.
  const enter = (): void => getTabbables(dialog)[0]?.focus();

  if (styled) {
    enter();
  } else {
    void loadSheet('media').then(() => {
      if (state.detached) {
        return;
      }
      dialog.style.removeProperty('visibility');
      reposition();
      enter();
    });
  }

  // Keep the picker glued to the anchor across scroll / resize / own-size
  // changes (shared autoUpdate-style tracker).
  const tracker = createPositionTracker(dialog, reposition);
  tracker.attach();

  const detach = (): void => {
    if (state.detached) return;
    state.detached = true;
    document.removeEventListener('keydown', onKeyDown, true);
    tracker.detach();
    unregisterLayer();
    surface.destroy();
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
    settle: () => surface.settle(),
  };
}

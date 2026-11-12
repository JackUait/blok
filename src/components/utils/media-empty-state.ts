import type { MediaSource } from '../../../types/tools/media-source';
import { DATA_ATTR } from '../constants/data-attributes';
import { IconArrowUp, IconCross, IconLink } from '../icons';
import { formatBytes } from './format-bytes';
import { setFieldValidity } from './field-validity';
import { matchesMime } from './mime-match';
import { EXIT_CLEAR_MS, makePreview, springHome, type MediaPreviewKind } from './media-empty-preview';
import { leanPreview } from './media-preview-3d';
import { createUrlMirror } from './url-mirror';

/**
 * Shared "empty" uploader surface for the media block tools (image, video,
 * audio, file) and the cover picker: one surface with a drawing, a title, a
 * sentence and two actions. "From a link" swaps the buttons for a URL field in
 * the same place. Tools supply their own labels and accepted types; this
 * module owns the markup, styling hooks (`blok-media-empty*`) and drag/paste
 * handling.
 */

export interface MediaEmptyStateLabels {
  /** Title, e.g. "Add an image" / "Add a file". Also names the surface. */
  add: string;
  /** Sentence under the title when both upload and link are offered. */
  hint: string;
  /** Sentence for an upload-only block. Falls back to `hint`. */
  hintUpload?: string;
  /** Sentence for a link-only block. Falls back to `hint`. */
  hintLink?: string;
  /** Sentence shown while a file is dragged over the block. */
  dropAnywhere: string;
  /** Name of the button that closes the link field. */
  cancelLink: string;
  /** Button that opens the link field, e.g. "From a link". */
  embed: string;
  /** Primary "Choose file" button. */
  chooseFile: string;
  /** Title shown while a file is dragged over the block. */
  dropToUpload: string;
  /** URL field placeholder. */
  urlPlaceholder: string;
  /** URL field aria-label. */
  urlAria: string;
  /** Button that adds the link. */
  submit: string;
  /** Optional formatter for the size limit shown after the sentence. */
  maxSize?: (size: string) => string;
}

export interface MediaEmptyStateOptions {
  /** Accepted MIME types — drives the file picker. */
  acceptTypes: string[];
  /** Max file size in bytes — shown after the sentence when set. */
  maxSize?: number;
  labels: MediaEmptyStateLabels;
  onFile(file: File): void;
  onUrl(url: string): void;
  /**
   * Which insert sources to expose:
   * - `'both'` (default): the Choose button and "From a link".
   * - `'upload'`: file upload only — no link button, no URL field.
   * - `'url'`: link only — the URL field is shown at once; no file picker and
   *   no drag/paste-to-upload.
   */
  sources?: MediaSource;
  /** Drawing of the finished block. Omit it for compact surfaces (the cover picker). */
  preview?: MediaPreviewKind;
}

/** Re-exported from the public type so the renderer and tools share one source. */
export type { MediaSource };
export type { MediaPreviewKind };

export interface MediaEmptyStateElement extends HTMLElement {
  setError(message: string | null): void;
}

type Mode = 'upload' | 'link';

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('button, a, input, textarea, select, [role="button"]') !== null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isLink(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return /^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(value);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(className: string, action: string, icon: string, label: string): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.setAttribute('data-action', action);
  const glyph = el('span', `${className}-icon`);
  glyph.setAttribute('aria-hidden', 'true');
  glyph.innerHTML = icon;
  button.append(glyph, el('span', `${className}-label`, label));
  return button;
}

interface LinkField {
  bar: HTMLElement;
  input: HTMLInputElement;
  cancel: HTMLButtonElement | null;
  clear(): void;
}

function makeLinkField(
  labels: MediaEmptyStateLabels,
  withCancel: boolean,
  hooks: { onCommit(url: string): void; onEdit(valid: boolean, pasted: boolean): void; onCancel(): void }
): LinkField {
  const bar = el('div', 'blok-media-empty__embed-bar');
  bar.setAttribute('data-valid', 'false');
  bar.setAttribute('data-blok-field', 'text');

  const icon = el('span', 'blok-media-empty__embed-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconLink;

  const input = el('input', 'blok-media-empty__embed-input');
  input.type = 'url';
  input.placeholder = labels.urlPlaceholder;
  input.setAttribute('aria-label', labels.urlAria);
  input.autocomplete = 'off';
  input.spellcheck = false;

  const mirror = createUrlMirror(input);

  const submit = el('button', 'blok-media-empty__embed-submit');
  submit.type = 'button';
  submit.setAttribute('data-action', 'submit-url');
  const kbd = el('kbd', 'blok-media-empty__embed-kbd', '↵');
  kbd.setAttribute('aria-hidden', 'true');
  submit.append(el('span', 'blok-media-empty__embed-submit-label', labels.submit), kbd);

  const cancel = withCancel ? el('button', 'blok-media-empty__embed-cancel') : null;
  if (cancel) {
    cancel.type = 'button';
    cancel.setAttribute('data-action', 'cancel-link');
    cancel.setAttribute('aria-label', labels.cancelLink);
    cancel.innerHTML = IconCross;
    cancel.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hooks.onCancel();
    });
  }

  const sync = (pasted = false): void => {
    const valid = isLink(input.value);
    bar.setAttribute('data-valid', valid ? 'true' : 'false');
    submit.setAttribute('aria-disabled', valid ? 'false' : 'true');
    // Add is not drawn until the link is valid, so it must not take focus either.
    submit.tabIndex = valid ? 0 : -1;
    mirror.draw();
    hooks.onEdit(valid, pasted);
  };
  const commit = (): void => {
    if (isLink(input.value)) hooks.onCommit(input.value.trim());
  };

  submit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    commit();
  });
  input.addEventListener('input', (ev) => {
    sync(ev instanceof InputEvent && ev.inputType === 'insertFromPaste');
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    }
    if (ev.key === 'Escape' && cancel) {
      ev.preventDefault();
      ev.stopPropagation();
      hooks.onCancel();
    }
  });

  bar.append(icon, mirror.element, input, submit, ...(cancel ? [cancel] : []));
  sync();

  return {
    bar,
    input,
    cancel,
    clear: () => {
      input.value = '';
      sync();
    },
  };
}

/** Pointer tilt, hover demo and spring exit for the drawing; the surface is the pointer target. */
function animateDrawing(surface: HTMLElement, stage: HTMLElement): void {
  const pointer = { x: 0, y: 0, frame: 0 };
  const lean = (mx: string, my: string): void => {
    stage.style.setProperty('--mx', mx);
    stage.style.setProperty('--my', my);
    leanPreview(stage, Number(mx), Number(my));
  };
  const axis = (pos: number, start: number, size: number): string =>
    String(Math.round(Math.min(1, Math.max(-1, ((pos - start) / size) * 2 - 1)) * 1000) / 1000);

  surface.addEventListener('pointermove', (ev) => {
    if (prefersReducedMotion()) return;
    pointer.x = ev.clientX;
    pointer.y = ev.clientY;
    if (pointer.frame) return;
    pointer.frame = requestAnimationFrame(() => {
      pointer.frame = 0;
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      lean(axis(pointer.x, rect.left, rect.width), axis(pointer.y, rect.top, rect.height));
    });
  });
  const exit = { timer: 0, stop: (): void => undefined };

  surface.addEventListener('pointerenter', () => {
    window.clearTimeout(exit.timer);
    exit.stop();
    stage.removeAttribute('data-leaving');
    stage.setAttribute('data-hover', '');
  });
  surface.addEventListener('pointerleave', () => {
    if (pointer.frame) cancelAnimationFrame(pointer.frame);
    pointer.frame = 0;
    if (prefersReducedMotion()) {
      stage.removeAttribute('data-hover');
      lean('0', '0');
      return;
    }
    // springHome must switch on data-leaving before the lean resets, or the
    // tilt starts its way back on the plain curve instead of the spring.
    exit.stop = springHome(stage);
    lean('0', '0');
    exit.timer = window.setTimeout(() => stage.removeAttribute('data-leaving'), EXIT_CLEAR_MS);
  });
}

export function renderMediaEmptyState(opts: MediaEmptyStateOptions): MediaEmptyStateElement {
  const { labels } = opts;
  const types = opts.acceptTypes;
  const source: MediaSource = opts.sources ?? 'both';
  const showUpload = source !== 'url';
  const showLink = source !== 'upload';
  const both = showUpload && showLink;
  const restHint = both ? labels.hint : (showUpload ? labels.hintUpload : labels.hintLink) ?? labels.hint;

  const root = document.createElement('div') as unknown as MediaEmptyStateElement;
  root.className = 'blok-media-empty';
  root.setAttribute('data-blok-media-empty-state', '');

  const card = el('div', 'blok-media-empty__card');
  card.tabIndex = 0;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', labels.add);
  card.setAttribute('data-sources', source);
  if (opts.preview) card.setAttribute('data-preview', opts.preview);

  const stage = opts.preview ? makePreview(opts.preview) : null;
  stage?.addEventListener('animationend', (ev) => {
    if (ev.target === stage) stage.classList.remove('is-caught');
  });

  const title = el('div', 'blok-media-empty__title', labels.add);
  const hint = el('div', 'blok-media-empty__hint');
  const hintText = el('span', 'blok-media-empty__hint-text', restHint);
  const meta = showUpload && opts.maxSize !== undefined && labels.maxSize
    ? el('span', 'blok-media-empty__meta', labels.maxSize(formatBytes(opts.maxSize)))
    : null;
  hint.append(hintText, ...(meta ? [meta] : []));

  const error = el('div', 'blok-media-empty__error');
  error.id = `blok-media-empty-error-${uid()}`;
  error.setAttribute('data-role', 'error');
  error.setAttribute('role', 'alert');
  error.hidden = true;

  const input = showUpload ? document.createElement('input') : null;
  if (input) {
    input.type = 'file';
    input.accept = types.length ? types.join(',') : '*';
    input.hidden = true;
    input.setAttribute('data-blok-testid', 'file-input');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) opts.onFile(file);
    });
  }

  const actions = showUpload ? el('div', 'blok-media-empty__actions') : null;
  const choose = iconButton('blok-media-empty__choose', 'choose-file', IconArrowUp, labels.chooseFile);
  const fromLink = iconButton('blok-media-empty__from-link', 'from-link', IconLink, labels.embed);
  actions?.append(choose, ...(both ? [fromLink] : []));

  const setMode = (mode: Mode): void => {
    card.setAttribute('data-mode', mode);
    actions?.toggleAttribute('inert', mode !== 'upload');
    link?.bar.toggleAttribute('inert', mode !== 'link');
  };
  const clearError = (): void => {
    error.hidden = true;
    error.textContent = '';
    if (link) setFieldValidity(link.input, true, error.id);
  };

  const link = showLink
    ? makeLinkField(labels, both, {
      onCommit: (url) => opts.onUrl(url),
      onEdit: (valid, pasted) => {
        // Editing after a rejected link clears the stale error.
        if (!error.hidden) clearError();
        if (!stage || !pasted || !valid) return;
        // A pasted valid link gets the same "catch" as a dropped file.
        stage.classList.remove('is-caught');
        stage.offsetWidth;
        stage.classList.add('is-caught');
      },
      onCancel: () => {
        link?.clear();
        setMode('upload');
        fromLink.focus();
      },
    })
    : null;

  choose.addEventListener('click', (ev) => {
    ev.stopPropagation();
    input?.click();
  });
  fromLink.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setMode('link');
    link?.input.focus();
  });

  const slot = el('div', 'blok-media-empty__slot');
  // Without this Blok treats Enter on a button as "split the block" and the button never fires.
  slot.setAttribute(DATA_ATTR.keyboardOwner, '');
  slot.append(...(actions ? [actions] : []), ...(link ? [link.bar] : []));

  const body = el('div', 'blok-media-empty__body');
  body.append(title, hint, slot);
  card.append(...(stage ? [stage] : []), body, ...(input ? [input] : []));
  root.append(card, error);

  if (stage) animateDrawing(card, stage);

  if (input) {
    const isUploadMode = (): boolean => card.getAttribute('data-mode') === 'upload';
    const setDragover = (on: boolean): void => {
      card.classList.toggle('is-dragover', on);
      title.textContent = on ? labels.dropToUpload : labels.add;
      hintText.textContent = on ? labels.dropAnywhere : restHint;
      if (meta) meta.hidden = on;
    };

    card.addEventListener('click', (ev) => {
      if (isUploadMode() && !isInteractive(ev.target)) input.click();
    });
    card.addEventListener('keydown', (ev) => {
      if (ev.target !== card || !isUploadMode()) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        input.click();
      }
    });
    card.addEventListener('paste', (ev) => {
      if (!isUploadMode()) return;
      const clip = ev.clipboardData;
      if (!clip) return;
      for (const item of Array.from(clip.items)) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file && (!types.length || matchesMime(file.type, types))) {
          ev.preventDefault();
          opts.onFile(file);
          return;
        }
      }
    });

    const drag = { depth: 0 };
    card.addEventListener('dragenter', (ev) => {
      if (!ev.dataTransfer?.types.includes('Files')) return;
      ev.preventDefault();
      drag.depth += 1;
      setDragover(true);
    });
    card.addEventListener('dragover', (ev) => {
      const dt = ev.dataTransfer;
      if (!dt?.types.includes('Files')) return;
      ev.preventDefault();
      dt.dropEffect = 'copy';
    });
    card.addEventListener('dragleave', () => {
      drag.depth = Math.max(0, drag.depth - 1);
      if (drag.depth === 0) setDragover(false);
    });
    card.addEventListener('drop', (ev) => {
      ev.preventDefault();
      drag.depth = 0;
      setDragover(false);
      const file = ev.dataTransfer?.files?.[0];
      if (file) opts.onFile(file);
    });
  }

  setMode(showUpload ? 'upload' : 'link');
  // A link-only block has nothing else to do: put the caret in its field.
  if (!showUpload) queueMicrotask(() => link?.input.focus());

  root.setError = (message: string | null): void => {
    if (!message) {
      clearError();
      return;
    }
    error.hidden = false;
    error.textContent = message;
    // Mark the URL field with the shared invalid state so the error is announced and linked.
    if (link) setFieldValidity(link.input, false, error.id);
  };

  return root;
}

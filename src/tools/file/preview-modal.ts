import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import { safePreviewSrc } from './url';

/** Time budget for the close animation before forcing teardown (ms). */
const CLOSE_ANIMATION_FALLBACK_MS = 260;

function readAnimationName(el: Element): string {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    return window.getComputedStyle(el).animationName || '';
  } catch {
    return '';
  }
}

/** jsdom has no animation engine; skip the wait there so closes stay synchronous. */
function supportsAnimations(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return !/jsdom/i.test(navigator.userAgent);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

export interface FilePreviewOptions {
  url: string;
  fileName?: string;
  labels: { close: string };
}

interface PreviewElements {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  closeButton: HTMLButtonElement;
}

function buildBody(url: string, fileName: string | undefined, fallbackTitle: string): HTMLElement {
  const body = document.createElement('div');
  body.className = 'blok-file-preview-body';

  const src = safePreviewSrc(url);
  if (src === null) {
    const error = document.createElement('div');
    error.className = 'blok-file-preview-error';
    error.setAttribute('data-role', 'file-preview-error');
    body.appendChild(error);

    return body;
  }

  const frame = document.createElement('iframe');
  frame.className = 'blok-file-preview-frame';
  frame.setAttribute('data-role', 'file-preview-frame');
  frame.setAttribute('title', fileName ?? fallbackTitle);
  frame.src = src;
  body.appendChild(frame);

  return body;
}

function buildElements(opts: FilePreviewOptions): PreviewElements {
  const label = opts.fileName ?? opts.labels.close;

  const backdrop = document.createElement('div');
  backdrop.className = 'blok-file-preview-backdrop';
  backdrop.setAttribute('data-role', 'file-preview-backdrop');

  const dialog = document.createElement('div');
  dialog.className = 'blok-file-preview';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', label);

  const header = document.createElement('div');
  header.className = 'blok-file-preview-header';

  const title = document.createElement('span');
  title.className = 'blok-file-preview-title';
  if (opts.fileName) {
    title.textContent = opts.fileName;
  }

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'blok-file-preview-close';
  closeButton.setAttribute('data-action', 'close-preview');
  closeButton.setAttribute('aria-label', opts.labels.close);

  header.append(title, closeButton);

  const body = buildBody(opts.url, opts.fileName, opts.labels.close);

  dialog.append(header, body);
  backdrop.appendChild(dialog);

  return { backdrop, dialog, closeButton };
}

export function openFilePreview(opts: FilePreviewOptions): () => void {
  const previouslyFocused = document.activeElement;
  const { backdrop, dialog, closeButton } = buildElements(opts);

  // Remember the caller's inline overflow so scroll lock restores it exactly.
  const previousBodyOverflow = document.body.style.overflow;
  const state = { closed: false };

  // Immediate teardown — used for the close animation's end and for the
  // programmatic teardown the host calls when the block is removed/re-rendered.
  const finalize = (): void => {
    if (state.closed) {
      return;
    }
    state.closed = true;
    document.removeEventListener('keydown', onKeyDown);
    document.body.style.overflow = previousBodyOverflow;
    if (backdrop.parentNode) {
      removeFromTopLayer(backdrop);
      backdrop.parentNode.removeChild(backdrop);
    }
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
  };

  // User-initiated close — plays the exit animation, then finalizes. Falls back
  // to an immediate finalize when motion is reduced or unsupported (jsdom).
  const closeAnimated = (): void => {
    if (state.closed) {
      return;
    }
    backdrop.setAttribute('data-blok-closing', 'true');

    if (prefersReducedMotion() || !supportsAnimations()) {
      finalize();

      return;
    }

    const animationName = readAnimationName(dialog);
    if (animationName === '' || animationName === 'none') {
      finalize();

      return;
    }

    const settle = { done: false, fallback: 0 };
    const onAnimationEnd = (event: AnimationEvent): void => {
      if (event.target !== dialog) {
        return;
      }
      finishClose();
    };
    const finishClose = (): void => {
      if (settle.done) {
        return;
      }
      settle.done = true;
      dialog.removeEventListener('animationend', onAnimationEnd);
      if (settle.fallback !== 0) {
        window.clearTimeout(settle.fallback);
      }
      finalize();
    };

    dialog.addEventListener('animationend', onAnimationEnd);
    settle.fallback = window.setTimeout(finishClose, CLOSE_ANIMATION_FALLBACK_MS);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      closeAnimated();
    }
  };

  backdrop.addEventListener('click', (event) => {
    if (!dialog.contains(event.target instanceof Node ? event.target : null)) {
      closeAnimated();
    }
  });
  closeButton.addEventListener('click', () => closeAnimated());
  document.addEventListener('keydown', onKeyDown);

  document.body.appendChild(backdrop);
  // Lock page scroll so the content behind the modal stays put.
  document.body.style.overflow = 'hidden';
  // Promote into the CSS Top Layer so the modal renders above all editor and
  // host-page content, and so the `[data-blok-top-layer]` marker lets the
  // scoped design tokens (tint, radius, spacing) resolve on a body-mounted node.
  promoteToTopLayer(backdrop);
  closeButton.focus();

  return finalize;
}

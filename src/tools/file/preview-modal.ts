import { safePreviewSrc } from './url';

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

  const teardown = (): void => {
    document.removeEventListener('keydown', onKeyDown);
    if (backdrop.parentNode) {
      backdrop.parentNode.removeChild(backdrop);
    }
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      teardown();
    }
  };

  backdrop.addEventListener('click', (event) => {
    if (!dialog.contains(event.target instanceof Node ? event.target : null)) {
      teardown();
    }
  });
  closeButton.addEventListener('click', () => teardown());
  document.addEventListener('keydown', onKeyDown);

  document.body.appendChild(backdrop);
  closeButton.focus();

  return teardown;
}

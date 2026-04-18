import { DEFAULT_MIME_TYPES } from './constants';

export interface EmptyStateOptions {
  onFile(file: File): void;
  onUrl(url: string): void;
  acceptTypes?: string[];
  uploadLabel?: string;
  embedLabel?: string;
  embedPlaceholder?: string;
  submitLabel?: string;
}

export interface EmptyStateElement extends HTMLElement {
  setError(message: string | null): void;
}

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const accept = (opts.acceptTypes ?? [...DEFAULT_MIME_TYPES]).join(',');

  const root = document.createElement('div') as unknown as EmptyStateElement;
  root.setAttribute('data-blok-image-empty-state', '');
  root.style.padding = '12px';
  root.style.border = '1px dashed var(--blok-border-primary, #d4d4d8)';
  root.style.borderRadius = '6px';

  const tabs = document.createElement('div');
  tabs.setAttribute('role', 'tablist');
  tabs.style.display = 'flex';
  tabs.style.gap = '8px';
  tabs.style.marginBottom = '8px';

  const uploadTab = document.createElement('button');
  uploadTab.type = 'button';
  uploadTab.setAttribute('data-tab', 'upload');
  uploadTab.textContent = opts.uploadLabel ?? 'Upload';

  const embedTab = document.createElement('button');
  embedTab.type = 'button';
  embedTab.setAttribute('data-tab', 'embed');
  embedTab.textContent = opts.embedLabel ?? 'Embed link';

  tabs.append(uploadTab, embedTab);

  const panel = document.createElement('div');

  const error = document.createElement('div');
  error.setAttribute('data-role', 'error');
  error.style.color = 'var(--blok-color-danger, #dc2626)';
  error.style.fontSize = '0.85rem';
  error.style.marginTop = '6px';
  error.style.display = 'none';

  const renderUploadPanel = (): void => {
    panel.replaceChildren();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) opts.onFile(file);
    });
    panel.appendChild(input);
  };

  const renderEmbedPanel = (): void => {
    panel.replaceChildren();
    const input = document.createElement('input');
    input.type = 'url';
    input.placeholder = opts.embedPlaceholder ?? 'Paste image URL';
    input.style.marginRight = '8px';
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.setAttribute('data-action', 'submit-url');
    submit.textContent = opts.submitLabel ?? 'Embed image';
    submit.addEventListener('click', () => {
      const value = input.value.trim();
      if (value) opts.onUrl(value);
    });
    panel.append(input, submit);
  };

  uploadTab.addEventListener('click', renderUploadPanel);
  embedTab.addEventListener('click', renderEmbedPanel);

  root.append(tabs, panel, error);
  renderUploadPanel();

  root.setError = (message: string | null): void => {
    if (!message) {
      error.style.display = 'none';
      error.textContent = '';
      return;
    }
    error.style.display = 'block';
    error.textContent = message;
  };

  return root;
}

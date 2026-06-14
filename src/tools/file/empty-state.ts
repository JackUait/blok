import { IconFile } from '../../components/icons';

export interface EmptyStateLabels {
  upload: string;
  link: string;
  chooseFile: string;
  dropHint: string;
  urlPlaceholder: string;
  urlAria: string;
  insert: string;
}

export interface EmptyStateOptions {
  accept: string;
  labels: EmptyStateLabels;
  onFile(file: File): void;
  onUrl(url: string): void;
}

export interface EmptyStateElement extends HTMLElement {
  setError(message: string | null): void;
}

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const root = document.createElement('div') as EmptyStateElement;
  root.className = 'blok-file-empty';

  const tabs = document.createElement('div');
  tabs.className = 'blok-file-tabs';
  const uploadTab = makeTab('upload', opts.labels.upload, true);
  const linkTab = makeTab('link', opts.labels.link, false);
  tabs.append(uploadTab, linkTab);

  const uploadPanel = document.createElement('div');
  uploadPanel.className = 'blok-file-panel';
  uploadPanel.setAttribute('data-panel', 'upload');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = opts.accept;
  input.hidden = true;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) {
      opts.onFile(file);
    }
  });

  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'blok-file-choose';
  choose.setAttribute('data-action', 'choose-file');
  choose.innerHTML = `${IconFile}<span>${opts.labels.chooseFile}</span>`;
  choose.addEventListener('click', (ev) => {
    ev.stopPropagation();
    input.click();
  });

  const hint = document.createElement('span');
  hint.className = 'blok-file-hint';
  hint.textContent = opts.labels.dropHint;

  uploadPanel.append(input, choose, hint);

  const linkPanel = document.createElement('div');
  linkPanel.className = 'blok-file-panel';
  linkPanel.setAttribute('data-panel', 'link');
  linkPanel.hidden = true;

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'blok-file-url';
  urlInput.placeholder = opts.labels.urlPlaceholder;
  urlInput.setAttribute('aria-label', opts.labels.urlAria);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'blok-file-submit';
  submit.setAttribute('data-action', 'submit-url');
  submit.textContent = opts.labels.insert;

  const submitUrl = (): void => {
    const value = urlInput.value.trim();
    if (value) {
      opts.onUrl(value);
    }
  };
  submit.addEventListener('click', (ev) => {
    ev.stopPropagation();
    submitUrl();
  });
  urlInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      submitUrl();
    }
  });

  linkPanel.append(urlInput, submit);

  const error = document.createElement('div');
  error.className = 'blok-file-error';
  error.hidden = true;

  const activate = (which: 'upload' | 'link'): void => {
    const isUpload = which === 'upload';
    uploadTab.classList.toggle('is-active', isUpload);
    linkTab.classList.toggle('is-active', !isUpload);
    uploadPanel.hidden = !isUpload;
    linkPanel.hidden = isUpload;
  };
  uploadTab.addEventListener('click', () => activate('upload'));
  linkTab.addEventListener('click', () => activate('link'));

  root.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    root.classList.add('is-dragover');
  });
  root.addEventListener('dragleave', () => root.classList.remove('is-dragover'));
  root.addEventListener('drop', (ev: DragEvent) => {
    ev.preventDefault();
    root.classList.remove('is-dragover');
    const file = ev.dataTransfer?.files?.[0];
    if (file) {
      opts.onFile(file);
    }
  });

  root.setError = (message: string | null): void => {
    error.hidden = message === null;
    error.textContent = message ?? '';
  };

  root.append(tabs, uploadPanel, linkPanel, error);
  return root;
}

function makeTab(name: 'upload' | 'link', label: string, active: boolean): HTMLButtonElement {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'blok-file-tab';
  tab.setAttribute('data-tab', name);
  tab.textContent = label;
  if (active) {
    tab.classList.add('is-active');
  }
  return tab;
}

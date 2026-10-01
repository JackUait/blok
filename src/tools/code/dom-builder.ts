import {
  WRAPPER_STYLES,
  HEADER_STYLES,
  LANGUAGE_BUTTON_STYLES,
  LANGUAGE_LABEL_STYLES,
  HEADER_CONTROLS_STYLES,
  HEADER_BUTTON_STYLES,
  HEADER_BUTTON_MATCHED_STYLES,
  CODE_AREA_STYLES,
  PREVIEW_AREA_STYLES,
  CODE_BODY_STYLES,
  GUTTER_STYLES,
  GUTTER_LINE_STYLES,
  VIEW_MODE_CONTAINER_STYLES,
  VIEW_MODE_BUTTON_STYLES,
  VIEW_MODE_BUTTON_ACTIVE_STYLES,
  SPLIT_CONTAINER_STYLES,
  SPLIT_HALF_STYLES,
  LANGUAGE_DOT_STYLES,
  FILENAME_BUTTON_STYLES,
  FILENAME_LABEL_STYLES,
  ACTIVE_LINE_STYLES,
  LANGUAGE_DOT_FALLBACK,
  COPY_LABEL_STYLES,
} from './constants';
import type { CodeViewMode } from './constants';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconCopy, IconCode, IconPreview, IconSplitView, IconChevronDown } from '../../components/icons';

export interface CodeDOMRefs {
  wrapper: HTMLElement;
  languageButton: HTMLButtonElement;
  languageChevron: HTMLElement;
  languageDot: HTMLElement;
  filenameElement: HTMLElement;
  copyButton: HTMLButtonElement;
  copyLabel: HTMLElement;
  activeLine: HTMLElement | null;
  previewLayer: HTMLElement | null;
  preElement: HTMLPreElement;
  codeElement: HTMLElement;
  gutterElement: HTMLElement;
  viewModeContainer: HTMLElement | null;
  previewElement: HTMLDivElement | null;
  splitContainer: HTMLElement | null;
}

export interface ViewModeLabels {
  code: string;
  preview: string;
  split: string;
}

export interface BuildCodeDOMOptions {
  code: string;
  languageName: string;
  languageColor?: string;
  filename?: string;
  filenamePlaceholder?: string;
  readOnly: boolean;
  copyLabel: string;
  previewable?: boolean;
  viewModeLabels?: ViewModeLabels;
}

interface ViewModeElements {
  viewModeContainer: HTMLElement;
  previewElement: HTMLDivElement;
  splitContainer: HTMLElement;
}

function buildViewModeElements(
  labels: ViewModeLabels,
): ViewModeElements {
  // Segmented control container
  const viewModeContainer = document.createElement('div');

  viewModeContainer.className = VIEW_MODE_CONTAINER_STYLES;
  viewModeContainer.setAttribute('role', 'group');
  viewModeContainer.setAttribute('data-blok-testid', 'code-view-mode');

  const modes: Array<{ mode: CodeViewMode; icon: string; label: string }> = [
    { mode: 'code', icon: IconCode, label: labels.code },
    { mode: 'preview', icon: IconPreview, label: labels.preview },
    { mode: 'split', icon: IconSplitView, label: labels.split },
  ];

  for (const { mode, icon, label } of modes) {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = VIEW_MODE_BUTTON_STYLES;
    button.innerHTML = icon;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('data-blok-testid', `code-mode-${mode}`);
    button.setAttribute('data-mode', mode);
    viewModeContainer.appendChild(button);
  }

  // Preview container
  const previewElement = document.createElement('div');

  previewElement.className = PREVIEW_AREA_STYLES;
  previewElement.setAttribute('data-blok-testid', 'code-preview');
  // Rendered from the code, not typed: an empty block's error text must not make it non-empty.
  previewElement.setAttribute(DATA_ATTR.chrome, '');

  // Split container — wraps code body + preview
  const splitContainer = document.createElement('div');

  splitContainer.className = SPLIT_CONTAINER_STYLES;
  splitContainer.setAttribute('data-blok-testid', 'code-split-container');

  return { viewModeContainer, previewElement, splitContainer };
}

/**
 * Set the active view mode button styling and aria-pressed state.
 */
export function setActiveViewMode(viewModeContainer: HTMLElement, mode: CodeViewMode): void {
  const buttons = Array.from(viewModeContainer.querySelectorAll<HTMLButtonElement>('[data-mode]'));

  for (const btn of buttons) {
    const isActive = btn.getAttribute('data-mode') === mode;

    btn.setAttribute('aria-pressed', String(isActive));
    btn.className = isActive ? VIEW_MODE_BUTTON_ACTIVE_STYLES : VIEW_MODE_BUTTON_STYLES;
  }
}

function buildActiveLine(): HTMLElement {
  const activeLine = document.createElement('div');

  activeLine.className = ACTIVE_LINE_STYLES;
  activeLine.hidden = true;
  activeLine.setAttribute('aria-hidden', 'true');
  activeLine.setAttribute(DATA_ATTR.chrome, '');
  // Moves on every caret step; must never count as an edit.
  activeLine.setAttribute(DATA_ATTR.mutationFree, 'true');
  activeLine.setAttribute('data-blok-testid', 'code-active-line');

  return activeLine;
}

/**
 * Show a filename, or the placeholder when there is none. Read-only hides an
 * empty filename instead, since there is nothing to add.
 */
export function setFilenameDisplay(element: HTMLElement, filename: string, placeholder: string, readOnly: boolean): void {
  const isEmpty = filename === '';

  Object.assign(element, {
    textContent: isEmpty && !readOnly ? placeholder : filename,
    hidden: readOnly && isEmpty,
    className: readOnly ? FILENAME_LABEL_STYLES : FILENAME_BUTTON_STYLES,
  });
  element.setAttribute('data-empty', String(isEmpty));
  if (readOnly && isEmpty) {
    element.setAttribute('aria-hidden', 'true');
  } else {
    element.removeAttribute('aria-hidden');
  }

  if (element instanceof HTMLButtonElement) {
    element.setAttribute('type', 'button');
    element.setAttribute('aria-label', isEmpty ? placeholder : `${placeholder}: ${filename}`);
  }
}

export function buildCodeDOM(options: BuildCodeDOMOptions): CodeDOMRefs {
  const { code, languageName, languageColor = LANGUAGE_DOT_FALLBACK, filename = '', filenamePlaceholder = '', readOnly, copyLabel, previewable, viewModeLabels } = options;

  // Wrapper
  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_STYLES;
  wrapper.setAttribute(DATA_ATTR.tool, 'code');

  // Header
  const header = document.createElement('div');
  header.className = HEADER_STYLES;
  header.setAttribute(DATA_ATTR.chrome, '');

  // Language button (opens language picker) — includes text + chevron icon
  const languageButton = document.createElement('button');
  languageButton.type = 'button';
  languageButton.className = readOnly ? LANGUAGE_LABEL_STYLES : LANGUAGE_BUTTON_STYLES;
  languageButton.setAttribute('data-blok-testid', 'code-language-btn');

  // Read-only has no picker to open — the button is a plain label there
  if (readOnly) {
    languageButton.tabIndex = -1;
  } else {
    languageButton.setAttribute('aria-haspopup', 'listbox');
    languageButton.setAttribute('aria-expanded', 'false');
  }

  const languageDot = document.createElement('span');
  languageDot.className = LANGUAGE_DOT_STYLES;
  languageDot.style.backgroundColor = languageColor;
  languageDot.setAttribute('aria-hidden', 'true');
  languageDot.setAttribute('data-blok-testid', 'code-language-dot');
  languageButton.appendChild(languageDot);

  const langText = document.createElement('span');
  langText.textContent = languageName;
  langText.className = 'truncate';
  langText.setAttribute('data-blok-testid', 'code-language-name');
  languageButton.appendChild(langText);

  const chevronSpan = document.createElement('span');
  chevronSpan.className = 'inline-flex items-center ms-0.5 -me-0.5';
  chevronSpan.innerHTML = IconChevronDown;
  chevronSpan.setAttribute('data-blok-testid', 'code-language-chevron');
  chevronSpan.hidden = readOnly;
  languageButton.appendChild(chevronSpan);

  // Filename fills the space between language and controls. In edit mode it is
  // a button that swaps to an <input> only while editing: a resident input would
  // become the block's first input and take the caret from the code. The swap
  // happens in a mutation-free slot so opening the field is not an edit; the
  // tool reports a real rename itself. A div, not a span, so the header never
  // reads as inline text.
  const filenameSlot = document.createElement('div');
  filenameSlot.className = 'flex flex-1 min-w-0 overflow-hidden';
  filenameSlot.setAttribute(DATA_ATTR.mutationFree, 'true');

  const filenameElement = document.createElement(readOnly ? 'span' : 'button');
  filenameElement.setAttribute('data-blok-testid', 'code-filename');
  setFilenameDisplay(filenameElement, filename, filenamePlaceholder, readOnly);
  filenameSlot.appendChild(filenameElement);

  // View mode segmented control — always built in edit mode, hidden for non-previewable languages
  const viewModeResult = !readOnly && viewModeLabels
    ? buildViewModeElements(viewModeLabels)
    : null;

  const viewModeContainer = viewModeResult?.viewModeContainer ?? null;
  const previewElement = viewModeResult?.previewElement ?? null;
  const splitContainer = viewModeResult?.splitContainer ?? null;

  if (viewModeContainer) {
    viewModeContainer.hidden = !previewable;
  }

  if (previewElement) {
    previewElement.hidden = !previewable;
  }

  // Copy button
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = previewable ? HEADER_BUTTON_MATCHED_STYLES : HEADER_BUTTON_STYLES;
  copyButton.innerHTML = IconCopy;
  copyButton.setAttribute('aria-label', copyLabel);
  copyButton.setAttribute('data-blok-testid', 'code-copy-btn');

  const copyLabelElement = document.createElement('span');
  copyLabelElement.className = COPY_LABEL_STYLES;
  copyLabelElement.textContent = copyLabel;
  copyLabelElement.setAttribute('data-blok-testid', 'code-copy-label');
  copyButton.appendChild(copyLabelElement);

  // Code area
  const codeElement = document.createElement('code');
  codeElement.className = CODE_AREA_STYLES;
  codeElement.setAttribute('data-blok-testid', 'code-content');

  if (code) {
    codeElement.textContent = code;
  }

  if (!readOnly) {
    codeElement.setAttribute('contenteditable', 'plaintext-only');
    codeElement.setAttribute('spellcheck', 'false');
  }

  // Line number gutter
  const gutterElement = document.createElement('div');
  gutterElement.className = GUTTER_STYLES;
  gutterElement.setAttribute('aria-hidden', 'true');
  gutterElement.setAttribute(DATA_ATTR.chrome, '');
  gutterElement.setAttribute(DATA_ATTR.mutationFree, 'true');
  gutterElement.setAttribute('data-blok-testid', 'code-gutter');

  const lineCount = code ? code.split('\n').length : 1;
  Array.from({ length: lineCount }, (_, idx) => {
    const lineEl = document.createElement('div');
    lineEl.className = GUTTER_LINE_STYLES;
    lineEl.textContent = String(idx + 1);
    lineEl.setAttribute('data-line-index', String(idx));
    gutterElement.appendChild(lineEl);
  });

  // Assemble header: [language] [filename] [controls: view mode? | copy]
  header.appendChild(languageButton);
  header.appendChild(filenameSlot);

  // Controls container — hidden by default, visible on wrapper hover
  const controls = document.createElement('div');
  controls.className = HEADER_CONTROLS_STYLES;
  controls.setAttribute('data-blok-testid', 'code-controls');

  if (viewModeContainer) {
    controls.appendChild(viewModeContainer);
  }

  controls.appendChild(copyButton);

  header.appendChild(controls);

  // Pre wrapper for semantic HTML — flex-1 so it fills code body width,
  // so clicks on the right empty strip of a short line still land on the
  // editable code element and the browser snaps caret to end of that line.
  const preElement = document.createElement('pre');
  preElement.className = 'relative flex-1 min-w-0';
  preElement.appendChild(codeElement);

  // Hover preview of another language, laid over the code with the same box
  // and type so every glyph lands where the real one is. The editable code is
  // never touched; the layer is mutation-free, so previews are never edits.
  const previewLayer = readOnly ? null : document.createElement('code');

  if (previewLayer) {
    previewLayer.className = `${CODE_AREA_STYLES} absolute inset-0 pointer-events-none bg-code-bg`;
    previewLayer.hidden = true;
    previewLayer.setAttribute('aria-hidden', 'true');
    previewLayer.setAttribute(DATA_ATTR.chrome, '');
    previewLayer.setAttribute(DATA_ATTR.mutationFree, 'true');
    previewLayer.setAttribute('data-blok-testid', 'code-language-preview');
    preElement.appendChild(previewLayer);
  }

  // Code body container (flex: gutter + pre)
  const codeBody = document.createElement('div');
  codeBody.className = CODE_BODY_STYLES;
  // Source code reads LTR in any editor direction; the gutter stays on its left.
  codeBody.setAttribute('dir', 'ltr');

  const activeLine = readOnly ? null : buildActiveLine();

  if (activeLine) {
    codeBody.appendChild(activeLine);
  }

  codeBody.appendChild(gutterElement);
  codeBody.appendChild(preElement);

  // Assemble wrapper
  wrapper.appendChild(header);

  if (splitContainer && previewElement) {
    // Edit mode: always wrap code body + preview in split container.
    // previewElement is hidden initially; shown when a previewable language is active.
    const codeHalf = document.createElement('div');
    codeHalf.className = SPLIT_HALF_STYLES;
    codeHalf.appendChild(codeBody);

    const previewHalf = document.createElement('div');
    previewHalf.className = SPLIT_HALF_STYLES;
    previewHalf.appendChild(previewElement);

    splitContainer.appendChild(codeHalf);
    splitContainer.appendChild(previewHalf);
    wrapper.appendChild(splitContainer);
  } else {
    wrapper.appendChild(codeBody);
  }

  return { wrapper, languageButton, languageChevron: chevronSpan, languageDot, filenameElement, copyButton, copyLabel: copyLabelElement, activeLine, previewLayer, preElement, codeElement, gutterElement, viewModeContainer, previewElement, splitContainer };
}

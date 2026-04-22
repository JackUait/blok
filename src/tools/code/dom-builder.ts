import {
  WRAPPER_STYLES,
  HEADER_STYLES,
  LANGUAGE_BUTTON_STYLES,
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
  VIEW_MODE_PREVIEW_BUTTON_STYLES,
  VIEW_MODE_PREVIEW_BUTTON_ACTIVE_STYLES,
  SPLIT_CONTAINER_STYLES,
  SPLIT_HALF_STYLES,
} from './constants';
import type { CodeViewMode } from './constants';
import { IconCopy, IconCode, IconPreview, IconSplitView, IconChevronDown } from '../../components/icons';

export interface CodeDOMRefs {
  wrapper: HTMLElement;
  languageButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
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
    const isPreview = mode === 'preview';

    button.type = 'button';
    button.className = isPreview ? VIEW_MODE_PREVIEW_BUTTON_STYLES : VIEW_MODE_BUTTON_STYLES;
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
    const isPreview = btn.getAttribute('data-mode') === 'preview';

    btn.setAttribute('aria-pressed', String(isActive));

    if (isPreview) {
      btn.className = isActive ? VIEW_MODE_PREVIEW_BUTTON_ACTIVE_STYLES : VIEW_MODE_PREVIEW_BUTTON_STYLES;
    } else {
      btn.className = isActive ? VIEW_MODE_BUTTON_ACTIVE_STYLES : VIEW_MODE_BUTTON_STYLES;
    }
  }
}

export function buildCodeDOM(options: BuildCodeDOMOptions): CodeDOMRefs {
  const { code, languageName, readOnly, copyLabel, previewable, viewModeLabels } = options;

  // Wrapper
  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_STYLES;

  // Header
  const header = document.createElement('div');
  header.className = HEADER_STYLES;

  // Language button (opens language picker) — includes text + chevron icon
  const languageButton = document.createElement('button');
  languageButton.type = 'button';
  languageButton.className = LANGUAGE_BUTTON_STYLES;
  languageButton.setAttribute('aria-haspopup', 'listbox');
  languageButton.setAttribute('data-blok-testid', 'code-language-btn');

  const langText = document.createElement('span');
  langText.textContent = languageName;
  languageButton.appendChild(langText);

  const chevronSpan = document.createElement('span');
  chevronSpan.className = 'inline-flex items-center ml-0.5 -mr-0.5';
  chevronSpan.innerHTML = IconChevronDown;
  languageButton.appendChild(chevronSpan);

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'flex-1';

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

  // Copy button
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = previewable ? HEADER_BUTTON_MATCHED_STYLES : HEADER_BUTTON_STYLES;
  copyButton.innerHTML = IconCopy;
  copyButton.setAttribute('aria-label', copyLabel);
  copyButton.setAttribute('data-blok-testid', 'code-copy-btn');

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
  gutterElement.setAttribute('data-blok-testid', 'code-gutter');

  const lineCount = code ? code.split('\n').length : 1;
  Array.from({ length: lineCount }, (_, idx) => {
    const lineEl = document.createElement('div');
    lineEl.className = GUTTER_LINE_STYLES;
    lineEl.textContent = String(idx + 1);
    lineEl.setAttribute('data-line-index', String(idx));
    gutterElement.appendChild(lineEl);
  });

  // Assemble header: [language] [spacer] [controls: view mode? | copy]
  header.appendChild(languageButton);
  header.appendChild(spacer);

  // Controls container — hidden by default, visible on wrapper hover
  const controls = document.createElement('div');
  controls.className = HEADER_CONTROLS_STYLES;

  if (viewModeContainer) {
    controls.appendChild(viewModeContainer);
  }

  controls.appendChild(copyButton);

  header.appendChild(controls);

  // Pre wrapper for semantic HTML — flex-1 so it fills code body width,
  // so clicks on the right empty strip of a short line still land on the
  // editable code element and the browser snaps caret to end of that line.
  const preElement = document.createElement('pre');
  preElement.className = 'flex-1 min-w-0';
  preElement.appendChild(codeElement);

  // Code body container (flex: gutter + pre)
  const codeBody = document.createElement('div');
  codeBody.className = CODE_BODY_STYLES;
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

  return { wrapper, languageButton, copyButton, preElement, codeElement, gutterElement, viewModeContainer, previewElement, splitContainer };
}

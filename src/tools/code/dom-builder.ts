import {
  WRAPPER_STYLES,
  HEADER_STYLES,
  LANGUAGE_BUTTON_STYLES,
  HEADER_CONTROLS_STYLES,
  HEADER_BUTTON_STYLES,
  CODE_AREA_STYLES,
  PREVIEW_AREA_STYLES,
  CODE_BODY_STYLES,
  GUTTER_STYLES,
  GUTTER_LINE_STYLES,
} from './constants';
import { IconCopy, IconCode, IconChevronDown } from '../../components/icons';

export interface CodeDOMRefs {
  wrapper: HTMLElement;
  languageButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  preElement: HTMLPreElement;
  codeElement: HTMLElement;
  gutterElement: HTMLElement;
  previewToggleButton: HTMLButtonElement | null;
  previewElement: HTMLDivElement | null;
}

export interface BuildCodeDOMOptions {
  code: string;
  languageName: string;
  readOnly: boolean;
  copyLabel: string;
  previewable?: boolean;
  previewToggleLabel?: string;
}

function buildPreviewElements(
  previewToggleLabel?: string,
): { previewToggleButton: HTMLButtonElement; previewElement: HTMLDivElement } {
  const previewToggleButton = document.createElement('button');

  previewToggleButton.type = 'button';
  previewToggleButton.className = HEADER_BUTTON_STYLES;
  previewToggleButton.innerHTML = IconCode;
  previewToggleButton.setAttribute('aria-label', previewToggleLabel ?? 'Preview');
  previewToggleButton.setAttribute('data-blok-testid', 'code-preview-toggle-btn');

  const previewElement = document.createElement('div');

  previewElement.className = PREVIEW_AREA_STYLES;
  previewElement.setAttribute('data-blok-testid', 'code-preview');

  return { previewToggleButton, previewElement };
}

export function buildCodeDOM(options: BuildCodeDOMOptions): CodeDOMRefs {
  const { code, languageName, readOnly, copyLabel, previewable, previewToggleLabel } = options;

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

  // Preview toggle button (only when previewable and not read-only)
  const { previewToggleButton, previewElement } = previewable
    ? buildPreviewElements(previewToggleLabel)
    : { previewToggleButton: null, previewElement: null };

  // Copy button
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = HEADER_BUTTON_STYLES;
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
    gutterElement.appendChild(lineEl);
  });

  // Assemble header: [language] [spacer] [controls: preview toggle? | copy | more]
  header.appendChild(languageButton);
  header.appendChild(spacer);

  // Controls container — hidden by default, visible on wrapper hover
  const controls = document.createElement('div');
  controls.className = HEADER_CONTROLS_STYLES;

  if (previewToggleButton) {
    controls.appendChild(previewToggleButton);
  }

  controls.appendChild(copyButton);

  header.appendChild(controls);

  // Pre wrapper for semantic HTML
  const preElement = document.createElement('pre');
  preElement.appendChild(codeElement);

  // Code body container (flex: gutter + pre)
  const codeBody = document.createElement('div');
  codeBody.className = CODE_BODY_STYLES;
  codeBody.appendChild(gutterElement);
  codeBody.appendChild(preElement);

  // Assemble wrapper
  wrapper.appendChild(header);
  wrapper.appendChild(codeBody);

  if (previewElement) {
    wrapper.appendChild(previewElement);
  }

  return { wrapper, languageButton, copyButton, preElement, codeElement, gutterElement, previewToggleButton, previewElement };
}

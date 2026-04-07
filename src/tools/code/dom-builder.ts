import {
  WRAPPER_STYLES,
  HEADER_STYLES,
  LANGUAGE_BUTTON_STYLES,
  HEADER_BUTTON_STYLES,
  CODE_AREA_STYLES,
  PREVIEW_AREA_STYLES,
  CODE_BODY_STYLES,
  GUTTER_STYLES,
  GUTTER_LINE_STYLES,
  MORE_MENU_STYLES,
  MORE_MENU_ITEM_STYLES,
} from './constants';
import { IconCopy, IconCode, IconChevronDown, IconEllipsis, IconWrap, IconLineNumbers } from '../../components/icons';

export interface CodeDOMRefs {
  wrapper: HTMLElement;
  languageButton: HTMLButtonElement;
  lineNumbersButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  wrapButton: HTMLButtonElement;
  preElement: HTMLPreElement;
  codeElement: HTMLElement;
  gutterElement: HTMLElement;
  previewToggleButton: HTMLButtonElement | null;
  previewElement: HTMLDivElement | null;
  moreButton: HTMLButtonElement;
  moreMenu: HTMLElement;
}

export interface BuildCodeDOMOptions {
  code: string;
  languageName: string;
  readOnly: boolean;
  copyLabel: string;
  wrapLabel: string;
  lineNumbersLabel?: string;
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
  const { code, languageName, readOnly, copyLabel, wrapLabel, lineNumbersLabel, previewable, previewToggleLabel } = options;

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

  // More button (ellipsis)
  const moreButton = document.createElement('button');
  moreButton.type = 'button';
  moreButton.className = HEADER_BUTTON_STYLES;
  moreButton.innerHTML = IconEllipsis;
  moreButton.setAttribute('aria-label', 'More');
  moreButton.setAttribute('aria-haspopup', 'true');
  moreButton.setAttribute('data-blok-testid', 'code-more-btn');

  // More menu dropdown
  const moreMenu = document.createElement('div');
  moreMenu.className = MORE_MENU_STYLES;
  moreMenu.hidden = true;
  moreMenu.setAttribute('data-blok-testid', 'code-more-menu');

  // Line numbers toggle (inside more menu)
  const lineNumbersButton = document.createElement('button');
  lineNumbersButton.type = 'button';
  lineNumbersButton.className = MORE_MENU_ITEM_STYLES;
  lineNumbersButton.setAttribute('data-blok-testid', 'code-line-numbers-btn');

  const lineNumIconSpan = document.createElement('span');
  lineNumIconSpan.className = 'flex items-center justify-center w-5 h-5';
  lineNumIconSpan.innerHTML = IconLineNumbers;
  lineNumbersButton.appendChild(lineNumIconSpan);

  const lineNumText = document.createElement('span');
  lineNumText.textContent = lineNumbersLabel ?? 'Line numbers';
  lineNumbersButton.appendChild(lineNumText);

  // Wrap toggle (inside more menu)
  const wrapButton = document.createElement('button');
  wrapButton.type = 'button';
  wrapButton.className = MORE_MENU_ITEM_STYLES;
  wrapButton.setAttribute('data-blok-testid', 'code-wrap-btn');

  const wrapIconSpan = document.createElement('span');
  wrapIconSpan.className = 'flex items-center justify-center w-5 h-5';
  wrapIconSpan.innerHTML = IconWrap;
  wrapButton.appendChild(wrapIconSpan);

  const wrapText = document.createElement('span');
  wrapText.textContent = wrapLabel;
  wrapButton.appendChild(wrapText);

  moreMenu.appendChild(lineNumbersButton);
  moreMenu.appendChild(wrapButton);

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

  // Assemble header: [language] [spacer] [preview toggle?] [copy] [more ▸ menu]
  header.appendChild(languageButton);
  header.appendChild(spacer);

  if (previewToggleButton) {
    header.appendChild(previewToggleButton);
  }

  header.appendChild(copyButton);

  // More wrapper (relative position anchor for absolute dropdown)
  const moreWrapper = document.createElement('div');
  moreWrapper.className = 'relative';
  moreWrapper.appendChild(moreButton);
  moreWrapper.appendChild(moreMenu);
  header.appendChild(moreWrapper);

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

  return { wrapper, languageButton, lineNumbersButton, copyButton, wrapButton, preElement, codeElement, gutterElement, previewToggleButton, previewElement, moreButton, moreMenu };
}

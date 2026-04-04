import {
  WRAPPER_STYLES,
  HEADER_STYLES,
  LANGUAGE_BUTTON_STYLES,
  HEADER_BUTTON_STYLES,
  CODE_AREA_STYLES,
} from './constants';
import { IconCopy, IconWrap } from '../../components/icons';

export interface CodeDOMRefs {
  wrapper: HTMLElement;
  languageButton: HTMLSpanElement;
  copyButton: HTMLButtonElement;
  wrapButton: HTMLButtonElement;
  preElement: HTMLPreElement;
  codeElement: HTMLElement;
}

export interface BuildCodeDOMOptions {
  code: string;
  languageName: string;
  readOnly: boolean;
  copyLabel: string;
  wrapLabel: string;
}

export function buildCodeDOM(options: BuildCodeDOMOptions): CodeDOMRefs {
  const { code, languageName, readOnly, copyLabel, wrapLabel } = options;

  // Wrapper
  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_STYLES;

  // Header
  const header = document.createElement('div');
  header.className = HEADER_STYLES;

  // Language label
  const languageButton = document.createElement('span');
  languageButton.className = LANGUAGE_BUTTON_STYLES;
  languageButton.textContent = languageName;
  languageButton.setAttribute('data-blok-testid', 'code-language-btn');

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'flex-1';

  // Wrap toggle button
  const wrapButton = document.createElement('button');
  wrapButton.type = 'button';
  wrapButton.className = HEADER_BUTTON_STYLES;
  wrapButton.innerHTML = IconWrap;
  wrapButton.setAttribute('aria-label', wrapLabel);
  wrapButton.setAttribute('data-blok-testid', 'code-wrap-btn');

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
    codeElement.setAttribute('contenteditable', 'true');
    codeElement.setAttribute('spellcheck', 'false');
  }

  // Assemble
  header.appendChild(languageButton);
  header.appendChild(spacer);
  header.appendChild(wrapButton);
  header.appendChild(copyButton);

  // Pre wrapper for semantic HTML
  const preElement = document.createElement('pre');

  preElement.appendChild(codeElement);

  // Assemble wrapper
  wrapper.appendChild(header);
  wrapper.appendChild(preElement);

  return { wrapper, languageButton, copyButton, wrapButton, preElement, codeElement };
}

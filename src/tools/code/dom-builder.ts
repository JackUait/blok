import {
  WRAPPER_STYLES,
  HEADER_STYLES,
  LANGUAGE_BUTTON_STYLES,
  HEADER_BUTTON_STYLES,
  CODE_AREA_STYLES,
  TAB_STYLES,
  TAB_ACTIVE_STYLES,
  TAB_INACTIVE_STYLES,
  PREVIEW_AREA_STYLES,
} from './constants';
import { IconCopy, IconWrap } from '../../components/icons';

export interface CodeDOMRefs {
  wrapper: HTMLElement;
  languageButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  wrapButton: HTMLButtonElement;
  preElement: HTMLPreElement;
  codeElement: HTMLElement;
  codeTab: HTMLButtonElement | null;
  previewTab: HTMLButtonElement | null;
  previewElement: HTMLDivElement | null;
}

export interface BuildCodeDOMOptions {
  code: string;
  languageName: string;
  readOnly: boolean;
  copyLabel: string;
  wrapLabel: string;
  previewable?: boolean;
  codeTabLabel?: string;
  previewTabLabel?: string;
}

function buildPreviewElements(
  codeTabLabel?: string,
  previewTabLabel?: string,
): { codeTab: HTMLButtonElement; previewTab: HTMLButtonElement; previewElement: HTMLDivElement } {
  const codeTab = document.createElement('button');

  codeTab.type = 'button';
  codeTab.className = `${TAB_STYLES} ${TAB_INACTIVE_STYLES}`;
  codeTab.textContent = codeTabLabel ?? 'Code';
  codeTab.setAttribute('data-blok-testid', 'code-code-tab');

  const previewTab = document.createElement('button');

  previewTab.type = 'button';
  previewTab.className = `${TAB_STYLES} ${TAB_ACTIVE_STYLES}`;
  previewTab.textContent = previewTabLabel ?? 'Preview';
  previewTab.setAttribute('data-blok-testid', 'code-preview-tab');

  const previewElement = document.createElement('div');

  previewElement.className = PREVIEW_AREA_STYLES;
  previewElement.setAttribute('data-blok-testid', 'code-preview');

  return { codeTab, previewTab, previewElement };
}

export function buildCodeDOM(options: BuildCodeDOMOptions): CodeDOMRefs {
  const { code, languageName, readOnly, copyLabel, wrapLabel, previewable, codeTabLabel, previewTabLabel } = options;

  // Wrapper
  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_STYLES;

  // Header
  const header = document.createElement('div');
  header.className = HEADER_STYLES;

  // Language button (opens language picker)
  const languageButton = document.createElement('button');
  languageButton.type = 'button';
  languageButton.className = LANGUAGE_BUTTON_STYLES;
  languageButton.textContent = languageName;
  languageButton.setAttribute('aria-haspopup', 'listbox');
  languageButton.setAttribute('data-blok-testid', 'code-language-btn');

  // Spacer
  const spacer = document.createElement('div');
  spacer.className = 'flex-1';

  // Tab buttons (only when previewable)
  const { codeTab, previewTab, previewElement } = previewable
    ? buildPreviewElements(codeTabLabel, previewTabLabel)
    : { codeTab: null, previewTab: null, previewElement: null };

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

  // Assemble header
  header.appendChild(languageButton);
  header.appendChild(spacer);

  if (codeTab && previewTab) {
    header.appendChild(codeTab);
    header.appendChild(previewTab);
  }

  header.appendChild(wrapButton);
  header.appendChild(copyButton);

  // Pre wrapper for semantic HTML
  const preElement = document.createElement('pre');
  preElement.appendChild(codeElement);

  // Assemble wrapper
  wrapper.appendChild(header);
  wrapper.appendChild(preElement);

  if (previewElement) {
    wrapper.appendChild(previewElement);
  }

  return { wrapper, languageButton, copyButton, wrapButton, preElement, codeElement, codeTab, previewTab, previewElement };
}

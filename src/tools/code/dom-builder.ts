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
  previewElement: HTMLElement | null;
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

interface TabElements {
  tabBar: HTMLElement;
  codeTab: HTMLButtonElement;
  previewTab: HTMLButtonElement;
  previewElement: HTMLElement;
}

function buildTabElements(codeTabLabel: string | undefined, previewTabLabel: string | undefined): TabElements {
  const tabBar = document.createElement('div');
  tabBar.className = 'flex gap-1 px-2 pt-1.5';

  const codeTab = document.createElement('button');
  codeTab.type = 'button';
  codeTab.textContent = codeTabLabel ?? 'Code';
  codeTab.className = `${TAB_STYLES} ${TAB_INACTIVE_STYLES}`;
  codeTab.setAttribute('data-blok-testid', 'code-code-tab');

  const previewTab = document.createElement('button');
  previewTab.type = 'button';
  previewTab.textContent = previewTabLabel ?? 'Preview';
  previewTab.className = `${TAB_STYLES} ${TAB_ACTIVE_STYLES}`;
  previewTab.setAttribute('data-blok-testid', 'code-preview-tab');

  tabBar.appendChild(codeTab);
  tabBar.appendChild(previewTab);

  const previewElement = document.createElement('div');
  previewElement.className = PREVIEW_AREA_STYLES;
  previewElement.setAttribute('data-blok-testid', 'code-preview');
  previewElement.hidden = false;

  return { tabBar, codeTab, previewTab, previewElement };
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

  // Tabs and preview area (only for previewable languages in edit mode)
  const tabs = previewable ? buildTabElements(codeTabLabel, previewTabLabel) : null;

  // Assemble wrapper: header, optional tab bar, code (pre), optional preview
  wrapper.appendChild(header);

  if (tabs) {
    wrapper.appendChild(tabs.tabBar);
  }

  wrapper.appendChild(preElement);

  if (tabs) {
    wrapper.appendChild(tabs.previewElement);
  }

  return {
    wrapper,
    languageButton,
    copyButton,
    wrapButton,
    preElement,
    codeElement,
    codeTab: tabs?.codeTab ?? null,
    previewTab: tabs?.previewTab ?? null,
    previewElement: tabs?.previewElement ?? null,
  };
}

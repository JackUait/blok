// src/tools/callout/dom-builder.ts

import { TOGGLE_ATTR } from '../toggle/constants';
import {
  WRAPPER_STYLES,
  HEADER_STYLES,
  EMOJI_BUTTON_STYLES,
  TEXT_STYLES,
  CHILDREN_STYLES,
} from './constants';

export interface CalloutDOMRefs {
  wrapper: HTMLElement;
  emojiButton: HTMLButtonElement;
  textElement: HTMLElement;
  childContainer: HTMLElement;
}

export interface BuildCalloutDOMOptions {
  emoji: string;
  text: string;
  readOnly: boolean;
  placeholder: string;
  addEmojiLabel: string;
}

export function buildCalloutDOM(options: BuildCalloutDOMOptions): CalloutDOMRefs {
  const { emoji, text, readOnly, placeholder, addEmojiLabel } = options;

  // Wrapper
  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_STYLES;

  // Header row
  const header = document.createElement('div');
  header.className = HEADER_STYLES;

  // Emoji button
  const emojiButton = document.createElement('button');
  emojiButton.type = 'button';
  emojiButton.className = EMOJI_BUTTON_STYLES;
  emojiButton.textContent = emoji || '';
  emojiButton.setAttribute('aria-label', emoji !== '' ? emoji : addEmojiLabel);
  emojiButton.setAttribute('tabindex', '0');

  if (readOnly) {
    emojiButton.disabled = true;
  }

  // Text content element
  const textElement = document.createElement('div');
  textElement.className = TEXT_STYLES;
  textElement.contentEditable = readOnly ? 'false' : 'true';
  textElement.setAttribute('contenteditable', readOnly ? 'false' : 'true');
  textElement.innerHTML = text;

  if (!text && placeholder) {
    textElement.setAttribute('data-placeholder', placeholder);
  }

  header.appendChild(emojiButton);
  header.appendChild(textElement);
  wrapper.appendChild(header);

  // Children container
  const childContainer = document.createElement('div');
  childContainer.className = CHILDREN_STYLES;
  childContainer.setAttribute(TOGGLE_ATTR.toggleChildren, '');
  childContainer.setAttribute('data-blok-mutation-free', 'true');
  wrapper.appendChild(childContainer);

  return { wrapper, emojiButton, textElement, childContainer };
}

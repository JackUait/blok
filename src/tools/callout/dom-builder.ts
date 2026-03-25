// src/tools/callout/dom-builder.ts

import { TOGGLE_ATTR } from '../toggle/constants';
import {
  WRAPPER_STYLES,
  EMOJI_BUTTON_STYLES,
  CHILDREN_STYLES,
} from './constants';

export interface CalloutDOMRefs {
  wrapper: HTMLElement;
  emojiButton: HTMLButtonElement;
  childContainer: HTMLElement;
}

export interface BuildCalloutDOMOptions {
  emoji: string;
  readOnly: boolean;
  addEmojiLabel: string;
}

export function buildCalloutDOM(options: BuildCalloutDOMOptions): CalloutDOMRefs {
  const { emoji, readOnly, addEmojiLabel } = options;

  // Wrapper — flex row: emoji | children
  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_STYLES;

  // Emoji button
  const emojiButton = document.createElement('button');
  emojiButton.type = 'button';
  emojiButton.className = EMOJI_BUTTON_STYLES;
  emojiButton.textContent = emoji || '';
  emojiButton.setAttribute('aria-label', emoji !== '' ? emoji : addEmojiLabel);
  emojiButton.setAttribute('tabindex', '0');
  emojiButton.setAttribute('data-blok-testid', 'callout-emoji-btn');

  if (readOnly) {
    emojiButton.disabled = true;
  }

  // Children container — holds all block children
  const childContainer = document.createElement('div');
  childContainer.className = CHILDREN_STYLES;
  childContainer.setAttribute(TOGGLE_ATTR.toggleChildren, '');
  childContainer.setAttribute('data-blok-mutation-free', 'true');

  wrapper.appendChild(emojiButton);
  wrapper.appendChild(childContainer);

  return { wrapper, emojiButton, childContainer };
}

// src/tools/callout/dom-builder.ts

import { DATA_ATTR } from '../../components/constants/data-attributes';
import { TOGGLE_ATTR } from '../toggle/constants';
import {
  WRAPPER_STYLES,
  EMOJI_BUTTON_STYLES,
  EMOJI_FACE_STYLES,
  CHILDREN_STYLES,
} from './constants';

export interface CalloutDOMRefs {
  wrapper: HTMLElement;
  emojiButton: HTMLButtonElement;
  emojiFace: HTMLElement;
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
  wrapper.setAttribute(DATA_ATTR.tool, 'callout');

  // Emoji button — the emoji itself lives in an inner "face" span so the swap
  // animation can move it independently of the button (and of the knock-out ghost)
  const emojiButton = document.createElement('button');
  emojiButton.type = 'button';
  emojiButton.className = EMOJI_BUTTON_STYLES;

  const emojiFace = document.createElement('span');
  emojiFace.className = EMOJI_FACE_STYLES;
  emojiFace.textContent = emoji || '';
  emojiFace.setAttribute('data-blok-testid', 'callout-emoji-face');
  emojiButton.appendChild(emojiFace);

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
  childContainer.setAttribute(DATA_ATTR.nestedBlocks, '');
  childContainer.setAttribute('data-blok-child-toolbar', '');
  childContainer.setAttribute('data-blok-mutation-free', 'true');

  wrapper.appendChild(emojiButton);
  wrapper.appendChild(childContainer);

  return { wrapper, emojiButton, emojiFace, childContainer };
}

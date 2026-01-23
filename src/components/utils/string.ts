/**
 * String manipulation utilities
 */

import { getUserOS } from './browser';

/**
 * Capitalizes first letter of the string
 */
export const capitalize = (text: string): string => {
  if (!text) {
    return text;
  }

  return text.slice(0, 1).toUpperCase() + text.slice(1);
};

/**
 * Make shortcut command more human-readable
 * @param shortcut — string like 'CMD+B'
 */
export const beautifyShortcut = (shortcut: string): string => {
  const OS = getUserOS();
  const normalizedShortcut = shortcut
    .replace(/shift/gi, '⇧')
    .replace(/backspace/gi, '⌫')
    .replace(/enter/gi, '⏎')
    .replace(/up/gi, '↑')
    .replace(/left/gi, '→')
    .replace(/down/gi, '↓')
    .replace(/right/gi, '←')
    .replace(/escape/gi, '⎋')
    .replace(/insert/gi, 'Ins')
    .replace(/delete/gi, '␡')
    .replace(/\+/gi, ' + ');

  if (OS.mac) {
    return normalizedShortcut.replace(/ctrl|cmd/gi, '⌘').replace(/alt/gi, '⌥');
  }

  return normalizedShortcut.replace(/cmd/gi, 'Ctrl').replace(/windows/gi, 'WIN');
};

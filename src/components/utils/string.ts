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
    .replace(/delete/gi, 'Del')
    .replace(/\+/gi, ' + ');

  /**
   * When a shortcut combines CTRL and CMD, CTRL means the literal Control key
   * (not a cross-platform alias for Command), and CMD maps to the platform
   * meta key (⌘ on mac, Win elsewhere).
   */
  if (/ctrl/i.test(shortcut) && /cmd/i.test(shortcut)) {
    if (OS.mac) {
      return normalizedShortcut.replace(/ctrl/gi, '⌃').replace(/cmd/gi, '⌘').replace(/alt/gi, '⌥');
    }

    return normalizedShortcut.replace(/ctrl/gi, 'Ctrl').replace(/cmd/gi, 'Win').replace(/windows/gi, 'WIN');
  }

  if (OS.mac) {
    return normalizedShortcut.replace(/ctrl|cmd/gi, '⌘').replace(/alt/gi, '⌥');
  }

  return normalizedShortcut.replace(/cmd/gi, 'Ctrl').replace(/windows/gi, 'WIN');
};

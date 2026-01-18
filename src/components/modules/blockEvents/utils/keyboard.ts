import { KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP, PRINTABLE_SPECIAL_KEYS } from '../constants';

/**
 * Convert KeyboardEvent.key or code to the legacy numeric keyCode
 * @param event - keyboard event
 */
export const keyCodeFromEvent = (event: KeyboardEvent): number | null => {
  const keyFromEvent = event.key && KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP[event.key];

  if (keyFromEvent !== undefined && typeof keyFromEvent === 'number') {
    return keyFromEvent;
  }

  const codeFromEvent = event.code && KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP[event.code];

  if (codeFromEvent !== undefined && typeof codeFromEvent === 'number') {
    return codeFromEvent;
  }

  return null;
}

/**
 * Detect whether KeyDown should be treated as printable input
 * @param event - keyboard event
 */
export const isPrintableKeyEvent = (event: KeyboardEvent): boolean => {
  if (!event.key) {
    return false;
  }

  return event.key.length === 1 || PRINTABLE_SPECIAL_KEYS.has(event.key);
}

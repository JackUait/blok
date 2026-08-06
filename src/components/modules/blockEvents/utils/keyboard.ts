import { DATA_ATTR } from '../../../constants';
import { KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP, PRINTABLE_SPECIAL_KEYS } from '../constants';

/**
 * True when a keyboard event originated inside a subtree a Tool claimed with
 * `data-blok-keyboard-owner` — the declarative "this field owns its keyboard"
 * opt-out. Callers must stand their handling down entirely for such an event.
 * @param target - the event target to test (`event.target`)
 */
export const isInsideKeyboardOwner = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest(`[${DATA_ATTR.keyboardOwner}]`) !== null;
};

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

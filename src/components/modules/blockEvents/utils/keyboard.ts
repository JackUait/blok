import { DATA_ATTR } from '../../../constants';
import { getElementDirection, logicalArrow } from '../../../utils/direction';
import { EDITABLE_INPUT_SELECTOR, KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP, PRINTABLE_SPECIAL_KEYS } from '../constants';

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

const editableOf = (node: Node | null | undefined): Element | null => {
  const element = node instanceof Element ? node : node?.parentElement;

  return element?.closest(EDITABLE_INPUT_SELECTOR) ?? null;
};

/**
 * Reading-order meaning of a horizontal arrow, or null for any other key.
 *
 * Direction comes from the editable that holds the caret, so a block whose
 * text runs the other way than the editor still moves by its own direction.
 * The selection anchor goes first: while blocks are selected, focus can stay
 * in a block that is not the one the selection started in.
 * @param event - keydown event
 * @param fallback - element to read when no editable is found (the editor wrapper)
 */
export const horizontalArrowIntent = (
  event: KeyboardEvent,
  fallback: Element | null | undefined
): 'forward' | 'backward' | null => {
  const key = [event.key, event.code].find((name) => name === 'ArrowLeft' || name === 'ArrowRight');

  if (key === undefined) {
    return null;
  }

  const target = event.target instanceof Node ? event.target : null;
  const source = editableOf(window.getSelection()?.anchorNode) ?? editableOf(target) ?? fallback;

  return logicalArrow(key, getElementDirection(source));
};

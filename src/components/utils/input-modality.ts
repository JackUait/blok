/**
 * How the user last drove the interface.
 */
type InputModality = 'keyboard' | 'pointer';

/**
 * Blok paints its own focus cursor (`data-blok-focused`) on popover items.
 * Those items are never really focused — the cursor is an attribute — so the
 * browser's `:focus-visible` cannot gate it, and without this signal a menu
 * opened with the mouse lights up its first row like a keyboard cursor.
 *
 * Keyboard is the starting value so a surface opened before any user gesture
 * (a programmatic `open()`, a test) still exposes the cursor.
 */
const state: { modality: InputModality } = { modality: 'keyboard' };

/**
 * Mirrors the modality onto the document so CSS can see it.
 *
 * `:focus-visible` alone cannot: Blink keeps a document-level focus-visible
 * flag that a keypress sets and only a focus-MOVING click clears, and Blok's
 * controls preventDefault their mousedown to keep the caret — so the flag
 * survives the click and the ring stays. A `<select>` matches `:focus-visible`
 * on a plain click too. This attribute is what `preflight.css` gates on.
 * @param modality - the gesture just recorded
 */
const publish = (modality: InputModality): void => {
  state.modality = modality;

  if (typeof document !== 'undefined' && document.documentElement !== null) {
    document.documentElement.setAttribute('data-blok-modality', modality);
  }
};

const rememberKeyboard = (): void => {
  publish('keyboard');
};

const rememberPointer = (): void => {
  publish('pointer');
};

/**
 * Capture phase: a handler that calls stopPropagation must not blind the
 * tracker. Installed at import so the very first gesture is already recorded —
 * a lazy install would run after the pointerdown that opened the first menu.
 *
 * `window` as well as `document`, and this is load-bearing. `Flipper.activate()`
 * listens on both in capture and calls `stopImmediatePropagation()` for every
 * key it owns, and capture runs window before document — so a document-only
 * tracker goes blind to arrows and Enter for as long as a popover is open. Blind
 * means a menu opened by mouse never returns to keyboard modality, which left
 * the colour picker unreachable by keyboard. Installing at import wins the
 * capture order against every later `activate()`.
 */
if (typeof document !== 'undefined') {
  publish(state.modality);
  window.addEventListener('keydown', rememberKeyboard, true);
  window.addEventListener('pointerdown', rememberPointer, true);
  document.addEventListener('keydown', rememberKeyboard, true);
  document.addEventListener('pointerdown', rememberPointer, true);
}

/**
 * Whether the last user gesture came from the keyboard.
 * @returns true when a focus cursor or focus ring should be shown.
 */
export function isKeyboardModality(): boolean {
  return state.modality === 'keyboard';
}

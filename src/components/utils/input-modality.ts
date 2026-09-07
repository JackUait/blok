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

const rememberKeyboard = (): void => {
  state.modality = 'keyboard';
};

const rememberPointer = (): void => {
  state.modality = 'pointer';
};

/**
 * Capture phase: a handler that calls stopPropagation must not blind the
 * tracker. Installed at import so the very first gesture is already recorded —
 * a lazy install would run after the pointerdown that opened the first menu.
 */
if (typeof document !== 'undefined') {
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

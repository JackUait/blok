/**
 * Constants used across the Blok editor
 */

/**
 * Returns basic key codes as constants
 */
export const keyCodes = {
  BACKSPACE: 8,
  TAB: 9,
  ENTER: 13,
  SHIFT: 16,
  CTRL: 17,
  ALT: 18,
  ESC: 27,
  SPACE: 32,
  LEFT: 37,
  UP: 38,
  DOWN: 40,
  RIGHT: 39,
  DELETE: 46,
  // Number keys range (0-9)
  NUMBER_KEY_MIN: 47,
  NUMBER_KEY_MAX: 58,
  // Letter keys range (A-Z)
  LETTER_KEY_MIN: 64,
  LETTER_KEY_MAX: 91,
  META: 91,
  // Numpad keys range
  NUMPAD_KEY_MIN: 95,
  NUMPAD_KEY_MAX: 112,
  // Punctuation keys range (;=,-./`)
  PUNCTUATION_KEY_MIN: 185,
  PUNCTUATION_KEY_MAX: 193,
  // Bracket keys range ([\]')
  BRACKET_KEY_MIN: 218,
  BRACKET_KEY_MAX: 223,
  // Processing key input for certain languages (Chinese, Japanese, etc.)
  PROCESSING_KEY: 229,
  SLASH: 191,
} as const;

/**
 * Return mouse buttons codes
 */
export const mouseButtons = {
  LEFT: 0,
  WHEEL: 1,
  RIGHT: 2,
  BACKWARD: 3,
  FORWARD: 4,
} as const;

/**
 * All screens below this width will be treated as mobile
 */
export const MOBILE_SCREEN_BREAKPOINT = 650;

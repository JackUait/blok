/**
 * Safe CSS colour check for values written into a `style` (table cell colours).
 *
 * Shared by the editor's table model and the DOM-free /view renderer, so both
 * keep exactly the same set. Pure module: no DOM, no parse5.
 *
 * Allow-list only: every accepted shape is fully anchored and built from
 * characters that cannot end a declaration or open a string, comment or URL.
 */

/** The 148 CSS named colours (CSS Color 4), lower case. */
export const CSS_NAMED_COLORS: ReadonlySet<string> = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell',
  'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen',
  'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat', 'white',
  'whitesmoke', 'yellow', 'yellowgreen',
]);

const KEYWORDS: ReadonlySet<string> = new Set(['transparent', 'currentcolor']);

/** Stops pathological input only; long custom property names must still pass. */
const MAX_LENGTH = 256;

// Literal space, never `\s`: `\s` admits newlines.
const NUM = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const NUM_PCT = `${NUM}%?`;
const PCT = `${NUM}%`;
const HUE = `${NUM}(?:deg|grad|rad|turn)?`;
const COMMA = ' *, *';
const SPACE = ' +';
const SPACE_ALPHA = `(?: */ *${NUM_PCT})?`;

const RGB_COMMA = new RegExp(`^rgba?\\( *${NUM_PCT}${COMMA}${NUM_PCT}${COMMA}${NUM_PCT}(?:${COMMA}${NUM_PCT})? *\\)$`, 'i');
const RGB_SPACE = new RegExp(`^rgba?\\( *${NUM_PCT}${SPACE}${NUM_PCT}${SPACE}${NUM_PCT}${SPACE_ALPHA} *\\)$`, 'i');
// Legacy comma hsl requires % on saturation and lightness (CSS Color 4).
const HSL_COMMA = new RegExp(`^hsla?\\( *${HUE}${COMMA}${PCT}${COMMA}${PCT}(?:${COMMA}${NUM_PCT})? *\\)$`, 'i');
const HSL_SPACE = new RegExp(`^hsla?\\( *${HUE}${SPACE}${NUM_PCT}${SPACE}${NUM_PCT}${SPACE_ALPHA} *\\)$`, 'i');

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// No fallback: a fallback is arbitrary CSS.
const CUSTOM_PROPERTY = /^var\(--[a-zA-Z0-9_-]+\)$/;

/**
 * True when `value` is a CSS colour that is safe to put into a `style`.
 * @param value - stored or user-picked colour
 */
export const isSafeCssColor = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) {
    return false;
  }

  const lower = value.toLowerCase();

  return CSS_NAMED_COLORS.has(lower)
    || KEYWORDS.has(lower)
    || HEX.test(value)
    || CUSTOM_PROPERTY.test(value)
    || RGB_COMMA.test(value)
    || RGB_SPACE.test(value)
    || HSL_COMMA.test(value)
    || HSL_SPACE.test(value);
};

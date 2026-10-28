/**
 * Symbol and Wingdings keep their glyphs in the private-use area (U+F020–U+F0FF).
 * A browser without those fonts draws an empty box there, so each is mapped to
 * the Unicode character it shows.
 */

/** Adobe Symbol encoding: Latin letters stand for Greek ones. */
const SYMBOL_LETTERS = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
const SYMBOL_LOWER = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';

const SYMBOL_SIGNS: Record<number, string> = {
  0x22: '∀', 0x24: '∃', 0x27: '∋', 0x2a: '∗', 0x2d: '−', 0x40: '≅', 0x5c: '∴', 0x5e: '⊥',
  0x60: '‾', 0x7e: '∼', 0xa2: '′', 0xa3: '≤', 0xa5: '∞', 0xa7: '♣', 0xa8: '♦', 0xa9: '♥',
  0xaa: '♠', 0xab: '↔', 0xac: '←', 0xad: '↑', 0xae: '→', 0xaf: '↓', 0xb0: '°', 0xb1: '±',
  0xb2: '″', 0xb3: '≥', 0xb4: '×', 0xb5: '∝', 0xb6: '∂', 0xb7: '•', 0xb8: '÷', 0xb9: '≠',
  0xba: '≡', 0xbb: '≈', 0xbc: '…', 0xc5: '⊕', 0xc6: '∅', 0xc7: '∩', 0xc8: '∪', 0xd1: '∇',
  0xd6: '√', 0xd7: '⋅', 0xd8: '¬', 0xd9: '∧', 0xda: '∨', 0xdb: '⇔', 0xde: '⇒', 0xe0: '◊',
  0xe5: '∑', 0xf2: '∫',
};

/** Wingdings bullets Word lists use. Others fall back to a plain bullet. */
const WINGDINGS: Record<number, string> = {
  0x6c: '●', 0x6e: '■', 0x71: '❑', 0x75: '◆', 0x76: '❖', 0xa7: '▪',
  0xd8: '➢', 0xe8: '➔', 0xfb: '✗', 0xfc: '✓',
};

function symbolChar(low: number): string {
  if (low >= 0x41 && low <= 0x5a) {
    return SYMBOL_LETTERS[low - 0x41];
  }
  if (low >= 0x61 && low <= 0x7a) {
    return SYMBOL_LOWER[low - 0x61];
  }
  if (Object.hasOwn(SYMBOL_SIGNS, low)) {
    return SYMBOL_SIGNS[low];
  }

  return low >= 0x20 && low < 0x7f ? String.fromCharCode(low) : '•';
}

/**
 * The visible character for `char` drawn in `font`. Characters outside the
 * private-use symbol range come back unchanged.
 */
export function visibleGlyph(char: string, font = ''): string {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0xf000 || code > 0xf0ff) {
    return char;
  }
  const low = code - 0xf000;
  if (/symbol/i.test(font)) {
    return symbolChar(low);
  }

  return Object.hasOwn(WINGDINGS, low) ? WINGDINGS[low] : '•';
}

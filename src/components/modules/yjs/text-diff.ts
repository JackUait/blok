import { simpleDiffString } from 'lib0/diff';

/**
 * How far the minimal diff searches before giving up. Myers costs O(N·D) in the
 * edit distance: typing is D of about 1 and wrapping a range in tags is D of
 * about 2 — a complete tag is ONE unit here — so the cap never bites a real
 * edit, while a whole-string replacement — a paste over a selection, a tool
 * normalising its own markup — has a D the size of the text and costs seconds
 * at a few thousand characters. Past the cap `diffText` splits both texts at
 * runs of atoms that occur exactly once in each, and answers every gap between
 * two of those anchors on its own — the words of that gap, and only then its
 * single region, which is what the write did before any of this existed.
 *
 * The number is not a free dial: measured on a 20k-character whole-string
 * rewrite, a cap of 512 costs 25-70ms and 1024 costs 80-100ms, against under
 * 2ms here. Widen the UNITS, not the cap.
 */
const MAX_DIFF_DISTANCE = 64;

/** One edit turning the stored text into the saved text. */
export interface TextEditOp {
  index: number;
  remove: number;
  insert: string;
}

/** `<` */
const LT = 0x3c;
/** `>` */
const GT = 0x3e;
/** `/` */
const SLASH = 0x2f;
/** `&` */
const AMP = 0x26;
/** `;` */
const SEMICOLON = 0x3b;
/** `#` */
const HASH = 0x23;
/** `"` */
const DOUBLE_QUOTE = 0x22;
/** `'` */
const SINGLE_QUOTE = 0x27;

/**
 * Longest an entity reference may be before the scanner gives up and treats the
 * `&` as ordinary text. `&CounterClockwiseContourIntegral;` is the longest named
 * reference HTML defines, at 31 characters plus the ampersand.
 */
const MAX_ENTITY_LENGTH = 32;

/**
 * The quote character a tag scanner is inside of after reading `code`, or 0
 * when it is not inside one.
 * @param code - the character just read
 * @param quote - the quote the scanner was inside of, or 0
 */
const nextQuote = (code: number, quote: number): number => {
  if (quote !== 0) {
    return code === quote ? 0 : quote;
  }

  return code === DOUBLE_QUOTE || code === SINGLE_QUOTE ? code : 0;
};

/**
 * Where the tag that starts at `start` ends, or `start` when the text does not
 * carry a complete tag there.
 *
 * Quoted attribute values are scanned through, because serializing an element
 * does NOT escape `>` inside an attribute value — `<a title="a>b">` is a single
 * tag and splitting it at the first `>` would hand half of it to the diff.
 * @param text - the string being scanned
 * @param start - index of the `<`
 */
const tagEnd = (text: string, start: number): number => {
  /* eslint-disable no-restricted-syntax -- a character scanner: the index and
     the quote state both advance inside the loop. */
  let index = start + 1;

  if (text.charCodeAt(index) === SLASH) {
    index += 1;
  }

  const nameStart = text.charCodeAt(index);
  const isName = (nameStart >= 0x41 && nameStart <= 0x5a) || (nameStart >= 0x61 && nameStart <= 0x7a);

  // `<` followed by anything but a tag name is a literal character the user
  // typed, and must stay one — an atom per code point, exactly as before.
  if (!isName) {
    return start;
  }

  let quote = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);
    const wasQuoted = quote !== 0;

    quote = nextQuote(code, quote);

    if (!wasQuoted && quote === 0 && code === GT) {
      return index + 1;
    }

    // A second `<` before any `>`: the first one was literal text.
    if (!wasQuoted && quote === 0 && code === LT) {
      return start;
    }

    index += 1;
  }
  /* eslint-enable no-restricted-syntax */

  // Unclosed — a half-typed tag, or text that merely contains a `<`.
  return start;
};

/**
 * Where the entity reference that starts at `start` ends, or `start` when there
 * is no complete one there.
 * @param text - the string being scanned
 * @param start - index of the `&`
 */
const entityEnd = (text: string, start: number): number => {
  // eslint-disable-next-line no-restricted-syntax -- character scanner
  let index = start + 1;

  if (text.charCodeAt(index) === HASH) {
    index += 1;
  }

  const limit = Math.min(text.length, start + MAX_ENTITY_LENGTH);

  for (; index < limit; index += 1) {
    const code = text.charCodeAt(index);

    if (code === SEMICOLON) {
      // `&;` is not a reference.
      return index > start + 1 ? index + 1 : start;
    }

    const alphanumeric = (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a);

    if (!alphanumeric) {
      return start;
    }
  }

  return start;
};

/**
 * Where the structure starting at `start` ends — a tag, an entity — or `start`
 * when nothing structured starts there.
 * @param text - the string being scanned
 * @param start - index to read from
 * @param code - the character at `start`
 */
const structuredEnd = (text: string, start: number, code: number): number => {
  if (code === LT) {
    return tagEnd(text, start);
  }

  if (code === AMP) {
    return entityEnd(text, start);
  }

  return start;
};

/**
 * Code-unit ranges of the characters that can make a user-visible character
 * span more than one code point: combining marks, joiners, variation selectors,
 * skin tones, regional indicators, emoji tag characters, conjoining Hangul jamo
 * and the Prepend characters. Pairs of bounds, inclusive, in order.
 *
 * ONLY characters that EXTEND another one, PREPEND onto one, or pair with their
 * own kind. A base letter that merely ACCEPTS an extender is deliberately NOT
 * here, and that is the whole cost of the table: every cluster longer than one
 * code point holds at least one member that IS here, and `containing()` called
 * at that member's offset returns the whole cluster, base included. Hinting the
 * bases too — which an earlier table did, by covering 0591-11FF whole — made
 * every character of a Hebrew, Thai, Devanagari or Georgian document a hint, so
 * `clusterRuns` measured every character of the block: 45us per keystroke
 * per 500 Thai characters, against 5us here. Measured.
 *
 * Generated by asking `Intl.Segmenter` itself, for every code point, whether it
 * extends, prepends onto or pairs with a PLAIN base — one not in this table —
 * then absorbing gaps that hold only unassigned code points, so a Unicode
 * version that fills a reserved slot inside a mark block needs no regeneration.
 * It is therefore a SUPERSET: a false hit costs one `containing` call, a miss
 * would leave that character on the code-point atom it always had.
 *
 * Code UNITS, so a surrogate pair is answered by `ASTRAL_CLUSTER_HINTS` on the
 * code point instead — no range here covers D800-DFFF.
 *
 * A regex did this before and cost 8ms per 20k characters: one emoji makes the
 * whole string two-byte in V8, and a `\p{M}` class over a two-byte string is
 * 190ns PER CHARACTER — measured, on every keystroke. Integer compares are
 * 0.04ms for the same string.
 */
const CLUSTER_HINTS = [
  0x0300, 0x036f, 0x0483, 0x0489, 0x0591, 0x05bd, 0x05bf, 0x05bf,
  0x05c1, 0x05c2, 0x05c4, 0x05c5, 0x05c7, 0x05c7, 0x0600, 0x0605,
  0x0610, 0x061a, 0x064b, 0x065f, 0x0670, 0x0670, 0x06d6, 0x06dd,
  0x06df, 0x06e4, 0x06e7, 0x06e8, 0x06ea, 0x06ed, 0x070f, 0x070f,
  0x0711, 0x0711, 0x0730, 0x074a, 0x07a6, 0x07b0, 0x07eb, 0x07f3,
  0x07fd, 0x07fd, 0x0816, 0x0819, 0x081b, 0x0823, 0x0825, 0x0827,
  0x0829, 0x082d, 0x0859, 0x085b, 0x0890, 0x089f, 0x08ca, 0x0903,
  0x093a, 0x093c, 0x093e, 0x094f, 0x0951, 0x0957, 0x0962, 0x0963,
  0x0981, 0x0983, 0x09bc, 0x09bc, 0x09be, 0x09cd, 0x09d7, 0x09d7,
  0x09e2, 0x09e3, 0x09fe, 0x0a03, 0x0a3c, 0x0a51, 0x0a70, 0x0a71,
  0x0a75, 0x0a75, 0x0a81, 0x0a83, 0x0abc, 0x0abc, 0x0abe, 0x0acd,
  0x0ae2, 0x0ae3, 0x0afa, 0x0b03, 0x0b3c, 0x0b3c, 0x0b3e, 0x0b57,
  0x0b62, 0x0b63, 0x0b82, 0x0b82, 0x0bbe, 0x0bcd, 0x0bd7, 0x0bd7,
  0x0c00, 0x0c04, 0x0c3c, 0x0c3c, 0x0c3e, 0x0c56, 0x0c62, 0x0c63,
  0x0c81, 0x0c83, 0x0cbc, 0x0cbc, 0x0cbe, 0x0cd6, 0x0ce2, 0x0ce3,
  0x0cf3, 0x0d03, 0x0d3b, 0x0d3c, 0x0d3e, 0x0d4e, 0x0d57, 0x0d57,
  0x0d62, 0x0d63, 0x0d81, 0x0d83, 0x0dca, 0x0ddf, 0x0df2, 0x0df3,
  0x0e31, 0x0e31, 0x0e33, 0x0e3a, 0x0e47, 0x0e4e, 0x0eb1, 0x0eb1,
  0x0eb3, 0x0ebc, 0x0ec8, 0x0ece, 0x0f18, 0x0f19, 0x0f35, 0x0f35,
  0x0f37, 0x0f37, 0x0f39, 0x0f39, 0x0f3e, 0x0f3f, 0x0f71, 0x0f84,
  0x0f86, 0x0f87, 0x0f8d, 0x0fbc, 0x0fc6, 0x0fc6, 0x102d, 0x103e,
  0x1056, 0x1059, 0x105e, 0x1060, 0x1071, 0x1074, 0x1082, 0x108d,
  0x109d, 0x109d, 0x1100, 0x11ff, 0x135d, 0x135f, 0x1712, 0x1715,
  0x1732, 0x1734, 0x1752, 0x1753, 0x1772, 0x1773, 0x17b4, 0x17d3,
  0x17dd, 0x17dd, 0x180b, 0x180f, 0x1885, 0x1886, 0x18a9, 0x18a9,
  0x1920, 0x193b, 0x1a17, 0x1a1b, 0x1a55, 0x1a7f, 0x1ab0, 0x1b04,
  0x1b34, 0x1b44, 0x1b6b, 0x1b73, 0x1b80, 0x1b82, 0x1ba1, 0x1bad,
  0x1be6, 0x1bf3, 0x1c24, 0x1c37, 0x1cd0, 0x1cd2, 0x1cd4, 0x1ce8,
  0x1ced, 0x1ced, 0x1cf4, 0x1cf4, 0x1cf7, 0x1cf9, 0x1dc0, 0x1dff,
  0x200c, 0x200d, 0x20d0, 0x20f0, 0x2cef, 0x2cf1, 0x2d7f, 0x2d7f,
  0x2de0, 0x2dff, 0x302a, 0x302f, 0x3099, 0x309a, 0xa66f, 0xa672,
  0xa674, 0xa67d, 0xa69e, 0xa69f, 0xa6f0, 0xa6f1, 0xa802, 0xa802,
  0xa806, 0xa806, 0xa80b, 0xa80b, 0xa823, 0xa827, 0xa82c, 0xa82c,
  0xa880, 0xa881, 0xa8b4, 0xa8c5, 0xa8e0, 0xa8f1, 0xa8ff, 0xa8ff,
  0xa926, 0xa92d, 0xa947, 0xa953, 0xa960, 0xa983, 0xa9b3, 0xa9c0,
  0xa9e5, 0xa9e5, 0xaa29, 0xaa36, 0xaa43, 0xaa43, 0xaa4c, 0xaa4d,
  0xaa7c, 0xaa7c, 0xaab0, 0xaab0, 0xaab2, 0xaab4, 0xaab7, 0xaab8,
  0xaabe, 0xaabf, 0xaac1, 0xaac1, 0xaaeb, 0xaaef, 0xaaf5, 0xaaf6,
  0xabe3, 0xabea, 0xabec, 0xabed, 0xd7b0, 0xd7fb, 0xfb1e, 0xfb1e,
  0xfe00, 0xfe0f, 0xfe20, 0xfe2f, 0xff9e, 0xff9f,
];

/**
 * The same, for the code points a surrogate pair carries.
 */
const ASTRAL_CLUSTER_HINTS = [
  0x101fd, 0x101fd, 0x102e0, 0x102e0, 0x10376, 0x1037a,
  0x10a01, 0x10a0f, 0x10a38, 0x10a3f, 0x10ae5, 0x10ae6,
  0x10d24, 0x10d27, 0x10d69, 0x10d6d, 0x10eab, 0x10eac,
  0x10efc, 0x10eff, 0x10f46, 0x10f50, 0x10f82, 0x10f85,
  0x11000, 0x11002, 0x11038, 0x11046, 0x11070, 0x11070,
  0x11073, 0x11074, 0x1107f, 0x11082, 0x110b0, 0x110ba,
  0x110bd, 0x110bd, 0x110c2, 0x110cd, 0x11100, 0x11102,
  0x11127, 0x11134, 0x11145, 0x11146, 0x11173, 0x11173,
  0x11180, 0x11182, 0x111b3, 0x111c0, 0x111c2, 0x111c3,
  0x111c9, 0x111cc, 0x111ce, 0x111cf, 0x1122c, 0x11237,
  0x1123e, 0x1123e, 0x11241, 0x11241, 0x112df, 0x112ea,
  0x11300, 0x11303, 0x1133b, 0x1133c, 0x1133e, 0x1134d,
  0x11357, 0x11357, 0x11362, 0x11374, 0x113b8, 0x113d2,
  0x113e1, 0x113e2, 0x11435, 0x11446, 0x1145e, 0x1145e,
  0x114b0, 0x114c3, 0x115af, 0x115c0, 0x115dc, 0x115dd,
  0x11630, 0x11640, 0x116ab, 0x116b7, 0x1171d, 0x1172b,
  0x1182c, 0x1183a, 0x11930, 0x11943, 0x119d1, 0x119e0,
  0x119e4, 0x119e4, 0x11a01, 0x11a0a, 0x11a33, 0x11a3e,
  0x11a47, 0x11a47, 0x11a51, 0x11a5b, 0x11a84, 0x11a99,
  0x11c2f, 0x11c3f, 0x11c92, 0x11cb6, 0x11d31, 0x11d47,
  0x11d8a, 0x11d97, 0x11ef3, 0x11ef6, 0x11f00, 0x11f03,
  0x11f34, 0x11f42, 0x11f5a, 0x11f5a, 0x13440, 0x13440,
  0x13447, 0x13455, 0x1611e, 0x1612f, 0x16af0, 0x16af4,
  0x16b30, 0x16b36, 0x16d63, 0x16d63, 0x16d67, 0x16d6a,
  0x16f4f, 0x16f4f, 0x16f51, 0x16f92, 0x16fe4, 0x16ff1,
  0x1bc9d, 0x1bc9e, 0x1cf00, 0x1cf46, 0x1d165, 0x1d169,
  0x1d16d, 0x1d182, 0x1d185, 0x1d18b, 0x1d1aa, 0x1d1ad,
  0x1d242, 0x1d244, 0x1da00, 0x1da36, 0x1da3b, 0x1da6c,
  0x1da75, 0x1da75, 0x1da84, 0x1da84, 0x1da9b, 0x1daaf,
  0x1e000, 0x1e02a, 0x1e08f, 0x1e08f, 0x1e130, 0x1e136,
  0x1e2ae, 0x1e2ae, 0x1e2ec, 0x1e2ef, 0x1e4ec, 0x1e4ef,
  0x1e5ee, 0x1e5ef, 0x1e8d0, 0x1e8d6, 0x1e944, 0x1e94a,
  0x1f1e6, 0x1f1ff, 0x1f3fb, 0x1f3ff, 0xe0020, 0xe007f,
  0xe0100, 0xe01ef,
];

/**
 * The subset of `CLUSTER_HINTS` that joins whatever character precedes it and
 * says nothing about the characters after it — UAX #29 GB9 Extend and GB9a
 * SpacingMark, minus the two kinds that DO speak about what follows: ZWJ, which
 * welds two pictographs into one character (GB11), and the Indic conjunct
 * Linkers, which pull the next consonant in (GB9c). Pairs of bounds, inclusive.
 *
 * Why it exists: `Intl.Segmenter.containing()` is 250ns, and a Thai, Hebrew,
 * Devanagari or Arabic document is a third combining marks, so asking it per
 * character of the block is 110us per keystroke per 2000 characters — measured.
 * For these code points the answer needs no context at all, so the scanner
 * appends them itself and ICU is asked only about the rest: 35us for the same
 * block, measured, with the boundaries unchanged.
 *
 * BMP only. An astral extender is rare enough to be worth no table of its own,
 * and a skin tone or a regional indicator is NOT here anyway — those attach
 * only to particular characters, which is exactly the context this list is
 * defined by not having.
 *
 * Generated the same way as `CLUSTER_HINTS`: by asking `Intl.Segmenter` whether
 * the code point joins every probe base on its own AND never drags a following
 * non-hint in with it.
 */
const SIMPLE_EXTENDERS = [
  0x0300, 0x036f, 0x0483, 0x0489, 0x0591, 0x05bd, 0x05bf, 0x05bf,
  0x05c1, 0x05c2, 0x05c4, 0x05c5, 0x05c7, 0x05c7, 0x0610, 0x061a,
  0x064b, 0x065f, 0x0670, 0x0670, 0x06d6, 0x06dc, 0x06df, 0x06e4,
  0x06e7, 0x06e8, 0x06ea, 0x06ed, 0x0711, 0x0711, 0x0730, 0x074a,
  0x07a6, 0x07b0, 0x07eb, 0x07f3, 0x07fd, 0x07fd, 0x0816, 0x0819,
  0x081b, 0x0823, 0x0825, 0x0827, 0x0829, 0x082d, 0x0859, 0x085b,
  0x0897, 0x089f, 0x08ca, 0x08e1, 0x08e3, 0x0903, 0x093a, 0x093c,
  0x093e, 0x094c, 0x094e, 0x094f, 0x0951, 0x0957, 0x0962, 0x0963,
  0x0981, 0x0983, 0x09bc, 0x09bc, 0x09be, 0x09c4, 0x09c7, 0x09c8,
  0x09cb, 0x09cc, 0x09d7, 0x09d7, 0x09e2, 0x09e3, 0x09fe, 0x09fe,
  0x0a01, 0x0a03, 0x0a3c, 0x0a3c, 0x0a3e, 0x0a42, 0x0a47, 0x0a48,
  0x0a4b, 0x0a4d, 0x0a51, 0x0a51, 0x0a70, 0x0a71, 0x0a75, 0x0a75,
  0x0a81, 0x0a83, 0x0abc, 0x0abc, 0x0abe, 0x0ac5, 0x0ac7, 0x0ac9,
  0x0acb, 0x0acc, 0x0ae2, 0x0ae3, 0x0afa, 0x0aff, 0x0b01, 0x0b03,
  0x0b3c, 0x0b3c, 0x0b3e, 0x0b44, 0x0b47, 0x0b48, 0x0b4b, 0x0b4c,
  0x0b55, 0x0b57, 0x0b62, 0x0b63, 0x0b82, 0x0b82, 0x0bbe, 0x0bc2,
  0x0bc6, 0x0bc8, 0x0bca, 0x0bcd, 0x0bd7, 0x0bd7, 0x0c00, 0x0c04,
  0x0c3c, 0x0c3c, 0x0c3e, 0x0c44, 0x0c46, 0x0c48, 0x0c4a, 0x0c4c,
  0x0c55, 0x0c56, 0x0c62, 0x0c63, 0x0c81, 0x0c83, 0x0cbc, 0x0cbc,
  0x0cbe, 0x0cc4, 0x0cc6, 0x0cc8, 0x0cca, 0x0ccd, 0x0cd5, 0x0cd6,
  0x0ce2, 0x0ce3, 0x0cf3, 0x0cf3, 0x0d00, 0x0d03, 0x0d3b, 0x0d3c,
  0x0d3e, 0x0d44, 0x0d46, 0x0d48, 0x0d4a, 0x0d4c, 0x0d57, 0x0d57,
  0x0d62, 0x0d63, 0x0d81, 0x0d83, 0x0dca, 0x0dca, 0x0dcf, 0x0dd4,
  0x0dd6, 0x0dd6, 0x0dd8, 0x0ddf, 0x0df2, 0x0df3, 0x0e31, 0x0e31,
  0x0e33, 0x0e3a, 0x0e47, 0x0e4e, 0x0eb1, 0x0eb1, 0x0eb3, 0x0ebc,
  0x0ec8, 0x0ece, 0x0f18, 0x0f19, 0x0f35, 0x0f35, 0x0f37, 0x0f37,
  0x0f39, 0x0f39, 0x0f3e, 0x0f3f, 0x0f71, 0x0f84, 0x0f86, 0x0f87,
  0x0f8d, 0x0f97, 0x0f99, 0x0fbc, 0x0fc6, 0x0fc6, 0x102d, 0x1037,
  0x1039, 0x103e, 0x1056, 0x1059, 0x105e, 0x1060, 0x1071, 0x1074,
  0x1082, 0x1082, 0x1084, 0x1086, 0x108d, 0x108d, 0x109d, 0x109d,
  0x135d, 0x135f, 0x1712, 0x1715, 0x1732, 0x1734, 0x1752, 0x1753,
  0x1772, 0x1773, 0x17b4, 0x17d3, 0x17dd, 0x17dd, 0x180b, 0x180d,
  0x180f, 0x180f, 0x1885, 0x1886, 0x18a9, 0x18a9, 0x1920, 0x192b,
  0x1930, 0x193b, 0x1a17, 0x1a1b, 0x1a55, 0x1a5e, 0x1a60, 0x1a60,
  0x1a62, 0x1a62, 0x1a65, 0x1a7c, 0x1a7f, 0x1a7f, 0x1ab0, 0x1ace,
  0x1b00, 0x1b04, 0x1b34, 0x1b44, 0x1b6b, 0x1b73, 0x1b80, 0x1b82,
  0x1ba1, 0x1bad, 0x1be6, 0x1bf3, 0x1c24, 0x1c37, 0x1cd0, 0x1cd2,
  0x1cd4, 0x1ce8, 0x1ced, 0x1ced, 0x1cf4, 0x1cf4, 0x1cf7, 0x1cf9,
  0x1dc0, 0x1dff, 0x200c, 0x200c, 0x20d0, 0x20f0, 0x2cef, 0x2cf1,
  0x2d7f, 0x2d7f, 0x2de0, 0x2dff, 0x302a, 0x302f, 0x3099, 0x309a,
  0xa66f, 0xa672, 0xa674, 0xa67d, 0xa69e, 0xa69f, 0xa6f0, 0xa6f1,
  0xa802, 0xa802, 0xa806, 0xa806, 0xa80b, 0xa80b, 0xa823, 0xa827,
  0xa82c, 0xa82c, 0xa880, 0xa881, 0xa8b4, 0xa8c5, 0xa8e0, 0xa8f1,
  0xa8ff, 0xa8ff, 0xa926, 0xa92d, 0xa947, 0xa953, 0xa980, 0xa983,
  0xa9b3, 0xa9c0, 0xa9e5, 0xa9e5, 0xaa29, 0xaa36, 0xaa43, 0xaa43,
  0xaa4c, 0xaa4d, 0xaa7c, 0xaa7c, 0xaab0, 0xaab0, 0xaab2, 0xaab4,
  0xaab7, 0xaab8, 0xaabe, 0xaabf, 0xaac1, 0xaac1, 0xaaeb, 0xaaef,
  0xaaf5, 0xaaf6, 0xabe3, 0xabea, 0xabec, 0xabed, 0xfb1e, 0xfb1e,
  0xfe00, 0xfe0f, 0xfe20, 0xfe2f, 0xff9e, 0xff9f,
];

/**
 * Code points that nothing attaches to: UAX #29 GCB Control, CR and LF, which
 * break before whatever follows them (GB4). A newline then U+0301 is TWO
 * characters, not an accented newline, so the cheap append must not fire after
 * one. Pairs of bounds, inclusive. BMP only — an astral Control falls back to
 * ICU, the same as any other astral character.
 */
const NON_ATTACHING = [
  0x0000, 0x001f, 0x007f, 0x009f, 0x00ad, 0x00ad, 0x061c, 0x061c,
  0x180e, 0x180e, 0x200b, 0x200b, 0x200e, 0x200f, 0x2028, 0x202e,
  0x2060, 0x206f, 0xfeff, 0xfeff, 0xfff0, 0xfffb,
];

/** `CHARACTER_FLAGS` bit: may be part of a character longer than itself. */
const HINT = 1;
/** `CHARACTER_FLAGS` bit: joins the character before it, whatever that is. */
const SIMPLE = 2;
/** `CHARACTER_FLAGS` bit: nothing joins this character. */
const NO_ATTACH = 4;

/**
 * The three tables above as one byte per BMP code unit, built once.
 *
 * A byte array rather than a search of the ranges because the test runs once
 * per code unit of the block, on every keystroke, and a script whose letters
 * live above U+0300 reaches it for every one of them: a binary search of 159
 * ranges is 12ns a character, this is 3ns — 26us against 6us per 2000 Thai
 * characters, measured. 64KB of RAM, and none of it shipped: the ranges are.
 */
const CHARACTER_FLAGS = new Uint8Array(0x10000);

/**
 * Sets `flag` on every code unit `bounds` covers.
 * @param bounds - pairs of inclusive bounds, in order
 * @param flag - the bit to set
 */
const markFlags = (bounds: number[], flag: number): void => {
  /* eslint-disable no-restricted-syntax -- fills the ranges; the pair index
     and the code unit both advance inside the loops. */
  for (let at = 0; at < bounds.length; at += 2) {
    for (let code = bounds[at]; code <= bounds[at + 1]; code += 1) {
      CHARACTER_FLAGS[code] |= flag;
    }
  }
  /* eslint-enable no-restricted-syntax */
};

markFlags(CLUSTER_HINTS, HINT);
markFlags(SIMPLE_EXTENDERS, HINT | SIMPLE);
markFlags(NON_ATTACHING, NO_ATTACH);

// CR carries no mark and extends nothing, but CRLF is ONE character, so the
// scanner has to stop on it. No range above holds it.
CHARACTER_FLAGS[0x000d] |= HINT;

/**
 * Whether `bounds` holds `code`. Binary search, for the supplementary planes:
 * a surrogate pair is rare enough that a byte per code point would be 1MB of
 * nothing.
 * @param bounds - pairs of inclusive bounds, in order
 * @param code - the code point to test
 */
const inBounds = (bounds: number[], code: number): boolean => {
  /* eslint-disable no-restricted-syntax -- binary search: both bounds move */
  let low = 0;
  let high = (bounds.length >> 1) - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;

    if (code < bounds[middle * 2]) {
      high = middle - 1;
    } else if (code > bounds[middle * 2 + 1]) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  /* eslint-enable no-restricted-syntax */

  return false;
};

/**
 * Text that is plain ASCII, CR aside, holds no character longer than one code
 * point, and the engine answers that in one native pass. Skipping the scan for
 * it is what keeps an English document at the cost it had: the per-code-unit
 * walk is 3.7us per 2000 characters on every keystroke, and this is 1.2us.
 *
 * CR is excluded from the safe set deliberately — CRLF is ONE character.
 */
const MAY_CLUSTER = /[^\u0000-\u000c\u000e-\u007f]/;

/**
 * Grapheme segmentation, or null on an engine without it. Pinned to one locale
 * so two peers split a character the same way whatever their UI language.
 *
 * `Intl.Segmenter` is in Node since 16 — the project's floor is 20.19 — and in
 * every current browser engine: Chrome 87, Safari 14.1, Firefox 125. An older
 * engine falls back to the code-point atom, which is what shipped before.
 */
const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'grapheme' })
  : null;

/**
 * Every user-visible character that spans more than one code point, as pairs
 * of code-unit offsets — start and end, inclusive of the start — in order.
 *
 * Runs, not a set of interior offsets: `atomize` walks the text left to right,
 * so it consumes these with a cursor that only moves forward. A `Set` had to be
 * probed once per atom instead, and a hash lookup per character of the block is
 * 12us per 500 — measured, on every keystroke, in a document with ONE accent.
 *
 * Three costs, in the order the scan avoids them. A character no table flags is
 * skipped on one byte lookup. One flagged `SIMPLE` is appended to the character
 * before it, with no segmentation at all, because UAX #29 lets it join anything
 * and tells the characters after it nothing. Only what is left — a ZWJ sequence,
 * an Indic conjunct, a flag, jamo, a Prepend, anything astral — is measured with
 * `containing`, at 250ns a call. A Thai block is a third combining marks, so
 * asking ICU about each of them costs 110us per 2000 characters on every
 * keystroke, against 35us here. Measured; and the boundaries are the same, over
 * 3 million fuzzed strings against full segmentation.
 * @param text - the string being split
 */
const clusterRuns = (text: string): number[] => {
  const runs: number[] = [];

  if (graphemeSegmenter === null || !MAY_CLUSTER.test(text)) {
    return runs;
  }

  /* eslint-disable no-restricted-syntax -- a scanner: the read index, the
     segmenter and the start of the character being built all advance in it. */
  let segments: Intl.Segments | null = null;
  let index = 0;
  let characterStart = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);
    const high = code >= 0xd800 && code <= 0xdbff;
    const low = high ? text.charCodeAt(index + 1) : 0;
    const width = low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
    const astralFlags = high && inBounds(ASTRAL_CLUSTER_HINTS, text.codePointAt(index) ?? code) ? HINT : 0;
    const flags = high ? astralFlags : CHARACTER_FLAGS[code];

    if ((flags & HINT) === 0) {
      characterStart = index;
      index += width;

      continue;
    }

    const before = text.charCodeAt(characterStart);
    const attaches = index > 0 && !(before >= 0xd800 && before <= 0xdbff) &&
      (CHARACTER_FLAGS[before] & NO_ATTACH) === 0;

    // Joins the character that starts at `characterStart`, and ICU would say
    // the same: UAX #29 lets this one attach to anything and it tells the
    // characters after it nothing, so no segmentation is needed to know.
    const simple = (flags & SIMPLE) !== 0 && attaches;

    // The same character getting longer — a letter with both an accent and a
    // tone mark — grows its run rather than adding an overlapping one.
    if (simple && runs.length >= 2 && runs[runs.length - 2] === characterStart) {
      runs[runs.length - 1] = index + width;
      index += width;

      continue;
    }

    if (simple) {
      runs.push(characterStart, index + width);
      index += width;

      continue;
    }

    segments = segments ?? graphemeSegmenter.segment(text);

    const part = segments.containing(index);
    const from = part === undefined ? index : part.index;
    const end = part === undefined ? index + 1 : from + part.segment.length;

    // ICU's answer wins over anything the cheap append put down, because it can
    // reach back past it: a Devanagari Linker takes the consonant AND the vowel
    // sign already attached to it into one character.
    while (runs.length >= 2 && runs[runs.length - 1] > from) {
      runs.length -= 2;
    }

    if (end - from > 1) {
      runs.push(from, end);
    }

    // Past the character just measured: its own further hints are answered.
    index = Math.max(end, index + 1);
    characterStart = index;
  }
  /* eslint-enable no-restricted-syntax */

  return runs;
};

/**
 * The atoms of a text that carries no tag and no entity: every user-visible
 * character whole, and the code points between the clusters.
 *
 * Splices rather than scans. The scanner below pays a tag test and a `slice`
 * per atom, and one accent anywhere in the block put the WHOLE block on it —
 * 16us per 500 characters against 4us here, measured, on every keystroke.
 * Spreading a substring is the engine's own code-point split.
 * @param text - the string being split
 * @param runs - its clusters, from `clusterRuns`
 */
const clusterAtoms = (text: string, runs: number[]): string[] => {
  const atoms: string[] = [];
  /* eslint-disable no-restricted-syntax -- walks the runs and the code points
     of the gap before each one; both advance inside the loop. */
  let at = 0;

  for (let run = 0; run < runs.length; run += 2) {
    for (const codePoint of text.slice(at, runs[run])) {
      atoms.push(codePoint);
    }

    atoms.push(text.slice(runs[run], runs[run + 1]));
    at = runs[run + 1];
  }

  for (const codePoint of text.slice(at)) {
    atoms.push(codePoint);
  }
  /* eslint-enable no-restricted-syntax */

  return atoms;
};

/**
 * The units the diff may put an edit boundary between: a COMPLETE tag, a
 * complete entity reference, otherwise one user-visible character.
 *
 * This is what stops the merge treating markup as spellable text. A block's
 * `text` is the tool's `innerHTML` — markup and content in one string with no
 * boundary — and Myers is minimal, so over code points it happily expresses
 * "bold this word" as "insert `<`, REUSE the word's own `b`, insert `>`…".
 * The tag then owns a letter of the word, and the peer fixing that letter is
 * editing the inside of the tag: measured, that produced visible `<>b` rubbish,
 * an `<mak>` nobody can render, and an `href` pointing at a domain neither
 * person typed. Whole tags cannot be half-edited and never share a character
 * with content.
 *
 * Code points, never code units: an edit boundary inside a surrogate pair puts
 * the halves in separate CRDT items and Yjs replaces both with U+FFFD — 43% of
 * emoji edits corrupted, measured.
 *
 * And whole CHARACTERS, never bare code points: a letter plus its accent, a
 * thumb plus its skin tone, a ZWJ family, a two-indicator flag are each several
 * code points, and a boundary inside one hands a peer's edit the rest of the
 * cluster — measured, the accent welded onto the character the other person
 * typed, a colour swatch stranded on a `!`, a family emoji coming apart. 54 of
 * a 144-pair sweep carried a character neither peer had typed.
 * @param text - the string to split
 */
export const atomize = (text: string): string[] => {
  const runs = clusterRuns(text);

  // Nothing structured to protect: the scanner below is only there to keep a
  // tag and an entity whole, and it costs a tag test and a `slice` per atom.
  if (!text.includes('<') && !text.includes('&')) {
    return runs.length === 0 ? [...text] : clusterAtoms(text, runs);
  }

  const atoms: string[] = [];
  /* eslint-disable no-restricted-syntax -- character scanner: the read index,
     the end of the character being read and the cursor into `runs` all advance
     in the loop. */
  let index = 0;
  let run = 0;

  while (index < text.length) {
    const code = text.charCodeAt(index);
    const structured = structuredEnd(text, index, code);

    // A tag or an entity is never part of a character, so it is never extended:
    // a `>` and an accent typed after it are two atoms, and the accent stays
    // editable.
    if (structured > index) {
      atoms.push(text.slice(index, structured));
      index = structured;

      continue;
    }

    // `runs` is in order and `index` only grows, so the cursor never goes back.
    while (run < runs.length && runs[run + 1] <= index) {
      run += 2;
    }

    const low = code >= 0xd800 && code <= 0xdbff ? text.charCodeAt(index + 1) : 0;
    const clusterEnd = run < runs.length && runs[run] <= index ? runs[run + 1] : 0;
    let end = index + (low >= 0xdc00 && low <= 0xdfff ? 2 : 1);

    // Stop at a tag or an entity even when the character wants to swallow it.
    // The Prepend characters — the Arabic number signs, U+0D4E, the Brahmic
    // ones — cluster with whatever FOLLOWS, and `؀<b>bold` put the `<` inside
    // the previous atom, so retagging landed an edit boundary between `<` and
    // `b`. That is the boundary-inside-markup this whole file exists to stop.
    while (end < clusterEnd && structuredEnd(text, end, text.charCodeAt(end)) === end) {
      end += 1;
    }
    /* eslint-enable no-restricted-syntax */

    atoms.push(text.slice(index, end));
    index = end;
  }

  return atoms;
};

/**
 * Walk a Myers trace back into edits, oldest first.
 * @param trace - V snapshots, one per search depth
 * @param before - the stored text, split into atoms
 * @param after - the saved text, split into atoms
 * @param depth - the depth the search ended at
 */
const backtrackMyers = (
  trace: Array<Map<number, number>>,
  before: string[],
  after: string[],
  depth: number
): TextEditOp[] => {
  const ops: TextEditOp[] = [];
  /* eslint-disable no-restricted-syntax -- the trace is walked backwards; both
     coordinates move on every step, which is the shape of the algorithm. */
  let x = before.length;
  let y = after.length;

  for (let step = depth; step > 0; step -= 1) {
    const previous = trace[step];
    const k = x - y;
    const down = k === -step || (k !== step && (previous.get(k - 1) ?? 0) < (previous.get(k + 1) ?? 0));
    const previousK = down ? k + 1 : k - 1;
    const previousX = previous.get(previousK) ?? 0;
    const previousY = previousX - previousK;

    ops.push(down
      ? { index: previousX,
        remove: 0,
        insert: after[previousY] }
      : { index: previousX,
        remove: 1,
        insert: '' });

    x = previousX;
    y = previousY;
  }
  /* eslint-enable no-restricted-syntax */

  ops.reverse();

  // Fuse neighbours so a typed word is one insert, not one per character, and
  // so a delete with an insert against its end is ONE replacement. The pair
  // matters: applied separately the new text is anchored to the RIGHT of the
  // run it replaces, so a peer's concurrent keystroke inside that run — whose
  // own anchor is a character now tombstoned — surfaces BEFORE all of it, and
  // the block reads "!Completely different…". Measured.
  return ops.reduce<TextEditOp[]>((fused, op) => {
    const last = fused[fused.length - 1];
    const abuts = last !== undefined && last.index + last.remove === op.index;

    if (abuts && last.insert === '' && op.remove === 0) {
      last.insert = op.insert;

      return fused;
    }

    if (abuts && last.remove === 0 && op.insert === '') {
      last.remove = op.remove;

      return fused;
    }

    if (abuts && (last.insert === '') === (op.insert === '')) {
      last.remove += op.remove;
      last.insert += op.insert;

      return fused;
    }

    fused.push({ ...op });

    return fused;
  }, []);
};

/**
 * How far a Myers step can run along the diagonal: the two texts agree
 * atom for atom from (x, y) until they do not.
 * @param before - the stored text, split into atoms
 * @param after - the saved text, split into atoms
 * @param fromX - index into `before` to start at
 * @param fromY - index into `after` to start at
 */
const slideDiagonal = (before: string[], after: string[], fromX: number, fromY: number): number => {
  const reach = Math.min(before.length - fromX, after.length - fromY);
  // eslint-disable-next-line no-restricted-syntax -- scan index, advanced in the loop below
  let matched = 0;

  while (matched < reach && before[fromX + matched] === after[fromY + matched]) {
    matched += 1;
  }

  return fromX + matched;
};

/**
 * One step of the search: extend every diagonal reachable at `depth`, recording
 * how far each one got. True once a path has consumed both texts.
 * @param before - the stored text, split into atoms
 * @param after - the saved text, split into atoms
 * @param v - furthest x reached per diagonal, updated in place
 * @param depth - the edit distance being tried
 */
const reachesEnd = (before: string[], after: string[], v: Map<number, number>, depth: number): boolean => {
  /* eslint-disable-next-line no-restricted-syntax -- walks the diagonals */
  for (let k = -depth; k <= depth; k += 2) {
    const down = k === -depth || (k !== depth && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0));
    const start = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
    const x = slideDiagonal(before, after, start, start - k);

    v.set(k, x);

    if (x >= before.length && x - k >= after.length) {
      return true;
    }
  }

  return false;
};

/**
 * Re-express edits counted in atoms as the code-unit offsets `Y.Text` indexes
 * by.
 * @param ops - edits whose index and remove count atoms
 * @param beforeAtoms - the stored text, split into atoms
 */
const toUnitOps = (ops: TextEditOp[], beforeAtoms: string[]): TextEditOp[] => {
  const unitAt = unitOffsets(beforeAtoms);

  return ops.map((op) => ({
    index: unitAt[op.index],
    remove: unitAt[op.index + op.remove] - unitAt[op.index],
    insert: op.insert,
  }));
};

/**
 * Myers over a sequence, bounded by `MAX_DIFF_DISTANCE`. Null when the two
 * sequences are further apart than the cap allows the search to look.
 * @param before - the stored text, split into the units being diffed
 * @param after - the saved text, split the same way
 */
const myersOps = (before: string[], after: string[]): TextEditOp[] | null => {
  const limit = Math.min(before.length + after.length, MAX_DIFF_DISTANCE);
  const v = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  /* eslint-disable-next-line no-restricted-syntax -- counts the search depth */
  for (let depth = 0; depth <= limit; depth += 1) {
    trace.push(new Map(v));

    if (reachesEnd(before, after, v, depth)) {
      return toUnitOps(backtrackMyers(trace, before, after, depth), before);
    }
  }

  return null;
};

/**
 * Whitespace runs and non-whitespace runs, in order, concatenating back to
 * `text`. A word is one element, so a bulk edit that rewrites words has an
 * edit distance the size of the words it touched rather than the characters.
 * @param text - the string to split
 */
const tokenize = (text: string): string[] => text.match(/\s+|\S+/gu) ?? [];

/**
 * Where each atom starts, in the code-unit offsets `Y.Text` indexes by, with
 * one extra entry for the end of the string.
 *
 * Pushes into the accumulator: spreading it instead made the prefix sum
 * O(N squared), which is 2 SECONDS of blocked main thread for one keystroke
 * in a 20k-character block — measured.
 * @param atoms - the text, split into atoms
 */
const unitOffsets = (atoms: string[]): number[] => atoms.reduce<number[]>((offsets, atom) => {
  offsets.push(offsets[offsets.length - 1] + atom.length);

  return offsets;
}, [0]);

/**
 * The coarse answer for one span: Myers over its WORDS, and the single region
 * when even that is further than the cap allows.
 *
 * What the single-region answer costs is not characters — the length stays
 * exact — it is POSITION: the one region deletes every character a concurrent
 * keystroke sat between, so Yjs has no surviving neighbour to anchor it to and
 * it surfaces at the edge of the span. Measured with two peers: a two-ended
 * edit of distance 65 moved the other peer's character to index 0 of the block.
 * @param before - the stored span
 * @param after - the saved span
 */
const coarseOps = (before: string, after: string): TextEditOp[] => {
  // Code units, and surrogate-safe: lib0 rolls its own ends back off a
  // surrogate boundary, so the region never starts or ends inside a character.
  const { index, remove, insert } = simpleDiffString(before, after);

  if (remove === 0 && insert === '') {
    return [];
  }

  const wordOps = myersOps(tokenize(before.slice(index, index + remove)), tokenize(insert));

  return wordOps === null
    ? [{ index,
      remove,
      insert }]
    : wordOps.map((op) => ({ ...op,
      index: op.index + index }));
};

/**
 * How many atoms an anchor is measured over. A single atom is almost never
 * unique — every `e` in the paragraph is the same atom — so anchoring on one
 * finds nothing in ordinary prose. Three consecutive atoms is the shortest run
 * that is unique in everyday text: measured, `rd0` (the tail of `word0`) and
 * `重点0` each occur once in their paragraph, where `d0` and `点0` do not.
 */
const ANCHOR_ATOMS = 3;

/**
 * Runs of `ANCHOR_ATOMS` atoms that occur exactly once, keyed by a hash of the
 * run and valued with the atom index it starts at. A repeated run maps to -1,
 * so a lookup answers "unique, and here" in one step.
 *
 * Hashes, not the runs themselves: slicing a key string per position cost 25ms
 * on a 20k-character rewrite — measured — against under 4ms here. A hash can
 * collide, so `anchors` re-reads the two runs and compares them before trusting
 * a pair.
 * @param text - the text being split
 * @param unitAt - where each atom starts, in code units
 */
const singleOccurrences = (text: string, unitAt: number[]): Map<number, number> => {
  const found = new Map<number, number>();
  const last = unitAt.length - ANCHOR_ATOMS;

  /* eslint-disable no-restricted-syntax -- FNV-1a over the run's characters;
     both the index and the accumulator advance inside the loop. */
  for (let index = 0; index < last; index += 1) {
    let hash = 0x811c9dc5;

    for (let at = unitAt[index]; at < unitAt[index + ANCHOR_ATOMS]; at += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193);
    }

    found.set(hash, found.has(hash) ? -1 : index);
  }
  /* eslint-enable no-restricted-syntax */

  return found;
};

/**
 * Where the two texts can only be each other: runs of atoms occurring exactly
 * once on both sides, longest increasing run only so the matches stay in
 * order. Patience diff's anchor step, over atoms rather than lines — a block
 * has no lines, and a CJK one has no words either.
 * @param before - the stored text
 * @param after - the saved text
 * @param beforeUnits - where each of `before`'s atoms starts, in code units
 * @param afterUnits - where each of `after`'s atoms starts, in code units
 */
const anchors = (
  before: string,
  after: string,
  beforeUnits: number[],
  afterUnits: number[]
): Array<[number, number]> => {
  const uniqueInBefore = singleOccurrences(before, beforeUnits);
  const uniqueInAfter = singleOccurrences(after, afterUnits);
  const pairs: Array<[number, number]> = [];

  uniqueInBefore.forEach((index, run) => {
    const inAfter = uniqueInAfter.get(run) ?? -1;
    const matches = index >= 0 && inAfter >= 0 &&
      before.slice(beforeUnits[index], beforeUnits[index + ANCHOR_ATOMS]) ===
      after.slice(afterUnits[inAfter], afterUnits[inAfter + ANCHOR_ATOMS]);

    if (matches) {
      pairs.push([index, inAfter]);
    }
  });

  // A Map iterates in insertion order, which is `before` order for the runs
  // that survived — but a run first seen as a duplicate keeps its early slot,
  // so sort rather than trust it.
  pairs.sort((left, right) => left[0] - right[0]);

  // Patience sort: `piles[length - 1]` is the smallest `after` index any
  // increasing run of that length can end on, and `previous` chains the run
  // back so the winner can be walked out.
  const piles: number[] = [];
  const tails: number[] = [];
  const previous = new Array<number>(pairs.length).fill(-1);

  pairs.forEach(([, afterIndex], pairIndex) => {
    /* eslint-disable no-restricted-syntax -- binary search bounds move per step */
    let low = 0;
    let high = piles.length;

    while (low < high) {
      const middle = (low + high) >> 1;

      if (piles[middle] < afterIndex) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    /* eslint-enable no-restricted-syntax */

    piles[low] = afterIndex;
    tails[low] = pairIndex;
    previous[pairIndex] = low > 0 ? tails[low - 1] : -1;
  });

  const chosen: Array<[number, number]> = [];

  /* eslint-disable-next-line no-restricted-syntax -- walks the chain back */
  for (let at = tails[piles.length - 1] ?? -1; at >= 0; at = previous[at]) {
    chosen.push(pairs[at]);
  }

  return chosen.reverse();
};

/**
 * The smallest set of edits turning `before` into `after`.
 *
 * Minimal, not single-region, because these edits merge with a peer's. A
 * one-region diff describes "wrap this phrase in a tag" as "delete the phrase,
 * insert the tagged phrase" — so two peers wrapping OVERLAPPING phrases each
 * delete what the other re-inserts, and the shared words land twice while the
 * rest is dropped. Measured, and it is why `lib0`'s `simpleDiffString` is the
 * last resort here rather than the answer.
 *
 * Three steps, each narrower than the next is wide:
 *
 * 1. Myers over ATOMS — a whole tag, a whole entity, otherwise one USER-VISIBLE
 *    character (see `atomize`). Never code units: an emoji is two units, and an
 *    edit boundary between them puts the halves in separate CRDT items —
 *    measured, that shows the peer (and the writer) a broken character. Never
 *    bare code points either, or the diff spends a word's own letters on a
 *    tag's name and the peer fixing that letter edits the inside of the tag —
 *    and a peer's edit inherits half of somebody else's accented letter, emoji
 *    or flag.
 * 2. Once the atom distance passes the cap, SPLIT the texts at atoms that occur
 *    exactly once in both — they can only be each other — and answer each gap
 *    between two anchors on its own. A bulk rewrite is then several narrow
 *    answers instead of one block-wide one, and a peer's keystroke in an
 *    untouched gap keeps the neighbours Yjs anchors it to. Anchors are atoms,
 *    not words, so this narrows text with no word breaks at all (CJK) too.
 * 3. Per gap, `coarseOps`: the words of that gap, then the gap's single region.
 *    With no anchors at all — a paste that shares nothing with what it replaces
 *    — there is one gap spanning everything, and the answer is exactly what it
 *    was before any of this existed.
 *
 * LOCKSTEP: packages/server/dotnet/Blok.Server/Collab/TextDiff.cs is a port of
 * this file — the atom units, the anchored split, the fused replace, and the
 * insert-BEFORE-delete apply order in `YDocConverter.EditText`. The two sides
 * must answer the same ops for the same pair, or the same edit merges
 * differently depending on who applied it. The atom is now a whole user-visible
 * character, so the port needs the same: .NET reads the same UAX #29 rules
 * through `StringInfo`/`TextElementEnumerator`.
 * @param before - the stored text
 * @param after - the saved text
 */
export const diffText = (before: string, after: string): TextEditOp[] => {
  const beforeAtoms = atomize(before);
  const afterAtoms = atomize(after);
  const atomOps = myersOps(beforeAtoms, afterAtoms);

  if (atomOps !== null) {
    return atomOps;
  }

  const beforeUnits = unitOffsets(beforeAtoms);
  const afterUnits = unitOffsets(afterAtoms);
  const found = anchors(before, after, beforeUnits, afterUnits);

  if (found.length === 0) {
    return coarseOps(before, after);
  }

  // Anchors are SPLIT POINTS, not consumed matches: every atom stays inside
  // some gap, and each gap's ops turn that gap of `before` into that gap of
  // `after` on their own. The result is then exactly `after` whatever the
  // anchors were — a bad pairing can only cost a worse answer, never a wrong
  // one.
  const bounds = [
    ...found.map(([beforeIndex, afterIndex]) => ({ beforeIndex,
      afterIndex })),
    { beforeIndex: beforeAtoms.length,
      afterIndex: afterAtoms.length },
  ];

  return bounds.reduce<{ ops: TextEditOp[]; beforeFrom: number; afterFrom: number }>((state, anchor) => {
    const beforeText = before.slice(beforeUnits[state.beforeFrom], beforeUnits[anchor.beforeIndex]);
    const afterText = after.slice(afterUnits[state.afterFrom], afterUnits[anchor.afterIndex]);

    if (beforeText !== afterText) {
      const gapAtoms = beforeAtoms.slice(state.beforeFrom, anchor.beforeIndex);
      const gapOps = myersOps(gapAtoms, afterAtoms.slice(state.afterFrom, anchor.afterIndex)) ??
        coarseOps(beforeText, afterText);

      state.ops.push(...gapOps.map((op) => ({ ...op,
        index: op.index + beforeUnits[state.beforeFrom] })));
    }

    return { ops: state.ops,
      beforeFrom: anchor.beforeIndex,
      afterFrom: anchor.afterIndex };
  }, { ops: [],
    beforeFrom: 0,
    afterFrom: 0 }).ops;
};

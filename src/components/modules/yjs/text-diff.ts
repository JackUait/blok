import { simpleDiffString } from './simple-diff';

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
 * Reads a range table shipped as the base-36 gaps between neighbouring bounds.
 * The bounds are sorted, so the gaps are short and ship smaller than hex
 * literals. text-diff-ranges.test.ts holds the written tables and checks them.
 * @param gaps - comma-separated base-36 differences, the first from zero
 */
const fromGaps = (gaps: string): number[] => gaps.split(',').reduce<number[]>((bounds, gap) => {
  bounds.push((bounds.at(-1) ?? 0) + parseInt(gap, 36));

  return bounds;
}, []);

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
export const CLUSTER_HINTS = fromGaps('lc,33,7o,6,7c,18,2,0,2,1,2,1,2,0,1l,5,b,a,1d,k,h,0,2u,7,2,5,3,1,2,3,y,0,2,0,v,q,2k,a,1n,8,a,0,p,3,2,8,2,2,2,4,18,2,1h,f,17,1l,1j,2,2,h,2,6,b,1,u,2,1l,0,2,f,a,0,b,1,r,5,1l,l,v,1,4,0,c,2,1l,0,2,f,l,1,n,9,1l,0,2,p,b,1,v,0,1o,f,a,0,15,4,1k,0,2,o,c,1,u,2,1l,0,2,o,c,1,g,g,1k,1,2,g,9,0,b,1,u,2,1z,l,j,1,1q,0,2,7,d,7,2r,0,2,9,c,6,22,1,s,0,2,0,2,0,5,1,1e,j,2,1,6,1b,a,0,2v,h,o,3,5,2,h,3,e,b,g,0,2r,73,9q,2,qb,3,t,2,u,1,v,1,1t,v,a,0,1a,4,3a,1,z,0,3b,r,64,4,1m,16,1d,2c,1c,g,13,8,d,2,v,c,1l,d,1d,j,49,2,2,k,5,0,7,0,3,2,5j,1r,el,1,5f,w,2db,2,3y,0,2p,v,ff,5,2y,1,n9x,3,2,9,x,1,29,1,7l,0,4,0,5,0,o,4,5,0,2c,1,1f,h,r,h,e,0,13,7,q,c,d,z,1c,d,11,0,1w,d,d,0,9,1,1b,0,1g,0,2,2,3,1,6,1,2,0,16,4,6,1,6l,7,2,1,8n7,23,6xv,0,ki,f,h,f,a7,1');

/**
 * The same, for the code points a surrogate pair carries.
 */
export const ASTRAL_CLUSTER_HINTS = fromGaps('1eyl,0,6b,0,46,4,1af,e,15,7,4m,1,fy,3,1u,4,8u,1,28,3,1z,a,1e,3,3f,2,1i,e,16,0,3,1,b,3,1a,a,3,0,5,b,1f,2,11,d,h,1,19,0,d,2,1d,d,2,1,6,3,2,1,2l,b,7,0,3,0,4e,b,m,3,1k,1,2,f,a,0,b,i,1w,q,f,1,2b,h,o,0,2a,j,6k,h,s,1,2b,g,2z,c,2u,e,75,e,6u,j,3y,f,4,0,t,9,15,b,9,0,a,a,15,l,ba,g,2b,10,3f,m,1v,d,9o,3,a,3,1d,e,o,0,44m,0,7,e,8uh,h,1xd,4,1o,6,fh,0,4,3,dh,0,2,1t,2a,d,f58,1,3mq,1y,f3,4,4,l,3,6,v,3,45,2,1j0,1i,5,1d,9,0,f,0,n,k,11t,16,2t,0,4h,6,ag,0,1q,3,e5,3,73,1,kh,6,32,6,1p8,p,e4,4,gx7l,2n,3l,6n');

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
export const SIMPLE_EXTENDERS = fromGaps('lc,33,7o,6,7c,18,2,0,2,1,2,1,2,0,21,a,1d,k,h,0,2u,6,3,5,3,1,2,3,10,0,v,q,2k,a,1n,8,a,0,p,3,2,8,2,2,2,4,18,2,1o,8,17,n,2,w,1j,2,2,e,2,1,2,6,b,1,u,2,1l,0,2,6,3,1,3,1,b,0,b,1,r,0,3,2,1l,0,2,4,5,1,3,2,4,0,v,1,4,0,c,2,1l,0,2,7,2,2,2,1,m,1,n,5,2,2,1l,0,2,6,3,1,3,1,9,2,b,1,v,0,1o,4,4,2,2,3,a,0,15,4,1k,0,2,6,2,2,2,2,9,1,c,1,u,2,1l,0,2,6,2,2,2,3,8,1,c,1,g,0,d,3,1k,1,2,6,2,2,2,2,b,0,b,1,u,2,1z,0,5,5,2,0,2,7,j,1,1q,0,2,7,d,7,2r,0,2,9,c,6,22,1,s,0,2,0,2,0,5,1,1e,j,2,1,6,a,2,z,a,0,2v,a,2,5,o,3,5,2,h,3,e,0,2,2,7,0,g,0,jk,2,qb,3,t,2,u,1,v,1,1t,v,a,0,1a,2,2,0,3a,1,z,0,3b,b,5,b,64,4,1m,9,2,0,2,0,3,n,3,0,1d,u,1e,4,1c,g,13,8,d,2,v,c,1l,d,1d,j,49,2,2,k,5,0,7,0,3,2,5j,1r,el,0,5g,w,2db,2,3y,0,2p,v,ff,5,2y,1,n9x,3,2,9,x,1,29,1,7l,0,4,0,5,0,o,4,5,0,2c,1,1f,h,r,h,e,0,13,7,q,c,19,3,1c,d,11,0,1w,d,d,0,9,1,1b,0,1g,0,2,2,3,1,6,1,2,0,16,4,6,1,6l,7,2,1,fn5,0,ki,f,h,f,a7,1');

/**
 * Code points that nothing attaches to: UAX #29 GCB Control, CR and LF, which
 * break before whatever follows them (GB4). A newline then U+0301 is TWO
 * characters, not an accented newline, so the cheap append must not fire after
 * one. Pairs of bounds, inclusive. BMP only — an astral Control falls back to
 * ICU, the same as any other astral character.
 */
export const NON_ATTACHING = fromGaps('0,v,2o,w,e,0,12n,0,3jm,0,1kt,0,3,1,p,6,1e,f,17yo,0,6p,b');

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
 * @param markup - false when the text holds no markup, so tags and entities
 *   are not kept whole
 */
export const atomize = (text: string, markup = true): string[] => {
  const runs = clusterRuns(text);

  // Nothing structured to protect: the scanner below is only there to keep a
  // tag and an entity whole, and it costs a tag test and a `slice` per atom.
  if (!markup || (!text.includes('<') && !text.includes('&'))) {
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
  // Code units, and surrogate-safe: simpleDiffString rolls its ends back off a
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
 * rest is dropped. Measured, and it is why `simpleDiffString` is the
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
 * @param options - `markup: false` for text that holds no markup (a formatted
 *   text's characters): `<b>` and `&amp;` there are typed characters, each
 *   its own atom. C# `TextDiff.Diff(…, markup: false)` must match.
 */
export const diffText = (before: string, after: string, options: { markup?: boolean } = {}): TextEditOp[] => {
  const markup = options.markup ?? true;
  const beforeAtoms = atomize(before, markup);
  const afterAtoms = atomize(after, markup);
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

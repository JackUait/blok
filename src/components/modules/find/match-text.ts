/**
 * Text matching for find-in-page.
 *
 * Both sides are folded before comparison: case (unless `matchCase`),
 * diacritics, typographic quotes and dashes, and whitespace runs. Every folded
 * code unit remembers the span of the original text it came from, so a match is
 * reported in ORIGINAL offsets — ready to become a DOM Range.
 */

export interface FindOptions {
  /** Compare letter case exactly. */
  matchCase?: boolean;
  /** Only match when the hit is not part of a longer word. */
  wholeWord?: boolean;
}

export interface TextMatch {
  start: number;
  end: number;
}

interface FoldedText {
  value: string;
  /** Original start offset of each folded code unit. */
  starts: number[];
  /** Original end offset of each folded code unit. */
  ends: number[];
}

const EQUIVALENTS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  '«': '"',
  '»': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '―': '-',
  '−': '-',
  '…': '...',
};

const WHITESPACE = /\s/u;
/**
 * Accents from the Combining Diacritical Marks block only. Stripping every
 * `\p{M}` would also strip Japanese voicing marks (が → か) and, with NFD,
 * split Hangul syllables into jamo that match a prefix of another syllable.
 */
const DIACRITICS = /[\u0300-\u036f]/gu;
/** Zero-width spaces, joiners, soft hyphens: invisible, so the reader never typed them. */
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

const foldCodePoint = (char: string, matchCase: boolean): string => {
  const mapped = EQUIVALENTS[char] ?? char;
  const cased = matchCase ? mapped : mapped.toLowerCase();

  if (IGNORABLE.test(mapped)) {
    return '';
  }

  return cased.normalize('NFD').replace(DIACRITICS, '').normalize('NFC');
};

const fold = (text: string, matchCase: boolean): FoldedText => {
  const folded: FoldedText = { value: '', starts: [], ends: [] };

  const push = (piece: string, start: number, end: number): void => {
    folded.value += piece;
    Array.from({ length: piece.length }).forEach(() => {
      folded.starts.push(start);
      folded.ends.push(end);
    });
  };

  // Grows the previous folded unit over a character that folds into it.
  const extendLast = (end: number): void => {
    if (folded.ends.length > 0) {
      folded.ends[folded.ends.length - 1] = end;
    }
  };

  Array.from(text).reduce((start, char) => {
    const end = start + char.length;
    const isSpace = WHITESPACE.test(char);
    const piece = isSpace ? ' ' : foldCodePoint(char, matchCase);

    // A whitespace run folds to one space; a lone accent or an invisible character folds to nothing.
    if (piece === '' || (isSpace && folded.value.endsWith(' '))) {
      extendLast(end);
    } else {
      push(piece, start, end);
    }

    return end;
  }, 0);

  return folded;
};

const isWordCharBefore = (text: string, index: number): boolean => {
  const before = Array.from(text.slice(Math.max(0, index - 2), index)).pop();

  return before !== undefined && WORD_CHAR.test(before);
};

const isWordCharAfter = (text: string, index: number): boolean => {
  const after = text.codePointAt(index);

  return after !== undefined && WORD_CHAR.test(String.fromCodePoint(after));
};

/**
 * Find every non-overlapping occurrence of `query` in `text`.
 * @param text - text to search
 * @param query - what the user typed
 * @param options - case and whole-word switches
 */
export const findTextMatches = (text: string, query: string, options: FindOptions = {}): TextMatch[] => {
  const matchCase = options.matchCase === true;
  const needle = fold(query.trim(), matchCase).value;

  if (needle === '' || text === '') {
    return [];
  }

  const haystack = fold(text, matchCase);
  const matches: TextMatch[] = [];
  const cursor = { from: 0 };

  while (cursor.from <= haystack.value.length - needle.length) {
    const hit = haystack.value.indexOf(needle, cursor.from);

    if (hit === -1) {
      break;
    }

    const start = haystack.starts[hit];
    const end = haystack.ends[hit + needle.length - 1];
    const last = hit + needle.length - 1;
    // A character that folds to several ("…" → "...") matches whole or not at all.
    const splitsCharacter = haystack.starts[hit - 1] === start || haystack.starts[last + 1] === haystack.starts[last];
    const isWhole = !options.wholeWord || (!isWordCharBefore(text, start) && !isWordCharAfter(text, end));
    const isMatch = isWhole && !splitsCharacter;

    if (isMatch) {
      matches.push({ start, end });
    }
    cursor.from = isMatch ? hit + needle.length : hit + 1;
  }

  return matches;
};

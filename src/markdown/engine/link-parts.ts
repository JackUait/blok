/**
 * Scanners for the three parts of a link that definitions (block level) and
 * inline links share: `[label]`, a destination and a title. Each reads `src`
 * from `pos` and returns the raw text (escapes and references NOT decoded)
 * with the index just past it, or null when no such part starts there.
 */

export interface Scanned {
  /** The part's text without its delimiters, as written. */
  value: string;
  /** Index just past the part. */
  end: number;
}

/** Labels longer than this are not labels, which keeps lookups cheap. */
const MAX_LABEL = 999;

const isAsciiControl = (code: number): boolean => code < 32 || code === 127;

const isLineEnding = (char: string): boolean => char === '\n' || char === '\r';

/**
 * How far a character at `index` moves the scan: 2 for a backslash before
 * one of `escapable`, else 1.
 * @param src - source text
 * @param index - current index
 * @param escapable - characters a backslash escapes here
 */
const step = (src: string, index: number, escapable: string): number =>
  src[index] === '\\' && index + 1 < src.length && escapable.includes(src[index + 1]) ? 2 : 1;

/**
 * `[label]`: no unescaped brackets, at least one character that is not a
 * space, tab or line ending, at most 999 characters besides line endings.
 * @param src - source text
 * @param pos - index of the `[`
 */
export const scanLinkLabel = (src: string, pos: number): Scanned | null => {
  if (src[pos] !== '[') {
    return null;
  }

  const cursor = { index: pos + 1, seen: false, size: 0 };

  while (cursor.index < src.length && cursor.size <= MAX_LABEL) {
    const char = src[cursor.index];

    if (char === '[') {
      return null;
    }

    if (char === ']') {
      return cursor.seen ? { value: src.slice(pos + 1, cursor.index), end: cursor.index + 1 } : null;
    }

    const width = step(src, cursor.index, '[]\\');

    cursor.seen ||= char !== ' ' && char !== '\t' && !isLineEnding(char);
    cursor.size += isLineEnding(char) ? 0 : width;
    cursor.index += width;
  }

  return null;
};

/**
 * `<…>`: no line ending, no unescaped `<`.
 * @param src - source text
 * @param pos - index of the `<`
 */
const scanEnclosedDestination = (src: string, pos: number): Scanned | null => {
  const cursor = { index: pos + 1 };

  while (cursor.index < src.length) {
    const char = src[cursor.index];

    if (char === '>') {
      return { value: src.slice(pos + 1, cursor.index), end: cursor.index + 1 };
    }

    if (char === '<' || isLineEnding(char)) {
      return null;
    }

    cursor.index += step(src, cursor.index, '<>\\');
  }

  return null;
};

/**
 * A run with no space or control character whose unescaped parens balance.
 * @param src - source text
 * @param pos - index of the first character
 * @param maxDepth - how deep parens may nest; a deeper `(` fails the match
 */
const scanRawDestination = (src: string, pos: number, maxDepth: number): Scanned | null => {
  const cursor = { index: pos, depth: 0 };

  while (cursor.index < src.length) {
    const char = src[cursor.index];
    const atTop = cursor.depth === 0;

    if (atTop && (char === ')' || char === ' ' || char === '\t' || isLineEnding(char))) {
      break;
    }

    if (char === '(' && cursor.depth < maxDepth) {
      cursor.depth++;
    } else if (char === ')') {
      cursor.depth--;
    } else if (char === ' ' || char === '(' || isAsciiControl(char.charCodeAt(0))) {
      return null;
    }

    cursor.index += step(src, cursor.index, '()\\');
  }

  return cursor.depth !== 0 || cursor.index === pos ? null : { value: src.slice(pos, cursor.index), end: cursor.index };
};

/**
 * A destination, enclosed in `<…>` or raw.
 * @param src - source text
 * @param pos - index of the first character
 * @param maxDepth - how deep raw parens may nest
 */
export const scanLinkDestination = (src: string, pos: number, maxDepth = Number.POSITIVE_INFINITY): Scanned | null =>
  src[pos] === '<' ? scanEnclosedDestination(src, pos) : scanRawDestination(src, pos, maxDepth);

const TITLE_CLOSERS: Record<string, string> = { '"': '"', '\'': '\'', '(': ')' };

/**
 * A title in `"…"`, `'…'` or `(…)`, ended by the first unescaped closer. A
 * backslash escapes only the closer or another backslash. An unescaped `(`
 * inside parens is allowed, as the parser Blok used before allowed it.
 * @param src - source text
 * @param pos - index of the opening quote or paren
 */
export const scanLinkTitle = (src: string, pos: number): Scanned | null => {
  const close = TITLE_CLOSERS[src[pos]];

  if (close === undefined) {
    return null;
  }

  const cursor = { index: pos + 1 };

  while (cursor.index < src.length) {
    if (src[cursor.index] === close) {
      return { value: src.slice(pos + 1, cursor.index), end: cursor.index + 1 };
    }

    cursor.index += step(src, cursor.index, `${close}\\`);
  }

  return null;
};

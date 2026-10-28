import { isAsciiAlpha, isSpaceOrLineEnding } from './inline-scan';

/**
 * Raw inline HTML: open and closing tags, comments, processing
 * instructions, declarations and CDATA. Line endings may sit inside.
 */

/**
 * Finds the next occurrence of a needle. Caches the last answer per needle,
 * so a run of `<!--` with no `-->` costs one scan, not one per opener.
 */
export class NextIndex {
  private readonly cache = new Map<string, { from: number; found: number }>();

  /** @param src - source text */
  constructor(private readonly src: string) {}

  /**
   * Index of `needle` at or after `from`, or -1.
   * @param needle - text to find
   * @param from - earliest index
   */
  public find(needle: string, from: number): number {
    const hit = this.cache.get(needle);

    if (hit !== undefined && hit.from <= from && (hit.found === -1 || from <= hit.found)) {
      return hit.found;
    }

    const found = this.src.indexOf(needle, from);

    this.cache.set(needle, { from, found });

    return found;
  }
}

const TAG_NAME = /[A-Za-z][-\dA-Za-z]*/y;
const ATTRIBUTE_NAME = /[:A-Z_a-z][-.:\dA-Z_a-z]*/y;
/** A `/` may start an unquoted value but not continue one. */
const UNQUOTED_VALUE = /[^\t\n\r "'<=>`][^\t\n\r "'/<=>`]*/y;

/**
 * End index after `>` of the comment, instruction, CDATA or declaration
 * starting at `pos`, or -1.
 * @param src - source text
 * @param pos - index of the `<`
 * @param next - shared needle finder
 */
const scanDeclarationLike = (src: string, pos: number, next: NextIndex): number => {
  const end = (needle: string, from: number): number => {
    const at = next.find(needle, from);

    return at === -1 ? -1 : at + needle.length;
  };

  if (src[pos + 1] === '?') {
    return end('?>', pos + 2);
  }

  if (src.startsWith('<!--', pos)) {
    return end('-->', pos + 2);
  }

  if (src.startsWith('<![CDATA[', pos)) {
    return end(']]>', pos + 9);
  }

  return src[pos + 1] === '!' && isAsciiAlpha(src[pos + 2]) ? end('>', pos + 3) : -1;
};

/**
 * Skip spaces, tabs and line endings.
 * @param src - source text
 * @param pos - first index to look at
 */
const skipWhitespace = (src: string, pos: number): number => {
  const cursor = { at: pos };

  while (isSpaceOrLineEnding(src[cursor.at])) {
    cursor.at++;
  }

  return cursor.at;
};

/**
 * Index just past an attribute value (`=` already consumed, whitespace
 * before the value allowed), or -1.
 * @param src - source text
 * @param pos - index after the `=`
 * @param next - shared needle finder
 */
const scanAttributeValue = (src: string, pos: number, next: NextIndex): number => {
  const start = skipWhitespace(src, pos);
  const quote = src[start];

  if (quote === '"' || quote === '\'') {
    const close = next.find(quote, start + 1);

    return close === -1 ? -1 : close + 1;
  }

  UNQUOTED_VALUE.lastIndex = start;

  return UNQUOTED_VALUE.exec(src) === null ? -1 : UNQUOTED_VALUE.lastIndex;
};

/**
 * End index of the open tag at `pos`, or -1.
 * @param src - source text
 * @param pos - index of the `<`
 * @param next - shared needle finder
 */
const scanOpenTag = (src: string, pos: number, next: NextIndex): number => {
  TAG_NAME.lastIndex = pos + 1;

  if (TAG_NAME.exec(src) === null) {
    return -1;
  }

  const cursor = { at: TAG_NAME.lastIndex };

  for (;;) {
    const gap = skipWhitespace(src, cursor.at);

    ATTRIBUTE_NAME.lastIndex = gap;

    if (gap === cursor.at || ATTRIBUTE_NAME.exec(src) === null) {
      break;
    }

    const afterName = skipWhitespace(src, ATTRIBUTE_NAME.lastIndex);
    const value = src[afterName] === '=' ? scanAttributeValue(src, afterName + 1, next) : ATTRIBUTE_NAME.lastIndex;

    if (value === -1) {
      return -1;
    }

    cursor.at = value;
  }

  const close = skipWhitespace(src, cursor.at);

  if (src[close] === '/') {
    return src[close + 1] === '>' ? close + 2 : -1;
  }

  return src[close] === '>' ? close + 1 : -1;
};

/**
 * End index of the raw HTML at `pos` (the `<`), or -1.
 * @param src - source text
 * @param pos - index of the `<`
 * @param next - shared needle finder
 */
export const scanHtml = (src: string, pos: number, next: NextIndex): number => {
  const second = src[pos + 1];

  if (second === '!' || second === '?') {
    return scanDeclarationLike(src, pos, next);
  }

  if (second === '/') {
    TAG_NAME.lastIndex = pos + 2;

    if (TAG_NAME.exec(src) === null) {
      return -1;
    }

    const close = skipWhitespace(src, TAG_NAME.lastIndex);

    return src[close] === '>' ? close + 1 : -1;
  }

  return isAsciiAlpha(second) ? scanOpenTag(src, pos, next) : -1;
};


import { isAsciiAlpha, runEnd, skipWhitespace } from './text';

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

const isTagChar = (char: string): boolean => /^[-\dA-Za-z]$/.test(char);
const isAttributeStart = (char: string | undefined): boolean => char !== undefined && /^[:A-Z_a-z]$/.test(char);
const isAttributeChar = (char: string): boolean => /^[-.:\dA-Z_a-z]$/.test(char);
/** A `/` may start an unquoted value but not continue one. */
const isUnquotedStart = (char: string | undefined): boolean => char !== undefined && !/^[\t\n\r "'<=>`]$/.test(char);
const isUnquotedChar = (char: string): boolean => !/^[\t\n\r "'/<=>`]$/.test(char);

/**
 * Index past the tag name at `pos`, or -1.
 * @param src - source text
 * @param pos - where the name must start
 */
const scanTagName = (src: string, pos: number): number => (isAsciiAlpha(src[pos]) ? runEnd(src, pos + 1, isTagChar) : -1);

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

  return isUnquotedStart(src[start]) ? runEnd(src, start + 1, isUnquotedChar) : -1;
};

/**
 * End index of the open tag at `pos`, or -1.
 * @param src - source text
 * @param pos - index of the `<`
 * @param next - shared needle finder
 */
const scanOpenTag = (src: string, pos: number, next: NextIndex): number => {
  const name = scanTagName(src, pos + 1);

  if (name === -1) {
    return -1;
  }

  const cursor = { at: name };

  for (;;) {
    const gap = skipWhitespace(src, cursor.at);

    if (gap === cursor.at || !isAttributeStart(src[gap])) {
      break;
    }

    const nameEnd = runEnd(src, gap + 1, isAttributeChar);
    const afterName = skipWhitespace(src, nameEnd);
    const value = src[afterName] === '=' ? scanAttributeValue(src, afterName + 1, next) : nameEnd;

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
    const name = scanTagName(src, pos + 2);

    if (name === -1) {
      return -1;
    }

    const close = skipWhitespace(src, name);

    return src[close] === '>' ? close + 1 : -1;
  }

  return isAsciiAlpha(second) ? scanOpenTag(src, pos, next) : -1;
};


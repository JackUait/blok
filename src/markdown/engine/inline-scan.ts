import { decodeNamedEntity, decodeNumericEntity } from './text';

/**
 * Scanners for the inline constructs that are read in one go from their
 * opening character: references, code and math spans, autolinks and raw
 * HTML. Each takes the source and a start index and returns where the
 * construct ends, or -1 when none starts there.
 */

export const isAsciiAlpha = (char: string | undefined): boolean => char !== undefined && /^[A-Za-z]$/.test(char);

export const isAsciiAlphanumeric = (char: string | undefined): boolean => char !== undefined && /^[\dA-Za-z]$/.test(char);

export const isLineEnding = (char: string | undefined): boolean => char === '\n' || char === '\r';

export const isSpaceOrTab = (char: string | undefined): boolean => char === ' ' || char === '\t';

/** Space, tab or line ending: what CommonMark calls whitespace inside constructs. */
export const isSpaceOrLineEnding = (char: string | undefined): boolean => isSpaceOrTab(char) || isLineEnding(char);

/** Controls, tab and line endings included. */
export const isAsciiControl = (char: string | undefined): boolean => {
  const code = char === undefined ? -1 : char.charCodeAt(0);

  return code >= 0 && (code < 32 || code === 127);
};

/** The characters an email autolink's local part may hold (no `!`, as before). */
const ATEXT = /^[#-'*+\--9=?A-Z^-~]$/;

/**
 * Length of the line ending at `index`: 2 for CRLF, 1 for LF or CR, else 0.
 * @param src - source text
 * @param index - where the line ending may start
 */
export const lineEndingLength = (src: string, index: number): number => {
  if (src[index] === '\r') {
    return src[index + 1] === '\n' ? 2 : 1;
  }

  return src[index] === '\n' ? 1 : 0;
};

const REFERENCE_BODY = { hex: /^[\dA-Fa-f]{1,6}/, decimal: /^\d{1,7}/, named: /^[\dA-Za-z]{1,31}/ };

const referenceKind = (numeric: boolean, hex: boolean): keyof typeof REFERENCE_BODY => {
  if (hex) {
    return 'hex';
  }

  return numeric ? 'decimal' : 'named';
};

export interface Decoded {
  value: string;
  end: number;
}

/**
 * A character reference at `pos` (the `&`): `&amp;`, `&#35;`, `&#x23;`.
 * Named ones must be HTML entities.
 * @param src - source text
 * @param pos - index of the `&`
 */
export const scanCharacterReference = (src: string, pos: number): Decoded | null => {
  const numeric = src[pos + 1] === '#';
  const hex = numeric && (src[pos + 2] === 'x' || src[pos + 2] === 'X');
  const start = pos + 1 + (numeric ? 1 : 0) + (hex ? 1 : 0);
  const pattern = REFERENCE_BODY[referenceKind(numeric, hex)];
  const match = pattern.exec(src.slice(start, start + 32));

  if (match === null || src[start + match[0].length] !== ';') {
    return null;
  }

  const end = start + match[0].length + 1;

  if (numeric) {
    return { value: decodeNumericEntity(match[0], hex ? 16 : 10), end };
  }

  const value = decodeNamedEntity(match[0]);

  return value === undefined ? null : { value, end };
};

/**
 * The maximal runs of one character (backticks or dollars), found once, so
 * looking for a closing run never rescans the source.
 */
export class RunIndex {
  private readonly starts = new Map<number, number[]>();
  private readonly cursors = new Map<number, number>();

  /**
   * @param src - source text
   * @param char - the run character
   */
  constructor(src: string, char: string) {
    const pattern = new RegExp(`\\${char}+`, 'g');

    for (const match of src.matchAll(pattern)) {
      const list = this.starts.get(match[0].length) ?? [];

      list.push(match.index);
      this.starts.set(match[0].length, list);
    }
  }

  /**
   * Start of the first run of exactly `size` characters at or after `from`,
   * or -1. Calls must come with `from` never decreasing for one size.
   * @param from - earliest start
   * @param size - run length
   */
  public next(from: number, size: number): number {
    const list = this.starts.get(size) ?? [];
    const cursor = { at: this.cursors.get(size) ?? 0 };

    while (cursor.at < list.length && list[cursor.at] < from) {
      cursor.at++;
    }

    this.cursors.set(size, cursor.at);

    return cursor.at < list.length ? list[cursor.at] : -1;
  }
}

/**
 * Content of a code or math span with one padding character stripped from
 * each side, when both sides have one and the content is not all padding.
 * A line ending counts as padding; a tab does not.
 * @param content - text between the sequences
 */
export const stripSpanPadding = (content: string): string => {
  const head = content[0] === ' ' ? 1 : lineEndingLength(content, 0);
  const last = content.length - 1;
  const crlfTail = content.endsWith('\r\n') ? 2 : 0;
  const tail = content[last] === ' ' || content[last] === '\n' || content[last] === '\r' ? Math.max(1, crlfTail) : 0;

  if (head === 0 || tail === 0 || !/[^ \r\n]/.test(content)) {
    return content;
  }

  return content.slice(head, content.length - tail);
};

export interface Autolink {
  url: string;
  value: string;
  end: number;
}

const URI_AUTOLINK = /[A-Za-z][+\-.\dA-Za-z]{1,31}:[^\0- <>\x7F]*>/y;

const EMAIL_LABEL = '[\\dA-Za-z](?:[-\\dA-Za-z]{0,61}[\\dA-Za-z])?';

const EMAIL_AUTOLINK = new RegExp(`[#-'*+\\--9=?A-Z^-~]+@${EMAIL_LABEL}(?:\\.${EMAIL_LABEL})*>`, 'y');

/**
 * `<scheme:…>` or `<local@domain>` at `pos` (the `<`).
 * @param src - source text
 * @param pos - index of the `<`
 */
export const scanAutolink = (src: string, pos: number): Autolink | null => {
  URI_AUTOLINK.lastIndex = pos + 1;

  const uri = URI_AUTOLINK.exec(src);

  if (uri !== null) {
    const value = uri[0].slice(0, -1);

    return { url: value, value, end: pos + 1 + uri[0].length };
  }

  EMAIL_AUTOLINK.lastIndex = pos + 1;

  const email = EMAIL_AUTOLINK.exec(src);

  if (email === null) {
    return null;
  }

  const value = email[0].slice(0, -1);

  return { url: `mailto:${value}`, value, end: pos + 1 + email[0].length };
};

export const isAtext = (char: string | undefined): boolean => char !== undefined && ATEXT.test(char);

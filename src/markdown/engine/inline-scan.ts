/**
 * Helpers for the inline scanner: line ending widths, the run index that
 * code and math spans find their closers with, span padding, and
 * autolinks. Raw HTML is in inline-html.ts, references in text.ts.
 */

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
 * @param holdsTabRest - the content holds columns of a tab a container cut, which count as content
 */
export const stripSpanPadding = (content: string, holdsTabRest = false): string => {
  const head = content[0] === ' ' ? 1 : lineEndingLength(content, 0);
  const last = content.length - 1;
  const crlfTail = content.endsWith('\r\n') ? 2 : 0;
  const tail = content[last] === ' ' || content[last] === '\n' || content[last] === '\r' ? Math.max(1, crlfTail) : 0;

  if (head === 0 || tail === 0 || (!holdsTabRest && !/[^ \r\n]/.test(content))) {
    return content;
  }

  return content.slice(head, content.length - tail);
};

interface Autolink {
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

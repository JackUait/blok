/**
 * Line-level scanners for the block parser. Each reads one line (no line
 * ending) from a start index and answers whether a block construct starts
 * there. All are single forward passes: no regex that can backtrack.
 */

import { isAsciiAlpha, isSpaceOrTab, MAX_LABEL, runLength, skipSpaces } from './text';

export type Align = 'left' | 'right' | 'center' | null;

/**
 * The string without trailing spaces and tabs.
 * @param value - any string
 */
export const trimEnd = (value: string): string => {
  const cursor = { end: value.length };

  while (cursor.end > 0 && isSpaceOrTab(value[cursor.end - 1])) {
    cursor.end--;
  }

  return value.slice(0, cursor.end);
};

/**
 * The string without leading spaces and tabs. Paragraph text keeps the
 * indentation of its later lines: code spans and raw HTML keep it, and the
 * inline parser drops it elsewhere.
 * @param value - any string
 */
export const trimStart = (value: string): string => value.slice(skipSpaces(value, 0));

/**
 * The string without leading and trailing spaces and tabs.
 * @param value - any string
 */
const trimSpaces = (value: string): string => trimEnd(value.slice(skipSpaces(value, 0)));

/**
 * An ATX heading at `pos`: its depth and its content without the closing
 * sequence, or null.
 * @param line - the line
 * @param pos - index of the first `#`
 */
export const scanAtxHeading = (line: string, pos: number): { depth: number; raw: string } | null => {
  const depth = runLength(line, pos, '#');
  const after = pos + depth;

  if (depth < 1 || depth > 6 || (after < line.length && !isSpaceOrTab(line[after]))) {
    return null;
  }

  const content = trimSpaces(line.slice(after));
  const closing = content.length - trimEndChar(content, '#').length;

  if (closing === content.length) {
    return { depth, raw: '' };
  }

  if (closing > 0 && isSpaceOrTab(content[content.length - closing - 1])) {
    return { depth, raw: trimEnd(content.slice(0, content.length - closing)) };
  }

  return { depth, raw: content };
};

/**
 * The string without a trailing run of `char`.
 * @param value - any string
 * @param char - the character to drop
 */
const trimEndChar = (value: string, char: string): string => {
  const cursor = { end: value.length };

  while (cursor.end > 0 && value[cursor.end - 1] === char) {
    cursor.end--;
  }

  return value.slice(0, cursor.end);
};

/**
 * Whether the rest of the line from `pos` is a thematic break: three or more
 * of one of `*`, `-`, `_`, with only spaces or tabs between.
 * @param line - the line
 * @param pos - index of the first marker
 */
export const isThematicBreak = (line: string, pos: number): boolean => {
  const marker = line[pos];

  if (marker !== '*' && marker !== '-' && marker !== '_') {
    return false;
  }

  const state = { count: 0, index: pos };

  while (state.index < line.length) {
    const char = line[state.index];

    if (char === marker) {
      state.count++;
    } else if (!isSpaceOrTab(char)) {
      return false;
    }

    state.index++;
  }

  return state.count >= 3;
};

/**
 * A setext underline at `pos`: 1 for `=`, 2 for `-`, else 0.
 * @param line - the line
 * @param pos - index of the first marker
 */
export const setextLevel = (line: string, pos: number): number => {
  const marker = line[pos];

  if (marker !== '=' && marker !== '-') {
    return 0;
  }

  const end = skipSpaces(line, pos + runLength(line, pos, marker));

  if (end < line.length) {
    return 0;
  }

  return marker === '=' ? 1 : 2;
};

interface FenceOpen {
  char: string;
  length: number;
  /** Everything after the fence. */
  info: string;
}

/**
 * A code fence opening at `pos`, or null.
 * @param line - the line
 * @param pos - index of the first fence character
 */
export const scanCodeFence = (line: string, pos: number): FenceOpen | null => {
  const char = line[pos];

  if (char !== '`' && char !== '~') {
    return null;
  }

  const length = runLength(line, pos, char);
  const info = line.slice(pos + length);

  if (length < 3 || (char === '`' && info.includes('`'))) {
    return null;
  }

  return { char, length, info };
};

/**
 * A math fence opening at `pos`, or null. The meta may not hold a `$`.
 * @param line - the line
 * @param pos - index of the first `$`
 */
export const scanMathFence = (line: string, pos: number): FenceOpen | null => {
  const length = runLength(line, pos, '$');
  const info = line.slice(pos + length);

  if (length < 2 || info.includes('$')) {
    return null;
  }

  return { char: '$', length, info };
};

/**
 * Whether the line from `pos` closes a fence: at least `length` of `char`,
 * then only spaces or tabs.
 * @param line - the line
 * @param pos - index of the first non-space character
 * @param char - the fence character
 * @param length - the opening fence length
 */
export const isClosingFence = (line: string, pos: number, char: string, length: number): boolean => {
  const run = runLength(line, pos, char);

  return run >= length && skipSpaces(line, pos + run) === line.length;
};

/**
 * Split a fence info string into lang and meta, both still encoded.
 * @param info - what follows the opening fence
 */
export const splitInfo = (info: string): { lang: string | null; meta: string | null } => {
  const start = skipSpaces(info, 0);
  const cursor = { end: start };

  while (cursor.end < info.length && !isSpaceOrTab(info[cursor.end])) {
    cursor.end++;
  }

  const lang = info.slice(start, cursor.end);
  const meta = info.slice(skipSpaces(info, cursor.end));

  return { lang: lang === '' ? null : lang, meta: meta === '' ? null : meta };
};

/**
 * A list marker at `pos`: the bullet character or the ordered delimiter, the
 * number as written, and the index just past the marker.
 * @param line - the line
 * @param pos - index of the first marker character
 */
export const scanListMarker = (line: string, pos: number): { marker: string; ordered: boolean; digits: string; end: number } | null => {
  const char = line[pos];

  if (char === '*' || char === '+' || char === '-') {
    return { marker: char, ordered: false, digits: '', end: pos + 1 };
  }

  const cursor = { index: pos };

  while (cursor.index - pos < 9 && isDigit(line[cursor.index])) {
    cursor.index++;
  }

  const delimiter = line[cursor.index];

  if (cursor.index === pos || (delimiter !== '.' && delimiter !== ')')) {
    return null;
  }

  return { marker: delimiter, ordered: true, digits: line.slice(pos, cursor.index), end: cursor.index + 1 };
};

const isDigit = (char: string | undefined): boolean => char !== undefined && char >= '0' && char <= '9';

/**
 * A GFM footnote definition label at `pos` (`[^label]:`): the label as
 * written and the index just past the colon, or null. No whitespace is
 * allowed inside, which is what GitHub does.
 * @param line - the line
 * @param pos - index of the `[`
 */
export const scanFootnoteLabel = (line: string, pos: number): { label: string; end: number } | null => {
  if (line[pos] !== '[' || line[pos + 1] !== '^') {
    return null;
  }

  const cursor = { index: pos + 2 };

  while (cursor.index < line.length && cursor.index - pos - 2 <= MAX_LABEL) {
    const char = line[cursor.index];

    if (char === ']') {
      return cursor.index === pos + 2 || line[cursor.index + 1] !== ':'
        ? null
        : { label: line.slice(pos + 2, cursor.index), end: cursor.index + 2 };
    }

    if (char === '[' || isSpaceOrTab(char)) {
      return null;
    }

    cursor.index += char === '\\' && '[\\]'.includes(line[cursor.index + 1] ?? 'x') ? 2 : 1;
  }

  return null;
};

/**
 * A GFM table delimiter row from `pos`: one alignment per cell, or null.
 * It needs at least one `|` or `:`, so `---` stays a setext underline.
 * @param line - the line
 * @param pos - index of the first non-space character
 */
export const scanDelimiterRow = (line: string, pos: number): Align[] | null => {
  const state = { index: pos, seen: false };
  const aligns: Align[] = [];

  if (line[state.index] === '|') {
    state.seen = true;
    state.index++;
  }

  while (skipSpaces(line, state.index) < line.length) {
    const cell = scanDelimiterCell(line, skipSpaces(line, state.index));

    if (cell === null) {
      return null;
    }

    aligns.push(cell.align);
    state.seen ||= cell.colon;
    state.index = skipSpaces(line, cell.end);

    if (state.index < line.length && line[state.index] !== '|') {
      return null;
    }

    state.seen ||= state.index < line.length;
    state.index++;
  }

  return state.seen ? aligns : null;
};

/**
 * One delimiter cell, `:?-+:?`.
 * @param line - the line
 * @param pos - index of its first character
 */
const scanDelimiterCell = (line: string, pos: number): { align: Align; colon: boolean; end: number } | null => {
  const left = line[pos] === ':';
  const dashStart = left ? pos + 1 : pos;
  const dashes = runLength(line, dashStart, '-');

  if (dashes === 0) {
    return null;
  }

  const right = line[dashStart + dashes] === ':';
  const end = dashStart + dashes + (right ? 1 : 0);

  return { align: alignOf(left, right), colon: left || right, end };
};

/**
 * The alignment two colon flags spell.
 * @param left - a colon before the dashes
 * @param right - a colon after the dashes
 */
const alignOf = (left: boolean, right: boolean): Align => {
  if (left && right) {
    return 'center';
  }

  if (left) {
    return 'left';
  }

  return right ? 'right' : null;
};

/**
 * The cells of a table row, trimmed. `\|` and `\\` do not split; a leading
 * pipe and a trailing pipe open and close the row instead of making cells.
 * @param line - the row, leading whitespace removed
 */
export const splitRow = (line: string): string[] => {
  const segments: string[] = [];
  const cursor = { index: 0, start: 0 };

  while (cursor.index < line.length) {
    const char = line[cursor.index];

    if (char === '\\' && (line[cursor.index + 1] === '\\' || line[cursor.index + 1] === '|')) {
      cursor.index += 2;
      continue;
    }

    if (char === '|') {
      segments.push(line.slice(cursor.start, cursor.index));
      cursor.start = cursor.index + 1;
    }

    cursor.index++;
  }

  segments.push(line.slice(cursor.start));

  if (line[0] === '|') {
    segments.shift();
  }

  if (segments.length > 1 && trimSpaces(segments[segments.length - 1]) === '') {
    segments.pop();
  }

  return segments.map(trimSpaces);
};

const HTML_RAW_TAGS = ['script', 'pre', 'style', 'textarea'];

const HTML_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup',
  'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame',
  'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link',
  'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section',
  'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
]);

const isTagNameChar = (char: string | undefined): boolean => char !== undefined && /^[A-Za-z0-9-]$/.test(char);

/**
 * The tag name at `pos` (letters, digits, dashes, starting with a letter).
 * @param line - the line
 * @param pos - index of the first letter
 */
const tagNameAt = (line: string, pos: number): string => {
  if (!isAsciiAlpha(line[pos])) {
    return '';
  }

  const cursor = { index: pos + 1 };

  while (isTagNameChar(line[cursor.index])) {
    cursor.index++;
  }

  return line.slice(pos, cursor.index);
};

/**
 * Which HTML block (1–7) starts at `pos`, or 0. Kind 7 cannot interrupt a
 * paragraph.
 * @param line - the line
 * @param pos - index of the `<`
 * @param inParagraph - whether a paragraph is open
 */
export const htmlBlockStart = (line: string, pos: number, inParagraph: boolean): number => {
  if (line[pos] !== '<') {
    return 0;
  }

  const special = specialHtmlStart(line, pos);

  if (special !== 0) {
    return special;
  }

  const closing = line[pos + 1] === '/';
  const name = tagNameAt(line, pos + (closing ? 2 : 1));
  const after = pos + (closing ? 2 : 1) + name.length;
  const next = line[after];
  const lower = name.toLowerCase();

  if (!closing && HTML_RAW_TAGS.includes(lower) && (next === undefined || next === '>' || isSpaceOrTab(next))) {
    return 1;
  }

  if (HTML_BLOCK_TAGS.has(lower) && (next === undefined || next === '>' || isSpaceOrTab(next) || line.startsWith('/>', after))) {
    return 6;
  }

  if (inParagraph || name === '') {
    return 0;
  }

  const end = closing ? scanClosingTagRest(line, after) : scanOpenTagRest(line, after);

  return end !== -1 && skipSpaces(line, end) === line.length ? 7 : 0;
};

/**
 * Kinds 2–5: comment, processing instruction, declaration, CDATA.
 * @param line - the line
 * @param pos - index of the `<`
 */
const specialHtmlStart = (line: string, pos: number): number => {
  if (line.startsWith('<!--', pos)) {
    return 2;
  }

  if (line.startsWith('<?', pos)) {
    return 3;
  }

  if (line.startsWith('<![CDATA[', pos)) {
    return 5;
  }

  return line[pos + 1] === '!' && isAsciiAlpha(line[pos + 2]) ? 4 : 0;
};

/**
 * Past `</name`: optional whitespace and `>`. Returns the index after `>`,
 * or -1.
 * @param line - the line
 * @param pos - index after the tag name
 */
const scanClosingTagRest = (line: string, pos: number): number => {
  const end = skipSpaces(line, pos);

  return line[end] === '>' ? end + 1 : -1;
};

/**
 * Past `<name`: attributes, optional `/`, and `>`. Returns the index after
 * `>`, or -1.
 * @param line - the line
 * @param pos - index after the tag name
 */
const scanOpenTagRest = (line: string, pos: number): number => {
  const cursor = { index: pos };

  while (cursor.index < line.length) {
    const spaced = skipSpaces(line, cursor.index);
    const char = line[spaced];

    if (char === '>') {
      return spaced + 1;
    }

    if (char === '/') {
      return line[spaced + 1] === '>' ? spaced + 2 : -1;
    }

    const attribute = spaced > cursor.index ? scanAttribute(line, spaced) : -1;

    if (attribute === -1) {
      return -1;
    }

    cursor.index = attribute;
  }

  return -1;
};

const isAttributeNameStart = (char: string | undefined): boolean => char !== undefined && /^[A-Za-z_:]$/.test(char);

const isAttributeNameChar = (char: string | undefined): boolean => char !== undefined && /^[A-Za-z0-9_.:-]$/.test(char);

/**
 * One attribute at `pos`: a name and any `= value` initializers. After an
 * unquoted value another `=` starts a new value;
 * a quoted value ends the attribute. Returns the index after it, or -1.
 * @param line - the line
 * @param pos - index of the name's first character
 */
const scanAttribute = (line: string, pos: number): number => {
  if (!isAttributeNameStart(line[pos])) {
    return -1;
  }

  const cursor = { index: pos + 1 };

  while (isAttributeNameChar(line[cursor.index])) {
    cursor.index++;
  }

  for (;;) {
    const equals = skipSpaces(line, cursor.index);

    if (line[equals] !== '=') {
      return cursor.index;
    }

    const value = skipSpaces(line, equals + 1);
    const quote = line[value];

    if (quote === '"' || quote === '\'') {
      const close = line.indexOf(quote, value + 1);

      return close === -1 ? -1 : close + 1;
    }

    cursor.index = unquotedValueEnd(line, value);

    if (cursor.index === -1) {
      return -1;
    }
  }
};

/**
 * The end of an unquoted attribute value, or -1. It stops at `/` and `=`
 * too; a value may be empty only when `/` follows.
 * @param line - the line
 * @param pos - index of the value's first character
 */
const unquotedValueEnd = (line: string, pos: number): number => {
  if (pos >= line.length || '<=>`'.includes(line[pos])) {
    return -1;
  }

  const cursor = { index: pos };

  while (cursor.index < line.length && !'"\'/<=>` \t'.includes(line[cursor.index])) {
    cursor.index++;
  }

  return cursor.index;
};

type HtmlEndState = 'data' | 'dash' | 'lessThan' | 'endTag' | 'bracket' | 'closing';

/**
 * Where the end search of an HTML block starts on its first line, and in
 * which state: right after the opener.
 * @param kind - the block kind
 * @param text - the first line, from its `<`
 */
const htmlEndStart = (kind: number, text: string): { index: number; state: HtmlEndState } => {
  switch (kind) {
    case 1:
      return { index: 1 + tagNameAt(text, 1).length, state: 'data' };
    case 2:
      return { index: 4, state: 'closing' };
    case 3:
      return { index: 2, state: 'closing' };
    case 4:
      return { index: 3, state: 'closing' };
    default:
      return { index: 9, state: 'data' };
  }
};

/**
 * One step of the end search. Returns the next state, or null when the
 * block ends here.
 * @param kind - the block kind
 * @param state - the current state
 * @param char - the character
 * @param tag - the end tag name read so far
 */
const htmlEndStep = (kind: number, state: HtmlEndState, char: string, tag: { name: string }): HtmlEndState | null => {
  if (state === 'closing' && (char === '>' || (char === '-' && kind === 2))) {
    return char === '>' ? null : 'closing';
  }

  if (state === 'dash' && char === '-') {
    return 'closing';
  }

  if (state === 'bracket' && char === ']') {
    return 'closing';
  }

  if (state === 'lessThan' && char === '/') {
    Object.assign(tag, { name: '' });

    return 'endTag';
  }

  if (state === 'endTag') {
    return endTagStep(kind, char, tag);
  }

  return htmlDataStep(kind, char);
};

/**
 * Inside `</` of a raw-text block (kind 1): read the tag name.
 * @param kind - the block kind
 * @param char - the character
 * @param tag - the end tag name read so far
 */
const endTagStep = (kind: number, char: string, tag: { name: string }): HtmlEndState | null => {
  if (char === '>' && HTML_RAW_TAGS.includes(tag.name.toLowerCase())) {
    return null;
  }

  if (char !== '>' && isAsciiAlpha(char) && tag.name.length < 8) {
    Object.assign(tag, { name: tag.name + char });

    return 'endTag';
  }

  return htmlDataStep(kind, char);
};

/**
 * A character outside any partial end marker.
 * @param kind - the block kind
 * @param char - the character
 */
const htmlDataStep = (kind: number, char: string): HtmlEndState | null => {
  if (kind === 2 && char === '-') {
    return 'dash';
  }

  if (kind === 1 && char === '<') {
    return 'lessThan';
  }

  if (kind === 4 && char === '>') {
    return null;
  }

  if (kind === 3 && char === '?') {
    return 'closing';
  }

  return kind === 5 && char === ']' ? 'bracket' : 'data';
};

/**
 * Whether a line ends an HTML block of kinds 1–5. The search does not
 * backtrack: `]]]>` does not end CDATA.
 * @param kind - the block kind
 * @param text - the line
 * @param first - the line opened the block
 */
export const endsHtmlBlock = (kind: number, text: string, first: boolean): boolean => {
  if (kind < 1 || kind > 5) {
    return false;
  }

  const from = skipSpaces(text, 0);
  const start = first ? htmlEndStart(kind, text.slice(from)) : { index: 0, state: 'data' as HtmlEndState };
  const scan = { index: first ? from + start.index : 0, state: start.state as HtmlEndState | null };
  const tag = { name: '' };

  while (scan.index < text.length && scan.state !== null) {
    scan.state = htmlEndStep(kind, scan.state, text[scan.index], tag);
    scan.index++;
  }

  return scan.state === null;
};

import type { PhrasingContent } from '../../../types/data-formats/markdown-tree';
import { buildTree } from './inline-build';
import type { DelimKind } from './inline-emphasis';
import { resolveEmphasis } from './inline-emphasis';
import { NextIndex, scanHtml } from './inline-html';
import type { BracketItem, Item, LinkTarget } from './inline-items';
import { canPrecedeWww, isEmailAtext, LiteralScanner, linkLiteralsInText } from './inline-literal';
import { isInlineMath } from './inline-math';
import { lineEndingLength, RunIndex, scanAutolink, stripSpanPadding } from './inline-scan';
import { scanLinkDestination, scanLinkLabel, scanLinkTitle } from './link-parts';
import {
  decodeString,
  isAsciiAlpha,
  isAsciiPunctuation,
  isLineEnding,
  isSpaceOrLineEnding,
  isSpaceOrTab,
  isUnicodePunctuation,
  isUnicodeWhitespace,
  MAX_LABEL,
  normalizeIdentifier,
  runLength,
  scanCharacterReference,
  skipWhitespace,
  TAB_STOP,
} from './text';

export interface InlineContext {
  /** Link definition identifiers a reference may resolve to. */
  definitions: ReadonlySet<string>;
  /** Footnote definition identifiers a `[^x]` call may resolve to. */
  footnotes: ReadonlySet<string>;
  gfm: boolean;
  math: boolean;
  /** The leaf is a table cell: `\|` in code turns into `|`. */
  inTable?: boolean;
  /** Start column of later lines, by index in the leaf's text; a missing line starts at a tab stop. */
  lineColumns?: ReadonlyMap<number, number>;
  /** Leading columns of later lines left over from a cut tab, by the line's index in the leaf's text. */
  tabRest?: ReadonlyMap<number, number>;
}

type CharClass = 'whitespace' | 'punctuation' | 'other';

/**
 * How a character next to a delimiter run counts for flanking. Input edges
 * count as whitespace.
 * @param char - the neighbour
 */
const classify = (char: string | undefined): CharClass => {
  if (char === undefined || isUnicodeWhitespace(char)) {
    return 'whitespace';
  }

  return isUnicodePunctuation(char) ? 'punctuation' : 'other';
};

/** Inline destinations nest parens at most this deep. */
const MAX_PAREN_DEPTH = 32;

/** A label with more visible characters than this cannot match a definition. */
const MAX_LABEL_VISIBLE = 4000;

interface Resolved {
  target: LinkTarget;
  end: number;
}

/** One left-to-right pass over a leaf's content, building the item list. */
class InlineScanner {
  private readonly items: Item[] = [];
  /** Indices (into items) of brackets still waiting for a `]`. */
  private readonly brackets: number[] = [];
  /** Link brackets below this stack depth are inactive: a link closed above them. */
  private linkFloor = 0;
  private pos = 0;
  /** Index of the last bracket, link end or footnote call. */
  private lastLabel = -1;
  private firstKind: DelimKind | undefined;
  private readonly next: NextIndex;
  private readonly literals: LiteralScanner;
  private codeRuns: RunIndex | undefined;
  private mathRuns: RunIndex | undefined;
  /** Per title closer: from here on no unescaped closer is left. */
  private readonly titleEof = new Map<string, number>();
  private visible: Uint32Array | undefined;

  /**
   * @param src - the leaf's content
   * @param context - definitions and switches
   */
  constructor(private readonly src: string, private readonly context: InlineContext) {
    this.next = new NextIndex(src);
    this.literals = new LiteralScanner(src);
  }

  /** Scan, resolve emphasis, build the tree. */
  public parse(): PhrasingContent[] {
    while (this.pos < this.src.length) {
      this.step();
    }

    const linkOrder: DelimKind[] = this.context.gfm ? ['strike', 'attention'] : ['attention'];
    const topOrder: DelimKind[] = this.firstKind === 'strike' ? ['strike', 'attention'] : ['attention', 'strike'];

    resolveEmphasis(this.items, this.context.gfm ? topOrder : ['attention'], linkOrder);

    return buildTree(this.items);
  }

  /** Handle the construct (or plain character) at `pos`. */
  private step(): void {
    const char = this.src[this.pos];
    const gfm = this.context.gfm;

    switch (char) {
      case '\n':
      case '\r':
        return this.lineEnding();
      case '\\':
        return this.backslash();
      case '&':
        return this.reference();
      case '`':
        return this.codeSpan();
      case '*':
        return this.attention();
      case '_':
        return gfm && this.literalEmail() ? undefined : this.attention();
      case '~':
        return gfm ? this.tilde() : this.plain();
      case '<':
        return this.lessThan();
      case '!':
        return this.src[this.pos + 1] === '[' ? this.openBracket(true) : this.plain();
      case '[':
        return gfm && this.src[this.pos + 1] === '^' && this.footnoteCall() ? undefined : this.openBracket(false);
      case ']':
        return this.closeBracket();
      case '$':
        return this.context.math ? this.mathSpan() : this.plain();
      default:
        return this.plain();
    }
  }

  /**
   * Append text, merging with a text item just before.
   * @param value - the text
   */
  private text(value: string): void {
    const last = this.items[this.items.length - 1];

    if (last?.kind === 'text') {
      last.value += value;
    } else {
      this.items.push({ kind: 'text', value });
    }
  }

  /**
   * Add a finished node.
   * @param node - the node
   */
  private node(node: PhrasingContent): void {
    this.items.push({ kind: 'node', node });
  }

  /** A plain character, or a GFM autolink literal starting at it. */
  private plain(): void {
    const char = this.src[this.pos];

    if (this.context.gfm && this.literal(char)) {
      return;
    }

    this.text(char);
    this.pos++;
  }

  /**
   * Try the autolink literals that may start at `char`.
   * @param char - the character at `pos`
   */
  private literal(char: string): boolean {
    if (this.brackets.length > 0) {
      return false;
    }

    if (isEmailAtext(char) && this.literalEmail()) {
      return true;
    }

    const previous = this.src[this.pos - 1];

    if ((char === 'w' || char === 'W') && canPrecedeWww(previous)) {
      return this.literalLink(this.literals.www(this.pos), 'http://');
    }

    if ((char === 'h' || char === 'H') && !isAsciiAlpha(previous)) {
      return this.literalLink(this.literals.protocol(this.pos), '');
    }

    return false;
  }

  /** An email literal at `pos`: not inside an atext run, not after `/`. */
  private literalEmail(): boolean {
    const previous = this.src[this.pos - 1];

    if (this.brackets.length > 0 || previous === '/' || isEmailAtext(previous)) {
      return false;
    }

    return this.literalLink(this.literals.email(this.pos), 'mailto:');
  }

  /**
   * Add a literal link ending at `end`, unless `end` is -1.
   * @param end - end index or -1
   * @param prefix - what the URL gets in front of the text
   */
  private literalLink(end: number, prefix: string): boolean {
    if (end === -1) {
      return false;
    }

    const value = this.src.slice(this.pos, end);

    this.node({ type: 'link', title: null, url: prefix + value, children: [{ type: 'text', value }] });
    this.pos = end;

    return true;
  }

  /**
   * Step over a line ending and the next line's indent, which text drops
   * (code, HTML and labels keep it: they read the source as written).
   * @param at - index of the line ending
   */
  private skipLineEnding(at: number): void {
    this.pos = at + lineEndingLength(this.src, at);

    while (isSpaceOrTab(this.src[this.pos])) {
      this.pos++;
    }
  }

  /** A line ending: soft, or hard after two or more spaces. */
  private lineEnding(): void {
    const width = lineEndingLength(this.src, this.pos);
    const trailing = this.src.slice(trailingStart(this.src, this.pos), this.pos);
    const last = this.items[this.items.length - 1];

    if (trailing !== '' && last?.kind === 'text') {
      last.value = last.value.slice(0, last.value.length - trailing.length);
    }

    if (trailing.length >= 2 && !trailing.includes('\t')) {
      this.node({ type: 'break' });
    } else {
      this.text(this.src.slice(this.pos, this.pos + width));
    }

    this.skipLineEnding(this.pos);
  }

  /** `\` before a line ending, punctuation, or anything else. */
  private backslash(): void {
    const next = this.src[this.pos + 1];

    if (isLineEnding(next)) {
      this.node({ type: 'break' });
      this.skipLineEnding(this.pos + 1);

      return;
    }

    if (next !== undefined && isAsciiPunctuation(next)) {
      this.text(next);
      this.pos += 2;

      return;
    }

    this.text('\\');
    this.pos++;
  }

  /** `&…;` */
  private reference(): void {
    const decoded = scanCharacterReference(this.src, this.pos);

    this.text(decoded === null ? '&' : decoded.value);
    this.pos = decoded === null ? this.pos + 1 : decoded.end;
  }

  /** A backtick run: a code span when a run of the same size closes it. */
  private codeSpan(): void {
    const size = runLength(this.src, this.pos, '`');

    this.codeRuns ??= new RunIndex(this.src, '`');

    const close = this.codeRuns.next(this.pos + size, size);

    if (close === -1) {
      this.text('`'.repeat(size));
      this.pos += size;

      return;
    }

    const value = stripSpanPadding(this.src.slice(this.pos + size, close), this.holdsTabRest(this.pos + size, close));

    this.node({ type: 'inlineCode', value: this.context.inTable === true ? value.replace(/\\([\\|])/g, (whole, char: string) => (char === '|' ? '|' : whole)) : value });
    this.pos = close + size;
  }

  /**
   * Whether `[from, to)` holds columns left from a cut tab. They count as
   * content, not as spaces, when a code span decides to drop its padding.
   * @param from - start index in the leaf's text
   * @param to - end index
   */
  private holdsTabRest(from: number, to: number): boolean {
    return [...(this.context.tabRest ?? [])].some(([line, columns]) => line < to && line + columns > from);
  }

  /** A dollar run: inline math, with single-dollar prices kept as text. */
  private mathSpan(): void {
    const size = runLength(this.src, this.pos, '$');

    this.mathRuns ??= new RunIndex(this.src, '$');

    const close = this.mathRuns.next(this.pos + size, size);
    const content = close === -1 ? '' : this.src.slice(this.pos + size, close);

    if (close === -1) {
      this.text('$'.repeat(size));
      this.pos += size;

      return;
    }

    // The guard reads line endings and tabs as spaces.
    if (size === 1 && !isInlineMath(content.replace(/\r\n|[\t\n\r]/g, ' '))) {
      this.text('$');
      this.pos++;

      return;
    }

    this.node({ type: 'inlineMath', value: stripSpanPadding(content) });
    this.pos = close + size;
  }

  /** `*` or `_` run. */
  private attention(): void {
    const src = this.src;
    const char = src[this.pos];
    const size = runLength(src, this.pos, char);
    const previous = src[this.pos - 1];
    const following = src[this.pos + size];
    const before = classify(previous);
    const after = classify(following);
    // Another delimiter character next to the run (`*`, `_`, and `~` in GFM)
    // loosens flanking.
    const open = after === 'other' || (after === 'punctuation' && before !== 'other') || this.isMarker(following);
    const close = before === 'other' || (before === 'punctuation' && after !== 'other') || this.isMarker(previous);

    // `_` inside a word neither opens nor closes.
    const canOpen = char === '*' ? open : open && (before !== 'other' || !close);
    const canClose = char === '*' ? close : close && (after !== 'other' || !open);

    this.delimiter(char, size, canOpen, canClose);
    this.firstKind ??= 'attention';
  }

  /**
   * Push a delimiter run and step past it.
   * @param char - `*`, `_` or `~`
   * @param size - run length
   * @param canOpen - it may open a span
   * @param canClose - it may close a span
   */
  private delimiter(char: string, size: number, canOpen: boolean, canClose: boolean): void {
    this.items.push({ kind: 'delim', char, size, rest: size, canOpen, canClose, opens: [], closes: [] });
    this.pos += size;
  }

  /**
   * Whether a character is a delimiter that loosens flanking.
   * @param char - a neighbour of a run
   */
  private isMarker(char: string | undefined): boolean {
    return char === '*' || char === '_' || (this.context.gfm && char === '~');
  }

  /** `~` or `~~` run; longer runs are text. */
  private tilde(): void {
    const src = this.src;
    const size = runLength(src, this.pos, '~');

    if (size > 2) {
      this.text('~'.repeat(size));
      this.pos += size;

      return;
    }

    const before = classify(src[this.pos - 1]);
    const after = classify(src[this.pos + size]);

    const canOpen = after === 'other' || (after === 'punctuation' && before !== 'other');
    const canClose = before === 'other' || (before === 'punctuation' && after !== 'other');

    this.delimiter('~', size, canOpen, canClose);
    this.firstKind ??= 'strike';
  }

  /** `<`: autolink, raw HTML, or text. */
  private lessThan(): void {
    const autolink = scanAutolink(this.src, this.pos);

    if (autolink !== null) {
      this.node({ type: 'link', title: null, url: autolink.url, children: [{ type: 'text', value: autolink.value }] });
      this.pos = autolink.end;

      return;
    }

    const end = scanHtml(this.src, this.pos, this.next);

    if (end === -1) {
      this.text('<');
      this.pos++;

      return;
    }

    const start = this.pos;
    const value = this.src.slice(start, end).replace(/(\r\n|\r|\n)([\t ]*)/g, (_, eol: string, indent: string, at: number) =>
      eol + dropColumns(indent, 3, this.context.lineColumns?.get(start + at + eol.length) ?? 0));

    this.node({ type: 'html', value });
    this.pos = end;
  }

  /**
   * `[` or `![`.
   * @param image - `![`
   */
  private openBracket(image: boolean): void {
    const width = image ? 2 : 1;

    this.lastLabel = this.items.length;
    this.brackets.push(this.items.length);
    this.items.push({ kind: 'bracket', image, contentStart: this.pos + width });
    this.pos += width;
  }

  /** `[^label]` naming a footnote definition. */
  private footnoteCall(): boolean {
    const src = this.src;
    const cursor = { at: this.pos + 2, size: 0 };

    for (;;) {
      const char = src[cursor.at];

      if (cursor.size > MAX_LABEL || char === undefined || char === '[' || isSpaceOrLineEnding(char) || (char === ']' && cursor.size === 0)) {
        return false;
      }

      if (char === ']') {
        break;
      }

      const escaped = char === '\\' && (src[cursor.at + 1] === '[' || src[cursor.at + 1] === '\\' || src[cursor.at + 1] === ']');

      cursor.size += escaped ? 2 : 1;
      cursor.at += escaped ? 2 : 1;
    }

    const raw = src.slice(this.pos + 2, cursor.at);
    const identifier = normalizeIdentifier(raw);

    if (!this.context.footnotes.has(identifier)) {
      return false;
    }

    this.lastLabel = this.items.length;
    this.node({ type: 'footnoteReference', identifier, label: decodeString(raw) });
    this.pos = cursor.at + 1;

    return true;
  }

  /** `]`: closes the innermost bracket into a link or image, or is text. */
  private closeBracket(): void {
    const index = this.brackets[this.brackets.length - 1];
    const opener = index === undefined ? undefined : this.items[index];

    if (opener?.kind !== 'bracket') {
      this.text(']');
      this.pos++;

      return;
    }

    const active = opener.image || this.brackets.length - 1 >= this.linkFloor;
    const resolved = active ? this.resolveLabelEnd(opener) : null;

    this.brackets.pop();

    if (resolved === null) {
      this.linkFloor = Math.min(this.linkFloor, this.brackets.length);

      if (!this.footnoteAfterImage(index, opener)) {
        this.text(']');
        this.pos++;
      }

      return;
    }

    // A link deactivates every link bracket below it: links do not nest.
    this.linkFloor = opener.image ? Math.min(this.linkFloor, this.brackets.length) : this.brackets.length;
    opener.target = resolved.target;
    this.lastLabel = this.items.length;
    this.items.push({ kind: 'close' });
    this.pos = resolved.end;
  }

  /**
   * `![^x]` that is no image but names a footnote: `!` and a call.
   * @param index - the bracket's item index
   * @param opener - the bracket
   */
  private footnoteAfterImage(index: number, opener: BracketItem): boolean {
    if (!this.context.gfm || !opener.image || this.lastLabel !== index) {
      return false;
    }

    const identifier = normalizeIdentifier(this.src.slice(opener.contentStart, this.pos));

    if (!identifier.startsWith('^') || !this.context.footnotes.has(identifier.slice(1))) {
      return false;
    }

    const raw = this.src.slice(opener.contentStart + 1, this.pos);

    this.items.length = index;
    this.text('!');
    this.lastLabel = this.items.length;
    this.node({ type: 'footnoteReference', identifier: normalizeIdentifier(raw), label: decodeString(raw) });
    this.pos++;

    return true;
  }

  /**
   * Whether the source between two indices names a link definition.
   * @param start - first index
   * @param end - index after the last
   */
  private isDefined(start: number, end: number): boolean {
    if (this.context.definitions.size === 0) {
      return false;
    }

    this.visible ??= visibleCounts(this.src);

    return this.visible[end] - this.visible[start] <= MAX_LABEL_VISIBLE
      && this.context.definitions.has(normalizeIdentifier(this.src.slice(start, end)));
  }

  /**
   * What follows `]`: a resource, a full, collapsed or shortcut reference.
   * @param opener - the innermost bracket
   */
  private resolveLabelEnd(opener: BracketItem): Resolved | null {
    const src = this.src;
    const raw = src.slice(opener.contentStart, this.pos);
    const defined = this.isDefined(opener.contentStart, this.pos);
    const after = this.pos + 1;
    const reference = (label: string, referenceType: 'full' | 'collapsed' | 'shortcut', end: number): Resolved => ({
      target: {
        type: opener.image ? 'imageReference' : 'linkReference',
        identifier: normalizeIdentifier(label),
        label: decodeString(label),
        referenceType,
      },
      end,
    });

    if (src[after] === '(') {
      const resource = this.resource(after);

      if (resource !== null) {
        return { target: { type: opener.image ? 'image' : 'link', url: resource.url, title: resource.title }, end: resource.end };
      }
    }

    if (src[after] === '[') {
      const label = scanLinkLabel(src, after);

      if (label !== null && this.isDefined(after + 1, label.end - 1)) {
        return reference(label.value, 'full', label.end);
      }

      if (!defined || src[after + 1] !== ']') {
        return null;
      }

      return reference(raw, 'collapsed', after + 2);
    }

    return defined ? reference(raw, 'shortcut', after) : null;
  }

  /**
   * `(destination "title")` at `pos` (the `(`).
   * @param pos - index of the `(`
   */
  private resource(pos: number): { url: string; title: string | null; end: number } | null {
    const src = this.src;
    const start = skipWhitespace(src, pos + 1);

    if (src[start] === ')') {
      return { url: '', title: null, end: start + 1 };
    }

    const destination = scanLinkDestination(src, start, MAX_PAREN_DEPTH);

    if (destination === null) {
      return null;
    }

    const between = skipWhitespace(src, destination.end);
    const title = between > destination.end ? this.title(between) : undefined;

    if (title === null) {
      return null;
    }

    const end = title === undefined ? between : skipWhitespace(src, title.end);

    if (src[end] !== ')') {
      return null;
    }

    return {
      url: decodeString(destination.value),
      title: title === undefined || title.value === '' ? null : decodeString(title.value),
      end: end + 1,
    };
  }

  /**
   * A title at `pos`: undefined when none starts there, null when one starts
   * but never closes.
   * @param pos - index after the whitespace
   */
  private title(pos: number): { value: string; end: number } | null | undefined {
    const open = this.src[pos];

    if (open !== '"' && open !== '\'' && open !== '(') {
      return undefined;
    }

    if ((this.titleEof.get(open) ?? Number.POSITIVE_INFINITY) <= pos) {
      return null;
    }

    const title = scanLinkTitle(this.src, pos);

    if (title === null) {
      this.titleEof.set(open, pos);
    }

    return title;
  }
}

/**
 * Where the spaces and tabs before `end` start.
 * @param src - source text
 * @param end - index after them
 */
const trailingStart = (src: string, end: number): number => {
  const cursor = { at: end };

  while (cursor.at > 0 && isSpaceOrTab(src[cursor.at - 1])) {
    cursor.at--;
  }

  return cursor.at;
};

/**
 * An indent with its first `limit` columns removed. A tab cut in two leaves
 * its remaining columns as spaces.
 * @param indent - spaces and tabs
 * @param limit - columns to drop
 * @param column - the column the indent starts at, which sets each tab's width
 */
const dropColumns = (indent: string, limit: number, column: number): string => {
  const state = { column, dropped: 0, rest: '' };

  for (const char of indent) {
    const width = char === '\t' ? TAB_STOP - (state.column % TAB_STOP) : 1;
    const take = Math.min(width, limit - state.dropped);

    if (take <= 0) {
      state.rest += char;
    } else if (take < width) {
      state.rest += ' '.repeat(width - take);
    }

    state.dropped += Math.max(0, take);
    state.column += width;
  }

  return state.rest;
};

/**
 * Prefix counts of characters that are not spaces, tabs or line endings.
 * @param src - source text
 */
const visibleCounts = (src: string): Uint32Array => {
  const counts = new Uint32Array(src.length + 1);

  for (const cursor = { at: 0 }; cursor.at < src.length; cursor.at++) {
    counts[cursor.at + 1] = counts[cursor.at] + (isSpaceOrLineEnding(src[cursor.at]) ? 0 : 1);
  }

  return counts;
};

/**
 * Parse a leaf's inline content.
 * @param raw - the leaf's content, block syntax already removed
 * @param context - definitions and syntax switches
 */
export const parseInline = (raw: string, context: InlineContext): PhrasingContent[] => {
  if (raw === '') {
    return [];
  }

  // NUL is already U+FFFD: the block parser replaced it in the whole source.
  const children = new InlineScanner(raw, context).parse();

  return context.gfm ? linkLiteralsInText(children) : children;
};

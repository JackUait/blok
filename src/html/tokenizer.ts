/* eslint-disable no-restricted-syntax -- the cursor and the current token live in mutable fields and locals; this is the hot path of every HTML parse */
/**
 * The HTML tokenizer: the spec state machine, with the token stream of
 * parse5 8.0.1 (MIT, see NOTICE) minus locations and parse errors. Hot
 * states read whole runs with sticky regexes instead of one character per
 * step, because Blok.Server runs this in an interpreter where every JS step
 * costs and a native regex run does not.
 */
import { CharRefReader } from './char-refs';
import { getTagID, TAG_ID } from './tags';
import {
  TokenType,
  TokenizerMode,
  type Attribute,
  type CharacterToken,
  type CommentToken,
  type DoctypeToken,
  type TagToken,
  type TokenHandler,
  type TokenizerControl,
} from './token';

// The first five states are TokenizerMode's values, so the tree builder's
// `state` maps onto them without a table.
const DATA = 0;
const RCDATA = 1;
const RAWTEXT = 2;
const SCRIPT_DATA = 3;
// 4 is PLAINTEXT, reached only from `state`.
const TAG_OPEN = 5;
const END_TAG_OPEN = 6;
const TAG_NAME = 7;
const RCDATA_LESS_THAN_SIGN = 8;
const RCDATA_END_TAG_OPEN = 9;
const RAWTEXT_LESS_THAN_SIGN = 10;
const RAWTEXT_END_TAG_OPEN = 11;
const SCRIPT_DATA_LESS_THAN_SIGN = 12;
const SCRIPT_DATA_END_TAG_OPEN = 13;
const SCRIPT_DATA_ESCAPE_START = 14;
const SCRIPT_DATA_ESCAPE_START_DASH = 15;
const SCRIPT_DATA_ESCAPED = 16;
const SCRIPT_DATA_ESCAPED_DASH = 17;
const SCRIPT_DATA_ESCAPED_DASH_DASH = 18;
const SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN = 19;
const SCRIPT_DATA_ESCAPED_END_TAG_OPEN = 20;
const SCRIPT_DATA_DOUBLE_ESCAPE_START = 21;
const SCRIPT_DATA_DOUBLE_ESCAPED = 22;
const SCRIPT_DATA_DOUBLE_ESCAPED_DASH = 23;
const SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH = 24;
const SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN = 25;
const SCRIPT_DATA_DOUBLE_ESCAPE_END = 26;
const BEFORE_ATTRIBUTE_NAME = 27;
const ATTRIBUTE_NAME = 28;
const AFTER_ATTRIBUTE_NAME = 29;
const BEFORE_ATTRIBUTE_VALUE = 30;
const ATTRIBUTE_VALUE_DOUBLE_QUOTED = 31;
const ATTRIBUTE_VALUE_SINGLE_QUOTED = 32;
const ATTRIBUTE_VALUE_UNQUOTED = 33;
const AFTER_ATTRIBUTE_VALUE_QUOTED = 34;
const SELF_CLOSING_START_TAG = 35;
const BOGUS_COMMENT = 36;
const MARKUP_DECLARATION_OPEN = 37;
const COMMENT_START = 38;
const COMMENT_START_DASH = 39;
const COMMENT = 40;
const COMMENT_LESS_THAN_SIGN = 41;
const COMMENT_LESS_THAN_SIGN_BANG = 42;
const COMMENT_LESS_THAN_SIGN_BANG_DASH = 43;
const COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH = 44;
const COMMENT_END_DASH = 45;
const COMMENT_END = 46;
const COMMENT_END_BANG = 47;
const DOCTYPE = 48;
const BEFORE_DOCTYPE_NAME = 49;
const DOCTYPE_NAME = 50;
const AFTER_DOCTYPE_NAME = 51;
const AFTER_DOCTYPE_PUBLIC_KEYWORD = 52;
const BEFORE_DOCTYPE_PUBLIC_IDENTIFIER = 53;
const DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED = 54;
const DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED = 55;
const AFTER_DOCTYPE_PUBLIC_IDENTIFIER = 56;
const BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS = 57;
const AFTER_DOCTYPE_SYSTEM_KEYWORD = 58;
const BEFORE_DOCTYPE_SYSTEM_IDENTIFIER = 59;
const DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED = 60;
const DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED = 61;
const AFTER_DOCTYPE_SYSTEM_IDENTIFIER = 62;
const BOGUS_DOCTYPE = 63;
const CDATA_SECTION = 64;
const CDATA_SECTION_BRACKET = 65;
const CDATA_SECTION_END = 66;
const ENDED = 67;

const EOF = -1;
const TAB = 0x09;
const LF = 0x0a;
const FF = 0x0c;
const SPACE = 0x20;
const NUL = 0x00;
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const HYPHEN = 0x2d;
const SOLIDUS = 0x2f;
const GREATER_THAN = 0x3e;
const RIGHT_BRACKET = 0x5d;

// Module constants: an interpreter reads them faster than enum members.
const CHARACTER = TokenType.CHARACTER;
const NULL_CHARACTER = TokenType.NULL_CHARACTER;
const WHITESPACE_CHARACTER = TokenType.WHITESPACE_CHARACTER;

const REPLACEMENT = '�';

/** A sticky regex that reports where its match from a given index ends. */
class Sticky {
  constructor(private readonly pattern: RegExp) {}

  /** The end of the match at `from`, or `from` when there is none. */
  public end(html: string, from: number): number {
    this.pattern.lastIndex = from;

    return this.pattern.test(html) ? this.pattern.lastIndex : from;
  }

  public matches(html: string, at: number): boolean {
    this.pattern.lastIndex = at;

    return this.pattern.test(html);
  }
}

const WHITESPACE_RUN = new Sticky(/[\t\n\f ]+/y);
const NUL_RUN = new Sticky(/\0+/y);
const DATA_RUN = new Sticky(/[^\t\n\f <&\0]+/y);
const DATA_TEXT = /[^\t\n\f <&\0]+/y;
const RAWTEXT_RUN = new Sticky(/[^\t\n\f <\0]+/y);
const PLAINTEXT_RUN = new Sticky(/[^\t\n\f \0]+/y);
const TAG_NAME_RUN = new Sticky(/[^\t\n\f />\0]+/y);
const ATTRIBUTE_NAME_RUN = new Sticky(/[^\t\n\f />=\0]+/y);
const DOUBLE_QUOTED_RUN = new Sticky(/[^"&\0]+/y);
const SINGLE_QUOTED_RUN = new Sticky(/[^'&\0]+/y);
const UNQUOTED_RUN = new Sticky(/[^\t\n\f &>\0]+/y);
const COMMENT_RUN = new Sticky(/[^\-<\0]+/y);
const BOGUS_COMMENT_RUN = new Sticky(/[^>\0]+/y);
const SCRIPT_ESCAPED_RUN = new Sticky(/[^\-<\t\n\f \0]+/y);
const CDATA_RUN = new Sticky(/[^\]\t\n\f \0]+/y);
// Fast paths for the common shapes: a lowercase name, `name="value"` without
// references. Anything else falls back to the state machine where it stands.
const LOWER_TAG_NAME_RUN = new Sticky(/[a-z][^\t\n\f />\0A-Z]*/y);
const LOWER_END_TAG = new Sticky(/[a-z][^\t\n\f />\0A-Z]*>/y);
const SIMPLE_ATTRIBUTE = /[\t\n\f ]+([a-z][^\t\n\f />=\0"'<A-Z]*)(?:="([^"&\0]*)")?/y;
const UPPER = /[A-Z]/;
const UPPER_RUNS = /[A-Z]+/g;
// No `i` flag: some engines fold non-ASCII letters (like the Kelvin sign) onto ASCII ones.
const DOCTYPE_WORD = new Sticky(/[Dd][Oo][Cc][Tt][Yy][Pp][Ee]/y);
const PUBLIC_WORD = new Sticky(/[Pp][Uu][Bb][Ll][Ii][Cc]/y);
const SYSTEM_WORD = new Sticky(/[Ss][Yy][Ss][Tt][Ee][Mm]/y);
const SCRIPT_WORD = new Sticky(/[Ss][Cc][Rr][Ii][Pp][Tt]/y);
// Past this many attributes a tag checks repeated names with a set, not a scan.
const ATTRIBUTE_SCAN_LIMIT = 16;

const isWhitespace = (cp: number): boolean => cp === SPACE || cp === LF || cp === TAB || cp === FF;

const isAsciiLetter = (cp: number): boolean => (cp | 0x20) >= 0x61 && (cp | 0x20) <= 0x7a;

const LOW_SURROGATE_PAIR = /[\uDC00-\uDFFF]{2}/;

/**
 * Where parse5 8.0.1 reads two low surrogates as one code point: it pairs any
 * surrogate with a following low one, left to right, and a low-low "pair" is
 * past U+10FFFF. Positions are of the first of the two.
 */
const parse5BadPairs = (html: string): Set<number> | null => {
  if (!LOW_SURROGATE_PAIR.test(html)) {
    return null;
  }
  const found = new Set<number>();
  const cursor = { pos: 0 };

  while (cursor.pos < html.length - 1) {
    const unit = html.charCodeAt(cursor.pos);
    const next = html.charCodeAt(cursor.pos + 1);

    if (unit < 0xd800 || unit > 0xdfff || next < 0xdc00 || next > 0xdfff) {
      cursor.pos++;
      continue;
    }
    if (unit >= 0xdc00) {
      found.add(cursor.pos);
    }
    cursor.pos += 2;
  }

  return found.size > 0 ? found : null;
};

const lowerAscii = (text: string): string => (UPPER.test(text) ? text.replace(UPPER_RUNS, (run) => run.toLowerCase()) : text);

export class Tokenizer implements TokenizerControl {
  public state: TokenizerMode = TokenizerMode.DATA;
  public inForeignNode = false;
  public lastStartTagName = '';

  private html = '';
  private pos = 0;
  /** The state machine's own state; `state` is what the tree builder sees and sets. */
  private current = DATA;
  private returnState = DATA;
  private pendingType: CharacterToken['type'] | null = null;
  private pendingChars = '';
  private tag: TagToken = Tokenizer.createTag(TokenType.START_TAG);
  private attr: Attribute = { name: '', value: '' };
  private attrNames: Set<string> | null = null;
  private comment: CommentToken = { type: TokenType.COMMENT, data: '' };
  private doctype: DoctypeToken = { type: TokenType.DOCTYPE, name: null, forceQuirks: false, publicId: null, systemId: null };
  private readonly charRef = new CharRefReader();
  /** parse5's bad low-low pairs not yet dropped by a DOCTYPE; see `write`. */
  private badPairs: Set<number> | null = null;

  constructor(private readonly handler: TokenHandler) {}

  private static createTag(type: TokenType.START_TAG | TokenType.END_TAG): TagToken {
    return { type, tagName: '', tagID: TAG_ID.UNKNOWN, selfClosing: false, ackSelfClosing: false, attrs: [] };
  }

  /** Tokenizes the whole string, ending with one EOF token. */
  public write(html: string): void {
    this.html = html.indexOf('\r') < 0 ? html : html.replace(/\r\n?/g, '\n');
    this.pos = 0;
    this.current = this.state;
    this.badPairs = parse5BadPairs(this.html);
    while (this.current !== 67 /* ENDED */) {
      const cp = this.pos < this.html.length ? this.html.charCodeAt(this.pos) : -1;

      this.pos++;
      if (this.current === 0 /* DATA */) {
        this.data(cp);
      } else {
        this.call(cp);
      }
    }
    this.rejectLikeParse5();
  }

  /**
   * Throws the RangeError parse5 throws on a low-low pair it keeps. Blok's
   * callers catch it, repair the field and parse again, so throwing on exactly
   * the same input keeps their output byte-identical. parse5 drops the pair
   * without throwing only where a DOCTYPE ignores characters.
   */
  private rejectLikeParse5(): void {
    const pairs = this.badPairs;

    this.badPairs = null;
    if (pairs === null || pairs.size === 0) {
      return;
    }
    const [first] = pairs;
    const codePoint = (this.html.charCodeAt(first) - 0xd800) * 0x400 + 0x2400 + this.html.charCodeAt(first + 1);

    String.fromCodePoint(codePoint);
  }

  // Emitting

  private emitChars(type: CharacterToken['type'], chars: string): void {
    if (this.pendingType === type) {
      this.pendingChars += chars;

      return;
    }
    this.flushChars();
    this.pendingType = type;
    this.pendingChars = chars;
  }

  private flushChars(): void {
    const type = this.pendingType;

    if (type === null) {
      return;
    }
    this.pendingType = null;
    if (type === CHARACTER) {
      this.handler.onCharacter({ type, chars: this.pendingChars });
    } else if (type === WHITESPACE_CHARACTER) {
      this.handler.onWhitespaceCharacter({ type, chars: this.pendingChars });
    } else {
      this.handler.onNullCharacter({ type, chars: this.pendingChars });
    }
  }

  /** Emits a decoded reference: a lone whitespace character is whitespace, all else is text. */
  private emitRefText(text: string): void {
    this.emitChars(text.length === 1 && isWhitespace(text.charCodeAt(0)) ? WHITESPACE_CHARACTER : CHARACTER, text);
  }

  /** Emits the run of `pattern` that starts at the character just consumed. */
  private emitRun(type: CharacterToken['type'], pattern: Sticky): void {
    const start = this.pos - 1;
    const end = pattern.end(this.html, start);

    this.emitChars(type, this.html.slice(start, end));
    this.pos = end;
  }

  private emitTag(): void {
    const token = this.tag;

    this.flushChars();
    token.tagID = getTagID(token.tagName);
    if (token.type === TokenType.START_TAG) {
      this.lastStartTagName = token.tagName;
      this.state = TokenizerMode.DATA;
      this.current = DATA;
      this.handler.onStartTag(token);
      this.current = this.state;
    } else {
      this.state = TokenizerMode.DATA;
      this.current = DATA;
      this.handler.onEndTag(token);
      this.current = this.state;
    }
  }

  private emitComment(): void {
    this.flushChars();
    this.handler.onComment(this.comment);
  }

  private emitDoctype(): void {
    this.flushChars();
    this.handler.onDoctype(this.doctype);
  }

  private emitEof(): void {
    this.flushChars();
    this.handler.onEof({ type: TokenType.EOF });
    this.current = ENDED;
  }

  // Tokens under construction

  private startTag(type: TokenType.START_TAG | TokenType.END_TAG): void {
    this.tag = Tokenizer.createTag(type);
    this.attrNames = null;
  }

  private startComment(data: string): void {
    this.comment = { type: TokenType.COMMENT, data };
  }

  private startDoctype(name: string | null): void {
    this.doctype = { type: TokenType.DOCTYPE, name, forceQuirks: false, publicId: null, systemId: null };
  }

  private startAttr(name: string): void {
    this.attr = { name, value: '' };
  }

  /** Adds the attribute unless the tag already has one by that name: the first one wins. */
  private leaveAttrName(): void {
    const attrs = this.tag.attrs;
    const name = this.attr.name;

    if (attrs.length < ATTRIBUTE_SCAN_LIMIT) {
      if (!attrs.some((attr) => attr.name === name)) {
        attrs.push(this.attr);
      }

      return;
    }
    this.attrNames ??= new Set(attrs.map((attr) => attr.name));
    if (!this.attrNames.has(name)) {
      this.attrNames.add(name);
      attrs.push(this.attr);
    }
  }

  private startsWithWord(word: Sticky): boolean {
    return word.matches(this.html, this.pos - 1);
  }

  // Character references

  private startCharRef(returnState: number): void {
    const inAttribute = returnState === ATTRIBUTE_VALUE_DOUBLE_QUOTED || returnState === ATTRIBUTE_VALUE_SINGLE_QUOTED || returnState === ATTRIBUTE_VALUE_UNQUOTED;
    const found = this.charRef.read(this.html, this.pos, inAttribute);
    const text = found ? this.charRef.value : '&';

    if (found) {
      this.pos = this.charRef.end;
    }
    if (inAttribute) {
      this.attr.value += text;
    } else {
      this.emitRefText(text);
    }
    this.current = returnState;
  }

  // Dispatch

  // Cases are number literals, hot states first: an interpreter tests them in
  // order, and a named constant costs a lookup per case.
  private call(cp: number): void {
    switch (this.current) {
      case 0 /* DATA */: return this.data(cp);
      case 5 /* TAG_OPEN */: return this.tagOpen(cp);
      case 7 /* TAG_NAME */: return this.tagName(cp);
      case 6 /* END_TAG_OPEN */: return this.endTagOpen(cp);
      case 27 /* BEFORE_ATTRIBUTE_NAME */: return this.beforeAttributeName(cp);
      case 28 /* ATTRIBUTE_NAME */: return this.attributeName(cp);
      case 30 /* BEFORE_ATTRIBUTE_VALUE */: return this.beforeAttributeValue(cp);
      case 31 /* ATTRIBUTE_VALUE_DOUBLE_QUOTED */: return this.attributeValueQuoted(cp, QUOTE, DOUBLE_QUOTED_RUN, ATTRIBUTE_VALUE_DOUBLE_QUOTED);
      case 34 /* AFTER_ATTRIBUTE_VALUE_QUOTED */: return this.afterAttributeValueQuoted(cp);
      case 32 /* ATTRIBUTE_VALUE_SINGLE_QUOTED */: return this.attributeValueQuoted(cp, APOSTROPHE, SINGLE_QUOTED_RUN, ATTRIBUTE_VALUE_SINGLE_QUOTED);
      case 33 /* ATTRIBUTE_VALUE_UNQUOTED */: return this.attributeValueUnquoted(cp);
      case 29 /* AFTER_ATTRIBUTE_NAME */: return this.afterAttributeName(cp);
      case 35 /* SELF_CLOSING_START_TAG */: return this.selfClosingStartTag(cp);
      case 1 /* RCDATA */: return this.rcdata(cp);
      case 2 /* RAWTEXT */: return this.rawtext(cp, RAWTEXT_LESS_THAN_SIGN);
      case 3 /* SCRIPT_DATA */: return this.rawtext(cp, SCRIPT_DATA_LESS_THAN_SIGN);
      case 4 /* PLAINTEXT */: return this.plaintext(cp);
      case 40 /* COMMENT */: return this.commentState(cp);
      case 38 /* COMMENT_START */: return this.commentStart(cp);
      case 45 /* COMMENT_END_DASH */: return this.commentEndDash(cp);
      case 46 /* COMMENT_END */: return this.commentEnd(cp);
      case 37 /* MARKUP_DECLARATION_OPEN */: return this.markupDeclarationOpen(cp);
      case 36 /* BOGUS_COMMENT */: return this.bogusComment(cp);
      case 8 /* RCDATA_LESS_THAN_SIGN */: return this.textLessThanSign(cp, RCDATA_END_TAG_OPEN, RCDATA);
      case 9 /* RCDATA_END_TAG_OPEN */: return this.textEndTagOpen(cp, RCDATA);
      case 10 /* RAWTEXT_LESS_THAN_SIGN */: return this.textLessThanSign(cp, RAWTEXT_END_TAG_OPEN, RAWTEXT);
      case 11 /* RAWTEXT_END_TAG_OPEN */: return this.textEndTagOpen(cp, RAWTEXT);
      case 12 /* SCRIPT_DATA_LESS_THAN_SIGN */: return this.scriptDataLessThanSign(cp);
      case 13 /* SCRIPT_DATA_END_TAG_OPEN */: return this.textEndTagOpen(cp, SCRIPT_DATA);
      case 14 /* SCRIPT_DATA_ESCAPE_START */: return this.scriptDataEscapeStart(cp, SCRIPT_DATA_ESCAPE_START_DASH);
      case 15 /* SCRIPT_DATA_ESCAPE_START_DASH */: return this.scriptDataEscapeStart(cp, SCRIPT_DATA_ESCAPED_DASH_DASH);
      case 16 /* SCRIPT_DATA_ESCAPED */: return this.scriptDataEscaped(cp);
      case 17 /* SCRIPT_DATA_ESCAPED_DASH */: return this.scriptDataEscapedDash(cp);
      case 18 /* SCRIPT_DATA_ESCAPED_DASH_DASH */: return this.scriptDataEscapedDashDash(cp);
      case 19 /* SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN */: return this.scriptDataEscapedLessThanSign(cp);
      case 20 /* SCRIPT_DATA_ESCAPED_END_TAG_OPEN */: return this.textEndTagOpen(cp, SCRIPT_DATA_ESCAPED);
      case 21 /* SCRIPT_DATA_DOUBLE_ESCAPE_START */: return this.scriptDataDoubleEscapeSwitch(cp, SCRIPT_DATA_DOUBLE_ESCAPED, SCRIPT_DATA_ESCAPED);
      case 22 /* SCRIPT_DATA_DOUBLE_ESCAPED */: return this.scriptDataDoubleEscaped(cp);
      case 23 /* SCRIPT_DATA_DOUBLE_ESCAPED_DASH */: return this.scriptDataDoubleEscapedDash(cp);
      case 24 /* SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH */: return this.scriptDataDoubleEscapedDashDash(cp);
      case 25 /* SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN */: return this.scriptDataDoubleEscapedLessThanSign(cp);
      case 26 /* SCRIPT_DATA_DOUBLE_ESCAPE_END */: return this.scriptDataDoubleEscapeSwitch(cp, SCRIPT_DATA_ESCAPED, SCRIPT_DATA_DOUBLE_ESCAPED);
      case 39 /* COMMENT_START_DASH */: return this.commentStartDash(cp);
      case 41 /* COMMENT_LESS_THAN_SIGN */: return this.commentLessThanSign(cp);
      case 42 /* COMMENT_LESS_THAN_SIGN_BANG */: return this.commentLessThanSignBang(cp);
      case 43 /* COMMENT_LESS_THAN_SIGN_BANG_DASH */: return this.commentLessThanSignBangDash(cp);
      case 44 /* COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH */: return this.commentLessThanSignBangDashDash(cp);
      case 47 /* COMMENT_END_BANG */: return this.commentEndBang(cp);
      case 48 /* DOCTYPE */: return this.doctypeState(cp);
      case 49 /* BEFORE_DOCTYPE_NAME */: return this.beforeDoctypeName(cp);
      case 50 /* DOCTYPE_NAME */: return this.doctypeName(cp);
      case 51 /* AFTER_DOCTYPE_NAME */: return this.afterDoctypeName(cp);
      case 52 /* AFTER_DOCTYPE_PUBLIC_KEYWORD */: return this.afterDoctypeKeyword(cp, true);
      case 53 /* BEFORE_DOCTYPE_PUBLIC_IDENTIFIER */: return this.beforeDoctypeIdentifier(cp, true);
      case 54 /* DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED */: return this.doctypeIdentifier(cp, QUOTE, true);
      case 55 /* DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED */: return this.doctypeIdentifier(cp, APOSTROPHE, true);
      case 56 /* AFTER_DOCTYPE_PUBLIC_IDENTIFIER */: return this.afterDoctypePublicIdentifier(cp);
      case 57 /* BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS */: return this.betweenDoctypePublicAndSystemIdentifiers(cp);
      case 58 /* AFTER_DOCTYPE_SYSTEM_KEYWORD */: return this.afterDoctypeKeyword(cp, false);
      case 59 /* BEFORE_DOCTYPE_SYSTEM_IDENTIFIER */: return this.beforeDoctypeIdentifier(cp, false);
      case 60 /* DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED */: return this.doctypeIdentifier(cp, QUOTE, false);
      case 61 /* DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED */: return this.doctypeIdentifier(cp, APOSTROPHE, false);
      case 62 /* AFTER_DOCTYPE_SYSTEM_IDENTIFIER */: return this.afterDoctypeSystemIdentifier(cp);
      case 63 /* BOGUS_DOCTYPE */: return this.bogusDoctype(cp);
      case 64 /* CDATA_SECTION */: return this.cdataSection(cp);
      case 65 /* CDATA_SECTION_BRACKET */: return this.cdataSectionBracket(cp);
      case 66 /* CDATA_SECTION_END */: return this.cdataSectionEnd(cp);
      default: throw new Error(`Unknown tokenizer state ${this.current}`);
    }
  }

  // Text states

  private data(cp: number): void {
    switch (cp) {
      case 0x3c /* LESS_THAN */: this.dataLessThan(); break;
      case 0x26 /* AMPERSAND */: this.startCharRef(DATA); break;
      case 0x00 /* NUL */: this.emitRun(NULL_CHARACTER, NUL_RUN); break;
      case -1 /* EOF */: this.emitEof(); break;
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.emitWhitespace(); break;
      default: {
        // cp is text here, so the run is at least one character long.
        const start = this.pos - 1;

        DATA_TEXT.lastIndex = start;
        DATA_TEXT.test(this.html);
        this.pos = DATA_TEXT.lastIndex;
        this.emitChars(CHARACTER, this.html.slice(start, this.pos));
      }
    }
  }

  /** Whitespace just consumed: one character needs no regex, and one space between words is the common case. */
  private emitWhitespace(): void {
    const next = this.html.charCodeAt(this.pos);

    if (next === 0x20 || next === 0x0a || next === 0x09 || next === 0x0c) {
      this.emitRun(WHITESPACE_CHARACTER, WHITESPACE_RUN);
    } else {
      this.emitChars(WHITESPACE_CHARACTER, this.html.charAt(this.pos - 1));
    }
  }

  /** `<` in data: read a plain start or end tag at once, else go on in the tag open state. */
  private dataLessThan(): void {
    const html = this.html;
    const at = this.pos;
    const next = html.charCodeAt(at);

    if (next >= 0x61 && next <= 0x7a) {
      this.startTag(TokenType.START_TAG);
      this.pos = LOWER_TAG_NAME_RUN.end(html, at);
      this.tag.tagName = html.slice(at, this.pos);
      this.current = TAG_NAME;
      this.fastAttributes();

      return;
    }
    const end = next === 0x2f ? LOWER_END_TAG.end(html, at + 1) : at;

    if (end === at || end === at + 1) {
      this.current = TAG_OPEN;

      return;
    }
    this.startTag(TokenType.END_TAG);
    this.tag.tagName = html.slice(at + 1, end - 1);
    this.pos = end;
    this.emitTag();
  }

  /**
   * After a tag name or a quoted value, with `pos` on the next unread
   * character: reads `name="value"` pairs and the closing `>` or `/>`.
   * Stops where the input takes another shape, in a state that goes on from there.
   */
  private fastAttributes(): void {
    const html = this.html;

    for (;;) {
      const next = html.charCodeAt(this.pos);

      if (next === 0x3e) {
        this.pos++;
        this.emitTag();

        return;
      }
      if (next === 0x2f && html.charCodeAt(this.pos + 1) === 0x3e) {
        this.pos += 2;
        this.tag.selfClosing = true;
        this.emitTag();

        return;
      }
      if (!this.simpleAttribute()) {
        return;
      }
    }
  }

  /** Reads one `name="value"`; a bare name is left in the attribute name state. */
  private simpleAttribute(): boolean {
    SIMPLE_ATTRIBUTE.lastIndex = this.pos;
    const match = SIMPLE_ATTRIBUTE.exec(this.html);

    if (match === null) {
      return false;
    }
    this.pos = SIMPLE_ATTRIBUTE.lastIndex;
    this.startAttr(match[1]);
    if (match[2] === undefined) {
      this.current = ATTRIBUTE_NAME;

      return false;
    }
    this.attr.value = match[2];
    this.leaveAttrName();
    this.current = AFTER_ATTRIBUTE_VALUE_QUOTED;

    return true;
  }

  /** A NUL in RCDATA, RAWTEXT, script data or PLAINTEXT reads as U+FFFD. */
  private emitReplacementRun(): void {
    const end = NUL_RUN.end(this.html, this.pos - 1);

    this.emitChars(CHARACTER, REPLACEMENT.repeat(end - this.pos + 1));
    this.pos = end;
  }

  private rcdata(cp: number): void {
    switch (cp) {
      case 0x26 /* AMPERSAND */: this.startCharRef(RCDATA); break;
      case 0x3c /* LESS_THAN */: this.current = RCDATA_LESS_THAN_SIGN; break;
      case 0x00 /* NUL */: this.emitReplacementRun(); break;
      case -1 /* EOF */: this.emitEof(); break;
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.emitRun(WHITESPACE_CHARACTER, WHITESPACE_RUN); break;
      default: this.emitRun(CHARACTER, DATA_RUN);
    }
  }

  /** RAWTEXT and script data: no references, `<` may start the end tag. */
  private rawtext(cp: number, lessThanState: number): void {
    switch (cp) {
      case 0x3c /* LESS_THAN */: this.current = lessThanState; break;
      case 0x00 /* NUL */: this.emitReplacementRun(); break;
      case -1 /* EOF */: this.emitEof(); break;
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.emitRun(WHITESPACE_CHARACTER, WHITESPACE_RUN); break;
      default: this.emitRun(CHARACTER, RAWTEXT_RUN);
    }
  }

  private plaintext(cp: number): void {
    switch (cp) {
      case 0x00 /* NUL */: this.emitReplacementRun(); break;
      case -1 /* EOF */: this.emitEof(); break;
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.emitRun(WHITESPACE_CHARACTER, WHITESPACE_RUN); break;
      default: this.emitRun(CHARACTER, PLAINTEXT_RUN);
    }
  }

  /** Text or whitespace just consumed, emitted as is with the rest of its run. */
  private emitTextRun(cp: number, text: Sticky): void {
    if (isWhitespace(cp)) {
      this.emitWhitespace();
    } else {
      this.emitRun(CHARACTER, text);
    }
  }

  /** One code point emitted as is, in the kind its value calls for. */
  private emitCodePoint(cp: number): void {
    if (isWhitespace(cp)) {
      this.emitChars(WHITESPACE_CHARACTER, String.fromCharCode(cp));
    } else {
      this.emitChars(cp === NUL ? NULL_CHARACTER : CHARACTER, String.fromCharCode(cp));
    }
  }

  // Tags

  private tagOpen(cp: number): void {
    if (isAsciiLetter(cp)) {
      this.startTag(TokenType.START_TAG);
      this.current = TAG_NAME;
      this.tagName(cp);

      return;
    }
    switch (cp) {
      case 0x21 /* BANG */: this.current = MARKUP_DECLARATION_OPEN; break;
      case 0x2f /* SOLIDUS */: this.current = END_TAG_OPEN; break;
      case 0x3f /* QUESTION */:
        this.startComment('');
        this.current = BOGUS_COMMENT;
        this.bogusComment(cp);
        break;
      case -1 /* EOF */:
        this.emitChars(CHARACTER, '<');
        this.emitEof();
        break;
      default:
        this.emitChars(CHARACTER, '<');
        this.current = DATA;
        this.data(cp);
    }
  }

  private endTagOpen(cp: number): void {
    if (isAsciiLetter(cp)) {
      this.startTag(TokenType.END_TAG);
      this.current = TAG_NAME;
      this.tagName(cp);

      return;
    }
    switch (cp) {
      case 0x3e /* GREATER_THAN */: this.current = DATA; break;
      case -1 /* EOF */:
        this.emitChars(CHARACTER, '</');
        this.emitEof();
        break;
      default:
        this.startComment('');
        this.current = BOGUS_COMMENT;
        this.bogusComment(cp);
    }
  }

  private tagName(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.current = BEFORE_ATTRIBUTE_NAME; break;
      case 0x2f /* SOLIDUS */: this.current = SELF_CLOSING_START_TAG; break;
      case 0x3e /* GREATER_THAN */: this.emitTag(); break;
      case 0x00 /* NUL */: this.tag.tagName += REPLACEMENT; break;
      case -1 /* EOF */: this.emitEof(); break;
      default: {
        const start = this.pos - 1;

        this.pos = TAG_NAME_RUN.end(this.html, start);
        this.tag.tagName += lowerAscii(this.html.slice(start, this.pos));
      }
    }
  }

  private textLessThanSign(cp: number, endTagOpenState: number, textState: number): void {
    if (cp === SOLIDUS) {
      this.current = endTagOpenState;

      return;
    }
    this.emitChars(CHARACTER, '<');
    this.current = textState;
    this.call(cp);
  }

  /** `</` in RCDATA, RAWTEXT or script data: an end tag only if the last start tag's name follows. */
  private textEndTagOpen(cp: number, textState: number): void {
    if (isAsciiLetter(cp) && this.specialEndTag()) {
      return;
    }
    this.emitChars(CHARACTER, '</');
    this.current = textState;
    this.call(cp);
  }

  /** Reads `name` + whitespace, `/` or `>` from the letter just consumed, like parse5's handleSpecialEndTag. */
  private specialEndTag(): boolean {
    const name = this.lastStartTagName;
    const html = this.html;
    const start = this.pos - 1;

    if (start + name.length > html.length) {
      return false;
    }
    for (let i = 0; i < name.length; i++) {
      if ((html.charCodeAt(start + i) | 0x20) !== name.charCodeAt(i)) {
        return false;
      }
    }
    const next = start + name.length < html.length ? html.charCodeAt(start + name.length) : EOF;

    if (!isWhitespace(next) && next !== SOLIDUS && next !== GREATER_THAN) {
      return false;
    }
    this.startTag(TokenType.END_TAG);
    this.tag.tagName = name;
    this.pos = start + name.length + 1;
    if (next === GREATER_THAN) {
      this.emitTag();
      this.state = TokenizerMode.DATA;
      this.current = DATA;
    } else {
      this.current = next === SOLIDUS ? SELF_CLOSING_START_TAG : BEFORE_ATTRIBUTE_NAME;
    }

    return true;
  }

  // Script data escapes

  private scriptDataLessThanSign(cp: number): void {
    switch (cp) {
      case 0x2f /* SOLIDUS */: this.current = SCRIPT_DATA_END_TAG_OPEN; break;
      case 0x21 /* BANG */:
        this.current = SCRIPT_DATA_ESCAPE_START;
        this.emitChars(CHARACTER, '<!');
        break;
      default:
        this.emitChars(CHARACTER, '<');
        this.current = SCRIPT_DATA;
        this.call(cp);
    }
  }

  private scriptDataEscapeStart(cp: number, dashState: number): void {
    if (cp === HYPHEN) {
      this.current = dashState;
      this.emitChars(CHARACTER, '-');

      return;
    }
    this.current = SCRIPT_DATA;
    this.call(cp);
  }

  private scriptDataEscaped(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */:
        this.current = SCRIPT_DATA_ESCAPED_DASH;
        this.emitChars(CHARACTER, '-');
        break;
      case 0x3c /* LESS_THAN */: this.current = SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN; break;
      case 0x00 /* NUL */: this.emitChars(CHARACTER, REPLACEMENT); break;
      case -1 /* EOF */: this.emitEof(); break;
      default: this.emitTextRun(cp, SCRIPT_ESCAPED_RUN);
    }
  }

  private scriptDataEscapedDash(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */:
        this.current = SCRIPT_DATA_ESCAPED_DASH_DASH;
        this.emitChars(CHARACTER, '-');
        break;
      case 0x3c /* LESS_THAN */: this.current = SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN; break;
      case 0x00 /* NUL */:
        this.current = SCRIPT_DATA_ESCAPED;
        this.emitChars(CHARACTER, REPLACEMENT);
        break;
      case -1 /* EOF */: this.emitEof(); break;
      default:
        this.current = SCRIPT_DATA_ESCAPED;
        this.emitCodePoint(cp);
    }
  }

  private scriptDataEscapedDashDash(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */: this.emitChars(CHARACTER, '-'); break;
      case 0x3c /* LESS_THAN */: this.current = SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN; break;
      case 0x3e /* GREATER_THAN */:
        this.current = SCRIPT_DATA;
        this.emitChars(CHARACTER, '>');
        break;
      case 0x00 /* NUL */:
        this.current = SCRIPT_DATA_ESCAPED;
        this.emitChars(CHARACTER, REPLACEMENT);
        break;
      case -1 /* EOF */: this.emitEof(); break;
      default:
        this.current = SCRIPT_DATA_ESCAPED;
        this.emitCodePoint(cp);
    }
  }

  private scriptDataEscapedLessThanSign(cp: number): void {
    if (cp === SOLIDUS) {
      this.current = SCRIPT_DATA_ESCAPED_END_TAG_OPEN;

      return;
    }
    this.emitChars(CHARACTER, '<');
    this.current = isAsciiLetter(cp) ? SCRIPT_DATA_DOUBLE_ESCAPE_START : SCRIPT_DATA_ESCAPED;
    this.call(cp);
  }

  /** `script` + whitespace, `/` or `>` switches between escaped and double escaped; parse5 checks the word at once. */
  private scriptDataDoubleEscapeSwitch(cp: number, matchState: number, otherState: number): void {
    const start = this.pos - 1;
    const next = start + 6 < this.html.length ? this.html.charCodeAt(start + 6) : EOF;

    if (this.startsWithWord(SCRIPT_WORD) && (isWhitespace(next) || next === SOLIDUS || next === GREATER_THAN)) {
      this.emitChars(CHARACTER, this.html.slice(start, start + 6));
      this.emitCodePoint(next);
      this.pos = start + 7;
      this.current = matchState;

      return;
    }
    this.current = otherState;
    this.call(cp);
  }

  private scriptDataDoubleEscaped(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_DASH;
        this.emitChars(CHARACTER, '-');
        break;
      case 0x3c /* LESS_THAN */:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this.emitChars(CHARACTER, '<');
        break;
      case 0x00 /* NUL */: this.emitChars(CHARACTER, REPLACEMENT); break;
      case -1 /* EOF */: this.emitEof(); break;
      default: this.emitTextRun(cp, SCRIPT_ESCAPED_RUN);
    }
  }

  private scriptDataDoubleEscapedDash(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH;
        this.emitChars(CHARACTER, '-');
        break;
      case 0x3c /* LESS_THAN */:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this.emitChars(CHARACTER, '<');
        break;
      case 0x00 /* NUL */:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
        this.emitChars(CHARACTER, REPLACEMENT);
        break;
      case -1 /* EOF */: this.emitEof(); break;
      default:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
        this.emitCodePoint(cp);
    }
  }

  private scriptDataDoubleEscapedDashDash(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */: this.emitChars(CHARACTER, '-'); break;
      case 0x3c /* LESS_THAN */:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this.emitChars(CHARACTER, '<');
        break;
      case 0x3e /* GREATER_THAN */:
        this.current = SCRIPT_DATA;
        this.emitChars(CHARACTER, '>');
        break;
      case 0x00 /* NUL */:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
        this.emitChars(CHARACTER, REPLACEMENT);
        break;
      case -1 /* EOF */: this.emitEof(); break;
      default:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
        this.emitCodePoint(cp);
    }
  }

  private scriptDataDoubleEscapedLessThanSign(cp: number): void {
    if (cp === SOLIDUS) {
      this.current = SCRIPT_DATA_DOUBLE_ESCAPE_END;
      this.emitChars(CHARACTER, '/');

      return;
    }
    this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
    this.scriptDataDoubleEscaped(cp);
  }

  // Attributes

  private beforeAttributeName(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: break;
      case 0x2f /* SOLIDUS */: case 0x3e /* GREATER_THAN */: case -1 /* EOF */:
        this.current = AFTER_ATTRIBUTE_NAME;
        this.afterAttributeName(cp);
        break;
      case 0x3d /* EQUALS */:
        this.startAttr('=');
        this.current = ATTRIBUTE_NAME;
        break;
      default:
        this.startAttr('');
        this.current = ATTRIBUTE_NAME;
        this.attributeName(cp);
    }
  }

  private attributeName(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: case 0x2f /* SOLIDUS */: case 0x3e /* GREATER_THAN */: case -1 /* EOF */:
        this.leaveAttrName();
        this.current = AFTER_ATTRIBUTE_NAME;
        this.afterAttributeName(cp);
        break;
      case 0x3d /* EQUALS */:
        this.leaveAttrName();
        this.current = BEFORE_ATTRIBUTE_VALUE;
        break;
      case 0x00 /* NUL */: this.attr.name += REPLACEMENT; break;
      default: {
        const start = this.pos - 1;

        this.pos = ATTRIBUTE_NAME_RUN.end(this.html, start);
        this.attr.name += lowerAscii(this.html.slice(start, this.pos));
      }
    }
  }

  private afterAttributeName(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: break;
      case 0x2f /* SOLIDUS */: this.current = SELF_CLOSING_START_TAG; break;
      case 0x3d /* EQUALS */: this.current = BEFORE_ATTRIBUTE_VALUE; break;
      case 0x3e /* GREATER_THAN */: this.emitTag(); break;
      case -1 /* EOF */: this.emitEof(); break;
      default:
        this.startAttr('');
        this.current = ATTRIBUTE_NAME;
        this.attributeName(cp);
    }
  }

  private beforeAttributeValue(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: break;
      case 0x22 /* QUOTE */: this.current = ATTRIBUTE_VALUE_DOUBLE_QUOTED; break;
      case 0x27 /* APOSTROPHE */: this.current = ATTRIBUTE_VALUE_SINGLE_QUOTED; break;
      case 0x3e /* GREATER_THAN */: this.emitTag(); break;
      default:
        this.current = ATTRIBUTE_VALUE_UNQUOTED;
        this.attributeValueUnquoted(cp);
    }
  }

  private attributeValueQuoted(cp: number, quote: number, run: Sticky, ownState: number): void {
    switch (cp) {
      case quote: this.current = AFTER_ATTRIBUTE_VALUE_QUOTED; break;
      case 0x26 /* AMPERSAND */: this.startCharRef(ownState); break;
      case 0x00 /* NUL */: this.attr.value += REPLACEMENT; break;
      case -1 /* EOF */: this.emitEof(); break;
      default: {
        const start = this.pos - 1;

        this.pos = run.end(this.html, start);
        this.attr.value += this.html.slice(start, this.pos);
      }
    }
  }

  private attributeValueUnquoted(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.current = BEFORE_ATTRIBUTE_NAME; break;
      case 0x26 /* AMPERSAND */: this.startCharRef(ATTRIBUTE_VALUE_UNQUOTED); break;
      case 0x3e /* GREATER_THAN */: this.emitTag(); break;
      case 0x00 /* NUL */: this.attr.value += REPLACEMENT; break;
      case -1 /* EOF */: this.emitEof(); break;
      default: {
        const start = this.pos - 1;

        this.pos = UNQUOTED_RUN.end(this.html, start);
        this.attr.value += this.html.slice(start, this.pos);
      }
    }
  }

  private afterAttributeValueQuoted(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.current = BEFORE_ATTRIBUTE_NAME; break;
      case 0x2f /* SOLIDUS */: this.current = SELF_CLOSING_START_TAG; break;
      case 0x3e /* GREATER_THAN */: this.emitTag(); break;
      case -1 /* EOF */: this.emitEof(); break;
      default:
        this.current = BEFORE_ATTRIBUTE_NAME;
        this.beforeAttributeName(cp);
    }
  }

  private selfClosingStartTag(cp: number): void {
    switch (cp) {
      case 0x3e /* GREATER_THAN */:
        this.tag.selfClosing = true;
        this.emitTag();
        break;
      case -1 /* EOF */: this.emitEof(); break;
      default:
        this.current = BEFORE_ATTRIBUTE_NAME;
        this.beforeAttributeName(cp);
    }
  }

  // Comments

  private bogusComment(cp: number): void {
    switch (cp) {
      case 0x3e /* GREATER_THAN */:
        this.current = DATA;
        this.emitComment();
        break;
      case -1 /* EOF */:
        this.emitComment();
        this.emitEof();
        break;
      case 0x00 /* NUL */: this.comment.data += REPLACEMENT; break;
      default: {
        const start = this.pos - 1;

        this.pos = BOGUS_COMMENT_RUN.end(this.html, start);
        this.comment.data += this.html.slice(start, this.pos);
      }
    }
  }

  private markupDeclarationOpen(cp: number): void {
    const html = this.html;
    const start = this.pos - 1;

    if (html.startsWith('--', start)) {
      this.pos = start + 2;
      this.startComment('');
      this.current = COMMENT_START;
    } else if (this.startsWithWord(DOCTYPE_WORD)) {
      this.pos = start + 7;
      this.current = DOCTYPE;
    } else if (html.startsWith('[CDATA[', start)) {
      this.pos = start + 7;
      this.cdataStart();
    } else {
      this.startComment('');
      this.current = BOGUS_COMMENT;
      this.bogusComment(cp);
    }
  }

  /** `<![CDATA[` is a CDATA section only inside foreign content; elsewhere it is a bogus comment. */
  private cdataStart(): void {
    if (this.inForeignNode) {
      this.current = CDATA_SECTION;

      return;
    }
    this.startComment('[CDATA[');
    this.current = BOGUS_COMMENT;
  }

  private commentStart(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */: this.current = COMMENT_START_DASH; break;
      case 0x3e /* GREATER_THAN */:
        this.current = DATA;
        this.emitComment();
        break;
      default:
        this.current = COMMENT;
        this.commentState(cp);
    }
  }

  private commentStartDash(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */: this.current = COMMENT_END; break;
      case 0x3e /* GREATER_THAN */:
        this.current = DATA;
        this.emitComment();
        break;
      case -1 /* EOF */:
        this.emitComment();
        this.emitEof();
        break;
      default:
        this.comment.data += '-';
        this.current = COMMENT;
        this.commentState(cp);
    }
  }

  private commentState(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */: this.current = COMMENT_END_DASH; break;
      case 0x3c /* LESS_THAN */:
        this.comment.data += '<';
        this.current = COMMENT_LESS_THAN_SIGN;
        break;
      case 0x00 /* NUL */: this.comment.data += REPLACEMENT; break;
      case -1 /* EOF */:
        this.emitComment();
        this.emitEof();
        break;
      default: {
        const start = this.pos - 1;

        this.pos = COMMENT_RUN.end(this.html, start);
        this.comment.data += this.html.slice(start, this.pos);
      }
    }
  }

  private commentLessThanSign(cp: number): void {
    switch (cp) {
      case 0x21 /* BANG */:
        this.comment.data += '!';
        this.current = COMMENT_LESS_THAN_SIGN_BANG;
        break;
      case 0x3c /* LESS_THAN */: this.comment.data += '<'; break;
      default:
        this.current = COMMENT;
        this.commentState(cp);
    }
  }

  private commentLessThanSignBang(cp: number): void {
    this.current = cp === HYPHEN ? COMMENT_LESS_THAN_SIGN_BANG_DASH : COMMENT;
    if (cp !== HYPHEN) {
      this.commentState(cp);
    }
  }

  private commentLessThanSignBangDash(cp: number): void {
    this.current = cp === HYPHEN ? COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH : COMMENT_END_DASH;
    if (cp !== HYPHEN) {
      this.commentEndDash(cp);
    }
  }

  private commentLessThanSignBangDashDash(cp: number): void {
    this.current = COMMENT_END;
    this.commentEnd(cp);
  }

  private commentEndDash(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */: this.current = COMMENT_END; break;
      case -1 /* EOF */:
        this.emitComment();
        this.emitEof();
        break;
      default:
        this.comment.data += '-';
        this.current = COMMENT;
        this.commentState(cp);
    }
  }

  private commentEnd(cp: number): void {
    switch (cp) {
      case 0x3e /* GREATER_THAN */:
        this.current = DATA;
        this.emitComment();
        break;
      case 0x21 /* BANG */: this.current = COMMENT_END_BANG; break;
      case 0x2d /* HYPHEN */: this.comment.data += '-'; break;
      case -1 /* EOF */:
        this.emitComment();
        this.emitEof();
        break;
      default:
        this.comment.data += '--';
        this.current = COMMENT;
        this.commentState(cp);
    }
  }

  private commentEndBang(cp: number): void {
    switch (cp) {
      case 0x2d /* HYPHEN */:
        this.comment.data += '--!';
        this.current = COMMENT_END_DASH;
        break;
      case 0x3e /* GREATER_THAN */:
        this.current = DATA;
        this.emitComment();
        break;
      case -1 /* EOF */:
        this.emitComment();
        this.emitEof();
        break;
      default:
        this.comment.data += '--!';
        this.current = COMMENT;
        this.commentState(cp);
    }
  }

  // DOCTYPE

  /** Emits a DOCTYPE with no name, in quirks mode, then EOF. */
  private emitEofDoctype(): void {
    this.startDoctype(null);
    this.doctype.forceQuirks = true;
    this.emitDoctype();
    this.emitEof();
  }

  /** EOF inside a DOCTYPE: emit it in quirks mode, then EOF. */
  private eofInDoctype(): void {
    this.doctype.forceQuirks = true;
    this.emitDoctype();
    this.emitEof();
  }

  private doctypeState(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.current = BEFORE_DOCTYPE_NAME; break;
      case -1 /* EOF */: this.emitEofDoctype(); break;
      default:
        this.current = BEFORE_DOCTYPE_NAME;
        this.beforeDoctypeName(cp);
    }
  }

  private beforeDoctypeName(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: break;
      case 0x00 /* NUL */:
        this.startDoctype(REPLACEMENT);
        this.current = DOCTYPE_NAME;
        break;
      case 0x3e /* GREATER_THAN */:
        this.startDoctype(null);
        this.doctype.forceQuirks = true;
        this.emitDoctype();
        this.current = DATA;
        break;
      case -1 /* EOF */: this.emitEofDoctype(); break;
      default:
        this.startDoctype(lowerAscii(String.fromCharCode(cp)));
        this.current = DOCTYPE_NAME;
    }
  }

  private doctypeName(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.current = AFTER_DOCTYPE_NAME; break;
      case 0x3e /* GREATER_THAN */:
        this.current = DATA;
        this.emitDoctype();
        break;
      case 0x00 /* NUL */: this.doctype.name += REPLACEMENT; break;
      case -1 /* EOF */: this.eofInDoctype(); break;
      default: this.doctype.name += lowerAscii(String.fromCharCode(cp));
    }
  }

  private afterDoctypeName(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: break;
      case 0x3e /* GREATER_THAN */:
        this.current = DATA;
        this.emitDoctype();
        break;
      case -1 /* EOF */: this.eofInDoctype(); break;
      default: this.doctypeKeyword(cp);
    }
  }

  private doctypeKeyword(cp: number): void {
    const start = this.pos - 1;

    if (this.startsWithWord(PUBLIC_WORD)) {
      this.pos = start + 6;
      this.current = AFTER_DOCTYPE_PUBLIC_KEYWORD;
    } else if (this.startsWithWord(SYSTEM_WORD)) {
      this.pos = start + 6;
      this.current = AFTER_DOCTYPE_SYSTEM_KEYWORD;
    } else {
      this.doctype.forceQuirks = true;
      this.current = BOGUS_DOCTYPE;
      this.bogusDoctype(cp);
    }
  }

  /** Starts the public or the system identifier, quoted by `cp`. */
  private openDoctypeIdentifier(cp: number, isPublic: boolean): void {
    if (isPublic) {
      this.doctype.publicId = '';
      this.current = cp === QUOTE ? DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED : DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED;
    } else {
      this.doctype.systemId = '';
      this.current = cp === QUOTE ? DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED : DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED;
    }
  }

  private quirkyDoctypeEnd(cp: number): void {
    this.doctype.forceQuirks = true;
    if (cp === GREATER_THAN) {
      this.current = DATA;
      this.emitDoctype();
    } else if (cp === EOF) {
      this.eofInDoctype();
    } else {
      this.current = BOGUS_DOCTYPE;
      this.bogusDoctype(cp);
    }
  }

  private afterDoctypeKeyword(cp: number, isPublic: boolean): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */:
        this.current = isPublic ? BEFORE_DOCTYPE_PUBLIC_IDENTIFIER : BEFORE_DOCTYPE_SYSTEM_IDENTIFIER;
        break;
      case 0x22 /* QUOTE */: case 0x27 /* APOSTROPHE */: this.openDoctypeIdentifier(cp, isPublic); break;
      default: this.quirkyDoctypeEnd(cp);
    }
  }

  private beforeDoctypeIdentifier(cp: number, isPublic: boolean): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: break;
      case 0x22 /* QUOTE */: case 0x27 /* APOSTROPHE */: this.openDoctypeIdentifier(cp, isPublic); break;
      default: this.quirkyDoctypeEnd(cp);
    }
  }

  private doctypeIdentifier(cp: number, quote: number, isPublic: boolean): void {
    if (cp === quote) {
      this.current = isPublic ? AFTER_DOCTYPE_PUBLIC_IDENTIFIER : AFTER_DOCTYPE_SYSTEM_IDENTIFIER;

      return;
    }
    if (cp === GREATER_THAN || cp === EOF) {
      this.doctype.forceQuirks = true;
      this.emitDoctype();
      this.current = DATA;
      if (cp === EOF) {
        this.emitEof();
      }

      return;
    }
    const text = cp === NUL ? REPLACEMENT : String.fromCharCode(cp);

    if (isPublic) {
      this.doctype.publicId += text;
    } else {
      this.doctype.systemId += text;
    }
  }

  private afterDoctypePublicIdentifier(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: this.current = BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS; break;
      case 0x3e /* GREATER_THAN */:
        this.current = DATA;
        this.emitDoctype();
        break;
      case 0x22 /* QUOTE */: case 0x27 /* APOSTROPHE */: this.openDoctypeIdentifier(cp, false); break;
      default: this.quirkyDoctypeEnd(cp);
    }
  }

  private betweenDoctypePublicAndSystemIdentifiers(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: break;
      case 0x3e /* GREATER_THAN */:
        this.emitDoctype();
        this.current = DATA;
        break;
      case 0x22 /* QUOTE */: case 0x27 /* APOSTROPHE */: this.openDoctypeIdentifier(cp, false); break;
      default: this.quirkyDoctypeEnd(cp);
    }
  }

  private afterDoctypeSystemIdentifier(cp: number): void {
    switch (cp) {
      case 0x20 /* SPACE */: case 0x0a /* LF */: case 0x09 /* TAB */: case 0x0c /* FF */: break;
      case 0x3e /* GREATER_THAN */:
        this.emitDoctype();
        this.current = DATA;
        break;
      case -1 /* EOF */: this.eofInDoctype(); break;
      default:
        this.current = BOGUS_DOCTYPE;
        this.bogusDoctype(cp);
    }
  }

  private bogusDoctype(cp: number): void {
    if (cp === GREATER_THAN) {
      this.emitDoctype();
      this.current = DATA;
    } else if (cp === EOF) {
      this.emitDoctype();
      this.emitEof();
    } else {
      this.badPairs?.delete(this.pos - 1);
    }
  }

  // CDATA

  /** CDATA keeps a NUL as is, unlike every other text state. */
  private cdataSection(cp: number): void {
    switch (cp) {
      case 0x5d /* RIGHT_BRACKET */: this.current = CDATA_SECTION_BRACKET; break;
      case -1 /* EOF */: this.emitEof(); break;
      case 0x00 /* NUL */: this.emitRun(NULL_CHARACTER, NUL_RUN); break;
      default: this.emitTextRun(cp, CDATA_RUN);
    }
  }

  private cdataSectionBracket(cp: number): void {
    if (cp === RIGHT_BRACKET) {
      this.current = CDATA_SECTION_END;

      return;
    }
    this.emitChars(CHARACTER, ']');
    this.current = CDATA_SECTION;
    this.cdataSection(cp);
  }

  private cdataSectionEnd(cp: number): void {
    switch (cp) {
      case 0x3e /* GREATER_THAN */: this.current = DATA; break;
      case 0x5d /* RIGHT_BRACKET */: this.emitChars(CHARACTER, ']'); break;
      default:
        this.emitChars(CHARACTER, ']]');
        this.current = CDATA_SECTION;
        this.cdataSection(cp);
    }
  }
}

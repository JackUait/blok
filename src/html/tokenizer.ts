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
const PLAINTEXT = 4;
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
const BANG = 0x21;
const QUOTE = 0x22;
const AMPERSAND = 0x26;
const APOSTROPHE = 0x27;
const HYPHEN = 0x2d;
const SOLIDUS = 0x2f;
const LESS_THAN = 0x3c;
const EQUALS = 0x3d;
const GREATER_THAN = 0x3e;
const QUESTION = 0x3f;
const RIGHT_BRACKET = 0x5d;

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
const RAWTEXT_RUN = new Sticky(/[^\t\n\f <\0]+/y);
const PLAINTEXT_RUN = new Sticky(/[^\t\n\f \0]+/y);
const TAG_NAME_RUN = new Sticky(/[^\t\n\f />\0]+/y);
const ATTRIBUTE_NAME_RUN = new Sticky(/[^\t\n\f />=\0]+/y);
const DOUBLE_QUOTED_RUN = new Sticky(/[^"&\0]+/y);
const SINGLE_QUOTED_RUN = new Sticky(/[^'&\0]+/y);
const UNQUOTED_RUN = new Sticky(/[^\t\n\f &>\0]+/y);
const COMMENT_RUN = new Sticky(/[^\-<\0]+/y);
const BOGUS_COMMENT_RUN = new Sticky(/[^>\0]+/y);
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

  constructor(private readonly handler: TokenHandler) {}

  private static createTag(type: TokenType.START_TAG | TokenType.END_TAG): TagToken {
    return { type, tagName: '', tagID: TAG_ID.UNKNOWN, selfClosing: false, ackSelfClosing: false, attrs: [] };
  }

  /** Tokenizes the whole string, ending with one EOF token. */
  public write(html: string): void {
    this.html = html.indexOf('\r') < 0 ? html : html.replace(/\r\n?/g, '\n');
    this.pos = 0;
    this.current = this.state;
    while (this.current !== ENDED) {
      const cp = this.pos < this.html.length ? this.html.charCodeAt(this.pos) : EOF;

      this.pos++;
      this.call(cp);
    }
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
    if (type === TokenType.CHARACTER) {
      this.handler.onCharacter({ type, chars: this.pendingChars });
    } else if (type === TokenType.WHITESPACE_CHARACTER) {
      this.handler.onWhitespaceCharacter({ type, chars: this.pendingChars });
    } else {
      this.handler.onNullCharacter({ type, chars: this.pendingChars });
    }
  }

  /** Emits a decoded reference: a lone whitespace character is whitespace, all else is text. */
  private emitRefText(text: string): void {
    this.emitChars(text.length === 1 && isWhitespace(text.charCodeAt(0)) ? TokenType.WHITESPACE_CHARACTER : TokenType.CHARACTER, text);
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

  private call(cp: number): void {
    switch (this.current) {
      case DATA: return this.data(cp);
      case RCDATA: return this.rcdata(cp);
      case RAWTEXT: return this.rawtext(cp, RAWTEXT_LESS_THAN_SIGN);
      case SCRIPT_DATA: return this.rawtext(cp, SCRIPT_DATA_LESS_THAN_SIGN);
      case PLAINTEXT: return this.plaintext(cp);
      case TAG_OPEN: return this.tagOpen(cp);
      case END_TAG_OPEN: return this.endTagOpen(cp);
      case TAG_NAME: return this.tagName(cp);
      case RCDATA_LESS_THAN_SIGN: return this.textLessThanSign(cp, RCDATA_END_TAG_OPEN, RCDATA);
      case RCDATA_END_TAG_OPEN: return this.textEndTagOpen(cp, RCDATA);
      case RAWTEXT_LESS_THAN_SIGN: return this.textLessThanSign(cp, RAWTEXT_END_TAG_OPEN, RAWTEXT);
      case RAWTEXT_END_TAG_OPEN: return this.textEndTagOpen(cp, RAWTEXT);
      case SCRIPT_DATA_LESS_THAN_SIGN: return this.scriptDataLessThanSign(cp);
      case SCRIPT_DATA_END_TAG_OPEN: return this.textEndTagOpen(cp, SCRIPT_DATA);
      case SCRIPT_DATA_ESCAPE_START: return this.scriptDataEscapeStart(cp, SCRIPT_DATA_ESCAPE_START_DASH);
      case SCRIPT_DATA_ESCAPE_START_DASH: return this.scriptDataEscapeStart(cp, SCRIPT_DATA_ESCAPED_DASH_DASH);
      case SCRIPT_DATA_ESCAPED: return this.scriptDataEscaped(cp);
      case SCRIPT_DATA_ESCAPED_DASH: return this.scriptDataEscapedDash(cp);
      case SCRIPT_DATA_ESCAPED_DASH_DASH: return this.scriptDataEscapedDashDash(cp);
      case SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN: return this.scriptDataEscapedLessThanSign(cp);
      case SCRIPT_DATA_ESCAPED_END_TAG_OPEN: return this.textEndTagOpen(cp, SCRIPT_DATA_ESCAPED);
      case SCRIPT_DATA_DOUBLE_ESCAPE_START: return this.scriptDataDoubleEscapeSwitch(cp, SCRIPT_DATA_DOUBLE_ESCAPED, SCRIPT_DATA_ESCAPED);
      case SCRIPT_DATA_DOUBLE_ESCAPED: return this.scriptDataDoubleEscaped(cp);
      case SCRIPT_DATA_DOUBLE_ESCAPED_DASH: return this.scriptDataDoubleEscapedDash(cp);
      case SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH: return this.scriptDataDoubleEscapedDashDash(cp);
      case SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN: return this.scriptDataDoubleEscapedLessThanSign(cp);
      case SCRIPT_DATA_DOUBLE_ESCAPE_END: return this.scriptDataDoubleEscapeSwitch(cp, SCRIPT_DATA_ESCAPED, SCRIPT_DATA_DOUBLE_ESCAPED);
      case BEFORE_ATTRIBUTE_NAME: return this.beforeAttributeName(cp);
      case ATTRIBUTE_NAME: return this.attributeName(cp);
      case AFTER_ATTRIBUTE_NAME: return this.afterAttributeName(cp);
      case BEFORE_ATTRIBUTE_VALUE: return this.beforeAttributeValue(cp);
      case ATTRIBUTE_VALUE_DOUBLE_QUOTED: return this.attributeValueQuoted(cp, QUOTE, DOUBLE_QUOTED_RUN, ATTRIBUTE_VALUE_DOUBLE_QUOTED);
      case ATTRIBUTE_VALUE_SINGLE_QUOTED: return this.attributeValueQuoted(cp, APOSTROPHE, SINGLE_QUOTED_RUN, ATTRIBUTE_VALUE_SINGLE_QUOTED);
      case ATTRIBUTE_VALUE_UNQUOTED: return this.attributeValueUnquoted(cp);
      case AFTER_ATTRIBUTE_VALUE_QUOTED: return this.afterAttributeValueQuoted(cp);
      case SELF_CLOSING_START_TAG: return this.selfClosingStartTag(cp);
      case BOGUS_COMMENT: return this.bogusComment(cp);
      case MARKUP_DECLARATION_OPEN: return this.markupDeclarationOpen(cp);
      case COMMENT_START: return this.commentStart(cp);
      case COMMENT_START_DASH: return this.commentStartDash(cp);
      case COMMENT: return this.commentState(cp);
      case COMMENT_LESS_THAN_SIGN: return this.commentLessThanSign(cp);
      case COMMENT_LESS_THAN_SIGN_BANG: return this.commentLessThanSignBang(cp);
      case COMMENT_LESS_THAN_SIGN_BANG_DASH: return this.commentLessThanSignBangDash(cp);
      case COMMENT_LESS_THAN_SIGN_BANG_DASH_DASH: return this.commentLessThanSignBangDashDash(cp);
      case COMMENT_END_DASH: return this.commentEndDash(cp);
      case COMMENT_END: return this.commentEnd(cp);
      case COMMENT_END_BANG: return this.commentEndBang(cp);
      case DOCTYPE: return this.doctypeState(cp);
      case BEFORE_DOCTYPE_NAME: return this.beforeDoctypeName(cp);
      case DOCTYPE_NAME: return this.doctypeName(cp);
      case AFTER_DOCTYPE_NAME: return this.afterDoctypeName(cp);
      case AFTER_DOCTYPE_PUBLIC_KEYWORD: return this.afterDoctypeKeyword(cp, true);
      case BEFORE_DOCTYPE_PUBLIC_IDENTIFIER: return this.beforeDoctypeIdentifier(cp, true);
      case DOCTYPE_PUBLIC_IDENTIFIER_DOUBLE_QUOTED: return this.doctypeIdentifier(cp, QUOTE, true);
      case DOCTYPE_PUBLIC_IDENTIFIER_SINGLE_QUOTED: return this.doctypeIdentifier(cp, APOSTROPHE, true);
      case AFTER_DOCTYPE_PUBLIC_IDENTIFIER: return this.afterDoctypePublicIdentifier(cp);
      case BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS: return this.betweenDoctypePublicAndSystemIdentifiers(cp);
      case AFTER_DOCTYPE_SYSTEM_KEYWORD: return this.afterDoctypeKeyword(cp, false);
      case BEFORE_DOCTYPE_SYSTEM_IDENTIFIER: return this.beforeDoctypeIdentifier(cp, false);
      case DOCTYPE_SYSTEM_IDENTIFIER_DOUBLE_QUOTED: return this.doctypeIdentifier(cp, QUOTE, false);
      case DOCTYPE_SYSTEM_IDENTIFIER_SINGLE_QUOTED: return this.doctypeIdentifier(cp, APOSTROPHE, false);
      case AFTER_DOCTYPE_SYSTEM_IDENTIFIER: return this.afterDoctypeSystemIdentifier(cp);
      case BOGUS_DOCTYPE: return this.bogusDoctype(cp);
      case CDATA_SECTION: return this.cdataSection(cp);
      case CDATA_SECTION_BRACKET: return this.cdataSectionBracket(cp);
      case CDATA_SECTION_END: return this.cdataSectionEnd(cp);
      default: throw new Error(`Unknown tokenizer state ${this.current}`);
    }
  }

  // Text states

  private data(cp: number): void {
    switch (cp) {
      case LESS_THAN: this.current = TAG_OPEN; break;
      case AMPERSAND: this.startCharRef(DATA); break;
      case NUL: this.emitRun(TokenType.NULL_CHARACTER, NUL_RUN); break;
      case EOF: this.emitEof(); break;
      case SPACE: case LF: case TAB: case FF: this.emitRun(TokenType.WHITESPACE_CHARACTER, WHITESPACE_RUN); break;
      default: this.emitRun(TokenType.CHARACTER, DATA_RUN);
    }
  }

  /** A NUL in RCDATA, RAWTEXT, script data or PLAINTEXT reads as U+FFFD. */
  private emitReplacementRun(): void {
    const end = NUL_RUN.end(this.html, this.pos - 1);

    this.emitChars(TokenType.CHARACTER, REPLACEMENT.repeat(end - this.pos + 1));
    this.pos = end;
  }

  private rcdata(cp: number): void {
    switch (cp) {
      case AMPERSAND: this.startCharRef(RCDATA); break;
      case LESS_THAN: this.current = RCDATA_LESS_THAN_SIGN; break;
      case NUL: this.emitReplacementRun(); break;
      case EOF: this.emitEof(); break;
      case SPACE: case LF: case TAB: case FF: this.emitRun(TokenType.WHITESPACE_CHARACTER, WHITESPACE_RUN); break;
      default: this.emitRun(TokenType.CHARACTER, DATA_RUN);
    }
  }

  /** RAWTEXT and script data: no references, `<` may start the end tag. */
  private rawtext(cp: number, lessThanState: number): void {
    switch (cp) {
      case LESS_THAN: this.current = lessThanState; break;
      case NUL: this.emitReplacementRun(); break;
      case EOF: this.emitEof(); break;
      case SPACE: case LF: case TAB: case FF: this.emitRun(TokenType.WHITESPACE_CHARACTER, WHITESPACE_RUN); break;
      default: this.emitRun(TokenType.CHARACTER, RAWTEXT_RUN);
    }
  }

  private plaintext(cp: number): void {
    switch (cp) {
      case NUL: this.emitReplacementRun(); break;
      case EOF: this.emitEof(); break;
      case SPACE: case LF: case TAB: case FF: this.emitRun(TokenType.WHITESPACE_CHARACTER, WHITESPACE_RUN); break;
      default: this.emitRun(TokenType.CHARACTER, PLAINTEXT_RUN);
    }
  }

  /** One code point emitted as is, in the kind its value calls for. */
  private emitCodePoint(cp: number): void {
    if (isWhitespace(cp)) {
      this.emitChars(TokenType.WHITESPACE_CHARACTER, String.fromCharCode(cp));
    } else {
      this.emitChars(cp === NUL ? TokenType.NULL_CHARACTER : TokenType.CHARACTER, String.fromCharCode(cp));
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
      case BANG: this.current = MARKUP_DECLARATION_OPEN; break;
      case SOLIDUS: this.current = END_TAG_OPEN; break;
      case QUESTION:
        this.startComment('');
        this.current = BOGUS_COMMENT;
        this.bogusComment(cp);
        break;
      case EOF:
        this.emitChars(TokenType.CHARACTER, '<');
        this.emitEof();
        break;
      default:
        this.emitChars(TokenType.CHARACTER, '<');
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
      case GREATER_THAN: this.current = DATA; break;
      case EOF:
        this.emitChars(TokenType.CHARACTER, '</');
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
      case SPACE: case LF: case TAB: case FF: this.current = BEFORE_ATTRIBUTE_NAME; break;
      case SOLIDUS: this.current = SELF_CLOSING_START_TAG; break;
      case GREATER_THAN: this.emitTag(); break;
      case NUL: this.tag.tagName += REPLACEMENT; break;
      case EOF: this.emitEof(); break;
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
    this.emitChars(TokenType.CHARACTER, '<');
    this.current = textState;
    this.call(cp);
  }

  /** `</` in RCDATA, RAWTEXT or script data: an end tag only if the last start tag's name follows. */
  private textEndTagOpen(cp: number, textState: number): void {
    if (isAsciiLetter(cp) && this.specialEndTag()) {
      return;
    }
    this.emitChars(TokenType.CHARACTER, '</');
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
      case SOLIDUS: this.current = SCRIPT_DATA_END_TAG_OPEN; break;
      case BANG:
        this.current = SCRIPT_DATA_ESCAPE_START;
        this.emitChars(TokenType.CHARACTER, '<!');
        break;
      default:
        this.emitChars(TokenType.CHARACTER, '<');
        this.current = SCRIPT_DATA;
        this.call(cp);
    }
  }

  private scriptDataEscapeStart(cp: number, dashState: number): void {
    if (cp === HYPHEN) {
      this.current = dashState;
      this.emitChars(TokenType.CHARACTER, '-');

      return;
    }
    this.current = SCRIPT_DATA;
    this.call(cp);
  }

  private scriptDataEscaped(cp: number): void {
    switch (cp) {
      case HYPHEN:
        this.current = SCRIPT_DATA_ESCAPED_DASH;
        this.emitChars(TokenType.CHARACTER, '-');
        break;
      case LESS_THAN: this.current = SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN; break;
      case NUL: this.emitChars(TokenType.CHARACTER, REPLACEMENT); break;
      case EOF: this.emitEof(); break;
      default: this.emitCodePoint(cp);
    }
  }

  private scriptDataEscapedDash(cp: number): void {
    switch (cp) {
      case HYPHEN:
        this.current = SCRIPT_DATA_ESCAPED_DASH_DASH;
        this.emitChars(TokenType.CHARACTER, '-');
        break;
      case LESS_THAN: this.current = SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN; break;
      case NUL:
        this.current = SCRIPT_DATA_ESCAPED;
        this.emitChars(TokenType.CHARACTER, REPLACEMENT);
        break;
      case EOF: this.emitEof(); break;
      default:
        this.current = SCRIPT_DATA_ESCAPED;
        this.emitCodePoint(cp);
    }
  }

  private scriptDataEscapedDashDash(cp: number): void {
    switch (cp) {
      case HYPHEN: this.emitChars(TokenType.CHARACTER, '-'); break;
      case LESS_THAN: this.current = SCRIPT_DATA_ESCAPED_LESS_THAN_SIGN; break;
      case GREATER_THAN:
        this.current = SCRIPT_DATA;
        this.emitChars(TokenType.CHARACTER, '>');
        break;
      case NUL:
        this.current = SCRIPT_DATA_ESCAPED;
        this.emitChars(TokenType.CHARACTER, REPLACEMENT);
        break;
      case EOF: this.emitEof(); break;
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
    this.emitChars(TokenType.CHARACTER, '<');
    this.current = isAsciiLetter(cp) ? SCRIPT_DATA_DOUBLE_ESCAPE_START : SCRIPT_DATA_ESCAPED;
    this.call(cp);
  }

  /** `script` + whitespace, `/` or `>` switches between escaped and double escaped; parse5 checks the word at once. */
  private scriptDataDoubleEscapeSwitch(cp: number, matchState: number, otherState: number): void {
    const start = this.pos - 1;
    const next = start + 6 < this.html.length ? this.html.charCodeAt(start + 6) : EOF;

    if (this.startsWithWord(SCRIPT_WORD) && (isWhitespace(next) || next === SOLIDUS || next === GREATER_THAN)) {
      this.emitChars(TokenType.CHARACTER, this.html.slice(start, start + 6));
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
      case HYPHEN:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_DASH;
        this.emitChars(TokenType.CHARACTER, '-');
        break;
      case LESS_THAN:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this.emitChars(TokenType.CHARACTER, '<');
        break;
      case NUL: this.emitChars(TokenType.CHARACTER, REPLACEMENT); break;
      case EOF: this.emitEof(); break;
      default: this.emitCodePoint(cp);
    }
  }

  private scriptDataDoubleEscapedDash(cp: number): void {
    switch (cp) {
      case HYPHEN:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_DASH_DASH;
        this.emitChars(TokenType.CHARACTER, '-');
        break;
      case LESS_THAN:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this.emitChars(TokenType.CHARACTER, '<');
        break;
      case NUL:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
        this.emitChars(TokenType.CHARACTER, REPLACEMENT);
        break;
      case EOF: this.emitEof(); break;
      default:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
        this.emitCodePoint(cp);
    }
  }

  private scriptDataDoubleEscapedDashDash(cp: number): void {
    switch (cp) {
      case HYPHEN: this.emitChars(TokenType.CHARACTER, '-'); break;
      case LESS_THAN:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED_LESS_THAN_SIGN;
        this.emitChars(TokenType.CHARACTER, '<');
        break;
      case GREATER_THAN:
        this.current = SCRIPT_DATA;
        this.emitChars(TokenType.CHARACTER, '>');
        break;
      case NUL:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
        this.emitChars(TokenType.CHARACTER, REPLACEMENT);
        break;
      case EOF: this.emitEof(); break;
      default:
        this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
        this.emitCodePoint(cp);
    }
  }

  private scriptDataDoubleEscapedLessThanSign(cp: number): void {
    if (cp === SOLIDUS) {
      this.current = SCRIPT_DATA_DOUBLE_ESCAPE_END;
      this.emitChars(TokenType.CHARACTER, '/');

      return;
    }
    this.current = SCRIPT_DATA_DOUBLE_ESCAPED;
    this.scriptDataDoubleEscaped(cp);
  }

  // Attributes

  private beforeAttributeName(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: break;
      case SOLIDUS: case GREATER_THAN: case EOF:
        this.current = AFTER_ATTRIBUTE_NAME;
        this.afterAttributeName(cp);
        break;
      case EQUALS:
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
      case SPACE: case LF: case TAB: case FF: case SOLIDUS: case GREATER_THAN: case EOF:
        this.leaveAttrName();
        this.current = AFTER_ATTRIBUTE_NAME;
        this.afterAttributeName(cp);
        break;
      case EQUALS:
        this.leaveAttrName();
        this.current = BEFORE_ATTRIBUTE_VALUE;
        break;
      case NUL: this.attr.name += REPLACEMENT; break;
      default: {
        const start = this.pos - 1;

        this.pos = ATTRIBUTE_NAME_RUN.end(this.html, start);
        this.attr.name += lowerAscii(this.html.slice(start, this.pos));
      }
    }
  }

  private afterAttributeName(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: break;
      case SOLIDUS: this.current = SELF_CLOSING_START_TAG; break;
      case EQUALS: this.current = BEFORE_ATTRIBUTE_VALUE; break;
      case GREATER_THAN: this.emitTag(); break;
      case EOF: this.emitEof(); break;
      default:
        this.startAttr('');
        this.current = ATTRIBUTE_NAME;
        this.attributeName(cp);
    }
  }

  private beforeAttributeValue(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: break;
      case QUOTE: this.current = ATTRIBUTE_VALUE_DOUBLE_QUOTED; break;
      case APOSTROPHE: this.current = ATTRIBUTE_VALUE_SINGLE_QUOTED; break;
      case GREATER_THAN: this.emitTag(); break;
      default:
        this.current = ATTRIBUTE_VALUE_UNQUOTED;
        this.attributeValueUnquoted(cp);
    }
  }

  private attributeValueQuoted(cp: number, quote: number, run: Sticky, ownState: number): void {
    switch (cp) {
      case quote: this.current = AFTER_ATTRIBUTE_VALUE_QUOTED; break;
      case AMPERSAND: this.startCharRef(ownState); break;
      case NUL: this.attr.value += REPLACEMENT; break;
      case EOF: this.emitEof(); break;
      default: {
        const start = this.pos - 1;

        this.pos = run.end(this.html, start);
        this.attr.value += this.html.slice(start, this.pos);
      }
    }
  }

  private attributeValueUnquoted(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: this.current = BEFORE_ATTRIBUTE_NAME; break;
      case AMPERSAND: this.startCharRef(ATTRIBUTE_VALUE_UNQUOTED); break;
      case GREATER_THAN: this.emitTag(); break;
      case NUL: this.attr.value += REPLACEMENT; break;
      case EOF: this.emitEof(); break;
      default: {
        const start = this.pos - 1;

        this.pos = UNQUOTED_RUN.end(this.html, start);
        this.attr.value += this.html.slice(start, this.pos);
      }
    }
  }

  private afterAttributeValueQuoted(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: this.current = BEFORE_ATTRIBUTE_NAME; break;
      case SOLIDUS: this.current = SELF_CLOSING_START_TAG; break;
      case GREATER_THAN: this.emitTag(); break;
      case EOF: this.emitEof(); break;
      default:
        this.current = BEFORE_ATTRIBUTE_NAME;
        this.beforeAttributeName(cp);
    }
  }

  private selfClosingStartTag(cp: number): void {
    switch (cp) {
      case GREATER_THAN:
        this.tag.selfClosing = true;
        this.emitTag();
        break;
      case EOF: this.emitEof(); break;
      default:
        this.current = BEFORE_ATTRIBUTE_NAME;
        this.beforeAttributeName(cp);
    }
  }

  // Comments

  private bogusComment(cp: number): void {
    switch (cp) {
      case GREATER_THAN:
        this.current = DATA;
        this.emitComment();
        break;
      case EOF:
        this.emitComment();
        this.emitEof();
        break;
      case NUL: this.comment.data += REPLACEMENT; break;
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
      case HYPHEN: this.current = COMMENT_START_DASH; break;
      case GREATER_THAN:
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
      case HYPHEN: this.current = COMMENT_END; break;
      case GREATER_THAN:
        this.current = DATA;
        this.emitComment();
        break;
      case EOF:
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
      case HYPHEN: this.current = COMMENT_END_DASH; break;
      case LESS_THAN:
        this.comment.data += '<';
        this.current = COMMENT_LESS_THAN_SIGN;
        break;
      case NUL: this.comment.data += REPLACEMENT; break;
      case EOF:
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
      case BANG:
        this.comment.data += '!';
        this.current = COMMENT_LESS_THAN_SIGN_BANG;
        break;
      case LESS_THAN: this.comment.data += '<'; break;
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
      case HYPHEN: this.current = COMMENT_END; break;
      case EOF:
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
      case GREATER_THAN:
        this.current = DATA;
        this.emitComment();
        break;
      case BANG: this.current = COMMENT_END_BANG; break;
      case HYPHEN: this.comment.data += '-'; break;
      case EOF:
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
      case HYPHEN:
        this.comment.data += '--!';
        this.current = COMMENT_END_DASH;
        break;
      case GREATER_THAN:
        this.current = DATA;
        this.emitComment();
        break;
      case EOF:
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
      case SPACE: case LF: case TAB: case FF: this.current = BEFORE_DOCTYPE_NAME; break;
      case EOF: this.emitEofDoctype(); break;
      default:
        this.current = BEFORE_DOCTYPE_NAME;
        this.beforeDoctypeName(cp);
    }
  }

  private beforeDoctypeName(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: break;
      case NUL:
        this.startDoctype(REPLACEMENT);
        this.current = DOCTYPE_NAME;
        break;
      case GREATER_THAN:
        this.startDoctype(null);
        this.doctype.forceQuirks = true;
        this.emitDoctype();
        this.current = DATA;
        break;
      case EOF: this.emitEofDoctype(); break;
      default:
        this.startDoctype(lowerAscii(String.fromCharCode(cp)));
        this.current = DOCTYPE_NAME;
    }
  }

  private doctypeName(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: this.current = AFTER_DOCTYPE_NAME; break;
      case GREATER_THAN:
        this.current = DATA;
        this.emitDoctype();
        break;
      case NUL: this.doctype.name += REPLACEMENT; break;
      case EOF: this.eofInDoctype(); break;
      default: this.doctype.name += lowerAscii(String.fromCharCode(cp));
    }
  }

  private afterDoctypeName(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: break;
      case GREATER_THAN:
        this.current = DATA;
        this.emitDoctype();
        break;
      case EOF: this.eofInDoctype(); break;
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
      case SPACE: case LF: case TAB: case FF:
        this.current = isPublic ? BEFORE_DOCTYPE_PUBLIC_IDENTIFIER : BEFORE_DOCTYPE_SYSTEM_IDENTIFIER;
        break;
      case QUOTE: case APOSTROPHE: this.openDoctypeIdentifier(cp, isPublic); break;
      default: this.quirkyDoctypeEnd(cp);
    }
  }

  private beforeDoctypeIdentifier(cp: number, isPublic: boolean): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: break;
      case QUOTE: case APOSTROPHE: this.openDoctypeIdentifier(cp, isPublic); break;
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
      case SPACE: case LF: case TAB: case FF: this.current = BETWEEN_DOCTYPE_PUBLIC_AND_SYSTEM_IDENTIFIERS; break;
      case GREATER_THAN:
        this.current = DATA;
        this.emitDoctype();
        break;
      case QUOTE: case APOSTROPHE: this.openDoctypeIdentifier(cp, false); break;
      default: this.quirkyDoctypeEnd(cp);
    }
  }

  private betweenDoctypePublicAndSystemIdentifiers(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: break;
      case GREATER_THAN:
        this.emitDoctype();
        this.current = DATA;
        break;
      case QUOTE: case APOSTROPHE: this.openDoctypeIdentifier(cp, false); break;
      default: this.quirkyDoctypeEnd(cp);
    }
  }

  private afterDoctypeSystemIdentifier(cp: number): void {
    switch (cp) {
      case SPACE: case LF: case TAB: case FF: break;
      case GREATER_THAN:
        this.emitDoctype();
        this.current = DATA;
        break;
      case EOF: this.eofInDoctype(); break;
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
    }
  }

  // CDATA

  private cdataSection(cp: number): void {
    switch (cp) {
      case RIGHT_BRACKET: this.current = CDATA_SECTION_BRACKET; break;
      case EOF: this.emitEof(); break;
      default: this.emitCodePoint(cp);
    }
  }

  private cdataSectionBracket(cp: number): void {
    if (cp === RIGHT_BRACKET) {
      this.current = CDATA_SECTION_END;

      return;
    }
    this.emitChars(TokenType.CHARACTER, ']');
    this.current = CDATA_SECTION;
    this.cdataSection(cp);
  }

  private cdataSectionEnd(cp: number): void {
    switch (cp) {
      case GREATER_THAN: this.current = DATA; break;
      case RIGHT_BRACKET: this.emitChars(TokenType.CHARACTER, ']'); break;
      default:
        this.emitChars(TokenType.CHARACTER, ']]');
        this.current = CDATA_SECTION;
        this.cdataSection(cp);
    }
  }
}

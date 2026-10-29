/**
 * Tokens the tokenizer hands the tree builder, and the handler they go to.
 * Shapes follow parse5 (MIT, see NOTICE) minus source locations.
 */
import type { TAG_ID } from './tags';

export enum TokenType {
  CHARACTER,
  NULL_CHARACTER,
  WHITESPACE_CHARACTER,
  START_TAG,
  END_TAG,
  COMMENT,
  DOCTYPE,
  EOF,
}

/** Tokenizer states the tree builder may switch to between tokens. */
export enum TokenizerMode {
  DATA,
  RCDATA,
  RAWTEXT,
  SCRIPT_DATA,
  PLAINTEXT,
}

export interface Attribute {
  name: string;
  /** Set only on adjusted foreign attributes, like xlink:href. */
  namespace?: string;
  prefix?: string;
  value: string;
}

export interface DoctypeToken {
  readonly type: TokenType.DOCTYPE;
  name: string | null;
  forceQuirks: boolean;
  publicId: string | null;
  systemId: string | null;
}

export interface TagToken {
  readonly type: TokenType.START_TAG | TokenType.END_TAG;
  tagName: string;
  tagID: TAG_ID;
  selfClosing: boolean;
  ackSelfClosing: boolean;
  attrs: Attribute[];
}

export interface CommentToken {
  readonly type: TokenType.COMMENT;
  data: string;
}

export interface EOFToken {
  readonly type: TokenType.EOF;
}

/**
 * A run of characters of one kind. Whitespace (tab, LF, FF, space), NUL and
 * every other character come as separate runs: the tree builder treats each
 * kind differently, so a run never mixes them.
 */
export interface CharacterToken {
  type: TokenType.CHARACTER | TokenType.NULL_CHARACTER | TokenType.WHITESPACE_CHARACTER;
  chars: string;
}

export type Token = DoctypeToken | TagToken | CommentToken | EOFToken | CharacterToken;

export interface TokenHandler {
  onCharacter(token: CharacterToken): void;
  onNullCharacter(token: CharacterToken): void;
  onWhitespaceCharacter(token: CharacterToken): void;
  onStartTag(token: TagToken): void;
  onEndTag(token: TagToken): void;
  onComment(token: CommentToken): void;
  onDoctype(token: DoctypeToken): void;
  onEof(token: EOFToken): void;
}

/** The value of an attribute. The tokenizer drops repeated names, so there is at most one. */
export const getTokenAttr = (token: TagToken, attrName: string): string | null => {
  const attr = token.attrs.find((candidate) => candidate.name === attrName);

  return attr === undefined ? null : attr.value;
};

/**
 * What the tree builder may read and set on the tokenizer between tokens.
 * `new Tokenizer(handler)` then `write(html)` tokenizes the whole string and
 * ends with one EOF token. The tokenizer sets `state` back to DATA before it
 * emits a start tag, so the handler can switch it for that tag's content.
 */
export interface TokenizerControl {
  state: TokenizerMode;
  /** True while the adjusted current node is foreign: only then is `<![CDATA[` a CDATA section. */
  inForeignNode: boolean;
  /** Name of the last start tag emitted; an end tag closes RCDATA/RAWTEXT/script data only if it matches. */
  lastStartTagName: string;
}

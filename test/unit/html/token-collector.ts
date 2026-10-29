/**
 * Collects a tokenizer's output as plain arrays, so ours and parse5's can be
 * compared. Adjacent character tokens of one kind are merged: run boundaries
 * may differ, the text may not.
 */
export type Collected = Array<Array<string | boolean | null | string[][]>>;

/** The parts of a tag token both tokenizers fill: no tagID, it is a lookup. */
interface TagLike {
  tagName: string;
  selfClosing: boolean;
  attrs: Array<{ name: string; value: string }>;
}

interface DoctypeLike {
  name: string | null;
  publicId: string | null;
  systemId: string | null;
  forceQuirks: boolean;
}

export class Collector {
  public readonly tokens: Collected = [];
  /** Character tokens that mixed kinds. Only ours is checked. */
  public readonly mixed: string[] = [];
  public sawEof = false;

  constructor(private readonly checkKinds: boolean) {}

  public onCharacter(token: { chars: string }): void {
    this.chars('Character', token.chars, /[\t\n\f \0]/);
  }

  public onWhitespaceCharacter(token: { chars: string }): void {
    this.chars('Whitespace', token.chars, /[^\t\n\f ]/);
  }

  public onNullCharacter(token: { chars: string }): void {
    this.chars('Null', token.chars, /[^\0]/);
  }

  public onStartTag(token: TagLike): void {
    this.tokens.push(['StartTag', token.tagName, token.attrs.map((attr) => [attr.name, attr.value]), token.selfClosing]);
  }

  public onEndTag(token: TagLike): void {
    this.tokens.push(['EndTag', token.tagName, token.attrs.map((attr) => [attr.name, attr.value]), token.selfClosing]);
  }

  public onComment(token: { data: string }): void {
    this.tokens.push(['Comment', token.data]);
  }

  public onDoctype(token: DoctypeLike): void {
    this.tokens.push(['DOCTYPE', token.name, token.publicId, token.systemId, token.forceQuirks]);
  }

  public onEof(): void {
    this.tokens.push(['EOF']);
    this.sawEof = true;
  }

  private chars(kind: string, chars: string, foreign: RegExp): void {
    if (this.checkKinds && (chars === '' || foreign.test(chars))) {
      this.mixed.push(`${kind} ${JSON.stringify(chars)}`);
    }
    const last = this.tokens[this.tokens.length - 1];

    if (last !== undefined && last[0] === kind) {
      last[1] = `${String(last[1])}${chars}`;

      return;
    }
    this.tokens.push([kind, chars]);
  }
}

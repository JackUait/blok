/** A link mark. `target`/`rel` are kept only when the stored anchor had them. */
export interface RichTextLink {
  href: string;
  target?: string;
  rel?: string;
}

/**
 * Formatting on one run of text. Open map: keys Blok does not know are kept
 * as they are. Custom inline tools that Blok cannot name are stored as
 * `"tag:<tagname>": { <attribute>: <value> }`.
 */
export interface RichTextMarks {
  bold?: true;
  italic?: true;
  underline?: true;
  strikethrough?: true;
  code?: true;
  sup?: true;
  sub?: true;
  /** A `<mark>` with no colour of its own. */
  highlight?: true;
  /** A Blok preset name (`'red'`) or any CSS colour value. */
  color?: string;
  /** A Blok preset name (`'red'`) or any CSS colour value. */
  background?: string;
  link?: RichTextLink;
  [customMark: `tag:${string}`]: Record<string, string>;
}

export interface RichTextTextSegment {
  /** Line breaks are `"\n"`. */
  text: string;
  marks?: RichTextMarks;
}

export type RichTextEmbed =
  | { equation: { expression: string } }
  | { page: { id: string } }
  /** Markup the segment model has no slot for (an `<img>` or a list inside a paragraph). Kept verbatim. */
  | { html: string };

export interface RichTextEmbedSegment {
  embed: RichTextEmbed;
  marks?: RichTextMarks;
}

export type RichTextSegment = RichTextTextSegment | RichTextEmbedSegment;

export type RichText = RichTextSegment[];

/** What the host receives for rich-text fields. */
export type RichTextFormat = 'html' | 'segments';

/** A link mark. `target`/`rel` are kept only when the stored anchor had them. */
export interface RichTextLink {
  href: string;
  target?: string;
  rel?: string;
}

/**
 * Formatting on one run of text. Custom inline tools that Blok cannot name
 * are stored as `"tag:<tagname>": { <attribute>: <value> }`. Any other key
 * is dropped on input with one console warning per key.
 */
export interface RichTextMarks {
  bold?: true;
  italic?: true;
  underline?: true;
  strikethrough?: true;
  code?: true;
  sup?: true;
  sub?: true;
  /**
   * A `<mark>` with no colour of its own, as read from older documents.
   * An agent command stores a new one as `background: 'yellow'` instead.
   */
  highlight?: true;
  /**
   * A Blok preset name (`'red'`) or any CSS colour value. An agent command
   * stores a hex, rgb or hsl value as the nearest preset and drops a non-colour.
   */
  color?: string;
  /** Same values as `color`. An agent command also drops a white or transparent background. */
  background?: string;
  link?: RichTextLink;
  [customMark: `tag:${string}`]: Record<string, string>;
}

export interface RichTextTextSegment {
  /** Line breaks are `"\n"`. */
  text: string;
  marks?: RichTextMarks;
}

/**
 * An inline object inside rich text. `html` holds markup the segment model
 * has no slot for (an `<img>` or a list inside a paragraph), kept verbatim.
 */
export type RichTextEmbed =
  | { equation: { expression: string } }
  | { page: { id: string } }
  | { html: string };

export interface RichTextEmbedSegment {
  embed: RichTextEmbed;
  marks?: RichTextMarks;
}

export type RichTextSegment = RichTextTextSegment | RichTextEmbedSegment;

export type RichText = RichTextSegment[];

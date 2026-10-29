import type { Align } from './block-syntax';

export type Kind =
  | 'document' | 'blockquote' | 'list' | 'item' | 'footnote'
  | 'paragraph' | 'heading' | 'thematicBreak' | 'code' | 'html' | 'math' | 'table';

/**
 * A block while the parser builds the tree. One shape for every kind keeps
 * the parser free of casts; each kind reads only its own fields.
 */
export interface Block {
  kind: Kind;
  parent: Block | null;
  children: Block[];
  /** Containers this block is in, counting itself when it is one. */
  nesting: number;
  open: boolean;
  /** Content lines of a paragraph, code, HTML or math block. */
  lines: string[];
  /** The line ending after each line in `lines` ('' at the end of input). */
  endings: string[];
  /** Paragraph: the column each line in `lines` starts at, where its tabs are measured from. */
  columns: number[];
  /** Paragraph: leading columns of each line left over from a tab its container prefix cut (read as spaces). */
  tabRest: number[];
  /** Paragraph: link definitions end before this line; later lines began as a footnote refused at the nesting cap. */
  definitionLines: number;
  /** List and item: bullet character, or `.`/`)` for ordered. */
  marker: string;
  ordered: boolean;
  start: number;
  /** Item: columns its content is indented by. */
  size: number;
  /** Item: its first line was blank after the marker. */
  initialBlank: boolean;
  /** Item: a blank line followed a blank first line, so the next line ends it. */
  furtherBlank: boolean;
  /** Item: whitespace followed the marker on a blank first line, which turns task checks off. */
  noTask: boolean;
  /** Code: fenced rather than indented. */
  fenced: boolean;
  fenceChar: string;
  fenceLength: number;
  /** Columns of indentation before the opening fence. */
  fenceOffset: number;
  /** Code and math: what follows the opening fence. */
  info: string;
  /** Fenced code and math: a closing fence was found. Indented code: it ends with its first line. */
  closed: boolean;
  /** Indented code: trailing lines that were blank and short of four columns. */
  blankTail: number;
  htmlKind: number;
  depth: number;
  /** Heading: its content. Setext headings also carry `lines`. */
  raw: string;
  /** Heading: made from a paragraph by an underline, so `lines` holds its text and any definitions before it. */
  setext: boolean;
  /** Paragraph: its first line cannot be a table head. */
  noHead: boolean;
  align: Align[];
  rows: string[][];
  /** Footnote: the label as written. */
  label: string;
}

/**
 * A fresh block of `kind`.
 * @param kind - the block kind
 * @param parent - the containing block
 */
export const makeBlock = (kind: Kind, parent: Block | null): Block => ({
  kind,
  parent,
  children: [],
  nesting: 0,
  open: true,
  lines: [],
  endings: [],
  columns: [],
  tabRest: [],
  definitionLines: Number.POSITIVE_INFINITY,
  marker: '',
  ordered: false,
  start: 0,
  size: 0,
  initialBlank: false,
  furtherBlank: false,
  noTask: false,
  fenced: false,
  fenceChar: '',
  fenceLength: 0,
  fenceOffset: 0,
  info: '',
  closed: false,
  blankTail: 0,
  htmlKind: 0,
  depth: 0,
  raw: '',
  setext: false,
  noHead: false,
  align: [],
  rows: [],
  label: '',
});

/**
 * A block's lines joined with the endings between them.
 * @param block - a leaf with lines
 */
export const joinLines = (block: Block): string =>
  block.lines.map((line, index) => (index === block.lines.length - 1 ? line : line + block.endings[index])).join('');

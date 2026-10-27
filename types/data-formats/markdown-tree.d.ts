/**
 * The Markdown syntax tree Blok's parser builds. It follows mdast
 * (https://github.com/syntax-tree/mdast) node for node, without source
 * positions, `spread` or plugin `data`, and with math built in.
 *
 * Hand-authored on purpose: published declarations must not import packages
 * a consumer never installs.
 */

export interface Root {
  type: 'root';
  children: RootContent[];
}

export interface Paragraph {
  type: 'paragraph';
  children: PhrasingContent[];
}

export interface Heading {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: PhrasingContent[];
}

export interface ThematicBreak {
  type: 'thematicBreak';
}

export interface Blockquote {
  type: 'blockquote';
  children: RootContent[];
}

export interface List {
  type: 'list';
  ordered: boolean;
  /** The first item's number; null for a bullet list. */
  start: number | null;
  children: ListItem[];
}

export interface ListItem {
  type: 'listItem';
  /** A GFM task item's state; null for a plain item. */
  checked: boolean | null;
  children: RootContent[];
}

export interface Code {
  type: 'code';
  lang: string | null;
  meta: string | null;
  value: string;
}

export interface Math {
  type: 'math';
  meta: string | null;
  value: string;
}

export interface Html {
  type: 'html';
  value: string;
}

export interface Definition {
  type: 'definition';
  /** The label, normalized and lower-cased: what references match on. */
  identifier: string;
  /** The label as written. */
  label: string;
  url: string;
  title: string | null;
}

export interface FootnoteDefinition {
  type: 'footnoteDefinition';
  identifier: string;
  label: string;
  children: RootContent[];
}

export interface Table {
  type: 'table';
  align: Array<'left' | 'right' | 'center' | null>;
  children: TableRow[];
}

export interface TableRow {
  type: 'tableRow';
  children: TableCell[];
}

export interface TableCell {
  type: 'tableCell';
  children: PhrasingContent[];
}

export interface Text {
  type: 'text';
  value: string;
}

export interface Emphasis {
  type: 'emphasis';
  children: PhrasingContent[];
}

export interface Strong {
  type: 'strong';
  children: PhrasingContent[];
}

export interface Delete {
  type: 'delete';
  children: PhrasingContent[];
}

export interface InlineCode {
  type: 'inlineCode';
  value: string;
}

export interface InlineMath {
  type: 'inlineMath';
  value: string;
}

export interface Break {
  type: 'break';
}

export interface Link {
  type: 'link';
  url: string;
  title: string | null;
  children: PhrasingContent[];
}

export interface Image {
  type: 'image';
  url: string;
  title: string | null;
  alt: string | null;
}

export type ReferenceType = 'shortcut' | 'collapsed' | 'full';

export interface LinkReference {
  type: 'linkReference';
  identifier: string;
  label: string;
  referenceType: ReferenceType;
  children: PhrasingContent[];
}

export interface ImageReference {
  type: 'imageReference';
  identifier: string;
  label: string;
  referenceType: ReferenceType;
  alt: string | null;
}

export interface FootnoteReference {
  type: 'footnoteReference';
  identifier: string;
  label: string;
}

export type PhrasingContent =
  | Text | Emphasis | Strong | Delete | InlineCode | InlineMath | Break | Link | Image
  | LinkReference | ImageReference | FootnoteReference | Html;

export type BlockContent =
  | Paragraph | Heading | ThematicBreak | Blockquote | List | Code | Math | Html | Table;

export type RootContent =
  | BlockContent | Definition | FootnoteDefinition | ListItem | TableRow | TableCell | PhrasingContent;

/** Every node the parser builds. */
export type Nodes = Root | RootContent;

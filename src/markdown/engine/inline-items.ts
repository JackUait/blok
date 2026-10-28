import type { PhrasingContent, ReferenceType } from '../../../types/data-formats/markdown-tree';

/**
 * The flat list the inline scanner builds. Emphasis is resolved on it after
 * the scan, and the tree is built from it last.
 */

export type SpanType = 'emphasis' | 'strong' | 'delete';

export interface TextItem {
  kind: 'text';
  value: string;
}

export interface NodeItem {
  kind: 'node';
  node: PhrasingContent;
}

/** A run of `*`, `_` or `~`. */
export interface DelimItem {
  kind: 'delim';
  char: string;
  /** Run length as written. */
  size: number;
  /** Characters not used by a span yet: they render as text. */
  rest: number;
  canOpen: boolean;
  canClose: boolean;
  /** Spans this run opens, innermost first. */
  opens: SpanType[];
  /** Spans this run closes, innermost first. */
  closes: SpanType[];
}

export type LinkTarget =
  | { type: 'link' | 'image'; url: string; title: string | null }
  | { type: 'linkReference' | 'imageReference'; identifier: string; label: string; referenceType: ReferenceType };

/** `[` or `![`. Text unless `target` is set, then it opens a link or image. */
export interface BracketItem {
  kind: 'bracket';
  image: boolean;
  /** Source index just past the bracket. */
  contentStart: number;
  /** Cleared when a link before it closes: links do not nest. */
  active: boolean;
  target?: LinkTarget;
  /** Index of the matching close item, once there is one. */
  close: number;
}

/** The end of a link or image: `](…)`, `][…]`, `][]` or `]`. */
export interface CloseItem {
  kind: 'close';
}

export type Item = TextItem | NodeItem | DelimItem | BracketItem | CloseItem;

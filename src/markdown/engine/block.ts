import type { PhrasingContent, Root } from '../../../types/data-formats/markdown-tree';

/** A leaf whose inline content is parsed after the block pass. */
export interface PendingInline {
  node: { children: PhrasingContent[] };
  /** The leaf's content with block syntax removed: what the inline parser reads. */
  raw: string;
}

export interface BlockResult {
  root: Root;
  /** Leaves in document order. */
  inline: PendingInline[];
  /** Identifiers of every link definition (normalized, lower-cased). */
  definitions: Set<string>;
  /** Identifiers of every footnote definition. */
  footnotes: Set<string>;
}

export interface BlockOptions {
  gfm: boolean;
  math: boolean;
}

/**
 * Parse the block structure of a document.
 * @param source - Markdown source
 * @param options - syntax switches
 */
export const parseBlocks = (_source: string, _options: BlockOptions): BlockResult => {
  return { root: { type: 'root', children: [] }, inline: [], definitions: new Set(), footnotes: new Set() };
};

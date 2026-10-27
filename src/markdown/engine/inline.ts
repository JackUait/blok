import type { PhrasingContent } from '../../../types/data-formats/markdown-tree';

export interface InlineContext {
  /** Link definition identifiers a reference may resolve to. */
  definitions: ReadonlySet<string>;
  /** Footnote definition identifiers a `[^x]` call may resolve to. */
  footnotes: ReadonlySet<string>;
  gfm: boolean;
  math: boolean;
}

/**
 * Parse a leaf's inline content.
 * @param raw - the leaf's content, block syntax already removed
 * @param context - definitions and syntax switches
 */
export const parseInline = (raw: string, _context: InlineContext): PhrasingContent[] => {
  return raw === '' ? [] : [{ type: 'text', value: raw }];
};

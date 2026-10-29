/**
 * Blok's Markdown parser. Its output matches the parser Blok used before
 * (micromark, mdast-util-from-markdown, GFM and math); the goldens in
 * test/unit/markdown/engine pin it.
 */
import type { Root } from '../../../types/data-formats/markdown-tree';
import { parseBlocks } from './block';
import { parseInline } from './inline';

export interface ParseOptions {
  /** GFM tables, task lists, strikethrough, autolink literals and footnotes. Default true. */
  gfm?: boolean;
  /** `$…$` and `$$…$$` math. Default false. */
  math?: boolean;
}

/**
 * Parse Markdown into an mdast-shaped tree.
 *
 * Two passes, as CommonMark defines them: block structure first, which also
 * collects every link and footnote definition, then the inline content of
 * each leaf, which needs those definitions to resolve references.
 * @param source - Markdown source
 * @param options - syntax switches
 */
export const parseMarkdown = (source: string, options: ParseOptions = {}): Root => {
  const gfm = options.gfm !== false;
  const math = options.math === true;
  const { root, inline, definitions, footnotes } = parseBlocks(source, { gfm, math });

  for (const pending of inline) {
    const inTable = 'type' in pending.node && pending.node.type === 'tableCell';

    pending.node.children = parseInline(pending.raw, { definitions, footnotes, gfm, math, inTable, lineColumns: pending.lineColumns, tabRest: pending.tabRest });
  }

  return root;
};

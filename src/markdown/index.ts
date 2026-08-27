import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Extension as MdastExtension } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Extension as MicromarkExtension } from 'micromark-util-types';
import type { Root, RootContent } from 'mdast';
import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { MarkdownImportConfig } from './types';
import { mdastToBlocks } from './mdast-to-blocks';
import type { MarkdownDegradation } from './blocks-to-markdown-core';

export type { MarkdownImportConfig, ToolMapEntry } from './types';
export type { MarkdownDegradation } from './blocks-to-markdown-core';

/** Imported blocks plus everything Markdown could not carry into them. */
export interface MarkdownImportResult {
  /** Blocks ready for `blok.blocks.render()` or `blok.blocks.insertMany()`. */
  blocks: OutputBlockData[];
  /** Constructs that arrived degraded, in document order. */
  warnings: MarkdownDegradation[];
}

const MATH_SIGNAL = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)(?=\S)[^$]+(?<=\S)\$(?!\$)/;

/**
 * Lazily load math micromark/mdast extensions only when needed.
 */
async function loadMathExtensions(): Promise<{
  mathSyntax: MicromarkExtension;
  mathFromMarkdown: MdastExtension;
}> {
  const [{ math }, { mathFromMarkdown }] = await Promise.all([
    import('micromark-extension-math'),
    import('mdast-util-math'),
  ]);

  return { mathSyntax: math(), mathFromMarkdown: mathFromMarkdown() };
}

/**
 * Convert a Markdown string to an array of Blok OutputBlockData.
 *
 * @param md - Markdown source string
 * @param config - Optional configuration for tool mapping, GFM, and extensions
 * @returns Array of OutputBlockData ready for `blok.blocks.render()` or `blok.blocks.insertMany()`
 */
export async function markdownToBlocks(md: string, config: MarkdownImportConfig = {}): Promise<OutputBlockData[]> {
  return (await markdownToBlocksWithReport(md, config)).blocks;
}

/**
 * Collect every degradation the import leaves behind.
 *
 * Blok has no raw-HTML block, so markup written into Markdown is escaped and
 * stored as literal text — the right fallback (it can never execute) but a
 * silent one. Walking the parsed tree for `html` nodes reports it without
 * threading a collector through every node handler.
 *
 * @param tree - the parsed Markdown tree
 * @returns one degradation per HTML node, in document order
 */
function collectImportWarnings(tree: Root): MarkdownDegradation[] {
  const warnings: MarkdownDegradation[] = [];

  /**
   * Visit one node and its children.
   * @param node - the node to visit
   */
  const visit = (node: RootContent): void => {
    if (node.type === 'html') {
      warnings.push({
        construct: 'html',
        action: 'degraded',
        detail: 'HTML is escaped and stored as literal text; Blok has no raw-HTML block',
      });
    }

    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };

  tree.children.forEach(visit);

  return warnings;
}

/**
 * Convert a Markdown string to blocks and report what degraded on the way in.
 *
 * The blocks are identical to {@link markdownToBlocks}; reach for this when the
 * caller has to be told what Markdown could not carry — an MCP or agent client
 * writing a document it will later read back.
 *
 * @param md - Markdown source string
 * @param config - Optional configuration for tool mapping, GFM, and extensions
 * @returns the blocks and their degradations
 */
export async function markdownToBlocksWithReport(
  md: string,
  config: MarkdownImportConfig = {}
): Promise<MarkdownImportResult> {
  const enableGfm = config.gfm !== false;
  const hasMath = MATH_SIGNAL.test(md);

  const extensions = [
    ...(enableGfm ? [gfm()] : []),
    ...(config.extensions ?? []),
  ];

  const mdastExtensions = [
    ...(enableGfm ? [gfmFromMarkdown()] : []),
    ...(config.mdastExtensions ?? []),
  ];

  if (hasMath) {
    const { mathSyntax, mathFromMarkdown } = await loadMathExtensions();

    extensions.push(mathSyntax);
    mdastExtensions.push(mathFromMarkdown);
  }

  const tree = fromMarkdown(md, {
    extensions,
    mdastExtensions,
  });

  return { blocks: mdastToBlocks(tree, config),
    warnings: collectImportWarnings(tree) };
}

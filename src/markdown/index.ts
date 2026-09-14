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

/**
 * Does the source look like it carries math? Gates the extension load.
 *
 * A `$` followed by a digit opens a price, not a formula: without that guard
 * `$5-$10` parses as inline math and tears the paragraph into a latex code
 * block plus two fragments. Real math almost never opens on a bare digit.
 */
const MATH_SIGNAL = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?![\s\d$])[^$]+(?<=\S)\$(?!\$)/;

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
 * What each lossy construct costs on the way in, keyed by mdast node type.
 *
 * Blok has no raw-HTML block, no math block and no footnote block, so all three
 * arrive changed or not at all. Reporting them from one tree walk keeps a
 * collector out of every node handler.
 */
const IMPORT_DEGRADATIONS: Record<string, MarkdownDegradation> = {
  html: {
    construct: 'html',
    action: 'degraded',
    detail: 'HTML is escaped and stored as literal text; Blok has no raw-HTML block',
  },
  inlineMath: {
    construct: 'inlineMath',
    action: 'degraded',
    detail: 'Inline math becomes a latex code block, splitting the paragraph around it',
  },
  footnoteReference: {
    construct: 'footnoteReference',
    action: 'dropped',
    detail: 'Footnote references are removed; Blok has no footnote block',
  },
  footnoteDefinition: {
    construct: 'footnoteDefinition',
    action: 'dropped',
    detail: 'The footnote body is dropped; Blok has no footnote block',
  },
};

/**
 * Collect every degradation the import leaves behind.
 *
 * @param tree - the parsed Markdown tree
 * @returns one degradation per lossy node, in document order
 */
function collectImportWarnings(tree: Root): MarkdownDegradation[] {
  const warnings: MarkdownDegradation[] = [];

  /**
   * Visit one node and its children.
   * @param node - the node to visit
   */
  const visit = (node: RootContent): void => {
    const degradation = IMPORT_DEGRADATIONS[node.type];

    if (degradation !== undefined) {
      warnings.push({ ...degradation });
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

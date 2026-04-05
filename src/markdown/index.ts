import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Extension as MdastExtension } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Extension as MicromarkExtension } from 'micromark-util-types';
import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { MarkdownImportConfig } from './types';
import { mdastToBlocks } from './mdast-to-blocks';

export type { MarkdownImportConfig, ToolMapEntry } from './types';

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

  return mdastToBlocks(tree, config);
}

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { MarkdownImportConfig } from './types';
import { mdastToBlocks } from './mdast-to-blocks';

export type { MarkdownImportConfig, ToolMapEntry } from './types';

/**
 * Convert a Markdown string to an array of Blok OutputBlockData.
 *
 * @param md - Markdown source string
 * @param config - Optional configuration for tool mapping, GFM, and extensions
 * @returns Array of OutputBlockData ready for `blok.blocks.render()` or `blok.blocks.insertMany()`
 */
export function markdownToBlocks(md: string, config: MarkdownImportConfig = {}): OutputBlockData[] {
  const enableGfm = config.gfm !== false;

  const extensions = [
    ...(enableGfm ? [gfm()] : []),
    ...(config.extensions ?? []),
  ];

  const mdastExtensions = [
    ...(enableGfm ? [gfmFromMarkdown()] : []),
    ...(config.mdastExtensions ?? []),
  ];

  const tree = fromMarkdown(md, {
    extensions,
    mdastExtensions,
  });

  return mdastToBlocks(tree, config);
}

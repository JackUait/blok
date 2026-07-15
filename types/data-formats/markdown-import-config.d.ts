import type { Extension as MicromarkExtension } from 'micromark-util-types';
import type { Extension as MdastExtension } from 'mdast-util-from-markdown';
import type { Nodes } from 'mdast';
import type { BlockToolData } from '../tools';
import type { OutputBlockData } from './output-data';

/**
 * Maps an mdast node type to a Blok tool.
 *
 * Lives in `types/` (not `src/`) so it can be referenced from the public
 * `Blocks` API surface — reachable from the bare `@blok/core` type entry —
 * without that entry's declaration closure re-exporting from `src/`.
 */
export interface ToolMapEntry {
  /** Blok tool name to use */
  tool: string;

  /** Transform the mdast node into block tool data */
  data: (node: Nodes) => BlockToolData;

  /**
   * Produce child blocks for container tools.
   * `convert` is the converter's own recursive function.
   */
  children?: (node: Nodes, convert: (nodes: Nodes[]) => OutputBlockData[]) => OutputBlockData[];
}

/**
 * Configuration for `markdownToBlocks()` and `blok.blocks.importMarkdown()`.
 */
export interface MarkdownImportConfig {
  /** Map mdast node types to custom Blok tools. Checked before built-in handlers. */
  toolMap?: Record<string, ToolMapEntry>;

  /** Catch-all for nodes not handled by toolMap or built-ins. Return null to skip. */
  onUnknownNode?: (node: Nodes) => OutputBlockData[] | null;

  /** Enable GFM (tables, task lists, strikethrough). Default: true */
  gfm?: boolean;

  /** Additional micromark syntax extensions */
  extensions?: MicromarkExtension[];

  /** Additional mdast extensions */
  mdastExtensions?: MdastExtension[];
}

import type { OutputBlockData } from './data-formats/output-data';
import type { MarkdownImportConfig } from './data-formats/markdown-import-config';

/**
 * Convert a Markdown string to an array of Blok `OutputBlockData`.
 *
 * @param md - Markdown source string
 * @param config - Optional configuration for tool mapping, GFM, and extensions
 * @returns Blocks ready for `blok.blocks.render()` or `blok.blocks.insertMany()`
 *
 * NOTE: this signature is hand-authored to mirror the implementation in
 * `src/markdown/index.ts`. It must stay self-contained — do NOT re-export from
 * `../src/...` (that drags raw implementation source into every consumer's
 * `tsc` program; see `test/unit/architecture/published-types-no-src-refs.test.ts`).
 */
export declare function markdownToBlocks(md: string, config?: MarkdownImportConfig): Promise<OutputBlockData[]>;

export type { MarkdownImportConfig, ToolMapEntry } from './data-formats/markdown-import-config';

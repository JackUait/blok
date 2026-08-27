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

/** A construct that could not be carried across a Markdown conversion. */
export interface MarkdownDegradation {
  /**
   * What degraded: a Markdown construct (`html`) on the way in, a block tool
   * name (`callout`) on the way out.
   */
  construct: string;
  /** `dropped` — nothing was emitted; `degraded` — emitted, but lossily. */
  action: 'dropped' | 'degraded';
  /** Plain-language explanation of what was lost. */
  detail: string;
}

/** Imported blocks plus everything Markdown could not carry into them. */
export interface MarkdownImportResult {
  /** Blocks ready for `blok.blocks.render()` or `blok.blocks.insertMany()`. */
  blocks: OutputBlockData[];
  /** Constructs that arrived degraded, in document order. */
  warnings: MarkdownDegradation[];
}

/**
 * Convert a Markdown string to blocks and report what degraded on the way in.
 * The blocks are identical to {@link markdownToBlocks}; reach for this when the
 * caller has to be told what Markdown could not carry — Blok has no raw-HTML
 * block, so markup written into Markdown is escaped into literal text.
 *
 * @param md - Markdown source string
 * @param config - Optional configuration for tool mapping, GFM, and extensions
 * @returns the blocks and their degradations
 */
export declare function markdownToBlocksWithReport(
  md: string,
  config?: MarkdownImportConfig
): Promise<MarkdownImportResult>;

export type { MarkdownImportConfig, ToolMapEntry } from './data-formats/markdown-import-config';

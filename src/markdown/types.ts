import type { MarkdownImportConfig } from '../../types/data-formats/markdown-import-config';

/**
 * The canonical definitions live in the published `types/` declarations so the
 * public `Blocks` API surface can reference `MarkdownImportConfig` without
 * leaking `src/` into the bare-import type entry. Re-export them here so the
 * markdown runtime modules keep importing from `./types`.
 */
export type { MarkdownImportConfig, ToolMapEntry } from '../../types/data-formats/markdown-import-config';

/**
 * Import options only Blok's own callers pass. Kept out of the published
 * `MarkdownImportConfig` so the public importer stays CommonMark-faithful.
 */
export interface InternalMarkdownImportConfig extends MarkdownImportConfig {
  /**
   * Read a soft line ending as `<br>` (GitHub-comment semantics). The paste
   * path sets it: a pasted line break is one the user can see.
   */
  softBreaks?: boolean;
}

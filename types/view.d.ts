import type { LooseOutputBlockData, LooseOutputData, OutputBlockData, OutputData } from './data-formats/output-data';
import type { PlaintextRule, SanitizerConfig } from './configs/sanitizer-config';
import type { BlokViewSchema } from './index';

/**
 * Hand-authored declarations for the `@bloklabs/core/view` subpath — the
 * synchronous, DOM-free view renderer (`src/view/index.ts`).
 *
 * These signatures mirror the implementation. They must stay self-contained —
 * do NOT re-export from `../src/...` (that drags raw implementation source into
 * every consumer's `tsc` program; see
 * `test/unit/architecture/published-types-no-src-refs.test.ts`).
 */

/**
 * Services handed to a custom block renderer so it composes safely with the
 * sanitization contract and the rest of the document.
 */
export interface ViewRenderContext {
  /** Sanitize an inline-HTML string against the composed allowlist. */
  sanitizeInline(html: string): string;
  /** Render an arbitrary array of blocks (children resolve against the document). */
  renderBlocks(blocks: Array<OutputBlockData | LooseOutputBlockData>): string;
  /** Plain text of an HTML string (entity-decoded, `<br>` → newline). */
  plainText(html: string): string;
  /** Render the current block's structural children. */
  renderChildren(): string;
}

/**
 * A custom per-tool renderer: `(data, ctx) => html`. Wins over the built-in
 * emitter for its tool name.
 */
export type ViewBlockRenderer = (data: Record<string, unknown>, ctx: ViewRenderContext) => string;

/**
 * Context handed to {@link ViewUrlTransform} for one URL occurrence.
 */
export interface ViewUrlContext {
  /** Which attribute the URL lands on. */
  attr: 'href' | 'src';
  /**
   * Tool type of the block this URL belongs to (e.g. `'image'`, `'bookmark'`).
   * `undefined` for anchors inside a block's inline-HTML text, which have no
   * single owning block.
   */
  blockType?: string;
}

/**
 * A pure URL rewrite hook (e.g. rewrite hrefs, route CDN image URLs). Runs
 * BEFORE the shared unsafe-scheme strip, so a transform can never re-introduce
 * a `javascript:`/`data:` sink — the result is still gated. Returning an empty
 * string drops the URL attribute entirely.
 */
export type ViewUrlTransform = (url: string, ctx: ViewUrlContext) => string;

/**
 * Options for {@link blocksToHtml} / {@link blocksToPlainText}.
 */
export interface BlocksToHtmlOptions {
  /** View schema from `defineBlokSchema`; its baseSanitize merges over the default inline allowlist. */
  schema?: BlokViewSchema;
  /** Custom per-tool renderers; win over built-ins. */
  renderers?: Record<string, ViewBlockRenderer>;
  /** Unknown-tool policy (default 'skip'). */
  onUnknownBlock?: 'skip' | 'comment';
  /**
   * When true, each block Blok renders carries a `data-blok-tool="<type>"`
   * attribute on its root element (list runs on their `<ul>`/`<ol>`), giving
   * consumers a styling hook (see the opt-in `@bloklabs/core/view.css`
   * stylesheet). Off by default; only Blok's own built-in markup is stamped
   * (custom renderers and bare containers like `database` are left untouched).
   */
  toolAttributes?: boolean;
  /**
   * When true, each block Blok renders carries a `data-blok-id="<id>"`
   * attribute on its root element (list items on their `<li>`, not the grouped
   * `<ul>`/`<ol>`), so "copy link to block" deep links resolve off the live
   * editor. Off by default; blocks without an id and bare containers that emit
   * no root of their own (`database`) are left unstamped.
   */
  blockIds?: boolean;
  /**
   * Pure URL rewrite hook applied to every block URL (image/video/audio src,
   * file/bookmark/embed href) and every inline anchor href, sequenced BEFORE
   * the unsafe-scheme strip. See {@link ViewUrlTransform}.
   */
  transformUrl?: ViewUrlTransform;
}

/**
 * Render a saved Blok document to semantic HTML — synchronous and DOM-free
 * (usable in Node, workers, and RSC). Every inline-content field is sanitized
 * against the composed allowlist before interpolation.
 *
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - schema, custom renderers, unknown-block policy
 * @returns HTML string ('' for empty/malformed documents)
 */
export declare function blocksToHtml(
  data: OutputData | LooseOutputData | null | undefined,
  options?: BlocksToHtmlOptions
): string;

/**
 * Extract the plain text of a saved Blok document — synchronous and DOM-free.
 * Blocks are separated by `\n\n`, list items by `\n`, table cells by `\t`.
 *
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - same options as {@link blocksToHtml}
 * @returns plain text ('' for empty/malformed documents)
 */
export declare function blocksToPlainText(
  data: OutputData | LooseOutputData | null | undefined,
  options?: BlocksToHtmlOptions
): string;

/**
 * Extract the plain text of an HTML fragment — synchronous and DOM-free, the
 * view renderer's replacement for `element.textContent`. Entities are decoded
 * (`a &lt; b` → `a < b`) and `<br>` becomes a newline. Consumers building a
 * table of contents or previews otherwise hand-roll a DOMParser strip.
 *
 * @param html - fragment markup
 * @returns the fragment's plain text ('' for an empty fragment)
 */
export declare function htmlTextContent(html: string): string;

/**
 * One entry in a document outline (see {@link outlineFromOutputData}).
 */
export interface OutlineItem {
  /**
   * The heading block's id, for anchor links / scroll targets. Absent when the
   * heading block carries no id.
   */
  id?: string;
  /** Heading level (the header block's `level`, clamped to 1–6). */
  level: number;
  /** Plain-text heading label (inline HTML entity-decoded, tags stripped). */
  text: string;
}

/**
 * Extract the heading outline of a saved Blok document, synchronously and
 * DOM-free — the source for a table of contents. Walks the document in reading
 * order (top-level blocks, then structural children), picks `header` blocks,
 * and reduces each heading's inline HTML to plain text ({@link htmlTextContent}).
 * Headings with empty (or whitespace-only) text are skipped.
 *
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @returns outline items in document reading order ([] for heading-less/malformed documents)
 */
export declare function outlineFromOutputData(
  data: OutputData | LooseOutputData | null | undefined
): OutlineItem[];

/**
 * An element in the view tree: lowercase tag name, sanitized attributes as a
 * plain string record, ordered children.
 *
 * @experimental Not frozen until a second framework adapter consumes it.
 */
export interface ViewElementNode {
  tag: string;
  attrs: Record<string, string>;
  children: ViewNode[];
}

/**
 * A text node in the view tree (entity-decoded).
 *
 * @experimental Not frozen until a second framework adapter consumes it.
 */
export interface ViewTextNode {
  text: string;
}

/**
 * One node of the framework-agnostic view tree produced by
 * {@link blocksToViewNodes}. HTML comments (e.g. `onUnknownBlock: 'comment'`
 * markers) have no representation and are dropped.
 *
 * @experimental Not frozen until a second framework adapter consumes it.
 */
export type ViewNode = ViewElementNode | ViewTextNode;

/**
 * Render a saved Blok document to a framework-agnostic JSON tree,
 * synchronously and DOM-free. Same options and sanitization pipeline as
 * {@link blocksToHtml}.
 *
 * @experimental Not frozen until a second framework adapter consumes it —
 * the shape may change in a minor release.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - same options as {@link blocksToHtml}
 * @returns view nodes ([] for empty/malformed documents)
 */
export declare function blocksToViewNodes(
  data: OutputData | LooseOutputData | null | undefined,
  options?: BlocksToHtmlOptions
): ViewNode[];

/**
 * Sanitize an HTML fragment against a sanitizer config without a DOM
 * (parse5-backed; matches the editor's html-janitor semantics).
 *
 * @param html - HTML fragment
 * @param config - tag → rule allowlist, or the `'plaintext'` sentinel
 * @returns sanitized HTML string
 */
export declare function sanitizeHtmlFragment(html: string, config: SanitizerConfig | PlaintextRule): string;

export { defineBlokSchema, composeBaseSanitizeConfig } from './index';
export type { BlokViewSchema, DefinedBlokSchema, BlokSchemaConfig, ResolvedSchemaTool } from './index';

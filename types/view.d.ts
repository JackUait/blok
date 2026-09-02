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
 * One sanitized inline element, as handed to a {@link ViewInlineRenderer}.
 */
export interface ViewInlineElement {
  /** Lowercase tag name. */
  tag: string;
  /** Attributes that survived sanitization. */
  attrs: Record<string, string>;
  /** The element's sanitized inner HTML. */
  html: string;
  /** The element's plain text (entity-decoded). */
  text: string;
}

/**
 * A custom renderer for one inline tag: `(element) => html`. Return `undefined`
 * to leave the element as sanitized, a string to REPLACE it (an empty string
 * drops it). The returned markup is inserted as-is — it is not re-sanitized, so
 * treat it the way you treat a block renderer's output.
 */
export type ViewInlineRenderer = (element: ViewInlineElement) => string | undefined | null;

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
  /**
   * Custom renderers for inline elements, keyed by lowercase TAG name — the
   * inline counterpart of {@link BlocksToHtmlOptions.renderers}, for marks whose
   * display is not their stored markup: an equation stores only its LaTeX
   * source, a mention only an id.
   *
   * Each runs after sanitization, over the elements that survived it, and
   * REPLACES the element with what it returns (`undefined` keeps the element;
   * `''` drops it). The returned markup is inserted as-is — it is NOT
   * re-sanitized, the same trust contract as a block renderer's output.
   *
   * Applies to rendered HTML only; {@link blocksToPlainText} reads a mark's
   * stored source, not its rendering.
   *
   * For equations use {@link createLatexRenderer}: it hands back a synchronous
   * renderer over the KaTeX build Blok already bundles, with Blok's own
   * untrusted-input hardening, so a host needs no `katex` dependency of its own.
   *
   * @example
   * const renderLatexSync = await createLatexRenderer();
   *
   * blocksToHtml(data, {
   *   inlineRenderers: {
   *     span: ({ attrs }) => attrs['data-latex'] === undefined
   *       ? undefined
   *       : renderLatexSync(attrs['data-latex'], { displayMode: false }),
   *   },
   * });
   */
  inlineRenderers?: Record<string, ViewInlineRenderer>;
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
  /**
   * When true, the output is wrapped in `<div data-blok-interface="view">`
   * (default `false`).
   *
   * The wrapper is what makes Blok's emitted classes compute the way they do in
   * the editor: the scoped preflight applies its box-sizing/margin/padding/border
   * resets only under `[data-blok-interface]`, and the token and colour layers
   * key on the same attribute.
   *
   * Opt-in because enabling it adds an element to existing output. `<BlokView>`
   * marks its own wrapper instead, so React consumers do not need this.
   */
  root?: boolean;
  /**
   * When true, blocks are rendered with the editor's presentational classes and
   * the per-block `holder → content` scaffolding, so the result matches a
   * read-only editor render (default `false`).
   *
   * Requires `@bloklabs/core/view.css`, plus {@link root} (or an equivalent
   * `[data-blok-interface]` ancestor), to actually paint. A few tools also gain
   * a wrapper element under this flag where the editor has one.
   *
   * Opt-in because it changes the emitted markup. `<BlokView>` enables it by
   * default; the `useBlokView` hook does not, since its contract is to emit no
   * wrapper elements.
   */
  classes?: boolean;
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

/** Options for {@link extractTexts} / {@link injectTexts}. */
export interface DocumentTextsOptions {
  /**
   * Include a code block's source. Default `false` — code is not prose, and a
   * translator handed it will "fix" it.
   */
  includeCode?: boolean;
}

/**
 * Every translatable string in a saved document, in document order.
 *
 * Made for translating a document without handing a model its JSON: translate
 * the returned list, then put it back with {@link injectTexts}. The model never
 * sees the structure, so it cannot break it.
 *
 * Empty and whitespace-only values are skipped. URLs are never included, and
 * neither is a file's name — it is what the reader downloads, not prose.
 *
 * @param data - a saved document; anything that is not one yields an empty list
 * @param options - what counts as translatable
 */
export declare function extractTexts(data: unknown, options?: DocumentTextsOptions): string[];

/**
 * Put translated strings back where {@link extractTexts} found them, returning
 * a new document. The input is not modified, and a block too malformed to read
 * is carried through untouched rather than dropped.
 *
 * @param data - the same document {@link extractTexts} was given
 * @param texts - the translations, in the order they were extracted
 * @param options - the SAME options {@link extractTexts} ran with
 * @throws RangeError when `texts` does not match what this document extracts
 */
export declare function injectTexts(
  data: unknown,
  texts: readonly string[],
  options?: DocumentTextsOptions
): OutputData;

/**
 * A construct Markdown could not express as-is (see
 * {@link blocksToMarkdownWithReport}).
 */
export interface MarkdownDegradation {
  /**
   * What degraded: a block tool name (`callout`) on the way out, a Markdown
   * construct (`html`) on the way in.
   */
  construct: string;
  /** `dropped` — nothing was emitted; `degraded` — emitted, but lossily. */
  action: 'dropped' | 'degraded';
  /** Plain-language explanation of what was lost. */
  detail: string;
}

/** A document's Markdown plus everything that could not be carried across. */
export interface MarkdownSerializationResult {
  /** The serialized document. */
  markdown: string;
  /** Constructs that were dropped or emitted lossily, in document order. */
  warnings: MarkdownDegradation[];
}

/**
 * Serialize a saved Blok document to Markdown — synchronous and DOM-free, the
 * outbound twin of `markdownToBlocks`. Headings become `#`, lists `-`/`1.`,
 * tables GFM pipe grids; a callout becomes a blockquote and columns flatten
 * into reading order, since Markdown can express neither.
 *
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @returns Markdown ('' for empty/malformed documents)
 */
export declare function blocksToMarkdown(
  data: OutputData | LooseOutputData | null | undefined
): string;

/**
 * Serialize a saved Blok document to Markdown and report what degraded on the
 * way out. The Markdown is identical to {@link blocksToMarkdown}; reach for
 * this when the result goes somewhere that cannot ask a follow-up question —
 * an AI client, an export — and needs to be told what it is missing.
 *
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @returns the Markdown and its degradations
 */
export declare function blocksToMarkdownWithReport(
  data: OutputData | LooseOutputData | null | undefined
): MarkdownSerializationResult;

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

/** Why {@link restoreHeadingAnchors} left a referenced fragment as it was. */
export type HeadingAnchorSkipReason = 'no-match' | 'ambiguous';

/** One fragment handed back to the heading that answers to it. */
export interface RestoredHeadingAnchor {
  /** The fragment, without the leading "#". */
  anchor: string;
  /** Id of the header block it was written onto. */
  blockId: string;
}

/** A fragment {@link restoreHeadingAnchors} refused to place, and why. */
export interface SkippedHeadingAnchor {
  /** The fragment, without the leading "#". */
  anchor: string;
  /** `no-match` — no heading carries that text; `ambiguous` — more than one candidate. */
  reason: HeadingAnchorSkipReason;
}

/** What one {@link restoreHeadingAnchors} pass did. */
export interface HeadingAnchorReport {
  /** Fragments placed onto a heading, in the order they were referenced. */
  restored: RestoredHeadingAnchor[];
  /** Dead fragments left alone, in the order they were referenced. */
  skipped: SkippedHeadingAnchor[];
}

/** The repaired document plus the report for the pass that produced it. */
export interface HeadingAnchorResult {
  data: OutputData;
  report: HeadingAnchorReport;
}

/**
 * Repair in-document links whose target was lost during an import.
 *
 * HTML addresses its own sections by an `id` on the heading (Google Docs writes
 * `<h2 id="h.2y1ok8y7pef0">` and links its table of contents to that fragment).
 * A converter that mints its own block ids and drops the source ones leaves the
 * links pointing at nothing. What survives is the link's own text — a table of
 * contents says the heading's name — so this pass hands each dead fragment to
 * the heading that text names, as `HeaderData.anchor`.
 *
 * Because it WRITES content it guesses as little as possible: only headings
 * with no anchor yet, only an exact text match (markup, entities and whitespace
 * are normalized away; punctuation is not), and only when exactly one heading
 * and one fragment claim each other. Anything less certain is left alone and
 * reported. Running it twice changes nothing further.
 *
 * Host-called on purpose — a heuristic that rewrites a document belongs in a
 * one-off upgrade you decide to run, not in every load. It is DOM-free, so it
 * runs in a Node script over stored records. Expects a document already in
 * Blok's hierarchical shape: migrate legacy data first.
 *
 * @param data - a saved document in Blok's hierarchical shape
 * @returns a new document with anchors filled in, plus what the pass decided
 */
export declare function restoreHeadingAnchors(data: OutputData): HeadingAnchorResult;

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

/** Options for {@link renderLatex} and the renderer {@link createLatexRenderer} returns. */
export interface LatexRenderOptions {
  /** Block-level math (the default) vs inline. */
  displayMode?: boolean;
}

/**
 * Render a LaTeX string to HTML with the KaTeX build Blok already bundles.
 *
 * The options are hardened for untrusted input: `trust: false` forbids the
 * markup-injecting commands (`\href`, `\includegraphics`, `\html*`), `maxExpand`
 * caps macro expansion, `maxSize` caps element sizing, and `throwOnError: false`
 * renders malformed math as escaped source instead of failing the document.
 * Reach for this instead of adding `katex` as your own dependency: the chunk is
 * already in Blok's bundle (its code tool, equation inline tool and markdown
 * importer all use it) and these are the options Blok itself trusts.
 *
 * KaTeX is imported lazily on the first call. With no `document` present (SSR,
 * workers) the stylesheet injection is skipped and the host includes
 * `katex.min.css` itself; the returned markup is identical.
 *
 * For {@link BlocksToHtmlOptions.inlineRenderers}, which is synchronous, use
 * {@link createLatexRenderer} — a promise there would stringify as
 * `[object Promise]`.
 *
 * @param latex - the LaTeX source
 * @param options - render options
 * @returns the rendered HTML, or a message span for unrenderable input
 */
export declare function renderLatex(latex: string, options?: LatexRenderOptions): Promise<string>;

/**
 * Load KaTeX once and get back a SYNCHRONOUS LaTeX renderer — the form
 * {@link BlocksToHtmlOptions.inlineRenderers} needs.
 *
 * Shaped as "await the loader, get the renderer" so there is no call order to
 * get wrong: the renderer cannot exist before KaTeX is ready. It applies the same
 * hardened options as {@link renderLatex}.
 *
 * @returns a synchronous `(latex, options) => html` renderer
 * @example
 * const renderLatexSync = await createLatexRenderer();
 *
 * blocksToHtml(data, {
 *   inlineRenderers: {
 *     span: ({ attrs }) => attrs['data-latex'] === undefined
 *       ? undefined
 *       : renderLatexSync(attrs['data-latex'], { displayMode: false }),
 *   },
 * });
 */
export declare function createLatexRenderer(): Promise<
  (latex: string, options?: LatexRenderOptions) => string
>;

export { defineBlokSchema, composeBaseSanitizeConfig } from './index';
export type { BlokViewSchema, DefinedBlokSchema, BlokSchemaConfig, ResolvedSchemaTool } from './index';

/**
 * JSON Schema (draft 2020-12) for Blok's saved document format — what
 * `save()` writes and what you store.
 *
 * Typed loosely on purpose: it is data to hand to a validator or to a model's
 * structured-output setting, not a shape to write code against. `type` stays an
 * open string and each built-in tool's `data` is attached with an `if`/`then`
 * branch, so a block belonging to a custom tool validates with an
 * unconstrained `data` rather than being rejected.
 */
export declare const blokDocumentSchema: Readonly<Record<string, unknown>>;

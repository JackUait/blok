import type { LooseOutputBlockData, LooseOutputData, OutputBlockData, OutputData } from './data-formats/output-data';
import type { PlaintextRule, SanitizerConfig } from './configs/sanitizer-config';
import type { BlokSchema, BlokToolManifest, BlokViewSchema, ManifestOverrides, SchemaProblem, ToolRegistrySnapshot } from './index';
import type { PageIcon, PageInfo } from './tools/page';

export type { SchemaProblem } from './index';

export declare function buildToolManifest(
  snapshot: ToolRegistrySnapshot,
  overrides?: ManifestOverrides,
  options?: { onWarning?(message: string): void }
): BlokToolManifest;

export declare function validateAgainst(schema: BlokSchema, value: unknown): SchemaProblem[];

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
  /**
   * Build the link for a `page` block from its `pageId`.
   *
   * A page's body lives in a separate document, so the view renders a page
   * block as a one-line card (icon + title) and never renders children under
   * it. The card is a link only when this and {@link pageInfo} return
   * authorized metadata. The returned URL still passes through
   * {@link transformUrl} (with `blockType: 'page'`) and the unsafe-scheme
   * strip, so a `javascript:` result renders a plain card.
   *
   * @example
   * blocksToHtml(data, {
   *   pageInfo: (pageId) => hostPageInfo(pageId),
   *   pageHref: (pageId) => `/pages/${pageId}`,
   * });
   */
  pageHref?: (pageId: string) => string;
  /** Authorized page metadata; absent results render neutral, unlinked cards. */
  pageInfo?: (pageId: string) => PageInfo | null | undefined;
  /**
   * Base direction of the document (default: none).
   *
   * Sets `dir` on the {@link root} wrapper and turns on per-block direction:
   * each block whose own text has a strong letter carries `dir` from the first
   * one, the same rule the editor applies. A block with no strong letter
   * (empty, digits only) carries none and follows the document. Code is never
   * stamped. Under {@link classes} the `dir` sits on the content element, as in
   * the editor; otherwise on the block's root element (each `<li>` for lists).
   *
   * Opt-in: without it the output has no `dir` anywhere.
   */
  direction?: 'ltr' | 'rtl';
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

/** Options for {@link blocksToPlainText} — everything {@link blocksToHtml} takes, plus one. */
export interface BlocksToPlainTextOptions extends BlocksToHtmlOptions {
  /**
   * Also emit the media fields the default reader drops because the editor
   * paints them as an attribute, or not at all. Exactly these, appended after
   * the block's displayed label and separated by single newlines:
   *
   * - `image`: `alt`
   * - `video`: `url`
   * - `embed`: `source`
   * - `audio`: `title`, `artist`, `url`
   * - `file`: `fileName`, `url`
   * - `bookmark`: `description`, `url`
   *
   * Default `false`. "Hidden" is relative to the DEFAULT reader, which emits
   * only the first non-empty label per block: an audio `title`, a file
   * `fileName` and a bookmark `url` are painted on screen whenever the field
   * ahead of them is empty, and are dropped whenever it is not.
   *
   * Made for a search index, where a URL is the one string a person pastes
   * back verbatim. A preview wants the default.
   */
  includeHiddenText?: boolean;
}

/**
 * Extract the plain text of a saved Blok document — synchronous and DOM-free.
 * Blocks are separated by `\n\n`, list items by `\n`, the several fields of one
 * block by `\n`, table cells by `\t`.
 *
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - {@link blocksToHtml}'s options, plus `includeHiddenText`
 * @returns plain text ('' for empty/malformed documents)
 */
export declare function blocksToPlainText(
  data: OutputData | LooseOutputData | null | undefined,
  options?: BlocksToPlainTextOptions
): string;

/** An owning page pointer in one saved document. */
export interface PageOwnerEdge {
  pageId: string;
  sourceBlockId: string;
  order: number;
}

/** Searchable text attributed to a visible block. */
export interface PageTextEntry {
  blockId: string | null;
  order: number;
  text: string;
}

/** A non-owning reference to a page in one saved document. */
export interface PageReference {
  pageId: string;
  sourceBlockId: string | null;
  order: number;
}

/** Document facts for a host-owned page catalog. */
export interface PageIndex {
  owners: PageOwnerEdge[];
  text: PageTextEntry[];
  references: PageReference[];
}

/** Extract page ownership, text and references without a DOM or workspace state. */
export declare function pageIndex(data: OutputData | LooseOutputData | null | undefined): PageIndex;

export interface HostPageEdge extends PageOwnerEdge {
  /** Null for a root document. */
  ownerPageId: string | null;
}

export interface PageTreeNode {
  pageId: string;
  sourceBlockId: string;
  order: number;
  access: 'allowed' | 'none' | 'missing';
  title?: string;
  icon?: PageIcon;
  children: PageTreeNode[];
}

export type PageTreeDiagnostic =
  | { kind: 'duplicate-owner'; pageId: string; edges: HostPageEdge[] }
  | { kind: 'cycle'; pageId: string; path: string[] }
  | { kind: 'missing-page'; pageId: string; sourceBlockId: string }
  | { kind: 'missing-owner'; pageId: string }
  | { kind: 'unreachable'; pageId: string; sourceBlockId: string };

export interface PageTreeProjection {
  roots: PageTreeNode[];
  diagnostics: PageTreeDiagnostic[];
}

/** Metadata must already be filtered for the current viewer. */
export declare function projectPageTree(
  edges: readonly HostPageEdge[],
  metadata: Readonly<Record<string, PageInfo | null | undefined>>
): PageTreeProjection;

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
 * A construct a conversion could not express as-is (see
 * {@link blocksToMarkdownWithReport} and {@link htmlToBlocksWithReport}).
 */
export interface MarkdownDegradation {
  /**
   * What degraded: on the way out a block tool name (`callout`) or an inline
   * mark Markdown has no syntax for (`highlight`); on the way in a source
   * construct — a Markdown node (`html`) or an HTML tag (`iframe`).
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
 * A page block or inline page reference is written as `[title](href)` when
 * `pageInfo` allows the page and `pageHref` gives a safe link. Otherwise it is
 * the label alone.
 *
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @returns Markdown ('' for empty/malformed documents)
 */
export declare function blocksToMarkdown(
  data: OutputData | LooseOutputData | null | undefined,
  options?: Pick<BlocksToHtmlOptions, 'pageInfo' | 'pageHref'>
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
  data: OutputData | LooseOutputData | null | undefined,
  options?: Pick<BlocksToHtmlOptions, 'pageInfo' | 'pageHref'>
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

/** A block whose `type`, `data` or `tunes` differ between two documents. */
export interface OutputBlockChange {
  id: string;
  before: OutputBlockData;
  after: OutputBlockData;
  fields: Array<'type' | 'data' | 'tunes'>;
}

/** A block whose parent changed, or that left the kept order of its siblings. */
export interface OutputBlockMove {
  id: string;
  before: OutputBlockData;
  after: OutputBlockData;
}

/** What {@link diffOutputData} found. Blocks are the normalized input blocks. */
export interface OutputDataDiff {
  /** In `after` order. */
  added: OutputBlockData[];
  /** In `before` order. */
  removed: OutputBlockData[];
  /** In `after` order. */
  changed: OutputBlockChange[];
  /** In `after` order. */
  moved: OutputBlockMove[];
}

export interface DiffOutputDataOptions {
  /**
   * Rich-text fields per tool type. Replaces the built-in table for every type,
   * so return the built-in fields too when you need them. Fields not listed are
   * compared raw.
   */
  richTextFields?: (type: string) => string[];
}

/**
 * Compare two saved documents by block id, synchronously and DOM-free.
 *
 * - A block without an id is never matched. With duplicate ids the first wins.
 * - Moved: a different parent, or not in the longest kept order of its parent's
 *   children. A block can be moved and changed.
 * - Rich text compares by content: HTML and segments that say the same thing are equal.
 * - Missing `tunes` equals `{}`. `indent`, `content`, `lastEditedAt`,
 *   `lastEditedBy` and the document `id`/`time`/`version` are ignored.
 *
 * @param before - the older document (nullish = no blocks)
 * @param after - the newer document (nullish = no blocks)
 * @param options - rich-text fields per tool
 */
export declare function diffOutputData(
  before: OutputData | LooseOutputData | null | undefined,
  after: OutputData | LooseOutputData | null | undefined,
  options?: DiffOutputDataOptions
): OutputDataDiff;

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

/** Blocks parsed out of HTML, plus everything the HTML could not carry into them. */
export interface HtmlImportResult {
  /** Blocks ready for `blok.blocks.render()`, `insertMany()`, or storage. */
  blocks: OutputBlockData[];
  /** Constructs that arrived degraded or not at all, in document order. */
  warnings: MarkdownDegradation[];
}

/**
 * Parse HTML into Blok blocks — synchronous and DOM-free, the inbound twin of
 * `blocksToHtml`. Takes a fragment or a whole document.
 *
 * Covers the structural subset a document body is made of: headings,
 * paragraphs, lists (nested, ordered, checklists), tables (merged cells
 * included), images, links and inline marks, code, blockquotes, toggles,
 * dividers, and the tabs `blocksToHtml` writes. Other layout containers are
 * unwrapped and their children converted in place; anything else is reported
 * rather than dropped in silence.
 *
 * Reach for {@link htmlToBlocksWithReport} when the caller has to be told what
 * the HTML could not carry.
 *
 * @param html - the HTML source
 * @returns blocks ready for `render()`, `insertMany()`, or storage
 */
export declare function htmlToBlocks(html: string): OutputBlockData[];

/**
 * Parse HTML into Blok blocks and report what degraded on the way in. The
 * blocks are identical to {@link htmlToBlocks}; reach for this when the result
 * is stored — an embedded video or a form has no Blok block, and an import kept
 * without reading the report is how that loss goes unnoticed.
 *
 * @param html - the HTML source
 * @returns the blocks and their degradations
 */
export declare function htmlToBlocksWithReport(html: string): HtmlImportResult;

/** Where moved root blocks are inserted in the target document. */
export interface PageBlockPlacement {
  parentId: string | null;
  afterId: string | null;
}

/** New document snapshots after moving blocks between pages. */
export interface PageBlockMove {
  source: OutputData;
  target: OutputData;
  movedIds: string[];
}

/** Move complete block subtrees without changing either input document. */
export declare function movePageBlocks(
  source: OutputData,
  target: OutputData,
  roots: readonly string[],
  place: PageBlockPlacement
): PageBlockMove;

/** Build a new page body and replace adjacent blocks with its owning pointer. */
export declare function turnBlocksIntoPage(
  source: OutputData,
  roots: readonly string[],
  ids: { pageId: string; pointerId: string }
): { source: OutputData; pageBody: OutputData; pointerId: string };

/** Replace an owning pointer only after its matching page body has loaded. */
export declare function turnPageIntoBlocks(
  source: OutputData,
  pointerId: string,
  loaded: { pageId: string; body: OutputData } | null
): { source: OutputData; retiredPageId: string; movedIds: string[] };

interface PageTransferBase {
  operationId: string;
  sourcePageId: string;
  targetPageId: string;
}

/** A host request for one cross-document page operation. */
export type PageTransferRequest =
  | (PageTransferBase & {
    kind: 'move-blocks' | 'reparent-page';
    rootIds: string[];
    place: PageBlockPlacement;
  })
  | (PageTransferBase & {
    kind: 'turn-into-page';
    rootIds: string[];
    pointerId: string;
  })
  | (PageTransferBase & {
    kind: 'turn-into-blocks';
    pointerId: string;
  })
  | (PageTransferBase & {
    kind: 'duplicate-page';
    pointerId: string;
    place: PageBlockPlacement;
  });

/** One durable edit receipt from a sidecar journal. */
export interface PageTransferSagaStep {
  doc: string;
  lineage: string;
  sequence: string;
}

/** A host transaction, or a chain of durable per-document sidecar edits. */
export type PageTransferDurability =
  | { kind: 'transaction'; transactionId: string }
  | { kind: 'saga'; steps: PageTransferSagaStep[] };

/** Proof claimed by a host after durably committing the operation. */
export interface PageTransferReceipt {
  operationId: string;
  kind: PageTransferRequest['kind'];
  sourcePageId: string;
  targetPageId: string;
  rootIds: string[];
  undoToken: string;
  durability: PageTransferDurability;
}

/** Host persistence adapter. A live mode must write the authoritative rooms. */
export interface PageTransferHost {
  mode: 'saved-transaction' | 'live-transaction' | 'live-saga';
  run(request: PageTransferRequest): Promise<PageTransferReceipt>;
}

/** Refuse collaboration without a live transaction and validate the host receipt. */
export declare function executePageTransfer(
  host: PageTransferHost,
  request: PageTransferRequest,
  context: { collaboration: boolean }
): Promise<PageTransferReceipt>;

export interface PageTransferUndoRequest {
  operationId: string;
  undoOf: PageTransferReceipt;
}

export interface PageTransferUndoReceipt {
  operationId: string;
  undoOfOperationId: string;
  undoToken: string;
  durability: PageTransferDurability;
}

export interface PageTransferUndoHost extends PageTransferHost {
  undo(request: PageTransferUndoRequest): Promise<PageTransferUndoReceipt>;
}

/** Validate a receipt-scoped host Undo; the host owns the inverse transaction. */
export declare function undoPageTransfer(
  host: PageTransferUndoHost,
  request: PageTransferUndoRequest,
  context: { collaboration: boolean }
): Promise<PageTransferUndoReceipt>;

/** A document head from a journalled sidecar. */
export interface SidecarDocHead {
  lineage: string;
  sequence: string;
}

/** A block as one `/sync/{doc}/edit` insert carries it; its place lives on the op. */
export interface SidecarEditBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  lastEditedAt?: number;
  lastEditedBy?: string;
}

/** One op of a `/sync/{doc}/edit` body. */
export type SidecarEditOp =
  | { op: 'insert'; id: string; block: SidecarEditBlock; parent: string | null; after: string | null }
  | { op: 'remove'; id: string };

export interface SidecarRootPlacement extends PageBlockPlacement {
  rootId: string;
}

/** A block as the transfer expects to find it before the source removal. */
export interface SidecarExpectedBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  parent: string | null;
  content: string[];
}

/** The exact edits of one operation. A run never rebuilds a plan it found in the log. */
export interface SidecarTransferPlan {
  copyDoc: string;
  copyHead: SidecarDocHead;
  copyChunks: SidecarEditOp[][];
  originDoc: string;
  originHead: SidecarDocHead;
  /** The one destructive edit. */
  originOps: SidecarEditOp[];
  /** The removed blocks as planned. The removal runs only while they still look like this. */
  originExpected: SidecarExpectedBlock[];
  /** IDs the removal inserts, so they must not exist yet (the turn-into-page pointer). */
  originAbsent: string[];
  /**
   * A document that must still equal the plan exactly before the removal: the
   * page body of turn-into-blocks, which the host retires after the pointer goes.
   */
  frozen?: { doc: string; head: SidecarDocHead; blocks: SidecarExpectedBlock[] };
  rootIds: string[];
  restore?: SidecarRootPlacement[];
  destination?: PageBlockPlacement;
}

/** One transfer or Undo. JSON-safe; the host stores it as given. */
export interface SidecarTransferRecord {
  version: 1;
  operationId: string;
  digest: string;
  plan: SidecarTransferPlan;
  receipt?: PageTransferReceipt;
  undoReceipt?: PageTransferUndoReceipt;
}

/** Host-owned storage for transfer progress. Keep a record for the retry and Undo window. */
export interface SidecarTransferLog {
  get(operationId: string): SidecarTransferRecord | undefined | Promise<SidecarTransferRecord | undefined>;
  put(record: SidecarTransferRecord): void | Promise<void>;
}

export interface SidecarFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

/** The part of `fetch` the adapter uses. The global `fetch` fits. */
export type SidecarFetch = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }
) => Promise<SidecarFetchResponse>;

export interface SidecarTransferHostOptions {
  /** The prefix the sidecar routes are mapped under, e.g. `https://example.com/api/blok`. */
  baseUrl: string;
  /** A pass for one document. `write` is true for edits and false for state reads. */
  ticketFor(doc: string, access: { write: boolean }): string | Promise<string>;
  log: SidecarTransferLog;
  fetch?: SidecarFetch;
  /** The server's `CollabMaxMessageBytes`. Defaults to 1048576. */
  maxEditBytes?: number;
  /** How many times to send the source removal when peers keep editing elsewhere in the source. Defaults to 3. */
  maxAttempts?: number;
}

/**
 * A `live-saga` transfer host over the stock collab sidecar. Needs a server
 * running with an operation journal (`--collab-journal`). It never deletes a
 * copy: a failure leaves the source plus whatever copy exists, so blocks can
 * end in both pages. Refuses `duplicate-page`.
 */
export declare function createSidecarTransferHost(options: SidecarTransferHostOptions): PageTransferUndoHost;

/** Copy one page document, rewriting only known block and page references. */
export declare function remapPageDocument(
  data: OutputData,
  ids: { blockIds: ReadonlyMap<string, string>; pageIds: ReadonlyMap<string, string> }
): OutputData;

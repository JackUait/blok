/**
 * `blocksToHtml` — synchronous, DOM-free rendering of a saved Blok document
 * to semantic HTML (design D1: one central dispatcher; custom tools hook in
 * via the `renderers` option).
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*, parse5 via
 * ./sanitize, and the pure `INLINE_TEXT_SANITIZE` map). Never import the
 * `src/components/utils` barrel, editor modules, or tool classes.
 */
import { INLINE_TEXT_SANITIZE } from '../components/shared/inline-content-sanitize';
import type { BlokViewSchema } from '../shared/sanitize-schema';
import { buildDocumentModel, normalizeViewBlock } from './document-model';
import type { DocumentModel, ViewBlock } from './document-model';
import { builtinEmitters, renderListRun } from './emitters';
import type { EmitterEnv } from './emitters';
import { htmlTextContent } from './html-text';
import { escapeHtml, sanitizeHtmlFragment } from './sanitize';

import type { LooseOutputBlockData, LooseOutputData, OutputBlockData, OutputData, SanitizerConfig } from '../../types';

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
 * Options for {@link blocksToHtml} / `blocksToPlainText`.
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
   * attribute on its root element (`<p data-blok-tool="paragraph">`, list runs
   * on their `<ul>`/`<ol>`), giving consumers a styling hook without a shipped
   * stylesheet. Off by default — the clean-HTML output is unchanged unless you
   * opt in. Only Blok's own built-in markup is stamped; custom renderers own
   * their output, and bare containers (database) are never stamped since they
   * emit no root of their own.
   */
  toolAttributes?: boolean;
}

/**
 * The assembled renderer for one document: exposes the internals that
 * `blocksToPlainText` reuses for custom renderers.
 */
export interface HtmlRenderer {
  /** Render the document's top-level blocks. */
  renderTopLevel(): string;
  /** Render a sibling run of normalized blocks (applies list grouping). */
  renderList(blocks: ViewBlock[]): string;
  /** Build the custom-renderer context for a block. */
  ctxFor(block: ViewBlock): ViewRenderContext;
}

/**
 * Assemble a renderer over a document model.
 * @param model - document model for the run
 * @param options - render options
 */
/**
 * Tool types whose emitter renders children bare (no root element of their
 * own — {@link builtinEmitters} maps them to `childrenOnly`). Stamping the
 * `data-blok-tool` marker onto their output would land it on the first CHILD's
 * element, mislabeling it, so they are skipped. A new bare emitter must be
 * added here.
 */
const BARE_CONTAINER_TOOLS = new Set(['database', 'database-row']);

/**
 * Insert a `data-blok-tool="<type>"` marker onto the first opening tag of
 * Blok-generated markup. Operates only on our own emitter output (which always
 * opens with `<tag`), so the leading-tag match is exact; a value with special
 * characters is entity-escaped, and a non-element string (empty / comment) is
 * returned unchanged.
 * @param html - Blok's rendered markup for one block or list run
 * @param type - tool type to record
 */
const stampToolAttr = (html: string, type: string): string => {
  return html.replace(/^\s*<[a-z][a-z0-9]*/i, (openTag) => `${openTag} data-blok-tool="${escapeHtml(type)}"`);
};

export const createHtmlRenderer = (model: DocumentModel, options: BlocksToHtmlOptions): HtmlRenderer => {
  const renderers = options.renderers ?? {};
  const onUnknownBlock = options.onUnknownBlock ?? 'skip';
  const toolAttributes = options.toolAttributes === true;

  /**
   * The composed inline allowlist: the schema's baseSanitize wins over the
   * default inline map, so a viewer configured via `defineBlokSchema` displays
   * under the exact composition that produced the document.
   */
  const inlineConfig: SanitizerConfig = {
    ...(INLINE_TEXT_SANITIZE as Record<string, unknown>),
    ...(options.schema?.baseSanitize ?? {}),
  } as SanitizerConfig;

  /** Ids currently on the render stack — breaks parent-reference cycles. */
  const active = new Set<string>();

  const env: EmitterEnv = {
    inline: (value) => sanitizeHtmlFragment(typeof value === 'string' ? value : '', inlineConfig),
    escape: (value) => escapeHtml(typeof value === 'string' ? value : ''),
    childrenOf: (id) => model.childrenOf(id),
    blocksById: (ids) => {
      if (!Array.isArray(ids)) {
        return [];
      }

      return ids.flatMap((id) => {
        const block = typeof id === 'string' ? model.byId.get(id) : undefined;

        return block === undefined ? [] : [block];
      });
    },
    renderList: (blocks) => renderList(blocks),
  };

  const ctxFor = (block: ViewBlock): ViewRenderContext => ({
    sanitizeInline: (html) => env.inline(html),
    plainText: (html) => htmlTextContent(typeof html === 'string' ? html : ''),
    renderBlocks: (blocks) => {
      const normalized = Array.isArray(blocks)
        ? blocks.map(normalizeViewBlock).filter((candidate): candidate is ViewBlock => candidate !== null)
        : [];

      return renderList(normalized);
    },
    renderChildren: () => renderList(model.childrenOf(block.id)),
  });

  /**
   * Comment-safe tool name: collapse dash runs (no `--` inside a comment) and
   * entity-escape the rest.
   * @param type - raw tool name
   */
  const commentSafeType = (type: string): string => escapeHtml(type.replace(/-+/g, '-'));

  const renderBlock = (block: ViewBlock): string => {
    const custom = renderers[block.type];

    if (custom !== undefined) {
      return custom(block.data, ctxFor(block));
    }

    const emitter = builtinEmitters[block.type];

    if (emitter !== undefined) {
      const html = emitter(block, env);

      return toolAttributes && !BARE_CONTAINER_TOOLS.has(block.type)
        ? stampToolAttr(html, block.type)
        : html;
    }

    /** Unknown tool: the block is skipped/commented, its children still render. */
    const children = renderList(model.childrenOf(block.id));

    return onUnknownBlock === 'comment'
      ? `<!-- blok:unknown ${commentSafeType(block.type)} -->${children}`
      : children;
  };

  const renderGuarded = (block: ViewBlock): string => {
    if (block.id !== undefined) {
      if (active.has(block.id)) {
        return '';
      }
      active.add(block.id);
    }

    try {
      return renderBlock(block);
    } finally {
      if (block.id !== undefined) {
        active.delete(block.id);
      }
    }
  };

  /**
   * End index (exclusive) of the consecutive `list` run starting at `from`.
   * @param blocks - sibling run
   * @param from - index of the first list block
   */
  const listRunEnd = (blocks: ViewBlock[], from: number): number => {
    return from < blocks.length && blocks[from].type === 'list' ? listRunEnd(blocks, from + 1) : from;
  };

  /**
   * Render siblings from an index on; consecutive list blocks group into one
   * nested <ul>/<ol> run (unless a custom renderer owns `list`).
   * @param blocks - sibling run
   * @param from - index to render from
   */
  const renderFrom = (blocks: ViewBlock[], from: number): string => {
    if (from >= blocks.length) {
      return '';
    }

    const block = blocks[from];

    if (block.type === 'list' && renderers.list === undefined) {
      const end = listRunEnd(blocks, from);
      const run = blocks.slice(from, end).filter((item) => item.id === undefined || !active.has(item.id));
      const listHtml = renderListRun(run, env);

      return (toolAttributes ? stampToolAttr(listHtml, 'list') : listHtml) + renderFrom(blocks, end);
    }

    return renderGuarded(block) + renderFrom(blocks, from + 1);
  };

  const renderList = (blocks: ViewBlock[]): string => renderFrom(blocks, 0);

  return {
    renderTopLevel: () => renderList(model.topLevel),
    renderList,
    ctxFor,
  };
};

/**
 * Render a saved Blok document to semantic HTML, synchronously and DOM-free.
 * @param data - saved document (strict or loose wire shape; nullish tolerated)
 * @param options - schema / custom renderers / unknown-block policy
 * @returns HTML string ('' for empty/malformed documents)
 */
export const blocksToHtml = (
  data: OutputData | LooseOutputData | null | undefined,
  options: BlocksToHtmlOptions = {}
): string => {
  return createHtmlRenderer(buildDocumentModel(data), options).renderTopLevel();
};

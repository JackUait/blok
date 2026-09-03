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
import { BLOCK_CONTENT_CLASSES, BLOCK_WRAPPER_CLASSES } from '../shared/block-scaffolding';
import { classesFor } from '../shared/tool-classes';
import { hasUnsafeUrlProtocol } from '../shared/url-policy';
import { buildDocumentModel, normalizeViewBlock } from './document-model';
import type { DocumentModel, ViewBlock } from './document-model';
import { builtinEmitters, renderListRun } from './emitters';
import type { EmitterEnv } from './emitters';
import { htmlTextContent } from './html-text';
import { applyInlineRenderers } from './inline-renderers';
import type { ViewInlineRenderer } from './inline-renderers';
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
 * Options for {@link blocksToHtml} / `blocksToPlainText`.
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
   * re-sanitized, the same trust contract as a block renderer's output — so it
   * can carry markup the inline allowlist would otherwise strip.
   *
   * Applies to rendered HTML only; `blocksToPlainText` reads a mark's stored
   * source, not its rendering.
   * @example
   * blocksToHtml(data, {
   *   inlineRenderers: {
   *     span: ({ attrs }) => attrs['data-latex'] === undefined
   *       ? undefined
   *       : katex.renderToString(attrs['data-latex'], { throwOnError: false }),
   *   },
   * });
   */
  inlineRenderers?: Record<string, ViewInlineRenderer>;
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
  /**
   * When true, each block Blok renders carries a `data-blok-id="<id>"`
   * attribute on its root element (list items carry it on each `<li>`, not the
   * grouped `<ul>`/`<ol>`), so "copy link to block" deep links resolve off the
   * live editor. Off by default; blocks without an id, and bare containers that
   * emit no root of their own (database), are left unstamped.
   */
  blockIds?: boolean;
  /**
   * Pure URL rewrite hook applied to every block URL (image/video/audio src,
   * file/bookmark/embed href) and every inline anchor href, sequenced BEFORE
   * the unsafe-scheme strip. See {@link ViewUrlTransform}.
   */
  transformUrl?: ViewUrlTransform;
  /**
   * Wrap the output in `<div data-blok-interface="view">` (default `false`).
   *
   * The wrapper is what makes the emitted classes render like a read-only
   * editor: the scoped preflight (`src/styles/preflight.css`) applies its
   * box-sizing, margin, padding and border resets ONLY under
   * `[data-blok-interface]`, and the token/colour layers key on the same bare
   * attribute. Without it, identical classes compute differently.
   *
   * The value is deliberately `view`, not `blok` — `all: initial !important` is
   * keyed on `[data-blok-interface=blok]` (`src/styles/isolation.css`), which
   * would also block host typography from cascading in and would match
   * editor-targeting selectors.
   *
   * Opt-in rather than default-on because switching it on would add an element
   * to every existing consumer's output — a breaking change to this published
   * API. `<BlokView>` stamps the attribute onto the wrapper it already renders,
   * so React consumers get parity without setting this.
   */
  root?: boolean;
  /**
   * Stamp each block root with the same presentational classes the editor's
   * tools apply (default `false`).
   *
   * This is the mechanism behind visual parity: the classes come from
   * `src/shared/tool-classes/*`, the single source both the tools' `render()`
   * and this renderer read, so the two cannot drift (enforced by the golden
   * harness's class-parity guarantee). They need `@bloklabs/core/view.css` — and
   * the `root` wrapper, or an equivalent `[data-blok-interface]` ancestor — to
   * actually paint.
   *
   * Opt-in for the same reason as {@link root}: switching it on by default would
   * change the markup every existing consumer of this published API receives.
   * `<BlokView>` enables it internally, so React consumers get parity for free.
   */
  classes?: boolean;
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
 * Tools whose emitter places its own presentational classes via
 * `env.classAttr()`, so the dispatcher must NOT stamp them onto the first
 * opening tag.
 *
 * These are the emitters that WRAP their styled element: a toggleable header
 * emits `<details><summary><h2>`, and stamping the first tag would put the
 * heading typography on the `<details>` — where `<h1>`-`<h6>` UA font-size and
 * weight then override it. A new wrapping emitter must be added here.
 */
const SELF_STAMPING_TOOLS = new Set(['header', 'divider', 'code']);

/** One rendering unit of a sibling run: a block, or a grouped run of `list` blocks. */
type Segment = { kind: 'block'; block: ViewBlock } | { kind: 'list'; run: ViewBlock[] };

/**
 * Insert a `name="value"` attribute onto the first opening tag of
 * Blok-generated markup. Operates only on our own emitter output (which always
 * opens with `<tag`), so the leading-tag match is exact; the value is
 * entity-escaped, and a non-element string (empty / comment) is returned
 * unchanged.
 * @param html - Blok's rendered markup for one block or list run
 * @param name - attribute name to insert
 * @param value - attribute value (entity-escaped)
 */
const stampAttr = (html: string, name: string, value: string): string => {
  return html.replace(/^\s*<[a-z][a-z0-9]*/i, (openTag) => `${openTag} ${name}="${escapeHtml(value)}"`);
};

/**
 * Merge classes onto the first opening tag of Blok-generated markup.
 *
 * Operates only on our own emitter output (which always opens with `<tag`), so
 * the leading-tag match is exact. An existing `class` attribute is EXTENDED
 * rather than replaced, and a non-element string (empty / comment) is returned
 * unchanged.
 * @param html - Blok's rendered markup for one block or list run
 * @param classes - classes to add
 */
const stampClass = (html: string, classes: readonly string[]): string => {
  if (classes.length === 0) {
    return html;
  }

  const added = escapeHtml(classes.join(' '));
  const withExistingClass = /^(\s*<[a-z][a-z0-9]*[^>]*?)\sclass="([^"]*)"/i;

  if (withExistingClass.test(html)) {
    return html.replace(withExistingClass, (_match, head: string, prior: string) => `${head} class="${prior} ${added}"`);
  }

  return html.replace(/^\s*<[a-z][a-z0-9]*/i, (openTag) => `${openTag} class="${added}"`);
};

export const createHtmlRenderer = (model: DocumentModel, options: BlocksToHtmlOptions): HtmlRenderer => {
  const renderers = options.renderers ?? {};
  const onUnknownBlock = options.onUnknownBlock ?? 'skip';
  const toolAttributes = options.toolAttributes === true;
  const blockIds = options.blockIds === true;
  const classes = options.classes === true;
  const transformUrl = options.transformUrl;

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

  /** Inline-anchor URL rewrite bridge (blockType unknown at the inline layer). */
  const inlineUrlTransform = transformUrl === undefined
    ? undefined
    : (url: string, attr: 'href' | 'src'): string => transformUrl(url, { attr, blockType: undefined });

  /**
   * Inline renderers run on the SANITIZED fragment, so a renderer can only see
   * what the allowlist kept. Skipped entirely when none are configured — the
   * pass costs a parse/serialize round trip per inline field.
   */
  const inlineRenderers = options.inlineRenderers ?? {};
  const hasInlineRenderers = Object.keys(inlineRenderers).length > 0;

  const env: EmitterEnv = {
    inline: (value) => {
      const sanitized = sanitizeHtmlFragment(typeof value === 'string' ? value : '', inlineConfig, inlineUrlTransform);

      return hasInlineRenderers ? applyInlineRenderers(sanitized, inlineRenderers) : sanitized;
    },
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
    url: (name, value, blockType) => {
      if (typeof value !== 'string' || value === '') {
        return '';
      }

      const resolved = transformUrl === undefined ? value : transformUrl(value, { attr: name, blockType });

      if (typeof resolved !== 'string' || resolved === '' || hasUnsafeUrlProtocol(resolved, name)) {
        return '';
      }

      return ` ${name}="${escapeHtml(resolved)}"`;
    },
    idAttr: (block) => (blockIds && block.id !== undefined ? ` data-blok-id="${escapeHtml(block.id)}"` : ''),
    rootAttrs: (block) => {
      const list = classes ? classesFor(block.type, block.data) : [];
      const classPart = list.length === 0 ? '' : ` class="${escapeHtml(list.join(' '))}"`;
      const toolPart = toolAttributes ? ` data-blok-tool="${escapeHtml(block.type)}"` : '';
      const idPart = blockIds && block.id !== undefined ? ` data-blok-id="${escapeHtml(block.id)}"` : '';

      return `${classPart}${toolPart}${idPart}`;
    },
    classList: (list) => (classes && list.length > 0 ? ` class="${escapeHtml(list.join(' '))}"` : ''),
    classesEnabled: classes,
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
      const bare = BARE_CONTAINER_TOOLS.has(block.type);
      const base = emitter(block, env);

      /** Self-stamping emitters placed all root attributes via env.rootAttrs(). */
      if (SELF_STAMPING_TOOLS.has(block.type)) {
        return base;
      }

      const withId = blockIds && !bare && block.id !== undefined
        ? stampAttr(base, 'data-blok-id', block.id)
        : base;

      const withTool = toolAttributes && !bare ? stampAttr(withId, 'data-blok-tool', block.type) : withId;

      /**
       * Bare containers emit no root of their own, and self-stamping emitters
       * have already placed their classes — so neither is stamped here.
       */
      const centrallyStamped = classes && !bare && !SELF_STAMPING_TOOLS.has(block.type);

      return centrallyStamped ? stampClass(withTool, classesFor(block.type, block.data)) : withTool;
    }

    /** Unknown tool: the block is skipped/commented, its children still render. */
    const children = renderList(model.childrenOf(block.id));

    return onUnknownBlock === 'comment'
      ? `<!-- blok:unknown ${commentSafeType(block.type)} -->${children}`
      : children;
  };

  /**
   * Wrap one block's markup in the core's `holder → content` scaffolding.
   *
   * Reproducing this is REQUIRED for parity, and it is not per-tool styling: the
   * appearance of links, bold and italic inside every block comes from the
   * holder's descendant selectors (`[&_a]:text-link`, `[&_b]:font-bold`,
   * `[&_i]:italic`), and the centred measure from the content element's
   * `mx-auto max-w-blok-content`. A view emitting only tool classes renders
   * unstyled links at full width.
   *
   * Two extra elements per block is a structural change to this renderer's
   * published output, so it happens only when `classes` asked for parity.
   * `data-blok-element` marks the holder, matching the editor's own marker.
   * @param html - the block's own rendered markup
   */
  const scaffold = (html: string): string => {
    if (!classes || html === '') {
      return html;
    }

    const wrapper = escapeHtml(BLOCK_WRAPPER_CLASSES.join(' '));
    const content = escapeHtml(BLOCK_CONTENT_CLASSES.join(' '));

    return `<div data-blok-element class="${wrapper}"><div class="${content}">${html}</div></div>`;
  };

  const renderGuarded = (block: ViewBlock): string => {
    if (block.id !== undefined) {
      if (active.has(block.id)) {
        return '';
      }
      active.add(block.id);
    }

    try {
      /** Bare containers contribute no block of their own, so they get no holder. */
      return BARE_CONTAINER_TOOLS.has(block.type) ? renderBlock(block) : scaffold(renderBlock(block));
    } finally {
      if (block.id !== undefined) {
        active.delete(block.id);
      }
    }
  };

  /**
   * A sibling run split into what renders as one unit: a single block, or a
   * group of consecutive `list` blocks that share one nested <ul>/<ol>.
   * @param blocks - sibling run
   */
  const segmentsOf = (blocks: ViewBlock[]): Segment[] => {
    return blocks.reduce<Segment[]>((segments, block) => {
      const grouped = block.type === 'list' && renderers.list === undefined;
      const last = segments[segments.length - 1];

      if (grouped && last?.kind === 'list') {
        last.run.push(block);

        return segments;
      }

      segments.push(grouped ? { kind: 'list', run: [block] } : { kind: 'block', block });

      return segments;
    }, []);
  };

  /**
   * Render a sibling run, joined once at the end. Appending each block onto the
   * markup that follows it re-allocates the whole remainder per block, which is
   * quadratic — and grouping list runs by recursing down the siblings puts one
   * frame on the stack per block. A 600 KB article did neither: it allocated
   * past the server runtime's per-conversion memory limit and failed outright.
   * @param blocks - sibling run
   */
  const renderList = (blocks: ViewBlock[]): string => {
    return segmentsOf(blocks).map((segment) => {
      if (segment.kind === 'block') {
        return renderGuarded(segment.block);
      }

      const run = segment.run.filter((item) => item.id === undefined || !active.has(item.id));
      const listHtml = renderListRun(run, env);

      /**
       * Under parity each `<li>` carries the tool hook itself (every list item
       * IS a block), so stamping the grouping `<ul>`/`<ol>` too would double it
       * and break one-to-one pairing against the editor's flat item blocks.
       * Without parity the legacy run-level hook is preserved unchanged.
       */
      return toolAttributes && !classes ? stampAttr(listHtml, 'data-blok-tool', 'list') : listHtml;
    }).join('');
  };

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
  const body = createHtmlRenderer(buildDocumentModel(data), options).renderTopLevel();

  /**
   * An empty document still yields the wrapper when opted in: consumers style
   * the container, and a container that vanishes for empty content forces them
   * to handle two output shapes.
   */
  return options.root === true ? `<div data-blok-interface="view">${body}</div>` : body;
};

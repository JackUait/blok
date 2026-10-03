/**
 * Per-tool `data → HTML string` emitters for the synchronous view renderer —
 * the single central dispatcher over the whole built-in tool set (design D1,
 * modeled on `src/markdown/blocks-to-markdown.ts`).
 *
 * Sanitization contract: every inline-content field passes through
 * `env.inline` (the parse5 allowlist walker) before interpolation; scalar
 * non-HTML fields go through `env.escape`; URL attributes go through
 * `env.url`, which applies the `transformUrl` hook then enforces the shared
 * URL scheme policy. Emitters never interpolate unsanitized strings.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*). Never import
 * the `src/components/utils` barrel, editor modules, or tool classes.
 */
import { normalizeHeadingAnchor } from '../shared/heading-anchor';
import { readVariants } from '../shared/read-variants';
import { CALLOUT_CHILDREN_CLASSES } from '../shared/tool-classes/callout';
import { CODE_AREA_CLASSES, CODE_CAPTIONED_AREA_CLASSES, CODE_FILENAME_CLASSES, CODE_HEADER_CLASSES } from '../shared/tool-classes/code';
import { DIVIDER_RULE_CLASSES } from '../shared/tool-classes/divider';
import {
  LIST_CHECKBOX_CLASSES,
  LIST_CHECKED_CLASSES,
  LIST_CHECKLIST_CONTENT_CLASSES,
  LIST_CHECKLIST_ROW_CLASSES,
  LIST_CONTENT_CLASSES,
  LIST_ITEM_ROW_CLASSES,
} from '../shared/tool-classes/list';
import {
  PAGE_FALLBACK_ICON,
  PAGE_ICON_CLASSES,
  PAGE_LINK_CLASSES,
  PAGE_LINK_INK_CLASSES,
  PAGE_TITLE_CLASSES,
  PAGE_TITLE_MUTED_CLASSES,
} from '../shared/tool-classes/page';
import { TOGGLE_CHILDREN_CLASSES, TOGGLE_CONTENT_CLASSES, TOGGLE_HEADER_ROW_CLASSES } from '../shared/tool-classes/toggle';
import type { ViewBlock } from './document-model';
import { claimedCellTexts, leadingCellText, repairedTableRows } from './table-grid';

/**
 * Rendering services handed to every emitter by the dispatcher.
 */
export interface EmitterEnv {
  /** Sanitize an inline-HTML block-data field against the composed allowlist. */
  inline(value: unknown): string;
  /** Entity-escape a scalar (non-HTML) block-data field. */
  escape(value: unknown): string;
  /** Structural children of a block, in document order. */
  childrenOf(id: string | undefined): ViewBlock[];
  /** Resolve blocks referenced by id (unknown ids are dropped). */
  blocksById(ids: unknown): ViewBlock[];
  /** Render a sibling run of blocks (applies list-run grouping). */
  renderList(blocks: ViewBlock[]): string;
  /**
   * Build a ` name="value"` attribute for a URL-bearing block field. Applies
   * the configured `transformUrl` hook first, then the shared unsafe-scheme
   * strip — dropping the attribute entirely when the value is empty or resolves
   * to an unsafe scheme.
   */
  url(name: 'href' | 'src', value: unknown, blockType: string): string;
  /**
   * Build the ` href="…"` attribute for a page block from the `pageHref`
   * option, gated like {@link EmitterEnv.url}. Empty when the option is absent,
   * the id is not a non-empty string, or the URL is unsafe.
   */
  pageHrefAttr(pageId: unknown): string;
  /**
   * Build the ` data-blok-id="<id>"` attribute for a block when the `blockIds`
   * option is on and the block carries an id; empty string otherwise.
   */
  idAttr(block: ViewBlock): string;
  /**
   * Build every root attribute the dispatcher would otherwise stamp onto the
   * first opening tag — presentational `class`, `data-blok-tool`,
   * `data-blok-id` — honouring the same options.
   *
   * Only emitters listed as self-stamping in `blocks-to-html.ts` use this. An
   * emitter that WRAPS its styled element (a toggleable header emits
   * `<details><summary><h2>`) must place them itself: the typography has to land
   * on the `<h2>`, and the tool hook must sit on the SAME element or the parity
   * harness pairs the wrapper against the editor's heading.
   */
  rootAttrs(block: ViewBlock): string;
  /**
   * Build a ` class="…"` attribute for an INNER element from an explicit class
   * list, honouring the `classes` option (empty string when it is off).
   *
   * For elements that are not the block root — a divider's `<hr>` inside its
   * spacing wrapper — whose classes therefore never come from `classesFor`.
   */
  classList(list: readonly string[]): string;
  /**
   * Whether the caller asked for editor-identical rendering (`classes: true`).
   *
   * A few emitters need an extra WRAPPER element to reproduce the editor's box
   * model (the divider's spacing wrapper). That wrapper is a structural change
   * to this renderer's published output, so it appears only when parity was
   * explicitly requested; the default output stays the clean semantic HTML
   * existing consumers already receive.
   */
  classesEnabled: boolean;
  /**
   * ` dir="ltr|rtl"` from the block's own text when the `direction` option is
   * set, else ''. Only list items read it here; the dispatcher stamps the rest.
   */
  dirAttr(block: ViewBlock): string;
  /** ` dir="ltr"` when the `direction` option is set, else '': pins code LTR. */
  ltrAttr: string;
}

/**
 * One tool emitter. Emitters are responsible for their block's children:
 * containers place them inside their markup, leaf tools append them after
 * (via {@link trail}).
 */
export type Emitter = (block: ViewBlock, env: EmitterEnv) => string;

/**
 * Read a string field from block data, empty when absent/non-string.
 * @param data - block data
 * @param key - field name
 */
const str = (data: Record<string, unknown>, key: string): string => {
  const value = data[key];

  return typeof value === 'string' ? value : '';
};

/**
 * Append a leaf block's structural children after its own markup.
 * @param html - the block's own markup
 * @param block - the block
 * @param env - emitter environment
 */
const trail = (html: string, block: ViewBlock, env: EmitterEnv): string => {
  return html + env.renderList(env.childrenOf(block.id));
};

/**
 * Figcaption markup for media blocks: shown when a caption (or fallback
 * label) is present and `captionVisible` is not explicitly false.
 *
 * Captions are entity-escaped, not treated as inline HTML: every live
 * caption editor (image/video/audio/file/embed UIs) reads and writes the
 * field via `textContent`, so stored captions are plain text — proven by the
 * golden harness against a real editor.
 * @param block - media block
 * @param env - emitter environment
 * @param fallbackKeys - additional data fields tried when `caption` is empty
 */
const figcaption = (block: ViewBlock, env: EmitterEnv, fallbackKeys: string[] = []): string => {
  if (block.data.captionVisible === false) {
    return '';
  }

  const caption = [str(block.data, 'caption'), ...fallbackKeys.map((key) => str(block.data, key))]
    .find((candidate) => candidate !== '') ?? '';

  return caption === '' ? '' : `<figcaption>${env.escape(caption)}</figcaption>`;
};

/**
 * Wrap a block's children in a plain container element.
 * @param block - container block
 * @param env - emitter environment
 */
const childrenDiv = (block: ViewBlock, env: EmitterEnv): string => {
  return `<div>${env.renderList(env.childrenOf(block.id))}</div>`;
};

/**
 * Children rendered bare (no own markup) — database blocks' minimal fallback.
 * @param block - container block
 * @param env - emitter environment
 */
const childrenOnly = (block: ViewBlock, env: EmitterEnv): string => {
  return env.renderList(env.childrenOf(block.id));
};

/**
 * Marks a nested-block container the way the editor's toggle and callout tools
 * do. `main.css` keys the heading override
 * `[data-blok-toggle-children] :is(h1, …, h6) { margin-top: 1px }` on it, which
 * is what stops a heading nested in a toggle or callout from taking its
 * root-level top margin (`mt-8` for an h1). Purely presentational here — the
 * view has no hierarchy manager to drive.
 */
const CHILDREN_CONTAINER_ATTR = ' data-blok-toggle-children';

/** List style read with the unordered default (mirrors the list tool). */
const listStyleOf = (block: ViewBlock): string => {
  const style = block.data.style;

  return style === 'ordered' || style === 'checklist' ? style : 'unordered';
};

/**
 * Render one consecutive run of `list` blocks as nested `<ul>`/`<ol>` markup.
 *
 * Nesting comes from the flat `data.depth` (rebased to the run's first item
 * and clamped to +1 per step, so imported/corrupt depths degrade gracefully);
 * structurally-parented children of an item render inside its `<li>` via the
 * generic children pipeline, which re-enters this builder for nested list
 * runs. Checklists render a disabled checkbox carrying the checked state.
 * @param items - consecutive sibling blocks of tool `list`
 * @param env - emitter environment
 */
export const renderListRun = (items: ViewBlock[], env: EmitterEnv): string => {
  if (items.length === 0) {
    return '';
  }

  const base = Math.max(Number(items[0].data.depth ?? 0) || 0, 0);
  const eff = items.reduce<number[]>((acc, item, index) => {
    const raw = Math.max((Number(item.data.depth ?? 0) || 0) - base, 0);

    acc.push(index === 0 ? 0 : Math.min(raw, acc[index - 1] + 1));

    return acc;
  }, []);

  const itemContent = (item: ViewBlock): string => {
    const isChecklist = listStyleOf(item) === 'checklist';
    const checkbox = isChecklist
      ? `<input type="checkbox"${item.data.checked === true ? ' checked' : ''} disabled${env.classList(LIST_CHECKBOX_CLASSES)}>`
      : '';
    const text = env.inline(item.data.text);
    const children = env.renderList(env.childrenOf(item.id));

    if (!env.classesEnabled) {
      return checkbox + text + children;
    }

    /**
     * Under parity the item mirrors the editor's inner layout: a flex row
     * holding the marker/checkbox beside a content cell. Without it the
     * checkbox and text do not align the way they do while editing.
     */
    const row = isChecklist ? LIST_CHECKLIST_ROW_CLASSES : LIST_ITEM_ROW_CLASSES;

    if (!isChecklist) {
      return `<div${env.classList(row)}><div${env.classList(LIST_CONTENT_CLASSES)}>${text}</div></div>${children}`;
    }

    /**
     * A CHECKED item is struck through and faded, and carries `data-checked` —
     * which `src/styles/checklist.css` keys its dark-mode rules on. The view
     * previously rendered completed items as plain text.
     */
    const checked = item.data.checked === true;
    const contentClasses = checked
      ? [...LIST_CHECKLIST_CONTENT_CLASSES, ...LIST_CHECKED_CLASSES]
      : LIST_CHECKLIST_CONTENT_CLASSES;
    const content = `<div${env.classList(contentClasses)} data-checked="${String(checked)}">${text}</div>`;

    return `<div${env.classList(row)}>${checkbox}${content}</div>${children}`;
  };

  /** One recursion step: the markup produced plus the index to continue from. */
  interface Step {
    html: string;
    next: number;
  }

  /**
   * Consecutive `<li>`s of one list (same depth, same style), each pulling in
   * its deeper descendants as a nested list.
   */
  const buildItems = (from: number, depth: number, style: string): Step => {
    if (from >= items.length || eff[from] !== depth || listStyleOf(items[from]) !== style) {
      return { html: '', next: from };
    }

    const nested = from + 1 < items.length && eff[from + 1] === depth + 1
      ? buildLevel(from + 1, depth + 1)
      : { html: '', next: from + 1 };

    /**
     * Each list ITEM is its own block, so the block's root attributes belong on
     * the `<li>` — not on the grouping `<ul>`/`<ol>`, which has no editor
     * counterpart (the editor renders a flat item sequence). Keeping them here
     * is also what lets the parity harness pair view `<li>`s against the
     * editor's item blocks one-to-one.
     */
    const li = `<li${env.classesEnabled ? env.rootAttrs(items[from]) : env.idAttr(items[from])}${env.dirAttr(items[from])}>${itemContent(items[from])}${nested.html}</li>`;
    const rest = buildItems(nested.next, depth, style);

    return { html: li + rest.html, next: rest.next };
  };

  /** One or more sibling lists at this depth (a style switch opens a new list). */
  const buildLevel = (from: number, depth: number): Step => {
    if (from >= items.length || eff[from] !== depth) {
      return { html: '', next: from };
    }

    const style = listStyleOf(items[from]);
    const start = style === 'ordered' ? Number(items[from].data.start) : Number.NaN;
    const startAttr = Number.isInteger(start) && start > 1 ? ` start="${start}"` : '';
    const tag = style === 'ordered' ? 'ol' : 'ul';
    const run = buildItems(from, depth, style);
    const rest = buildLevel(run.next, depth);
    /**
     * Under parity the grouping element carries `data-list-style` the way the
     * editor's list container does. Two stylesheets key on it and would
     * otherwise never match in a view: `checklist.css` (the whole custom
     * checkbox appearance — without this the view falls back to the native
     * browser control) and main.css's `--_blok-list-pad` indirection, which
     * resolves the public `--blok-list-padding-start` token the `<li>`'s
     * `ps-[var(--_blok-list-pad,0px)]` reads.
     */
    const styleAttr = env.classesEnabled ? ` data-list-style="${env.escape(style)}"` : '';

    return { html: `<${tag}${startAttr}${styleAttr}>${run.html}</${tag}>` + rest.html, next: rest.next };
  };

  return buildLevel(0, 0).html;
};

/**
 * Narrow an unknown value to a plain record.
 * @param value - value to check
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Render one table cell's inner HTML: modern cells hold child-block id
 * references (rendered recursively); legacy cells hold an HTML string
 * (sanitized inline). Mirrors the two shapes `readTableGrid` handles in the
 * markdown serializer. Legacy cells a live span claimed follow the origin's
 * own content.
 * @param cell - raw cell value from `data.content`
 * @param env - emitter environment
 */
const tableCellInner = (cell: unknown, env: EmitterEnv): string => {
  if (typeof cell === 'string') {
    return env.inline(cell);
  }

  if (!isRecord(cell)) {
    return '';
  }

  const kids = env.blocksById(cell.blocks);
  const leading = leadingCellText(cell);
  const own = kids.length > 0
    ? (leading === undefined ? '' : env.inline(leading)) + env.renderList(kids)
    : env.inline(cell.text);

  return own + claimedCellTexts(cell).map(text => env.inline(text)).join('');
};

/**
 * Table emitter: `<thead>` when `withHeadings`, `<th>` first column when
 * `withHeadingColumn`, colspan/rowspan from merged-cell origin data, covered
 * cells (`mergedInto`) skipped. Children are consumed via the grid — never
 * re-rendered after the table.
 * @param block - table block
 * @param env - emitter environment
 */
const emitTable = (block: ViewBlock, env: EmitterEnv): string => {
  const rows = repairedTableRows(block.data.content);

  if (rows.length === 0) {
    return '';
  }

  const withHeadings = block.data.withHeadings === true;
  const withHeadingColumn = block.data.withHeadingColumn === true;

  const renderRow = (row: unknown[], isHeadingRow: boolean): string => {
    const cells = row.map((cell, colIndex) => {
      if (isRecord(cell) && cell.mergedInto !== undefined) {
        return '';
      }

      const tag = isHeadingRow || (withHeadingColumn && colIndex === 0) ? 'th' : 'td';
      const span = (name: 'colspan' | 'rowspan'): string => {
        const value = isRecord(cell) ? Number(cell[name]) : Number.NaN;

        return Number.isInteger(value) && value > 1 ? ` ${name}="${value}"` : '';
      };

      return `<${tag}${span('colspan')}${span('rowspan')}>${tableCellInner(cell, env)}</${tag}>`;
    }).join('');

    return `<tr>${cells}</tr>`;
  };

  const head = withHeadings ? `<thead>${renderRow(rows[0], true)}</thead>` : '';
  const bodyRows = withHeadings ? rows.slice(1) : rows;
  const body = `<tbody>${bodyRows.map((row) => renderRow(row, false)).join('')}</tbody>`;

  return `<table>${head}${body}</table>`;
};

/**
 * Page emitter: a one-line card (icon + title) pointing at a SEPARATE
 * document. It is a link only when the consumer supplies `pageHref`.
 *
 * Deliberately never renders children: the page body is not in this
 * document, so any child a malformed document hangs off a page would
 * publish content the reader never sees in the editor.
 * @param block - page block
 * @param env - emitter environment
 */
const emitPage = (block: ViewBlock, env: EmitterEnv): string => {
  const cache = isRecord(block.data.cache) ? block.data.cache : {};
  const icon = isRecord(cache.icon) ? cache.icon : {};
  const title = str(cache, 'title');
  const emoji = icon.type === 'emoji' ? str(icon, 'value') : '';
  const src = icon.type === 'image' ? env.url('src', icon.url, block.type) : '';
  const fallback = emoji === '' ? PAGE_FALLBACK_ICON.trim() : env.escape(emoji);
  const glyph = src === '' ? fallback : `<img${src} alt="">`;
  const iconSlot = `<span${env.classList(PAGE_ICON_CLASSES)} aria-hidden="true">${glyph}</span>`;
  /** Matches the editor's placeholder; the view has no i18n layer. */
  const titleClasses = title === '' ? [...PAGE_TITLE_CLASSES, ...PAGE_TITLE_MUTED_CLASSES] : PAGE_TITLE_CLASSES;
  const label = `<span${env.classList(titleClasses)}>${env.escape(title === '' ? 'Untitled' : title)}</span>`;
  const cardClasses = env.classList([...PAGE_LINK_CLASSES, ...PAGE_LINK_INK_CLASSES]);
  const href = env.pageHrefAttr(block.data.pageId);

  return href === ''
    ? `<div><span${cardClasses}>${iconSlot}${label}</span></div>`
    : `<div><a${href}${cardClasses}>${iconSlot}${label}</a></div>`;
};

/**
 * The built-in tool emitters, keyed by tool name as registered in
 * `defaultBlockTools`. `list` never reaches this map — list runs are grouped
 * by the dispatcher and rendered via {@link renderListRun}.
 */
export const builtinEmitters: Record<string, Emitter> = {
  paragraph: (block, env) => trail(`<p>${env.inline(block.data.text)}</p>`, block, env),

  header: (block, env) => {
    const level = Math.min(Math.max(Number(block.data.level) || 1, 1), 6);
    /**
     * Classes go on the HEADING, never on the `<details>` wrapper below — the
     * editor styles its h-tag, and `<h1>`-`<h6>` carry UA font-size/weight that
     * would override anything merely inherited from an ancestor.
     */
    /**
     * `data-blok-heading-level` is what `src/styles/heading.css` keys its
     * per-level rules on — the host-overridable `--blok-heading-N-font-size`
     * tokens. Without it a host retuning those would see the editor change and
     * the view stay put.
     */
    const levelAttr = env.classesEnabled ? ` data-blok-heading-level="${level}"` : '';
    /**
     * The anchor is what in-document links point at, so the view has to emit it
     * or every `<a href="#...">` in the rendered document dies. It comes from
     * block data — clipboard-controlled — so it is escaped like any other value.
     */
    const anchor = normalizeHeadingAnchor(block.data.anchor);
    const anchorAttr = anchor === undefined ? '' : ` id="${env.escape(anchor)}"`;
    const heading = `<h${level}${env.rootAttrs(block)}${anchorAttr}${levelAttr}>${env.inline(block.data.text)}</h${level}>`;

    /** Open state is personal to each browser, so the view always starts collapsed. */
    if (block.data.isToggleable === true) {
      return `<details><summary>${heading}</summary>${childrenOnly(block, env)}</details>`;
    }

    return trail(heading, block, env);
  },

  quote: (block, env) => {
    const caption = str(block.data, 'caption');
    const cite = caption === '' ? '' : `<cite>${env.inline(caption)}</cite>`;

    return trail(`<blockquote>${env.inline(block.data.text)}${cite}</blockquote>`, block, env);
  },

  code: (block, env) => {
    const language = str(block.data, 'language');
    /**
     * `language-*` is a long-standing syntax-highlighter hook in this renderer's
     * published output — it is emitted unconditionally, NOT behind the parity
     * flag.
     */
    const languageAttr = language === '' ? '' : ` class="language-${env.escape(language)}"`;
    /**
     * The `<pre>` carries the code-area classes (monospace font, padding, wrap
     * and scroll behaviour). Omitting them was the most visible parity gap of
     * any block, and a root-only class comparison could not see it: the block
     * root carries the wrapper classes, these belong one level down.
     */
    const inner = `<code${languageAttr}>${env.escape(block.data.code)}</code>`;

    /**
     * Under parity the block needs its own wrapper: the editor's box (border,
     * radius, background, overflow clipping) lives on a container AROUND the
     * code area, so collapsing both onto the `<pre>` would mix the box with the
     * text padding.
     */
    const filename = str(block.data, 'filename');
    const hasFilename = filename.trim() !== '';

    if (env.classesEnabled) {
      const header = hasFilename
        ? `<div${env.classList(CODE_HEADER_CLASSES)}><span${env.classList(CODE_FILENAME_CLASSES)}>${env.escape(filename)}</span></div>`
        : '';

      return trail(
        `<div${env.rootAttrs(block)}>${header}<pre${env.classList(hasFilename ? [...CODE_AREA_CLASSES, ...CODE_CAPTIONED_AREA_CLASSES] : CODE_AREA_CLASSES)}${env.ltrAttr}>${inner}</pre></div>`,
        block,
        env
      );
    }

    /** `html-to-blocks.ts` reads this figure shape back into `filename`. */
    if (hasFilename) {
      return trail(
        `<figure${env.rootAttrs(block)}><figcaption>${env.escape(filename)}</figcaption><pre${env.ltrAttr}>${inner}</pre></figure>`,
        block,
        env
      );
    }

    return trail(`<pre${env.rootAttrs(block)}${env.ltrAttr}>${inner}</pre>`, block, env);
  },

  /**
   * The divider is a WRAPPER around the rule, matching the editor: the wrapper
   * carries the vertical spacing and the minimal line-height, the `<hr>` carries
   * the border. Emitting a bare `<hr>` would put the block's spacing classes on
   * the rule itself and pair the wrong elements in the parity harness.
   */
  divider: (block, env) =>
    trail(
      env.classesEnabled
        ? `<div${env.rootAttrs(block)}><hr${env.classList(DIVIDER_RULE_CLASSES)}></div>`
        : `<hr${env.rootAttrs(block)}>`,
      block,
      env
    ),

  callout: (block, env) => {
    const emoji = str(block.data, 'emoji');
    const marker = emoji === '' ? '' : `<span>${env.escape(emoji)}</span>`;
    const children = childrenOnly(block, env);
    /**
     * The editor holds a callout's children in their own flex child; without it
     * the emoji and the body do not share the editor's layout.
     */
    const body = env.classesEnabled
      ? `<div${env.classList(CALLOUT_CHILDREN_CLASSES)}${CHILDREN_CONTAINER_ATTR}>${children}</div>`
      : children;

    return `<aside>${marker}${body}</aside>`;
  },

  toggle: (block, env) => {
    const summary = `<summary${env.classList([...TOGGLE_HEADER_ROW_CLASSES, ...TOGGLE_CONTENT_CLASSES])}>${env.inline(block.data.text)}</summary>`;
    const children = childrenOnly(block, env);
    const body = env.classesEnabled
      ? `<div${env.classList(TOGGLE_CHILDREN_CLASSES)}${CHILDREN_CONTAINER_ATTR}>${children}</div>`
      : children;

    return `<details>${summary}${body}</details>`;
  },

  image: (block, env) => {
    const img = `<img${env.url('src', block.data.url, block.type)} alt="${env.escape(str(block.data, 'alt'))}">`;
    const sources = (readVariants(block.data.variants, block.data.url) ?? [])
      .filter((variant) => variant.url !== block.data.url)
      .map((variant) => {
        const src = env.url('src', variant.url, block.type);

        // env.url only speaks src/href; a single-URL srcset takes the same value.
        return src === '' ? '' : `<source${src.replace(' src=', ' srcset=')} type="${env.escape(variant.mimeType)}">`;
      })
      .join('');
    const media = sources === '' ? img : `<picture>${sources}${img}</picture>`;

    return trail(`<figure>${media}${figcaption(block, env)}</figure>`, block, env);
  },

  video: (block, env) => {
    const controls = block.data.hideControls === true ? '' : ' controls';
    const autoplay = block.data.autoplay === true ? ' autoplay' : '';
    const loop = block.data.loop === true ? ' loop' : '';
    const sources = (readVariants(block.data.variants, block.data.url) ?? [])
      .map((variant) => {
        const src = env.url('src', variant.url, block.type);

        return src === '' ? '' : `<source${src} type="${env.escape(variant.mimeType)}">`;
      })
      .join('');
    const srcAttr = sources === '' ? env.url('src', block.data.url, block.type) : '';
    const video = `<video${srcAttr}${controls}${autoplay}${loop}>${sources}</video>`;

    return trail(`<figure>${video}${figcaption(block, env)}</figure>`, block, env);
  },

  audio: (block, env) => {
    const audio = `<audio${env.url('src', block.data.url, block.type)} controls></audio>`;

    return trail(`<figure>${audio}${figcaption(block, env, ['title'])}</figure>`, block, env);
  },

  file: (block, env) => {
    const label = str(block.data, 'fileName') || str(block.data, 'url');

    return trail(`<a${env.url('href', block.data.url, block.type)} download>${env.escape(label)}</a>`, block, env);
  },

  bookmark: (block, env) => {
    const label = str(block.data, 'title') || str(block.data, 'url');

    return trail(`<a${env.url('href', block.data.url, block.type)}>${env.escape(label)}</a>`, block, env);
  },

  embed: (block, env) => {
    const embedUrl = str(block.data, 'embed');

    /** Only https embed targets reach an iframe src (matches the live tool's toSafeEmbedSrc gate). */
    if (/^https:\/\//i.test(embedUrl)) {
      return trail(`<figure><iframe src="${env.escape(embedUrl)}"></iframe>${figcaption(block, env)}</figure>`, block, env);
    }

    const source = str(block.data, 'source');
    const label = str(block.data, 'service') || source;

    return trail(`<a${env.url('href', source, block.type)}>${env.escape(label)}</a>`, block, env);
  },

  table: emitTable,

  spacer: (block, env) => trail('<div aria-hidden="true"></div>', block, env),

  column_list: childrenDiv,
  columns: childrenDiv,
  column: childrenDiv,

  database: childrenOnly,
  'database-row': childrenOnly,

  page: emitPage,
};

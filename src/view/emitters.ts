/**
 * Per-tool `data → HTML string` emitters for the synchronous view renderer —
 * the single central dispatcher over the whole built-in tool set (design D1,
 * modeled on `src/markdown/blocks-to-markdown.ts`).
 *
 * Sanitization contract: every inline-content field passes through
 * `env.inline` (the parse5 allowlist walker) before interpolation; scalar
 * non-HTML fields go through `env.escape`; URL attributes go through
 * {@link urlAttr}, which enforces the shared URL scheme policy. Emitters never
 * interpolate unsanitized strings.
 *
 * PURITY CONTRACT: only pure imports (src/shared/*, src/view/*). Never import
 * the `src/components/utils` barrel, editor modules, or tool classes.
 */
import { hasUnsafeUrlProtocol } from '../shared/url-policy';
import type { ViewBlock } from './document-model';
import { escapeHtml } from './sanitize';

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
 * Build a ` name="value"` attribute for a URL-bearing attribute, dropping it
 * entirely when the value is empty or resolves to an unsafe scheme (shared
 * URL policy — same semantics as the editor's stripUnsafeUrls pass).
 * @param name - 'href' or 'src'
 * @param value - raw URL value from block data
 */
const urlAttr = (name: 'href' | 'src', value: unknown): string => {
  if (typeof value !== 'string' || value === '' || hasUnsafeUrlProtocol(value, name)) {
    return '';
  }

  return ` ${name}="${escapeHtml(value)}"`;
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
    const checkbox = listStyleOf(item) === 'checklist'
      ? `<input type="checkbox"${item.data.checked === true ? ' checked' : ''} disabled>`
      : '';

    return checkbox + env.inline(item.data.text) + env.renderList(env.childrenOf(item.id));
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

    const li = `<li>${itemContent(items[from])}${nested.html}</li>`;
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

    return { html: `<${tag}${startAttr}>${run.html}</${tag}>` + rest.html, next: rest.next };
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
 * markdown serializer.
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

  return kids.length > 0 ? env.renderList(kids) : env.inline(cell.text);
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
  const content = Array.isArray(block.data.content) ? block.data.content : [];
  const rows = content.filter((row): row is unknown[] => Array.isArray(row));

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
 * The built-in tool emitters, keyed by tool name as registered in
 * `defaultBlockTools`. `list` never reaches this map — list runs are grouped
 * by the dispatcher and rendered via {@link renderListRun}.
 */
export const builtinEmitters: Record<string, Emitter> = {
  paragraph: (block, env) => trail(`<p>${env.inline(block.data.text)}</p>`, block, env),

  header: (block, env) => {
    const level = Math.min(Math.max(Number(block.data.level) || 1, 1), 6);
    const heading = `<h${level}>${env.inline(block.data.text)}</h${level}>`;

    if (block.data.isToggleable === true) {
      const open = block.data.isOpen === true ? ' open' : '';

      return `<details${open}><summary>${heading}</summary>${childrenOnly(block, env)}</details>`;
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
    const classAttr = language === '' ? '' : ` class="language-${env.escape(language)}"`;

    return trail(`<pre><code${classAttr}>${env.escape(block.data.code)}</code></pre>`, block, env);
  },

  divider: (block, env) => trail('<hr>', block, env),

  callout: (block, env) => {
    const emoji = str(block.data, 'emoji');
    const marker = emoji === '' ? '' : `<span>${env.escape(emoji)}</span>`;

    return `<aside>${marker}${childrenOnly(block, env)}</aside>`;
  },

  toggle: (block, env) => {
    const open = block.data.isOpen === true ? ' open' : '';

    return `<details${open}><summary>${env.inline(block.data.text)}</summary>${childrenOnly(block, env)}</details>`;
  },

  image: (block, env) => {
    const img = `<img${urlAttr('src', block.data.url)} alt="${env.escape(str(block.data, 'alt'))}">`;

    return trail(`<figure>${img}${figcaption(block, env)}</figure>`, block, env);
  },

  video: (block, env) => {
    const controls = block.data.hideControls === true ? '' : ' controls';
    const autoplay = block.data.autoplay === true ? ' autoplay' : '';
    const loop = block.data.loop === true ? ' loop' : '';
    const video = `<video${urlAttr('src', block.data.url)}${controls}${autoplay}${loop}></video>`;

    return trail(`<figure>${video}${figcaption(block, env)}</figure>`, block, env);
  },

  audio: (block, env) => {
    const audio = `<audio${urlAttr('src', block.data.url)} controls></audio>`;

    return trail(`<figure>${audio}${figcaption(block, env, ['title'])}</figure>`, block, env);
  },

  file: (block, env) => {
    const label = str(block.data, 'fileName') || str(block.data, 'url');

    return trail(`<a${urlAttr('href', block.data.url)} download>${env.escape(label)}</a>`, block, env);
  },

  bookmark: (block, env) => {
    const label = str(block.data, 'title') || str(block.data, 'url');

    return trail(`<a${urlAttr('href', block.data.url)}>${env.escape(label)}</a>`, block, env);
  },

  embed: (block, env) => {
    const embedUrl = str(block.data, 'embed');

    /** Only https embed targets reach an iframe src (matches the live tool's toSafeEmbedSrc gate). */
    if (/^https:\/\//i.test(embedUrl)) {
      return trail(`<figure><iframe src="${env.escape(embedUrl)}"></iframe>${figcaption(block, env)}</figure>`, block, env);
    }

    const source = str(block.data, 'source');
    const label = str(block.data, 'service') || source;

    return trail(`<a${urlAttr('href', source)}>${env.escape(label)}</a>`, block, env);
  },

  table: emitTable,

  spacer: (block, env) => trail('<div aria-hidden="true"></div>', block, env),

  column_list: childrenDiv,
  columns: childrenDiv,
  column: childrenDiv,

  database: childrenOnly,
  'database-row': childrenOnly,
};

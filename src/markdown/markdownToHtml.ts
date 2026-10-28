import type {
  RootContent, List, ListItem, Table, TableRow, Code, Heading, Blockquote,
  PhrasingContent, Definition, FootnoteDefinition,
} from '../../types/data-formats/markdown-tree';
import { isSamePageLink } from '../tools/link/registry';
import { tokenizePrism } from '../tools/code/prism-loader';
import { normalizeFenceLang } from './fence-language';
import { renderLatex } from '../shared/katex';
import { safeHref, safeImageSrc } from '../components/utils/sanitize-url';
import { sanitizeBlockHtml } from './sanitize-html';
import { matchAlert } from './alerts';
import { isBareBreak } from './phrasing-to-html';
import { hasMathSignal } from './math-syntax';
import { parseMarkdown } from './engine';

/**
 * Per-render state. Markdown features like references and footnotes resolve a
 * node against definitions that live elsewhere in the tree, so the walker needs
 * document-level context the old per-node serializer lacked.
 */
interface RenderContext {
  definitions: Map<string, Definition>;
  footnoteDefs: Map<string, FootnoteDefinition>;
  footnoteOrder: string[];
  footnoteNumbers: Map<string, number>;
  slug: (text: string) => string;
  baseUrl?: string;
  backToContentLabel: string;
}

export interface MarkdownPreviewOptions {
  /** Source document URL, used to resolve relative URLs in raw HTML. */
  baseUrl?: string;
  /** Accessible label for each footnote backlink. */
  backToContentLabel?: string;
}

const DEFAULT_BACK_TO_CONTENT_LABEL = 'Back to content';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** GitHub-style heading slugger with `-N` disambiguation for duplicates. */
function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();

  return (text: string): string => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
    const count = seen.get(base) ?? 0;

    seen.set(base, count + 1);

    return count === 0 ? base : `${base}-${count}`;
  };
}

/** Flatten phrasing nodes to their plain-text content (for heading slugs). */
function textContent(nodes: PhrasingContent[]): string {
  return nodes.map((node) => {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'inlineMath') {
      return node.value;
    }
    if ('children' in node && Array.isArray(node.children)) {
      return textContent(node.children);
    }

    return '';
  }).join('');
}

/**
 * Render a Markdown string to a sanitized HTML string for inline preview.
 * Inline content is escaped and URLs validated. Block-level raw HTML is passed
 * through a strict allowlist (so README layout markup like a centred-logo
 * `<p><img></p>` renders) while inline raw HTML stays escaped. KaTeX, GFM
 * references, footnotes, and GitHub alerts are supported.
 */
export async function markdownToHtml(md: string, opts: MarkdownPreviewOptions = {}): Promise<string> {
  const tree = parseMarkdown(md, { math: hasMathSignal(md) });
  const children = tree.children;

  const ctx: RenderContext = {
    definitions: new Map(),
    footnoteDefs: new Map(),
    footnoteOrder: [],
    footnoteNumbers: new Map(),
    slug: createSlugger(),
    baseUrl: opts.baseUrl,
    backToContentLabel: opts.backToContentLabel ?? DEFAULT_BACK_TO_CONTENT_LABEL,
  };

  // Prepass: collect definitions and footnote definitions so references can
  // resolve against nodes that live elsewhere in the tree — including inside
  // a blockquote or list item, where the parser resolves them too.
  const collect = (nodes: RootContent[]): void => {
    for (const node of nodes) {
      if (node.type === 'definition') {
        ctx.definitions.set(node.identifier, node);
      } else if (node.type === 'footnoteDefinition') {
        ctx.footnoteDefs.set(node.identifier, node);
      }

      if ('children' in node) {
        collect(node.children);
      }
    }
  };

  collect(children);

  const body = await nodesToHtml(children, ctx);

  return body + await renderFootnotes(ctx);
}

async function nodesToHtml(nodes: RootContent[], ctx: RenderContext): Promise<string> {
  const parts = await Promise.all(nodes.map((node) => nodeToHtml(node, ctx)));

  return parts.join('');
}

async function nodeToHtml(node: RootContent, ctx: RenderContext): Promise<string> {
  if (node.type === 'heading') {
    return headingToHtml(node, ctx);
  }
  if (node.type === 'paragraph') {
    return `<p>${await phrasingToHtml(node.children, ctx)}</p>`;
  }
  if (node.type === 'thematicBreak') {
    return '<hr>';
  }
  if (node.type === 'blockquote') {
    return blockquoteToHtml(node, ctx);
  }
  if (node.type === 'list') {
    return listToHtml(node, ctx);
  }
  if (node.type === 'code') {
    return codeToHtml(node);
  }
  if (node.type === 'math') {
    return renderLatex(node.value, { displayMode: true });
  }
  if (node.type === 'table') {
    return tableToHtml(node, ctx);
  }
  if (node.type === 'html') {
    return sanitizeBlockHtml(node.value, ctx.baseUrl);
  }

  // `definition` and `footnoteDefinition` are handled in the prepass / trailer.
  return '';
}

async function headingToHtml(node: Heading, ctx: RenderContext): Promise<string> {
  const inner = await phrasingToHtml(node.children, ctx);
  const id = ctx.slug(textContent(node.children));

  return `<h${node.depth} id="${escapeHtml(id)}">${inner}</h${node.depth}>`;
}

async function blockquoteToHtml(node: Blockquote, ctx: RenderContext): Promise<string> {
  const alert = matchAlert(node);
  if (alert !== null) {
    const inner = await nodesToHtml(alert.children, ctx);
    const label = alert.kind.charAt(0).toUpperCase() + alert.kind.slice(1);

    return `<div class="blok-md-alert blok-md-alert-${alert.kind}">`
      + `<p class="blok-md-alert-title">${label}</p>${inner}</div>`;
  }

  return `<blockquote>${await nodesToHtml(node.children, ctx)}</blockquote>`;
}

async function listToHtml(list: List, ctx: RenderContext): Promise<string> {
  const tag = list.ordered ? 'ol' : 'ul';
  const start = list.ordered && list.start !== null && list.start !== 1
    ? ` start="${list.start}"`
    : '';
  const items = await Promise.all(list.children.map((item) => itemToHtml(item, ctx)));

  return `<${tag}${start}>${items.join('')}</${tag}>`;
}

async function itemToHtml(item: ListItem, ctx: RenderContext): Promise<string> {
  const inner = await nodesToHtml(item.children, ctx);
  if (item.checked === true || item.checked === false) {
    const checked = item.checked ? ' checked' : '';

    return `<li class="blok-md-task"><input type="checkbox" disabled${checked}>${inner}</li>`;
  }

  return `<li>${inner}</li>`;
}

async function codeToHtml(node: Code): Promise<string> {
  const lang = normalizeFenceLang(node.lang ?? '');
  if (lang !== null) {
    const highlighted = await tokenizePrism(node.value, lang);
    if (highlighted !== null) {
      return `<pre class="blok-code lang-${lang}"><code>${highlighted}</code></pre>`;
    }
  }

  return `<pre><code>${escapeHtml(node.value)}</code></pre>`;
}

async function tableToHtml(table: Table, ctx: RenderContext): Promise<string> {
  const [head, ...body] = table.children;
  const headHtml = head !== undefined
    ? `<thead><tr>${await cellsToHtml(head, 'th', ctx)}</tr></thead>`
    : '';
  const bodyRows = await Promise.all(body.map(async (row) => `<tr>${await cellsToHtml(row, 'td', ctx)}</tr>`));

  return `<table>${headHtml}<tbody>${bodyRows.join('')}</tbody></table>`;
}

async function cellsToHtml(row: TableRow, tag: 'th' | 'td', ctx: RenderContext): Promise<string> {
  const cells = await Promise.all(
    row.children.map(async (cell) => `<${tag}>${await phrasingToHtml(cell.children, ctx)}</${tag}>`),
  );

  return cells.join('');
}

/** Serialize inline (phrasing) nodes to an HTML string. */
async function phrasingToHtml(nodes: PhrasingContent[], ctx: RenderContext): Promise<string> {
  const parts = await Promise.all(nodes.map((node) => inlineToHtml(node, ctx)));

  return parts.join('');
}

async function inlineToHtml(node: PhrasingContent, ctx: RenderContext): Promise<string> {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);

    case 'strong':
      return `<strong>${await phrasingToHtml(node.children, ctx)}</strong>`;

    case 'emphasis':
      return `<i>${await phrasingToHtml(node.children, ctx)}</i>`;

    case 'delete':
      return `<s>${await phrasingToHtml(node.children, ctx)}</s>`;

    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;

    case 'break':
      return '<br>';

    case 'link': {
      const url = safeHref(node.url);
      const children = await phrasingToHtml(node.children, ctx);

      return url === null ? children : anchor(url, children);
    }

    case 'image':
      return imageHtml(node.url, node.alt);

    case 'linkReference': {
      // The parser only emits a reference whose definition exists, and the
      // prepass collected every definition, so `def` is always found.
      const def = ctx.definitions.get(node.identifier);
      const children = await phrasingToHtml(node.children, ctx);
      const url = def === undefined ? null : safeHref(def.url);

      return url === null ? children : anchor(url, children);
    }

    case 'imageReference': {
      const def = ctx.definitions.get(node.identifier);

      return def === undefined ? '' : imageHtml(def.url, node.alt);
    }

    case 'footnoteReference':
      return footnoteRef(node.identifier, ctx);

    case 'inlineMath':
      return renderLatex(node.value, { displayMode: false });

    case 'html':
      // Raw inline HTML is escaped, never rendered (XSS-safe preview). A bare
      // `<br>` is the exporter's line break inside headings and table cells.
      return isBareBreak(node.value) ? '<br>' : escapeHtml(node.value);

    default:
      return '';
  }
}

function anchor(url: string, children: string): string {
  const target = isSamePageLink(url) ? '_self' : '_blank';

  return `<a href="${escapeHtml(url)}" target="${target}" rel="noopener noreferrer nofollow">${children}</a>`;
}

function imageHtml(rawUrl: string, alt: string): string {
  const url = safeImageSrc(rawUrl);

  return url === null ? '' : `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`;
}

/** Register a footnote reference, returning its superscript marker. */
function footnoteRef(identifier: string, ctx: RenderContext): string {
  if (!ctx.footnoteNumbers.has(identifier)) {
    ctx.footnoteOrder.push(identifier);
    ctx.footnoteNumbers.set(identifier, ctx.footnoteOrder.length);
  }
  const num = ctx.footnoteNumbers.get(identifier);
  const id = escapeHtml(identifier);

  return `<sup class="blok-md-fnref" id="fnref-${id}"><a href="#fn-${id}">${num}</a></sup>`;
}

/** Render the footnotes trailer in reference order; omit if none were used. */
async function renderFootnotes(ctx: RenderContext): Promise<string> {
  if (ctx.footnoteOrder.length === 0) {
    return '';
  }
  const items = await Promise.all(ctx.footnoteOrder.map(async (identifier) => {
    const id = escapeHtml(identifier);
    const def = ctx.footnoteDefs.get(identifier);
    const inner = def !== undefined ? await nodesToHtml(def.children, ctx) : '';

    return `<li id="fn-${id}">${inner}`
      + `<a class="blok-md-fnback" href="#fnref-${id}" aria-label="${escapeHtml(ctx.backToContentLabel)}">↩</a></li>`;
  }));

  return `<section class="blok-md-footnotes"><hr><ol>${items.join('')}</ol></section>`;
}

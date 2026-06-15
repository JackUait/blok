import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Extension as MdastExtension } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Extension as MicromarkExtension } from 'micromark-util-types';
import type {
  RootContent, List, ListItem, Table, TableRow, Code, Heading, Blockquote,
  PhrasingContent, Definition, FootnoteDefinition,
} from 'mdast';
import { isHighlightable, tokenizePrism } from '../tools/code/prism-loader';
import { extToPrismLang } from '../tools/file/code-languages';
import { renderLatex } from '../tools/code/katex-loader';
import { safeHref, safeImageSrc } from '../components/utils/sanitize-url';

/**
 * Math mdast nodes (block `math`, `inlineMath`) come from mdast-util-math and
 * are not part of the base mdast type union, so we describe them locally and
 * widen the node types the walker accepts.
 */
interface MathNode {
  type: 'math' | 'inlineMath';
  value: string;
}
type BlockNode = RootContent | MathNode;
type InlineNode = PhrasingContent | MathNode;

/** Detects whether a document contains `$…$`/`$$…$$` worth loading KaTeX for. */
const MATH_SIGNAL = /\$\$[\s\S]+?\$\$|(?<!\$)\$(?!\$)(?=\S)[^$]+(?<=\S)\$(?!\$)/;

/** GitHub alert markers: `> [!NOTE]`, `[!WARNING]`, etc. */
const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

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
}

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
function textContent(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'inlineMath') {
      return node.value;
    }
    if ('children' in node && Array.isArray(node.children)) {
      return textContent(node.children as InlineNode[]);
    }

    return '';
  }).join('');
}

/**
 * Resolve a fenced-code language to a Prism id. A fence may use a canonical
 * Prism id (`javascript`) or a file extension / alias (`js`).
 */
function normalizeFenceLang(rawLang: string): string | null {
  if (rawLang === '') return null;
  if (isHighlightable(rawLang)) return rawLang;

  const mapped = extToPrismLang(rawLang);
  if (mapped !== null && isHighlightable(mapped)) return mapped;

  return null;
}

async function loadMathExtensions(): Promise<{
  mathSyntax: MicromarkExtension;
  mathFromMarkdown: MdastExtension;
}> {
  const [{ math }, { mathFromMarkdown }] = await Promise.all([
    import('micromark-extension-math'),
    import('mdast-util-math'),
  ]);

  return { mathSyntax: math(), mathFromMarkdown: mathFromMarkdown() };
}

/**
 * Render a Markdown string to a sanitized HTML string for inline preview.
 * Inline content is escaped and URLs validated; raw HTML nodes are escaped
 * (never rendered — the preview is a top-layer host-origin sink). KaTeX,
 * GFM references, footnotes, and GitHub alerts are supported.
 */
export async function markdownToHtml(md: string): Promise<string> {
  const extensions: Array<MicromarkExtension | MicromarkExtension[]> = [gfm()];
  const mdastExtensions: Array<MdastExtension | MdastExtension[]> = [gfmFromMarkdown()];

  if (MATH_SIGNAL.test(md)) {
    const { mathSyntax, mathFromMarkdown } = await loadMathExtensions();

    extensions.push(mathSyntax);
    mdastExtensions.push(mathFromMarkdown);
  }

  const tree = fromMarkdown(md, { extensions, mdastExtensions });
  const children = tree.children as BlockNode[];

  const ctx: RenderContext = {
    definitions: new Map(),
    footnoteDefs: new Map(),
    footnoteOrder: [],
    footnoteNumbers: new Map(),
    slug: createSlugger(),
  };

  // Prepass: collect definitions and footnote definitions so references can
  // resolve against nodes that live elsewhere in the tree.
  for (const node of children) {
    if (node.type === 'definition') {
      ctx.definitions.set(node.identifier, node);
    } else if (node.type === 'footnoteDefinition') {
      ctx.footnoteDefs.set(node.identifier, node);
    }
  }

  const body = await nodesToHtml(children, ctx);

  return body + await renderFootnotes(ctx);
}

async function nodesToHtml(nodes: BlockNode[], ctx: RenderContext): Promise<string> {
  const parts = await Promise.all(nodes.map((node) => nodeToHtml(node, ctx)));

  return parts.join('');
}

async function nodeToHtml(node: BlockNode, ctx: RenderContext): Promise<string> {
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
    return escapeHtml(node.value);
  }

  // `definition` and `footnoteDefinition` are handled in the prepass / trailer.
  return '';
}

async function headingToHtml(node: Heading, ctx: RenderContext): Promise<string> {
  const inner = await phrasingToHtml(node.children, ctx);
  const id = ctx.slug(textContent(node.children as InlineNode[]));

  return `<h${node.depth} id="${escapeHtml(id)}">${inner}</h${node.depth}>`;
}

async function blockquoteToHtml(node: Blockquote, ctx: RenderContext): Promise<string> {
  const alert = matchAlert(node);
  if (alert !== null) {
    const inner = await nodesToHtml(alert.children as BlockNode[], ctx);
    const label = alert.kind.charAt(0).toUpperCase() + alert.kind.slice(1);

    return `<div class="blok-md-alert blok-md-alert-${alert.kind}">`
      + `<p class="blok-md-alert-title">${label}</p>${inner}</div>`;
  }

  return `<blockquote>${await nodesToHtml(node.children as BlockNode[], ctx)}</blockquote>`;
}

/**
 * Detect a GitHub alert blockquote (`> [!NOTE]` on the first line) and return
 * the alert kind plus the blockquote children with the marker text stripped.
 */
function matchAlert(node: Blockquote): { kind: string; children: RootContent[] } | null {
  const [first] = node.children;
  if (first === undefined || first.type !== 'paragraph') {
    return null;
  }
  const [firstInline] = first.children;
  if (firstInline === undefined || firstInline.type !== 'text') {
    return null;
  }
  const match = ALERT_MARKER.exec(firstInline.value);
  if (match === null) {
    return null;
  }
  const kind = match[1].toLowerCase();
  if (!ALERT_KINDS.includes(kind as typeof ALERT_KINDS[number])) {
    return null;
  }

  // Strip the marker from the first text node; drop the node if it then becomes
  // empty (the marker sat on its own line followed by a hard break).
  const strippedValue = firstInline.value.slice(match[0].length).replace(/^\n+/, '');
  const restInline: PhrasingContent[] = strippedValue === ''
    ? first.children.slice(1).filter((c) => c.type !== 'break')
    : [{ ...firstInline, value: strippedValue }, ...first.children.slice(1)];

  const children: RootContent[] = restInline.length > 0
    ? [{ ...first, children: restInline }, ...node.children.slice(1)]
    : node.children.slice(1);

  return { kind, children };
}

async function listToHtml(list: List, ctx: RenderContext): Promise<string> {
  const tag = list.ordered === true ? 'ol' : 'ul';
  const start = list.ordered === true && list.start != null && list.start !== 1
    ? ` start="${list.start}"`
    : '';
  const items = await Promise.all(list.children.map((item) => itemToHtml(item, ctx)));

  return `<${tag}${start}>${items.join('')}</${tag}>`;
}

async function itemToHtml(item: ListItem, ctx: RenderContext): Promise<string> {
  const inner = await nodesToHtml(item.children as BlockNode[], ctx);
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
async function phrasingToHtml(nodes: InlineNode[], ctx: RenderContext): Promise<string> {
  const parts = await Promise.all(nodes.map((node) => inlineToHtml(node, ctx)));

  return parts.join('');
}

async function inlineToHtml(node: InlineNode, ctx: RenderContext): Promise<string> {
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
      return imageHtml(node.url, node.alt ?? '');

    case 'linkReference': {
      const def = ctx.definitions.get(node.identifier);
      const children = await phrasingToHtml(node.children, ctx);
      if (def === undefined) {
        return referenceFallback(node.label ?? node.identifier, children, false);
      }
      const url = safeHref(def.url);

      return url === null ? children : anchor(url, children);
    }

    case 'imageReference': {
      const def = ctx.definitions.get(node.identifier);
      const alt = node.alt ?? '';
      if (def === undefined) {
        return referenceFallback(node.label ?? node.identifier, escapeHtml(alt), true);
      }

      return imageHtml(def.url, alt);
    }

    case 'footnoteReference':
      return footnoteRef(node.identifier, ctx);

    case 'inlineMath':
      return renderLatex(node.value, { displayMode: false });

    case 'html':
      // Raw inline HTML is escaped, never rendered (XSS-safe preview).
      return escapeHtml(node.value);

    default:
      return '';
  }
}

function anchor(url: string, children: string): string {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${children}</a>`;
}

function imageHtml(rawUrl: string, alt: string): string {
  const url = safeImageSrc(rawUrl);

  return url === null ? '' : `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`;
}

/** A reference whose definition is missing renders as its literal source. */
function referenceFallback(label: string, children: string, isImage: boolean): string {
  const prefix = isImage ? '!' : '';

  return `${prefix}[${children}][${escapeHtml(label)}]`;
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
    const inner = def !== undefined ? await nodesToHtml(def.children as BlockNode[], ctx) : '';

    return `<li id="fn-${id}">${inner}`
      + `<a class="blok-md-fnback" href="#fnref-${id}" aria-label="Back to content">↩</a></li>`;
  }));

  return `<section class="blok-md-footnotes"><hr><ol>${items.join('')}</ol></section>`;
}

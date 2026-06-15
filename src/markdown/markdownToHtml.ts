import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { RootContent, List, ListItem, Table, TableRow, Code } from 'mdast';
import { phrasingToHtml } from './phrasing-to-html';
import { isHighlightable, tokenizePrism } from '../tools/code/prism-loader';
import { extToPrismLang } from '../tools/file/code-languages';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolve a fenced-code language to a Prism id that `tokenizePrism` understands.
 * A fence may use either a canonical Prism id (`javascript`) or a common file
 * extension / alias (`js`). Try the raw value first, then fall back to the
 * extension→Prism mapping. Returns null when no highlightable id is found.
 */
function normalizeFenceLang(rawLang: string): string | null {
  if (rawLang === '') return null;
  if (isHighlightable(rawLang)) return rawLang;

  const mapped = extToPrismLang(rawLang);
  if (mapped !== null && isHighlightable(mapped)) return mapped;

  return null;
}

/**
 * Render a Markdown string to a sanitized HTML string for inline preview.
 * Inline content goes through phrasingToHtml (escapes text, validates URLs);
 * raw HTML nodes are escaped. Fenced code is Prism-highlighted when the
 * language is known, otherwise emitted as escaped plain text.
 */
export async function markdownToHtml(md: string): Promise<string> {
  const tree = fromMarkdown(md, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  return nodesToHtml(tree.children);
}

async function nodesToHtml(nodes: RootContent[]): Promise<string> {
  const parts = await Promise.all(nodes.map(nodeToHtml));

  return parts.join('');
}

async function nodeToHtml(node: RootContent): Promise<string> {
  switch (node.type) {
    case 'heading':
      return `<h${node.depth}>${phrasingToHtml(node.children)}</h${node.depth}>`;
    case 'paragraph':
      return `<p>${phrasingToHtml(node.children)}</p>`;
    case 'thematicBreak':
      return '<hr>';
    case 'blockquote':
      return `<blockquote>${await nodesToHtml(node.children as RootContent[])}</blockquote>`;
    case 'list':
      return listToHtml(node);
    case 'code':
      return codeToHtml(node);
    case 'table':
      return tableToHtml(node);
    case 'html':
      return escapeHtml(node.value);
    default:
      return '';
  }
}

async function listToHtml(list: List): Promise<string> {
  const tag = list.ordered === true ? 'ol' : 'ul';
  const start = list.ordered === true && list.start != null && list.start !== 1
    ? ` start="${list.start}"`
    : '';
  const items = await Promise.all(list.children.map(itemToHtml));

  return `<${tag}${start}>${items.join('')}</${tag}>`;
}

async function itemToHtml(item: ListItem): Promise<string> {
  const inner = await nodesToHtml(item.children as RootContent[]);
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

function tableToHtml(table: Table): string {
  const [head, ...body] = table.children;
  const headHtml = head !== undefined
    ? `<thead><tr>${cellsToHtml(head, 'th')}</tr></thead>`
    : '';
  const bodyHtml = body.map(row => `<tr>${cellsToHtml(row, 'td')}</tr>`).join('');

  return `<table>${headHtml}<tbody>${bodyHtml}</tbody></table>`;
}

function cellsToHtml(row: TableRow, tag: 'th' | 'td'): string {
  return row.children.map(cell => `<${tag}>${phrasingToHtml(cell.children)}</${tag}>`).join('');
}

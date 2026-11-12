import type { Definition, PhrasingContent } from '../../types/data-formats/markdown-tree';
import { safeHref, safeImageSrc } from '../components/utils/sanitize-url';
import { isSamePageLink } from '../tools/link/registry';
import { PAGE_REFERENCE_ATTR, PAGE_REFERENCE_FALLBACK } from '../shared/page-reference';

/**
 * Link and image definitions in scope for a document, keyed by mdast
 * `identifier` (already case-folded by the parser).
 */
export type DefinitionMap = ReadonlyMap<string, Definition>;

/** The page a link points at, when the host knows it. Such a link becomes the page's mention. */
export type PageIdFor = (url: string) => string | undefined;

/**
 * Whether raw inline HTML is exactly `<br>`, `<br/>` or `<br />`. Anchored and
 * attribute-free, so nothing else slips past the escaping.
 * @param html - the raw HTML node's value
 */
export const isBareBreak = (html: string): boolean => /^<br\s*\/?>$/i.test(html);

/**
 * An optional text field, read as '' when missing. The parser always fills
 * `alt` and math values, but a toolMap `children` hook may hand `convert()`
 * nodes it built itself, where mdast leaves them optional.
 * @param value - the field as found on the node
 */
export const orEmpty = (value: string | undefined): string => value ?? '';

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serialize an array of mdast phrasing (inline) nodes to an HTML string.
 * Produces the HTML that Blok stores in block `text` fields.
 *
 * `definitions` is required rather than defaulted: a reference resolved against
 * an empty map degrades to literal text, so a forgotten recursive call would
 * silently drop links instead of failing the build.
 *
 * @param nodes - phrasing nodes to serialize
 * @param definitions - definitions the document's references resolve against
 * @param pageIdFor - turns a link to a page the host knows into that page's mention
 */
export function phrasingToHtml(nodes: PhrasingContent[], definitions: DefinitionMap, pageIdFor?: PageIdFor): string {
  return nodes.map((node) => serializeNode(node, definitions, pageIdFor)).join('');
}

function serializeNode(node: PhrasingContent, definitions: DefinitionMap, pageIdFor?: PageIdFor): string {
  const inner = (children: PhrasingContent[]): string => phrasingToHtml(children, definitions, pageIdFor);

  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);

    case 'strong':
      return `<strong>${inner(node.children)}</strong>`;

    case 'emphasis':
      return `<i>${inner(node.children)}</i>`;

    case 'delete':
      return `<s>${inner(node.children)}</s>`;

    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;

    case 'link': {
      const url = safeHref(node.url);
      const children = inner(node.children);

      // Unsafe scheme → drop the anchor, keep the visible text.
      return url === null ? children : linkHtml(url, children, pageIdFor);
    }

    case 'linkReference': {
      const definition = definitions.get(node.identifier);
      const children = inner(node.children);

      if (definition === undefined) {
        return referenceFallback(node.label ?? node.identifier, children, false);
      }

      const url = safeHref(definition.url);

      return url === null ? children : linkHtml(url, children, pageIdFor);
    }

    case 'break':
      return '<br>';

    case 'image':
      return imageHtml(node.url, orEmpty(node.alt));

    case 'imageReference': {
      const definition = definitions.get(node.identifier);
      const alt = orEmpty(node.alt);

      if (definition === undefined) {
        return referenceFallback(node.label ?? node.identifier, escapeHtml(alt), true);
      }

      return imageHtml(definition.url, alt);
    }

    case 'html':
      // Raw inline HTML from the source is not sanitized downstream (markdown
      // paste bypasses the paste sanitizer), so escape it the same way
      // block-level raw HTML is escaped in mdast-to-blocks. Only an
      // attribute-free `<br>` passes: the exporter writes it where Markdown
      // has no hard break (headings, table cells).
      return isBareBreak(node.value) ? '<br>' : escapeHtml(node.value);

    case 'inlineMath': {
      // The equation sanitizer rewrites the span's text to its source, so they must match.
      const latex = escapeHtml(orEmpty(node.value));

      return `<span data-latex="${latex}">${latex}</span>`;
    }

    case 'footnoteReference':
      return '';

    default:
      return '';
  }
}

/** Where an imported link opens: same-page anchors stay in the window. */
export const linkTarget = (url: string): string => (isSamePageLink(url) ? '_self' : '_blank');

function linkHtml(url: string, children: string, pageIdFor?: PageIdFor): string {
  const pageId = pageIdFor?.(url);

  // The mention shows the page's own title, so the link text goes.
  return pageId === undefined ? anchor(url, children) : `<a ${PAGE_REFERENCE_ATTR}="${escapeHtml(pageId)}">${PAGE_REFERENCE_FALLBACK}</a>`;
}

function anchor(url: string, children: string): string {
  return `<a href="${escapeHtml(url)}" target="${linkTarget(url)}" rel="noopener noreferrer nofollow">${children}</a>`;
}

/** Unsafe scheme → drop the image entirely. */
function imageHtml(rawUrl: string, alt: string): string {
  const url = safeImageSrc(rawUrl);

  return url === null ? '' : `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`;
}

/** A reference whose definition is missing renders as its literal source. */
function referenceFallback(label: string, children: string, isImage: boolean): string {
  const prefix = isImage ? '!' : '';

  return `${prefix}[${children}][${escapeHtml(label)}]`;
}

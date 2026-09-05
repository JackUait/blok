import type { Definition, PhrasingContent } from 'mdast';
import { safeHref, safeImageSrc } from '../components/utils/sanitize-url';
import { isSamePageLink } from '../tools/link/registry';

/**
 * Link and image definitions in scope for a document, keyed by mdast
 * `identifier` (already case-folded by the parser).
 */
export type DefinitionMap = ReadonlyMap<string, Definition>;

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
 */
export function phrasingToHtml(nodes: PhrasingContent[], definitions: DefinitionMap): string {
  return nodes.map((node) => serializeNode(node, definitions)).join('');
}

function serializeNode(node: PhrasingContent, definitions: DefinitionMap): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);

    case 'strong':
      return `<strong>${phrasingToHtml(node.children, definitions)}</strong>`;

    case 'emphasis':
      return `<i>${phrasingToHtml(node.children, definitions)}</i>`;

    case 'delete':
      return `<s>${phrasingToHtml(node.children, definitions)}</s>`;

    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;

    case 'link': {
      const url = safeHref(node.url);
      const children = phrasingToHtml(node.children, definitions);

      // Unsafe scheme → drop the anchor, keep the visible text.
      return url === null ? children : anchor(url, children);
    }

    case 'linkReference': {
      const definition = definitions.get(node.identifier);
      const children = phrasingToHtml(node.children, definitions);

      if (definition === undefined) {
        return referenceFallback(node.label ?? node.identifier, children, false);
      }

      const url = safeHref(definition.url);

      return url === null ? children : anchor(url, children);
    }

    case 'break':
      return '<br>';

    case 'image':
      return imageHtml(node.url, node.alt ?? '');

    case 'imageReference': {
      const definition = definitions.get(node.identifier);
      const alt = node.alt ?? '';

      if (definition === undefined) {
        return referenceFallback(node.label ?? node.identifier, escapeHtml(alt), true);
      }

      return imageHtml(definition.url, alt);
    }

    case 'html':
      // Raw inline HTML from the source is not sanitized downstream (markdown
      // paste bypasses the paste sanitizer), so escape it the same way
      // block-level raw HTML is escaped in mdast-to-blocks.
      return escapeHtml(node.value);

    case 'inlineMath':
    case 'footnoteReference':
      return '';

    default:
      return '';
  }
}

function anchor(url: string, children: string): string {
  const target = isSamePageLink(url) ? '_self' : '_blank';

  return `<a href="${escapeHtml(url)}" target="${target}" rel="noopener noreferrer nofollow">${children}</a>`;
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

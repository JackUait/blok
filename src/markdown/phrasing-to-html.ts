import type { PhrasingContent } from 'mdast';
import { safeHref, safeImageSrc } from '../components/utils/sanitize-url';
import { isSamePageLink } from '../tools/link/registry';

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
 */
export function phrasingToHtml(nodes: PhrasingContent[]): string {
  return nodes.map(serializeNode).join('');
}

function serializeNode(node: PhrasingContent): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);

    case 'strong':
      return `<strong>${phrasingToHtml(node.children)}</strong>`;

    case 'emphasis':
      return `<i>${phrasingToHtml(node.children)}</i>`;

    case 'delete':
      return `<s>${phrasingToHtml(node.children)}</s>`;

    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;

    case 'link': {
      const url = safeHref(node.url);
      const children = phrasingToHtml(node.children);

      // Unsafe scheme → drop the anchor, keep the visible text.
      if (url === null) {
        return children;
      }

      const target = isSamePageLink(url) ? '_self' : '_blank';

      return `<a href="${escapeHtml(url)}" target="${target}" rel="noopener noreferrer nofollow">${children}</a>`;
    }

    case 'break':
      return '<br>';

    case 'image': {
      const url = safeImageSrc(node.url);

      // Unsafe scheme → drop the image entirely.
      if (url === null) {
        return '';
      }

      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(node.alt ?? '')}">`;
    }

    case 'html':
      // Raw inline HTML from the source is not sanitized downstream (markdown
      // paste bypasses the paste sanitizer), so escape it the same way
      // block-level raw HTML is escaped in mdast-to-blocks.
      return escapeHtml(node.value);

    case 'inlineMath':
    case 'footnoteReference':
    case 'imageReference':
    case 'linkReference':
      return '';

    default:
      return '';
  }
}

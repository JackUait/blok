import type { PhrasingContent } from 'mdast';

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
 * URL schemes that can execute script when used in href/src.
 * Markdown output is inserted without going through the paste sanitizer,
 * so these must be filtered here at the source.
 */
const UNSAFE_URL_SCHEME = /^\s*(?:javascript\s*:|vbscript\s*:|data\s*:\s*text\s*\/\s*html)/i;

/**
 * Returns the URL when it is safe to use in an href/src, otherwise null.
 */
function safeUrl(url: string): string | null {
  return UNSAFE_URL_SCHEME.test(url) ? null : url;
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
      const url = safeUrl(node.url);
      const children = phrasingToHtml(node.children);

      // Unsafe scheme → drop the anchor, keep the visible text.
      if (url === null) {
        return children;
      }

      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${children}</a>`;
    }

    case 'break':
      return '<br>';

    case 'image': {
      const url = safeUrl(node.url);

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

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

    case 'link':
      return `<a href="${escapeHtml(node.url)}" target="_blank" rel="nofollow">${phrasingToHtml(node.children)}</a>`;

    case 'break':
      return '<br>';

    case 'image':
      return `<img src="${escapeHtml(node.url)}" alt="${escapeHtml(node.alt ?? '')}">`;

    case 'html':
      return node.value;

    default:
      return '';
  }
}

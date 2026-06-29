/**
 * Serialize Blok blocks to Markdown text.
 *
 * This is the inverse of the Markdown import pipeline (mdast-to-blocks) and is
 * used for the `text/plain` clipboard flavor so copied content carries Markdown
 * (headings as `#`, bold as `**`, lists as `-`, …) instead of stripped plain
 * text — matching how Notion serializes blocks on copy.
 */

import type { BlockToolData } from '../../types';

export interface SerializableBlock {
  tool: string;
  data: BlockToolData;
  /**
   * Structural nesting depth (the parentId chain length), applied as leading
   * indentation so a Tab/drag-nested block serializes nested instead of flat —
   * matching Notion's Markdown export. Used for EVERY tool, including `list`:
   * list nesting is structural now, so its indent comes from here (with a
   * fallback to the legacy flat `data.depth` for imported lists that have no
   * structural parent yet).
   */
  indent?: number;
}

/** Number of spaces used per nesting level for list items. */
const LIST_INDENT = '    ';

/**
 * Convert a fragment of inline HTML (a block's `text`) into inline Markdown.
 * Walks the DOM so nested marks (e.g. bold inside a link) serialize correctly.
 *
 * @param html - inline HTML string
 * @returns inline Markdown
 */
const inlineHtmlToMarkdown = (html: string): string => {
  const container = document.createElement('div');

  container.innerHTML = html ?? '';

  return serializeChildren(container);
};

/**
 * Serialize all child nodes of an element to inline Markdown.
 *
 * @param node - parent node
 * @returns concatenated inline Markdown of the children
 */
const serializeChildren = (node: Node): string =>
  Array.from(node.childNodes).map(serializeInlineNode).join('');

/**
 * Coerce an unknown value to a string, treating non-strings as empty. Block data
 * values are typed loosely, so this guards against stringifying objects.
 *
 * @param value - value to coerce
 * @returns the string value, or '' when not a string
 */
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Serialize a single inline DOM node to Markdown.
 *
 * @param node - the node to serialize
 * @returns inline Markdown for the node
 */
const serializeInlineNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const inner = serializeChildren(element);

  switch (element.tagName.toLowerCase()) {
    case 'br':
      return '\n';
    case 'b':
    case 'strong':
      return inner.trim() === '' ? inner : `**${inner}**`;
    case 'i':
    case 'em':
      return inner.trim() === '' ? inner : `*${inner}*`;
    case 'code':
      return inner.trim() === '' ? inner : `\`${inner}\``;
    case 's':
    case 'del':
    case 'strike':
      return inner.trim() === '' ? inner : `~~${inner}~~`;
    case 'a': {
      const href = element.getAttribute('href');

      return href ? `[${inner}](${href})` : inner;
    }
    default:
      return inner;
  }
};

/**
 * Strip HTML to its text content (used for code blocks, where Markdown is literal).
 *
 * @param html - HTML string
 * @returns plain text
 */
const htmlToText = (html: string): string => {
  const container = document.createElement('div');

  container.innerHTML = html ?? '';

  return container.textContent ?? '';
};

/**
 * Serialize a single block to a Markdown line (or fenced block).
 *
 * @param block - the block to serialize
 * @returns Markdown for the block
 */
const blockToMarkdown = (block: SerializableBlock): string => {
  const { data } = block;
  const text = inlineHtmlToMarkdown(asString(data.text));

  switch (block.tool) {
    case 'list': {
      // List nesting is structural (parentId chain), carried in `indent` —
      // consistent with how Tab-nested text/headers serialize. Fall back to the
      // legacy flat `data.depth` for imported lists that have no structural parent
      // yet, so their indentation survives a copy-as-markdown.
      const structuralDepth = Math.max(Number(block.indent ?? 0), 0);
      const flatDepth = Math.max(Number(data.depth ?? 0), 0);
      const indent = LIST_INDENT.repeat(structuralDepth > 0 ? structuralDepth : flatDepth);

      if (data.style === 'ordered') {
        return `${indent}1. ${text}`;
      }

      if (data.style === 'checklist') {
        return `${indent}- [${data.checked ? 'x' : ' '}] ${text}`;
      }

      return `${indent}- ${text}`;
    }
    default:
      break;
  }

  // Flat Tab-indent applies to every non-list block so nested paragraphs,
  // headers and quotes serialize indented instead of flattened.
  const flatIndent = LIST_INDENT.repeat(Math.max(Number(block.indent ?? 0), 0));

  switch (block.tool) {
    case 'header': {
      const level = Math.min(Math.max(Number(data.level) || 1, 1), 6);

      return `${flatIndent}${'#'.repeat(level)} ${text}`;
    }
    case 'quote':
      return `${flatIndent}> ${text}`;
    case 'code':
      return `${flatIndent}\`\`\`\n${htmlToText(asString(data.code) || asString(data.text))}\n\`\`\``;
    case 'divider':
      return `${flatIndent}---`;
    default:
      return `${flatIndent}${text}`;
  }
};

/**
 * Serialize an ordered list of blocks to a single Markdown string.
 *
 * Consecutive list items are joined with single newlines (a tight list); all
 * other block boundaries use a blank line.
 *
 * @param blocks - blocks to serialize, in document order
 * @returns Markdown string
 */
export const blocksToMarkdown = (blocks: SerializableBlock[]): string => {
  return blocks.reduce((out, block, index) => {
    const markdown = blockToMarkdown(block);

    if (index === 0) {
      return markdown;
    }

    const previous = blocks[index - 1];
    const separator = previous.tool === 'list' && block.tool === 'list' ? '\n' : '\n\n';

    return out + separator + markdown;
  }, '');
};

/**
 * Parses pasted table-cell HTML into block inserts.
 *
 * Cell content arriving through Table.onPaste is a sanitized HTML string that
 * may still carry block-level structure — `<ul>/<ol>/<li>` (kept by the paste
 * sanitizer) and `<p>` boundaries. Flattening it into `<br>`-split paragraphs
 * (the old behavior) silently destroys list items, so this walker emits a
 * proper block per structural element instead: list items become `list`
 * blocks (style/depth/checked preserved), everything else becomes paragraphs.
 */
import {
  detectStyleFromPastedContent,
  extractDepthFromPastedContent,
  extractPastedContent,
} from '../list/paste-handler';
import type { ListItemStyle } from '../list/types';

export type CellBlockInsert =
  | { tool: 'paragraph'; data: { text: string } }
  | { tool: 'list'; data: { text: string; style: ListItemStyle; checked: boolean; depth: number } };

const BR_SPLIT_RE = /<br\s*\/?>/i;
const TRAILING_BR_RE = /(?:<br\s*\/?>|\s)+$/i;

const splitInlineSegments = (html: string): string[] =>
  html.split(BR_SPLIT_RE).map(segment => segment.trim()).filter(Boolean);

const isListElement = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL');

/**
 * Convert every `<li>` of a pasted list element (nested lists included, both
 * in-place and hoisted-to-sibling shapes) into `list` block inserts.
 *
 * @param list - the `<ul>`/`<ol>` element, still attached to the cell wrapper
 *   so style detection (parent tag) and depth (aria-level / ancestor count)
 *   see the real context
 */
const listElementToInserts = (list: HTMLElement): CellBlockInsert[] =>
  Array.from(list.querySelectorAll('li')).map(li => {
    const style = detectStyleFromPastedContent(li, list.tagName === 'OL' ? 'ordered' : 'unordered');
    const depth = extractDepthFromPastedContent(li);

    // Nested lists inside the item are emitted as their own inserts by the
    // querySelectorAll walk — strip them from this item's text.
    const clone = li.cloneNode(true) as HTMLElement;

    clone.querySelectorAll('ul, ol').forEach(nested => nested.remove());

    const { text, checked } = extractPastedContent(clone);

    return {
      tool: 'list' as const,
      data: { text: text.replace(TRAILING_BR_RE, '').trim(), style, checked, depth },
    };
  });

/**
 * Parse a pasted cell's HTML into ordered block inserts.
 *
 * @param html - the sanitized cell innerHTML captured by parsePastedTable
 */
export const parseCellContentToBlocks = (html: string): CellBlockInsert[] => {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = html;

  const inserts: CellBlockInsert[] = [];
  const inlineParts: string[] = [];

  const flushInline = (): void => {
    splitInlineSegments(inlineParts.join('')).forEach(text => inserts.push({ tool: 'paragraph', data: { text } }));
    inlineParts.length = 0;
  };

  for (const node of Array.from(wrapper.childNodes)) {
    if (isListElement(node)) {
      flushInline();
      inserts.push(...listElementToInserts(node));
    } else if (node instanceof HTMLElement && node.tagName === 'P') {
      flushInline();
      inlineParts.push(node.innerHTML);
      flushInline();
    } else {
      inlineParts.push(node instanceof HTMLElement ? node.outerHTML : (node.textContent ?? ''));
    }
  }

  flushInline();

  return inserts.length > 0 ? inserts : [{ tool: 'paragraph', data: { text: '' } }];
};

interface SerializableCellBlock {
  tool: string;
  data: Record<string, unknown>;
}

const isSerializableListBlock = (block: SerializableCellBlock): boolean =>
  block.tool === 'list' && typeof block.data.text === 'string';

const listItemHtml = (data: Record<string, unknown>): string => {
  const depth = typeof data.depth === 'number' ? data.depth : 0;
  const text = typeof data.text === 'string' ? data.text : '';
  const checkbox = data.style === 'checklist'
    ? `<input type="checkbox"${data.checked === true ? ' checked' : ''}>`
    : '';

  return `<li aria-level="${depth + 1}">${checkbox}${text}</li>`;
};

/**
 * Serialize a cell's blocks back into HTML that {@link parseCellContentToBlocks}
 * reconstructs losslessly: paragraph runs join with `<br>`, list runs become
 * `<ul>`/`<ol>` whose items carry depth as `aria-level` and checklist state as
 * a checkbox input. Used when cell blocks must travel through the text-only
 * cell-content channel (e.g. clipboard payload → new table data) — without
 * this, list blocks inside copied cells silently flatten to plain text.
 *
 * @param blocks - the cell's blocks as `{tool, data}` pairs
 */
export const serializeCellBlocksToHtml = (blocks: SerializableCellBlock[]): string => {
  const parts: string[] = [];
  const paragraphRun: string[] = [];
  const listRun: SerializableCellBlock[] = [];

  const flushParagraphs = (): void => {
    if (paragraphRun.length > 0) {
      parts.push(paragraphRun.join('<br>'));
      paragraphRun.length = 0;
    }
  };

  const flushList = (): void => {
    if (listRun.length === 0) {
      return;
    }

    const tag = listRun[0].data.style === 'ordered' ? 'ol' : 'ul';

    parts.push(`<${tag}>${listRun.map(block => listItemHtml(block.data)).join('')}</${tag}>`);
    listRun.length = 0;
  };

  for (const block of blocks) {
    if (!isSerializableListBlock(block)) {
      flushList();
      paragraphRun.push(typeof block.data.text === 'string' ? block.data.text : '');
      continue;
    }

    flushParagraphs();

    // Ordered and unordered/checklist items live in different list elements
    // so the parser's parent-tag style detection reconstructs each style.
    const runIsOrdered = listRun[0]?.data.style === 'ordered';
    const blockIsOrdered = block.data.style === 'ordered';

    if (listRun.length > 0 && runIsOrdered !== blockIsOrdered) {
      flushList();
    }

    listRun.push(block);
  }

  flushParagraphs();
  flushList();

  return parts.join('');
};

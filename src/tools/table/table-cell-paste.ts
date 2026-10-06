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
import { trimTrailingBreaks } from '../../components/utils/trailing-breaks';
import { CELL_CODE_TAG } from '../../components/modules/paste/constants';
import { parseUntrustedHtml } from '../../components/utils/inert-html';

export type CellBlockInsert =
  | { tool: 'paragraph'; data: { text: string } }
  | { tool: 'list'; data: { text: string; style: ListItemStyle; checked: boolean; depth: number } }
  | { tool: 'code'; data: { code: string } };

/** Block tags the parser below reads, with the attributes it reads. */
export const CELL_BLOCK_TAGS_SANITIZE = {
  ul: true,
  ol: true,
  li: { style: true, 'aria-level': true, 'data-list-style': true },
  input: { type: true, checked: true },
  // Each <p>/<div> is a separate paragraph to the parser; stripped, lines glue together.
  p: {},
  div: {},
};

const BR_SPLIT_RE = /<br\s*\/?>/i;

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
      data: { text: trimTrailingBreaks(text).trim(), style, checked, depth },
    };
  });

/**
 * Rows of the outermost table(s) under `root`, in document order. A nested
 * table's rows are descendants too and would otherwise read as outer rows.
 */
export const ownPastedRows = (root: Element): Element[] =>
  Array.from(root.querySelectorAll('tr')).filter(row => {
    const outer = row.closest('table')?.parentElement?.closest('table');

    return outer === null || outer === undefined || !root.contains(outer);
  });

/** A pasted row's own TD/TH cells (not those of a table nested in a cell). */
export const ownPastedCells = (row: Element): Element[] =>
  Array.from(row.children).filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH');

/** A `<pre>`'s text with each `<br>` read as a newline, as the code tool reads it. */
const preText = (pre: HTMLElement): string => {
  const copy = pre.cloneNode(true) as HTMLElement;

  copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

  return copy.textContent ?? '';
};

const CELL_TEXT_BLOCKS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']
  .flatMap(tag => [`td ${tag}`, `th ${tag}`])
  .join(', ');

/**
 * A cell holds no header or quote block, and sanitizers unwrap them with no
 * boundary, gluing them to the next text. Swap each for its content between
 * `<br>`s so it parses as its own paragraph; the parser drops the empty runs.
 *
 * @param root - holds the table(s), or is a cell itself
 */
export const unwrapCellHeadingsAndQuotes = (root: Element): void => {
  for (const el of Array.from(root.querySelectorAll(CELL_TEXT_BLOCKS))) {
    const doc = el.ownerDocument;

    el.replaceWith(doc.createElement('br'), ...Array.from(el.childNodes), doc.createElement('br'));
  }
};

/**
 * Ready a pasted table's cells for the paste sanitizer: swap each `<pre>` for
 * {@link CELL_CODE_TAG} so it is kept, and see {@link unwrapCellHeadingsAndQuotes}.
 * Runs on raw clipboard HTML, before that sanitizer.
 */
export const protectPastedCellBlocks = (html: string): string => {
  const wrapper = parseUntrustedHtml(html);
  const pres = wrapper.querySelectorAll<HTMLElement>('td pre, th pre');
  const textBlocks = wrapper.querySelector(CELL_TEXT_BLOCKS);

  if (pres.length === 0 && textBlocks === null) {
    return html;
  }

  unwrapCellHeadingsAndQuotes(wrapper);

  pres.forEach(pre => {
    const stand = pre.ownerDocument.createElement(CELL_CODE_TAG);

    stand.textContent = preText(pre);
    pre.replaceWith(stand);
  });

  return wrapper.innerHTML;
};

const isCodeElement = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && (node.tagName === 'PRE' || node.tagName === CELL_CODE_TAG.toUpperCase());

const nodesToInserts = (nodes: Node[]): CellBlockInsert[] => {
  const inserts: CellBlockInsert[] = [];
  const inlineParts: string[] = [];

  const flushInline = (): void => {
    splitInlineSegments(inlineParts.join('')).forEach(text => inserts.push({ tool: 'paragraph', data: { text } }));
    inlineParts.length = 0;
  };

  for (const node of nodes) {
    if (isListElement(node)) {
      flushInline();
      inserts.push(...listElementToInserts(node));
    } else if (node instanceof HTMLElement && (node.tagName === 'P' || node.tagName === 'DIV')) {
      flushInline();
      inlineParts.push(node.innerHTML);
      flushInline();
    } else if (isCodeElement(node)) {
      flushInline();
      inserts.push({ tool: 'code', data: { code: preText(node) } });
    } else if (node instanceof HTMLElement && node.tagName === 'TABLE') {
      // A cell cannot hold a table: each nested cell becomes its own blocks.
      // Inline, its cells' text would glue into one run.
      flushInline();
      ownPastedRows(node).flatMap(ownPastedCells).forEach(cell => inserts.push(...nodesToInserts(Array.from(cell.childNodes))));
    } else {
      inlineParts.push(node instanceof HTMLElement ? node.outerHTML : (node.textContent ?? ''));
    }
  }

  flushInline();

  return inserts;
};

/**
 * Paragraph text for a cell block whose tool is not registered, so a missing
 * tool degrades to text instead of losing the content.
 */
export const cellBlockFallbackText = (data: Record<string, unknown>): string => {
  if (typeof data.text === 'string') {
    return data.text;
  }

  if (typeof data.code !== 'string') {
    return '';
  }

  const escaper = document.createElement('div');

  escaper.textContent = data.code;

  return escaper.innerHTML.replace(/\n/g, '<br>');
};

/**
 * Parse a pasted cell's HTML into ordered block inserts.
 *
 * @param html - the sanitized cell innerHTML captured by parsePastedTable
 */
export const parseCellContentToBlocks = (html: string): CellBlockInsert[] => {
  const wrapper = parseUntrustedHtml(html);
  const inserts = nodesToInserts(Array.from(wrapper.childNodes));

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

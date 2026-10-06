import { createIdGenerator } from './id-generator';
import { normalizeInlineImages } from '../../../components/modules/normalizeInlineImages';
import { mapToNearestPresetName } from '../../../components/utils/color-mapping';
import { isDefaultDarkBackground, isDefaultWhiteBackground } from '../../../components/utils/default-page-colors';
import { mapPastedTableCells } from '../../../tools/table/table-operations';
import {
  ownPastedCells,
  ownPastedRows,
  parseCellContentToBlocks,
  unwrapCellHeadingsAndQuotes,
} from '../../../tools/table/table-cell-paste';
import { pastedGridDirection, readPastedCell } from '../../../tools/table/table-cell-clipboard';
import type { TextDirection } from '../../../components/utils/direction';
import type { OutputBlockData } from './types';

/**
 * Walk the wrapper's top-level children and convert each block-level HTML
 * element into one or more Blok JSON blocks.
 */
export function buildBlocks(wrapper: HTMLElement): OutputBlockData[] {
  const nextId = createIdGenerator();
  const blocks: OutputBlockData[] = [];

  for (const node of Array.from(wrapper.childNodes)) {
    convertNode(node, blocks, nextId);
  }

  return extractCellImages(blocks);
}

/**
 * Splits images out of table cell paragraphs, as the editor's save does.
 * The CLI never runs that save, so without this the image stays inline.
 */
function extractCellImages(blocks: OutputBlockData[]): OutputBlockData[] {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const shapes = blocks.map((block) => ({
    id: block.id,
    tool: block.type,
    data: block.data,
    parentId: block.parent,
    contentIds: block.content,
    isValid: true,
  }));
  const normalized = normalizeInlineImages(shapes);

  if (normalized === shapes) {
    return blocks;
  }

  const untouched = new Set(shapes);

  return normalized.map((shape) => {
    const source = byId.get(shape.id);

    if (source !== undefined && untouched.has(shape)) {
      return source;
    }

    return {
      ...(source ?? { id: shape.id, type: shape.tool, parent: shape.parentId }),
      data: shape.data,
      // A CLI table has no content list: cells name their children.
      ...(source?.content !== undefined ? { content: shape.contentIds } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function convertNode(
  node: Node,
  blocks: OutputBlockData[],
  nextId: (prefix: string) => string
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? '';

    if (text) {
      blocks.push({ id: nextId('paragraph'), type: 'paragraph', data: { text } });
    }

    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const el = node as HTMLElement;
  const tag = el.tagName;

  if (tag === 'P') {
    blocks.push({ id: nextId('paragraph'), type: 'paragraph', data: { text: el.innerHTML } });

    return;
  }

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag[1]);

    blocks.push({ id: nextId('header'), type: 'header', data: { text: el.innerHTML, level } });

    return;
  }

  if (tag === 'BLOCKQUOTE') {
    blocks.push({
      id: nextId('quote'),
      type: 'quote',
      data: { text: el.innerHTML, size: 'default' },
    });

    return;
  }

  if (tag === 'PRE') {
    blocks.push({
      id: nextId('code'),
      type: 'code',
      data: { code: el.textContent ?? '', language: 'plain-text' },
    });

    return;
  }

  if (tag === 'HR') {
    blocks.push({ id: nextId('divider'), type: 'divider', data: {} });

    return;
  }

  if (tag === 'IMG') {
    const src = el.getAttribute('src') ?? '';
    const alt = el.getAttribute('alt') ?? '';
    const width = parseIntFromStyle(el, 'width');

    blocks.push({
      id: nextId('image'),
      type: 'image',
      data: alt !== '' ? { url: src, alt } : { url: src },
      stretched: null,
      key: null,
      width,
    });

    return;
  }

  if (tag === 'DETAILS') {
    const summary = el.querySelector('summary');
    const text = summary ? summary.innerHTML : el.innerHTML;

    blocks.push({ id: nextId('toggle'), type: 'toggle', data: { text } });

    return;
  }

  if (tag === 'UL' || tag === 'OL') {
    flattenList(el, tag === 'OL' ? 'ordered' : 'unordered', 0, blocks, nextId);

    return;
  }

  if (tag === 'TABLE') {
    convertTable(el, blocks, nextId);

    return;
  }

  if (tag === 'ASIDE') {
    convertCallout(el, blocks, nextId);

    return;
  }

  // Unknown block element: extract innerHTML as paragraph
  blocks.push({
    id: nextId('paragraph'),
    type: 'paragraph',
    data: { text: el.innerHTML },
  });
}

// ---------------------------------------------------------------------------
// List flattening
// ---------------------------------------------------------------------------

function flattenList(
  listEl: HTMLElement,
  style: 'ordered' | 'unordered',
  depth: number,
  blocks: OutputBlockData[],
  nextId: (prefix: string) => string
): void {
  const startAttr = listEl.getAttribute('start');
  const startValue = startAttr ? Number(startAttr) : null;
  const listItems = Array.from(listEl.children).filter((child) => child.tagName === 'LI');

  for (const [index, child] of listItems.entries()) {
    // Clone the li so we can remove nested lists without mutating DOM
    const clone = child.cloneNode(true) as HTMLElement;
    const nestedLists: HTMLElement[] = [];

    for (const nested of Array.from(clone.querySelectorAll('ul, ol'))) {
      nestedLists.push(nested.cloneNode(true) as HTMLElement);
      nested.remove();
    }

    const text = clone.innerHTML.trim();

    // Use aria-level if present (1-based → 0-based), otherwise use nesting depth
    const ariaLevel = (child as HTMLElement).getAttribute('aria-level');
    const itemDepth = ariaLevel
      ? Math.max(0, parseInt(ariaLevel, 10) - 1)
      : depth;

    blocks.push({
      id: nextId('list'),
      type: 'list',
      data: {
        text,
        style,
        depth: itemDepth === 0 ? null : itemDepth,
        checked: null,
        start: index === 0 && startValue !== null ? startValue : null,
      },
    });

    // Recursively process nested lists
    for (const nested of nestedLists) {
      const nestedStyle = nested.tagName === 'OL' ? 'ordered' : 'unordered';

      flattenList(nested, nestedStyle, depth + 1, blocks, nextId);
    }
  }
}

// ---------------------------------------------------------------------------
// Table conversion
// ---------------------------------------------------------------------------

type GridSlot =
  | { kind: 'cell'; el: HTMLElement; colspan: number; rowspan: number }
  | { kind: 'covered'; origin: [number, number] }
  | { kind: 'filler' };

function convertTable(
  tableEl: HTMLElement,
  blocks: OutputBlockData[],
  nextId: (prefix: string) => string
): void {
  const caption = Array.from(tableEl.children).find((child) => child.tagName === 'CAPTION');
  const captionText = caption?.innerHTML.trim() ?? '';

  // Pushed before the cells so the table lands after it, before its own children.
  if (captionText) {
    blocks.push({ id: nextId('paragraph'), type: 'paragraph', data: { text: captionText } });
  }

  unwrapCellHeadingsAndQuotes(tableEl);

  const tableId = nextId('table');
  const rows = ownPastedRows(tableEl);
  const grid = mapPastedTableCells<GridSlot>(rows, {
    cell: (el, span) => ({ kind: 'cell', el: el as HTMLElement, ...span }),
    covered: (origin) => ({ kind: 'covered', origin }),
    filler: () => ({ kind: 'filler' }),
  });
  const direction = pastedGridDirection(tableEl);
  const content = grid.map((row) => row.map((slot) => {
    if (slot.kind === 'covered') {
      return { blocks: [], mergedInto: slot.origin };
    }

    if (slot.kind === 'filler') {
      return { blocks: [], color: null, textColor: null };
    }

    return convertTableCell(slot, direction, tableId, blocks, nextId);
  }));

  const isTh = (cell: Element | undefined): boolean => cell?.tagName === 'TH';
  const firstRowCells = rows[0] ? ownPastedCells(rows[0]) : [];
  const withHeadings = rows.some((row) => row.parentElement?.tagName === 'THEAD')
    || (firstRowCells.length > 0 && firstRowCells.every(isTh));
  const withHeadingColumn = rows.length >= 2 && rows.every((row) => isTh(ownPastedCells(row)[0]));
  // Widths by logical column: a merged slot has no single column width.
  const colWidths = (grid[0] ?? []).map((slot) => {
    if (slot.kind !== 'cell' || slot.colspan > 1) {
      return null;
    }

    const px = parseInt(parseCssProperty(slot.el, 'width') ?? '', 10);

    return isNaN(px) ? null : px;
  });
  const hasWidths = colWidths.some((w) => w !== null);

  // Insert table block before its child paragraph blocks
  const tableBlock: OutputBlockData = {
    id: tableId,
    type: 'table',
    data: {
      withHeadings,
      withHeadingColumn,
      content,
      ...(hasWidths ? { colWidths } : {}),
    },
  };

  // Find first child block index to insert table before its children
  const firstChildIdx = blocks.findIndex((b) => b.parent === tableId);

  if (firstChildIdx >= 0) {
    blocks.splice(firstChildIdx, 0, tableBlock);
  } else {
    blocks.push(tableBlock);
  }
}

// ---------------------------------------------------------------------------
// Callout conversion
// ---------------------------------------------------------------------------

function convertCallout(
  asideEl: HTMLElement,
  blocks: OutputBlockData[],
  nextId: (prefix: string) => string
): void {
  const calloutId = nextId('callout');
  const bgColor = parseCssProperty(asideEl, 'background-color');
  // Skip default page backgrounds so white/dark pass-throughs don't map to a gray preset.
  const backgroundColor =
    bgColor && !isDefaultWhiteBackground(bgColor) && !isDefaultDarkBackground(bgColor)
      ? mapToNearestPresetName(bgColor, 'bg')
      : null;

  const childIds: string[] = [];

  for (const child of Array.from(asideEl.childNodes)) {
    const childId = convertCalloutChild(child, calloutId, blocks, nextId);

    if (childId) {
      childIds.push(childId);
    }
  }

  // Insert callout block before its children
  const firstChildIdx = blocks.findIndex((b) => b.parent === calloutId);

  const calloutBlock: OutputBlockData = {
    id: calloutId,
    type: 'callout',
    data: {
      emoji: '\u{1F4A1}',
      backgroundColor,
    },
    content: childIds,
  };

  if (firstChildIdx >= 0) {
    blocks.splice(firstChildIdx, 0, calloutBlock);
  } else {
    blocks.push(calloutBlock);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convertTableCell(
  slot: { el: HTMLElement; colspan: number; rowspan: number },
  direction: TextDirection,
  tableId: string,
  blocks: OutputBlockData[],
  nextId: (prefix: string) => string
): Record<string, unknown> {
  const cellEl = slot.el;
  const { color, textColor, placement } = readPastedCell(cellEl, direction);
  const cellHtml = cellEl.innerHTML.trim();
  // A blank cell stays empty: the parser would give it one empty paragraph.
  const childIds = cellHtml ? parseCellContentToBlocks(cellHtml).map((insert) => {
    const childId = nextId(insert.tool);

    blocks.push({ id: childId, type: insert.tool, parent: tableId, data: insert.data });

    return childId;
  }) : [];

  return {
    blocks: childIds,
    // readPastedCell gives a preset hex; the CLI stores the preset name.
    color: color === undefined ? null : mapToNearestPresetName(color, 'bg'),
    textColor: textColor === undefined ? null : mapToNearestPresetName(textColor, 'text'),
    ...(placement !== undefined ? { placement } : {}),
    ...(slot.colspan > 1 ? { colspan: slot.colspan } : {}),
    ...(slot.rowspan > 1 ? { rowspan: slot.rowspan } : {}),
  };
}

function convertCalloutChild(
  child: ChildNode,
  calloutId: string,
  blocks: OutputBlockData[],
  nextId: (prefix: string) => string
): string | null {
  if (child.nodeType === Node.ELEMENT_NODE) {
    const childEl = child as HTMLElement;
    const childId = nextId('paragraph');

    blocks.push({
      id: childId,
      type: 'paragraph',
      parent: calloutId,
      data: { text: childEl.innerHTML },
    });

    return childId;
  }

  if (child.nodeType === Node.TEXT_NODE) {
    const text = child.textContent?.trim() ?? '';

    if (!text) {
      return null;
    }

    const childId = nextId('paragraph');

    blocks.push({
      id: childId,
      type: 'paragraph',
      parent: calloutId,
      data: { text },
    });

    return childId;
  }

  return null;
}

function parseIntFromStyle(el: HTMLElement, property: string): number | null {
  const value = parseCssProperty(el, property);

  if (!value) {
    return null;
  }

  const parsed = parseInt(value, 10);

  return isNaN(parsed) ? null : parsed;
}

function parseCssProperty(el: HTMLElement, property: string): string | null {
  const style = el.getAttribute('style');

  if (!style) {
    return null;
  }

  const regex = new RegExp(`(?<![\\-a-z])${property}\\s*:\\s*([^;]+)`);
  const match = regex.exec(style);

  return match ? match[1].trim() : null;
}

import { createIdGenerator } from './id-generator';
import { mapToNearestPresetName } from '../../../components/utils/color-mapping';
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

  return blocks;
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
    const widthStyle = parseCssProperty(el, 'width');
    let width: number | null = null;

    if (widthStyle) {
      const parsed = parseInt(widthStyle, 10);

      if (!isNaN(parsed)) {
        width = parsed;
      }
    }

    blocks.push({
      id: nextId('image'),
      type: 'image',
      data: { url: src },
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
  let isFirstItem = true;

  for (const child of Array.from(listEl.children)) {
    if (child.tagName !== 'LI') {
      continue;
    }

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
    let itemDepth = depth;

    if (ariaLevel) {
      itemDepth = Math.max(0, parseInt(ariaLevel, 10) - 1);
    }

    blocks.push({
      id: nextId('list'),
      type: 'list',
      data: {
        text,
        style,
        depth: itemDepth === 0 ? null : itemDepth,
        checked: null,
        start: isFirstItem && startValue !== null ? startValue : null,
      },
    });

    isFirstItem = false;

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

function convertTable(
  tableEl: HTMLElement,
  blocks: OutputBlockData[],
  nextId: (prefix: string) => string
): void {
  const tableId = nextId('table');
  const rows = Array.from(tableEl.querySelectorAll('tr'));

  let withHeadings = false;
  const content: Record<string, unknown>[][] = [];

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const cells = Array.from(row.querySelectorAll('td, th'));

    if (rowIdx === 0 && cells.some((c) => c.tagName === 'TH')) {
      withHeadings = true;
    }

    const rowData: Record<string, unknown>[] = [];

    for (const cell of cells) {
      const cellEl = cell as HTMLElement;
      const cellText = cellEl.innerHTML.trim();

      if (cellText) {
        const childId = nextId('paragraph');

        blocks.push({
          id: childId,
          type: 'paragraph',
          parent: tableId,
          data: { text: cellText },
        });

        // Parse cell colors
        const bgColor = parseCssProperty(cellEl, 'background-color');
        const textColor = parseCssProperty(cellEl, 'color');

        rowData.push({
          blocks: [childId],
          color: bgColor ? mapToNearestPresetName(bgColor, 'bg') : null,
          textColor: textColor ? mapToNearestPresetName(textColor, 'text') : null,
        });
      } else {
        rowData.push({ blocks: [], color: null, textColor: null });
      }
    }

    content.push(rowData);
  }

  // Parse column widths from first row cells
  const firstRowCells = rows[0] ? Array.from(rows[0].querySelectorAll('td, th')) : [];
  const colWidths = firstRowCells.map((cell) => {
    const width = parseCssProperty(cell as HTMLElement, 'width');

    if (width) {
      const px = parseInt(width, 10);

      return isNaN(px) ? null : px;
    }

    return null;
  });
  const hasWidths = colWidths.some((w) => w !== null);

  // Insert table block before its child paragraph blocks
  const tableBlock: OutputBlockData = {
    id: tableId,
    type: 'table',
    data: {
      withHeadings,
      withHeadingColumn: false,
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
  const backgroundColor = bgColor ? mapToNearestPresetName(bgColor, 'bg') : null;

  const childIds: string[] = [];

  for (const child of Array.from(asideEl.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      const childId = nextId('paragraph');

      blocks.push({
        id: childId,
        type: 'paragraph',
        parent: calloutId,
        data: { text: childEl.innerHTML },
      });

      childIds.push(childId);
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim() ?? '';

      if (text) {
        const childId = nextId('paragraph');

        blocks.push({
          id: childId,
          type: 'paragraph',
          parent: calloutId,
          data: { text },
        });

        childIds.push(childId);
      }
    }
  }

  // Insert callout block before its children
  const firstChildIdx = blocks.findIndex((b) => b.parent === calloutId);

  const calloutBlock: OutputBlockData = {
    id: calloutId,
    type: 'callout',
    data: {
      emoji: '\u{1F4A1}',
      backgroundColor: backgroundColor ?? 'gray',
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

function parseCssProperty(el: HTMLElement, property: string): string | null {
  const style = el.getAttribute('style');

  if (!style) {
    return null;
  }

  const regex = new RegExp(`(?<![\\-a-z])${property}\\s*:\\s*([^;]+)`);
  const match = regex.exec(style);

  return match ? match[1].trim() : null;
}

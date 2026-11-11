import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputBlockData, OutputData } from '@/types';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

export const HOLDER_ID = 'blok';
export const BLOK_MIME = 'application/x-blok';

export type Clip = Record<string, string>;
export type SavedBlock = OutputBlockData & { parent?: string; content?: string[] };
export type Canon = { type: string; data: unknown; tunes?: unknown; children: Canon[] };
export type CanonCell = Record<string, unknown> & { blocks?: Canon[] };

/* ----------------------------- editor setup ----------------------------- */

export const createEditor = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.width = '820px';
    container.style.margin = '40px auto';
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });

  // Open toggles so their children are interactable.
  await page.evaluate(() => {
    const blok = window.blokInstance;

    if (!blok) {
      return;
    }
    const count = blok.blocks.getBlocksCount();

    for (let i = 0; i < count; i++) {
      const block = blok.blocks.getBlockByIndex(i);

      if (block && (block.name === 'toggle')) {
        block.call('expand');
      }
    }
  });
};

export const saveRaw = async (page: Page): Promise<SavedBlock[]> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());

  if (!saved) {
    throw new Error('no editor');
  }

  return saved.blocks;
};

/* --------------------------- canonical shapes --------------------------- */

export const canonBlock = (block: SavedBlock, byId: Map<string, SavedBlock>): Canon => {
  const data: Record<string, unknown> = { ...(block.data) };
  const cellIds = new Set<string>();

  if (block.type === 'table' && Array.isArray(data.content)) {
    data.content = (data.content as unknown[][]).map(row => row.map(cell => canonCell(cell, byId, cellIds, 0, 0)));
  }
  const children = (block.content ?? [])
    .filter(id => !cellIds.has(id))
    .map(id => {
      const child = byId.get(id);

      return child ? canonBlock(child, byId) : { type: 'MISSING', data: id, children: [] };
    });
  const tunes = block.tunes && Object.keys(block.tunes).length > 0 ? { tunes: block.tunes } : {};

  return { type: block.type, data, ...tunes, children };
};

export const canonCell = (
  cell: unknown,
  byId: Map<string, SavedBlock>,
  cellIds: Set<string>,
  rowOffset: number,
  colOffset: number,
): CanonCell => {
  if (typeof cell === 'string') {
    return { text: cell };
  }
  const { id: _id, rowId: _rowId, blocks = [], mergedInto, ...rest } = cell as Record<string, unknown> & { blocks?: string[]; mergedInto?: [number, number] };
  const ids = blocks;

  ids.forEach(id => cellIds.add(id));

  return {
    ...rest,
    ...(mergedInto ? { mergedInto: [mergedInto[0] - rowOffset, mergedInto[1] - colOffset] } : {}),
    blocks: ids.map(id => {
      const b = byId.get(id);

      return b ? canonBlock(b, byId) : { type: 'MISSING', data: id, children: [] };
    }),
  };
};

export const canonDoc = (blocks: SavedBlock[]): Canon[] => {
  const byId = new Map(blocks.map(b => [b.id ?? '', b]));

  return blocks.filter(b => b.parent === undefined).map(b => canonBlock(b, byId));
};

/** Canonical table (all of it) by table index in document order. */
export const tables = (blocks: SavedBlock[]): SavedBlock[] => blocks.filter(b => b.type === 'table');

export const canonTable = (blocks: SavedBlock[], table: SavedBlock): Canon => canonBlock(table, new Map(blocks.map(b => [b.id ?? '', b])));

/** A rectangular region of a table's content, canonicalised and offset-normalised. */
export const canonRegion = (
  blocks: SavedBlock[],
  table: SavedBlock,
  r0: number, c0: number, r1: number, c1: number,
): CanonCell[][] => {
  const byId = new Map(blocks.map(b => [b.id ?? '', b]));
  const content = (table.data as { content: unknown[][] }).content;
  const out: CanonCell[][] = [];

  for (let r = r0; r <= r1; r++) {
    const row: CanonCell[] = [];

    for (let c = c0; c <= c1; c++) {
      row.push(canonCell(content[r]?.[c], byId, new Set(), r0, c0));
    }
    out.push(row);
  }

  return out;
};

export const tableShape = (table: SavedBlock): { rows: number; cols: number[] } => {
  const content = (table.data as { content: unknown[][] }).content;

  return { rows: content.length, cols: content.map(r => r.length) };
};

/** Every saved structural inconsistency: dangling ids, orphans, cell blocks outside cells. */
export const integrityProblems = (blocks: SavedBlock[]): string[] => {
  const byId = new Map(blocks.map(b => [b.id ?? '', b]));
  const problems: string[] = [];

  blocks.forEach((b) => {
    (b.content ?? []).forEach((id) => {
      if (!byId.has(id)) {
        problems.push(`${b.type}:${b.id} content names missing ${id}`);
      } else if (byId.get(id)?.parent !== b.id) {
        problems.push(`${b.type}:${b.id} content ${id} has parent ${String(byId.get(id)?.parent)}`);
      }
    });
    if (b.parent !== undefined) {
      const parent = byId.get(b.parent);

      if (!parent) {
        problems.push(`${b.type}:${b.id} parent ${b.parent} missing`);
      } else if (!(parent.content ?? []).includes(b.id ?? '')) {
        problems.push(`${b.type}:${b.id} not in parent ${b.parent} content`);
      }
      if (parent?.type === 'table') {
        const cells = ((parent.data as { content: unknown[][] }).content).flat();
        const inCell = cells.some(cell => typeof cell === 'object' && cell !== null && ((cell as { blocks?: string[] }).blocks ?? []).includes(b.id ?? ''));

        // eslint-disable-next-line max-depth -- nested walk over the saved tree
        if (!inCell) {
          problems.push(`${b.type}:${b.id} child of table ${b.parent} but in no cell`);
        }
      }
    }
  });

  return problems;
};

/** DOM layout: each block's holder sits inside its saved parent's holder (and only that). */
export const layoutProblems = async (page: Page): Promise<string[]> => {
  return page.evaluate(async () => {
    const saved = await window.blokInstance?.save();
    const problems: string[] = [];

    for (const b of (saved?.blocks ?? []) as Array<{ id?: string; type: string; parent?: string }>) {
      const holder = document.querySelector(`[data-blok-id="${b.id ?? ''}"]`);

      if (!holder) {
        problems.push(`${b.type}:${b.id} has no holder`);
        continue;
      }
      const domParent = holder.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? undefined;

      if (domParent !== b.parent) {
        problems.push(`${b.type}:${b.id} DOM parent ${String(domParent)} != saved parent ${String(b.parent)}`);
      }
      if (b.parent !== undefined) {
        const parentType = (saved?.blocks ?? []).find(x => x.id === b.parent)?.type;

        // eslint-disable-next-line max-depth -- nested walk over the saved tree
        if (parentType === 'table') {
          // eslint-disable-next-line max-depth -- nested walk over the saved tree
          if (holder.closest('[data-blok-table-cell-blocks]') === null) {
            problems.push(`${b.type}:${b.id} table child outside a cell container`);
          }
        }
      }
    }

    return problems;
  });
};

/* ------------------------------- clipboard ------------------------------ */

/** Fire copy/cut where a real Cmd+C would and capture every MIME type written. */
export const fireClipboard = async (page: Page, type: 'copy' | 'cut'): Promise<Clip> => {
  return page.evaluate(async (eventName) => {
    const store: Record<string, string> = {};
    const dt = new DataTransfer();
    const original = dt.setData.bind(dt);

    dt.setData = (format: string, data: string): void => {
      store[format] = data;
      original(format, data);
    };
    const event = new ClipboardEvent(eventName, { bubbles: true, cancelable: true, clipboardData: dt });
    const target = (document.activeElement as HTMLElement | null) ?? document.body;

    target.dispatchEvent(event);
    await new Promise(r => setTimeout(r, 50));
    Array.from(dt.types).forEach((f) => {
      if (!(f in store)) {
        store[f] = dt.getData(f);
      }
    });

    return store;
  }, type);
};

/** Fire paste at the focused element (where the browser fires it) with the given MIME map. */
export const firePaste = async (page: Page, data: Clip): Promise<void> => {
  await page.evaluate((payload) => {
    const dt = new DataTransfer();

    Object.entries(payload).forEach(([k, v]) => dt.setData(k, v));
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });

    if (event.clipboardData !== dt) {
      Object.defineProperty(event, 'clipboardData', { value: dt });
    }
    const target = (document.activeElement as HTMLElement | null) ?? document.body;

    target.dispatchEvent(event);
  }, data);
  // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
  await page.waitForTimeout(700);
};

export const htmlAndPlain = (clip: Clip): Clip => ({ 'text/html': clip['text/html'] ?? '', 'text/plain': clip['text/plain'] ?? '' });
export const plainOnly = (clip: Clip): Clip => ({ 'text/plain': clip['text/plain'] ?? '' });
/** What an app that re-serialises HTML (keeps the table, drops unknown attributes) hands back. */
export const htmlWithoutBlokAttr = (clip: Clip): Clip => ({
  'text/html': (clip['text/html'] ?? '').replace(/\sdata-blok-table-cells='[^']*'/, ''),
  'text/plain': clip['text/plain'] ?? '',
});

/* ------------------------------- selection ------------------------------ */

export const tableLocator = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"]`);

export const cellOf = (page: Page, tableId: string, row: number, col: number): Locator =>
  tableLocator(page, tableId).locator(`[data-blok-table-cell][data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`);

export const box = async (l: Locator, label: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await l.boundingBox();

  if (!b) {
    throw new Error(`no box for ${label}`);
  }

  return b;
};

/** Centre of a grid slot (works for merge-covered slots: x from its column, y from its row). */
export const slotPoint = async (page: Page, tableId: string, row: number, col: number): Promise<{ x: number; y: number }> => {
  const point = await page.evaluate(({ id, r, c }) => {
    const cells = Array.from(document.querySelectorAll(`[data-blok-id="${id}"] [data-blok-table-cell]`));
    const at = (attr: string, v: number): Element | undefined => cells.find(el => el.getAttribute(attr) === String(v)
      && (el.getAttribute('colspan') ?? '1') === '1' && (el.getAttribute('rowspan') ?? '1') === '1');
    const colCell = at('data-blok-table-cell-col', c);
    const rowCell = at('data-blok-table-cell-row', r);

    if (!colCell || !rowCell) {
      return null;
    }
    const cb = colCell.getBoundingClientRect();
    const rb = rowCell.getBoundingClientRect();

    return { x: cb.left + cb.width / 2, y: rb.top + rb.height / 2 };
  }, { id: tableId, r: row, c: col });

  if (!point) {
    throw new Error(`no slot point ${row},${col}`);
  }

  return point;
};

/** Drag a cell range the way a user does (pointer from slot centre to slot centre). */
export const selectCellRange = async (page: Page, tableId: string, r0: number, c0: number, r1: number, c1: number): Promise<void> => {
  const a = await slotPoint(page, tableId, r0, c0);
  const b = await slotPoint(page, tableId, r1, c1);

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // One cell is selected by a plain click. A tiny drag over the cell text
  // selects letters instead, and the copy then carries only those letters.
  if (r0 !== r1 || c0 !== c1) {
    await page.mouse.move(b.x, b.y, { steps: 12 });
  }
  await page.mouse.up();
};

/** Rectangle-select a top-level block by dragging from the left page margin over it. */
export const rectangleSelectBlock = async (page: Page, blockId: string): Promise<void> => {
  await page.mouse.click(3, 3);
  const editor = await box(page.locator(`#${HOLDER_ID}`), 'editor');
  const target = await box(tableLocator(page, blockId), 'block');

  await page.mouse.move(editor.x - 20, target.y - 4);
  await page.mouse.down();
  await page.mouse.move(editor.x + 60, target.y + target.height - 10, { steps: 15 });
  await page.mouse.up();
};

export const selectedIds = async (page: Page): Promise<string[]> =>
  page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-selected="true"]')).map(e => e.getAttribute('data-blok-id') ?? ''));

export const focusEditable = async (l: Locator): Promise<void> => {
  const editable = l.locator('[contenteditable="true"]').first();

  await editable.click();
  await editable.press('End');
};

export const focusCell = async (page: Page, tableId: string, row: number, col: number): Promise<void> => {
  await focusEditable(cellOf(page, tableId, row, col));
};

/* ------------------------------- fixtures ------------------------------- */

export const richTable = (id: string, parent?: string): SavedBlock[] => {
  const p = (bid: string, text: string, extra: Record<string, unknown> = {}): SavedBlock => ({ id: bid, type: 'paragraph', data: { text, ...extra }, parent: id });

  return [
    {
      id,
      type: 'table',
      ...(parent ? { parent } : {}),
      data: {
        withHeadings: true,
        withHeadingColumn: false,
        colWidths: [140, 220, 180],
        content: [
          [{ blocks: [`${id}h1`] }, { blocks: [`${id}h2`] }, { blocks: [`${id}h3`] }],
          [
            { blocks: [`${id}l1`, `${id}l2`, `${id}l3`], color: 'var(--blok-color-blue-bg)' },
            { blocks: [`${id}m1`] },
            { blocks: [`${id}g1`], rowspan: 2, placement: 'middle-center' },
          ],
          [
            { blocks: [`${id}x1`], textColor: 'var(--blok-color-red-text)' },
            { blocks: [`${id}i1`] },
            { blocks: [], mergedInto: [1, 2] },
          ],
        ],
      },
      content: [`${id}h1`, `${id}h2`, `${id}h3`, `${id}l1`, `${id}l2`, `${id}l3`, `${id}m1`, `${id}g1`, `${id}x1`, `${id}i1`],
    },
    p(`${id}h1`, 'H1'),
    p(`${id}h2`, 'H2'),
    p(`${id}h3`, 'H3'),
    { id: `${id}l1`, type: 'list', data: { text: 'one', style: 'unordered' }, parent: id },
    { id: `${id}l2`, type: 'list', data: { text: 'nested', style: 'unordered', depth: 1 }, parent: id },
    { id: `${id}l3`, type: 'list', data: { text: 'done', style: 'checklist', checked: true }, parent: id },
    p(`${id}m1`, '<b>bold</b> <i>it</i> <a href="https://example.com/">link</a> <mark style="background-color: var(--blok-color-yellow-bg);">hi</mark>'),
    p(`${id}g1`, 'merged'),
    p(`${id}x1`, 'red'),
    { id: `${id}i1`, type: 'image', data: { url: 'https://example.com/a.png', caption: 'cap' }, parent: id },
  ];
};

export const plainTable = (id: string, rows: number, cols: number, prefix = '', extra: Record<string, unknown> = {}): SavedBlock => ({
  id,
  type: 'table',
  data: {
    withHeadings: false,
    withHeadingColumn: false,
    content: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${prefix}${r}${c}`)),
    ...extra,
  },
});

export const para = (id: string, text: string, parent?: string): SavedBlock => ({ id, type: 'paragraph', data: { text }, ...(parent ? { parent } : {}) });



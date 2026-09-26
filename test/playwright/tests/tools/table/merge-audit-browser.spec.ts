// Browser audit of merge/split interaction: focus, overlay, typing, undo, chrome.

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
};

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

const assertBoundingBox = (
  box: { x: number; y: number; width: number; height: number } | null,
  label: string
): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

/** Cell by PHYSICAL position (nth <td> of the nth <tr>). */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page
    .locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

/** Cell by LOGICAL (model) coordinate — the merge-safe way to address a cell. */
const getCellAt = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(
    `${TABLE_SELECTOR} [data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`
  );

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data = null, tools = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig }) => {
      const blokConfig: Record<string, unknown> = { holder };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        blokConfig.tools = toolsConfig.reduce<Record<string, { class: unknown }>>(
          (accumulator, { name, className, config }) => {
            const toolClass = className
              ? className.split('.').reduce(
                (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
                window as unknown
              )
              : null;

            if (!toolClass) {
              throw new Error(`Tool "${name}" is not available globally`);
            }

            return { ...accumulator, [name]: { class: toolClass, ...config } };
          },
          {}
        );
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, data, serializedTools }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: { className: 'Blok.Table' },
  paragraph: { className: 'Blok.Paragraph' },
};

/**
 * 3x3 table: row 0 = A1 B1 C1, row 1 = A2 B2 C2, row 2 = A3 B3 C3.
 */
const create3x3Table = async (page: Page): Promise<void> => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [
              ['A1', 'B1', 'C1'],
              ['A2', 'B2', 'C2'],
              ['A3', 'B3', 'C3'],
            ],
          },
        },
      ],
    },
  });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
};

/** Drag-select the rectangle between two cells (physical positions). */
const selectCells = async (
  page: Page,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number
): Promise<void> => {
  const startBox = assertBoundingBox(
    await getCell(page, startRow, startCol).boundingBox(),
    `cell [${startRow},${startCol}]`
  );
  const endBox = assertBoundingBox(
    await getCell(page, endRow, endCol).boundingBox(),
    `cell [${endRow},${endCol}]`
  );

  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 10 });
  await page.mouse.up();
};

/**
 * Hover a cell away from its edges. A merged cell's CENTER can sit exactly on a
 * column border, where the resize handle intercepts pointer events.
 */
const hoverCellAt = async (page: Page, row: number, col: number): Promise<void> => {
  await getCellAt(page, row, col).hover({ position: { x: 8, y: 8 } });
};

/**
 * Select exactly ONE cell.
 *
 * Cell selection only engages once the pointer LEAVES the anchor cell (a drag
 * that stays inside it is ordinary text selection), so a single-cell rectangle
 * is produced by dragging out to a neighbour and back. This is the gesture that
 * offers "Split cell" on a merged origin.
 */
const selectSingleCell = async (
  page: Page,
  cell: { row: number; col: number },
  via: { row: number; col: number }
): Promise<void> => {
  const cellBox = assertBoundingBox(
    await getCellAt(page, cell.row, cell.col).boundingBox(),
    `cell [${cell.row},${cell.col}]`
  );
  const viaBox = assertBoundingBox(
    await getCellAt(page, via.row, via.col).boundingBox(),
    `cell [${via.row},${via.col}]`
  );

  // Press in the lower-left quadrant. The top-left corner carries the table's
  // add-row/add-column controls and the row grip, and a merged cell's CENTRE
  // falls on the column-boundary resize handle — all of which swallow the
  // press before the cell ever sees it.
  const anchorX = cellBox.x + cellBox.width * 0.25;
  const anchorY = cellBox.y + cellBox.height * 0.75;
  const selected = page.locator('[data-blok-table-cell-selected]');

  await page.mouse.move(anchorX, anchorY, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(viaBox.x + viaBox.width / 2, viaBox.y + viaBox.height / 2, { steps: 8 });

  // Wait for cell selection to actually ENGAGE before heading back. Under load
  // the browser can coalesce the moves into the neighbour away, and the drag
  // would then read as a press that never left the anchor cell (plain text
  // selection), leaving no rectangle to split.
  await expect(selected).not.toHaveCount(0);

  await page.mouse.move(anchorX, anchorY, { steps: 8 });
  await page.mouse.up();

  // Back on the anchor: a single-cell rectangle, expanded to the merge
  // footprint — this is what paints the overlay the pill hangs off.
  await expect(selected).not.toHaveCount(0);
};

/** Open the selection pill's popover. */
const openPill = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();

  const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');

  await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
  await expect(pill).toBeVisible();
  await pill.click();
};

/** Merge the 2x2 block anchored at physical [0,0]. */
const mergeTopLeft2x2 = async (page: Page): Promise<void> => {
  await selectCells(page, 0, 0, 1, 1);
  await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(4);

  await openPill(page);
  await page.getByText('Merge cells').click();

  await expect(getCellAt(page, 0, 0)).toHaveAttribute('colspan', '2');

  // Wait for the popover to close: pressing into a cell while it is still up
  // would be swallowed by it, and the next gesture would select nothing.
  await expect(page.getByText('Merge cells')).toHaveCount(0);
  // The caret then lands in the merged cell, which boxes it alone.
  await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(1);
};


const OVERLAY = '[data-blok-table-selection-overlay]';
const SELECTED = '[data-blok-table-cell-selected]';

type ActiveInfo = { inTable: boolean; cellRow: string | null; cellCol: string | null; tag: string; editable: boolean };

const activeInfo = async (page: Page): Promise<ActiveInfo> => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  const cell = el?.closest('[data-blok-table-cell]') ?? null;

  return {
    inTable: el?.closest('[data-blok-tool="table"]') !== null && el?.closest('[data-blok-tool="table"]') !== undefined,
    cellRow: cell?.getAttribute('data-blok-table-cell-row') ?? null,
    cellCol: cell?.getAttribute('data-blok-table-cell-col') ?? null,
    tag: el?.tagName ?? 'none',
    editable: el?.isContentEditable ?? false,
  };
});

const cellEditable = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  getCellAt(page, row, col).locator('[contenteditable="true"]').first();

const pace = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, 600);
    });
  });
};

const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

test.describe('Table merge browser audit', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.afterEach(async ({ page }) => {
    await resetBlok(page);
  });

  test('AUD1 after merge only the merged cell holding the caret is boxed and the popover is gone', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    await expect(page.locator(OVERLAY)).toHaveCount(1);
    await expect(page.locator(SELECTED)).toHaveCount(1);
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(page.locator('[data-blok-popover-opened]')).toHaveCount(0);
    console.log('AUD1 active after merge', JSON.stringify(await activeInfo(page)));
  });

  test('AUD2 the user can click into the merged cell and type', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    const merged = getCellAt(page, 0, 0);
    const editables = merged.locator('[contenteditable="true"]');

    console.log('AUD2 merged editables', await editables.count(), JSON.stringify(await merged.innerText()));
    await editables.last().click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('End');
    await page.keyboard.type('ZZ');
    await expect(merged).toContainText('ZZ');
    console.log('AUD2 active', JSON.stringify(await activeInfo(page)));
  });

  test('AUD3 clicking the middle of a 2-col merged cell puts the caret in it', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    const box = assertBoundingBox(await getCellAt(page, 0, 0).boundingBox(), 'merged');
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;

      return { tag: el?.tagName, attrs: el ? Array.from(el.attributes).map(a => a.name).join(',') : '' };
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

    console.log('AUD3 hit at merged centre', JSON.stringify(hit));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const info = await activeInfo(page);

    console.log('AUD3 active', JSON.stringify(info));
    expect(info.cellRow).toBe('0');
    expect(info.cellCol).toBe('0');
    expect(info.editable).toBe(true);
  });

  test('AUD4 after split every freed cell accepts a click and typing', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await selectSingleCell(page, { row: 0, col: 0 }, { row: 0, col: 2 });
    await openPill(page);
    await page.getByText('Split cell').click();
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(9);
    // The caret lands in the split's top-left cell, which gets the usual one-cell box.
    await expect(page.locator(SELECTED)).toHaveCount(1);
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('data-blok-table-cell-selected', '');
    await expect(page.locator('[data-blok-popover-opened]')).toHaveCount(0);
    console.log('AUD4 active after split', JSON.stringify(await activeInfo(page)));

    for (const [r, c] of [[0, 1], [1, 0], [1, 1]] as const) {
      await cellEditable(page, r, c).click();
      await page.keyboard.type(`X${r}${c}`);
      await expect(getCellAt(page, r, c)).toContainText(`X${r}${c}`);
    }
  });

  test('AUD5 keyboard Shift+Arrow selection then Merge cells from the pill', async ({ page }) => {
    await create3x3Table(page);
    await cellEditable(page, 0, 0).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator(SELECTED)).toHaveCount(4);
    console.log('AUD5 active before pill', JSON.stringify(await activeInfo(page)));
    await openPill(page);
    await expect(page.getByText('Merge cells')).toBeVisible();
    console.log('AUD5 active with menu open', JSON.stringify(await activeInfo(page)));
    await page.getByText('Merge cells').click();
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('colspan', '2');
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('rowspan', '2');
    // The caret lands in the merged cell, so only that cell stays boxed.
    await expect(page.locator(SELECTED)).toHaveCount(1);
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('data-blok-table-cell-selected', '');
    console.log('AUD5 active after kb merge', JSON.stringify(await activeInfo(page)));
    await page.keyboard.type('KB');
    console.log('AUD5 merged text after typing', JSON.stringify(await getCellAt(page, 0, 0).innerText()));
    await expect(getCellAt(page, 0, 0)).toContainText('KB');
  });

  test('AUD5d the tbody swap itself does not drop focus during a merge', async ({ page }) => {
    await create3x3Table(page);
    await cellEditable(page, 0, 0).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator(SELECTED)).toHaveCount(4);
    await openPill(page);
    await expect(page.getByText('Merge cells')).toBeVisible();
    await page.evaluate(() => {
      const log: string[] = [];
      const w = window as unknown as { __focusLog: string[]; __restoreFocusProbe: () => void };

      w.__focusLog = log;
      const origAppend = Node.prototype.appendChild;
      const origReplaceWith = Element.prototype.replaceWith;

      Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
        const before = document.activeElement;
        const result = origAppend.call(this, node) as T;

        if (before !== document.activeElement && before !== null && before !== document.body) {
          log.push(`appendChild moved focused node: target=${(this as Element).tagName}[${Array.from((this as Element).attributes ?? []).map(a => a.name).join(',')}] connected=${this.isConnected} now=${document.activeElement?.tagName}`);
        }

        return result;
      };
      Element.prototype.replaceWith = function (this: Element, ...nodes: Array<Node | string>): void {
        log.push(`replaceWith ${this.tagName} activeBefore=${document.activeElement?.tagName} connected=${document.activeElement?.isConnected}`);
        origReplaceWith.apply(this, nodes);
        log.push(`after replaceWith ${this.tagName} active=${document.activeElement?.tagName} connected=${document.activeElement?.isConnected}`);
      };
      const onFocusOut = (e: FocusEvent): void => {
        log.push(`focusout target=${(e.target as HTMLElement).tagName} connected=${(e.target as HTMLElement).isConnected} related=${(e.relatedTarget as HTMLElement | null)?.tagName ?? 'null'}[${(e.relatedTarget as HTMLElement | null)?.getAttribute('role') ?? ''}] stack=${(new Error().stack ?? '').split('\n').slice(2, 9).map(l => l.trim().replace(/\(.*\//, '(')).join(' | ')}`);
      };

      document.addEventListener('focusout', onFocusOut, true);
      // The shared page is reused by later tests in this file, so undo the probe.
      w.__restoreFocusProbe = () => {
        Node.prototype.appendChild = origAppend;
        Element.prototype.replaceWith = origReplaceWith;
        document.removeEventListener('focusout', onFocusOut, true);
      };
    });
    await page.getByText('Merge cells').click();
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('colspan', '2');
    await pace(page);
    const log = await page.evaluate(() => {
      const w = window as unknown as { __focusLog: string[]; __restoreFocusProbe: () => void };

      w.__restoreFocusProbe();

      return w.__focusLog;
    });

    console.log('AUD5d log', JSON.stringify(log, null, 1));
    expect(log.some(l => l.startsWith('appendChild moved focused node'))).toBe(false);
  });

  test('AUD5c keyboard selection then Copy from the pill keeps the caret in the table', async ({ page }) => {
    await create3x3Table(page);
    await cellEditable(page, 0, 0).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator(SELECTED)).toHaveCount(4);
    await openPill(page);
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    await expect(page.locator('[data-blok-popover-opened]')).toHaveCount(0);
    const info = await activeInfo(page);

    console.log('AUD5c active after copy item', JSON.stringify(info));
    expect(info.inTable).toBe(true);
  });

  test('AUD6 undo right after merge restores the 3x3 grid with content in place', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await pace(page);
    await page.keyboard.press(undoKey);
    await pace(page);

    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(9);
    const texts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-tool="table"] [data-blok-table-row]'))
      .map(r => Array.from(r.querySelectorAll('[data-blok-table-cell]')).map(c => (c as HTMLElement).innerText.trim())));

    console.log('AUD6 texts', JSON.stringify(texts));
    expect(texts).toEqual([['A1', 'B1', 'C1'], ['A2', 'B2', 'C2'], ['A3', 'B3', 'C3']]);
    const diag = await page.evaluate(() => {
      const box = (el: Element): { x: number; y: number; width: number; height: number } => {
        const r = el.getBoundingClientRect();

        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      const overlays = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-table-selection-overlay]'));
      const pills = document.querySelectorAll('[data-blok-table-selection-pill]').length;
      const selected = Array.from(document.querySelectorAll('[data-blok-table-cell-selected]'))
        .map(c => `${c.getAttribute('data-blok-table-cell-row')},${c.getAttribute('data-blok-table-cell-col')}`);
      const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-tool="table"] [data-blok-table-cell]'))
        .map(c => ({ rc: `${c.getAttribute('data-blok-table-cell-row')},${c.getAttribute('data-blok-table-cell-col')}`, r: box(c) }));
      const el = document.activeElement as HTMLElement | null;
      const cell = el?.closest('[data-blok-table-cell]');

      return {
        overlays: overlays.map(o => ({ r: box(o), inDoc: document.contains(o), parentTag: o.parentElement?.tagName })),
        pills,
        selected,
        active: el?.tagName,
        activeCell: cell ? `${cell.getAttribute('data-blok-table-cell-row')},${cell.getAttribute('data-blok-table-cell-col')}` : null,
        cell00: cells.find(c => c.rc === '0,0')?.r,
        cell11: cells.find(c => c.rc === '1,1')?.r,
      };
    });

    console.log('AUD6 diag', JSON.stringify(diag));
    // The only box left is the caret box on the cell that holds the caret.
    expect(diag.selected).toEqual([diag.activeCell]);
    expect(diag.overlays).toHaveLength(1);
    expect(Math.abs(diag.overlays[0].r.width - (diag.cell00?.width ?? 0))).toBeLessThanOrEqual(2);
  });

  test('AUD11 undo right after split restores the merged cell with its content', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await pace(page);
    await selectSingleCell(page, { row: 0, col: 0 }, { row: 0, col: 2 });
    await openPill(page);
    await page.getByText('Split cell').click();
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(9);
    await pace(page);
    await page.keyboard.press(undoKey);
    await pace(page);
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('colspan', '2');
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('rowspan', '2');
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(6);
    const text = await getCellAt(page, 0, 0).innerText();

    console.log('AUD11 merged text after undo split', JSON.stringify(text), 'overlays', await page.locator(OVERLAY).count(), JSON.stringify(await activeInfo(page)));
    expect(text.split('\n').map(t => t.trim()).filter(Boolean)).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  test('AUD12 redo after undoing a merge merges again', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await pace(page);
    await page.keyboard.press(undoKey);
    await pace(page);
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(9);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
    await pace(page);
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('colspan', '2');
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(6);
    const text = await getCellAt(page, 0, 0).innerText();

    console.log('AUD12 redo text', JSON.stringify(text));
    expect(text.split('\n').map(t => t.trim()).filter(Boolean)).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  test('AUD7 merged cell box equals the union of the columns and rows it spans', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    const merged = assertBoundingBox(await getCellAt(page, 0, 0).boundingBox(), 'merged');
    const c2r0 = assertBoundingBox(await getCellAt(page, 0, 2).boundingBox(), 'c2r0');
    const c2r1 = assertBoundingBox(await getCellAt(page, 1, 2).boundingBox(), 'c2r1');
    const a3 = assertBoundingBox(await getCellAt(page, 2, 0).boundingBox(), 'a3');
    const b3 = assertBoundingBox(await getCellAt(page, 2, 1).boundingBox(), 'b3');

    console.log('AUD7', JSON.stringify({ merged, c2r0, c2r1, a3, b3 }));
    expect(Math.abs(merged.x - a3.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((merged.x + merged.width) - (b3.x + b3.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(merged.y - c2r0.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((merged.y + merged.height) - (c2r1.y + c2r1.height))).toBeLessThanOrEqual(1);
  });

  test('AUD8 selecting the merged cell alone boxes exactly the merged cell', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await selectSingleCell(page, { row: 0, col: 0 }, { row: 0, col: 2 });

    const merged = assertBoundingBox(await getCellAt(page, 0, 0).boundingBox(), 'merged');
    const overlay = assertBoundingBox(await page.locator(OVERLAY).boundingBox(), 'overlay');

    console.log('AUD8', JSON.stringify({ merged, overlay }));
    expect(Math.abs(overlay.width - merged.width)).toBeLessThanOrEqual(3);
    expect(Math.abs(overlay.height - merged.height)).toBeLessThanOrEqual(3);
  });

  test('AUD9 drag that starts in a merged cell and extends right covers merge plus column', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    const merged = assertBoundingBox(await getCellAt(page, 0, 0).boundingBox(), 'merged');
    const target = assertBoundingBox(await getCellAt(page, 1, 2).boundingBox(), 'c2r1');

    await page.mouse.move(merged.x + merged.width * 0.25, merged.y + merged.height * 0.75);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator(SELECTED)).toHaveCount(3);
    const overlay = assertBoundingBox(await page.locator(OVERLAY).boundingBox(), 'overlay');

    console.log('AUD9', JSON.stringify({ merged, target, overlay }));
    expect(Math.abs(overlay.x - merged.x)).toBeLessThanOrEqual(2);
    expect(Math.abs((overlay.x + overlay.width) - (target.x + target.width))).toBeLessThanOrEqual(2);
    expect(Math.abs((overlay.y + overlay.height) - (merged.y + merged.height))).toBeLessThanOrEqual(2);

    await openPill(page);
    await page.getByText('Merge cells').click();
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('colspan', '3');
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('rowspan', '2');
  });

  test('AUD10 hover over merged cell lower half shows a row grip', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    const merged = assertBoundingBox(await getCellAt(page, 0, 0).boundingBox(), 'merged');

    await page.mouse.move(merged.x + 10, merged.y + merged.height * 0.8, { steps: 5 });
    const visibleRowGrips = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-blok-table-grip-row]'))
      .filter(g => g.getBoundingClientRect().width > 0 && getComputedStyle(g).opacity !== '0' && getComputedStyle(g).visibility !== 'hidden')
      .map(g => g.getAttribute('data-blok-table-grip-row')));

    console.log('AUD10 visible row grips (lower half)', JSON.stringify(visibleRowGrips));
    await page.mouse.move(merged.x + merged.width * 0.8, merged.y + 10, { steps: 5 });
    const visibleColGrips = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-blok-table-grip-col]'))
      .filter(g => g.getBoundingClientRect().width > 0 && getComputedStyle(g).opacity !== '0' && getComputedStyle(g).visibility !== 'hidden')
      .map(g => g.getAttribute('data-blok-table-grip-col')));

    console.log('AUD10 visible col grips (right half)', JSON.stringify(visibleColGrips));
    expect(visibleRowGrips).toContain('1');
    expect(visibleColGrips).toContain('1');
  });

  const gripAction = async (page: Page, kind: 'row' | 'col', index: number, hover: [number, number], item: string): Promise<void> => {
    await hoverCellAt(page, hover[0], hover[1]);
    const grip = page.locator(`[data-blok-table-grip-${kind}="${index}"]`);

    await expect(grip).toBeVisible();
    await grip.click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };

  const rowCellCounts = async (page: Page): Promise<number[]> => page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-tool="table"] [data-blok-table-row]'))
    .map(r => r.querySelectorAll('[data-blok-table-cell]').length));

  test('AUD13 delete a row covered by a rowspan shrinks the merge', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await gripAction(page, 'row', 1, [1, 2], 'Delete');
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-row]`)).toHaveCount(2);
    const counts = await rowCellCounts(page);
    const text = await getCellAt(page, 0, 0).innerText();

    console.log('AUD13', JSON.stringify(counts), JSON.stringify(text), await getCellAt(page, 0, 0).getAttribute('rowspan'), await getCellAt(page, 0, 0).getAttribute('colspan'));
    expect(counts).toEqual([2, 3]);
    await expect(getCellAt(page, 1, 2)).toContainText('C3');
  });

  test('AUD14 insert row below the origin row grows the merge', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await gripAction(page, 'row', 0, [0, 2], 'Insert row below');
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-row]`)).toHaveCount(4);
    const counts = await rowCellCounts(page);

    console.log('AUD14', JSON.stringify(counts), await getCellAt(page, 0, 0).getAttribute('rowspan'));
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('rowspan', '3');
    expect(counts).toEqual([2, 1, 1, 3]);
    await cellEditable(page, 1, 2).click();
    await page.keyboard.type('NEW');
    await expect(getCellAt(page, 1, 2)).toContainText('NEW');
  });

  test('AUD15 add-row + control after merging the bottom rows appends a full row', async ({ page }) => {
    await create3x3Table(page);
    await selectCells(page, 1, 0, 2, 1);
    await expect(page.locator(SELECTED)).toHaveCount(4);
    await openPill(page);
    await page.getByText('Merge cells').click();
    await expect(getCellAt(page, 1, 0)).toHaveAttribute('rowspan', '2');
    await expect(page.locator(SELECTED)).toHaveCount(1);

    const addRow = page.locator('[data-blok-table-add-row]');
    const lastRowCell = getCellAt(page, 2, 2);

    await lastRowCell.hover({ position: { x: 8, y: 8 } });
    console.log('AUD15 add-row count', await addRow.count());
    await addRow.click();
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-row]`)).toHaveCount(4);
    const counts = await rowCellCounts(page);

    console.log('AUD15', JSON.stringify(counts), await getCellAt(page, 1, 0).getAttribute('rowspan'));
    // Rows 1-2 x cols 0-1 are one cell: row 1 = origin + C2, row 2 = C3 only.
    expect(counts).toEqual([3, 2, 1, 3]);
    await expect(getCellAt(page, 1, 0)).toHaveAttribute('rowspan', '2');
  });

  test('AUD16 dragging a merge-locked row grip does not reorder rows', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await hoverCellAt(page, 0, 2);
    const grip = page.locator('[data-blok-table-grip-row="0"]');

    await expect(grip).toBeVisible();
    const g = assertBoundingBox(await grip.boundingBox(), 'grip');
    const dest = assertBoundingBox(await getCellAt(page, 2, 2).boundingBox(), 'dest');

    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, dest.y + dest.height - 2, { steps: 12 });
    await page.mouse.up();
    await expect(getCellAt(page, 2, 0)).toContainText('A3');
    await expect(getCellAt(page, 0, 2)).toContainText('C1');
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('rowspan', '2');
  });

  const rangeOfSelected = async (page: Page): Promise<string[]> => page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-table-cell-selected]'))
    .map(c => `${c.getAttribute('data-blok-table-cell-row')},${c.getAttribute('data-blok-table-cell-col')}`).sort());

  test('AUD17 Shift+ArrowRight from the end of a merged cell adds the column to its right', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await getCellAt(page, 0, 0).locator('[contenteditable="true"]').last().click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowRight');
    const sel = await rangeOfSelected(page);

    console.log('AUD17 selected', JSON.stringify(sel));
    expect(sel).toEqual(['0,0', '0,2', '1,2']);
  });

  test('AUD18 Shift+ArrowDown from the end of a merged cell adds the row below it', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await getCellAt(page, 0, 0).locator('[contenteditable="true"]').last().click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowDown');
    const sel = await rangeOfSelected(page);

    console.log('AUD18 selected', JSON.stringify(sel));
    expect(sel).toEqual(['0,0', '2,0', '2,1']);
  });

  test('AUD19 Shift+ArrowLeft from C1 swallows the whole merged cell', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await cellEditable(page, 0, 2).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowLeft');
    const sel = await rangeOfSelected(page);

    console.log('AUD19 selected', JSON.stringify(sel));
    expect(sel).toEqual(['0,0', '0,2', '1,2']);
    await openPill(page);
    await expect(page.getByText('Merge cells')).toBeVisible();
  });

  test('AUD20 ArrowDown from the merged cell last line lands in the row below; Tab goes to C1', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await getCellAt(page, 0, 0).locator('[contenteditable="true"]').last().click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    const down = await activeInfo(page);

    console.log('AUD20 after ArrowDown', JSON.stringify(down));
    expect(down.cellRow).toBe('2');

    await getCellAt(page, 0, 0).locator('[contenteditable="true"]').last().click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('Tab');
    const tab = await activeInfo(page);

    console.log('AUD20 after Tab', JSON.stringify(tab));
    expect([tab.cellRow, tab.cellCol]).toEqual(['0', '2']);
  });

  test('AUD21 add-column + control after merging the right column appends a full column', async ({ page }) => {
    await create3x3Table(page);
    await selectCells(page, 0, 2, 1, 2);
    await expect(page.locator(SELECTED)).toHaveCount(2);
    await openPill(page);
    await page.getByText('Merge cells').click();
    await expect(getCellAt(page, 0, 2)).toHaveAttribute('rowspan', '2');
    await expect(page.locator(SELECTED)).toHaveCount(1);
    await getCellAt(page, 2, 2).hover({ position: { x: 8, y: 8 } });
    await page.locator('[data-blok-table-add-col]').click();
    const counts = await rowCellCounts(page);

    console.log('AUD21', JSON.stringify(counts));
    expect(counts).toEqual([4, 3, 4]);
    await expect(getCellAt(page, 0, 2)).toHaveAttribute('rowspan', '2');
    await cellEditable(page, 1, 3).click();
    await page.keyboard.type('NEWCOL');
    await expect(getCellAt(page, 1, 3)).toContainText('NEWCOL');
  });

  test('AUD22 split from the pill of a merged cell holding the caret keeps the caret in the table', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await getCellAt(page, 0, 0).locator('[contenteditable="true"]').first().click({ position: { x: 8, y: 8 } });
    await expect(page.locator(SELECTED)).toHaveCount(1);
    await openPill(page);
    await expect(page.getByText('Split cell')).toBeVisible();
    await expect(page.getByText('Merge cells')).toHaveCount(0);
    await page.getByText('Split cell').click();
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(9);
    const info = await activeInfo(page);

    console.log('AUD22 active after split', JSON.stringify(info));
    expect(info.inTable).toBe(true);
  });

  test('AUD23 deleting the merge ORIGIN row keeps the merged content in the surviving row', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await gripAction(page, 'row', 0, [0, 2], 'Delete');
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-row]`)).toHaveCount(2);
    const counts = await rowCellCounts(page);
    const text = await getCellAt(page, 0, 0).innerText();

    console.log('AUD23', JSON.stringify(counts), JSON.stringify(text), await getCellAt(page, 0, 0).getAttribute('colspan'), await getCellAt(page, 0, 0).getAttribute('rowspan'));
    expect(counts).toEqual([2, 3]);
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('colspan', '2');
    await expect(getCellAt(page, 0, 2)).toContainText('C2');
  });

  test('AUD24 deleting the merge ORIGIN column keeps the merged cell in the surviving column', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);
    await gripAction(page, 'col', 0, [2, 0], 'Delete');
    const counts = await rowCellCounts(page);
    const text = await getCellAt(page, 0, 0).innerText();

    console.log('AUD24', JSON.stringify(counts), JSON.stringify(text), await getCellAt(page, 0, 0).getAttribute('colspan'), await getCellAt(page, 0, 0).getAttribute('rowspan'));
    expect(counts).toEqual([2, 1, 2]);
    await expect(getCellAt(page, 0, 0)).toHaveAttribute('rowspan', '2');
    await expect(getCellAt(page, 0, 1)).toContainText('C1');
  });
});

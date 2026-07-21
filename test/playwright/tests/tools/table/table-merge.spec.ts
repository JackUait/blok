// spec: Table cell merge / split, and structural ops through a merged region
// seed: test/playwright/tests/tools/table/table-cell-selection-pill.spec.ts

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

type SavedCell = {
  colspan?: number;
  rowspan?: number;
  mergedInto?: [number, number];
};

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

const savedContent = async (page: Page): Promise<SavedCell[][]> => {
  const saved = await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('blokInstance is not initialized');
    }

    return window.blokInstance.save();
  });

  return (saved.blocks[0].data as { content: SavedCell[][] }).content;
};

/** Merge the 2x2 block anchored at physical [0,0]. */
const mergeTopLeft2x2 = async (page: Page): Promise<void> => {
  await selectCells(page, 0, 0, 1, 1);
  await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(4);

  await openPill(page);
  await page.getByText('Merge cells').click();

  await expect(getCellAt(page, 0, 0)).toHaveAttribute('colspan', '2');

  // Merging clears the selection, which tears down the pill and its popover.
  // Wait for that: pressing into a cell while the popover is still up would be
  // swallowed by it, and the next gesture would silently select nothing.
  await expect(page.getByText('Merge cells')).toHaveCount(0);
  await expect(page.locator('[data-blok-table-selection-pill]')).toHaveCount(0);
};

test.describe('Table merge and split', () => {
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

  test('merging a 2x2 selection spans the origin in the DOM and in saved data, and splitting restores it', async ({ page }) => {
    await create3x3Table(page);

    await mergeTopLeft2x2(page);

    // DOM: the origin carries the 2x2 span, and the covered cells have no <td>.
    const origin = getCellAt(page, 0, 0);

    await expect(origin).toHaveAttribute('colspan', '2');
    await expect(origin).toHaveAttribute('rowspan', '2');
    await expect(getCellAt(page, 0, 1)).toHaveCount(0);
    await expect(getCellAt(page, 1, 0)).toHaveCount(0);
    await expect(getCellAt(page, 1, 1)).toHaveCount(0);

    // The merge footprint leaves 3x3 - 4 + 1 = 6 rendered cells.
    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(6);

    // saveBlok() output carries the same merge.
    const merged = await savedContent(page);

    expect(merged[0][0].colspan).toBe(2);
    expect(merged[0][0].rowspan).toBe(2);
    expect(merged[0][1].mergedInto).toEqual([0, 0]);
    expect(merged[1][0].mergedInto).toEqual([0, 0]);
    expect(merged[1][1].mergedInto).toEqual([0, 0]);

    // Split it again from the merged cell. Selecting the origin alone expands
    // the rectangle to its span, which is what offers "Split cell".
    await selectSingleCell(page, { row: 0, col: 0 }, { row: 0, col: 2 });
    await openPill(page);
    await page.getByText('Split cell').click();

    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(9);
    await expect(getCellAt(page, 0, 0)).not.toHaveAttribute('colspan', '2');
    await expect(getCellAt(page, 1, 1)).toHaveCount(1);

    const split = await savedContent(page);

    expect(split[0][0].colspan ?? 1).toBe(1);
    expect(split[0][0].rowspan ?? 1).toBe(1);
    expect(split[0][1].mergedInto).toBeUndefined();
    expect(split[1][1].mergedInto).toBeUndefined();
  });

  test('every cell of a merged table stays editable and addressable after a split', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    await selectSingleCell(page, { row: 0, col: 0 }, { row: 0, col: 2 });
    await openPill(page);
    await page.getByText('Split cell').click();

    await expect(page.locator(`${TABLE_SELECTOR} [data-blok-table-cell]`)).toHaveCount(9);

    // The cell revealed by the split must have a real editable target.
    const revealed = getCellAt(page, 1, 1).locator('[contenteditable="true"]');

    await revealed.click();
    await page.keyboard.type('TYPED');

    await expect(revealed).toContainText('TYPED');
  });

  test('undoing a merge never mints duplicate cell blocks or strands orphan children', async ({ page }) => {
    // Regression family: table-undo-setdata-duplication — a structural undo
    // rewinds the table's data.content, triggering a setData rebuild while
    // the cell blocks' holders still sit in the old detached grid. The merge
    // undo is the merged-cell shape of that class.
    await create3x3Table(page);

    const auditSaved = async (): Promise<{ ids: string[]; orphans: string[]; dangling: string[] }> => {
      return await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('blokInstance is not initialized');
        }

        const saved = await window.blokInstance.save();
        const table = saved.blocks.find(b => b.type === 'table');
        const grid = (table?.data as { content?: Array<Array<{ blocks?: string[] }>> })?.content ?? [];
        const refs = new Set(grid.flat().flatMap(cell => cell.blocks ?? []));
        const ids = saved.blocks.map(b => b.id ?? '');
        const idSet = new Set(ids);

        return {
          ids,
          orphans: saved.blocks
            .filter(b => (b as { parent?: string | null }).parent === table?.id && !refs.has(b.id ?? ''))
            .map(b => b.id ?? ''),
          dangling: [...refs].filter(id => !idSet.has(id)),
        };
      });
    };

    const initial = await auditSaved();

    await mergeTopLeft2x2(page);

    // Pace past the Yjs capture window (500ms) so the undo targets the merge alone.
    const pace = async (): Promise<void> => {
      await page.evaluate(async () => {
        await new Promise<void>(resolve => {
          window.setTimeout(resolve, 600);
        });
      });
    };

    await pace();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await pace();

    const after = await auditSaved();
    const initialIds = new Set(initial.ids);

    expect(after.orphans, `orphan table children after merge undo: ${JSON.stringify(after.orphans)}`).toStrictEqual([]);
    expect(after.dangling, `dangling grid refs after merge undo: ${JSON.stringify(after.dangling)}`).toStrictEqual([]);
    expect(
      after.ids.filter(id => !initialIds.has(id)),
      'merge undo minted brand-new blocks'
    ).toStrictEqual([]);
  });
});

test.describe('Table structural ops through a merged region', () => {
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

  /**
   * Open the grip menu for a column and run one of its items. `hoverRow` names
   * a row that actually RENDERS a cell in that column — inside a merge
   * footprint most rows do not.
   */
  const runColGripAction = async (
    page: Page,
    index: number,
    hoverRow: number,
    item: string
  ): Promise<void> => {
    await hoverCellAt(page, hoverRow, index);

    const grip = page.locator(`[data-blok-table-grip-col="${index}"]`);

    await expect(grip).toBeVisible();
    await grip.click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };

  const runRowGripAction = async (
    page: Page,
    index: number,
    hoverCol: number,
    item: string
  ): Promise<void> => {
    await hoverCellAt(page, index, hoverCol);

    const grip = page.locator(`[data-blok-table-grip-row="${index}"]`);

    await expect(grip).toBeVisible();
    await grip.click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };

  test('inserting a column INSIDE a colspan grows the merge instead of corrupting the grid', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    // Column 1 is covered by the merge — insert to its left, inside the
    // footprint. Row 2 is the only row that still renders a cell there.
    await runColGripAction(page, 1, 2, 'Insert column left');

    const origin = getCellAt(page, 0, 0);

    // The merge absorbed the new column: 2 -> 3 columns wide, still 2 rows tall.
    await expect(origin).toHaveAttribute('colspan', '3');
    await expect(origin).toHaveAttribute('rowspan', '2');

    // No phantom <td> inside the merge footprint. The origin now covers
    // rows 0-1 x cols 0-2, so row 0 renders the origin plus the one free cell,
    // and row 1 renders only that free cell.
    await expect(
      page.locator(`${TABLE_SELECTOR} [data-blok-table-cell-row="0"]`)
    ).toHaveCount(2);
    await expect(
      page.locator(`${TABLE_SELECTOR} [data-blok-table-cell-row="1"]`)
    ).toHaveCount(1);

    // Coordinates stay logical: the untouched cells kept their content, shifted
    // one column right.
    await expect(getCellAt(page, 0, 3)).toContainText('C1');
    await expect(getCellAt(page, 1, 3)).toContainText('C2');

    const content = await savedContent(page);

    expect(content[0]).toHaveLength(4);
    expect(content[0][0].colspan).toBe(3);
    expect(content[0][3].mergedInto).toBeUndefined();
  });

  test('inserting a row INSIDE a rowspan grows the merge instead of corrupting the grid', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    // Row 1 is covered by the merge — insert above it, inside the footprint.
    // Column 2 is the only column that still renders a cell in that row.
    await runRowGripAction(page, 1, 2, 'Insert row above');

    const origin = getCellAt(page, 0, 0);

    await expect(origin).toHaveAttribute('rowspan', '3');
    await expect(origin).toHaveAttribute('colspan', '2');

    // The inserted row carries only the free cell at column 2.
    const insertedRow = page.locator(`${TABLE_SELECTOR} [data-blok-table-cell-row="1"]`);

    await expect(insertedRow).toHaveCount(1);
    await expect(insertedRow).toHaveAttribute('data-blok-table-cell-col', '2');

    const content = await savedContent(page);

    expect(content).toHaveLength(4);
    expect(content[0][0].rowspan).toBe(3);
  });

  test('a row locked by a merge advertises that it cannot be dragged', async ({ page }) => {
    await create3x3Table(page);
    await mergeTopLeft2x2(page);

    // Rows 0 and 1 are held by the 2x2 rowspan; row 2 is free.
    await hoverCellAt(page, 0, 2);

    await expect(
      page.locator('[data-blok-table-grip-row="0"]')
    ).toHaveAttribute('data-blok-table-grip-drag-disabled', '');

    await hoverCellAt(page, 2, 0);

    await expect(
      page.locator('[data-blok-table-grip-row="2"]')
    ).not.toHaveAttribute('data-blok-table-grip-drag-disabled', '');
  });
});

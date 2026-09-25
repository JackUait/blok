// spec: specs/plan.md (Row and Column Grip Controls — Notion parity menu)
// seed: test/playwright/tests/tools/table/table-grips.spec.ts

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { activateColorTab } from '../../helpers/color-picker';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

const HOLDER_ID = 'blok';
const ROW_GRIP_ATTR = 'data-blok-table-grip-row';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

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

const createTable2x2 = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const data: OutputData = {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['A', 'B'], ['C', 'D']],
          },
        },
      ],
    };

    const tableClass: unknown = (window as unknown as { Blok: Record<string, unknown> }).Blok.Table;
    const blokConfig: Record<string, unknown> = {
      holder,
      data,
      tools: { table: { class: tableClass } },
    };
    const blok = new window.Blok(blokConfig);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

/**
 * A 2x2 table whose first row already carries a background colour, so a test can
 * exercise "clear contents" without first driving the colour picker.
 */
const createColoredTable = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const data = {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [
              [
                { blocks: [], text: 'A', color: '#fbecdd' },
                { blocks: [], text: 'B', color: '#fbecdd' },
              ],
              [
                { blocks: [], text: 'C' },
                { blocks: [], text: 'D' },
              ],
            ],
          },
        },
      ],
    } as unknown as OutputData;

    const tableClass: unknown = (window as unknown as { Blok: Record<string, unknown> }).Blok.Table;
    const blokConfig: Record<string, unknown> = {
      holder,
      data,
      tools: { table: { class: tableClass } },
    };
    const blok = new window.Blok(blokConfig);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const getCell = (page: Page, row: number, col: number) =>
  page.locator(`[data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`);

/**
 * Open the row grip's menu: hover a cell in the row so the grip appears, click it.
 */
const openRowGripMenu = async (page: Page, row: number): Promise<void> => {
  await getCell(page, row, 0).click();

  const rowGrip = page.locator(`[${ROW_GRIP_ATTR}="${row}"]`);

  await expect(rowGrip).toBeVisible();
  await rowGrip.click();
};

const saveTableData = async (page: Page): Promise<Array<Array<{ color?: string; blocks?: string[] }>>> => {
  const saved = await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('blokInstance is not initialized');
    }

    return window.blokInstance.save();
  });

  const table = saved.blocks.find(block => block.type === 'table');

  if (!table) {
    throw new Error('table block missing from saved data');
  }

  return (table.data as { content: Array<Array<{ color?: string; blocks?: string[] }>> }).content;
};

test.describe('Table grip menu — color, duplicate, clear', () => {
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

  test('grip → Color paints the whole row and the color persists through save()', async ({ page }) => {
    await createTable2x2(page);
    await openRowGripMenu(page, 0);

    const colorItem = page.getByText('Color', { exact: true });

    await expect(colorItem).toBeVisible();
    await colorItem.hover();

    const picker = page.locator('[data-blok-testid="cell-color-picker"]');

    await expect(picker).toBeVisible();
    await activateColorTab(page, 'cell-color', 'backgroundColor');

    await page.locator('[data-blok-testid="cell-color-swatch-backgroundColor-orange"]').click({ force: true });

    // Every cell of row 0 is painted; row 1 is untouched.
    await expect
      .poll(async () => getCell(page, 0, 0).evaluate(el => (el as HTMLElement).style.backgroundColor))
      .not.toBe('');
    await expect
      .poll(async () => getCell(page, 0, 1).evaluate(el => (el as HTMLElement).style.backgroundColor))
      .not.toBe('');
    expect(
      await getCell(page, 1, 0).evaluate(el => (el as HTMLElement).style.backgroundColor)
    ).toBe('');

    // ITEM A: picking a colour must NOT tear the grip menu down.
    await expect(page.getByText('Duplicate', { exact: true })).toBeVisible();

    const content = await saveTableData(page);

    expect(content[0][0].color).toBeTruthy();
    expect(content[0][1].color).toBeTruthy();
    expect(content[1][0].color).toBeFalsy();
  });

  test('grip → Duplicate copies the row content into a new row below', async ({ page }) => {
    await createTable2x2(page);
    await openRowGripMenu(page, 0);

    await page.getByText('Duplicate', { exact: true }).click();

    await expect(page.locator('[data-blok-table-row]')).toHaveCount(3);

    // The copy sits directly below the source and carries the same text...
    await expect(getCell(page, 1, 0)).toContainText('A');
    await expect(getCell(page, 1, 1)).toContainText('B');
    // ...and the original row that used to be second is now third.
    await expect(getCell(page, 2, 0)).toContainText('C');
  });

  test('grip → Clear contents wipes the text but keeps the row color', async ({ page }) => {
    // The row is coloured from the start, so the test drives exactly one gesture:
    // the clear itself.
    await createColoredTable(page);

    expect(
      await getCell(page, 0, 0).evaluate(el => (el as HTMLElement).style.backgroundColor)
    ).not.toBe('');

    await openRowGripMenu(page, 0);
    await page.getByRole('menuitem', { name: 'Clear contents', exact: true }).click();

    await expect(getCell(page, 0, 0)).not.toContainText('A');
    await expect(getCell(page, 0, 1)).not.toContainText('B');

    // Clearing CONTENTS is not clearing FORMATTING.
    expect(
      await getCell(page, 0, 0).evaluate(el => (el as HTMLElement).style.backgroundColor)
    ).not.toBe('');

    const content = await saveTableData(page);

    expect(content[0][0].color).toBeTruthy();
    expect(content[0][1].color).toBeTruthy();
  });
});

/**
 * 4x3 table whose cell (0,0) spans rows 0-2 and cols 0-1. Col 2 carries R0..R3.
 */
const createMergedTable = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const covered = { blocks: [], text: '', mergedInto: [0, 0] };
    const data = {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [
              [{ blocks: [], text: 'M', rowspan: 3, colspan: 2 }, covered, { blocks: [], text: 'R0' }],
              [covered, covered, { blocks: [], text: 'R1' }],
              [covered, covered, { blocks: [], text: 'R2' }],
              [{ blocks: [], text: 'X' }, { blocks: [], text: 'Y' }, { blocks: [], text: 'R3' }],
            ],
          },
        },
      ],
    } as unknown as OutputData;

    const tableClass: unknown = (window as unknown as { Blok: Record<string, unknown> }).Blok.Table;
    const blokConfig: Record<string, unknown> = {
      holder,
      data,
      tools: { table: { class: tableClass } },
    };
    const blok = new window.Blok(blokConfig);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

test.describe('Table grips over a merged cell', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('sliding from row 1 across a rowspan to the grip deletes row 1, not row 0', async ({ page }) => {
    await createMergedTable(page);
    await expect(getCell(page, 0, 0)).toHaveAttribute('rowspan', '3');

    const rowCell = await getCell(page, 1, 2).boundingBox();
    const originCell = await getCell(page, 0, 0).boundingBox();

    if (!rowCell || !originCell) {
      throw new Error('table cells have no box');
    }

    const y = rowCell.y + rowCell.height / 2;

    // Enter row 1 at col 2, then slide left across the merged cell to the table edge.
    await page.mouse.move(rowCell.x + rowCell.width / 2, y);
    await page.mouse.move(originCell.x + 2, y, { steps: 10 });
    await page.mouse.move(originCell.x, y, { steps: 2 });

    const visibleGrip = page.locator(`[${ROW_GRIP_ATTR}][data-blok-table-grip-visible]`);

    await expect(visibleGrip).toHaveAttribute(ROW_GRIP_ATTR, '1');

    await page.mouse.down();
    await page.mouse.up();
    await page.getByText('Delete', { exact: true }).click();

    await expect(page.getByText('R1', { exact: true })).toHaveCount(0);
    await expect(page.getByText('R0', { exact: true })).toBeVisible();
    await expect(page.locator('[data-blok-table-row]')).toHaveCount(3);
  });
});

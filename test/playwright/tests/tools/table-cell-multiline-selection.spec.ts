import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

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

const assertBoundingBox = (box: { x: number; y: number; width: number; height: number } | null, label: string): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

/**
 * Returns a locator for a specific cell in the table grid.
 */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

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
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<
          Record<string, { class: unknown } & Record<string, unknown>>
        >((accumulator, { name, className, config }) => {
          let toolClass: unknown = null;

          if (className) {
            toolClass = className.split('.').reduce(
              (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
              window
            ) ?? null;
          }

          if (!toolClass) {
            throw new Error(`Tool "${name}" is not available globally`);
          }

          return {
            ...accumulator,
            [name]: {
              class: toolClass,
              ...config,
            },
          };
        }, {});

        blokConfig.tools = resolvedTools;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      data,
      serializedTools,
    }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
  paragraph: {
    className: 'Blok.Paragraph',
  },
};

/**
 * Create a 2x2 table, then turn the first cell into three paragraph "lines"
 * the same way a user would: pressing Enter inside the cell creates a new
 * child block per line.
 */
const createTableWithMultilineCell = async (page: Page): Promise<void> => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [
              ['Line one', 'B1'],
              ['A2', 'B2'],
            ],
          },
        },
      ],
    },
  });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

  const firstCellEditable = getCell(page, 0, 0).locator('[contenteditable="true"]').first();

  await firstCellEditable.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Line two');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Line three');

  // Three separate line blocks now exist inside the first cell
  await expect(getCell(page, 0, 0).locator('[data-blok-component="paragraph"]')).toHaveCount(3);

  // Click outside the table so the drag under test starts from a neutral state
  await page.getByRole('heading', { name: 'Blok test page' }).click();
};

/**
 * Drag the mouse from the center of one locator to the center of another.
 */
const dragBetween = async (page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>): Promise<void> => {
  const fromBox = assertBoundingBox(await from.boundingBox(), 'drag start');
  const toBox = assertBoundingBox(await to.boundingBox(), 'drag end');

  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 12 });
  await page.mouse.up();
};

test.describe('table cell — selecting several lines inside one cell', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.afterEach(async ({ page }) => {
    await resetBlok(page);
  });

  test('dragging from one line to another selects both line blocks', async ({ page }) => {
    await createTableWithMultilineCell(page);

    const cell = getCell(page, 0, 0);
    const lineOne = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line one' });
    const lineTwo = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line two' });

    await dragBetween(page, lineOne, lineTwo);

    // Both dragged-over line blocks are selected...
    await expect(lineOne).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineTwo).toHaveAttribute('data-blok-selected', 'true');

    // ...but not the line that was not part of the drag, and not the whole table
    await expect(cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line three' }))
      .not.toHaveAttribute('data-blok-selected', 'true');
    await expect(page.locator(TABLE_SELECTOR)).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('dragging across all three lines selects all of them', async ({ page }) => {
    await createTableWithMultilineCell(page);

    const cell = getCell(page, 0, 0);
    const lineOne = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line one' });
    const lineThree = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line three' });

    await dragBetween(page, lineOne, lineThree);

    await expect(cell.locator('[data-blok-selected="true"]')).toHaveCount(3);
  });

  test('dragging back to the anchor line shrinks the selection again', async ({ page }) => {
    await createTableWithMultilineCell(page);

    const cell = getCell(page, 0, 0);
    const lineOne = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line one' });
    const lineTwo = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line two' });
    const lineThree = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line three' });

    const oneBox = assertBoundingBox(await lineOne.boundingBox(), 'line one');
    const threeBox = assertBoundingBox(await lineThree.boundingBox(), 'line three');
    const twoBox = assertBoundingBox(await lineTwo.boundingBox(), 'line two');

    await page.mouse.move(oneBox.x + oneBox.width / 2, oneBox.y + oneBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(threeBox.x + threeBox.width / 2, threeBox.y + threeBox.height / 2, { steps: 12 });
    await page.mouse.move(twoBox.x + twoBox.width / 2, twoBox.y + twoBox.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(lineOne).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineTwo).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineThree).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('pressing Delete removes the selected lines but keeps the cell editable', async ({ page }) => {
    await createTableWithMultilineCell(page);

    const cell = getCell(page, 0, 0);
    const lineOne = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line one' });
    const lineTwo = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line two' });

    await dragBetween(page, lineOne, lineTwo);
    await expect(cell.locator('[data-blok-selected="true"]')).toHaveCount(2);

    await page.keyboard.press('Delete');

    // The selected lines are gone, the remaining line survives
    await expect(cell.locator('[data-blok-component="paragraph"]')).toHaveCount(1);
    await expect(cell).toContainText('Line three');
    await expect(cell).not.toContainText('Line one');
  });

  test('text drag inside a single-line cell keeps the native text selection even when the pointer strays into cell padding', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['HTML tables supported', 'B1'],
                ['A2', 'B2'],
              ],
            },
          },
        ],
      },
    });

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    const line = getCell(page, 0, 0).locator('[data-blok-component="paragraph"]');
    const box = assertBoundingBox(await line.locator('[contenteditable="true"]').boundingBox(), 'cell line');
    const midY = box.y + box.height / 2;

    // A real hand drag is imprecise: start on the text, wander up into the
    // cell padding above the line, come back onto the text, release.
    // The start point sits well inside the text so the hover grip overlay at
    // the block's left edge cannot swallow the mousedown.
    await page.mouse.move(box.x + 30, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, midY, { steps: 4 });
    await page.mouse.move(box.x + 80, box.y - 6, { steps: 4 });
    await page.mouse.move(box.x + 110, midY, { steps: 4 });
    await page.mouse.up();

    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');

    expect(selectedText.length, `native text selection should survive the drag, got "${selectedText}"`).toBeGreaterThan(0);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(0);
  });

  test('text drag inside ONE line of a multi-line cell selects text, not the line block', async ({ page }) => {
    await createTableWithMultilineCell(page);

    const cell = getCell(page, 0, 0);
    const lineOne = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line one' });
    const box = assertBoundingBox(await lineOne.locator('[contenteditable="true"]').boundingBox(), 'line one');
    const midY = box.y + box.height / 2;

    await page.mouse.move(box.x + 30, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, midY, { steps: 4 });
    await page.mouse.move(box.x + 60, box.y - 6, { steps: 4 });
    await page.mouse.move(box.x + 75, midY, { steps: 4 });
    await page.mouse.up();

    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');

    expect(selectedText.length, `native text selection should survive the drag, got "${selectedText}"`).toBeGreaterThan(0);
    await expect(cell.locator('[data-blok-selected="true"]')).toHaveCount(0);
  });

  test('dragging on into a different cell falls back to cell-rectangle selection', async ({ page }) => {
    await createTableWithMultilineCell(page);

    const cell = getCell(page, 0, 0);
    const lineOne = cell.locator('[data-blok-component="paragraph"]', { hasText: 'Line one' });
    const otherCell = getCell(page, 0, 1);

    await dragBetween(page, lineOne, otherCell);

    // Cell-rectangle selection takes over: both cells are rect-selected
    await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(2);

    // Intra-cell block selection does not linger
    await expect(cell.locator('[data-blok-selected="true"]')).toHaveCount(0);
  });
});

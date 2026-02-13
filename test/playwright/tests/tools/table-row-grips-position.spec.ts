import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';

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
    container.style.border = '1px dotted #388AE5';

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
            // Handle dot notation (e.g., 'Blok.Table')
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
};

/**
 * Get the vertical center position of a row grip
 */
const getRowGripCenterY = async (page: Page, rowIndex: number): Promise<number> => {
  const grip = page.locator(`[data-blok-table-grip-row="${rowIndex}"]`);
  const box = await grip.boundingBox();

  if (!box) {
    throw new Error(`Row grip ${rowIndex} not found or not visible`);
  }

  return box.y + box.height / 2;
};

/**
 * Get the vertical center position of a row
 */
const getRowCenterY = async (page: Page, rowIndex: number): Promise<number> => {
  const row = page.locator(`[data-blok-table-row] >> nth=${rowIndex}`);
  const box = await row.boundingBox();

  if (!box) {
    throw new Error(`Row ${rowIndex} has no bounding box`);
  }

  return box.y + box.height / 2;
};

test.describe('table row grip positioning', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['', '', ''],
                ['', '', ''],
                ['', '', ''],
              ],
            },
          },
        ],
      },
    });
  });

  test('vertical pills reposition when cell content grows', async ({ page }) => {
    // Hover over first cell to show row grip
    const firstCell = page.locator('[data-blok-table-cell] >> nth=0');

    await firstCell.hover();

    // Wait for grip to become visible
    const row0Grip = page.locator('[data-blok-table-grip-row="0"][data-blok-table-grip-visible]');

    await expect(row0Grip).toBeVisible();

    // Get initial position of row 0 grip
    const initialGripY = await getRowGripCenterY(page, 0);
    const initialRowY = await getRowCenterY(page, 0);

    // Verify grip is initially centered on the row
    expect(Math.abs(initialGripY - initialRowY)).toBeLessThan(2);

    // Click into first cell to focus it
    await firstCell.click();

    // Add multi-line content to cause row height to grow
    const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

    await page.keyboard.type(multiLineContent);

    // Wait for the row to grow after content is typed (ResizeObserver fires)
    await expect.poll(async () => {
      return await getRowCenterY(page, 0);
    }).toBeGreaterThan(initialRowY);

    // Hover again to ensure grip is visible
    await firstCell.hover();

    // Get new position of row 0 grip after content growth
    const newGripY = await getRowGripCenterY(page, 0);
    const newRowY = await getRowCenterY(page, 0);

    // Assert: Row should be taller now
    expect(newRowY).toBeGreaterThan(initialRowY);

    // Assert: Grip should have moved down
    expect(newGripY).toBeGreaterThan(initialGripY);

    // Assert: Grip should still be vertically centered on the row
    expect(Math.abs(newGripY - newRowY)).toBeLessThan(2);
  });

  test('vertical pills reposition when cell content shrinks', async ({ page }) => {
    const firstCell = page.locator('[data-blok-table-cell] >> nth=0');

    // Click into first cell
    await firstCell.click();

    // Add multi-line content first
    const multiLineContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

    await page.keyboard.type(multiLineContent);

    // Wait for the row to grow after multi-line content is typed
    await expect.poll(async () => {
      const box = await firstCell.boundingBox();

      return box?.height ?? 0;
    }).toBeGreaterThan(30);

    // Hover to show grip
    await firstCell.hover();

    const row0Grip = page.locator('[data-blok-table-grip-row="0"][data-blok-table-grip-visible]');

    await expect(row0Grip).toBeVisible();

    // Get position with multi-line content
    const initialGripY = await getRowGripCenterY(page, 0);
    const initialRowY = await getRowCenterY(page, 0);

    // Select all and delete
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');

    // Type single line
    await page.keyboard.type('Single line');

    // Wait for the row to shrink after content is reduced
    await expect.poll(async () => {
      return await getRowCenterY(page, 0);
    }).toBeLessThan(initialRowY);

    // Hover again
    await firstCell.hover();

    // Get new position after content shrink
    const newGripY = await getRowGripCenterY(page, 0);
    const newRowY = await getRowCenterY(page, 0);

    // Assert: Row should be shorter now
    expect(newRowY).toBeLessThan(initialRowY);

    // Assert: Grip should have moved up
    expect(newGripY).toBeLessThan(initialGripY);

    // Assert: Grip should still be vertically centered
    expect(Math.abs(newGripY - newRowY)).toBeLessThan(2);
  });

  test('vertical pills reposition for multiple rows simultaneously', async ({ page }) => {
    // Click into first cell of row 0
    const firstCell = page.locator('[data-blok-table-cell] >> nth=0');

    await firstCell.click();
    await page.keyboard.type('Row 0 content\nLine 2\nLine 3');

    // Move to first cell of row 1 (Tab to next cell, then Tab through row 0, then to row 1)
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // Now in row 1, cell 0

    await page.keyboard.type('Row 1 content\nLine 2\nLine 3\nLine 4');

    // Wait for row 1 to grow after content is typed
    await expect.poll(async () => {
      const box = await page.locator('[data-blok-table-row] >> nth=1').boundingBox();

      return box?.height ?? 0;
    }).toBeGreaterThan(30);

    // Hover over row 0 cell to show its grip
    await firstCell.hover();

    const row0Grip = page.locator('[data-blok-table-grip-row="0"][data-blok-table-grip-visible]');

    await expect(row0Grip).toBeVisible();

    const row0GripY = await getRowGripCenterY(page, 0);
    const row0CenterY = await getRowCenterY(page, 0);

    // Verify row 0 grip is centered
    expect(Math.abs(row0GripY - row0CenterY)).toBeLessThan(2);

    // Hover over row 1 cell to show its grip
    const row1FirstCell = page.locator('[data-blok-table-row] >> nth=1').locator('[data-blok-table-cell] >> nth=0');

    await row1FirstCell.hover();

    const row1Grip = page.locator('[data-blok-table-grip-row="1"][data-blok-table-grip-visible]');

    await expect(row1Grip).toBeVisible();

    const row1GripY = await getRowGripCenterY(page, 1);
    const row1CenterY = await getRowCenterY(page, 1);

    // Verify row 1 grip is centered
    expect(Math.abs(row1GripY - row1CenterY)).toBeLessThan(2);

    // Verify row 1 grip is below row 0 grip
    expect(row1GripY).toBeGreaterThan(row0GripY);
  });
});

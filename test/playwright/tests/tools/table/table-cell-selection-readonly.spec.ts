/* eslint-disable playwright/no-nth-methods */
// Regression: cell selection must NOT appear in readonly mode

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
  readOnly?: boolean;
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

const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page
    .locator(`${TABLE_SELECTOR} [data-blok-table-row]`).nth(row)
    .locator('[data-blok-table-cell]').nth(col);

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
  const { data = null, tools = {}, readOnly = false } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig, readOnly: isReadOnly }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
        readOnly: isReadOnly,
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
      readOnly,
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

test.describe('Cell Selection in Readonly Mode', () => {
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

  test('Clicking a cell in readonly mode does not show blue selection', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
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

    // Click on cell (1,1)
    const cell = getCell(page, 1, 1);
    const box = assertBoundingBox(await cell.boundingBox(), 'cell [1,1]');

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // No selection overlay should appear
    await expect(page.locator('[data-blok-table-selection-overlay]')).toHaveCount(0);

    // No cells should be marked as selected
    await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(0);

    // No selection pill should appear
    await expect(page.locator('[data-blok-table-selection-pill]')).toHaveCount(0);
  });

  test('Dragging across cells in readonly mode does not show blue selection', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      readOnly: true,
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

    // Drag from cell (0,0) to cell (1,1)
    const startCell = getCell(page, 0, 0);
    const endCell = getCell(page, 1, 1);

    const startBox = assertBoundingBox(await startCell.boundingBox(), 'cell [0,0]');
    const endBox = assertBoundingBox(await endCell.boundingBox(), 'cell [1,1]');

    await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2, { steps: 10 });
    await page.mouse.up();

    // No selection overlay should appear
    await expect(page.locator('[data-blok-table-selection-overlay]')).toHaveCount(0);

    // No cells should be marked as selected
    await expect(page.locator('[data-blok-table-cell-selected]')).toHaveCount(0);

    // No selection pill should appear
    await expect(page.locator('[data-blok-table-selection-pill]')).toHaveCount(0);
  });
});

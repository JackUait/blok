import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
};

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

test.describe('table creation selection', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('new table shows blue cell selection overlay on first cell after creation', async ({ page }) => {
    await createBlok(page, { tools: defaultTools });

    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"] >> nth=0`);

    await firstParagraph.click();
    await page.keyboard.type('/');

    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    await tableToolboxItem.click({ force: true });

    // Wait for the table to appear
    const tableComponent = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`);

    await expect(tableComponent).toBeVisible();

    // The selection overlay should be visible on the first cell
    const selectionOverlay = page.locator('[data-blok-table-selection-overlay]');

    await expect(selectionOverlay).toBeVisible();

    // The first cell should be marked as selected
    const selectedCell = page.locator('[data-blok-table-cell-selected]');

    await expect(selectedCell).toHaveCount(1);
  });

  test('clicking outside the table clears the cell selection overlay', async ({ page }) => {
    await createBlok(page, { tools: defaultTools });

    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"] >> nth=0`);

    await firstParagraph.click();
    await page.keyboard.type('/');

    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    await tableToolboxItem.click({ force: true });

    const tableComponent = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`);

    await expect(tableComponent).toBeVisible();

    // Wait for the selection overlay to appear
    const selectionOverlay = page.locator('[data-blok-table-selection-overlay]');

    await expect(selectionOverlay).toBeVisible();

    // Click outside the table to clear selection via pointerdown on document
    const tableBox = await tableComponent.boundingBox();
    const clickY = (tableBox?.y ?? 0) + (tableBox?.height ?? 0) + 50;

    await page.mouse.click(200, clickY);

    // The selection overlay should be removed after clicking outside
    await expect(selectionOverlay).not.toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

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

  test('new table block shows blue selection after creation', async ({ page }) => {
    await createBlok(page, { tools: defaultTools });

    // Click the first empty paragraph
    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"] >> nth=0`);

    await firstParagraph.click();

    // Type '/' to open the toolbox
    await page.keyboard.type('/');

    // Wait for the toolbox popover to open
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    // Click the Table entry in the toolbox
    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    await tableToolboxItem.click({ force: true });

    // Wait for the table to appear
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // The table block's holder should have data-blok-selected="true"
    const tableBlockHolder = page.locator('[data-blok-element][data-blok-component="table"]');

    await expect(tableBlockHolder).toHaveAttribute('data-blok-selected', 'true');
  });

  test('clicking into a table cell clears the blue selection', async ({ page }) => {
    await createBlok(page, { tools: defaultTools });

    // Click the first empty paragraph
    const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"] >> nth=0`);

    await firstParagraph.click();

    // Type '/' to open the toolbox
    await page.keyboard.type('/');

    // Wait for the toolbox popover to open
    await page.waitForFunction(
      () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
      { timeout: 3000 }
    );

    // Click the Table entry
    const tableToolboxItem = page.locator('[data-blok-item-name="table"]');

    await tableToolboxItem.click({ force: true });

    // Wait for the table to appear
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    // Wait for the blue selection to appear (set via requestAnimationFrame)
    const tableBlockHolder = page.locator('[data-blok-element][data-blok-component="table"]');

    await expect(tableBlockHolder).toHaveAttribute('data-blok-selected', 'true');

    // Click into the first cell to start editing
    const firstCell = page.locator('[data-blok-table-cell] >> nth=0');

    await firstCell.click();

    // After clicking a cell, the block selection should be cleared
    await expect(tableBlockHolder).not.toHaveAttribute('data-blok-selected', 'true');
  });
});

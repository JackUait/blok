// spec: Table Tool Toolbox Search Terms
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const TABLE_ITEM_VISIBLE_SELECTOR = `${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="table"]:not([data-blok-hidden])`;

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
 * Open the toolbox slash menu and type a search query.
 * Waits for the popover to be in the opened state before returning.
 */
const openToolboxAndSearch = async (page: Page, searchQuery: string): Promise<void> => {
  const firstParagraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

  // Click the empty paragraph and type '/' to open the slash menu
  await firstParagraph.click();
  await page.keyboard.type('/');

  // Wait for the toolbox popover to be opened
  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]') !== null,
    { timeout: 3000 }
  );

  // Type the search query to filter toolbox items
  await page.keyboard.type(searchQuery);
};

test.describe('Table Tool Toolbox Search Terms', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test("table tool is discoverable in the slash menu by searching 'grid'", async ({ page }) => {
    // Init editor with table tool registered
    await createBlok(page, { tools: defaultTools });

    // Click empty paragraph, type '/' then type search term 'grid'
    await openToolboxAndSearch(page, 'grid');

    // Verify: 'Table' toolbox item remains visible in results (not hidden)
    const tableItem = page.locator(TABLE_ITEM_VISIBLE_SELECTOR);

    await expect(tableItem).toHaveCount(1);
  });

  test("table tool is discoverable in the slash menu by searching 'spreadsheet'", async ({ page }) => {
    // Init editor with table tool registered
    await createBlok(page, { tools: defaultTools });

    // Click empty paragraph, type '/' then type search term 'spreadsheet'
    await openToolboxAndSearch(page, 'spreadsheet');

    // Verify: 'Table' toolbox item remains visible in results (not hidden)
    const tableItem = page.locator(TABLE_ITEM_VISIBLE_SELECTOR);

    await expect(tableItem).toHaveCount(1);
  });
});

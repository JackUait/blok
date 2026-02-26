// spec: specs/table-tool-test-plan.md (Toolbar Visibility in Table Cells)
// seed: test/playwright/tests/ui/table-toolbar-visibility.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';

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

test.describe('Toolbar Visibility in Table Cells', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('The plus button is hidden when a table cell is focused', async ({ page }) => {
    // 1. Initialize editor with a table block (2x2 content)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Cell A', 'Cell B'], ['Cell C', 'Cell D']],
            },
          },
        ],
      },
    });

    // 2. Click inside the first table cell
    const firstCell = page.locator(CELL_SELECTOR).filter({ hasText: 'Cell A' });

    await firstCell.click();

    // 3. Wait 300ms for toolbar state to settle
    // eslint-disable-next-line playwright/no-wait-for-timeout -- checking non-appearance requires a brief wait
    await page.waitForTimeout(300);

    // 4. Verify the plus button is hidden
    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeHidden();
  });

  test('The settings toggler is hidden when a table cell is focused', async ({ page }) => {
    // 1. Initialize editor with a table block (2x2 content)
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Cell A', 'Cell B'], ['Cell C', 'Cell D']],
            },
          },
        ],
      },
    });

    // 2. Click inside the first table cell
    const firstCell = page.locator(CELL_SELECTOR).filter({ hasText: 'Cell A' });

    await firstCell.click();

    // 3. Wait 300ms for toolbar state to settle
    // eslint-disable-next-line playwright/no-wait-for-timeout -- checking non-appearance requires a brief wait
    await page.waitForTimeout(300);

    // 4. Verify the settings toggler is hidden
    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeHidden();
  });

  test('Toolbar buttons reappear when switching from table cell to regular paragraph', async ({ page }) => {
    // 1. Initialize editor with a paragraph block and a table block
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Regular paragraph',
            },
          },
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Cell A', 'Cell B'], ['Cell C', 'Cell D']],
            },
          },
        ],
      },
    });

    // 2. Click inside the table cell (toolbar hides)
    const firstCell = page.locator(CELL_SELECTOR).filter({ hasText: 'Cell A' });

    await firstCell.click();

    // eslint-disable-next-line playwright/no-wait-for-timeout -- checking non-appearance requires a brief wait
    await page.waitForTimeout(300);

    // 3. Click the paragraph block above the table
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).filter({ hasText: 'Regular paragraph' });

    await paragraph.click();

    // 4. Wait 300ms for toolbar state to settle
    // eslint-disable-next-line playwright/no-wait-for-timeout -- checking non-appearance requires a brief wait
    await page.waitForTimeout(300);

    // 5. Verify the plus button and settings toggler become visible again
    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await expect(settingsButton).toBeVisible();
  });
});

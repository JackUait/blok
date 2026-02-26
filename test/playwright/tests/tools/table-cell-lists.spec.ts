import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const CELL_BLOCKS_SELECTOR = '[data-blok-table-cell-blocks]';
const BLOCK_ELEMENT_SELECTOR = '[data-blok-element]';
const CELL_EDITABLE_SELECTOR = `${CELL_SELECTOR} [contenteditable="true"]`;

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
            // Handle dot notation (e.g., 'Blok.Header')
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
 * Helper to create a 2x2 table with empty cells
 */
const create2x2Table = async (page: Page): Promise<void> => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['', ''], ['', '']],
          },
        },
      ],
    },
  });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
};

test.describe('table cells — always-blocks model', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('basic cell behavior', () => {
    test('table cells contain paragraph blocks on creation', async ({ page }) => {
      await create2x2Table(page);

      // Every cell should have a blocks container
      const cellBlocksContainers = page.locator(CELL_BLOCKS_SELECTOR);

      await expect(cellBlocksContainers).toHaveCount(4);

      // Each blocks container should have at least one block element inside
      // Block holders use data-blok-element attribute
      for (let i = 0; i < 4; i++) {
        // eslint-disable-next-line playwright/no-nth-methods -- iterating over all cells by index
        const container = cellBlocksContainers.nth(i);
        const blocks = container.locator(BLOCK_ELEMENT_SELECTOR);

        await expect(blocks).toHaveCount(1);
      }
    });

    test('typing in a cell shows text', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area (the paragraph block inside the cell)
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();
      await page.keyboard.type('Hello world');

      await expect(firstEditable).toContainText('Hello world');
    });

    test('tab moves focus to next cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();
      await page.keyboard.type('Cell 1');

      // Tab to move to the next cell
      await page.keyboard.press('Tab');

      // Type in the second cell
      await page.keyboard.type('Cell 2');

      // Verify the second cell contains the typed text
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell's editable
      const secondEditable = page.locator(CELL_EDITABLE_SELECTOR).nth(1);

      await expect(secondEditable).toContainText('Cell 2');
    });

    test('cell always has at least one block', async ({ page }) => {
      await create2x2Table(page);

      // Each cell should have a blocks container with at least one block
      const cells = page.locator(CELL_SELECTOR);

      await expect(cells).toHaveCount(4);
      const cellCount = 4;

      for (let i = 0; i < cellCount; i++) {
        // eslint-disable-next-line playwright/no-nth-methods -- iterating over all cells by index
        const cell = cells.nth(i);
        const blocksContainer = cell.locator(CELL_BLOCKS_SELECTOR);

        await expect(blocksContainer).toBeVisible();

        const blocks = blocksContainer.locator(BLOCK_ELEMENT_SELECTOR);

        await expect(blocks).toHaveCount(1);
      }
    });
  });

  test.describe('multiple blocks in cells', () => {
    test('enter creates new content line in same cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area
      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();
      await page.keyboard.type('First line');

      // Press Enter — the table tool has enableLineBreaks, so Enter creates
      // a new line within the same block (soft break) or a new block
      // depending on the editor wiring
      await page.keyboard.press('Enter');
      await page.keyboard.type('Second line');

      // Verify both lines of text appear within the first cell
      // eslint-disable-next-line playwright/no-nth-methods -- first() targets the first cell
      const firstCell = page.locator(CELL_SELECTOR).first();

      await expect(firstCell).toContainText('First line');
      await expect(firstCell).toContainText('Second line');
    });
  });

  test.describe('placeholder suppression', () => {
    /**
     * Get the computed ::before pseudo-element content for an element.
     * Returns 'none' or '' when no placeholder is visible.
     */
    const getBeforePseudoContent = (locator: Locator): Promise<string> => {
      return locator.evaluate((el) => {
        const view = el.ownerDocument.defaultView;

        if (!view) {
          return 'none';
        }

        return view.getComputedStyle(el, '::before').getPropertyValue('content').replace(/['"]/g, '');
      });
    };

    test('paragraph inside table cell shows no placeholder when focused', async ({ page }) => {
      await create2x2Table(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();

      const content = await getBeforePseudoContent(firstEditable);

      expect(content === 'none' || content === '').toBeTruthy();
    });

    test('new paragraph created by Enter in table cell shows no placeholder', async ({ page }) => {
      await create2x2Table(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();
      await page.keyboard.type('First line');

      // Press Enter to create a new paragraph block inside the cell
      await page.keyboard.press('Enter');

      // The new paragraph's editable should have no placeholder
      // eslint-disable-next-line playwright/no-nth-methods -- second editable in cell is the new paragraph
      const firstCell = page.locator(CELL_SELECTOR).first();
      const editables = firstCell.locator('[contenteditable="true"]');

      // Wait for the new editable to appear
      await expect(editables).toHaveCount(2);

      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) targets the second (new) editable
      const newEditable = editables.nth(1);

      const content = await getBeforePseudoContent(newEditable);

      expect(content === 'none' || content === '').toBeTruthy();
    });

    test('paragraph placeholder does not appear after clearing text in table cell', async ({ page }) => {
      await create2x2Table(page);

      // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();
      await page.keyboard.type('temp');

      await page.keyboard.press(SELECT_ALL_SHORTCUT);
      await page.keyboard.press('Backspace');

      const content = await getBeforePseudoContent(firstEditable);

      expect(content === 'none' || content === '').toBeTruthy();
    });
  });

  test.describe('toolbar suppression', () => {
    test('block toolbar should not appear for blocks inside table cells', async ({ page }) => {
      await create2x2Table(page);

      // Click into a cell's editable area to give it focus
      // eslint-disable-next-line playwright/no-nth-methods -- first() targets the first cell
      const firstEditable = page.locator(CELL_EDITABLE_SELECTOR).first();

      await firstEditable.click();

      // Hover over the cell block to trigger the block-hovered event
      await firstEditable.hover();

      // Wait a moment for toolbar to potentially appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- checking non-appearance requires a brief wait
      await page.waitForTimeout(300);

      // The plus button and settings toggler should not be visible for cell blocks
      const plusButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`);
      const settingsToggler = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`);

      await expect(plusButton).toBeHidden();
      await expect(settingsToggler).toBeHidden();
    });
  });

  test.describe('cell navigation', () => {
    test('tab at end of row wraps to next row', async ({ page }) => {
      await create2x2Table(page);

      // Click into the second cell (last cell of first row)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(1) needed to target second cell's editable
      const secondEditable = page.locator(CELL_EDITABLE_SELECTOR).nth(1);

      await secondEditable.click();
      await page.keyboard.type('End of row 1');

      // Tab should wrap to first cell of second row
      await page.keyboard.press('Tab');
      await page.keyboard.type('Start of row 2');

      // Verify text landed in the first cell of the second row (cell index 2)
      // eslint-disable-next-line playwright/no-nth-methods -- nth(2) targets the third cell (first cell of second row)
      const thirdEditable = page.locator(CELL_EDITABLE_SELECTOR).nth(2);

      await expect(thirdEditable).toContainText('Start of row 2');
    });
  });
});

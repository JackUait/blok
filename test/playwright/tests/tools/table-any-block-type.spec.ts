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
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const TOOLBOX_CONTAINER_SELECTOR = `${TOOLBOX_POPOVER_SELECTOR} [data-blok-testid="popover-container"]`;
const TOOLBOX_ITEM_SELECTOR = `${TOOLBOX_POPOVER_SELECTOR} [data-blok-testid="popover-item"]`;

/**
 * Returns a locator for a specific cell in the table grid.
 * Uses Playwright locator chaining with data-attribute selectors.
 */
const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`[data-blok-table-cell] >> nth=${col}`);

/**
 * Returns a locator for the editable area inside a specific cell.
 */
const getCellEditable = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  getCell(page, row, col).locator('[contenteditable="true"]');

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
  header: {
    className: 'Blok.Header',
  },
  list: {
    className: 'Blok.List',
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

/**
 * Helper to paste HTML content into the currently focused element
 */
const pasteHtml = async (page: Page, html: string): Promise<void> => {
  await page.evaluate((pasteData) => {
    const activeElement = document.activeElement;

    if (!activeElement) {
      throw new Error('No active element to paste into');
    }

    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => {
          if (type === 'text/html') {
            return pasteData;
          }

          return '';
        },
        types: ['text/html'],
      },
    });

    activeElement.dispatchEvent(pasteEvent);
  }, html);
};

test.describe('table cells — any block type', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('slash menu in table cells', () => {
    test('slash menu opens in cell when typing /', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell's editable area
      await getCellEditable(page, 0, 0).click();
      await page.keyboard.type('/');

      // The toolbox popover container should become visible
      await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();
    });


    test('table tool does not appear in toolbox inside a cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell
      await getCellEditable(page, 0, 0).click();
      await page.keyboard.type('/');

      // Wait for toolbox to open
      await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

      // "Table" should NOT appear among the visible toolbox items
      const tableItem = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="table"]:not([data-blok-hidden])`);

      await expect(tableItem).toHaveCount(0);
    });

    test('toolbox popover is positioned near the caret inside table cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into the second row, second column cell (bottom-right)
      // This ensures the cell is not at position (0,0) so we can verify positioning
      await getCellEditable(page, 1, 1).click();
      await page.keyboard.type('/');

      // Wait for toolbox to open (check for opened attribute since popover may be positioned off-screen)
      const toolboxPopover = page.locator(TOOLBOX_POPOVER_SELECTOR);
      await expect(toolboxPopover).toHaveAttribute('data-blok-popover-opened', 'true');

      // Get the bounding boxes
      const cellBox = await getCellEditable(page, 1, 1).boundingBox();
      const popoverBox = await toolboxPopover.boundingBox();

      // Assert bounding boxes exist
      expect(cellBox, 'Cell should have a bounding box').toBeTruthy();
      expect(popoverBox, 'Popover should have a bounding box').toBeTruthy();

      // The popover should be positioned near the cell, not at (0, 0) or off-screen
      // We check that:
      // 1. Popover is not at top-left corner (0, 0)
      // 2. Popover's top is reasonably close to the cell's vertical position
      //    (within 200px allows for popover height and spacing)
      // 3. Popover is within the viewport (not positioned off-screen)
      const isNearTopLeft = popoverBox!.x < 10 && popoverBox!.y < 10;
      const isNearCell = Math.abs(popoverBox!.y - cellBox!.y) < 200;
      const isInViewport = popoverBox!.x >= 0 && popoverBox!.y >= 0 &&
                           popoverBox!.x < 2000 && popoverBox!.y < 2000;

      expect(isNearTopLeft, 'Popover should not be at top-left (0, 0)').toBe(false);
      expect(isInViewport, `Popover should be in viewport (x=${popoverBox!.x}, y=${popoverBox!.y})`).toBe(true);
      expect(isNearCell, `Popover (y=${popoverBox!.y}) should be near cell (y=${cellBox!.y})`).toBe(true);
    });
  });

  test.describe('markdown shortcuts in table cells', () => {
    test.skip('typing "# " converts paragraph to heading in cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell
      await getCellEditable(page, 0, 0).click();
      await page.keyboard.type('# Title');

      // The cell should now contain a heading block with "Title"
      const firstCell = getCell(page, 0, 0);
      const headingInCell = firstCell.locator('[data-blok-tool="header"]');

      await expect(headingInCell).toBeVisible();
      await expect(headingInCell).toContainText('Title');
    });

    test('typing "- " converts paragraph to list in cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell
      await getCellEditable(page, 0, 0).click();
      await page.keyboard.type('- Item');

      // The cell should now contain a list block
      const firstCell = getCell(page, 0, 0);
      const listInCell = firstCell.locator('[data-blok-tool="list"]');

      await expect(listInCell).toBeVisible();
      await expect(listInCell).toContainText('Item');
    });
  });

  test.describe('html paste in table cells', () => {
    test.skip('pasting <h2> HTML creates heading block in cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell
      await getCellEditable(page, 0, 0).click();

      // Paste HTML heading content
      await pasteHtml(page, '<h2>Pasted</h2>');

      // The cell should now contain a heading block with "Pasted"
      const firstCell = getCell(page, 0, 0);
      const headingInCell = firstCell.locator('[data-blok-tool="header"]');

      await expect(headingInCell).toBeVisible();
      await expect(headingInCell).toContainText('Pasted');
    });

    test('pasting <ul> HTML creates list block in cell', async ({ page }) => {
      await create2x2Table(page);

      // Click into first cell
      await getCellEditable(page, 0, 0).click();

      // Paste HTML list content
      await pasteHtml(page, '<ul><li>A</li><li>B</li></ul>');

      // The cell should now contain a list block
      const firstCell = getCell(page, 0, 0);
      const listInCell = firstCell.locator('[data-blok-tool="list"]');

      // Paste may create one list block per <li>, so expect at least one
      await expect(listInCell.first()).toBeVisible();
      await expect(firstCell).toContainText('A');
    });
  });
});

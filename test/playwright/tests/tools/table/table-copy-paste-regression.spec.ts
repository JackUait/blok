// Regression test for the table copy-paste bug:
// When copying a table using `application/x-blok` MIME type and pasting it,
// cell content previously appeared outside the table as standalone paragraphs
// and the original table's cells were emptied.
//
// Fix: two-pass insertion in blok-data-handler.ts — children first, then table
// with remapped IDs.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
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

test.describe('Table copy-paste regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    // Create editor with a leading empty paragraph (used as paste target) and
    // a 2x2 table with known cell content.
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          { type: 'paragraph', data: { text: '' } },
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                ['Cell A1', 'Cell B1'],
                ['Cell A2', 'Cell B2'],
              ],
            },
          },
        ],
      },
    });
  });

  test('pasted table has correct cell content and does not leak paragraphs outside the table', async ({ page }) => {
    // --- Step 1: Save the editor state to get real block IDs ---
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();
    expect(savedData?.blocks).toBeDefined();

    // Find the table block in saved output
    const tableBlock = savedData?.blocks.find(
      (b: { type: string }) => b.type === 'table'
    );

    expect(tableBlock).toBeDefined();

    // The table's id in saved output is the real block ID
    const tableId = tableBlock?.id as string;

    expect(tableId).toBeTruthy();

    // content is { blocks: string[] }[][] — extract all child paragraph IDs
    const tableContent = tableBlock?.data.content as { blocks: string[] }[][];

    expect(tableContent).toHaveLength(2);
    expect(tableContent[0]).toHaveLength(2);
    expect(tableContent[1]).toHaveLength(2);

    // Collect all paragraph IDs referenced by the table cells
    const allCellParaIds: string[] = tableContent.flatMap(
      (row: { blocks: string[] }[]) => row.flatMap((cell: { blocks: string[] }) => cell.blocks)
    );

    expect(allCellParaIds.length).toBeGreaterThanOrEqual(4);

    // Find the paragraph blocks that are children of the table
    const childParaBlocks = savedData?.blocks.filter(
      (b: { type: string; id?: string }) =>
        b.type === 'paragraph' && b.id !== undefined && allCellParaIds.includes(b.id)
    ) as Array<{ id: string; type: string; data: { text: string } }>;

    expect(childParaBlocks.length).toBe(allCellParaIds.length);

    // --- Step 2: Build the application/x-blok clipboard payload ---
    // The format is a JSON array of BlokClipboardBlock objects:
    // table block first (root), then child paragraph blocks.
    const clipboardPayload = JSON.stringify([
      {
        id: tableId,
        tool: 'table',
        data: tableBlock?.data,
        parentId: null,
        contentIds: allCellParaIds,
      },
      ...childParaBlocks.map((para) => ({
        id: para.id,
        tool: 'paragraph',
        data: para.data,
        parentId: tableId,
        contentIds: [],
      })),
    ]);

    // --- Step 3: Click the leading paragraph to set focus, then paste ---
    // eslint-disable-next-line playwright/no-nth-methods -- first() targets the leading empty paragraph explicitly
    const leadingParagraph = page
      .locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`)
      .first();

    await leadingParagraph.click();

    await leadingParagraph.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
      const pasteEvent = Object.assign(new Event('paste', {
        bubbles: true,
        cancelable: true,
      }), {
        clipboardData: {
          getData: (type: string): string => pasteData[type] ?? '',
          types: Object.keys(pasteData),
        },
      });

      element.dispatchEvent(pasteEvent);
    }, { 'application/x-blok': clipboardPayload });

    // --- Step 4: Wait for the second table to appear ---
    const tables = page.locator(TABLE_SELECTOR);

    await expect(tables).toHaveCount(2, { timeout: 5000 });

    // --- Step 5: Verify pasted table has correct cell content ---
    const pastedTable = tables.nth(1);
    const pastedCells = pastedTable.locator(CELL_SELECTOR);

    await expect(pastedCells).toHaveCount(4);
    await expect(pastedCells.filter({ hasText: 'Cell A1' })).toHaveCount(1);
    await expect(pastedCells.filter({ hasText: 'Cell B1' })).toHaveCount(1);
    await expect(pastedCells.filter({ hasText: 'Cell A2' })).toHaveCount(1);
    await expect(pastedCells.filter({ hasText: 'Cell B2' })).toHaveCount(1);

    // --- Step 6: Verify no paragraph blocks leaked outside the tables ---
    // Top-level paragraphs are those NOT nested inside a table cell.
    // After paste, the only top-level paragraph should be the leading empty one
    // (the one we pasted into). Cell content must remain inside the table.
    const cellTexts = ['Cell A1', 'Cell B1', 'Cell A2', 'Cell B2'];

    for (const cellText of cellTexts) {
      // A paragraph with this text must NOT exist outside a table cell
      const leakedParagraph = page.locator(
        `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]:not([data-blok-table-cell] *)`
      ).filter({ hasText: cellText });

      await expect(leakedParagraph).toHaveCount(0);
    }

    // --- Step 7: Verify original table still has its content ---
    const originalTable = tables.nth(0);
    const originalCells = originalTable.locator(CELL_SELECTOR);

    await expect(originalCells).toHaveCount(4);
    await expect(originalCells.filter({ hasText: 'Cell A1' })).toHaveCount(1);
    await expect(originalCells.filter({ hasText: 'Cell B1' })).toHaveCount(1);
    await expect(originalCells.filter({ hasText: 'Cell A2' })).toHaveCount(1);
    await expect(originalCells.filter({ hasText: 'Cell B2' })).toHaveCount(1);
  });
});

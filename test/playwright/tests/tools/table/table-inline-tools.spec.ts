// spec: Inline Tools Inside Table Cells
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const INLINE_TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid=inline-toolbar]`;

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
 * Returns the first contenteditable element inside the cell at the given 0-based index.
 */
 
const getCellEditable = (page: Page, cellIndex: number) =>
  page.locator(CELL_SELECTOR).nth(cellIndex).locator('[contenteditable="true"]').first();

/**
 * Select the given text string within the provided contenteditable locator using a DOM Range.
 */
const selectTextInElement = async (cellEditable: ReturnType<Page['locator']>, text: string): Promise<void> => {
  await cellEditable.evaluate((element, targetText) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    let start = -1;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const content = node.textContent ?? '';
      const idx = content.indexOf(targetText);

      if (idx !== -1) {
        textNode = node;
        start = idx;
        break;
      }
    }

    if (!textNode || start === -1) {
      throw new Error(`Text "${targetText}" was not found in element`);
    }

    const range = element.ownerDocument.createRange();

    range.setStart(textNode, start);
    range.setEnd(textNode, start + targetText.length);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  }, text);
};

test.describe('Inline Tools Inside Table Cells', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('selecting text in a table cell and applying bold formats the text', async ({ page }) => {
    // 1. Init editor with 2x2 table
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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Click first cell and type 'Bold text'
    const firstCellEditable = getCellEditable(page, 0);

    await firstCellEditable.click();
    await page.keyboard.type('Bold text');

    // 3. Select all text in the cell (Cmd+A on Mac, Ctrl+A on others)
    await page.keyboard.press(`${MODIFIER_KEY}+a`);

    // 4. Apply bold (Cmd+B / Ctrl+B)
    await page.keyboard.press(`${MODIFIER_KEY}+b`);

    // 5. Verify cell contains <b> or <strong> wrapping the text
    await page.waitForFunction(
      ({ cellSelector }: { cellSelector: string }) => {
        const element = document.querySelector(`${cellSelector} [contenteditable="true"]`);

        return element !== null && (/<b>/.test(element.innerHTML) || /<strong>/.test(element.innerHTML));
      },
      { cellSelector: CELL_SELECTOR }
    );

    const cellHTML = await firstCellEditable.innerHTML();

    expect(cellHTML).toMatch(/<b>|<strong>/);
    expect(cellHTML).toContain('Bold text');
  });

  test('inline toolbar appears when text is selected inside a table cell', async ({ page }) => {
    // 1. Init editor with 2x2 table
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

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    // 2. Click first cell and type 'Hello World'
    const firstCellEditable = getCellEditable(page, 0);

    await firstCellEditable.click();
    await page.keyboard.type('Hello World');

    // 3. Select 'Hello' text programmatically
    await selectTextInElement(firstCellEditable, 'Hello');

    // 4. Wait for inline toolbar to appear
    const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);

    await expect(inlineToolbar).toBeVisible();

    // 5. Verify inline toolbar is visible with Bold button
    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="bold"]`);

    await expect(boldButton).toBeVisible();
  });
});

// spec: specs/table-tool-test-plan.md (Paste HTML Table into Editor)
// seed: test/playwright/tests/tools/table.spec.ts

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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

/**
 * Dispatch a paste event on the active element using page.evaluate.
 * This mirrors the pattern from table-any-block-type.spec.ts which dispatches
 * on document.activeElement inside page.evaluate().
 */
const pasteHtml = async (page: Page, html: string): Promise<void> => {
  await page.evaluate((pasteData: string) => {
    const activeElement = document.activeElement as HTMLElement | null;

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

/**
 * Dispatch a paste event on a specific locator element with typed clipboard data.
 */
const paste = async (locator: Locator, data: Record<string, string>): Promise<void> => {
  await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
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
  }, data);
};

const defaultTools: Record<string, SerializableToolConfig> = {
  table: {
    className: 'Blok.Table',
  },
};

test.describe('Paste HTML Table into Editor', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Pasting a valid HTML table creates a table block', async ({ page }) => {
    // Initialize editor with table tool registered
    await createBlok(page, {
      tools: defaultTools,
    });

    // Click the paragraph block to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first contenteditable
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Dispatch a paste event with a 2x2 HTML table
    await pasteHtml(page, '<table><tr><td>X</td><td>Y</td></tr><tr><td>Z</td><td>W</td></tr></table>');

    // Wait for the table block to appear
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // Verify a table block was created (paste triggers onPaste which creates a table)
    const cells = page.locator(CELL_SELECTOR);
    const cellCount = await cells.count();

    // The table was created from the paste — verify it has cells
    expect(cellCount).toBeGreaterThanOrEqual(4);
  });

  test('Pasting an HTML table with a thead row enables heading row', async ({ page }) => {
    // Initialize editor with table tool registered
    await createBlok(page, {
      tools: defaultTools,
    });

    // Click the paragraph block to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first contenteditable
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Dispatch a paste event with an HTML table that has a thead row
    await pasteHtml(page, '<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>D1</td><td>D2</td></tr></tbody></table>');

    // Wait for the table to appear
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // Verify the table was created and check saved data for heading flag
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // Check withHeadings in saved data — the onPaste handler sets this from thead/th detection
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const withHeadings = (tableBlock as Record<string, Record<string, unknown>>).data.withHeadings;

    // The table was created from paste; verify headings flag is set
    expect(withHeadings).toBe(true);
  });

  test('Pasting an HTML table with th elements in the first row enables heading row', async ({ page }) => {
    // Initialize editor with table tool registered
    await createBlok(page, {
      tools: defaultTools,
    });

    // Click the paragraph block to focus it
    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first contenteditable
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Dispatch a paste event with an HTML table using th elements in the first row (no thead wrapper)
    await pasteHtml(page, '<table><tr><th>H1</th><th>H2</th></tr><tr><td>D1</td><td>D2</td></tr></table>');

    // Wait for the table to appear
    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    // Verify the table was created and check saved data for heading flag
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

    expect(tableBlock).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const withHeadings = (tableBlock as Record<string, Record<string, unknown>>).data.withHeadings;

    expect(withHeadings).toBe(true);
  });

  test('Pasting a Google Docs table preserves cell content', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
    });

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target first contenteditable
    const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`).first();

    await paragraph.click();

    // Google Docs wraps clipboard HTML in <b id="docs-internal-guid-..."><div>...</div></b>
    const googleDocsHTML = [
      '<meta charset="utf-8">',
      '<b style="font-weight:normal;" id="docs-internal-guid-abc12345">',
      '<div dir="ltr" style="margin-left:0pt;" align="left">',
      '<table style="border:none;border-collapse:collapse;">',
      '<tbody>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span style="font-weight:700;">Name</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span style="font-weight:700;">Age</span></p>',
      '</td>',
      '</tr>',
      '<tr>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>Alice</span></p>',
      '</td>',
      '<td style="border:solid #000 1pt;padding:5pt;">',
      '<p dir="ltr"><span>30</span></p>',
      '</td>',
      '</tr>',
      '</tbody>',
      '</table>',
      '</div>',
      '</b>',
    ].join('');

    await paste(paragraph, { 'text/html': googleDocsHTML });

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible();

    const cells = table.locator(CELL_SELECTOR);

    await expect(cells).toHaveCount(4);

    await expect(cells.filter({ hasText: 'Name' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Age' })).toHaveCount(1);
    await expect(cells.filter({ hasText: 'Alice' })).toHaveCount(1);
    await expect(cells.filter({ hasText: '30' })).toHaveCount(1);
  });
});

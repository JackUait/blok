/**
 * Regression test for the bug where pasting Blok table clipboard data causes a new
 * table block to be inserted at document level instead of being handled inline.
 *
 * Bug scenario:
 * 1. User copies a table cell — clipboard has <table data-blok-table-cells='...'> HTML
 * 2. document.activeElement is body (e.g. due to a React re-render between copy and paste)
 * 3. Paste event fires with event.target inside the table's cell-blocks container
 * 4. Inner Blok's setCurrentBlockByChildNode cannot find a block for the container → no preventDefault
 * 5. Event bubbles to outer Blok → TableCellsHandler runs → inserts a new table block ← BUG
 *
 * Fix: TableCellsHandler now also bails when context.pasteTarget is inside a [data-blok-table-cell],
 * covering the case where activeElement is body but the paste target is still inside the table.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

type HandlerFixBlok = {
  destroy?: () => Promise<void>;
  save?: () => Promise<{ blocks: Array<{ type: string; id: string; data: Record<string, unknown> }> }>;
  isReady: Promise<void>;
};
type BlokWithTools = { new(config: Record<string, unknown>): HandlerFixBlok; Table: unknown; Paragraph: unknown };

declare global {
  interface Window {
    handlerFixBlok?: HandlerFixBlok;
  }
}

const createBlokWithTable = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const win = window as unknown as Window & { Blok: BlokWithTools };

    if (window.handlerFixBlok) {
      await window.handlerFixBlok.destroy?.();
    }

    document.getElementById('blok-handler-fix')?.remove();

    const holder = document.createElement('div');

    holder.id = 'blok-handler-fix';
    document.body.appendChild(holder);

    const blok = new win.Blok({
      holder: 'blok-handler-fix',
      tools: {
        table: { class: win.Blok.Table },
        paragraph: { class: win.Blok.Paragraph },
      },
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['Source Cell', 'Target Cell'], ['A2', 'B2']],
            },
          },
        ],
      },
    });

    window.handlerFixBlok = blok as unknown as NonNullable<typeof window.handlerFixBlok>;
    await blok.isReady;
  });
};

test.describe('TableCellsHandler: currentBlock fallback when activeElement loses focus', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof (window as unknown as { Blok: unknown }).Blok === 'function');
  });

  test('pasting Blok table clipboard HTML on a cell container does NOT create a new table block when activeElement is body', async ({ page }) => {
    await createBlokWithTable(page);

    const table = page.locator(TABLE_SELECTOR);

    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator('[data-blok-table-cell]');

    await expect(cells).toHaveCount(4);

    // Click a cell to ensure the editor has a focused state, then blur.
    // eslint-disable-next-line playwright/no-nth-methods -- nth(1) is the target cell
    const targetCell = cells.nth(1);
    const targetCellEditable = targetCell.locator('[contenteditable="true"]');

    await targetCellEditable.click();
    await expect(targetCellEditable).toBeFocused({ timeout: 2000 });

    // Build the Blok table clipboard payload.
    const htmlToUse = (() => {
      const payload = {
        rows: 1,
        cols: 1,
        cells: [[{ blocks: [{ tool: 'paragraph', data: { text: 'Source Cell' } }] }]],
      };

      return `<table data-blok-table-cells='${JSON.stringify(payload)}'><tr><td>Source Cell</td></tr></table>`;
    })();

    // Count blocks before the paste.
    const beforePaste = await page.evaluate(async () => {
      const blok = window.handlerFixBlok;
      if (!blok?.save) throw new Error('handlerFixBlok not initialized');
      const saved = await blok.save();

      return {
        tableCount: saved.blocks.filter((b) => b.type === 'table').length,
      };
    });

    expect(beforePaste.tableCount).toBe(1);

    // Simulate the bug scenario:
    // - Blur so document.activeElement is body
    // - Dispatch paste on [data-blok-table-cell-blocks] container (not the contenteditable)
    //
    // This mimics the production case where activeElement moved to body after a React
    // re-render, and the paste fires on an intermediate container inside the table.
    // The inner Blok's setCurrentBlockByChildNode cannot find a block for this node,
    // so it does NOT call preventDefault, and the event bubbles to the outer Blok.
    // Without the fix, the outer Blok's TableCellsHandler inserts a new table block.
    const result = await page.evaluate(async (html: string) => {
      const cellEditables = document.querySelectorAll(
        '[data-blok-table-cell-blocks] [contenteditable="true"]'
      );
      // Target the second cell's editable (index 1)
      const targetEditable = cellEditables[1] as HTMLElement | undefined;

      if (!targetEditable) {
        throw new Error('Could not find target cell contenteditable');
      }

      const cellBlocksContainer = targetEditable.closest('[data-blok-table-cell-blocks]') as HTMLElement;

      // Blur so document.activeElement becomes body.
      (document.activeElement as HTMLElement | null)?.blur();

      const dt = new DataTransfer();

      dt.setData('text/html', html);
      dt.setData('text/plain', 'Source Cell');

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });

      cellBlocksContainer.dispatchEvent(pasteEvent);

      await new Promise<void>((resolve) => setTimeout(resolve, 500));

      const blok = window.handlerFixBlok;
      if (!blok?.save) throw new Error('handlerFixBlok not initialized');
      const saved = await blok.save();

      return {
        tableCount: saved.blocks.filter((b) => b.type === 'table').length,
        blockTypes: saved.blocks.map((b) => b.type),
      };
    }, htmlToUse);

    // No new table block should have been inserted at document level.
    expect(result.tableCount).toBe(1);
  });
});

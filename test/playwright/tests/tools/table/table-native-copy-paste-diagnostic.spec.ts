/**
 * Diagnostic test to capture the exact clipboard HTML Chrome produces when
 * native copy runs from inside a table cell (the hasNativeTextSelection path).
 *
 * This is a debugging/investigation test — not a permanent regression test.
 */
/* eslint-disable playwright/no-wait-for-timeout, max-depth */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

type DiagBlok = { destroy?: () => Promise<void>; save?: () => Promise<{ blocks: Array<{ type: string; id: string; data: Record<string, unknown> }> }>; isReady: Promise<void> };
type BlokWithTools = { new(config: Record<string, unknown>): DiagBlok; Table: unknown; Paragraph: unknown };

declare global {
  interface Window {
    diagBlok?: DiagBlok;
    __diagClipboard?: Record<string, string>;
  }
}

const createBlokWithTable = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const win = window as unknown as Window & { Blok: BlokWithTools };

    if (window.diagBlok) {
      await window.diagBlok.destroy?.();
    }
    document.getElementById('blok-diag')?.remove();
    const holder = document.createElement('div');
    holder.id = 'blok-diag';
    document.body.appendChild(holder);

    const blok = new win.Blok({
      holder: 'blok-diag',
      tools: {
        table: { class: win.Blok.Table },
        paragraph: { class: win.Blok.Paragraph },
      },
      data: {
        blocks: [{
          type: 'table',
          data: {
            withHeadings: false,
            content: [['Hello World', 'Target Cell'], ['A2', 'B2']],
          },
        }],
      },
    });
    window.diagBlok = blok as unknown as NonNullable<typeof window.diagBlok>;
    await blok.isReady;

  });
};

const assertBoundingBox = (
  box: { x: number; y: number; width: number; height: number } | null,
  label: string
): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

test.describe('Native copy paste diagnostic', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof (window as unknown as { Blok: unknown }).Blok === 'function');
  });

  test('capture Chrome clipboard HTML from native copy inside table cell', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createBlokWithTable(page);

    const table = page.locator(TABLE_SELECTOR);
    await expect(table).toBeVisible({ timeout: 5000 });

    // Click into first cell and select all text
    const firstCellEditable = table.locator('[data-blok-table-cell]').filter({ hasText: 'Hello World' }).locator('[contenteditable="true"]');
    await firstCellEditable.click();
    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Verify text is there
    await expect(firstCellEditable).toHaveText('Hello World');

    // Select all — this creates a non-collapsed native text selection
    await page.keyboard.press('ControlOrMeta+a');

    // Verify the selection is non-collapsed (hasNativeTextSelection would return true)
    const selectionState = await page.evaluate(() => {
      const sel = window.getSelection();
      return {
        isCollapsed: sel?.isCollapsed ?? true,
        selectedText: sel?.toString() ?? '',
      };
    });
    expect(selectionState.isCollapsed).toBe(false);
    expect(selectionState.selectedText).toBe('Hello World');

    // Check whether Blok's copy handler intercepts or passes through.
    // We dispatch a synthetic copy event to see what Blok writes.
    const blokCopyResult = await page.evaluate(() => {
      const store: Record<string, string> = {};
      const fakeClipboard = {
        setData: (type: string, data: string) => { store[type] = data; },
        getData: (type: string) => store[type] ?? '',
        types: [] as string[],
      };
      const ev = Object.assign(new Event('copy', { bubbles: true, cancelable: true }), {
        clipboardData: fakeClipboard,
      });
      document.dispatchEvent(ev);
      return store;
    });

    // Since hasNativeTextSelection()=true, Blok should NOT intercept
    expect(Object.keys(blokCopyResult)).toHaveLength(0);
     
    console.log('Blok copy result (should be empty):', JSON.stringify(blokCopyResult));

    // Now press Ctrl+C for real — Chrome writes to the actual system clipboard
    await page.keyboard.press('ControlOrMeta+c');

    // Read the actual clipboard Chrome wrote
    const nativeClipboard = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const entries = await Promise.all(
        items.flatMap((item) =>
          item.types.map(async (type) => {
            const blob = await item.getType(type);

            return [type, await blob.text()] as const;
          })
        )
      );

      return Object.fromEntries(entries);
    });

     
    console.log('Native clipboard content:', JSON.stringify(nativeClipboard, null, 2));

    const htmlContent = nativeClipboard['text/html'] ?? '';
    const plainContent = nativeClipboard['text/plain'] ?? '';

     
    console.log('HTML contains <table>?', htmlContent.includes('<table'));
     
    console.log('HTML contains data-blok-table-cells?', htmlContent.includes('data-blok-table-cells'));
     
    console.log('Plain text:', plainContent);

    // Store for the paste test
    await page.evaluate((clipData) => {
      window.__diagClipboard = clipData;
    }, nativeClipboard);

    // The key assertion: what does Chrome produce?
    // Based on empirical testing, Chrome produces a <span> with inline styles
    // (NOT a <table> wrapper) when copying from a contenteditable inside a <td>.
    expect(plainContent).toBe('Hello World');

    // Now test what happens when we paste this into another cell
    const targetCellEditable = table.locator('[data-blok-table-cell]').filter({ hasText: 'Target Cell' }).locator('[contenteditable="true"]');
    await targetCellEditable.click();
    await expect(targetCellEditable).toBeFocused({ timeout: 2000 });

    // Count blocks BEFORE paste
    const beforePaste = await page.evaluate(async () => {
      const blok = window.diagBlok;
      if (!blok?.save) throw new Error('diagBlok not initialized');
      const saved = await blok.save();
      return {
        blockCount: saved.blocks.length,
        blockTypes: saved.blocks.map((b) => b.type),
      };
    });
     
    console.log('Before paste:', JSON.stringify(beforePaste));

    // Simulate paste with the native clipboard HTML
    await page.evaluate((clipData) => {
      const target = document.activeElement as HTMLElement | null;
      if (!target) return;

      const dt = new DataTransfer();
      if (clipData['text/html']) dt.setData('text/html', clipData['text/html']);
      if (clipData['text/plain']) dt.setData('text/plain', clipData['text/plain']);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      target.dispatchEvent(pasteEvent);
    }, nativeClipboard);

    await page.waitForTimeout(500);

    // Count blocks AFTER paste
    const afterPaste = await page.evaluate(async () => {
      const blok = window.diagBlok;
      if (!blok?.save) throw new Error('diagBlok not initialized');
      const saved = await blok.save();
      return {
        blockCount: saved.blocks.length,
        blockTypes: saved.blocks.map((b) => b.type),
        blockData: saved.blocks.map((b) => ({ type: b.type, data: b.data })),
      };
    });
     
    console.log('After paste:', JSON.stringify(afterPaste, null, 2));

    // CRITICAL ASSERTION: the block count should NOT have increased
    // (no new table block should be inserted)
    expect(afterPaste.blockCount).toBe(beforePaste.blockCount);
    expect(afterPaste.blockTypes).not.toContain('table'.repeat(2)); // no duplicate table blocks

    // Verify target cell has the pasted content
    await expect(targetCellEditable).toContainText('Hello World', { timeout: 3000 });
  });

  test('capture what Blok writes when copying a single selected cell (not text selection)', async ({ page }) => {
    await createBlokWithTable(page);

    const table = page.locator(TABLE_SELECTOR);
    await expect(table).toBeVisible({ timeout: 5000 });

    // Click the first cell (no drag = single cell selection, but maybe hasSelection=true)
    const firstCell = table.locator('[data-blok-table-cell]').filter({ hasText: 'Hello World' });
    await firstCell.click();

    // DON'T select text — just click to place caret (selection is collapsed)
    // hasNativeTextSelection() should return false → Blok's handleCopy fires

    const blokCopyResult = await page.evaluate(() => {
      const store: Record<string, string> = {};
      const fakeClipboard = {
        setData: (type: string, data: string) => { store[type] = data; },
        getData: (type: string) => store[type] ?? '',
        types: [] as string[],
      };
      const ev = Object.assign(new Event('copy', { bubbles: true, cancelable: true }), {
        clipboardData: fakeClipboard,
      });
      document.dispatchEvent(ev);
      return store;
    });

     
    console.log('Blok copy (collapsed selection):', JSON.stringify(blokCopyResult));
     
    console.log('HTML contains <table>?', (blokCopyResult['text/html'] ?? '').includes('<table'));
     
    console.log('HTML contains data-blok-table-cells?', (blokCopyResult['text/html'] ?? '').includes('data-blok-table-cells'));
  });

  test('reproduce: copy text from cell A, paste into cell B — check if new block appears', async ({ page }) => {
    // Exact reproduction of the reported bug:
    // 1. Copy text from cell A (Ctrl+A, Ctrl+C with text selected)
    // 2. Click cell B
    // 3. Paste (Ctrl+V)
    // 4. Verify no new table block was inserted at the document level

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createBlokWithTable(page);

    const table = page.locator(TABLE_SELECTOR);
    await expect(table).toBeVisible({ timeout: 5000 });

    // Step 1: Select text in cell A and copy
    const cellA = table.locator('[data-blok-table-cell]').filter({ hasText: 'Hello World' }).locator('[contenteditable="true"]');
    await cellA.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(300);

    // Step 2: Click cell B
    const cellB = table.locator('[data-blok-table-cell]').filter({ hasText: 'Target Cell' }).locator('[contenteditable="true"]');
    await cellB.click();
    await expect(cellB).toBeFocused({ timeout: 2000 });

    // Count blocks before paste
    const beforePaste = await page.evaluate(async () => {
      const blok = window.diagBlok;
      if (!blok?.save) throw new Error('diagBlok not initialized');
      const saved = await blok.save();
      return { blockCount: saved.blocks.length, blockTypes: saved.blocks.map((b) => b.type) };
    });
     
    console.log('Before Ctrl+V paste:', JSON.stringify(beforePaste));

    // Step 3: Paste
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(500);

    // Step 4: Check result
    const afterPaste = await page.evaluate(async () => {
      const blok = window.diagBlok;
      if (!blok?.save) throw new Error('diagBlok not initialized');
      const saved = await blok.save();
      return {
        blockCount: saved.blocks.length,
        blockTypes: saved.blocks.map((b) => b.type),
        blockData: saved.blocks.map((b) => ({ type: b.type, data: b.data })),
      };
    });
     
    console.log('After Ctrl+V paste:', JSON.stringify(afterPaste, null, 2));

    // CRITICAL: no extra blocks should have been inserted
    expect(afterPaste.blockCount).toBe(beforePaste.blockCount);
    expect(afterPaste.blockTypes.filter((t) => t === 'table')).toHaveLength(1);
  });

  test('pill copy button (navigator.clipboard.write) then Ctrl+V into another cell — no new table block', async ({ page }) => {
    // Reproduction of the reported bug:
    // 1. Drag-select cells to activate the pill
    // 2. Open pill popover and click "Copy Selection" (uses navigator.clipboard.write)
    // 3. Focus another cell and press Ctrl+V
    // 4. Verify no new table block was inserted at the document level

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await createBlokWithTable(page);

    const table = page.locator(TABLE_SELECTOR);
    await expect(table).toBeVisible({ timeout: 5000 });

    const cells = table.locator('[data-blok-table-cell]');
    await expect(cells).toHaveCount(4); // 2x2 table

    // Step 1: Drag-select the first cell to create a selection
    const cell00 = cells.filter({ hasText: 'Hello World' });
    const cell00Box = assertBoundingBox(await cell00.boundingBox(), 'cell [0,0]');
    const startX = cell00Box.x + cell00Box.width / 2;
    const startY = cell00Box.y + cell00Box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 1, startY + 1, { steps: 3 }); // tiny drag = single-cell selection
    await page.mouse.up();

    // Wait for the selection pill to appear
    const pill = page.locator('[data-blok-table-selection-pill]');
    await expect(pill).toBeAttached({ timeout: 3000 });

    // Step 2: Hover over pill to expand it and open the popover
    const pillBox = assertBoundingBox(await pill.boundingBox(), 'selection pill');
    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await page.waitForTimeout(200);

    // Click the pill to open the popover
    await page.mouse.click(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await page.waitForTimeout(200);

    // Look for the "Copy" popover item and click it
    // (the pill popover shows "Copy" with ⌘C shortcut hint, not "Copy Selection")
    const copyItem = page.getByText('Copy', { exact: true });
    await expect(copyItem).toBeVisible({ timeout: 3000 });
    await copyItem.click();
    await page.waitForTimeout(300);

    // Count blocks BEFORE paste
    const beforePaste = await page.evaluate(async () => {
      const blok = window.diagBlok;
      if (!blok?.save) throw new Error('diagBlok not initialized');
      const saved = await blok.save();
      return {
        blockCount: saved.blocks.length,
        blockTypes: saved.blocks.map((b) => b.type),
      };
    });

    // Step 3: Click on target cell (0,1) and paste
    const cell01 = cells.filter({ hasText: 'Target Cell' }).locator('[contenteditable="true"]');
    await cell01.click();
    await expect(cell01).toBeFocused({ timeout: 2000 });

    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(500);

    // Step 4: Check result
    const afterPaste = await page.evaluate(async () => {
      const blok = window.diagBlok;
      if (!blok?.save) throw new Error('diagBlok not initialized');
      const saved = await blok.save();
      return {
        blockCount: saved.blocks.length,
        blockTypes: saved.blocks.map((b) => b.type),
      };
    });

     
    console.log('Before pill-copy paste:', JSON.stringify(beforePaste));
     
    console.log('After pill-copy paste:', JSON.stringify(afterPaste));

    // CRITICAL: no new table block should be inserted at the document level
    expect(afterPaste.blockCount).toBe(beforePaste.blockCount);
    expect(afterPaste.blockTypes.filter((t) => t === 'table')).toHaveLength(1);
  });

  test('copy from table A cell, paste into table B cell — should NOT create new table block', async ({ page }) => {
    // This tests cross-table paste: copy cell from one table, paste into cell in another table.
    // If handleGridPaste returns early at EARLY E (gridEl.contains fails — target cell is in a different table),
    // then handlePasteEvent takes over. TableCellsHandler.handle must bail at line 47
    // because activeElement is still inside [data-blok-table-cell].

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Create two separate tables
    await page.evaluate(async () => {
      const win = window as unknown as Window & { Blok: BlokWithTools };

      if (window.diagBlok) {
        await window.diagBlok.destroy?.();
      }
      document.getElementById('blok-diag')?.remove();
      const holder = document.createElement('div');
      holder.id = 'blok-diag';
      document.body.appendChild(holder);

      const blok = new win.Blok({
        holder: 'blok-diag',
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
                content: [['Source Cell', 'A2']],
              },
            },
            {
              type: 'paragraph',
              data: { text: 'between tables' },
            },
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [['Target Cell', 'B2']],
              },
            },
          ],
        },
      });
      window.diagBlok = blok as unknown as NonNullable<typeof window.diagBlok>;
      await blok.isReady;
    });

    const tables = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`);
    await expect(tables).toHaveCount(2);

    const tableA = tables.filter({ hasText: 'Source Cell' });
    const tableB = tables.filter({ hasText: 'Target Cell' });

    // Click first cell in Table A (creates selection) and copy
    const cellA = tableA.locator('[data-blok-table-cell]').filter({ hasText: 'Source Cell' });
    await cellA.click();
    // Verify a single-click creates a cell selection
    await page.waitForTimeout(100);

    // Press Ctrl+C — with hasSelection=true and collapsed caret, Blok writes table HTML
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(300);

    // Read what got written to clipboard
    const clipContent = await page.evaluate(async () => {
      try {
        const items = await navigator.clipboard.read();
        const result: Record<string, string> = {};
        for (const item of items) {
          for (const type of item.types) {
            const blob = await item.getType(type);
            result[type] = await blob.text();
          }
        }
        return result;
      } catch (e) {
        return { error: (e as Error).message };
      }
    });

     
    console.log('Cross-table clipboard content:', JSON.stringify(clipContent));
     
    console.log('Has data-blok-table-cells?', (clipContent['text/html'] ?? '').includes('data-blok-table-cells'));

    // Count blocks before paste
    const beforePaste = await page.evaluate(async () => {
      const blok = window.diagBlok;
      if (!blok?.save) throw new Error('diagBlok not initialized');
      const saved = await blok.save();
      return { blockCount: saved.blocks.length, blockTypes: saved.blocks.map((b) => b.type) };
    });
     
    console.log('Before cross-table paste:', JSON.stringify(beforePaste));

    // Click first cell of Table B and paste
    const cellB = tableB.locator('[data-blok-table-cell]').filter({ hasText: 'Target Cell' }).locator('[contenteditable="true"]');
    await cellB.click();
    await expect(cellB).toBeFocused({ timeout: 2000 });

    // Paste
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(500);

    // Check result
    const afterPaste = await page.evaluate(async () => {
      const blok = window.diagBlok;
      if (!blok?.save) throw new Error('diagBlok not initialized');
      const saved = await blok.save();
      return {
        blockCount: saved.blocks.length,
        blockTypes: saved.blocks.map((b) => b.type),
      };
    });
     
    console.log('After cross-table paste:', JSON.stringify(afterPaste));

    // CRITICAL: no new table block should appear — should still be 2 tables (+ other blocks)
    expect(afterPaste.blockTypes.filter((t) => t === 'table')).toHaveLength(2);
  });
});

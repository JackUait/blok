import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;

// Google Docs wraps clipboard content in <b id="docs-internal-guid-...">.
// A single-row, two-column table — the Docs idiom for a columns layout.
const GDOCS_SINGLE_ROW_TABLE = [
  '<b id="docs-internal-guid-test" style="font-weight:normal;">',
  '<div dir="ltr" align="left">',
  '<table><tbody><tr>',
  '<td><p dir="ltr"><span>Left cell</span></p></td>',
  '<td><p dir="ltr"><span>Right one</span></p><p dir="ltr"><span>Right two</span></p></td>',
  '</tr></tbody></table>',
  '</div>',
  '</b>',
].join('');

// A two-row, two-column table: still a columns layout — each table column's
// cells stack top-to-bottom inside one Blok column.
const GDOCS_MULTI_ROW_TABLE = [
  '<b id="docs-internal-guid-test" style="font-weight:normal;">',
  '<div dir="ltr" align="left">',
  '<table><tbody>',
  '<tr><td><p dir="ltr"><span>A1</span></p></td><td><p dir="ltr"><span>B1</span></p></td></tr>',
  '<tr><td><p dir="ltr"><span>A2</span></p></td><td><p dir="ltr"><span>B2</span></p></td></tr>',
  '</tbody></table>',
  '</div>',
  '</b>',
].join('');

// A four-column table exceeds the 2/3-column layout idiom and must stay a table.
const GDOCS_FOUR_COLUMN_TABLE = [
  '<b id="docs-internal-guid-test" style="font-weight:normal;">',
  '<div dir="ltr" align="left">',
  '<table><tbody><tr>',
  '<td><p dir="ltr"><span>A</span></p></td>',
  '<td><p dir="ltr"><span>B</span></p></td>',
  '<td><p dir="ltr"><span>C</span></p></td>',
  '<td><p dir="ltr"><span>D</span></p></td>',
  '</tr></tbody></table>',
  '</div>',
  '</b>',
].join('');

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
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

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({ holder });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

/**
 * Simulate a paste event carrying HTML on the currently focused element.
 */
const simulatePaste = async (page: Page, html: string): Promise<void> => {
  await page.evaluate((pasteHtml) => {
    const dt = new DataTransfer();

    dt.setData('text/html', pasteHtml);
    dt.setData('text/plain', '');

    const active = document.activeElement ?? document.body;

    active.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
  }, html);

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow the async paste pipeline to complete
  await page.waitForTimeout(300);
};

const focusFirstParagraph = async (page: Page): Promise<void> => {
  await page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]').first().click();
};

const save = async (page: Page): Promise<OutputData | undefined> => {
  return page.evaluate(async () => window.blokInstance?.save());
};

test.describe('Columns paste from Google Docs (2/3-column table)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('pastes a single-row 2-column table as a column layout, not a table', async ({ page }) => {
    await createBlok(page);
    await focusFirstParagraph(page);

    await simulatePaste(page, GDOCS_SINGLE_ROW_TABLE);

    const columnList = page.getByTestId('column-list');

    await expect(columnList).toBeVisible();

    const columns = columnList.locator('[data-blok-column]');

    await expect(columns).toHaveCount(2);
    await expect(columns.nth(0)).toContainText('Left cell');
    await expect(columns.nth(1)).toContainText('Right one');
    await expect(columns.nth(1)).toContainText('Right two');

    const saved = await save(page);

    expect(saved?.blocks.some((b) => b.type === 'table')).toBe(false);
    expect(saved?.blocks.filter((b) => b.type === 'column_list')).toHaveLength(1);
    expect(saved?.blocks.filter((b) => b.type === 'column')).toHaveLength(2);
  });

  test('cell paragraphs become separate blocks in their column, with no phantom seeds', async ({ page }) => {
    await createBlok(page);
    await focusFirstParagraph(page);

    await simulatePaste(page, GDOCS_SINGLE_ROW_TABLE);

    const saved = await save(page);

    expect(saved).toBeDefined();

    const list = saved?.blocks.find((b) => b.type === 'column_list');
    const columnBlocks = saved?.blocks.filter((b) => b.type === 'column') ?? [];

    // Exactly the two pasted columns belong to the list — no phantom seeded ones.
    expect(list?.content).toHaveLength(2);

    for (const column of columnBlocks) {
      expect(list?.content).toContain(column.id);
    }

    const childTexts = (columnId: string | undefined): string[] =>
      (saved?.blocks ?? [])
        .filter((b) => b.parent === columnId)
        .map((b) => String((b.data as { text?: string }).text ?? ''));

    // Column A: one paragraph; column B: two — no leading empty seed paragraphs.
    expect(childTexts(columnBlocks[0]?.id)).toEqual(['Left cell']);
    expect(childTexts(columnBlocks[1]?.id)).toEqual(['Right one', 'Right two']);
  });

  test('a multi-row 2-column table pastes as columns with each column\'s cells stacked', async ({ page }) => {
    await createBlok(page);
    await focusFirstParagraph(page);

    await simulatePaste(page, GDOCS_MULTI_ROW_TABLE);

    const columnList = page.getByTestId('column-list');

    await expect(columnList).toBeVisible();
    await expect(columnList.locator('[data-blok-column]')).toHaveCount(2);

    const saved = await save(page);

    expect(saved?.blocks.some((b) => b.type === 'table')).toBe(false);

    const columnBlocks = saved?.blocks.filter((b) => b.type === 'column') ?? [];
    const childTexts = (columnId: string | undefined): string[] =>
      (saved?.blocks ?? [])
        .filter((b) => b.parent === columnId)
        .map((b) => String((b.data as { text?: string }).text ?? ''));

    expect(childTexts(columnBlocks[0]?.id)).toEqual(['A1', 'A2']);
    expect(childTexts(columnBlocks[1]?.id)).toEqual(['B1', 'B2']);
  });

  test('a four-column Google Docs table still pastes as a table', async ({ page }) => {
    await createBlok(page);
    await focusFirstParagraph(page);

    await simulatePaste(page, GDOCS_FOUR_COLUMN_TABLE);

    const saved = await save(page);

    expect(saved?.blocks.filter((b) => b.type === 'table')).toHaveLength(1);
    expect(saved?.blocks.some((b) => b.type === 'column_list')).toBe(false);
  });

  test('one undo removes the whole pasted column layout', async ({ page }) => {
    await createBlok(page);
    await focusFirstParagraph(page);

    await simulatePaste(page, GDOCS_SINGLE_ROW_TABLE);

    await expect(page.getByTestId('column-list')).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');

    await expect(page.getByTestId('column-list')).toHaveCount(0);

    const saved = await save(page);

    expect(saved?.blocks.some((b) => b.type === 'column_list')).toBe(false);
    expect(saved?.blocks.some((b) => b.type === 'column')).toBe(false);
  });
});

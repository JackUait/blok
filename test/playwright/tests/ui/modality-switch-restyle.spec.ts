// spec: switching between keyboard and mouse restyles only the focus rules' targets
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { countStyled } from '../helpers/style-trace';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;

/** A 40×30 table; returns how many elements the page holds. */
const createLargeTable = async (page: Page): Promise<number> => {
  const data: OutputData = {
    blocks: [{
      id: 'tbl',
      type: 'table',
      data: { withHeadings: true, content: Array.from({ length: 40 }, () => Array.from({ length: 30 }, () => '')) },
    }],
  };

  await page.setViewportSize({ width: 1400, height: 800 });
  await page.evaluate(async ({ holder, blocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const classes = (window as unknown as Record<string, Record<string, unknown>>).Blok;
    const blok = new window.Blok({ holder, data: blocks, tools: { table: { class: classes.Table } } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks: data });
  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

  return page.evaluate(() => document.querySelectorAll('*').length);
};

/** The modality input-modality.ts last wrote on <html>. */
const modality = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => document.documentElement.dataset.blokModality);

/** Waits two frames, so the style recalc a gesture scheduled has run. */
const settle = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test.describe('Keyboard and mouse switch', () => {
  test('a key after a click restyles far fewer elements than the page holds', async ({ page }) => {
    const elements = await createLargeTable(page);
    const cell = page.locator('[data-blok-table-cell]').nth(31);

    await cell.click();
    await settle(page);
    await expect.poll(() => modality(page)).toBe('pointer');

    const styled = await countStyled(page, async () => {
      await page.keyboard.press('Shift');
      await settle(page);
    });

    await expect.poll(() => modality(page)).toBe('keyboard');
    // A whole-page restyle styles each element several times over (its
    // pseudo-elements and highlights) and freezes the page.
    expect(styled).toBeLessThan(elements);
  });

  test('a click after a key restyles far fewer elements than the page holds', async ({ page }) => {
    const elements = await createLargeTable(page);
    const cell = page.locator('[data-blok-table-cell]').nth(31);

    await cell.click();
    await page.keyboard.press('Shift');
    await settle(page);
    await expect.poll(() => modality(page)).toBe('keyboard');

    const styled = await countStyled(page, async () => {
      await cell.click();
      await settle(page);
    });

    await expect.poll(() => modality(page)).toBe('pointer');
    expect(styled).toBeLessThan(elements);
  });
});

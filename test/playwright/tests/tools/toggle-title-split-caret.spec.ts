import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const placeCaret = async (page: Page, text: string, charsFromEnd: number): Promise<void> => {
  await page.locator(`${BLOK_INTERFACE_SELECTOR} [contenteditable="true"]`, { hasText: text }).last().click();
  await page.keyboard.press('End');

  for (let i = 0; i < charsFromEnd; i++) {
    await page.keyboard.press('ArrowLeft');
  }
};

const savedShape = async (page: Page): Promise<unknown[]> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());

  return (saved?.blocks ?? []).map(block => [block.type, (block.data as { text?: unknown }).text]);
};

test.describe('Toggle title Enter puts the caret in the new block', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('mid-title Enter in a toggle, then typing, writes into the new toggle', async ({ page }) => {
    await createBlok(page, {
      blocks: [ { id: 't1', type: 'toggle', data: { text: 'TitleRest', isOpen: true } } ],
    });

    await placeCaret(page, 'TitleRest', 4);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Z');

    await expect.poll(() => savedShape(page)).toStrictEqual([['toggle', 'Title'], ['toggle', 'ZRest']]);
  });

  test('End + Enter in a collapsed toggle, then typing, writes into the new sibling', async ({ page }) => {
    await createBlok(page, {
      blocks: [ { id: 't1', type: 'toggle', data: { text: 'Title', isOpen: false } } ],
    });

    await placeCaret(page, 'Title', 0);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Z');

    await expect.poll(() => savedShape(page)).toStrictEqual([['toggle', 'Title'], ['toggle', 'Z']]);
  });

  test('mid-text Enter in a toggle heading, then typing, writes into the new heading', async ({ page }) => {
    await createBlok(page, {
      blocks: [ { id: 'h1', type: 'header', data: { text: 'HeadRest', level: 2, isToggleable: true, isOpen: true } } ],
    });

    await placeCaret(page, 'HeadRest', 4);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Z');

    await expect.poll(() => savedShape(page)).toStrictEqual([['header', 'Head'], ['header', 'ZRest']]);
  });

  test('End + Enter in a collapsed toggle heading, then typing, writes into the new paragraph', async ({ page }) => {
    await createBlok(page, {
      blocks: [ { id: 'h1', type: 'header', data: { text: 'Head', level: 2, isToggleable: true, isOpen: false } } ],
    });

    await placeCaret(page, 'Head', 0);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Z');

    await expect.poll(() => savedShape(page)).toStrictEqual([['header', 'Head'], ['paragraph', 'Z']]);
  });
});

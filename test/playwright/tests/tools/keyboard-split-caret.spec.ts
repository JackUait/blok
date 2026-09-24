import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
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

const savedShape = async (page: Page): Promise<unknown[]> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());

  return (saved?.blocks ?? []).map((block) => {
    const data = block.data as { text?: unknown; code?: unknown };

    return [block.type, data.code ?? data.text];
  });
};

test.describe('A block made by a keystroke gets the caret', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('Shift+Enter in a code block, then typing, writes into the new paragraph', async ({ page }) => {
    await createBlok(page, {
      blocks: [ { id: 'c1', type: 'code', data: { code: 'hello', language: 'plain text' } } ],
    });

    await page.getByTestId('code-content').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Z');

    await expect.poll(() => savedShape(page)).toStrictEqual([['code', 'hello'], ['paragraph', 'Z']]);
  });

  test('Shift+Enter in a code block with a block below, then typing, writes into the new paragraph', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'c1', type: 'code', data: { code: 'hello', language: 'plain text' } },
        { id: 'p1', type: 'paragraph', data: { text: 'after' } },
      ],
    });

    await page.getByTestId('code-content').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Z');

    await expect.poll(() => savedShape(page)).toStrictEqual([
      ['code', 'hello'],
      ['paragraph', 'Z'],
      ['paragraph', 'after'],
    ]);
  });
});

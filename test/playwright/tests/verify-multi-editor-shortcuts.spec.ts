import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from './helpers/ensure-build';

/**
 * Block move & duplicate shortcuts must work in EVERY editor on the page, from a
 * plain focused caret (Notion parity) — not only the last-initialized one.
 *
 * Root cause that this guards: the shortcuts were registered on `document` via a
 * singleton keyed by (element, name) that throws on duplicates, so each new
 * editor evicted the previous editor's CMD+D / move handlers. On a multi-editor
 * page (docs site, playground) every editor but the last silently no-opped.
 */

declare global {
  interface Window {
    b1?: Blok;
    b2?: Blok;
  }
}

const bootTwo = async (page: Page): Promise<void> => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async () => {
    const mk = (id: string): void => {
      document.getElementById(id)?.remove();
      const d = document.createElement('div');

      d.id = id;
      d.setAttribute('data-blok-testid', id);
      document.body.appendChild(d);
    };

    mk('ed1');
    const b1 = new window.Blok({ holder: 'ed1', data: { blocks: [
      { type: 'paragraph', data: { text: 'one-A' } },
      { type: 'paragraph', data: { text: 'one-B' } },
      { type: 'paragraph', data: { text: 'one-C' } },
    ] } });

    window.b1 = b1;
    await b1.isReady;

    mk('ed2');
    const b2 = new window.Blok({ holder: 'ed2', data: { blocks: [
      { type: 'paragraph', data: { text: 'two-A' } },
      { type: 'paragraph', data: { text: 'two-B' } },
    ] } });

    window.b2 = b2;
    await b2.isReady;
  });
};

const texts = (page: Page, which: 'b1' | 'b2'): Promise<string[]> =>
  page.evaluate(async (w) => {
    const instance = window[w];

    if (!instance) {
      throw new Error(`Editor ${w} not found`);
    }
    const out = await instance.save();

    return out.blocks.map((b) => String((b.data as { text?: string }).text ?? ''));
  }, which);

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('block move & duplicate from a focused caret across multiple editors', () => {
  test('Cmd+D duplicates in the FIRST (older) editor and does not touch the second', async ({ page }) => {
    await bootTwo(page);
    await page.getByText('one-A').click();
    await page.keyboard.press('Meta+d');

    await expect.poll(() => texts(page, 'b1')).toEqual(['one-A', 'one-A', 'one-B', 'one-C']);
    await expect.poll(() => texts(page, 'b2')).toEqual(['two-A', 'two-B']);
  });

  test('Cmd+D duplicates in the SECOND (last) editor and does not touch the first', async ({ page }) => {
    await bootTwo(page);
    await page.getByText('two-A').click();
    await page.keyboard.press('Meta+d');

    await expect.poll(() => texts(page, 'b2')).toEqual(['two-A', 'two-A', 'two-B']);
    await expect.poll(() => texts(page, 'b1')).toEqual(['one-A', 'one-B', 'one-C']);
  });

  test('Cmd+Shift+Down moves a focused block in the FIRST editor', async ({ page }) => {
    await bootTwo(page);
    await page.getByText('one-A').click();
    await page.keyboard.press('Meta+Shift+ArrowDown');

    await expect.poll(() => texts(page, 'b1')).toEqual(['one-B', 'one-A', 'one-C']);
  });

  test('Cmd+Shift+Up moves a focused block in the FIRST editor', async ({ page }) => {
    await bootTwo(page);
    await page.getByText('one-C').click();
    await page.keyboard.press('Meta+Shift+ArrowUp');

    await expect.poll(() => texts(page, 'b1')).toEqual(['one-A', 'one-C', 'one-B']);
  });
});

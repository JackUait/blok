import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

/**
 * A typing step takes every key within ~708 ms of the step's first key, as in
 * Notion (docs/plans/replica-undo/notion-remeasure.md RM1, RM2, RM5). Spaces,
 * "." and short pauses do not cut it. A newline typed in code is typing.
 */

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const create = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blocks: data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: data } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

/** The first block's saved text (a paragraph's text or a code block's code). */
const text = async (page: Page): Promise<string> => {
  const blocks = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);
  const data = blocksAsHtml(blocks)[0]?.data as { text?: string; code?: string } | undefined;

  return data?.text ?? data?.code ?? '';
};

const caretAtEnd = async (page: Page): Promise<void> => {
  await page.locator(`#${HOLDER_ID} [data-blok-testid="block-wrapper"] [contenteditable]`).first().click();
  await page.keyboard.press('End');
  // Let the click's step close before typing.
  await wait(page, 300);
};

const undoOnce = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await wait(page, 300);
};

test.describe('undo audit: typing window', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U008: a 300 ms pause after a space does not cut the step', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: 'Alpha' } }]);
    await caretAtEnd(page);

    await page.keyboard.type(' one ');
    await wait(page, 300);
    await page.keyboard.type('two');
    await expect.poll(() => text(page)).toBe('Alpha one two');

    await undoOnce(page);

    await expect.poll(() => text(page)).toBe('Alpha');
  });

  test('U029: a 150 ms pause after "." does not cut the step', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: 'Alpha' } }]);
    await caretAtEnd(page);

    await page.keyboard.type(' Hi.');
    await wait(page, 150);
    await page.keyboard.type('Next');
    await expect.poll(() => text(page)).toBe('Alpha Hi.Next');

    await undoOnce(page);

    await expect.poll(() => text(page)).toBe('Alpha');
  });

  test('U017: steady typing longer than the window is cut by time, inside a word', async ({ page }) => {
    await create(page, [{ type: 'paragraph', data: { text: 'Alpha' } }]);
    await caretAtEnd(page);

    // About 2 s of typing with no space and no pause.
    await page.keyboard.type('abcdefghijklmnopqrst', { delay: 100 });
    await expect.poll(() => text(page)).toBe('Alphaabcdefghijklmnopqrst');

    await undoOnce(page);
    const afterOne = await text(page);

    expect(afterOne.startsWith('Alphaa')).toBe(true);
    expect(afterOne.length).toBeLessThan('Alphaabcdefghijklmnopqrst'.length);

    for (let press = 0; press < 6 && await text(page) !== 'Alpha'; press++) {
      await undoOnce(page);
    }
    expect(await text(page)).toBe('Alpha');
  });

  test('U153: a newline typed in code is part of the typing step', async ({ page }) => {
    await create(page, [{ type: 'code', data: { code: 'let a', language: 'plain' } }]);
    await caretAtEnd(page);

    await page.keyboard.type(' = 1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('let b = 2');
    await expect.poll(() => text(page)).toBe('let a = 1\nlet b = 2');

    await undoOnce(page);

    await expect.poll(() => text(page)).toBe('let a');
  });
});

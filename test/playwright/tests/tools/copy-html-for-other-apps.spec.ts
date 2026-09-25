import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Copying whole blocks writes text/html that Word / Google Docs read. Marks,
 * block boundaries, code line breaks and colors must survive it.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';

const createBlok = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ holder, initialBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: initialBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialBlocks: blocks });
};

/** Fires a copy event on the element and returns what Blok wrote. */
const copyFrom = async (locator: Locator): Promise<Record<string, string>> =>
  await locator.evaluate((element) => {
    const written: Record<string, string> = {};
    const dataTransfer = new DataTransfer();
    const setData = dataTransfer.setData.bind(dataTransfer);

    dataTransfer.setData = (format: string, data: string): void => {
      written[format] = data;
      setData(format, data);
    };

    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dataTransfer });

    if (event.clipboardData !== dataTransfer) {
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
    }
    element.dispatchEvent(event);

    return written;
  });

test.describe('copy of whole blocks as text/html', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('keeps marks, block boundaries, code lines and literal colors', async ({ page }) => {
    await createBlok(page, [
      { id: 'a', type: 'paragraph', data: { text: 'one <strong>bold</strong> <em>it</em> <s>gone</s> <code>x</code>' } },
      { id: 'b', type: 'paragraph', data: { text: 'two <mark style="color: var(--blok-color-red-text);">red</mark>' } },
      { id: 'c', type: 'code', data: { code: 'line1\n  <tag>', language: 'plain' } },
    ]);

    const editable = page.locator('[data-blok-id="a"] [contenteditable="true"]').first();

    await editable.click();
    // Cmd+A escalates: text, then this block, then every block.
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ControlOrMeta+A');

    const html = (await copyFrom(editable))['text/html'];

    expect(html).toBe(
      '<p>one <strong>bold</strong> <em>it</em> <s>gone</s> <code>x</code></p>' +
      '<p>two <mark style="color: #d44c47;">red</mark></p>' +
      '<pre><code>line1\n  &lt;tag&gt;</code></pre>'
    );
  });
});

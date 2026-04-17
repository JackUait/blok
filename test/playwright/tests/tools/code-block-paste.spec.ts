import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Regression suite for code block paste behavior.
 *
 * Original symptom: pasting plain text while the cursor is inside a code block
 * would create new paragraph blocks BELOW the code block instead of inserting
 * the text into the code element.
 *
 * Root cause: The Paste module's `isNativeBehaviour` check did not recognize
 * `contenteditable="plaintext-only"` elements (used by the code block) as
 * native inputs. Additionally, `Dom.allInputsSelector` and
 * `Dom.isContentEditable` did not match `plaintext-only` contenteditable
 * elements, causing `Block.currentInput` to be null for code blocks.
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

/**
 * Dispatch a synthetic paste event on the active element.
 *
 * For `plaintext-only` contenteditable targets, the Paste module should bail
 * out (not call `preventDefault()`), letting the browser handle it natively.
 * In synthetic events the browser does not execute the default action, so the
 * text won't be visibly inserted — but crucially, no new paragraph blocks
 * should be created below the code block.
 */
const simulatePaste = async (page: Page, opts: { html?: string; text?: string }): Promise<void> => {
  await page.evaluate((data) => {
    const dt = new DataTransfer();

    if (data.html !== undefined) {
      dt.setData('text/html', data.html);
    }
    dt.setData('text/plain', data.text ?? '');

    const active = document.activeElement ?? document.body;

    active.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
  }, opts);
};

const getBlockCount = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('[data-blok-element]').length);

test.describe('Code block paste regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('pasting plain text into a code block does not create new blocks below it', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: 'const x = 1;', language: 'javascript' } },
      ],
    });

    // Focus the code element
    const codeEl = page.getByTestId('code-content');

    await codeEl.click();

    const blockCountBefore = await getBlockCount(page);

    // Paste plain text — this must NOT create new paragraph blocks
    await simulatePaste(page, { text: 'const y = 2;' });

    // Use poll-based assertion — block count should remain stable
    await expect.poll(() => getBlockCount(page)).toBe(blockCountBefore);
  });

  test('pasting multi-line text into a code block does not create paragraph blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '// existing', language: 'plain text' } },
      ],
    });

    const codeEl = page.getByTestId('code-content');

    await codeEl.click();

    const blockCountBefore = await getBlockCount(page);

    // Paste multi-line text — each line must NOT become a separate paragraph
    await simulatePaste(page, { text: 'line 1\nline 2\nline 3' });

    await expect.poll(() => getBlockCount(page)).toBe(blockCountBefore);
  });

  test('pasting HTML into a code block does not create formatted blocks below', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '// test', language: 'javascript' } },
      ],
    });

    const codeEl = page.getByTestId('code-content');

    await codeEl.click();

    const blockCountBefore = await getBlockCount(page);

    // Paste HTML content — should not be processed into new blocks
    await simulatePaste(page, {
      html: '<p>paragraph</p><h2>heading</h2>',
      text: 'paragraph\nheading',
    });

    await expect.poll(() => getBlockCount(page)).toBe(blockCountBefore);
  });
});

import type { Page } from '@playwright/test';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

/**
 * Regression: "/" must be a literal character inside a Code block — the slash
 * command menu must NOT open there (Notion parity). The toolbox only opens in
 * text-like blocks (paragraph/header/list…); Code manages its own keyboard and
 * treats "/" as plain text.
 */

const HOLDER_ID = 'blok';
const CODE_CONTENT_SELECTOR = '[data-blok-testid="code-content"]';
const TOOLBOX_CONTAINER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;

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

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, data: initialData });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data }
  );
};

test.describe('slash inside Code block (Notion parity)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('typing "/" in a code block does NOT open the toolbox and stays literal', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '', language: 'javascript', lineNumbers: true } },
      ],
    });

    const codeContent = page.locator(CODE_CONTENT_SELECTOR);

    await codeContent.click();
    await page.keyboard.type('/');

    // The command menu must NOT appear.
    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeHidden();

    // "/" is a literal character in the code body.
    const codeText = await codeContent.evaluate((el) => el.textContent ?? '');

    expect(codeText).toContain('/');
  });

  test('typing "/" still opens the toolbox in a paragraph (control)', async ({ page }) => {
    await createBlok(page, {
      blocks: [ { type: 'paragraph', data: { text: '' } } ],
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await page.keyboard.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();
  });
});

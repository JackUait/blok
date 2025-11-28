import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../fixtures/test.html')
).href;
const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const TOOLBOX_CONTAINER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';
const TOOLBOX_ITEM_SELECTOR = (itemName: string): string =>
  `[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-item"][data-blok-item-name=${itemName}]`;
const BLOCK_TUNES_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;

const modifierKeyVariants: Array<{ description: string; key: 'Control' | 'Meta' }> = [
  { description: 'Ctrl',
    key: 'Control' },
  { description: 'Cmd',
    key: 'Meta' },
];

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
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createParagraphBlok = async (page: Page, paragraphs: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = paragraphs.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

const getTextContent = async (locator: Locator): Promise<string> => {
  return locator.evaluate((element) => element.textContent ?? '');
};

test.describe('slash keydown', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should add "/" in empty block and open Toolbox', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    const textContent = await getTextContent(paragraph);

    expect(textContent).toBe('/');
  });

  for (const { description, key } of modifierKeyVariants) {
    test(`should not open Toolbox if Slash pressed with ${description}`, async ({ page }) => {
      await createParagraphBlok(page, [ '' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.down(key);
      await page.keyboard.press('Slash');
      await page.keyboard.up(key);

      await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeHidden();
      const textContent = await getTextContent(paragraph);

      expect(textContent).toBe('');
    });
  }

  test('should not open Toolbox in non-empty block and append slash character', async ({ page }) => {
    await createParagraphBlok(page, [ 'Hello' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeHidden();

    const textContent = await getTextContent(paragraph);

    expect(textContent).toBe('Hello/');
  });

  test('should not modify text outside blok when slash pressed', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    await page.evaluate(() => {
      const title = document.querySelector('h1');

      if (title) {
        title.setAttribute('data-blok-testid', 'page-title');
      }
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    const toolbox = page.locator(TOOLBOX_CONTAINER_SELECTOR);

    await expect(toolbox).toBeVisible();

    const textToolOption = page.locator(TOOLBOX_ITEM_SELECTOR('paragraph'));

    await textToolOption.click();

    const pageTitle = page.getByTestId('page-title');

    await pageTitle.evaluate((element) => {
      element.setAttribute('contenteditable', 'true');
      element.focus();

      const selection = element.ownerDocument.getSelection();
      const range = element.ownerDocument.createRange();

      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    await pageTitle.evaluate((element) => {
      element.removeAttribute('contenteditable');
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '/',
          code: 'Slash',
          which: 191,
          bubbles: true,
        })
      );
    });

    await expect(pageTitle).toHaveText('Blok test page');
  });

  test('should open Block Tunes when cmd+slash pressed', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await page.keyboard.down('Meta');
    await page.keyboard.press('Slash');
    await page.keyboard.up('Meta');

    await expect(page.locator(BLOCK_TUNES_SELECTOR)).toBeVisible();
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}


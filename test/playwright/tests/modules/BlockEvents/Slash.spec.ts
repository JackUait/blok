import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

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

  test('should open Toolbox in non-empty block and append slash character (Notion parity)', async ({ page }) => {
    await createParagraphBlok(page, [ 'Hello' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    // Caret to end of "Hello", then type "/"
    await paragraph.click();
    await page.keyboard.press('End');
    await paragraph.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    const textContent = await getTextContent(paragraph);

    expect(textContent).toBe('Hello/');
  });

  test('selecting a tool on a non-empty block inserts a NEW block and strips the "/query"', async ({ page }) => {
    await createParagraphBlok(page, [ 'Hello' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await paragraph.click();
    await page.keyboard.press('End');
    await paragraph.type('/head');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    // Pick "Heading" from the filtered toolbox
    await page.locator(TOOLBOX_ITEM_SELECTOR('header-1')).first().click();

    // A NEW heading block exists alongside the untouched paragraph
    const headingSelector = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"] [contenteditable]`;

    await expect(page.locator(headingSelector)).toBeVisible();

    // The original paragraph keeps "Hello" with the "/head" slash query removed
    const paragraphText = await getTextContent(page.locator(PARAGRAPH_SELECTOR).first());

    expect(paragraphText).toBe('Hello');

    // The serialized output has the paragraph BEFORE the (empty) heading
    const types = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();

      return (data?.blocks ?? []).map((block) => block.type);
    });

    expect(types).toEqual([ 'paragraph', 'header' ]);
  });

  test('slash query is bounded at the caret, not the rest of the block (Notion parity)', async ({ page }) => {
    await createParagraphBlok(page, [ 'Hello world' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    // Place the caret after "Hello" (mid-block), then type "/head".
    await paragraph.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.type('/head');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    // The query must be "head" (slash→caret), so the Heading tool matches. If the
    // trailing " world" (content after the caret) leaked into the query it would
    // be "head world" and nothing would match — the Heading item would be hidden.
    await expect(page.locator(TOOLBOX_ITEM_SELECTOR('header-1')).first()).toBeVisible();
  });

  test('typing "/" on an EMPTY block still replaces it in place', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await paragraph.click();
    await paragraph.type('/head');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    await page.locator(TOOLBOX_ITEM_SELECTOR('header-1')).first().click();

    // The empty paragraph was converted in place — only a single heading remains
    const types = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();

      return (data?.blocks ?? []).map((block) => block.type);
    });

    expect(types).toEqual([ 'header' ]);
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
    });

    await page.keyboard.press('Slash');

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


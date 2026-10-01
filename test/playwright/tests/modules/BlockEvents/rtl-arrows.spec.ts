import type { Locator, Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable="true"]`;
const SELECTED_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-selected="true"]`;

const ARABIC_FIRST = 'مرحبا';
const ARABIC_SECOND = 'عالم';
const ARABIC_LINE = 'هذا سطر عربي طويل للاختبار هنا';

type Direction = 'ltr' | 'rtl';

interface CaretInfo {
  block: number;
  offset: number;
  textLength: number;
  x: number;
}

const paragraph = (page: Page, index: number): Locator => page.locator(PARAGRAPH_SELECTOR).nth(index);

const createBlok = async (page: Page, texts: string[], direction: Direction): Promise<void> => {
  await page.evaluate(async ({ holder, blocks, dir }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data: { blocks },
      i18n: { direction: dir },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    blocks: texts.map((text) => ({ type: 'paragraph', data: { text } })),
    dir: direction,
  });
};

const placeCaret = async (locator: Locator, where: 'start' | 'end'): Promise<void> => {
  await locator.click();
  await locator.evaluate((element, toStart) => {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(toStart);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, where === 'start');
};

const caretInfo = (page: Page): Promise<CaretInfo | null> => {
  return page.evaluate((selector) => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.anchorNode === null) {
      return null;
    }

    const anchor = selection.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor.parentElement;
    const editable = anchorElement?.closest('[contenteditable="true"]') ?? null;
    const editables = Array.from(document.querySelectorAll(selector));

    return {
      block: editable === null ? -1 : editables.indexOf(editable),
      offset: selection.anchorOffset,
      textLength: anchor.textContent?.length ?? 0,
      x: Math.round(selection.getRangeAt(0).getBoundingClientRect().left),
    };
  }, PARAGRAPH_SELECTOR);
};

test.describe('horizontal arrows follow reading order', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('RTL: ArrowLeft at the end of a block moves into the next block', async ({ page }) => {
    await createBlok(page, [ARABIC_FIRST, ARABIC_SECOND], 'rtl');
    await placeCaret(paragraph(page, 0), 'end');

    await page.keyboard.press('ArrowLeft');

    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 1, offset: 0 });
  });

  test('RTL: ArrowRight at the start of a block moves to the end of the previous block', async ({ page }) => {
    await createBlok(page, [ARABIC_FIRST, ARABIC_SECOND], 'rtl');
    await placeCaret(paragraph(page, 1), 'start');

    await page.keyboard.press('ArrowRight');

    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 0, offset: ARABIC_FIRST.length });
  });

  test('RTL: Shift+ArrowLeft at the end of a block selects across blocks', async ({ page }) => {
    await createBlok(page, [ARABIC_FIRST, ARABIC_SECOND], 'rtl');
    await placeCaret(paragraph(page, 0), 'end');

    await page.keyboard.press('Shift+ArrowLeft');

    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).not.toHaveCount(0);
  });

  test('RTL: Shift+ArrowRight at the start of a block selects across blocks', async ({ page }) => {
    await createBlok(page, [ARABIC_FIRST, ARABIC_SECOND], 'rtl');
    await placeCaret(paragraph(page, 1), 'start');

    await page.keyboard.press('Shift+ArrowRight');

    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).not.toHaveCount(0);
  });

  test('RTL: leaving a block selection with ArrowLeft puts the caret at the end of the last block', async ({ page }) => {
    await createBlok(page, [ARABIC_FIRST, ARABIC_SECOND], 'rtl');
    await placeCaret(paragraph(page, 0), 'end');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).toHaveCount(2);

    await page.keyboard.press('ArrowLeft');

    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 1, offset: ARABIC_SECOND.length });
    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).toHaveCount(0);
  });

  test('RTL: leaving a block selection with ArrowRight puts the caret at the start of the first block', async ({ page }) => {
    await createBlok(page, [ARABIC_FIRST, ARABIC_SECOND], 'rtl');
    await placeCaret(paragraph(page, 0), 'end');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator(SELECTED_BLOCK_SELECTOR)).toHaveCount(2);

    await page.keyboard.press('ArrowRight');

    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 0, offset: 0 });
  });

  test('an LTR block inside an RTL editor moves by its own direction', async ({ page }) => {
    await createBlok(page, ['Hello', 'World'], 'rtl');

    for (const index of [0, 1]) {
      await paragraph(page, index).evaluate((element) => element.setAttribute('dir', 'ltr'));
      await expect.poll(() => paragraph(page, index).evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
    }

    await placeCaret(paragraph(page, 0), 'end');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 1, offset: 0 });

    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 0, offset: 'Hello'.length });
  });

  test('an RTL block inside an LTR editor moves by its own direction', async ({ page }) => {
    await createBlok(page, [ARABIC_FIRST, ARABIC_SECOND], 'ltr');

    for (const index of [0, 1]) {
      await paragraph(page, index).evaluate((element) => element.setAttribute('dir', 'rtl'));
      await expect.poll(() => paragraph(page, index).evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');
    }

    await placeCaret(paragraph(page, 0), 'end');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 1, offset: 0 });
  });

  test('LTR: ArrowRight at the end and ArrowLeft at the start still cross blocks', async ({ page }) => {
    await createBlok(page, ['Hello', 'World'], 'ltr');
    await placeCaret(paragraph(page, 0), 'end');

    await page.keyboard.press('ArrowRight');
    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 1, offset: 0 });

    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 0, offset: 'Hello'.length });
  });

  test('RTL: a horizontal move resets the column ArrowDown aims at', async ({ page }) => {
    await createBlok(page, [ARABIC_LINE, ARABIC_LINE, ARABIC_LINE], 'rtl');
    await placeCaret(paragraph(page, 0), 'start');

    for (let step = 0; step < 15; step++) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 1, offset: 15 });

    for (let step = 0; step < 8; step++) {
      await page.keyboard.press('ArrowRight');
    }
    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 1, offset: 7 });

    await page.keyboard.press('ArrowDown');

    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 2, offset: 7 });
  });

  test('RTL: ArrowDown from an empty line lands at the start of the next block', async ({ page }) => {
    await createBlok(page, [ARABIC_FIRST, ARABIC_LINE], 'rtl');
    await placeCaret(paragraph(page, 0), 'end');
    await page.keyboard.press('Shift+Enter');

    await page.keyboard.press('ArrowDown');

    await expect.poll(() => caretInfo(page)).toMatchObject({ block: 1, offset: 0 });
  });
});

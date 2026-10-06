import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const createBlok = async (page: Page, data: OutputData, direction?: 'ltr' | 'rtl'): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, blokData, blokDirection }) => {
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
      data: blokData,
      ...(blokDirection === null ? {} : { i18n: { direction: blokDirection } }),
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokData: data, blokDirection: direction ?? null });
};

const field = (page: Page, id: string): Locator =>
  page.locator(`[data-blok-id="${id}"] [contenteditable]`).first();

interface Geometry {
  direction: string;
  fieldLeft: number;
  fieldRight: number;
  textLeft: number;
  textRight: number;
}

/** The field's computed direction, its box and the box of its text. */
const geometry = async (locator: Locator): Promise<Geometry> => {
  return await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();

    range.selectNodeContents(element);

    const rects = Array.from(range.getClientRects());

    return {
      direction: getComputedStyle(element).direction,
      fieldLeft: box.left,
      fieldRight: box.right,
      textLeft: Math.min(...rects.map(rect => rect.left)),
      textRight: Math.max(...rects.map(rect => rect.right)),
    };
  });
};

/** Left edge of the first occurrence of `char` in the field's text. */
const charLeft = async (locator: Locator, char: string): Promise<number> => {
  return await locator.evaluate((element, target) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode() as Text | null;
    const index = node?.data.indexOf(target) ?? -1;

    if (node === null || index === -1) {
      throw new Error(`"${target}" not found`);
    }

    const range = document.createRange();

    range.setStart(node, index);
    range.setEnd(node, index + 1);

    return range.getBoundingClientRect().left;
  }, char);
};

test.describe('Per-block content direction', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('an Arabic paragraph in an LTR editor reads right to left', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'ar', type: 'paragraph', data: { text: 'مرحبا بالعالم!' } },
        { id: 'en', type: 'paragraph', data: { text: 'Hello world!' } },
      ],
    });

    const arabic = await geometry(field(page, 'ar'));
    const english = await geometry(field(page, 'en'));

    expect(arabic.direction).toBe('rtl');
    // Right-aligned: the text hugs the field's right edge.
    expect(arabic.fieldRight - arabic.textRight).toBeLessThan(4);
    expect(arabic.textLeft - arabic.fieldLeft).toBeGreaterThan(100);
    // The trailing "!" sits at the LEFT end of the line.
    expect(await charLeft(field(page, 'ar'), '!')).toBeLessThan(arabic.textLeft + 4);

    expect(english.direction).toBe('ltr');
    expect(english.textLeft - english.fieldLeft).toBeLessThan(4);
    // The same column: the Arabic block did not move.
    expect(arabic.fieldLeft).toBe(english.fieldLeft);
    expect(arabic.fieldRight).toBe(english.fieldRight);
  });

  test('digit-only and empty blocks in an RTL editor stay right to left', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'num', type: 'paragraph', data: { text: '123' } },
        { id: 'empty', type: 'paragraph', data: { text: '' } },
        { id: 'en', type: 'paragraph', data: { text: 'Hello' } },
      ],
    }, 'rtl');

    const digits = await geometry(field(page, 'num'));

    expect(digits.direction).toBe('rtl');
    expect(digits.fieldRight - digits.textRight).toBeLessThan(4);
    expect(await field(page, 'empty').evaluate(element => getComputedStyle(element).direction)).toBe('rtl');
    expect((await geometry(field(page, 'en'))).direction).toBe('ltr');
  });

  test('typing an Arabic first letter into an empty block flips it live', async ({ page }) => {
    await createBlok(page, { blocks: [{ id: 'p', type: 'paragraph', data: { text: '' } }] });

    const paragraph = field(page, 'p');

    await expect(paragraph).toHaveCSS('direction', 'ltr');

    await paragraph.click();
    await page.keyboard.type('ب');

    await expect(paragraph).toHaveCSS('direction', 'rtl');

    const typed = await geometry(paragraph);

    expect(typed.fieldRight - typed.textRight).toBeLessThan(4);

    await page.keyboard.press('Backspace');

    await expect(paragraph).toHaveCSS('direction', 'ltr');
  });

  test('pasting Arabic text flips the block', async ({ page }) => {
    await createBlok(page, { blocks: [{ id: 'p', type: 'paragraph', data: { text: '' } }] });

    const paragraph = field(page, 'p');

    await paragraph.click();
    await paragraph.evaluate((element) => {
      const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: {
          getData: (type: string): string => (type === 'text/plain' ? 'مرحبا' : ''),
          types: ['text/plain'],
        },
      });

      element.dispatchEvent(event);
    });

    await expect(page.locator('[data-blok-element-content][dir="rtl"]')).toHaveCount(1);
    await expect(page.locator('[data-blok-element-content][dir="rtl"] [contenteditable]')).toHaveText('مرحبا');
  });
});

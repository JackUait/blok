import type { Page } from '@playwright/test';
import type { Blok } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const CONTENT_EDITABLE_SELECTOR = '[contenteditable="true"]';
const PILL_SELECTOR = '[data-blok-slash-search]';

const placeCaret = async (page: Page, offset: number): Promise<void> => {
  await page.evaluate(({ selector, at }) => {
    const editable = document.querySelector(selector);
    const text = editable?.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('expected a text node');
    }

    const range = document.createRange();

    range.setStart(text, at);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, { selector: CONTENT_EDITABLE_SELECTOR, at: offset });
};

// Firefox reports `content: attr(...)` unresolved, so read the attribute and
// only check that ::after draws something.
const afterContentOf = (page: Page): Promise<string> =>
  page.locator(PILL_SELECTOR).evaluate((el) => window.getComputedStyle(el, '::after').content);

test.describe('slash search in a block that has text', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    await page.evaluate(async (holder) => {
      const container = document.createElement('div');

      container.id = holder;
      document.body.appendChild(container);

      const blok = new window.Blok({
        holder,
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      window.blokInstance = blok;
      await blok.isReady;
    }, HOLDER_ID);

    await page.locator(CONTENT_EDITABLE_SELECTOR).click();
  });

  test('shows the placeholder right after "/" at the start of the block, before the text', async ({ page }) => {
    await placeCaret(page, 0);
    await page.keyboard.type('/');

    const pill = page.locator(PILL_SELECTOR);

    await expect(pill).toHaveText('/');
    await expect(pill).toHaveAttribute('data-blok-slash-search', 'Type to search');
    expect(['none', 'normal']).not.toContain(await afterContentOf(page));

    const { pillRight, textLeft } = await page.evaluate((selector) => {
      const pillEl = document.querySelector(selector);
      const editable = document.querySelector('[contenteditable="true"]');
      const textNode = Array.from(editable?.childNodes ?? []).find(
        (node): node is Text => node instanceof Text && node.data.includes('Hello')
      );

      if (pillEl === null || textNode === undefined) {
        throw new Error('pill or text missing');
      }

      const range = document.createRange();

      range.selectNodeContents(textNode);

      return {
        pillRight: pillEl.getBoundingClientRect().right,
        textLeft: range.getBoundingClientRect().left,
      };
    }, PILL_SELECTOR);

    expect(pillRight).toBeLessThanOrEqual(textLeft + 0.5);
  });

  test('does not move the text line or resize the block when the pill appears', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);
    const measure = (): Promise<{ top: number; height: number; blockHeight: number }> =>
      paragraph.evaluate((el) => {
        const rect = el.getBoundingClientRect();

        return {
          top: rect.top,
          height: rect.height,
          blockHeight: el.parentElement?.getBoundingClientRect().height ?? Number.NaN,
        };
      });

    await placeCaret(page, 0);

    const before = await measure();

    await page.keyboard.type('/');
    await expect(page.locator(PILL_SELECTOR)).toHaveText('/');

    const after = await measure();

    expect(after.top).toBeCloseTo(before.top, 1);
    expect(after.height).toBeCloseTo(before.height, 1);
    expect(after.blockHeight).toBeCloseTo(before.blockHeight, 1);
    expect(await page.locator(PILL_SELECTOR).evaluate((el) => window.getComputedStyle(el).display)).toBe('inline');
  });

  test('keeps the typed query inside the pill and hides the placeholder', async ({ page }) => {
    await placeCaret(page, 0);
    await page.keyboard.type('/he');

    await expect(page.locator(PILL_SELECTOR)).toHaveText('/he');
    await expect(page.locator(PILL_SELECTOR)).toHaveAttribute('data-blok-slash-search', '');
    await expect(page.locator(CONTENT_EDITABLE_SELECTOR)).toHaveText('/heHello world');
  });

  test('wraps only the "/" when it is typed after the text', async ({ page }) => {
    await placeCaret(page, 'Hello world'.length);
    await page.keyboard.type('/');

    await expect(page.locator(PILL_SELECTOR)).toHaveText('/');
    await expect(page.locator(CONTENT_EDITABLE_SELECTOR)).not.toHaveAttribute('data-blok-slash-search');
  });

  test('does not save the pill into block data', async ({ page }) => {
    await placeCaret(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(PILL_SELECTOR)).toHaveText('/');

    const saved = await page.evaluate(async () => {
      const output = await window.blokInstance?.save();

      return output?.blocks[0]?.data.text as string;
    });

    expect(saved).toBe('/Hello world');
  });

  test('does not save the pill from a heading', async ({ page }) => {
    await page.evaluate(async () => {
      await window.blokInstance?.render({ blocks: [{ type: 'header', data: { text: 'Hello world', level: 2 } }] });
    });
    await page.locator(CONTENT_EDITABLE_SELECTOR).click();
    await placeCaret(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(PILL_SELECTOR)).toHaveText('/');

    const saved = await page.evaluate(async () => {
      const output = await window.blokInstance?.save();

      return output?.blocks[0]?.data.text as string;
    });

    expect(saved).toBe('/Hello world');
  });

  test('picking a tool converts the block without leaving the pill behind', async ({ page }) => {
    await placeCaret(page, 0);
    await page.keyboard.type('/h');
    await expect(page.locator(PILL_SELECTOR)).toHaveText('/h');

    await page.keyboard.press('Enter');

    await expect(page.locator(PILL_SELECTOR)).toHaveCount(0);

    const saved = await page.evaluate(async () => {
      const output = await window.blokInstance?.save();

      return output?.blocks.map((block) => ({ type: block.type, text: block.data.text as string }));
    });

    expect(saved).toEqual([{ type: 'header', text: 'Hello world' }]);
  });

  test('removes the pill when Backspace deletes the "/"', async ({ page }) => {
    await placeCaret(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(PILL_SELECTOR)).toHaveText('/');

    await page.keyboard.press('Backspace');

    await expect(page.locator(PILL_SELECTOR)).toHaveCount(0);
    expect(await page.locator(CONTENT_EDITABLE_SELECTOR).evaluate((el) => el.innerHTML)).toBe('Hello world');

    await page.keyboard.type('x');

    await expect(page.locator(CONTENT_EDITABLE_SELECTOR)).toHaveText('xHello world');
  });

  test('removes the pill on Escape and keeps the caret after "/"', async ({ page }) => {
    await placeCaret(page, 0);
    await page.keyboard.type('/');
    await expect(page.locator(PILL_SELECTOR)).toHaveText('/');

    await page.keyboard.press('Escape');

    await expect(page.locator(PILL_SELECTOR)).toHaveCount(0);

    const html = await page.locator(CONTENT_EDITABLE_SELECTOR).evaluate((el) => el.innerHTML);

    expect(html).toBe('/Hello world');

    await page.keyboard.type('x');

    await expect(page.locator(CONTENT_EDITABLE_SELECTOR)).toHaveText('/xHello world');
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

const MARK = (word: string): string => `<mark style="background-color: var(--blok-color-yellow-bg);">${word}</mark>`;

test.beforeAll(ensureBlokBundleBuilt);

const boot = async (page: Page): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async (blocks) => {
    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:120px auto;padding:0 8px';
    document.body.append(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks } });
    await window.blokInstance.isReady;
  }, [
    { id: 'plain', type: 'paragraph', data: { text: 'A plain paragraph sits above.' } },
    { id: 'filled', type: 'paragraph', data: { text: 'A colored paragraph.', backgroundColor: 'gray' } },
    { id: 'heading', type: 'header', data: { text: 'A colored heading', level: 2, backgroundColor: 'gray' } },
    { id: 'words', type: 'paragraph', data: { text: `Some ${MARK('single')} ${MARK('words')} here.` } },
    { id: 'bare', type: 'paragraph', data: { text: 'Some single words here.' } },
  ]);
};

/**
 * Where the block's fill and its text start and end, shadow included.
 */
const fillOf = async (page: Page, id: string): Promise<{ fillLeft: number; fillRight: number; textLeft: number; boxRight: number; radius: string }> => {
  return page.locator(`[data-blok-id="${id}"] [data-blok-tool]`).evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const range = document.createRange();

    range.selectNodeContents(el);
    // Computed shadows read "color Xpx Ypx blur spread": the first length of each is its reach to one side.
    const reaches = [...style.boxShadow.matchAll(/(-?[\d.]+)px -?[\d.]+px -?[\d.]+px -?[\d.]+px/g)].map((match) => parseFloat(match[1]));

    return {
      fillLeft: box.left + Math.min(0, ...reaches),
      fillRight: box.right + Math.max(0, ...reaches),
      textLeft: range.getBoundingClientRect().left,
      boxRight: box.right - parseFloat(style.paddingRight),
      radius: style.borderTopLeftRadius,
    };
  });
};

test.describe('background fills hang past the text', () => {
  test('a colored block is filled 4px past its text on both sides, with 4px corners', async ({ page }) => {
    await boot(page);
    const plain = await fillOf(page, 'plain');

    for (const id of ['filled', 'heading']) {
      const fill = await fillOf(page, id);

      expect(fill.textLeft - fill.fillLeft, id).toBeCloseTo(4, 1);
      expect(fill.fillRight - fill.boxRight, id).toBeCloseTo(4, 1);
      expect(fill.radius, id).toBe('4px');
      // The text stays on the column's edge.
      expect(fill.textLeft, id).toBeCloseTo(plain.textLeft, 1);
    }
    expect(plain.radius).toBe('0px');
    expect(plain.fillLeft).toBeCloseTo(plain.textLeft - 2, 1);
  });

  test('a marked word is filled 1px past its letters, rounded, and moves nothing', async ({ page }) => {
    await boot(page);
    const marked = page.locator('[data-blok-id="words"] mark');
    const geometry = await page.evaluate(() => {
      const lastWordLeft = (id: string): number => {
        const tool = document.querySelector(`[data-blok-id="${id}"] [data-blok-tool]`);
        const node = tool?.lastChild;

        if (!(node instanceof Text)) {
          throw new Error('no trailing text');
        }
        const range = document.createRange();

        range.setStart(node, node.length - 5);
        range.setEnd(node, node.length);

        return range.getBoundingClientRect().left;
      };
      const mark = document.querySelector('[data-blok-id="words"] mark');

      if (mark === null) {
        throw new Error('no mark');
      }
      const range = document.createRange();

      range.selectNodeContents(mark);

      return {
        shift: lastWordLeft('words') - lastWordLeft('bare'),
        reach: range.getBoundingClientRect().left - mark.getBoundingClientRect().left,
      };
    });

    expect(geometry.shift).toBeCloseTo(0, 1);
    expect(geometry.reach).toBeCloseTo(1, 1);
    await expect(marked.first()).toHaveCSS('border-top-left-radius', '4px');
    await expect(marked.first()).toHaveCSS('padding-top', '1px');
    await expect(marked.first()).toHaveCSS('box-decoration-break', 'clone');
  });
});

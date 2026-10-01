import type { Page } from '@playwright/test';
import type { Blok } from '@/types';

import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

type Direction = 'ltr' | 'rtl';

// A block whose only field is a native <input>.
const FIELD_TOOL = `class {
  constructor({ data }) { this.data = data; }
  render() {
    const wrapper = document.createElement('div');
    const input = document.createElement('input');

    input.setAttribute('data-blok-testid', 'native-field');
    input.style.cssText = 'width:100%;font-size:16px;padding:0 4px;border:0';
    input.value = this.data.value ?? '';
    wrapper.appendChild(input);

    return wrapper;
  }
  save(element) { return { value: element.querySelector('input').value }; }
}`;

const TEXT: Record<Direction, string> = {
  rtl: 'مرحبا بالعالم الجميل هنا',
  ltr: 'hello beautiful world here',
};

const createBlok = async (page: Page, direction: Direction): Promise<void> => {
  await page.evaluate(async ({ dir, text, toolCode }) => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'width:720px;margin:0 auto';
    document.body.appendChild(holder);
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-unsafe-call -- the tool class is shipped as source
    const Field = new Function(`return (${toolCode});`)() as unknown;

    window.blokInstance = new window.Blok({
      holder,
      i18n: { direction: dir },
      tools: { field: Field },
      data: {
        blocks: [
          { type: 'paragraph', data: { text } },
          { type: 'field', data: { value: text } },
        ],
      },
    });
    await window.blokInstance.isReady;
  }, { dir: direction, text: TEXT[direction], toolCode: FIELD_TOOL });
};

/** Clicks the paragraph text at a fraction of its width, measured from the inline start. */
const clickParagraphAt = async (page: Page, direction: Direction, fromStart: number): Promise<void> => {
  const box = await page.locator('[data-blok-tool="paragraph"]').first().evaluate((element) => {
    const range = document.createRange();

    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();

    return { left: rect.left, right: rect.right, middle: rect.top + rect.height / 2 };
  });
  const width = box.right - box.left;
  const x = direction === 'rtl' ? box.right - width * fromStart : box.left + width * fromStart;

  await page.mouse.click(x, box.middle);
};

const fieldCaret = async (page: Page): Promise<number | null> => {
  const field = page.getByTestId('native-field');

  await expect(field).toBeFocused();

  return field.evaluate((element: HTMLInputElement) => element.selectionStart);
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await gotoTestPage(page);
});

for (const direction of ['rtl', 'ltr'] as const) {
  test(`ArrowDown into a native input keeps the caret column in ${direction}`, async ({ page }) => {
    await createBlok(page, direction);

    await clickParagraphAt(page, direction, 0.02);
    await page.keyboard.press('ArrowDown');
    const fromStart = await fieldCaret(page);

    await clickParagraphAt(page, direction, 0.5);
    await page.keyboard.press('ArrowDown');
    const fromMiddle = await fieldCaret(page);

    expect(fromStart).toBe(0);
    expect(fromMiddle).toBeGreaterThan(0);
    expect(fromMiddle).toBeLessThan(TEXT[direction].length);
  });
}

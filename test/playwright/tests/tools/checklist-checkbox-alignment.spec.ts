// test/playwright/tests/tools/checklist-checkbox-alignment.spec.ts

import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * A checklist item's checkbox must sit optically centred on the FIRST line of
 * its text at every text size the list tool's public `itemSize` config accepts
 * — not only at the 16px default the offset was hand-tuned for.
 *
 * Geometry lives in the built stylesheet, so this can only be measured in a
 * real browser against the production bundle.
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    BlokList: unknown;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const createChecklist = async (page: Page, itemSize?: string): Promise<void> => {
  await page.evaluate(async ({ holder, size }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      ...(size ? { tools: { list: { class: window.BlokList, inlineToolbar: true, config: { itemSize: size } } } } : {}),
      data: {
        blocks: [
          { type: 'list', data: { style: 'checklist', text: 'A checked checklist item', checked: true } },
          { type: 'list', data: { style: 'checklist', text: 'An unchecked checklist item' } },
        ],
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, size: itemSize ?? null });

  await page.waitForFunction(() => typeof window.Blok === 'function');
};

/**
 * Signed distance between the first text line's centre and the checkbox's
 * centre, in CSS pixels. Negative means the checkbox sits below the text.
 * @param page - the page under test
 * @param index - which checklist item to measure
 */
const centreOffset = async (page: Page, index: number): Promise<number> => {
  const row = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-list-style="checklist"] input[type="checkbox"]`).nth(index);

  return row.evaluate((checkbox) => {
    const content = checkbox.nextElementSibling;

    if (!(content instanceof HTMLElement)) {
      throw new Error('checklist content cell not found next to the checkbox');
    }

    const box = checkbox.getBoundingClientRect();
    const text = content.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(content).lineHeight);

    return (text.top + lineHeight / 2) - (box.top + box.height / 2);
  });
};

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

for (const itemSize of [undefined, '13px', '20px', '28px'] as const) {
  test(`centres the checkbox on the first text line at itemSize=${itemSize ?? 'default'}`, async ({ page }) => {
    await createChecklist(page, itemSize);

    await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-list-style="checklist"] input[type="checkbox"]`).first()).toBeVisible();

    expect(Math.abs(await centreOffset(page, 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(await centreOffset(page, 1))).toBeLessThanOrEqual(1);
  });
}

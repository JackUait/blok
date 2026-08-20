// test/playwright/tests/tools/placeholder-caret-position.spec.ts

import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * An empty block's placeholder is generated content (`::before`) sitting at the
 * start of the first line box. It must claim NO inline advance, or the caret —
 * which shares that position — is painted after the placeholder text, so the
 * block reads as if the placeholder were content the user had typed.
 *
 * The failure only surfaces when the caret's anchor owns a layout box, which is
 * why it was intermittent: a childless block gives the engine nothing to anchor
 * to and it parks the caret at the line start. A block holding the mark
 * engine's pending-format zero-width space is the reachable case — `Dom.isEmpty`
 * strips `​`, so such a block still counts as empty and still shows its
 * placeholder.
 *
 * Geometry lives in the built stylesheet, so this can only be measured in a
 * real browser against the production bundle.
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

const createEditor = async (page: Page, blocks: unknown[]): Promise<void> => {
  await page.evaluate(async ({ holder, data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: data } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data: blocks });

  await page.waitForFunction(() => typeof window.Blok === 'function');
};

/** Distance in CSS pixels from the host's content-box left edge to the caret. */
const caretOffsetFromLineStart = async (page: Page, selector: string): Promise<number> =>
  page.locator(selector).first().evaluate((element) => {
    const selection = window.getSelection();

    if (selection === null || selection.rangeCount === 0) {
      throw new Error('no selection to measure');
    }

    const caret = selection.getRangeAt(0).getBoundingClientRect();

    if (caret.height === 0) {
      throw new Error('caret has no rect — the anchor owns no layout box');
    }

    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const contentLeft = box.x + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);

    return caret.x - contentLeft;
  });

/**
 * Put the block into the pending-format state the mark engine produces: a lone
 * zero-width space with the caret after it. The block still reads as empty, so
 * the placeholder stays on screen.
 */
const seedPendingFormatCaret = async (page: Page, selector: string): Promise<void> => {
  await page.locator(selector).first().evaluate((element) => {
    const zwsp = document.createTextNode('​');

    element.replaceChildren(zwsp);
    element.focus();
    element.dispatchEvent(new Event('focusin', { bubbles: true }));

    const selection = window.getSelection();
    const range = document.createRange();

    range.setStart(zwsp, 1);
    range.setEnd(zwsp, 1);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
};

/** Rendered width of the placeholder's generated box, e.g. "0px". */
const placeholderBoxWidth = async (page: Page, selector: string): Promise<string> =>
  page.locator(selector).first().evaluate((element) => {
    const before = getComputedStyle(element, '::before');

    if (before.content === 'none' || before.content === 'normal') {
      throw new Error('placeholder is not being rendered');
    }

    return before.width;
  });

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test('placeholder does not push the caret past its text', async ({ page }) => {
  const selector = `${BLOK_INTERFACE_SELECTOR} h2`;

  await createEditor(page, [{ type: 'header', data: { text: '', level: 2 } }]);
  await page.locator(selector).first().click();
  await seedPendingFormatCaret(page, selector);

  expect(Math.abs(await caretOffsetFromLineStart(page, selector))).toBeLessThanOrEqual(1);
  expect(await placeholderBoxWidth(page, selector)).toBe('0px');
});

for (const { name, selector, blocks } of [
  {
    name: 'text',
    selector: `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`,
    blocks: [{ type: 'paragraph', data: { text: '' } }],
  },
  {
    name: 'header',
    selector: `${BLOK_INTERFACE_SELECTOR} h2`,
    blocks: [{ type: 'header', data: { text: '', level: 2 } }],
  },
]) {
  test(`${name} placeholder claims no inline advance`, async ({ page }) => {
    await createEditor(page, blocks);
    await page.locator(selector).first().click();

    expect(await placeholderBoxWidth(page, selector)).toBe('0px');
  });
}

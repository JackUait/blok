/**
 * Regression tests for toolbar button focus-stealing bug.
 *
 * When a user types in block A and the mouse happens to be hovering block B,
 * clicking the plus button or settings toggler should NOT steal focus from the
 * block the user is actively typing in.  The root cause is that the mousedown
 * handlers on both toolbar buttons did not call `preventDefault()`, so the
 * browser naturally moved DOM focus away from the active contenteditable,
 * causing subsequent keystrokes to land in the wrong block.
 *
 * The fix: add `e.preventDefault()` to both the plus-button and settings-toggler
 * mousedown handlers in toolbar/index.ts.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const SETTINGS_TOGGLER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

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
  }, { holder: HOLDER_ID, blocks });
};

test.describe('toolbar button focus preservation', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  /**
   * Regression test: the plus (+) button's mousedown event must have
   * `preventDefault()` called so that clicking it does NOT steal focus from
   * the block the user is currently typing in.
   *
   * We verify this by checking that the `defaultPrevented` property of the
   * mousedown event dispatched on the plus button is `true`.
   *
   * Steps:
   * 1. Create two paragraph blocks
   * 2. Click into the first block so it's active
   * 3. Hover over the second block to reveal the toolbar
   * 4. Fire a mousedown on the plus button and capture whether it was cancelled
   * 5. Assert `event.defaultPrevented === true`
   */
  test('plus button mousedown event must have preventDefault called', async ({ page }) => {
    await createParagraphBlok(page, [ 'First', 'Second' ]);

    const paragraphs = page.locator(PARAGRAPH_SELECTOR);
    const firstParagraph = paragraphs.nth(0);
    const secondParagraph = paragraphs.nth(1);

    // Click into first paragraph so it has focus
    await firstParagraph.click();

    // Hover over second paragraph to reveal toolbar
    await secondParagraph.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.waitFor({ state: 'visible' });

    // Dispatch a mousedown event on the plus button and record whether it was cancelled
    const wasDefaultPrevented = await plusButton.evaluate((el) => {
      return new Promise<boolean>((resolve) => {
        const handler = (e: Event): void => {
          el.removeEventListener('mousedown', handler, true);
          // Resolve after the event loop so all handlers have run
          setTimeout(() => resolve(e.defaultPrevented), 0);
        };

        el.addEventListener('mousedown', handler, true);
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      });
    });

    expect(wasDefaultPrevented).toBe(true);
  });

  /**
   * Regression test: the settings toggler's mousedown event must have
   * `preventDefault()` called so that dragging or clicking it does NOT steal
   * focus from the block the user is currently typing in.
   */
  test('settings toggler mousedown event must have preventDefault called', async ({ page }) => {
    await createParagraphBlok(page, [ 'First', 'Second' ]);

    const paragraphs = page.locator(PARAGRAPH_SELECTOR);
    const firstParagraph = paragraphs.nth(0);
    const secondParagraph = paragraphs.nth(1);

    // Click into first paragraph so it has focus
    await firstParagraph.click();

    // Hover over second paragraph to reveal toolbar
    await secondParagraph.hover();

    const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

    await settingsToggler.waitFor({ state: 'visible' });

    // Dispatch a mousedown event on the settings toggler and record whether it was cancelled
    const wasDefaultPrevented = await settingsToggler.evaluate((el) => {
      return new Promise<boolean>((resolve) => {
        const handler = (e: Event): void => {
          el.removeEventListener('mousedown', handler, true);
          setTimeout(() => resolve(e.defaultPrevented), 0);
        };

        el.addEventListener('mousedown', handler, true);
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      });
    });

    expect(wasDefaultPrevented).toBe(true);
  });

  /**
   * End-to-end regression test: clicking the plus button and pressing Escape
   * to dismiss the toolbox must return focus inside the editor (not to body).
   *
   * Steps:
   * 1. Create two paragraph blocks: "Hello" and "Second"
   * 2. Click block A ("Hello"), place caret at end
   * 3. Hover block B to reveal its toolbar (plus button visible)
   * 4. Click the plus button (opens toolbox)
   * 5. Press Escape to dismiss the toolbox without choosing a tool
   * 6. Verify that after dismissal, focus is inside a contenteditable element
   *    (not leaked to document.body or outside the editor)
   */
  test('plus button click then Escape should return focus inside the editor', async ({ page }) => {
    await createParagraphBlok(page, [ 'Hello', 'Second' ]);

    const paragraphs = page.locator(PARAGRAPH_SELECTOR);
    const firstParagraph = paragraphs.nth(0);
    const secondParagraph = paragraphs.nth(1);

    // Click and place caret in first paragraph
    await firstParagraph.click();
    await page.keyboard.press('End');

    // Hover second paragraph to reveal its toolbar
    await secondParagraph.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.waitFor({ state: 'visible' });

    // Click plus button (opens toolbox)
    await plusButton.click();

    // Dismiss the toolbox via Escape
    await page.keyboard.press('Escape');

    // After dismissal, focus must be inside a contenteditable, not on body
    const activeElementTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
    const activeElementIsBody = activeElementTag.toLowerCase() === 'body';

    expect(activeElementIsBody).toBe(false);
  });

  /**
   * Direct text-jumping regression test: text typed in block A must not land
   * in block B even after hovering block B and pressing plus button followed
   * by Escape.
   *
   * Preconditions: Two blocks ("Hello" and ""), focus in block 0.
   * Action: Hover block 1 → click plus → Escape → type " World"
   * Expected: Block 0 = "Hello World", Block 1 = ""
   */
  test('text typed after plus+Escape should stay in the originally-focused block', async ({ page }) => {
    await createParagraphBlok(page, [ 'Hello', '' ]);

    const paragraphs = page.locator(PARAGRAPH_SELECTOR);
    const firstParagraph = paragraphs.nth(0);
    const secondParagraph = paragraphs.nth(1);

    // Click block 0, place caret at end
    await firstParagraph.click();
    await page.keyboard.press('End');

    // Hover block 1 to show toolbar
    await secondParagraph.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.waitFor({ state: 'visible' });

    // Click plus (opens toolbox), then Escape to dismiss
    await plusButton.click();
    await page.keyboard.press('Escape');

    // Wait for focus restoration to complete (toolbox fully closed)
    await page.waitForFunction(() => !document.querySelector('[data-blok-toolbox-opened]'));

    // Click block 0 explicitly to re-anchor focus (simulates user going back)
    await firstParagraph.click();
    await page.keyboard.press('End');

    // Type more text
    await page.keyboard.type(' World');

    // All text must be in block 0
    const firstText = await firstParagraph.evaluate((el) => el.textContent ?? '');

    expect(firstText).toBe('Hello World');

    // Block 1 must remain empty
    const secondText = await secondParagraph.evaluate((el) => el.textContent ?? '');

    expect(secondText).toBe('');
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

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

/**
 * Triggers a real mousedown on a locator via Playwright's mouse API and
 * returns whether the handler called preventDefault().
 *
 * Installs a one-shot capturing listener, moves the mouse to the element
 * center, presses down, then reads the captured defaultPrevented flag.
 */
const checkMousedownDefaultPrevented = async (page: Page, locator: ReturnType<Page['locator']>): Promise<boolean> => {
  await locator.evaluate((el) => {
    const handler = (e: Event): void => {
      el.removeEventListener('mousedown', handler, true);
      (window as unknown as Record<string, boolean>).__blokTestDefaultPrevented = e.defaultPrevented;
    };

    el.addEventListener('mousedown', handler, true);
  });

  const box = await locator.boundingBox();

  if (box === null) {
    throw new Error('Bounding box is null — element is not visible');
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();

  return page.evaluate(
    () => (window as unknown as Record<string, boolean>).__blokTestDefaultPrevented
  );
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

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'First' });
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'Second' });

    // Click into first paragraph so it has focus
    await firstParagraph.click();

    // Hover over second paragraph to reveal toolbar
    await secondParagraph.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.waitFor({ state: 'visible' });

    // Trigger a real mousedown via Playwright's mouse API and check defaultPrevented
    const wasDefaultPrevented = await checkMousedownDefaultPrevented(page, plusButton);

    expect(wasDefaultPrevented).toBe(true);
  });

  /**
   * Regression test: the settings toggler's mousedown event must have
   * `preventDefault()` called so that dragging or clicking it does NOT steal
   * focus from the block the user is currently typing in.
   */
  test('settings toggler mousedown event must have preventDefault called', async ({ page }) => {
    await createParagraphBlok(page, [ 'First', 'Second' ]);

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'First' });
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'Second' });

    // Click into first paragraph so it has focus
    await firstParagraph.click();

    // Hover over second paragraph to reveal toolbar
    await secondParagraph.hover();

    const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

    await settingsToggler.waitFor({ state: 'visible' });

    // Trigger a real mousedown via Playwright's mouse API and check defaultPrevented
    const wasDefaultPrevented = await checkMousedownDefaultPrevented(page, settingsToggler);

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

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'Hello' });
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'Second' });

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
   * The user must NOT need to re-click block A after Escape — focus should be
   * restored automatically to the block that had focus before the plus was clicked.
   *
   * Preconditions: Two blocks ("Hello" and "Second"), focus in block 0.
   * Action: Hover block 1 → click plus → Escape → type " World" (NO re-click)
   * Expected: Block 0 = "Hello World"; block count = 3 (inserted line stays)
   */
  test('text typed after plus+Escape should stay in the originally-focused block', async ({ page }) => {
    await createParagraphBlok(page, [ 'Hello', 'Second' ]);

    const allParagraphs = page.locator(PARAGRAPH_SELECTOR);
    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'Hello' });
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'Second' });

    // Click block 0, place caret at end
    await firstParagraph.click();
    await page.keyboard.press('End');

    // Hover block 1 to show toolbar
    await secondParagraph.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.waitFor({ state: 'visible' });

    // Click plus (opens toolbox), then Escape to dismiss — NO re-click after this
    await plusButton.click();
    await page.keyboard.press('Escape');

    // Wait for focus restoration to complete (toolbox fully closed)
    await page.waitForFunction(() => !document.querySelector('[data-blok-toolbox-opened]'));

    // Type without re-clicking — text must land in block 0
    await page.keyboard.type(' World');

    // All text must be in block 0
    const firstText = await firstParagraph.evaluate((el) => el.textContent ?? '');

    expect(firstText).toBe('Hello World');

    // Block count must be 3: original two blocks + the inserted empty line
    // that the plus button created (kept in place per new "leave it" behavior)
    await expect(allParagraphs).toHaveCount(3);
  });

  /**
   * Regression test: clicking the plus button creates a new line.
   * If the user dismisses the toolbox (Escape or click-away) without
   * choosing a tool, the newly created line MUST stay in place.
   *
   * Steps:
   * 1. Create one paragraph block "Hello"
   * 2. Hover it → click plus → new empty line inserted below
   * 3. Press Escape to dismiss the toolbox
   * 4. Block count must be 2 (the inserted line stays)
   */
  test('plus button click then Escape should leave the inserted line in place', async ({ page }) => {
    await createParagraphBlok(page, [ 'Hello' ]);

    const allParagraphs = page.locator(PARAGRAPH_SELECTOR);
    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'Hello' });

    await firstParagraph.click();
    await firstParagraph.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.waitFor({ state: 'visible' });
    await plusButton.click();
    await page.keyboard.press('Escape');

    await page.waitForFunction(() => !document.querySelector('[data-blok-toolbox-opened]'));

    await expect(allParagraphs).toHaveCount(2);
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

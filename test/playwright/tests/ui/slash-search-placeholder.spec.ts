import type { Blok } from '../../../../types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const CONTENT_EDITABLE_SELECTOR = '[contenteditable="true"]';

test.describe('slash search placeholder', () => {
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

      const blok = new window.Blok({ holder });
      window.blokInstance = blok;
      await blok.isReady;
    }, HOLDER_ID);
  });

  test('should show placeholder when slash is typed and hide it when query is entered', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);
    await paragraph.click();

    // Type "/" to open toolbox
    await page.keyboard.type('/');

    // Attribute should be set with placeholder text
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);

    // Should have search input styling (background color)
    const bgColor = await paragraph.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');

    // Type a query — placeholder value should become empty
    await page.keyboard.type('head');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', '');

    // Clear query back to just "/" — placeholder should return
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);
  });

  test('should render slash and placeholder on the same line (inline layout)', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);
    await paragraph.click();

    await page.keyboard.type('/');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);

    // "/" and the ::after placeholder must share one line — not stack vertically.
    // Asserted on geometry rather than on a specific `display` value: the pill box
    // may never grow past a single line box (plus its 2px block padding).
    const { height, lineHeight } = await paragraph.evaluate((el) => {
      const styles = window.getComputedStyle(el);

      return {
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(styles.lineHeight),
      };
    });

    expect(height).toBeLessThan(lineHeight * 1.6);
  });

  /**
   * Regression: the caret in the slash-search input was drawn at the height of the
   * whole block (line box + the pill's 9px top margin — 38px measured), starting at
   * the pill's left border instead of inside its padding.
   *
   * Root cause: the pill made the block's contenteditable a flex container. A flex
   * container establishes no inline formatting context, so an EMPTY editable has no
   * line box for the engine to size the caret from and it falls back to the
   * containing block's box. (With text typed the caret sizes off the text run, which
   * is why only the empty state — the + button path, which inserts no "/" — was
   * visibly broken.)
   *
   * The invariant: the pill must lay its content out inline, so its own line box
   * always sizes the caret.
   */
  test('should not make the search input a flex container (caret sizing)', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);
    await paragraph.click();

    await page.keyboard.type('/');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);

    const display = await paragraph.evaluate(
      (el) => window.getComputedStyle(el).display
    );

    expect(['flex', 'inline-flex', 'grid', 'inline-grid']).not.toContain(display);
  });

  test('should not make the empty (+ button) search input a flex container', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);

    await paragraph.click();
    await paragraph.hover();

    const plusButton = page.locator('[data-blok-testid="plus-button"]');

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    const pill = page.locator('[data-blok-slash-search]');

    await expect(pill).toHaveAttribute('data-blok-slash-search', /.+/);
    // The + button path inserts no "/", so the editable stays empty — the state
    // where a flex container leaves the caret without a line box of its own.
    await expect(pill).toHaveText('');

    const display = await pill.evaluate((el) => window.getComputedStyle(el).display);

    expect(['flex', 'inline-flex', 'grid', 'inline-grid']).not.toContain(display);
  });

  test('should keep "/" text visible (not transparent) in the search input', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);
    await paragraph.click();

    await page.keyboard.type('/');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);

    // The text color must NOT be transparent — "/" and typed query should be visible
    const color = await paragraph.evaluate(
      (el) => window.getComputedStyle(el).color
    );
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('should remove slash search styling when toolbox closes', async ({ page }) => {
    const paragraph = page.locator(CONTENT_EDITABLE_SELECTOR);
    await paragraph.click();

    await page.keyboard.type('/');
    await expect(paragraph).toHaveAttribute('data-blok-slash-search', /.+/);

    // Press Escape to close toolbox
    await page.keyboard.press('Escape');

    // Attribute should be removed
    await expect(paragraph).not.toHaveAttribute('data-blok-slash-search');
  });
});

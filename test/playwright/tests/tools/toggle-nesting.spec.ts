import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOLDER_ID = 'blok';
const TOGGLE_ARROW_SELECTOR = '[data-blok-toggle-arrow]';

// ---------------------------------------------------------------------------
// Global window augmentation
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

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

const createBlokWithData = async (
  page: Page,
  blocks: OutputData['blocks']
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

// ===========================================================================
// Tests
// ===========================================================================

test.describe('Toggle nesting: cross-type (toggle list <-> toggle heading)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // =========================================================================
  // Test 1: toggle list nested inside toggle heading
  // =========================================================================

  test('toggle list nested inside toggle heading: list block is inside heading\'s toggle-children container', async ({ page }) => {
    /**
     * Block tree:
     *   heading-1  (header, isToggleable: true, content: ['toggle-1'])
     *     toggle-1 (toggle, parent: 'heading-1', content: ['para-1'])
     *       para-1 (paragraph, parent: 'toggle-1')
     *
     * Expected: the toggle block's holder element is a descendant of the
     * heading's [data-blok-toggle-children] container.
     *
     * Currently FAILS because the header tool does not render a
     * [data-blok-toggle-children] element — child blocks are placed flat in
     * the editor's root, not inside the heading's container.
     */
    await createBlokWithData(page, [
      {
        id: 'heading-1',
        type: 'header',
        data: { text: 'Toggle Heading', level: 2, isToggleable: true },
        content: ['toggle-1'],
      },
      {
        id: 'toggle-1',
        type: 'toggle',
        data: { text: 'Nested Toggle' },
        parent: 'heading-1',
        content: ['para-1'],
      },
      {
        id: 'para-1',
        type: 'paragraph',
        data: { text: 'Leaf paragraph' },
        parent: 'toggle-1',
      },
    ]);

    // Use page.evaluate to avoid Playwright strict mode: querySelector returns the
    // first match, which is the heading's own [data-blok-toggle-children] container.
    // (The nested toggle list also has its own container further inside.)
    const result = await page.evaluate(() => {
      const headerBlock = document.querySelector('[data-blok-component="header"]');
      // heading's own container — the first [data-blok-toggle-children] inside the header
      const container = headerBlock?.querySelector('[data-blok-toggle-children]');
      const toggleBlock = document.querySelector('[data-blok-component="toggle"]');

      return {
        containerExists: container != null,
        toggleInsideContainer: container != null && toggleBlock != null && container.contains(toggleBlock),
      };
    });

    expect(result.containerExists).toBe(true);
    expect(result.toggleInsideContainer).toBe(true);
  });

  // =========================================================================
  // Test 2: toggle heading nested inside toggle list — paragraph placement
  // =========================================================================

  test('toggle heading nested inside toggle list: heading block\'s children are inside heading\'s toggle-children container', async ({ page }) => {
    /**
     * Block tree:
     *   toggle-list-1 (toggle, content: ['heading-1'])
     *     heading-1   (header, isToggleable: true, parent: 'toggle-list-1', content: ['para-1'])
     *       para-1    (paragraph, parent: 'heading-1')
     *
     * Expected: para-1's holder is inside the heading's own
     * [data-blok-toggle-children] container.
     *
     * Currently FAILS because the header tool renders no
     * [data-blok-toggle-children] element, so the paragraph ends up flat
     * inside the toggle list's children area rather than inside the heading's.
     */
    await createBlokWithData(page, [
      {
        id: 'toggle-list-1',
        type: 'toggle',
        data: { text: 'Outer Toggle' },
        content: ['heading-1'],
      },
      {
        id: 'heading-1',
        type: 'header',
        data: { text: 'Nested Toggle Heading', level: 2, isToggleable: true },
        parent: 'toggle-list-1',
        content: ['para-1'],
      },
      {
        id: 'para-1',
        type: 'paragraph',
        data: { text: 'Deeply nested paragraph' },
        parent: 'heading-1',
      },
    ]);

    // The heading's [data-blok-toggle-children] container must exist.
    const headingToggleChildren = page.locator(
      '[data-blok-component="header"] [data-blok-toggle-children]'
    );

    await expect(headingToggleChildren).toBeAttached();

    // The paragraph block's holder must be inside the heading's container.
    const paraInsideHeadingChildren = await page.evaluate(() => {
      const container = document.querySelector(
        '[data-blok-component="header"] [data-blok-toggle-children]'
      );
      const paraBlock = document.querySelector('[data-blok-component="paragraph"]');

      if (!container || !paraBlock) {
        return false;
      }

      return container.contains(paraBlock);
    });

    expect(paraInsideHeadingChildren).toBe(true);
  });

  // =========================================================================
  // Test 3: toggle heading inside toggle list collapses its children
  // =========================================================================

  test('toggle heading nested inside toggle list collapses its children when heading arrow is clicked', async ({ page }) => {
    /**
     * Same block tree as test 2. After clicking the heading's toggle arrow
     * the paragraph (heading's child) must become hidden.
     *
     * Currently FAILS because the header tool has no [data-blok-toggle-children]
     * container to collapse — child blocks sit flat in the DOM and are not
     * controlled by the heading's open/closed state.
     */
    await createBlokWithData(page, [
      {
        id: 'toggle-list-1',
        type: 'toggle',
        data: { text: 'Outer Toggle' },
        content: ['heading-1'],
      },
      {
        id: 'heading-1',
        type: 'header',
        data: { text: 'Nested Toggle Heading', level: 2, isToggleable: true },
        parent: 'toggle-list-1',
        content: ['para-1'],
      },
      {
        id: 'para-1',
        type: 'paragraph',
        data: { text: 'Deeply nested paragraph' },
        parent: 'heading-1',
      },
    ]);

    // Confirm the paragraph is visible before collapsing.
    await expect(page.getByText('Deeply nested paragraph')).toBeVisible();

    // The heading must have a toggle arrow.
    const headingArrow = page
      .locator('[data-blok-component="header"]')
      .locator(TOGGLE_ARROW_SELECTOR);

    await expect(headingArrow).toBeVisible();

    // Click the heading's arrow to collapse.
    await headingArrow.click();

    // The paragraph must no longer be visible.
    await expect(page.getByText('Deeply nested paragraph')).not.toBeVisible();
  });
});

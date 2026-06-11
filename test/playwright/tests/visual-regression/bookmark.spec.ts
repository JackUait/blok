import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression baselines for the Bookmark block tool.
 *
 * Covers every visual variant of the bookmark card (full / partial metadata,
 * hostname fallback, long-content clamping, empty placeholder, read-only) plus
 * the paste-flow LOADING and ERROR states, which are made deterministic by
 * routing the unfurl endpoint.
 *
 * Determinism rules:
 *   - No remote images: the cover image and favicon are inline data: URIs.
 *   - All external network is blocked defensively in beforeEach.
 *   - A bookmark constructed WITH a url renders the card directly — no fetch.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const BOOKMARK_TOOL_SELECTOR = '[data-blok-tool="bookmark"]';
const CARD_SELECTOR = '[data-blok-testid="bookmark-card"]';

const SCREENSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled' as const,
  caret: 'hide' as const,
};

/**
 * Builds an inline SVG data URI with a solid fill so screenshots never depend
 * on network-loaded images. data: URIs bypass page routing entirely.
 *
 * @param width - SVG width in pixels
 * @param height - SVG height in pixels
 * @param fill - Solid fill color
 */
const svgDataUri = (width: number, height: number, fill: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`
  )}`;

const CARD_IMAGE = svgDataUri(640, 360, '#4a6cf7');
const CARD_FAVICON = svgDataUri(32, 32, '#f59e0b');

const BOOKMARK_URL = 'https://example.com/article';
const BOOKMARK_TITLE = 'Example Article Title';
const BOOKMARK_DESCRIPTION = 'A short description of the example article shown inside the bookmark card.';

const LONG_TITLE = 'The Comprehensive and Unreasonably Detailed Chronicle of Bookmark Card Title Truncation Behavior in Block-Based Editors, Including Every Edge Case We Could Imagine While Writing This Sentence';
const LONG_DESCRIPTION = 'This description is intentionally verbose so that the bookmark card has to clamp it. It rambles on about OpenGraph metadata, unfurl endpoints, line clamping, ellipses, and the general futility of fitting an entire article summary into two lines of a compact preview card rendered inside a block-based editor.';
const LONG_URL = 'https://example.com/articles/2026/06/an-extremely-long-pathname-created-to-exercise-url-truncation/in-the-bookmark-card-link-row?utm_source=visual-regression&utm_medium=playwright&utm_campaign=bookmark-long-content&utm_term=truncation&utm_content=clamping';

interface BookmarkSeedData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

const FULL_CARD_DATA: BookmarkSeedData = {
  url: BOOKMARK_URL,
  title: BOOKMARK_TITLE,
  description: BOOKMARK_DESCRIPTION,
  favicon: CARD_FAVICON,
  image: CARD_IMAGE,
};

/**
 * Removes any previous editor instance and recreates the holder element.
 *
 * @param page - Playwright page
 */
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
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

/**
 * Creates an editor seeded with a single bookmark block. A bookmark
 * constructed WITH a url renders the card directly (state RENDERED),
 * so no unfurl request is made.
 *
 * @param page - Playwright page
 * @param data - Bookmark block data
 * @param extraConfig - Extra Blok config (e.g. readOnly)
 */
const createBookmarkEditor = async (
  page: Page,
  data: BookmarkSeedData,
  extraConfig?: Record<string, unknown>
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blockData, extras }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: [ { type: 'bookmark', data: blockData } ] },
        ...(extras ?? {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blockData: data, extras: extraConfig ?? null }
  );
};

/**
 * Creates an empty editor (single default paragraph) for paste-flow tests.
 *
 * @param page - Playwright page
 */
const createEmptyEditor = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder }) => {
      const blok = new window.Blok({ holder });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID }
  );
};

/**
 * Dispatches a synthetic paste event carrying plain text.
 *
 * @param locator - Target contenteditable locator
 * @param text - Text to paste
 */
const pasteText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element: HTMLElement, value: string) => {
    const pasteEvent = Object.assign(
      new Event('paste', { bubbles: true, cancelable: true }),
      {
        clipboardData: {
          getData: (type: string): string => (type === 'text/plain' ? value : ''),
          types: ['text/plain'],
        },
      }
    );

    element.dispatchEvent(pasteEvent);
  }, text);
};

const firstEditable = (page: Page): Locator =>
  page.locator(`${BLOCK_SELECTOR}:nth-of-type(1) [contenteditable]`);

const bookmarkTool = (page: Page): Locator => page.locator(BOOKMARK_TOOL_SELECTOR);

test.describe('Bookmark — visual regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    // Block external network defensively: any non-localhost request gets a
    // flat gray page. data: URIs bypass routing, so card images still render.
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#e8e8e8"></body></html>',
    }));

    await page.goto(TEST_PAGE_URL);
  });

  test('full card with title, description, favicon and image', async ({ page }) => {
    await createBookmarkEditor(page, FULL_CARD_DATA);

    await expect(page.locator(CARD_SELECTOR)).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-full.png', SCREENSHOT_OPTIONS);
  });

  test('card without image', async ({ page }) => {
    await createBookmarkEditor(page, {
      url: BOOKMARK_URL,
      title: BOOKMARK_TITLE,
      description: BOOKMARK_DESCRIPTION,
      favicon: CARD_FAVICON,
    });

    await expect(page.locator(CARD_SELECTOR)).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-no-image.png', SCREENSHOT_OPTIONS);
  });

  test('card without description', async ({ page }) => {
    await createBookmarkEditor(page, {
      url: BOOKMARK_URL,
      title: BOOKMARK_TITLE,
      favicon: CARD_FAVICON,
      image: CARD_IMAGE,
    });

    await expect(page.locator(CARD_SELECTOR)).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-no-description.png', SCREENSHOT_OPTIONS);
  });

  test('card without favicon', async ({ page }) => {
    await createBookmarkEditor(page, {
      url: BOOKMARK_URL,
      title: BOOKMARK_TITLE,
      description: BOOKMARK_DESCRIPTION,
      image: CARD_IMAGE,
    });

    await expect(page.locator(CARD_SELECTOR)).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-no-favicon.png', SCREENSHOT_OPTIONS);
  });

  test('minimal card with url only falls back to hostname title', async ({ page }) => {
    await createBookmarkEditor(page, { url: BOOKMARK_URL });

    const card = page.locator(CARD_SELECTOR);

    await expect(card).toBeVisible();
    await expect(card.locator('[data-role="bookmark-title"]')).toHaveText('example.com');

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-minimal.png', SCREENSHOT_OPTIONS);
  });

  test('long title, description and url are clamped', async ({ page }) => {
    await createBookmarkEditor(page, {
      url: LONG_URL,
      title: LONG_TITLE,
      description: LONG_DESCRIPTION,
      favicon: CARD_FAVICON,
      image: CARD_IMAGE,
    });

    await expect(page.locator(CARD_SELECTOR)).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-long-content.png', SCREENSHOT_OPTIONS);
  });

  test('empty state placeholder', async ({ page }) => {
    await createBookmarkEditor(page, { url: '' });

    await expect(page.locator('[data-blok-testid="bookmark-empty"]')).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-empty.png', SCREENSHOT_OPTIONS);
  });

  test('read-only full card', async ({ page }) => {
    await createBookmarkEditor(page, FULL_CARD_DATA, { readOnly: true });

    await expect(page.locator(CARD_SELECTOR)).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-readonly.png', SCREENSHOT_OPTIONS);
  });

  test('loading state while unfurl request is pending', async ({ page }) => {
    // Never fulfill the unfurl request — the tool stays in LOADING forever.
    await page.route('**/__unfurl*', () => {
      // Intentionally left pending: no fulfill, no continue, no abort.
    });

    await createEmptyEditor(page);

    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, BOOKMARK_URL);

    await expect(page.locator('[data-blok-testid="bookmark-loading"]')).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-loading.png', SCREENSHOT_OPTIONS);
  });

  test('error state when unfurl fails', async ({ page }) => {
    await page.route('**/__unfurl*', (route) => route.fulfill({ status: 500 }));

    await createEmptyEditor(page);

    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, BOOKMARK_URL);

    await expect(page.locator('[data-blok-testid="bookmark-error"]')).toBeVisible();

    await expect(bookmarkTool(page)).toHaveScreenshot('bookmark-error.png', SCREENSHOT_OPTIONS);
  });
});

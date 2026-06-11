import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression baselines for the Embed tool's STATE variants
 * (width, alignment, caption, read-only, empty, script kinds, hover handles).
 *
 * Per-service appearance is covered by a separate suite — this one freezes
 * the layout of each state using YouTube as the canonical iframe service.
 *
 * Determinism: all external network is stubbed before block creation, so the
 * iframe always paints the same flat gray placeholder page and widget scripts
 * resolve to empty JS.
 *
 * Baseline generation:
 *   yarn e2e test/playwright/tests/visual-regression/embed-states.spec.ts --update-snapshots
 */

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const HOLDER_ID = 'blok';

const EMBED_TOOL_SELECTOR = '[data-blok-tool="embed"]';
const FIGURE_SELECTOR = '[data-role="embed-figure"]';
const FRAME_SELECTOR = '[data-blok-testid="embed-frame"]';

const SCREENSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled' as const,
  caret: 'hide' as const,
};

/**
 * Script-kind containers (twitter blockquote, telegram script tag) are
 * visually empty while widget scripts are stubbed, so the embed element has
 * zero height and cannot be screenshotted directly. A fixed page clip pins
 * the surrounding editor layout instead.
 */
const SCRIPT_EMBED_CLIP = { x: 0, y: 0, width: 800, height: 300 };

const YOUTUBE_SOURCE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const YOUTUBE_EMBED = 'https://www.youtube.com/embed/dQw4w9WgXcQ';

type EmbedBlockData = Record<string, unknown>;

/**
 * Builds the canonical YouTube iframe embed data, exactly as the tool would
 * produce after a paste, with optional state overrides.
 */
const youtubeData = (overrides: EmbedBlockData = {}): EmbedBlockData => ({
  service: 'youtube',
  source: YOUTUBE_SOURCE,
  embed: YOUTUBE_EMBED,
  width: 580,
  height: 320,
  ...overrides,
});

/**
 * Stubs ALL external network so screenshots are deterministic:
 * widget scripts resolve to empty JS, everything else (including the
 * YouTube iframe) resolves to a flat gray placeholder page.
 *
 * The placeholder carries a 1×1 testid marker so tests can wait for the
 * frame document to load via getByTestId (bare tag locators are linted out).
 */
const STUB_PAGE_HTML =
  '<html><body style="margin:0;background:#e8e8e8">'
  + '<div data-blok-testid="embed-stub-page" style="width:1px;height:1px"></div>'
  + '</body></html>';

const stubExternalNetwork = async (page: Page): Promise<void> => {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => {
    const url = route.request().url();

    if (url.endsWith('.js') || url.includes('widgets.js') || url.includes('telegram-widget')) {
      void route.fulfill({ contentType: 'application/javascript', body: '' });
    } else {
      void route.fulfill({ contentType: 'text/html', body: STUB_PAGE_HTML });
    }
  });
};

/**
 * Resets the holder and creates a Blok instance with a single embed block.
 */
const createEmbedBlok = async (
  page: Page,
  data: EmbedBlockData,
  extraConfig?: Record<string, unknown>
): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });

  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blockData, extras }) => {
      const blocks: OutputData['blocks'] = [{ type: 'embed', data: blockData }];
      const blok = new window.Blok({ holder, data: { blocks }, ...(extras ?? {}) });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blockData: data, extras: extraConfig ?? null }
  );
};

/**
 * Scrolls the lazy-loaded iframe into view and waits for the stubbed gray
 * placeholder document to load inside it, so the paint is deterministic.
 */
const waitForFrameLoaded = async (page: Page): Promise<Locator> => {
  const figure = page.locator(FIGURE_SELECTOR);

  await figure.scrollIntoViewIfNeeded();
  await expect(page.frameLocator(FRAME_SELECTOR).getByTestId('embed-stub-page')).toBeVisible();

  return figure;
};

test.describe('Embed states — visual regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await stubExternalNetwork(page);
  });

  test('default: full width, centered', async ({ page }) => {
    await createEmbedBlok(page, youtubeData());
    await waitForFrameLoaded(page);

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-default.png', SCREENSHOT_OPTIONS);
  });

  test('width 50%, centered', async ({ page }) => {
    await createEmbedBlok(page, youtubeData({ widthPercent: 50 }));
    await waitForFrameLoaded(page);

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-width-50.png', SCREENSHOT_OPTIONS);
  });

  test('width 50%, aligned left', async ({ page }) => {
    await createEmbedBlok(page, youtubeData({ widthPercent: 50, alignment: 'left' }));
    await waitForFrameLoaded(page);

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-align-left.png', SCREENSHOT_OPTIONS);
  });

  test('width 50%, aligned right', async ({ page }) => {
    await createEmbedBlok(page, youtubeData({ widthPercent: 50, alignment: 'right' }));
    await waitForFrameLoaded(page);

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-align-right.png', SCREENSHOT_OPTIONS);
  });

  test('caption with text', async ({ page }) => {
    await createEmbedBlok(page, youtubeData({
      captionVisible: true,
      caption: 'A fixed deterministic caption',
    }));
    await waitForFrameLoaded(page);
    await expect(page.locator('[data-role="embed-caption"]')).toHaveText('A fixed deterministic caption');

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-caption.png', SCREENSHOT_OPTIONS);
  });

  test('caption visible but empty shows placeholder', async ({ page }) => {
    await createEmbedBlok(page, youtubeData({
      captionVisible: true,
      caption: '',
    }));
    await waitForFrameLoaded(page);
    await expect(page.locator('[data-role="embed-caption"]')).toBeVisible();

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-caption-empty.png', SCREENSHOT_OPTIONS);
  });

  test('read-only: no resize handles or overlay', async ({ page }) => {
    await createEmbedBlok(page, youtubeData(), { readOnly: true });
    const figure = await waitForFrameLoaded(page);

    await expect(figure.locator('[data-role="resize-handle"]')).toHaveCount(0);

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-readonly.png', SCREENSHOT_OPTIONS);
  });

  test('empty embed shows placeholder', async ({ page }) => {
    await createEmbedBlok(page, {});

    await expect(page.locator('[data-blok-testid="embed-empty"]')).toBeVisible();

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-empty.png', SCREENSHOT_OPTIONS);
  });

  test('script kind: twitter', async ({ page }) => {
    await createEmbedBlok(page, {
      service: 'twitter',
      source: 'https://twitter.com/jack/status/20',
      embed: 'https://twitter.com/i/status/20',
      kind: 'script',
      width: 550,
      height: 0,
    });

    await expect(page.locator('[data-blok-testid="embed-script"]')).toBeAttached();

    await expect(page).toHaveScreenshot('embed-state-script-twitter.png', { ...SCREENSHOT_OPTIONS, clip: SCRIPT_EMBED_CLIP });
  });

  test('script kind: telegram', async ({ page }) => {
    await createEmbedBlok(page, {
      service: 'telegram',
      source: 'https://t.me/durov/123',
      embed: 'https://t.me/durov/123',
      kind: 'script',
      width: 580,
      height: 0,
    });

    await expect(page.locator('[data-blok-testid="embed-script"]')).toBeAttached();

    await expect(page).toHaveScreenshot('embed-state-script-telegram.png', { ...SCREENSHOT_OPTIONS, clip: SCRIPT_EMBED_CLIP });
  });

  test('script kind: threads', async ({ page }) => {
    await createEmbedBlok(page, {
      service: 'threads',
      source: 'https://www.threads.com/@zuck/post/C2QBoRaRmR1',
      embed: 'https://www.threads.com/@zuck/post/C2QBoRaRmR1',
      kind: 'script',
      width: 550,
      height: 0,
    });

    await expect(page.locator('[data-blok-testid="embed-script"]')).toBeAttached();

    await expect(page).toHaveScreenshot('embed-state-script-threads.png', { ...SCREENSHOT_OPTIONS, clip: SCRIPT_EMBED_CLIP });
  });

  test('hover: resize handles revealed', async ({ page }) => {
    await createEmbedBlok(page, youtubeData());
    const figure = await waitForFrameLoaded(page);

    await figure.hover();
    await expect(figure.locator('[data-role="resize-handle"][data-edge="left"]')).toBeVisible();

    await expect(page.locator(EMBED_TOOL_SELECTOR)).toHaveScreenshot('embed-state-hover-handles.png', SCREENSHOT_OPTIONS);
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { EMBED_SERVICES, matchEmbedService, type EmbedMatch } from '../../../../src/tools/link/registry';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression — one screenshot per social embed service.
 *
 * Every external request is stubbed deterministically: widget scripts resolve
 * to empty JS (threads is script-kind) and everything else renders a flat
 * gray page, so the screenshot captures the block chrome plus each service's
 * characteristic aspect ratio without depending on live provider markup.
 *
 * Sample URLs mirror the positive cases proven by
 * test/unit/tools/link/registry.test.ts; block data is built exactly the way
 * Embed.onPaste builds it (via matchEmbedService + registry defaults).
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

const SCREENSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled' as const,
  caret: 'hide' as const,
};

/**
 * The threads blockquote is visually empty while its widget script is
 * stubbed, so the embed element has zero height and cannot be screenshotted
 * directly. A fixed page clip pins the surrounding editor layout instead.
 */
const SCRIPT_EMBED_CLIP = { x: 0, y: 0, width: 800, height: 300 };

const SOCIAL_SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'reddit', source: 'https://www.reddit.com/r/IAmA/comments/z1c9z/i_am_barack_obama_president_of_the_united_states/' },
  { service: 'instagram', source: 'https://www.instagram.com/p/BsOGulcndj-/' },
  { service: 'facebookvideo', source: 'https://www.facebook.com/facebook/videos/10153231379946729/' },
  { service: 'facebookpost', source: 'https://www.facebook.com/zuck/posts/10113961365418581' },
  { service: 'linkedin', source: 'https://www.linkedin.com/posts/williamhgates_the-last-chapter-of-my-career-activity-7326660324483289089-2c0f?utm_source=share' },
  { service: 'mastodon', source: 'https://mastodon.social/@Gargron/100254678717223630' },
  { service: 'pinterest', source: 'https://www.pinterest.com/pin/99360735500167749/' },
  { service: 'snapchat', source: 'https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPwAAYYmplb211YmdvAZ01kChEAZ01kCgkAAAAAQ' },
  { service: 'substack', source: 'https://astralcodexten.substack.com/p/still-alive' },
];

const THREADS_SOURCE = 'https://www.threads.com/@zuck/post/C2QBoRaRmR1';

/**
 * Resolves a sample URL through the registry; throws (instead of branching
 * inside the test) when the URL unexpectedly stops matching.
 */
const resolveMatch = (source: string): EmbedMatch => {
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`Sample URL did not match any embed service: ${source}`);
  }

  return match;
};

/**
 * Builds the exact block data Embed.onPaste would produce for the match.
 */
const buildBlockData = (match: EmbedMatch, source: string): Record<string, unknown> => {
  const config = EMBED_SERVICES[match.service];

  return {
    service: match.service,
    source,
    embed: match.embedUrl,
    kind: match.kind,
    width: config.width ?? DEFAULT_WIDTH,
    height: config.height ?? DEFAULT_HEIGHT,
  };
};

/**
 * Resets the holder and creates a Blok instance with a single embed block.
 */
const createEmbedBlok = async (
  page: Page,
  blockData: Record<string, unknown>
): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, data }) => {
      document.getElementById(holder)?.remove();
      const container = document.createElement('div');

      container.id = holder;
      document.body.appendChild(container);

      const blok = new window.Blok({
        holder,
        data: { blocks: [{ type: 'embed', data }] },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, data: blockData }
  );
};

test.describe('Embed services (social) — visual regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    // Stub all external network: widget scripts resolve to empty JS (threads
    // embed.js), everything else renders a deterministic gray page.
    await page.route(/^https?:\/\/(?!localhost)/, (route) => {
      const url = route.request().url();

      if (url.endsWith('.js')) {
        void route.fulfill({ contentType: 'application/javascript', body: '' });
      } else {
        void route.fulfill({
          contentType: 'text/html',
          body: '<html><body style="margin:0;background:#e8e8e8"><div data-blok-testid="embed-stub-ready"></div></body></html>',
        });
      }
    });

    await page.goto(TEST_PAGE_URL);
  });

  for (const { service, source } of SOCIAL_SERVICES) {
    test(service, async ({ page }) => {
      const match = resolveMatch(source);

      expect(match.service).toBe(service);

      await createEmbedBlok(page, buildBlockData(match, source));

      const embedBlock = page.locator('[data-blok-tool="embed"]');

      await embedBlock.scrollIntoViewIfNeeded();

      // The iframe is loading="lazy": wait for the stubbed document to render.
      await expect(
        page.frameLocator('[data-blok-testid="embed-frame"]').locator('[data-blok-testid="embed-stub-ready"]')
      ).toBeAttached();

      await expect(embedBlock).toHaveScreenshot(`embed-${service}.png`, SCREENSHOT_OPTIONS);
    });
  }

  test('threads', async ({ page }) => {
    const match = resolveMatch(THREADS_SOURCE);

    expect(match.service).toBe('threads');
    expect(match.kind).toBe('script');

    await createEmbedBlok(page, buildBlockData(match, THREADS_SOURCE));

    await expect(page.locator('[data-blok-testid="embed-script"]')).toBeAttached();

    await expect(page).toHaveScreenshot('embed-threads.png', { ...SCREENSHOT_OPTIONS, clip: SCRIPT_EMBED_CLIP });
  });
});

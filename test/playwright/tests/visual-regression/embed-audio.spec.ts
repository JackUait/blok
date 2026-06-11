import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { EMBED_SERVICES, matchEmbedService, type EmbedMatch } from '../../../../src/tools/link/registry';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression — one screenshot per audio/music embed service.
 *
 * Every external request is stubbed with a deterministic gray page, so the
 * screenshot captures the block chrome plus each service's characteristic
 * aspect ratio (audio players are short/wide) without depending on live
 * provider markup.
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

const AUDIO_SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'spotify', source: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' },
  { service: 'yandexmusic', source: 'https://music.yandex.ru/album/11904129/track/70471675' },
  { service: 'deezer', source: 'https://www.deezer.com/track/3135556' },
  { service: 'soundcloud', source: 'https://soundcloud.com/forss/flickermood' },
  { service: 'mixcloud', source: 'https://www.mixcloud.com/spartacus/party-time/' },
  { service: 'applemusic', source: 'https://music.apple.com/us/album/1989-taylors-version/1708308989' },
  { service: 'applepodcasts', source: 'https://podcasts.apple.com/us/podcast/the-daily/id1200361736' },
  { service: 'audiomack', source: 'https://audiomack.com/innercatmusic/song/allegro-in-b-flat-k-3' },
  { service: 'anghami', source: 'https://play.anghami.com/song/45385197' },
];

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

test.describe('Embed services (audio) — visual regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    // Stub all external network so iframes render a deterministic gray page.
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#e8e8e8"><div data-blok-testid="embed-stub-ready"></div></body></html>',
    }));

    await page.goto(TEST_PAGE_URL);
  });

  for (const { service, source } of AUDIO_SERVICES) {
    test(service, async ({ page }) => {
      const match = resolveMatch(source);

      expect(match.service).toBe(service);

      const config = EMBED_SERVICES[match.service];
      const embedBlockData = {
        service: match.service,
        source,
        embed: match.embedUrl,
        kind: match.kind,
        width: config.width ?? DEFAULT_WIDTH,
        height: config.height ?? DEFAULT_HEIGHT,
      };

      await page.waitForFunction(() => typeof window.Blok === 'function');

      await page.evaluate(
        async ({ holder, blockData }) => {
          document.getElementById(holder)?.remove();
          const container = document.createElement('div');

          container.id = holder;
          document.body.appendChild(container);

          const blok = new window.Blok({
            holder,
            data: { blocks: [{ type: 'embed', data: blockData }] },
          });

          window.blokInstance = blok;
          await blok.isReady;
        },
        { holder: HOLDER_ID, blockData: embedBlockData }
      );

      const embedBlock = page.locator('[data-blok-tool="embed"]');

      await embedBlock.scrollIntoViewIfNeeded();

      // The iframe is loading="lazy": wait for the stubbed document to render.
      await expect(
        page.frameLocator('[data-blok-testid="embed-frame"]').locator('[data-blok-testid="embed-stub-ready"]')
      ).toBeAttached();

      await expect(embedBlock).toHaveScreenshot(`embed-${service}.png`, SCREENSHOT_OPTIONS);
    });
  }
});

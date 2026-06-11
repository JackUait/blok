import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { EMBED_SERVICES, matchEmbedService } from '../../../../src/tools/link/registry';
import type { EmbedKind, EmbedMatch } from '../../../../src/tools/link/registry';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression baselines for video embed services.
 *
 * One screenshot per service in the "Video" group of the embed registry.
 * Each test builds the exact block data Embed.onPaste would produce for a
 * canonical sample URL (mirrored from test/unit/tools/link/registry.test.ts),
 * renders it on the Playwright test page, and snapshots the embed block.
 *
 * Determinism: all non-localhost network is stubbed with a gray placeholder
 * page, so the iframe content never changes — the screenshot captures the
 * block chrome and the per-service aspect ratio only.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const HOLDER_ID = 'blok';

const SCREENSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled' as const,
  caret: 'hide' as const,
};

interface EmbedBlockData {
  service: string;
  source: string;
  embed: string;
  kind: EmbedKind;
  width: number;
  height: number;
}

const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

const VIDEO_SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { service: 'youtubeplaylist', source: 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf' },
  { service: 'vimeo', source: 'https://vimeo.com/123456789' },
  { service: 'vimeoshowcase', source: 'https://vimeo.com/showcase/7008490' },
  { service: 'vimeoevent', source: 'https://vimeo.com/event/5285353' },
  { service: 'rutube', source: 'https://rutube.ru/video/abcdef0123456789abcdef0123456789/' },
  { service: 'vkvideo', source: 'https://vk.com/video-12345_67890' },
  { service: 'loom', source: 'https://www.loom.com/share/e5b8c04bca094dd8a5507925ab887002' },
  { service: 'streamable', source: 'https://streamable.com/moo' },
  { service: 'tiktok', source: 'https://www.tiktok.com/@javiercazarez/video/7469789434322455863' },
  { service: 'wistia', source: 'https://support.wistia.com/medias/h1z3uqsjal' },
  { service: 'vidyard', source: 'https://share.vidyard.com/watch/h2NqLfsfpLszhtLg1mXnAZ' },
  { service: 'giphy', source: 'https://giphy.com/gifs/lustig-witzig-funny-reaction-cJhDKXoHvzahcGPgiK' },
];

/**
 * Matches a sample URL against the registry, throwing when it no longer
 * matches so tests fail loudly without conditionals in the test body.
 */
const requireEmbedMatch = (source: string): EmbedMatch => {
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`Sample URL no longer matches the embed registry: ${source}`);
  }

  return match;
};

test.describe('Embed services (video) — visual regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;height:100vh;background:#e8e8e8" data-blok-testid="embed-stub-body"></body></html>',
    }));
    await page.goto(TEST_PAGE_URL);
  });

  for (const { service, source } of VIDEO_SERVICES) {
    test(service, async ({ page }) => {
      const match = requireEmbedMatch(source);

      expect(match.service).toBe(service);

      const config = EMBED_SERVICES[match.service];
      const blockData: EmbedBlockData = {
        service: match.service,
        source,
        embed: match.embedUrl,
        kind: match.kind,
        width: config.width ?? DEFAULT_WIDTH,
        height: config.height ?? DEFAULT_HEIGHT,
      };

      await page.waitForFunction(() => typeof window.Blok === 'function');

      await page.evaluate(
        async ({ holder, data }) => {
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
            data: { blocks: [{ type: 'embed', data }] },
          });

          window.blokInstance = blok;
          await blok.isReady;
        },
        { holder: HOLDER_ID, data: blockData }
      );

      const embedBlock = page.locator('[data-blok-tool="embed"]');

      await expect(embedBlock).toBeVisible();
      await embedBlock.scrollIntoViewIfNeeded();

      // The iframe is lazy-loaded; wait until the stubbed placeholder document
      // has rendered inside it so the screenshot is stable.
      await expect(
        page.frameLocator('[data-blok-testid="embed-frame"]').locator('[data-blok-testid="embed-stub-body"]')
      ).toBeVisible();

      await expect(embedBlock).toHaveScreenshot(`embed-${service}.png`, SCREENSHOT_OPTIONS);
    });
  }
});

import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { EMBED_SERVICES, matchEmbedService, type EmbedMatch } from '../../../../src/tools/link/registry';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression — one screenshot per productivity embed service.
 *
 * Every external request is stubbed with a deterministic gray page, so the
 * screenshot captures the block chrome plus each service's characteristic
 * aspect ratio (scheduling/forms/whiteboards are tall) without depending on
 * live provider markup.
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

const PRODUCTIVITY_SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'calendly', source: 'https://calendly.com/acme-team' },
  { service: 'tally', source: 'https://tally.so/r/wMNDgn' },
  { service: 'jotform', source: 'https://form.jotform.com/241234567890123' },
  { service: 'whimsical', source: 'https://whimsical.com/my-roadmap-Q3xL9mTzKvB2aWcRpD8uHn' },
  { service: 'excalidraw', source: 'https://excalidraw.com/#json=AbC123dEf456GhI789jK,XyZ987wVu654TsR321qP' },
  { service: 'tldraw', source: 'https://www.tldraw.com/r/AbCdEf123456' },
  { service: 'mentimeter', source: 'https://www.mentimeter.com/app/presentation/alxyz1u2abcdefg' },
  { service: 'behance', source: 'https://www.behance.net/gallery/123456789/Brand-Identity' },
  { service: 'chromatic', source: 'https://5ccbc373887ca40020446347-abcdef.chromatic.com/?path=/story/button--primary' },
  { service: 'plunker', source: 'https://plnkr.co/edit/abc123XYZ' },
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

test.describe('Embed services (productivity) — visual regression', () => {
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

  for (const { service, source } of PRODUCTIVITY_SERVICES) {
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

import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { EMBED_SERVICES, matchEmbedService, type EmbedMatch } from '../../../../src/tools/link/registry';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression — one screenshot per data-viz/education embed service.
 *
 * Every external request is stubbed with a deterministic gray page, so the
 * screenshot captures the block chrome plus each service's characteristic
 * aspect ratio (charts and interactives are tall) without depending on live
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

const DATA_VIZ_SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'datawrapper', source: 'https://datawrapper.dwcdn.net/OhYbA/4/' },
  { service: 'flourish', source: 'https://public.flourish.studio/visualisation/1234567/' },
  { service: 'ourworldindata', source: 'https://ourworldindata.org/grapher/life-expectancy?tab=chart&country=~USA' },
  { service: 'geogebra', source: 'https://www.geogebra.org/m/cAsHWvWS' },
  { service: 'scratch', source: 'https://scratch.mit.edu/projects/1090231983/' },
  { service: 'kahoot', source: 'https://create.kahoot.it/details/965a7a4f-1c81-4d63-a2db-1a4d8f1e0f12' },
  { service: 'genially', source: 'https://view.genially.com/64fb1c8a2d3e4f0011aabbcc/interactive-image' },
  { service: 'infogram', source: 'https://infogram.com/monthly-report-1h7g6k0e9q5o2oy' },
  { service: 'arcgisstorymaps', source: 'https://storymaps.arcgis.com/stories/0123456789abcdef0123456789abcdef' },
  { service: 'felt', source: 'https://felt.com/map/My-Cool-Map-9BCQglnQTleNJxRhmJWUDCA' },
  { service: 'p5js', source: 'https://editor.p5js.org/p5/sketches/Hk7tg4q7l' },
  { service: 'wakelet', source: 'https://wakelet.com/wake/4t7Vy9hDFLbacQHRSrSmVA' },
  { service: 'pollev', source: 'https://pollev.com/teachername123' },
  { service: 'wolframcloud', source: 'https://www.wolframcloud.com/obj/demonstrations/CellularAutomaton-source.nb' },
  { service: 'sketchfab', source: 'https://sketchfab.com/3d-models/vintage-camera-cf2da81e2cd44e87b9e69eb9d6e6cab6' },
  { service: 'openstreetmap', source: 'https://www.openstreetmap.org/#map=13/51.5000/-0.1100' },
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

test.describe('Embed services (data-viz) — visual regression', () => {
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

  for (const { service, source } of DATA_VIZ_SERVICES) {
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

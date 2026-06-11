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
  { service: 'datawrapper', source: 'https://datawrapper.dwcdn.net/t4fiQ/3/' },
  { service: 'flourish', source: 'https://public.flourish.studio/visualisation/63832/' },
  { service: 'ourworldindata', source: 'https://ourworldindata.org/grapher/life-expectancy?tab=chart&country=~USA' },
  { service: 'geogebra', source: 'https://www.geogebra.org/m/UjjwuM8p' },
  { service: 'scratch', source: 'https://scratch.mit.edu/projects/1090231983/' },
  { service: 'kahoot', source: 'https://create.kahoot.it/details/science-trivia/adda1047-572f-40d1-8217-ae06019dafac' },
  { service: 'genially', source: 'https://view.genially.com/65da9accbbb01e0014a797ae/interactive-content-basic-interactive-presentation' },
  { service: 'infogram', source: 'https://infogram.com/state-of-gaming-2018-1h0r6rgog7zw2ek' },
  { service: 'arcgisstorymaps', source: 'https://storymaps.arcgis.com/stories/cea22a609a1d4cccb8d54c650b595bc4' },
  { service: 'felt', source: 'https://felt.com/map/Current-Fires-National-Interagency-Fire-Center-Qh5RZ9AwpRXeQS9BDJiPa7nD' },
  { service: 'p5js', source: 'https://editor.p5js.org/allison.parrish/sketches/_OVObj6oE' },
  { service: 'wakelet', source: 'https://wakelet.com/wake/LgK6vvQ9SLuUnY_L2Ft-u' },
  { service: 'pollev', source: 'https://pollev.com/polleverywhere' },
  { service: 'wolframcloud', source: 'https://www.wolframcloud.com/obj/blog-posts/Published/TheNewWorldOfNotebookPublishing.nb' },
  { service: 'sketchfab', source: 'https://sketchfab.com/3d-models/astronaut-glb-4d1f078f5461493ba066cf35278ae9e6' },
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

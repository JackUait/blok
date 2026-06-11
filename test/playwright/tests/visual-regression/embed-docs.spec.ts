import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { EMBED_SERVICES, matchEmbedService, type EmbedMatch } from '../../../../src/tools/link/registry';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression coverage for the docs & productivity embed services.
 *
 * One screenshot per service. All non-localhost network is stubbed with a
 * deterministic gray page, so each snapshot captures the embed block chrome
 * plus the per-service iframe aspect ratio without depending on third-party
 * providers.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';

const SCREENSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.001,
  animations: 'disabled' as const,
  caret: 'hide' as const,
};

/**
 * One canonical source URL per service — the same REAL public documents the
 * EmbedDocs stories use (network is stubbed here, but keeping the tables
 * identical means one set of known-good samples).
 */
const SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'figma', source: 'https://www.figma.com/design/nrPSsILSYjesyc5UHjYYa4/Embed-Kit-2.0-examples' },
  { service: 'googledrive', source: 'https://drive.google.com/file/d/1FvQYrw5zS1oFEucQFY8p7nRKi7A5ImaO/view?usp=sharing' },
  { service: 'googledrivefolder', source: 'https://drive.google.com/drive/folders/1YDr3IpvVvx4UCyrRTTXs0EgH-a2zl2oo' },
  { service: 'googledocspublished', source: 'https://docs.google.com/document/d/e/2PACX-1vR_M_Xekjo_wnoITwiz2Bj0ARq4nR4OO1Isb3sBH2-mnAJIm8FXw9no9ed4R-_Nk6d4PcyHNMLgGIc3/pub' },
  { service: 'googledocs', source: 'https://docs.google.com/document/d/195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE/edit' },
  { service: 'googlesheets', source: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0' },
  { service: 'googleslides', source: 'https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit' },
  { service: 'googleforms', source: 'https://docs.google.com/forms/d/e/1FAIpQLSd0iBLPh4suZoGW938EU1WIxzObQv_jXto0nT2U8HH2KsI5dg/viewform' },
  { service: 'drawio', source: 'https://app.diagrams.net/?lightbox=1&highlight=0000ff&edit=_blank&layers=1&nav=1#Uhttps%3A%2F%2Fraw.githubusercontent.com%2Fjgraph%2Fdrawio-diagrams%2Fdev%2Fexamples%2Faws-simple-architecture.drawio' },
];

/**
 * Resolves a source URL through the registry, failing loudly when it does not
 * match. Keeps conditionals out of the test bodies.
 */
const resolveMatch = (source: string): EmbedMatch => {
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`Sample URL did not match any embed service: ${source}`);
  }

  return match;
};

test.describe('Embed services (docs) — visual regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    // Stub all external network so the iframe shows a deterministic gray page.
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#e8e8e8">'
        + '<div data-blok-testid="embed-stub-page" style="width:100%;height:100vh"></div>'
        + '</body></html>',
    }));
    await page.goto(TEST_PAGE_URL);
  });

  for (const { service, source } of SERVICES) {
    test(service, async ({ page }) => {
      const match = resolveMatch(source);

      expect(match.service).toBe(service);

      const config = EMBED_SERVICES[match.service];

      // Exactly what Embed.onPaste builds for this URL.
      const blockData = {
        service: match.service,
        source,
        embed: match.embedUrl,
        kind: match.kind,
        width: config.width ?? 580,
        height: config.height ?? 320,
      };

      await page.waitForFunction(() => typeof window.Blok === 'function');

      await page.evaluate(
        async ({ holder, data }) => {
          const container = document.createElement('div');

          container.id = holder;
          document.body.appendChild(container);

          const blok = new window.Blok({ holder, data: { blocks: [{ type: 'embed', data }] } });

          window.blokInstance = blok;
          await blok.isReady;
        },
        { holder: HOLDER_ID, data: blockData }
      );

      const embedBlock = page.locator('[data-blok-tool="embed"]');

      await expect(embedBlock).toBeVisible();

      // The iframe is lazy-loaded: bring it into view and wait for the stubbed
      // document to render before taking the screenshot.
      await embedBlock.scrollIntoViewIfNeeded();
      await expect(
        page.frameLocator('[data-blok-testid="embed-frame"]').locator('[data-blok-testid="embed-stub-page"]')
      ).toBeVisible();

      await expect(embedBlock).toHaveScreenshot(`embed-${service}.png`, SCREENSHOT_OPTIONS);
    });
  }
});

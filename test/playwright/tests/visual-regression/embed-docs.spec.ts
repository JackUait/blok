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
 * One canonical source URL per service, mined from the positive samples in
 * test/unit/tools/link/registry.test.ts.
 */
const SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'figma', source: 'https://www.figma.com/design/KEY123/My-File' },
  { service: 'googledrive', source: 'https://drive.google.com/file/d/FILEID/view?usp=sharing' },
  { service: 'googledrivefolder', source: 'https://drive.google.com/drive/folders/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv?usp=sharing' },
  { service: 'googledocspublished', source: 'https://docs.google.com/document/d/e/2PACX-1vQpBF5Z9a02DALDxXD652Vic622H/pub' },
  { service: 'googledocs', source: 'https://docs.google.com/document/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit?usp=sharing' },
  { service: 'googlesheets', source: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0' },
  { service: 'googleslides', source: 'https://docs.google.com/presentation/d/1A2b3C4d5E6f7G8h9I0jKLMNOPqrstuv/edit?usp=sharing' },
  { service: 'googleforms', source: 'https://docs.google.com/forms/d/e/1FAIpQLSdummyFormId123/viewform?usp=sf_link' },
  { service: 'drawio', source: 'https://app.diagrams.net/?lightbox=1&highlight=0000ff&edit=_blank&layers=1&nav=1#Uhttps%3A%2F%2Fraw.githubusercontent.com%2Fjgraph%2Fdrawio%2Fmaster%2FTEMPLATE.drawio' },
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

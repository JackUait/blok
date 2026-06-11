import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { EMBED_SERVICES, matchEmbedService } from '../../../../src/tools/link/registry';
import type { EmbedKind, EmbedMatch } from '../../../../src/tools/link/registry';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression for the "Dev & interactive tools" embed service group.
 *
 * One screenshot per service: the block is created from the exact data
 * Embed.onPaste would build for a canonical sample URL (mined from the
 * registry unit tests), so each snapshot freezes the block chrome and the
 * per-service aspect ratio.
 *
 * Determinism: every non-localhost request is stubbed with an empty gray
 * page, so the provider iframe renders as a flat placeholder instead of
 * live (and ever-changing) remote content.
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

interface EmbedBlockData {
  service: string;
  source: string;
  embed: string;
  kind: EmbedKind;
  width: number;
  height: number;
}

/**
 * Canonical sample source URL per service, mined from
 * test/unit/tools/link/registry.test.ts (real-shaped URLs proven to match).
 */
/**
 * Resolves a source URL through the registry, throwing when it does not match.
 * Lives outside the tests so they stay free of conditionals.
 */
const requireEmbedMatch = (source: string): EmbedMatch => {
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`matchEmbedService returned null for ${source}`);
  }

  return match;
};

const SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'codepen', source: 'https://codepen.io/team/codepen/pen/EVdVpQ' },
  { service: 'codesandbox', source: 'https://codesandbox.io/s/vanilla' },
  { service: 'stackblitz', source: 'https://stackblitz.com/edit/react-ts' },
  { service: 'typeform', source: 'https://form.typeform.com/to/LQcTJr' },
  { service: 'airtable', source: 'https://airtable.com/shr5EBHUmHzStubDx' },
  { service: 'miro', source: 'https://miro.com/app/board/uXjVOUbVyFY=/' },
  { service: 'desmos', source: 'https://www.desmos.com/calculator/qy6jc8mfi9' },
  { service: 'observable', source: 'https://observablehq.com/@mbostock/embedded-notebook' },
  { service: 'jsfiddle', source: 'https://jsfiddle.net/josewirewax/2rqnsdd6/' },
];

test.describe('Embed services (dev) — visual regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    // Stub all external network so the iframe shows a deterministic gray
    // placeholder. The data-stub element exists to be waited on through the
    // frame before screenshotting.
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#e8e8e8">'
        + '<div data-stub="embed-placeholder" style="position:fixed;inset:0"></div>'
        + '</body></html>',
    }));

    await page.goto(TEST_PAGE_URL);
  });

  for (const { service, source } of SERVICES) {
    test(service, async ({ page }) => {
      const match = requireEmbedMatch(source);

      expect(match.service).toBe(service);

      // Exactly what Embed.onPaste builds for this source URL.
      const blockData: EmbedBlockData = {
        service: match.service,
        source,
        embed: match.embedUrl,
        kind: match.kind,
        width: EMBED_SERVICES[match.service].width ?? DEFAULT_WIDTH,
        height: EMBED_SERVICES[match.service].height ?? DEFAULT_HEIGHT,
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

          const blok = new window.Blok({ holder, data: { blocks: [{ type: 'embed', data }] } });

          window.blokInstance = blok;
          await blok.isReady;
        },
        { holder: HOLDER_ID, data: blockData }
      );

      const embedBlock = page.locator('[data-blok-tool="embed"]');

      await expect(embedBlock).toBeVisible();

      // The iframe is loading="lazy": bring it into view and wait for the
      // stubbed document to render before taking the screenshot.
      await embedBlock.scrollIntoViewIfNeeded();
      await expect(
        page.frameLocator('[data-blok-testid="embed-frame"]').locator('[data-stub="embed-placeholder"]')
      ).toBeVisible();

      await expect(embedBlock).toHaveScreenshot(`embed-${service}.png`, SCREENSHOT_OPTIONS);
    });
  }
});

import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { EMBED_SERVICES, matchEmbedService } from '../../../../src/tools/link/registry';
import type { EmbedKind } from '../../../../src/tools/link/registry';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression baselines for regional video & TV embed services.
 *
 * One screenshot per service in the "Regional video & TV" group of the embed
 * registry. Each test builds the exact block data Embed.onPaste would produce
 * for a canonical sample URL (mirrored from test/unit/tools/link/registry.test.ts),
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

/**
 * Builds the embed block data for a service exactly as Embed.onPaste would.
 * Throws if the sample URL stopped matching its registry entry, so the
 * conditional narrowing stays out of the test bodies.
 */
const buildEmbedBlockData = (service: string, source: string): EmbedBlockData => {
  const match = matchEmbedService(source);

  if (match === null) {
    throw new Error(`Sample URL for "${service}" no longer matches the embed registry: ${source}`);
  }

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

const REGIONAL_SERVICES: ReadonlyArray<{ service: string; source: string }> = [
  { service: 'bilibili', source: 'https://www.bilibili.com/video/BV1GJ411x7h7/?spm_id_from=333.337' },
  { service: 'niconico', source: 'https://www.nicovideo.jp/watch/sm9' },
  { service: 'youku', source: 'https://v.youku.com/v_show/id_XODU1NzgzMTg0.html' },
  { service: 'navertv', source: 'https://tv.naver.com/v/8565915' },
  { service: 'kakaotv', source: 'https://tv.kakao.com/v/451075687' },
  { service: 'dailymotion', source: 'https://www.dailymotion.com/video/xaduou6' },
  { service: 'okru', source: 'https://ok.ru/video/11338458073644' },
  { service: 'arte', source: 'https://www.arte.tv/en/videos/110989-000-A/steven-spielberg/' },
];

test.describe('Embed services (regional) — visual regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#e8e8e8"><div data-blok-stub="ready" style="width:100%;height:100vh"></div></body></html>',
    }));
    await page.goto(TEST_PAGE_URL);
  });

  for (const { service, source } of REGIONAL_SERVICES) {
    test(service, async ({ page }) => {
      const match = matchEmbedService(source);

      expect(match).not.toBeNull();
      expect(match?.service).toBe(service);

      const blockData = buildEmbedBlockData(service, source);

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
      await expect(page.frameLocator('[data-blok-testid="embed-frame"]').locator('[data-blok-stub="ready"]')).toBeVisible();

      await expect(embedBlock).toHaveScreenshot(`embed-${service}.png`, SCREENSHOT_OPTIONS);
    });
  }
});

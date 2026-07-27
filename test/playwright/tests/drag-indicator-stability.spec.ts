import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { expect, gotoTestPage, test } from './helpers/shared-page';

const SETTINGS_BUTTON_SELECTOR = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';

interface IndicatorLogEntry {
  t: number;
  id: string | null;
  edge: string | null;
}

declare global {
  interface Window {
    __indicatorLog?: IndicatorLogEntry[];
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const FIXTURE: OutputData = {
  blocks: [
    { type: 'header', data: { text: 'Grade description', level: 2 } },
    { type: 'paragraph', data: { text: 'a paragraph with bold, italic and colored text.' } },
    { type: 'list', data: { style: 'unordered', items: [{ content: 'An unordered list item', items: [] }] } },
    { type: 'list', data: { style: 'ordered', items: [{ content: 'An ordered list item', items: [] }] } },
    { type: 'list', data: { style: 'ordered', items: [{ content: 'A second ordered list item', items: [] }] } },
    { type: 'paragraph', data: { text: 'A trailing paragraph' } },
  ],
};

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async (initialData) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById('blok')?.remove();

    const container = document.createElement('div');

    container.id = 'blok';
    document.body.appendChild(container);

    const blok = new window.Blok({ holder: 'blok', data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, FIXTURE);
};

/**
 * Records the indicator state at the end of every animation frame, so the log
 * shows what the USER sees (a paint-time sample), not the intra-task attribute
 * churn that never reaches the screen.
 */
const installIndicatorProbe = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__indicatorLog = [];

    const sample = (): void => {
      const el = document.querySelector('[data-drop-indicator]');
      const log = window.__indicatorLog;

      if (log) {
        log.push({
          t: Math.round(performance.now()),
          id: el?.getAttribute('data-blok-id') ?? null,
          edge: el?.getAttribute('data-drop-indicator') ?? null,
        });
      }
      requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });
};

test.describe('drop indicator stability', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('indicator stays visible while the cursor jiggles inside one drop slot', async ({ page }) => {
    await createBlok(page);

    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Grade description' }).first();

    await source.hover();

    const settings = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settings).toBeVisible();

    const settingsBox = await settings.boundingBox();
    const target = page.getByTestId('block-wrapper').filter({ hasText: 'A second ordered list item' }).first();
    const targetBox = await target.boundingBox();

    if (!settingsBox || !targetBox) {
      throw new Error('missing bounding box');
    }

    await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
    await page.mouse.down();

    // Park on the seam BETWEEN two blocks — exactly where the drop line is
    // painted, so this is the position a user naturally hovers when aiming at
    // that line.
    const x = targetBox.x + 40;
    const y = targetBox.y - 1;

    await page.mouse.move(x, y, { steps: 15 });

    await page.waitForFunction(
      () => document.querySelector('[data-drop-indicator]') !== null,
      { timeout: 2000 }
    );

    await installIndicatorProbe(page);

    // Jiggle by 1px — a hand holding the block still, not aiming somewhere new.
    // Each move waits for the probe to sample several more frames, so the log
    // covers the paints that follow every move.
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(x + (i % 2), y + ((i >> 1) % 2));

      const sampledSoFar = await page.evaluate(() => window.__indicatorLog?.length ?? 0);

      await page.waitForFunction(
        target => (window.__indicatorLog?.length ?? 0) >= target,
        sampledSoFar + 3
      );
    }

    const log = await page.evaluate(() => window.__indicatorLog ?? []);

    await page.mouse.up();

    // Every sampled frame must still show the line on the same block and edge:
    // no frame without an indicator, and no thrash between targets.
    const distinctStates = new Set(log.map(entry => `${entry.id}:${entry.edge}`));

    expect(log.length).toBeGreaterThan(40);
    expect(log.filter(entry => entry.edge === null)).toHaveLength(0);
    expect([...distinctStates]).toHaveLength(1);
  });
});

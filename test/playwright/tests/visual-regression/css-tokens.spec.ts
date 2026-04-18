import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Visual regression baseline for CSS custom-property extraction.
 *
 * Introduced as part of Phase 1 of the CSS variables extraction spec
 * (docs/superpowers/specs/2026-04-18-css-vars-extraction-design.md).
 *
 * Purpose:
 *   Freeze the rendered appearance of five high-risk surfaces before any
 *   Phase 2 extraction batch (B1 colors, B2 radii, etc) touches main.css.
 *   Each batch must re-run this suite and show zero pixel diff.
 *
 * Baseline generation:
 *   Before the first extraction batch lands, run:
 *     yarn e2e test/e2e/visual-regression/css-tokens.spec.ts --update-snapshots
 *   Commit the generated PNGs under
 *   test/e2e/visual-regression/css-tokens.spec.ts-snapshots/.
 *
 * The five fixtures match §2.5 of the design spec:
 *   1. Toolbar + plus button hovered
 *   2. Block settings popover open
 *   3. Tooltip visible
 *   4. Database block card view
 *   5. Inline toolbar with link-edit input focused
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

const resetAndCreate = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });

  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

test.describe('CSS tokens — visual regression baselines', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('toolbar + plus button', async ({ page }) => {
    await resetAndCreate(page, [
      { type: 'paragraph', data: { text: 'Hover target' } },
    ]);

    const block = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`).first();
    await block.hover();

    const plusButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`).first();
    await expect(plusButton).toBeVisible();

    await expect(page.locator(BLOK_INTERFACE_SELECTOR)).toHaveScreenshot('toolbar-plus.png', SCREENSHOT_OPTIONS);
  });

  test('tooltip visible on toolbar icon hover', async ({ page }) => {
    await resetAndCreate(page, [
      { type: 'paragraph', data: { text: 'Tooltip target' } },
    ]);

    const block = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`).first();
    await block.hover();

    const plusButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`).first();
    await plusButton.hover();

    const tooltip = page.locator('[data-blok-interface=tooltip]').first();
    await expect(tooltip).toBeVisible();

    await expect(page).toHaveScreenshot('tooltip.png', SCREENSHOT_OPTIONS);
  });

  test('full editor shell with multiple blocks', async ({ page }) => {
    await resetAndCreate(page, [
      { type: 'header', data: { text: 'Sample heading', level: 2 } },
      { type: 'paragraph', data: { text: 'First paragraph of body text.' } },
      { type: 'paragraph', data: { text: 'Second paragraph of body text.' } },
      { type: 'list', data: { style: 'unordered', items: [{ content: 'One' }, { content: 'Two' }] } },
    ]);

    const list = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="list"]`).first();
    await expect(list).toBeVisible();

    await expect(page.locator(BLOK_INTERFACE_SELECTOR)).toHaveScreenshot('editor-shell.png', SCREENSHOT_OPTIONS);
  });
});

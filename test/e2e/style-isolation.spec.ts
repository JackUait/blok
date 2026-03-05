import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../playwright/tests/helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const POPOVER_SELECTOR = '[data-blok-popover]';

const resetBlok = async (page: Page): Promise<void> => {
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
};

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const createBlokWithConfig = async (
  page: Page,
  blocks: OutputData['blocks'],
  extraConfig: Record<string, unknown>
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks, config }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
        ...config,
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks, config: extraConfig }
  );
};

const openToolbox = async (page: Page): Promise<void> => {
  const firstBlock = page.locator(PARAGRAPH_SELECTOR).first();

  await firstBlock.hover();

  const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

  await expect(plusButton).toBeVisible();
  await plusButton.click();
  await page.waitForSelector(`${POPOVER_SELECTOR}[data-blok-popover-opened]`, { state: 'attached' });
};

/**
 * These tests verify that Blok's UI is isolated from host-page styles.
 *
 * Two isolation behaviors are tested:
 * 1. Ambient host styles do NOT cascade into Blok (isolation works).
 * 2. Explicit targeting of Blok selectors still applies styles (user overrides work).
 */
test.describe('Style isolation', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('host body font-family does not cascade into editor wrapper', async ({ page }) => {
    await page.addStyleTag({
      content: `body { font-family: 'Times New Roman', serif !important; }`,
    });

    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);

    const editorFontFamily = await page.locator(BLOK_INTERFACE_SELECTOR).evaluate(
      (el) => window.getComputedStyle(el).fontFamily
    );

    expect(editorFontFamily).not.toContain('Times New Roman');
  });

  test('host wildcard color does not cascade into editor wrapper', async ({ page }) => {
    await page.addStyleTag({
      content: `* { color: rgb(255, 0, 0) !important; }`,
    });

    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);

    const editorColor = await page.locator(BLOK_INTERFACE_SELECTOR).evaluate(
      (el) => window.getComputedStyle(el).color
    );

    expect(editorColor).not.toBe('rgb(255, 0, 0)');
  });

  test('host body font-family does not cascade into popover', async ({ page }) => {
    await page.addStyleTag({
      content: `body { font-family: 'Times New Roman', serif !important; }`,
    });

    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    await openToolbox(page);

    const popoverFontFamily = await page.locator(POPOVER_SELECTOR).first().evaluate(
      (el) => window.getComputedStyle(el).fontFamily
    );

    expect(popoverFontFamily).not.toContain('Times New Roman');
  });

  test('host wildcard color does not cascade into popover', async ({ page }) => {
    await page.addStyleTag({
      content: `* { color: rgb(255, 0, 0) !important; }`,
    });

    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);
    await openToolbox(page);

    const popoverColor = await page.locator(POPOVER_SELECTOR).first().evaluate(
      (el) => window.getComputedStyle(el).color
    );

    expect(popoverColor).not.toBe('rgb(255, 0, 0)');
  });

  test('explicit targeting of [data-blok-interface] still applies styles', async ({ page }) => {
    // User explicitly targets Blok's wrapper — this SHOULD work
    await page.addStyleTag({
      content: `${BLOK_INTERFACE_SELECTOR} { color: rgb(0, 128, 0) !important; }`,
    });

    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);

    const editorColor = await page.locator(BLOK_INTERFACE_SELECTOR).evaluate(
      (el) => window.getComputedStyle(el).color
    );

    expect(editorColor).toBe('rgb(0, 128, 0)');
  });

  test('config.style.fontFamily applies to editor wrapper', async ({ page }) => {
    await createBlokWithConfig(
      page,
      [{ type: 'paragraph', data: { text: 'Hello world' } }],
      { style: { fontFamily: '"Courier New", monospace' } }
    );

    const fontFamily = await page.locator(BLOK_INTERFACE_SELECTOR).evaluate(
      (el) => window.getComputedStyle(el).fontFamily
    );

    expect(fontFamily).toContain('Courier New');
  });

  test('config.style.fontFamily applies to body-level popover', async ({ page }) => {
    await createBlokWithConfig(
      page,
      [{ type: 'paragraph', data: { text: 'Hello world' } }],
      { style: { fontFamily: '"Courier New", monospace' } }
    );
    await openToolbox(page);

    const fontFamily = await page.locator(POPOVER_SELECTOR).first().evaluate(
      (el) => window.getComputedStyle(el).fontFamily
    );

    expect(fontFamily).toContain('Courier New');
  });
});

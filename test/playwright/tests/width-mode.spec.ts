import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, BlokConfig } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';

const HOLDER_ID = 'blok-width-test';

declare global {
  interface Window {
    blokWidthInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async (holder) => {
    if (window.blokWidthInstance) {
      await window.blokWidthInstance.destroy?.();
      window.blokWidthInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, HOLDER_ID);
};

const createBlok = async (
  page: Page,
  config: Partial<BlokConfig> = {}
): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(
    async ({ holder, blokConfig }) => {
      const blok = new window.Blok({ holder, ...blokConfig } as BlokConfig);

      window.blokWidthInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokConfig: config as Record<string, unknown> }
  );
};

test.describe('Editor width mode', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('should apply 650px CSS variable by default (narrow mode)', async ({ page }) => {
    await createBlok(page);
    const wrapper = page.locator(BLOK_INTERFACE_SELECTOR);
    const cssVar = await wrapper.evaluate((el: HTMLElement) =>
      el.style.getPropertyValue('--blok-content-width').trim()
    );

    expect(cssVar).toBe('650px');
  });

  test('should apply custom narrowWidth CSS variable', async ({ page }) => {
    await createBlok(page, { narrowWidth: '800px' });
    const wrapper = page.locator(BLOK_INTERFACE_SELECTOR);
    const cssVar = await wrapper.evaluate((el: HTMLElement) =>
      el.style.getPropertyValue('--blok-content-width').trim()
    );

    expect(cssVar).toBe('800px');
  });

  test('should apply none CSS variable when defaultWidth is full', async ({ page }) => {
    await createBlok(page, { defaultWidth: 'full' });
    const wrapper = page.locator(BLOK_INTERFACE_SELECTOR);
    const cssVar = await wrapper.evaluate((el: HTMLElement) =>
      el.style.getPropertyValue('--blok-content-width').trim()
    );

    expect(cssVar).toBe('none');
  });

  test('editor.width.toggle() should switch from narrow to full', async ({ page }) => {
    await createBlok(page, { narrowWidth: '700px' });
    await page.evaluate(() => {
      window.blokWidthInstance?.width.toggle();
    });
    const wrapper = page.locator(BLOK_INTERFACE_SELECTOR);
    const cssVar = await wrapper.evaluate((el: HTMLElement) =>
      el.style.getPropertyValue('--blok-content-width').trim()
    );

    expect(cssVar).toBe('none');
  });

  test('editor.width.get() should return current mode', async ({ page }) => {
    await createBlok(page, { defaultWidth: 'full' });
    const mode = await page.evaluate(() => window.blokWidthInstance?.width.get());

    expect(mode).toBe('full');
  });
});

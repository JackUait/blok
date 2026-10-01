import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

type Box = { left: number; right: number; top: number; bottom: number };

interface Options {
  direction?: 'ltr' | 'rtl';
  toolbarPosition?: 'left' | 'right';
  data?: OutputData;
}

const DATA: OutputData = {
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: 'نص الفقرة الأولى' } },
    { id: 'p2', type: 'paragraph', data: { text: 'نص الفقرة الثانية' } },
  ],
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  // Wide enough that a 280px menu fits beside the controls on either side.
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoTestPage(page);
});

const createBlok = async (page: Page, options: Options = {}): Promise<void> => {
  await page.evaluate(async ({ holder, direction, toolbarPosition, data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    // Narrow and centred so both gutters have room for the controls and their menu.
    container.style.width = '720px';
    container.style.margin = '0 auto';
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data,
      ...(direction ? { i18n: { direction } } : {}),
      ...(toolbarPosition ? { toolbarPosition } : {}),
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, direction: options.direction, toolbarPosition: options.toolbarPosition, data: options.data ?? DATA });
};

const box = async (page: Page, selector: string): Promise<Box> => {
  const rect = await page.locator(selector).first().boundingBox();

  if (rect === null) {
    throw new Error(`No layout box for ${selector}`);
  }

  return { left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height };
};

const hoverFirstBlock = async (page: Page): Promise<void> => {
  await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`).first().hover();
  await expect(page.locator('[data-blok-toolbar-actions]')).toBeVisible();
};

const CONTENT = `${BLOK_INTERFACE_SELECTOR} [data-blok-element-content]`;

test.describe('block toolbar in RTL', () => {
  test('default position: controls sit in the right (inline-start) gutter without covering text', async ({ page }) => {
    await createBlok(page, { direction: 'rtl' });
    await expect(page.locator(BLOK_INTERFACE_SELECTOR)).toHaveAttribute('data-blok-rtl', 'true');
    await hoverFirstBlock(page);

    const content = await box(page, CONTENT);
    const actions = await box(page, '[data-blok-toolbar-actions]');
    const plus = await box(page, '[data-blok-testid="plus-button"]');
    const drag = await box(page, '[data-blok-testid="settings-toggler"]');

    expect(actions.left).toBeGreaterThanOrEqual(content.right - 1);
    // Mirrored order: the drag handle is next to the text, + is outermost.
    expect(drag.left).toBeLessThan(plus.left);
    expect(plus.right).toBeLessThanOrEqual(page.viewportSize()?.width ?? Infinity);
  });

  test('toolbarPosition right: controls sit in the left (inline-end) gutter without covering text', async ({ page }) => {
    await createBlok(page, { direction: 'rtl', toolbarPosition: 'right' });
    await expect(page.locator(BLOK_INTERFACE_SELECTOR)).toHaveAttribute('data-blok-rtl', 'true');
    await hoverFirstBlock(page);

    const content = await box(page, CONTENT);
    const actions = await box(page, '[data-blok-toolbar-actions]');

    expect(actions.right).toBeLessThanOrEqual(content.left + 1);
    expect(actions.left).toBeGreaterThanOrEqual(0);
  });

  test('default position: block settings menu opens away from the text', async ({ page }) => {
    await createBlok(page, { direction: 'rtl' });
    await hoverFirstBlock(page);
    await page.getByTestId('settings-toggler').click();

    const content = await box(page, CONTENT);
    const toggler = await box(page, '[data-blok-testid="settings-toggler"]');
    const menu = await box(page, POPOVER_CONTAINER_SELECTOR);

    expect(menu.left).toBeGreaterThanOrEqual(toggler.left - 1);
    expect(menu.left).toBeGreaterThanOrEqual(content.right - 1);
  });

  test('toolbarPosition right: block settings menu opens away from the text', async ({ page }) => {
    await createBlok(page, { direction: 'rtl', toolbarPosition: 'right' });
    await hoverFirstBlock(page);
    await page.getByTestId('settings-toggler').click();

    const content = await box(page, CONTENT);
    const menu = await box(page, POPOVER_CONTAINER_SELECTOR);

    expect(menu.right).toBeLessThanOrEqual(content.left + 1);
  });
});

test.describe('block toolbar in LTR stays put', () => {
  test('default position: controls in the left gutter, menu opens leftwards', async ({ page }) => {
    await createBlok(page);
    await hoverFirstBlock(page);

    const content = await box(page, CONTENT);
    const actions = await box(page, '[data-blok-toolbar-actions]');
    const plus = await box(page, '[data-blok-testid="plus-button"]');
    const drag = await box(page, '[data-blok-testid="settings-toggler"]');

    expect(actions.right).toBeLessThanOrEqual(content.left + 1);
    expect(plus.left).toBeLessThan(drag.left);

    await page.getByTestId('settings-toggler').click();

    const menu = await box(page, POPOVER_CONTAINER_SELECTOR);

    expect(menu.right).toBeLessThanOrEqual(content.left + 1);
  });

  test('toolbarPosition right: controls in the right gutter, menu opens rightwards', async ({ page }) => {
    await createBlok(page, { toolbarPosition: 'right' });
    await hoverFirstBlock(page);

    const content = await box(page, CONTENT);
    const actions = await box(page, '[data-blok-toolbar-actions]');

    expect(actions.left).toBeGreaterThanOrEqual(content.right - 1);

    await page.getByTestId('settings-toggler').click();

    const menu = await box(page, POPOVER_CONTAINER_SELECTOR);

    expect(menu.left).toBeGreaterThanOrEqual(content.right - 1);
  });
});

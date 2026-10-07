import type { Page } from '@playwright/test';
import type { Blok } from '../../../../types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    previewHiddenFrames?: number;
  }
}

const createBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data: { blocks: [ { type: 'paragraph', data: { text: '' } } ] },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const openToolbox = async (page: Page): Promise<void> => {
  const paragraph = page.locator(PARAGRAPH_SELECTOR);

  await paragraph.click();
  await paragraph.type('/');
  await expect(page.getByTestId('toolbox-popover').getByTestId('popover-container')).toBeVisible();
};

const option = (page: Page, name: string) => page.getByTestId('toolbox-popover').locator(`[data-blok-item-name="${name}"]`);

const rowCenter = async (page: Page, name: string): Promise<{ x: number; y: number }> => {
  const box = await option(page, name).boundingBox();

  if (box === null) {
    throw new Error(`row ${name} has no box`);
  }

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Counts every frame the card spends hidden from now on. */
const countHiddenFrames = (page: Page): Promise<void> => page.evaluate(() => {
  window.previewHiddenFrames = 0;

  const tick = (): void => {
    const card = document.querySelector<HTMLElement>('[data-blok-testid="toolbox-preview"]');

    if (card === null || card.hidden) {
      window.previewHiddenFrames = (window.previewHiddenFrames ?? 0) + 1;
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
});

const openCardOn = async (page: Page, name: string): Promise<void> => {
  const center = await rowCenter(page, name);

  await page.mouse.move(center.x, center.y, { steps: 3 });
  await expect(page.getByTestId('toolbox-preview')).toBeVisible();
};

test.describe('Toolbox hover preview follows the pointer', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page);
    await page.mouse.move(1, 1);
    await openToolbox(page);
  });

  test('moves to the next row and swaps its drawing without closing', async ({ page }) => {
    await openCardOn(page, 'header-1');
    await countHiddenFrames(page);

    const next = await rowCenter(page, 'header-2');

    await page.mouse.move(next.x, next.y, { steps: 6 });

    // Content first: it proves the card already swapped, so the frame count covers the whole move.
    await expect(page.getByTestId('toolbox-preview')).toContainText('Medium section heading');
    expect(await page.evaluate(() => window.previewHiddenFrames)).toBe(0);

    const card = await page.getByTestId('toolbox-preview').boundingBox();
    const row = await option(page, 'header-2').boundingBox();

    expect(card !== null && row !== null && Math.abs(card.y - row.y) < 1).toBe(true);
  });

  test('stays open while the pointer crosses a section label', async ({ page }) => {
    await option(page, 'code').scrollIntoViewIfNeeded();
    await openCardOn(page, 'page');
    await countHiddenFrames(page);

    const next = await rowCenter(page, 'code');

    await page.mouse.move(next.x, next.y, { steps: 8 });

    await expect(page.getByTestId('toolbox-preview')).toContainText('Capture a code snippet');
    expect(await page.evaluate(() => window.previewHiddenFrames)).toBe(0);
  });
});

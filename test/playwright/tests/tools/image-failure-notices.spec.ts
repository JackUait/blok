// test/playwright/tests/tools/image-failure-notices.spec.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
const PHOTO_FIXTURE_PATH = join(process.cwd(), 'test/playwright/fixtures/image/photo.jpg');
const PHOTO = readFileSync(PHOTO_FIXTURE_PATH);

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    BlokImage: unknown;
    __imageFailureChanges?: number;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

/**
 * Boot an editor whose image tool gives up on the first load error, so a dead
 * link fails at once instead of after five reloads.
 */
const createBlok = async (page: Page, data: OutputData, failUploads = false): Promise<void> => {
  await page.evaluate(async ({ holder, initialData, rejectUploads }) => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    window.__imageFailureChanges = 0;
    const blok = new window.Blok({
      holder,
      data: initialData,
      onChange: () => {
        window.__imageFailureChanges = (window.__imageFailureChanges ?? 0) + 1;
      },
      tools: {
        image: {
          class: window.BlokImage,
          config: {
            reloadAttempts: 0,
            ...(rejectUploads
              ? { uploader: { uploadByFile: (): Promise<never> => Promise.reject(new Error('offline')) } }
              : {}),
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data, rejectUploads: failUploads });
};

test.describe('image failure notices', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('a dead image toasts; Show scrolls to it and Retry recovers it', async ({ page }) => {
    const served = { ok: false };

    await page.route('https://media.test/**', (route) => served.ok
      ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: PHOTO })
      : route.fulfill({ status: 404, body: '' }));
    await createBlok(page, { blocks: [
      ...Array.from({ length: 40 }, (_, i) => ({ type: 'paragraph', data: { text: `Paragraph ${i}` } })),
      { id: 'img1', type: 'image', data: { url: 'https://media.test/a.jpg' } },
    ] });

    const toast = page.getByTestId('notification-error');

    await expect(toast).toContainText('Image failed to load');
    await expect(page.locator('[data-blok-id="img1"]')).not.toBeInViewport();

    const changesBefore = await page.evaluate(() => window.__imageFailureChanges);

    await toast.getByRole('button', { name: 'Show' }).click();

    const card = page.locator('[data-blok-id="img1"] [data-blok-spotlight-target]');

    await expect(card).toHaveAttribute('data-blok-spotlight', 'true');
    await expect(card).toBeInViewport({ ratio: 1 });
    await expect(card.locator('[data-blok-spotlight-focus]')).toBeFocused();

    const middle = await page.evaluate(() => {
      const box = document.querySelector('[data-blok-id="img1"] [data-blok-spotlight-target]')?.getBoundingClientRect();

      return box === undefined ? -1 : (box.top + box.height / 2) / window.innerHeight;
    });

    expect(middle).toBeGreaterThan(0.35);
    expect(middle).toBeLessThan(0.65);
    // Pointing at the image is not an edit: no onChange, so no autosave.
    await expect(card).not.toHaveAttribute('data-blok-spotlight');
    expect(await page.evaluate(() => window.__imageFailureChanges)).toBe(changesBefore);

    served.ok = true;
    await toast.getByRole('button', { name: 'Retry' }).click();
    // The failure clears only on the <img> load event, so confirmLeave() going true proves it loaded.
    await expect.poll(() => page.evaluate(() => window.blokInstance?.confirmLeave())).toBe(true);
    await expect(page.locator(IMAGE_BLOCK_SELECTOR)).not.toHaveAttribute('data-state', 'error');
    await expect(toast).toContainText('Image restored');
    await expect(toast).toBeHidden();
  });

  test('a slow retry keeps the failed card in place, then breaks it apart again', async ({ page }) => {
    const retried = { now: false };

    await page.route('https://media.test/**', async (route) => {
      if (retried.now) await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ status: 404, body: '' });
    });
    await createBlok(page, { blocks: [ { id: 'img1', type: 'image', data: { url: 'https://media.test/slow-retry.jpg' } } ] });

    const block = page.locator('[data-blok-id="img1"]');

    await expect(block.locator('[data-role="error-state"]')).toBeVisible();
    const failedHeight = await block.evaluate((el) => el.getBoundingClientRect().height);

    retried.now = true;
    await block.getByRole('button', { name: 'Retry' }).click();

    await expect(block.locator('[data-role="mend-state"]')).toBeVisible();
    expect(await block.evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(failedHeight, 0);

    await expect(block.locator('[data-role="error-state"]')).toHaveAttribute('data-unmended', 'true');
    await expect(block.locator('[data-role="mend-state"]')).toHaveCount(0);
  });

  test('saving with a failed upload shows the save toast', async ({ page }) => {
    await createBlok(page, { blocks: [ { type: 'image', data: {} } ] }, true);
    await page.locator(IMAGE_BLOCK_SELECTOR).getByTestId('file-input').setInputFiles(PHOTO_FIXTURE_PATH);
    await expect(page.getByTestId('notification-error')).toContainText('Image failed to upload');

    await page.evaluate(() => window.blokInstance?.save());

    await expect(page.getByTestId('notification-error')).toContainText("Won't be saved: 1");
  });

  test('confirmLeave shows the banner and each button answers', async ({ page }) => {
    await page.route('https://media.test/**', (route) => route.fulfill({ status: 404, body: '' }));
    await createBlok(page, { blocks: [ { type: 'image', data: { url: 'https://media.test/confirm-leave.jpg' } } ] });
    await expect(page.getByTestId('notification-error')).toBeVisible();

    const banner = page.getByRole('alertdialog', { name: 'Some images have problems' });

    for (const [ name, expected ] of [ [ 'Stay', false ], [ 'Leave anyway', true ] ] as const) {
      const answer = page.evaluate(() => window.blokInstance?.confirmLeave());

      await expect(banner).toContainText("Won't display: 1");
      await banner.getByRole('button', { name }).click();
      expect(await answer).toBe(expected);
      await expect(banner).toBeHidden();
    }
  });
});

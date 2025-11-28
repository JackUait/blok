import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import type { Notifier as NotifierAPI } from '@/types/api/notifier';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type BlokWithNotifier = Blok & { notifier: NotifierAPI };

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const NOTIFIER_CONTAINER_SELECTOR = '[data-blok-testid="notifier-container"]';
const NOTIFICATION_SELECTOR = '[data-blok-testid^="notification"]';

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    const holderElement = document.getElementById(holder);

    holderElement?.remove();

    // Remove leftover notifications between tests to keep DOM deterministic
    document.querySelectorAll('[data-blok-testid="notifier-container"]').forEach((node) => node.remove());

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder: holder,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

test.describe('api.notifier', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(async ({ holder }) => {
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }

      document.querySelectorAll('[data-blok-testid="notifier-container"]').forEach((node) => node.remove());
      document.getElementById(holder)?.remove();
    }, { holder: HOLDER_ID });
  });

  test('should display notification message through the notifier API', async ({ page }) => {
    await createBlok(page);

    const message = 'Blok notifier alert';

    await page.evaluate(({ text }) => {
      const blok = window.blokInstance as BlokWithNotifier | undefined;

      blok?.notifier.show({
        message: text,
        style: 'success',
        time: 1000,
      });
    }, { text: message });

    const notification = page.locator(NOTIFICATION_SELECTOR).filter({ hasText: message });

    await expect(notification).toBeVisible();
    await expect(notification).toHaveAttribute('data-blok-testid', 'notification-success');

    await expect(page.locator(NOTIFIER_CONTAINER_SELECTOR)).toBeVisible();
  });

  test('should render confirm notification with type-specific UI and styles', async ({ page }) => {
    await createBlok(page);

    const message = 'Delete current block?';
    const okText = 'Yes, delete';
    const cancelText = 'No, keep';

    await page.evaluate(({ text, ok, cancel }) => {
      const blok = window.blokInstance as BlokWithNotifier | undefined;

      blok?.notifier.show({
        message: text,
        type: 'confirm',
        style: 'error',
        okText: ok,
        cancelText: cancel,
      });
    }, {
      text: message,
      ok: okText,
      cancel: cancelText,
    });

    const notification = page.locator(NOTIFICATION_SELECTOR).filter({ hasText: message });

    await expect(notification).toBeVisible();
    await expect(notification).toHaveAttribute('data-blok-testid', 'notification-error');
    await expect(notification.locator('[data-blok-testid="notification-confirm-button"]')).toHaveText(okText);
    await expect(notification.locator('[data-blok-testid="notification-cancel-button"]')).toHaveText(cancelText);
  });
});

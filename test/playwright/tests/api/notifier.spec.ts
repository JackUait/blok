import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { Notifier as NotifierAPI } from '@/types/api/notifier';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

declare global {
  interface Window {
    editorInstance?: EditorJS;
  }
}

type EditorWithNotifier = EditorJS & { notifier: NotifierAPI };

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const NOTIFIER_CONTAINER_SELECTOR = '[data-testid="notifier-container"]';
const NOTIFICATION_SELECTOR = '[data-testid^="notification"]';

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    const holder = document.getElementById(holderId);

    holder?.remove();

    // Remove leftover notifications between tests to keep DOM deterministic
    document.querySelectorAll('.cdx-notifies').forEach((node) => node.remove());

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.testid = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditor = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(async ({ holderId }) => {
    const editor = new window.EditorJS({
      holder: holderId,
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

test.describe('api.notifier', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(async ({ holderId }) => {
      if (window.editorInstance) {
        await window.editorInstance.destroy?.();
        window.editorInstance = undefined;
      }

      document.querySelectorAll('.cdx-notifies').forEach((node) => node.remove());
      document.getElementById(holderId)?.remove();
    }, { holderId: HOLDER_ID });
  });

  test('should display notification message through the notifier API', async ({ page }) => {
    await createEditor(page);

    const message = 'Editor notifier alert';

    await page.evaluate(({ text }) => {
      const editor = window.editorInstance as EditorWithNotifier | undefined;

      editor?.notifier.show({
        message: text,
        style: 'success',
        time: 1000,
      });
    }, { text: message });

    const notification = page.locator(NOTIFICATION_SELECTOR).filter({ hasText: message });

    await expect(notification).toBeVisible();
    await expect(notification).toHaveAttribute('data-testid', 'notification-success');

    await expect(page.locator(NOTIFIER_CONTAINER_SELECTOR)).toBeVisible();
  });

  test('should render confirm notification with type-specific UI and styles', async ({ page }) => {
    await createEditor(page);

    const message = 'Delete current block?';
    const okText = 'Yes, delete';
    const cancelText = 'No, keep';

    await page.evaluate(({ text, ok, cancel }) => {
      const editor = window.editorInstance as EditorWithNotifier | undefined;

      editor?.notifier.show({
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
    await expect(notification).toHaveAttribute('data-testid', 'notification-error');
    await expect(notification.locator('[data-testid="notification-confirm-button"]')).toHaveText(okText);
    await expect(notification.locator('[data-testid="notification-cancel-button"]')).toHaveText(cancelText);
  });
});

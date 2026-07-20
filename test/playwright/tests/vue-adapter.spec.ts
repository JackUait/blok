import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';

const VUE_TEST_URL = 'http://localhost:4444/test/playwright/fixtures/vue-test.html';

const placeCaretAtEnd = async (editable: Locator): Promise<void> => {
  await editable.focus();
  await editable.evaluate((element) => {
    const range = element.ownerDocument.createRange();

    range.selectNodeContents(element);
    range.collapse(false);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  });
};

test.describe('Vue adapter', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('renders a functional editor and supports save', async ({ page }) => {
    await page.goto(VUE_TEST_URL);

    await expect(page.getByTestId('status')).toHaveText('ready');

    const editorContainer = page.getByTestId('editor-container');

    await expect(editorContainer).toBeVisible();
    await expect(editorContainer.locator('[data-blok-editor]')).toBeVisible();

    const paragraph = editorContainer.locator('[contenteditable="true"]').filter({ hasText: 'Hello from Vue' });

    await expect(paragraph).toBeVisible();
    await expect(paragraph).toContainText('Hello from Vue');

    await placeCaretAtEnd(paragraph);
    await page.keyboard.type(' - E2E test');

    await page.getByTestId('save').click();
    await expect(page.getByTestId('output')).toContainText('Hello from Vue - E2E test');
  });

  test('toggles readOnly without remount', async ({ page }) => {
    await page.goto(VUE_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const editorContainer = page.getByTestId('editor-container');
    const paragraph = editorContainer.locator('[contenteditable]').filter({ hasText: 'Hello from Vue' });

    await expect(paragraph).toHaveAttribute('contenteditable', 'true');

    await page.getByTestId('toggle-readonly').click();

    await expect(paragraph).toHaveAttribute('contenteditable', 'false');
  });

  test('survives theme + width toggles without losing content (no remount)', async ({ page }) => {
    await page.goto(VUE_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const editorContainer = page.getByTestId('editor-container');
    const paragraph = editorContainer.locator('[contenteditable="true"]').filter({ hasText: 'Hello from Vue' });

    await placeCaretAtEnd(paragraph);
    await page.keyboard.type(' - kept');

    await page.getByTestId('toggle-theme').click();
    await page.getByTestId('toggle-width').click();

    await expect(editorContainer.locator('[contenteditable]')).toContainText('Hello from Vue - kept');

    // Save round-trips the edited content through v-model:data + the ref facade.
    await page.getByTestId('save').click();
    await expect(page.getByTestId('output')).toContainText('Hello from Vue - kept');
  });

  test('forwards id and data-* attributes to the editor container', async ({ page }) => {
    await page.goto(VUE_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const container = page.getByTestId('editor-container');

    await expect(container).toHaveAttribute('id', 'editor-container');
    await expect(container.locator('[data-blok-editor]')).toBeVisible();
  });
});

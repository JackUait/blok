import { test, expect } from '@playwright/test';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';

const REACT_TEST_URL = 'http://localhost:4444/test/playwright/fixtures/react-test.html';

test.describe('React adapter', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('should render a functional editor and support save', async ({ page }) => {
    await page.goto(REACT_TEST_URL);

    // Wait for editor to be ready
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Editor should be visible
    const editorContainer = page.getByTestId('editor-container');

    await expect(editorContainer).toBeVisible();

    // The Blok editor wrapper should exist inside the container
    await expect(editorContainer.locator('[data-blok-editor]')).toBeVisible();

    // There should be an editable paragraph with initial content
    const paragraph = editorContainer.locator('[contenteditable="true"]').filter({ hasText: 'Hello from React' });

    await expect(paragraph).toBeVisible();
    await expect(paragraph).toContainText('Hello from React');

    // Type additional text
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' - E2E test');

    // Save and check output
    await page.getByTestId('save').click();
    await expect(page.getByTestId('output')).toContainText('Hello from React - E2E test');
  });

  test('should toggle readOnly', async ({ page }) => {
    await page.goto(REACT_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Editor should initially be editable
    const editorContainer = page.getByTestId('editor-container');
    const paragraph = editorContainer.locator('[contenteditable]').filter({ hasText: 'Hello from React' });

    await expect(paragraph).toHaveAttribute('contenteditable', 'true');

    // Toggle readOnly
    await page.getByTestId('toggle-readonly').click();

    // Editor should become non-editable
    await expect(paragraph).toHaveAttribute('contenteditable', 'false');
  });
});

test.describe('BlokEditor component', () => {
  const URL = 'http://localhost:4444/test/playwright/fixtures/blok-editor.html';

  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('saves via ref and survives theme/width/readOnly toggles', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const host = page.getByTestId('editor-host');
    const paragraph = host.locator('[contenteditable="true"]').filter({ hasText: 'Hello from BlokEditor' });
    await expect(paragraph).toBeVisible();

    // Type, then toggle theme + width — content must survive (no remount)
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' - kept');
    await page.getByTestId('toggle-theme').click();
    await page.getByTestId('toggle-width').click();
    await expect(host.locator('[contenteditable]')).toContainText('Hello from BlokEditor - kept');

    // Save via the imperative ref
    await page.getByTestId('save').click();
    await expect(page.getByTestId('output')).toContainText('Hello from BlokEditor - kept');

    // readOnly toggle still works
    await page.getByTestId('toggle-readonly').click();
    await expect(host.locator('[contenteditable]').first()).toHaveAttribute('contenteditable', 'false');
  });

  test('forwards id (and other div props) to the editor container element', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Both id and data-blok-testid passed to <BlokEditor> land on the same container,
    // which holds the editor DOM — proving arbitrary div props are forwarded.
    const container = page.getByTestId('editor-container');
    await expect(container).toHaveAttribute('id', 'editor-entry-point');
    await expect(container.locator('[data-blok-editor]')).toBeVisible();
  });

  test('placeholder is reactive end-to-end (real cross-module chain, no remount)', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const host = page.getByTestId('editor-host');
    const paragraph = host.locator('[contenteditable="true"]').filter({ hasText: 'Hello from BlokEditor' });
    await expect(paragraph).toBeVisible();

    // The editor-level placeholder is applied to the default paragraph block.
    await expect(paragraph).toHaveAttribute('data-blok-placeholder-active', 'First placeholder');

    // Changing the placeholder prop updates the live DOM attribute through the full
    // chain (editor.placeholder.set → BlockManager → Block → Paragraph) without remount.
    await page.getByTestId('toggle-placeholder').click();
    await expect(paragraph).toHaveAttribute('data-blok-placeholder-active', 'Second placeholder');

    // Content survived (no recreation), proving an in-place update.
    await expect(paragraph).toContainText('Hello from BlokEditor');
  });
});

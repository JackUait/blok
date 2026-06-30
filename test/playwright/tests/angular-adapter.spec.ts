import { test, expect } from '@playwright/test';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';

const ANGULAR_TEST_URL = 'http://localhost:4444/test/playwright/fixtures/angular-test.html';

test.describe('Angular adapter', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('bootstraps a real Angular app driving the live editor', async ({ page }) => {
    await page.goto(ANGULAR_TEST_URL);

    // The standalone app reports ready from the adapter's (ready) output, which
    // only fires after the partial-Ivy FESM is JIT-linked and Blok core boots.
    await expect(page.getByTestId('status')).toHaveText('ready');

    const host = page.getByTestId('editor-host');
    await expect(host).toBeVisible();
    // The Blok editor wrapper is mounted inside the component's host element.
    await expect(host.locator('[data-blok-editor]')).toBeVisible();

    // Initial [data] seeded an editable paragraph with the seeded content.
    const paragraph = host
      .locator('[contenteditable="true"]')
      .filter({ hasText: 'Hello from Angular' });
    await expect(paragraph).toBeVisible();
  });

  test('serializes edits through the reactive (dataChange) chain', async ({ page }) => {
    await page.goto(ANGULAR_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const host = page.getByTestId('editor-host');
    const paragraph = host
      .locator('[contenteditable="true"]')
      .filter({ hasText: 'Hello from Angular' });
    await expect(paragraph).toBeVisible();

    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' - edited');

    // (dataChange) emits the serialized OutputData on every change batch — the
    // full real-core onSave → adapter → Angular change-detection path.
    await expect(page.getByTestId('output')).toContainText('Hello from Angular - edited');
  });

  test('reactive [readOnly] toggles editability in place', async ({ page }) => {
    await page.goto(ANGULAR_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    const host = page.getByTestId('editor-host');
    const paragraph = host.locator('[contenteditable]').filter({ hasText: 'Hello from Angular' });
    await expect(paragraph).toHaveAttribute('contenteditable', 'true');

    await page.getByTestId('toggle-readonly').click();

    // The [readOnly] input change is synced via the adapter's effect into the
    // live core (no remount), flipping contenteditable.
    await expect(paragraph).toHaveAttribute('contenteditable', 'false');
  });

  test('renders a custom createAngularBlock block with its initial data', async ({ page }) => {
    await page.goto(ANGULAR_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    await expect(page.getByTestId('counter-value')).toHaveText('0');
  });

  test('commit() updates the custom block and serializes through dataChange', async ({ page }) => {
    await page.goto(ANGULAR_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    await page.getByTestId('counter-inc').click();

    await expect(page.getByTestId('counter-value')).toHaveText('1');
    // The serialized output reflects the committed value (real core save path).
    await expect(page.getByTestId('output')).toContainText('"count":1');
  });

  test('read-only toggle hides the custom block button in place', async ({ page }) => {
    await page.goto(ANGULAR_TEST_URL);
    await expect(page.getByTestId('status')).toHaveText('ready');

    await expect(page.getByTestId('counter-inc')).toBeVisible();
    await page.getByTestId('toggle-readonly').click();

    await expect(page.getByTestId('counter-inc')).toBeHidden();
    // Value still present — toggled in place, not remounted/destroyed.
    await expect(page.getByTestId('counter-value')).toBeVisible();
  });
});

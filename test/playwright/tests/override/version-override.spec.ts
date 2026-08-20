import path from 'node:path';

import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';

const EXTENSION_DIR = path.resolve(__dirname, '../../../../override-extension');
const FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-seam.html';
const DNR_FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-dnr.html';
const EXTENSION_DIST_FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-dnr-extension.html';
const CDN_FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-cdn-page.html';

// The bundled headless shell ignores --load-extension; channel 'chromium' is
// the full Chrome-for-Testing build whose new headless supports extensions.
const launch = async (): Promise<{ context: BrowserContext, sw: Worker }> => {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) {
    sw = await context.waitForEvent('serviceworker');
  }
  return { context, sw };
};

test.describe('blok version override', () => {
  test('arming an origin swaps the page blok for the local payload', async () => {
    const { context, sw } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(FIXTURE);
      await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', 'true');

      const editor = page.getByTestId('blok-editor');
      await expect(editor).toHaveAttribute('data-blok-version', /^(?!.*-dev\.).+/);
      const bundledVersion = await editor.getAttribute('data-blok-version');

      await sw.evaluate(async () => {
        await (globalThis as unknown as { armOriginForTests: (o: string) => Promise<void> }).armOriginForTests('http://localhost:4444');
      });
      await page.reload();
      await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', 'true');

      await expect(editor).toHaveAttribute('data-blok-version', /-dev\./);
      await expect(editor).not.toHaveAttribute('data-blok-version', bundledVersion ?? '');

      // Spec open question 3: the payload's CSS must land even though the
      // graph evaluated at document_start (head was null then).
      const editorStyled = await page.getByTestId('blok-editor').evaluate((el) => {
        return getComputedStyle(el).position === 'relative' && getComputedStyle(el).boxSizing === 'border-box';
      });
      expect(editorStyled).toBe(true);

      // The swapped editor is functional, not just present.
      await page.getByTestId('blok-editor').locator('[contenteditable="true"]').first().click();
      await page.keyboard.type('override works');
      await expect(page.getByText('override works')).toBeVisible();

      // The banner reports the active override. The editor's live announcer is
      // also role=status, so pick the banner by its text.
      await expect(page.getByRole('status').filter({ hasText: 'blok override active' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('disarming restores the bundled blok', async () => {
    const { context, sw } = await launch();
    try {
      await sw.evaluate(async () => {
        await (globalThis as unknown as { armOriginForTests: (o: string) => Promise<void> }).armOriginForTests('http://localhost:4444');
      });
      const page = await context.newPage();
      await page.goto(FIXTURE);
      await expect(page.getByTestId('blok-editor')).toHaveAttribute('data-blok-version', /-dev\./);

      await sw.evaluate(async () => {
        await (globalThis as unknown as { disarmOriginForTests: (o: string) => Promise<void> }).disarmOriginForTests('http://localhost:4444');
      });
      await page.reload();
      await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', 'true');
      await expect(page.getByTestId('blok-editor')).toHaveAttribute('data-blok-version', /^(?!.*-dev\.).+/);
    } finally {
      await context.close();
    }
  });

  // The popup only ever arms the origin it has DETECTED blok on. In these
  // tests the popup lives in a background tab (Playwright cannot open a real
  // action popup) while the fixture holds the active-tab slot the detection
  // queries; reload() re-renders the popup without stealing activation.
  test('popup arms the origin it detects blok on', async () => {
    const { context, sw } = await launch();
    try {
      const extensionId = new URL(sw.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

      const page = await context.newPage();
      await page.goto(FIXTURE);
      await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', 'true');

      await popup.reload();
      await expect(popup.getByText(/-dev\./).first()).toBeVisible();
      await expect(popup.getByText('localhost:4444')).toBeVisible();

      const armSwitch = popup.getByRole('switch', { name: 'Arm http://localhost:4444' });
      await expect(armSwitch).toHaveAttribute('aria-checked', 'false');
      await armSwitch.click();
      await expect(popup.getByRole('list', { name: 'Armed origins' })).toContainText('http://localhost:4444');
      await expect(armSwitch).toHaveAttribute('aria-checked', 'true');

      const swapped = await context.newPage();
      await swapped.goto(FIXTURE);
      await expect(swapped.getByTestId('blok-editor')).toHaveAttribute('data-blok-version', /-dev\./);
    } finally {
      await context.close();
    }
  });

  test('popup disables overriding when the page has no blok', async () => {
    const { context, sw } = await launch();
    try {
      const extensionId = new URL(sw.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

      const page = await context.newPage();
      await page.goto(DNR_FIXTURE);

      await popup.reload();
      await expect(popup.getByText('No Blok on this page')).toBeVisible();
      await expect(popup.getByRole('switch')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('popup routes a detected CDN script to the local build in one click', async () => {
    const { context, sw } = await launch();
    try {
      const extensionId = new URL(sw.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

      const page = await context.newPage();
      await page.goto(CDN_FIXTURE);

      await popup.reload();
      await expect(popup.getByText('@bloklabs/core@1.8.0').first()).toBeVisible();
      await popup.getByRole('button', { name: 'Route @bloklabs/core@1.8.0 to the local build' }).click();

      const routes = popup.getByRole('list', { name: 'CDN routes' });
      await expect(routes).toContainText('@bloklabs/core@1.8.0');
      await expect(routes).toContainText('local build');
      await expect(popup.getByRole('button', { name: 'Remove route for @bloklabs/core@1.8.0' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('without a redirect rule, a tier-2 CDN prefix path 404s', async () => {
    const { context } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(DNR_FIXTURE);
      await expect(page.locator('[data-umd-loaded]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('setRedirects makes a tier-2 CDN prefix resolve to the local dist build', async () => {
    const { context, sw } = await launch();
    try {
      await sw.evaluate(async () => {
        await (globalThis as unknown as {
          setRedirectsForTests: (redirects: { from: string, to: string }[]) => Promise<void>,
        }).setRedirectsForTests([{ from: 'http://localhost:4444/fake-cdn/', to: 'http://localhost:4444/dist/' }]);
      });

      const page = await context.newPage();
      await page.goto(DNR_FIXTURE);
      await expect(page.locator('[data-umd-loaded]')).toHaveAttribute('data-umd-loaded', 'true');
    } finally {
      await context.close();
    }
  });

  test('the <local-dist> sentinel serves the extension-staged dist — classic and module scripts', async () => {
    const { context, sw } = await launch();
    try {
      await sw.evaluate(async () => {
        await (globalThis as unknown as {
          setRedirectsForTests: (redirects: { from: string, to: string }[]) => Promise<void>,
        }).setRedirectsForTests([{ from: 'http://localhost:4444/fake-cdn-ext/', to: '<local-dist>' }]);
      });

      const page = await context.newPage();
      await page.goto(EXTENSION_DIST_FIXTURE);
      await expect(page.locator('[data-umd-loaded]')).toHaveAttribute('data-umd-loaded', 'true');
      await expect(page.locator('[data-module-loaded]')).toHaveAttribute('data-module-loaded', 'true');
    } finally {
      await context.close();
    }
  });
});

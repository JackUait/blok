import path from 'node:path';

import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';

const EXTENSION_DIR = path.resolve(__dirname, '../../../../override-extension');
const FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-seam.html';
const DNR_FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-dnr.html';
const EXTENSION_DIST_FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-dnr-extension.html';
const CDN_FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-cdn-page.html';
const PRE_SEAM_FIXTURE = 'http://localhost:4444/test/playwright/fixtures/override-pre-seam.html';

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
    // Two full loads of a multi-MB module graph (the fixture's dist build, then
    // the dev payload) — legitimately heavier than the default budget.
    test.slow();
    const { context, sw } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(FIXTURE);
      await expect(page.locator('[data-fixture-ready]')).toHaveAttribute('data-fixture-ready', 'true');

      const editor = page.getByTestId('blok-editor');
      await expect(editor).toHaveAttribute('data-blok-version', /^(?!.*-dev\.).+/);
      const bundledVersion = await editor.getAttribute('data-blok-version');

      // No page.reload() anywhere in this test: arming reloads the tab itself.
      await sw.evaluate(async () => {
        await (globalThis as unknown as { armOriginForTests: (o: string) => Promise<void> }).armOriginForTests('http://localhost:4444');
      });

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
      await expect(page.getByRole('status').filter({ hasText: 'Blok override is on' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('disarming restores the bundled blok', async () => {
    test.slow();
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
      // Disarming reloads the tab too, so the page falls back on its own.
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
    // Two popup render cycles plus a fresh tab that evaluates the multi-MB
    // dev payload — legitimately heavier than the default budget.
    test.slow();
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
      await expect(popup.getByText('localhost:4444').first()).toBeVisible();

      const armSwitch = popup.getByRole('switch', { name: 'Use your build on http://localhost:4444' });
      await expect(armSwitch).toHaveAttribute('aria-checked', 'false');
      await armSwitch.click();
      await expect(armSwitch).toHaveAttribute('aria-checked', 'true');

      // Flipping the switch is the whole interaction: the extension reloads
      // the page itself and the popup catches up with no button to press.
      await expect(page.getByTestId('blok-editor')).toHaveAttribute('data-blok-version', /-dev\./);
      await expect(popup.getByRole('button', { name: 'Reload' })).toHaveCount(0);
      await expect(popup.getByText('Running your build')).toBeVisible();

      // Origins armed elsewhere are listed; the current page's own row is not
      // repeated below its switch.
      await sw.evaluate(async () => {
        await (globalThis as unknown as { armOriginForTests: (o: string) => Promise<void> }).armOriginForTests('https://elsewhere.example');
      });
      await popup.reload();
      const elsewhere = popup.getByRole('list', { name: 'Also using your build' });
      await expect(elsewhere).toContainText('elsewhere.example');
      await expect(elsewhere).not.toContainText('localhost:4444');

      const swapped = await context.newPage();
      await swapped.goto(FIXTURE);
      await expect(swapped.getByTestId('blok-editor')).toHaveAttribute('data-blok-version', /-dev\./);
    } finally {
      await context.close();
    }
  });

  // The one page the extension must NOT keep reloading: the payload is in the
  // realm and this blok predates the seam, so no reload will ever swap it.
  test('a page whose blok predates the seam is reported, never reloaded in circles', async () => {
    const { context, sw } = await launch();
    try {
      const extensionId = new URL(sw.url()).host;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);

      const page = await context.newPage();
      await page.goto(PRE_SEAM_FIXTURE);

      let loads = 0;

      page.on('load', () => {
        loads += 1;
      });

      await sw.evaluate(async () => {
        await (globalThis as unknown as { armOriginForTests: (o: string) => Promise<void> }).armOriginForTests('http://localhost:4444');
      });
      // Arming reloads once — at that point the payload was not in the realm yet,
      // so a reload was the right call.
      await expect(page.getByRole('status').filter({ hasText: 'too old to swap' })).toBeVisible();
      expect(loads).toBe(1);

      await popup.reload();
      await expect(popup.getByText('This page can’t be switched')).toBeVisible();
      await expect(popup.getByRole('button', { name: 'Reload' })).toHaveCount(0);
      expect(loads).toBe(1);
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
      await expect(popup.getByText('No Blok here')).toBeVisible();
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
      await popup.getByRole('button', { name: 'Use your build for @bloklabs/core@1.8.0' }).click();

      await expect(popup.getByText('Using your build', { exact: true })).toBeVisible();
      await expect(popup.getByRole('button', { name: 'Stop using your build for @bloklabs/core@1.8.0' })).toBeVisible();
      // The routed version lives on the page card alone, not in the elsewhere list.
      await expect(popup.getByRole('list', { name: 'Also using your build' })).toHaveCount(0);
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

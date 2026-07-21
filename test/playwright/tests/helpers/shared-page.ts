import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

import { TEST_PAGE_URL } from './ensure-build';

declare global {
  interface Window {
    __blokInstances?: Array<{ destroy?: () => void | Promise<void> }>;
  }
}

/**
 * Shared-page test fixture.
 *
 * The default Playwright `page` gives every test a fresh browser context, so
 * every test re-fetches, re-parses and re-evaluates the ~2 MB editor module
 * graph from a cold cache — pure setup cost that dwarfs most tests. This
 * fixture keeps ONE page per worker and `gotoTestPage` resets page state
 * between tests instead of reloading the world.
 *
 * Only suitable for specs that (a) navigate exclusively to TEST_PAGE_URL and
 * (b) never touch `context`/`browser` fixtures, popups, downloads or
 * `test.use({ viewport })`. Specs needing real context isolation should keep
 * importing `test` from '@playwright/test'.
 */
const lastSpecFile = new WeakMap<Page, string>();
const needsFreshNavigation = new WeakSet<Page>();

export const test = base.extend<NonNullable<unknown>, { __sharedPage: Page }>({
  __sharedPage: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const page = await context.newPage();

      await use(page);
      await context.close().catch(() => undefined);
    },
    { scope: 'worker' },
  ],
  page: async ({ __sharedPage }, use, testInfo) => {
    // In-place reset is only allowed WITHIN a spec file, where test order is
    // fixed and any state dependency is deterministic. When the worker moves
    // to a different file, gotoTestPage performs a real navigation — a fresh
    // JS realm — so no state can leak across files (which file follows which
    // is work-stealing roulette and would make the suite non-deterministic).
    // The reload is cheap here: the worker-lived context has a warm HTTP
    // cache, unlike the default fixture's brand-new context per test.
    if (lastSpecFile.get(__sharedPage) !== testInfo.file) {
      lastSpecFile.set(__sharedPage, testInfo.file);
      needsFreshNavigation.add(__sharedPage);
    }
    await use(__sharedPage);
  },
});

export { expect } from '@playwright/test';

/**
 * Navigate to the test page — or, when the shared page is already there,
 * reset its state in place: destroy every tracked editor (removing their
 * document-level listeners), drop everything body-mounted, and clear
 * storage/selection/scroll. Falls back to a full navigation if the page is
 * in any unexpected state.
 */
export const gotoTestPage = async (page: Page): Promise<void> => {
  // Input state is PAGE-level and survives between tests on a shared page:
  // a stuck mouse button turns the next test's first move into a drag, a
  // parked pointer synthesizes hovers on freshly-mounted DOM, and a held
  // modifier poisons every later keyboard interaction. Park all of it.
  await page.mouse.up().catch(() => undefined);
  await page.mouse.move(0, 0);
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) {
    await page.keyboard.up(key).catch(() => undefined);
  }

  if (needsFreshNavigation.has(page) || !page.url().startsWith(TEST_PAGE_URL)) {
    needsFreshNavigation.delete(page);
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    return;
  }

  try {
    await page.evaluate(async () => {
      const instances = window.__blokInstances?.splice(0) ?? [];

      for (const instance of instances) {
        try {
          await instance.destroy?.();
        } catch {
          // A test may have destroyed it already; a double destroy is fine.
        }
      }

      // The fixture body is only its bootstrap <script> tags and a heading —
      // everything else (holders, body-mounted popovers/tooltips) is test
      // debris.
      for (const el of Array.from(document.body.children)) {
        if (el.tagName !== 'SCRIPT' && el.tagName !== 'H1') {
          el.remove();
        }
      }

      // Blok injects #blok-styles once per page (and per-instance
      // blok-theme-tokens-* tags). Remove them so the next editor re-injects
      // exactly like on a fresh page — otherwise a previous test's runtime
      // theme tokens would keep restyling later tests.
      document.querySelectorAll('head style[id^="blok"]').forEach((el) => el.remove());

      // Residual hash (scroll-to-block tests) and root data-attribute debris.
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      const attrDebris = [document.documentElement, document.body].flatMap((el) =>
        Array.from(el.attributes)
          .filter((attr) => attr.name.startsWith('data-'))
          .map((attr) => ({ el, name: attr.name }))
      );

      for (const { el, name } of attrDebris) {
        el.removeAttribute(name);
      }

      window.localStorage.clear();
      window.sessionStorage.clear();
      window.getSelection()?.removeAllRanges();
      window.scrollTo(0, 0);
    });
  } catch {
    // Page crashed or a test navigated it somewhere odd — start clean.
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  }
};

import { test as base } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

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
 * fixture keeps ONE page per spec file on each worker and `gotoTestPage`
 * resets page state between tests instead of reloading the world.
 *
 * Only suitable for specs that (a) navigate exclusively to TEST_PAGE_URL and
 * (b) never touch `context`/`browser` fixtures, popups, downloads or
 * `test.use({ viewport })`. Specs needing real context isolation should keep
 * importing `test` from '@playwright/test'.
 */
/** Contexts whose clock a test faked. */
const fakedClock = new WeakSet<BrowserContext>();

const openPage = async (browser: Browser): Promise<Page> => {
  const context = await browser.newContext();
  // page.clock IS context.clock. A fake clock cannot be uninstalled and comes
  // back on every navigation, so a frozen Date.now would reach every later
  // test on this worker (undo steps never close, undo presses get deduped).
  const { clock } = context;
  const mark = <A extends unknown[], R>(method: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      fakedClock.add(context);

      return method.apply(clock, args);
    };

  clock.install = mark(clock.install);
  clock.fastForward = mark(clock.fastForward);
  clock.pauseAt = mark(clock.pauseAt);
  clock.resume = mark(clock.resume);
  clock.runFor = mark(clock.runFor);
  clock.setFixedTime = mark(clock.setFixedTime);
  clock.setSystemTime = mark(clock.setSystemTime);

  return context.newPage();
};

export const test = base.extend<NonNullable<unknown>, { __sharedPage: (specFile: string) => Promise<Page> }>({
  __sharedPage: [
    async ({ browser }, use) => {
      let page = await openPage(browser);
      let pageSpecFile: string | undefined;

      await use(async (specFile) => {
        // In-place reset is only allowed WITHIN a spec file, where test order
        // is fixed. Which file follows which is work-stealing roulette, so a
        // new file gets a new context: nothing a spec set (viewport, media,
        // routes, a faked clock) can leak into the next one.
        //
        // The context must not outlive its file for disk reasons too. With
        // tracing on (CI), Playwright copies the context's whole network log
        // at every test start and end and keeps each copy until the worker
        // exits, so a worker-long context uses disk with the square of its
        // test count.
        //
        // serve.json sends no-store, so a new context costs no extra fetches.
        if (pageSpecFile !== undefined && (pageSpecFile !== specFile || fakedClock.has(page.context()))) {
          await page.context().close().catch(() => undefined);
          page = await openPage(browser);
        }
        pageSpecFile = specFile;

        return page;
      });
      await page.context().close().catch(() => undefined);
    },
    { scope: 'worker' },
  ],
  page: async ({ __sharedPage }, use, testInfo) => {
    const page = await __sharedPage(testInfo.file);

    await use(page);
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

  // A new spec file starts on a new page at about:blank, so it navigates here.
  if (!page.url().startsWith(TEST_PAGE_URL)) {
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

      // Keep only the fixture's heading, not headings added by tests.
      for (const el of Array.from(document.body.children)) {
        if (el.tagName !== 'SCRIPT' && !(el.tagName === 'H1' && el.textContent === 'Blok test page')) {
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

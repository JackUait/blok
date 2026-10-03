import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Several real tabs of ONE browser context: they share BroadcastChannel, Web
 * Locks and localStorage, exactly like tabs of one browser profile. No server.
 * The "server" is a document kept in that context's localStorage.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    /** Saves THIS tab ran. Per tab: a shared counter would lose concurrent increments. */
    tabSaves?: number;
    /** While true, this tab's BroadcastChannel listeners hear nothing. */
    dropTabMessages?: boolean;
  }
}

const HOLDER_ID = 'blok';
const STORE_KEY = 'e2e-store';

const SOURCE: OutputData = {
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: 'first' } },
    { id: 't1', type: 'toggle', data: { text: 'section' }, content: ['p2'] },
    { id: 'p2', type: 'paragraph', parent: 't1', data: { text: 'inside' } },
  ],
};

/**
 * Lets a test make a tab miss messages, the way a page in the back/forward
 * cache misses them. Installed before any page script, so Blok's channel gets it.
 */
const installDroppableChannel = (): void => {
  const wrapped = new WeakMap<EventListenerOrEventListenerObject, EventListener>();
  const add = BroadcastChannel.prototype.addEventListener;
  const remove = BroadcastChannel.prototype.removeEventListener;

  BroadcastChannel.prototype.addEventListener = function (this: BroadcastChannel, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    if (type !== 'message') {
      add.call(this, type, listener, options);

      return;
    }
    const gate: EventListener = (event) => {
      if (window.dropTabMessages === true) {
        return;
      }
      if (typeof listener === 'function') {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
    };

    wrapped.set(listener, gate);
    add.call(this, type, gate, options);
  };
  BroadcastChannel.prototype.removeEventListener = function (this: BroadcastChannel, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
    remove.call(this, type, wrapped.get(listener) ?? listener, options);
  };
};

const openTab = async (context: BrowserContext, options: { droppableChannel?: boolean } = {}): Promise<Page> => {
  const page = await context.newPage();

  if (options.droppableChannel === true) {
    await page.addInitScript(installDroppableChannel);
  }
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ source, holderId, storeKey }) => {
    const holder = document.createElement('div');

    holder.id = holderId;
    holder.setAttribute('data-blok-testid', holderId);
    document.body.appendChild(holder);

    if (localStorage.getItem(storeKey) === null) {
      localStorage.setItem(storeKey, JSON.stringify({ data: source, version: 'v0' }));
    }
    window.tabSaves = 0;

    const editor = new window.Blok({
      holder: holderId,
      documentId: 'e2e-doc',
      persistence: {
        load: async () => JSON.parse(localStorage.getItem(storeKey) ?? 'null') as unknown,
        save: async (data: unknown) => {
          window.tabSaves = (window.tabSaves ?? 0) + 1;
          const version = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;

          localStorage.setItem(storeKey, JSON.stringify({ data, version }));

          return { version };
        },
      },
    });

    await editor.isReady;
    window.blokInstance = editor;
  }, { source: SOURCE, holderId: HOLDER_ID, storeKey: STORE_KEY });

  return page;
};

const editorIn = (page: Page): Locator => page.getByTestId(HOLDER_ID);

const savesIn = (page: Page): Promise<number> => page.evaluate(() => window.tabSaves ?? 0);

const totalSaves = async (pages: Page[]): Promise<number> => {
  const counts = await Promise.all(pages.map(savesIn));

  return counts.reduce((sum, count) => sum + count, 0);
};

/** Waits until no tab has saved for `quietMs`: boot and hand-off saves are over. */
const settleSaves = async (pages: Page[], quietMs = 1200): Promise<number> => {
  let previous = await totalSaves(pages);

  for (;;) {
    await pages[0].waitForTimeout(quietMs);
    const current = await totalSaves(pages);

    if (current === previous) {
      return current;
    }
    previous = current;
  }
};

const storedDocument = (page: Page): Promise<string> =>
  page.evaluate((storeKey) => localStorage.getItem(storeKey) ?? '', STORE_KEY);

const storedBlockCount = (page: Page): Promise<number> => page.evaluate((storeKey) => {
  const stored = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as { data?: { blocks?: unknown[] } } | null;

  return stored?.data?.blocks?.length ?? -1;
}, STORE_KEY);

/** Clicks the first paragraph, puts the caret at its end and types. */
const appendToFirst = async (page: Page, text: string): Promise<void> => {
  await editorIn(page).getByText('first', { exact: false }).first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
};

const arrowIn = (page: Page): Locator =>
  editorIn(page).getByRole('button', { name: /^(Expand|Collapse)$/ });

test.describe('tab sync', () => {
  test.describe.configure({ timeout: 45_000 });

  test('an edit in one tab appears in the others', async ({ browser }) => {
    const context = await browser.newContext();
    const a = await openTab(context);
    const b = await openTab(context);
    const c = await openTab(context);

    await appendToFirst(a, ' typed in A');

    await expect(editorIn(b).getByText('first typed in A')).toBeVisible();
    await expect(editorIn(c).getByText('first typed in A')).toBeVisible();

    // A tab opened after the edit can show it straight from the store even if
    // it never joined. Its OWN edit reaching A proves it joined: a tab that
    // counted its boot render as a local edit stays solo and never broadcasts.
    const d = await openTab(context);

    await expect(editorIn(d).getByText('first typed in A')).toBeVisible();
    await appendToFirst(d, ' and D');
    await expect(editorIn(a).getByText('first typed in A and D')).toBeVisible();
    await context.close();
  });

  test('three tabs opened together produce no duplicate blocks', async ({ browser }) => {
    const context = await browser.newContext();
    const tabs = await Promise.all([openTab(context), openTab(context), openTab(context)]);

    // Past the join timeout and every boot save: a late duplicate would show by now.
    await tabs[0].waitForTimeout(3500);
    await settleSaves(tabs);

    for (const page of tabs) {
      await expect(editorIn(page).getByText('first', { exact: true })).toHaveCount(1);
      await expect(editorIn(page).getByText('section', { exact: true })).toHaveCount(1);
    }

    // The tabs are linked, not three separate copies: an edit still crosses.
    await appendToFirst(tabs[2], '!');
    for (const page of tabs) {
      await expect(editorIn(page).getByText('first!', { exact: true })).toHaveCount(1);
    }
    await settleSaves(tabs);
    expect(await storedBlockCount(tabs[0])).toBe(SOURCE.blocks.length);
    await context.close();
  });

  test('only one tab saves an edit', async ({ browser }) => {
    const context = await browser.newContext();
    const a = await openTab(context);
    const b = await openTab(context);
    const tabs = [a, b];
    const before = await settleSaves(tabs);

    await appendToFirst(b, '!');

    await expect.poll(() => totalSaves(tabs)).toBe(before + 1);
    // Several batch windows (400 ms each) later there is still exactly one save.
    await a.waitForTimeout(1500);
    expect(await totalSaves(tabs)).toBe(before + 1);
    expect(await storedDocument(a)).toContain('first!');
    await context.close();
  });

  test('closing the leader keeps saving from another tab', async ({ browser }) => {
    const context = await browser.newContext();
    const a = await openTab(context);
    const b = await openTab(context);

    await a.close();
    // B saves once on promotion; wait that out so it cannot pass for the edit's save.
    const before = await settleSaves([b]);

    await appendToFirst(b, '?');

    await expect.poll(() => savesIn(b)).toBe(before + 1);
    expect(await storedDocument(b)).toContain('first?');
    await context.close();
  });

  test('a follower closed right after typing loses nothing', async ({ browser }) => {
    const context = await browser.newContext();
    const a = await openTab(context);
    const b = await openTab(context);

    await appendToFirst(b, ' last words');
    // A real tab close: pagehide must flush what B still buffered.
    await b.close({ runBeforeUnload: true });

    await expect(editorIn(a).getByText('first last words')).toBeVisible();
    await expect.poll(() => storedDocument(a)).toContain('last words');
    await context.close();
  });

  // Headless Chromium never restores from the back/forward cache here, even a
  // plain fixture page with Playwright's --disable-back-forward-cache removed
  // (probed: marker gone after goBack). So this drives what the restore
  // triggers instead: B misses every message, then its page turns visible.
  test('a tab back from the back/forward cache catches up', async ({ browser }) => {
    const context = await browser.newContext();
    const a = await openTab(context);
    const b = await openTab(context, { droppableChannel: true });

    // B has joined: a live edit reaches it.
    await appendToFirst(a, ' and');
    await expect(editorIn(b).getByText('first and')).toBeVisible();

    await b.evaluate(() => {
      window.dropTabMessages = true;
    });
    await appendToFirst(a, ' while away');
    await expect(editorIn(a).getByText('first and while away')).toBeVisible();
    // B really missed it: nothing reached it while away.
    await b.waitForTimeout(1000);
    await expect(editorIn(b).getByText('first and while away')).toHaveCount(0);

    await b.evaluate(() => {
      window.dropTabMessages = false;
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await expect(editorIn(b).getByText('first and while away')).toBeVisible();
    await context.close();
  });

  test('collapsing a toggle in one tab collapses it in the others', async ({ browser }) => {
    const context = await browser.newContext();
    const a = await openTab(context);
    const b = await openTab(context);

    // Collapsed by default in every tab, followers included.
    await expect(arrowIn(a)).toHaveAttribute('aria-expanded', 'false');
    await expect(arrowIn(b)).toHaveAttribute('aria-expanded', 'false');

    await arrowIn(a).click();
    await expect(arrowIn(b)).toHaveAttribute('aria-expanded', 'true');
    await expect(editorIn(b).getByText('inside')).toBeVisible();

    await arrowIn(b).click();
    await expect(arrowIn(a)).toHaveAttribute('aria-expanded', 'false');
    await expect(editorIn(a).getByText('inside')).toBeHidden();
    await context.close();
  });
});

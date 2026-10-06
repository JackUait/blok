import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

import { playgroundPageSeed, startPageHost } from '../../../../scripts/dev-page-host.mjs';

/**
 * The page platform's real-host acceptance check: two users (two browser
 * contexts) and a second tab, against the reference page host in
 * scripts/dev-page-host.mjs. Every title shown must be the host's.
 */

const ROOT = resolve(__dirname, '../../../..');
const ALICE = 'playground-alice';
const BOB = 'playground-bob';
const PAGE = 'keyboard-shortcuts';
const PARENT = 'getting-started';
const SEED_TITLE = 'Keyboard shortcuts';

let vite: ViteDevServer | undefined;
let viteUrl: string;
let cacheDir: string | undefined;
let host: { url: string; close: () => Promise<void> };

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'blok-vite-'));
  vite = await createServer({
    root: ROOT,
    logLevel: 'error',
    // vite.config.mjs forces re-optimization, so every Vite boot deletes its
    // deps dir. In the shared node_modules/.vite, another Vite booting
    // (page-host-sync.spec.ts's worker, a retry, `yarn serve`) deletes the deps
    // this one is serving: 504 Outdated Optimize Dep and a blank page.
    cacheDir,
    // No HMR: the checkout is shared, and an edit to any watched file would
    // full-reload every open page mid-test. `watch: null` cannot do this:
    // Vite's mergeConfig skips null, so vite.config.mjs's watcher stays.
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
  });
  await vite.listen();

  const address = vite.httpServer?.address();

  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Playground Vite server did not bind a port');
  }
  viteUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await vite?.close();
  if (cacheDir !== undefined) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test.beforeEach(async () => {
  const pages: unknown = JSON.parse(readFileSync(resolve(ROOT, 'playground-pages.json'), 'utf8'));

  if (typeof pages !== 'object' || pages === null) {
    throw new Error('playground-pages.json is not an object');
  }
  // Named users only: revoking one must not leave a wildcard behind.
  host = await startPageHost({
    port: 0,
    seed: playgroundPageSeed(pages).map((page) => ({ ...page, acl: { [ALICE]: 'write', [BOB]: 'write' } })),
  });
});

test.afterEach(async () => {
  await host.close();
});

const hostCall = async (user: string | null, method: string, path: string, body?: unknown): Promise<Response> => fetch(`${host.url}${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...(user !== null && { 'x-dev-user': user }) },
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const value: unknown = await response.json();

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('the host did not answer with an object');
  }

  return Object.fromEntries(Object.entries(value));
};

const hostRecord = async (): Promise<Record<string, unknown>> => readJson(await hostCall(ALICE, 'GET', `/pages/${PAGE}`));

const revoke = async (user: string): Promise<void> => {
  expect((await hostCall(ALICE, 'PUT', `/pages/${PAGE}/acl`, { user, access: null })).status).toBe(200);
};

const fault = async (body: Record<string, unknown>): Promise<void> => {
  expect((await hostCall(null, 'POST', '/__faults', body)).status).toBe(204);
};

const users = async (browser: Browser): Promise<{ alice: BrowserContext; bob: BrowserContext }> => ({
  alice: await browser.newContext(),
  bob: await browser.newContext(),
});

/** Opens a page as `name`, and waits until its title is wired to the host. */
const open = async (context: BrowserContext, name: string, pageId: string): Promise<Page> => {
  const page = await context.newPage();
  const query = new URLSearchParams({ host: 'remote', collab: 'off', name, hostUrl: host.url });

  await page.goto(`${viteUrl}/editor/page/${pageId}?${query.toString()}`);
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-page-host-wired'))).toBe(pageId);

  return page;
};

const titleOf = (page: Page): ReturnType<Page['getByRole']> => page.getByRole('textbox', { name: 'Page title' });

const pointerOf = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('page-link').getByTestId('page-title');

const saveError = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('page-host-error');

const storageOf = (page: Page): Promise<string> => page.evaluate(() => JSON.stringify({ ...localStorage }));

test('a rename reaches the other tab and the other user, through the host only', async ({ browser }) => {
  test.setTimeout(90_000);
  const { alice, bob } = await users(browser);

  try {
    const a1 = await open(alice, 'Alice', PAGE);
    const a2 = await open(alice, 'Alice', PAGE);
    const aParent = await open(alice, 'Alice', PARENT);
    const b1 = await open(bob, 'Bob', PAGE);
    const bParent = await open(bob, 'Bob', PARENT);

    await expect(titleOf(b1)).toHaveText(SEED_TITLE);
    await expect(pointerOf(bParent)).toHaveText(SEED_TITLE);

    await titleOf(a1).fill('Shortcuts by Alice');

    await expect(titleOf(a2)).toHaveText('Shortcuts by Alice');
    await expect(pointerOf(aParent)).toHaveText('Shortcuts by Alice');
    await expect(titleOf(b1)).toHaveText('Shortcuts by Alice');
    await expect(pointerOf(bParent)).toHaveText('Shortcuts by Alice');
    expect(await hostRecord()).toMatchObject({ title: 'Shortcuts by Alice', version: 2 });
    // Alice's tabs share storage: the title must have come through the host.
    expect(await storageOf(a1)).not.toContain('Shortcuts by Alice');
  } finally {
    await alice.close();
    await bob.close();
  }
});

test('Undo writes the old title back to the host as a new version, and everyone follows', async ({ browser }) => {
  test.setTimeout(90_000);
  const { alice, bob } = await users(browser);

  try {
    const a1 = await open(alice, 'Alice', PAGE);
    const a2 = await open(alice, 'Alice', PAGE);
    const bParent = await open(bob, 'Bob', PARENT);

    await titleOf(a1).fill('Renamed then undone');
    await expect(pointerOf(bParent)).toHaveText('Renamed then undone');
    await expect.poll(async () => (await hostRecord()).version).toBe(2);

    await titleOf(a1).press('ControlOrMeta+z');

    await expect(titleOf(a1)).toHaveText(SEED_TITLE);
    await expect(titleOf(a2)).toHaveText(SEED_TITLE);
    await expect(pointerOf(bParent)).toHaveText(SEED_TITLE);
    expect(await hostRecord()).toMatchObject({ title: SEED_TITLE, version: 3 });
  } finally {
    await alice.close();
    await bob.close();
  }
});

test('a save on a stale version is rejected: the other user sees the accepted title and an error', async ({ browser }) => {
  test.setTimeout(90_000);
  const { alice, bob } = await users(browser);

  try {
    const a1 = await open(alice, 'Alice', PAGE);
    const b1 = await open(bob, 'Bob', PAGE);

    // Bob's event stream lags, so he still holds version 1 when he saves.
    await fault({ user: BOB, muteEvents: true });
    await titleOf(a1).fill('Alice was first');
    await expect.poll(async () => (await hostRecord()).version).toBe(2);
    await expect(titleOf(b1)).toHaveText(SEED_TITLE);

    await titleOf(b1).fill('Bob was late');

    await expect(titleOf(b1)).toHaveText('Alice was first');
    await expect(saveError(b1)).toBeVisible();
    await expect(saveError(a1)).toBeHidden();
    await expect(titleOf(a1)).toHaveText('Alice was first');
    expect(await hostRecord()).toMatchObject({ title: 'Alice was first', version: 2 });
  } finally {
    await alice.close();
    await bob.close();
  }
});

test('a failed save rolls the title back and shows an error', async ({ browser }) => {
  test.setTimeout(90_000);
  const { alice, bob } = await users(browser);

  try {
    const a1 = await open(alice, 'Alice', PAGE);
    const bParent = await open(bob, 'Bob', PARENT);

    await fault({ user: ALICE, pageId: PAGE, failNextSave: true });
    await titleOf(a1).fill('Never saved');

    await expect(titleOf(a1)).toHaveText(SEED_TITLE);
    await expect(saveError(a1)).toBeVisible();
    await expect(pointerOf(bParent)).toHaveText(SEED_TITLE);
    expect(await hostRecord()).toMatchObject({ title: SEED_TITLE, version: 1 });
  } finally {
    await alice.close();
    await bob.close();
  }
});

test('losing access shows "No access" and leaves no trace of the title', async ({ browser }) => {
  test.setTimeout(90_000);
  const { alice, bob } = await users(browser);

  try {
    const a1 = await open(alice, 'Alice', PAGE);
    const b1 = await open(bob, 'Bob', PAGE);
    const bParent = await open(bob, 'Bob', PARENT);

    await titleOf(a1).fill('Secret roadmap');
    await expect(titleOf(b1)).toHaveText('Secret roadmap');
    await expect(pointerOf(bParent)).toHaveText('Secret roadmap');

    await revoke(BOB);

    await expect(pointerOf(bParent)).toHaveText('No access');
    await expect(titleOf(b1)).toHaveText('');
    for (const page of [b1, bParent]) {
      await expect.poll(() => page.content()).not.toContain('Secret roadmap');
    }
    await expect(titleOf(a1)).toHaveText('Secret roadmap');
  } finally {
    await alice.close();
    await bob.close();
  }
});

test('a late allowed answer does not undo a later denial', async ({ browser }) => {
  test.setTimeout(90_000);
  const { alice, bob } = await users(browser);
  const faultCounts = async (): Promise<Record<string, unknown>> => readJson(await hostCall(null, 'GET', '/__faults'));

  try {
    const a1 = await open(alice, 'Alice', PAGE);
    // One Bob tab: Chrome allows six connections per host, and a second tab's
    // event stream and held requests would queue the denial behind them.
    const bParent = await open(bob, 'Bob', PARENT);

    await expect(pointerOf(bParent)).toHaveText(SEED_TITLE);
    // Bob's allowed answers are held back; a denial never is.
    await fault({ user: BOB, pageId: PAGE, delayAllowedGetsMs: 5_000 });
    await titleOf(a1).fill('Late secret');
    // The tab's registry and its pointer each ask once.
    await expect.poll(async () => (await faultCounts()).delayedGets).toBe(2);

    await revoke(BOB);

    await expect(pointerOf(bParent)).toHaveText('No access');
    // The denial overtook: no held answer has been sent yet.
    expect(await faultCounts()).toMatchObject({ delayedGets: 2, delayedSent: 0 });

    await expect.poll(async () => (await faultCounts()).delayedSent, { timeout: 10_000 }).toBe(2);
    await expect(pointerOf(bParent)).toHaveText('No access');
    expect(await bParent.content()).not.toContain('Late secret');
  } finally {
    await alice.close();
    await bob.close();
  }
});

test('a reload shows the host record to both users', async ({ browser }) => {
  test.setTimeout(90_000);
  const { alice, bob } = await users(browser);

  try {
    const a1 = await open(alice, 'Alice', PAGE);
    const b1 = await open(bob, 'Bob', PAGE);
    const bParent = await open(bob, 'Bob', PARENT);

    await titleOf(a1).fill('Survives reload');
    await expect.poll(async () => (await hostRecord()).version).toBe(2);

    for (const page of [a1, b1, bParent]) {
      await page.reload();
    }

    await expect(titleOf(a1)).toHaveText('Survives reload');
    await expect(titleOf(b1)).toHaveText('Survives reload');
    await expect(pointerOf(bParent)).toHaveText('Survives reload');
    expect(await storageOf(a1)).not.toContain('Survives reload');
    expect(await storageOf(b1)).not.toContain('Survives reload');
  } finally {
    await alice.close();
    await bob.close();
  }
});

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

/**
 * The playground's page title is Blok's built-in `pageTitle`, fed from the
 * playground's page registry. Local mode only: `?collab=off`.
 */

let vite: ViteDevServer | undefined;
let baseUrl: string;
let cacheDir: string | undefined;

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'blok-vite-'));
  vite = await createServer({
    root: resolve(__dirname, '../../../..'),
    logLevel: 'error',
    // A private deps dir: another Vite booting in the shared node_modules/.vite
    // deletes the deps this one serves (504 Outdated Optimize Dep).
    cacheDir,
    // No HMR: another session's edit in a shared checkout would reload the page mid-test.
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
  });
  await vite.listen();

  const address = vite.httpServer?.address();

  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Playground Vite server did not bind a port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await vite?.close();
  if (cacheDir !== undefined) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

const url = (path: string, query = 'collab=off'): string => `${baseUrl}${path}?${query}`;

const titleOf = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('page-header-title');

const crumbs = (page: Page): ReturnType<Page['getByRole']> => page.getByRole('navigation', { name: 'Breadcrumb' });

/** The registry's stored title for a page; undefined while the page is still the seed's. */
const storedTitle = (page: Page, pageId: string): Promise<string | undefined> => page.evaluate((id) => {
  const stored: unknown = JSON.parse(localStorage.getItem('blok-playground-pages') ?? '{}');

  if (typeof stored !== 'object' || stored === null) {
    return undefined;
  }
  const record: unknown = Reflect.get(stored, id);
  const title: unknown = typeof record === 'object' && record !== null ? Reflect.get(record, 'title') : undefined;

  return typeof title === 'string' ? title : undefined;
}, pageId);

/** Puts the caret at the end of the title and types. */
const typeAtEnd = async (page: Page, text: string): Promise<void> => {
  const title = titleOf(page);
  const box = await title.boundingBox();

  if (box === null) {
    throw new Error('The page title is not on screen');
  }
  // A click past the text, at the h1's right edge, puts the caret at the end.
  // Not End: on macOS End scrolls the page and leaves the caret.
  await title.click({ position: { x: box.width - 4, y: box.height / 2 } });
  await page.keyboard.type(text);
};

test.describe('playground page title', () => {
  test.setTimeout(90_000);

  test('the root page shows the built-in title, and a rename survives a reload', async ({ page }) => {
    await page.goto(url('/editor'));

    await expect(titleOf(page)).toHaveText('Blok');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveCount(1);

    await typeAtEnd(page, ' Plan');

    await expect(titleOf(page)).toHaveText('Blok Plan');
    await expect.poll(() => page.title()).toContain('Blok Plan');

    await page.reload();

    await expect(titleOf(page)).toHaveText('Blok Plan');
    await expect.poll(() => page.title()).toContain('Blok Plan');
  });

  test('typing in a child page title updates the breadcrumb and document title', async ({ page }) => {
    await page.goto(url('/editor/page/getting-started'));

    await expect(titleOf(page)).toHaveText('Getting started');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveCount(1);

    await typeAtEnd(page, ' Plan');

    await expect(crumbs(page).getByText('Getting started Plan')).toBeVisible();
    await expect.poll(() => page.title()).toContain('Getting started Plan');

    await page.reload();

    await expect(titleOf(page)).toHaveText('Getting started Plan');
  });

  test('a page opened from a link block shows its own title, and the link follows a rename', async ({ page }) => {
    await page.goto(url('/editor/page/getting-started'));
    await expect(titleOf(page)).toHaveText('Getting started');

    await page.getByTestId('page-link').getByTestId('page-title').click();

    await expect(titleOf(page)).toHaveText('Keyboard shortcuts');
    await expect(page).toHaveURL(/\/editor\/page\/keyboard-shortcuts/);

    await typeAtEnd(page, ' 2');
    await expect(crumbs(page).getByText('Keyboard shortcuts 2')).toBeVisible();

    await crumbs(page).getByRole('link', { name: 'Getting started' }).click();

    await expect(titleOf(page)).toHaveText('Getting started');
    await expect(page.getByTestId('page-link').getByTestId('page-title')).toHaveText('Keyboard shortcuts 2');
  });

  test('a rename followed at once by navigation never renames the next page', async ({ page }) => {
    await page.goto(url('/editor/page/getting-started'));
    await expect(titleOf(page)).toHaveText('Getting started');

    await typeAtEnd(page, ' X');
    await page.getByTestId('page-link').getByTestId('page-title').click();

    await expect(titleOf(page)).toHaveText('Keyboard shortcuts');
    await expect.poll(() => storedTitle(page, 'getting-started')).toBe('Getting started X');

    // The way back gives any late callback of the first editor time to land.
    await crumbs(page).getByRole('link', { name: 'Getting started X' }).click();

    await expect(titleOf(page)).toHaveText('Getting started X');
    await expect(page.getByTestId('page-link').getByTestId('page-title')).toHaveText('Keyboard shortcuts');
    expect(await storedTitle(page, 'keyboard-shortcuts') ?? 'Keyboard shortcuts').toBe('Keyboard shortcuts');
  });

  test('?slowLoad shows the title once the delayed document loads', async ({ page }) => {
    await page.goto(url('/editor/page/getting-started', 'collab=off&slowLoad=600'));

    await expect(titleOf(page)).toHaveText('Getting started');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveCount(1);
  });
});

const KEY_GAP_MS = 60;

const firstBlock = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('block-wrapper').first();

// No role or testid on a paragraph's editable field: the block wrapper's testid, then its field.
const firstField = (page: Page): ReturnType<Page['locator']> => firstBlock(page).locator('[contenteditable="true"]').first();

/** A click at the field's left edge puts the caret at its start. Not Home: on macOS Home scrolls. */
const caretToStart = async (field: ReturnType<Page['locator']>): Promise<void> => {
  const box = await field.boundingBox();

  if (box === null) {
    throw new Error('The field is not on screen');
  }
  await field.click({ position: { x: 1, y: Math.min(box.height / 2, 12) } });
};

test.describe('playground page icon undo', () => {
  test.setTimeout(90_000);

  test('Cmd+Z steps back through icon changes, and the breadcrumb follows', async ({ page }) => {
    const seedPages: unknown = JSON.parse(readFileSync(resolve(__dirname, '../../../../playground-pages.json'), 'utf8'));
    const seedRecord: unknown = typeof seedPages === 'object' && seedPages !== null ? Reflect.get(seedPages, 'getting-started') : undefined;

    if (typeof seedRecord !== 'object' || seedRecord === null) {
      throw new Error('playground-pages.json has no getting-started page');
    }
    const { icon: _icon, ...withoutIcon } = Object.fromEntries(Object.entries(seedRecord));

    // A stored record replaces the seed's, so the page starts with no icon.
    await page.goto(url('/editor'));
    await page.evaluate((record) => {
      localStorage.setItem('blok-playground-pages', JSON.stringify({ 'getting-started': record }));
    }, withoutIcon);
    await page.goto(url('/editor/page/getting-started'));

    // The current crumb is a span with no role; aria-current is its accessible marker.
    const current = crumbs(page).locator('[aria-current="page"]');
    const icon = page.getByTestId('page-header-icon');

    await expect(titleOf(page)).toHaveText('Getting started');
    await expect(current).toHaveText('Getting started');

    await page.getByTestId('page-header').hover();
    await page.getByTestId('page-header-add-icon').click();
    await expect(icon).not.toBeEmpty();
    const random = (await icon.textContent()) ?? '';

    await expect(current).toHaveText(`${random}Getting started`);
    const picker = page.getByRole('dialog', { name: 'Edit icon' });

    await expect(picker).toBeVisible();
    // Settle the opening animation so the click lands on a still grid.
    await picker.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));

    const [other, otherName] = random === '👉' ? ['👈', 'backhand index pointing left'] : ['👉', 'backhand index pointing right'];

    await picker.getByRole('button', { name: otherName, exact: true }).click();
    await expect(icon).toHaveText(other);
    await expect(current).toHaveText(`${other}Getting started`);

    // Undo runs from the title: the header owns its keys.
    await typeAtEnd(page, '');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(icon).toHaveText(random);
    await expect(current).toHaveText(`${random}Getting started`);

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Blok drops a second identical key within 50ms
    await page.waitForTimeout(KEY_GAP_MS);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('page-header-add-icon')).toBeAttached();
    await expect(icon).toHaveCount(0);
    await expect(current).toHaveText('Getting started');
    await expect(titleOf(page)).toHaveText('Getting started');
  });
});

test.describe('playground page title keyboard', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(url('/editor/page/getting-started'));
    await expect(titleOf(page)).toHaveText('Getting started');
  });

  test('Enter mid-title splits the title into a new first block', async ({ page }) => {
    await typeAtEnd(page, '');
    for (let i = 0; i < ' started'.length; i += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.press('Enter');

    await expect(titleOf(page)).toHaveText('Getting');
    await expect(firstField(page)).toBeFocused();
    expect(((await firstField(page).textContent()) ?? '').replace(/ /g, ' ')).toBe(' started');
    await expect(crumbs(page).locator('[aria-current="page"]')).toContainText('Getting');
  });

  test('ArrowDown from the end of the title lands in the first block', async ({ page }) => {
    await typeAtEnd(page, '');
    await page.keyboard.press('ArrowDown');

    await expect(firstField(page)).toBeFocused();
    await expect(firstField(page)).toContainText('This is a page inside the playground.');
  });

  test('Backspace at the start of a paragraph first block joins it into the title', async ({ page }) => {
    await caretToStart(firstField(page));
    await page.keyboard.press('Backspace');

    await expect(titleOf(page)).toHaveText(/^Getting startedThis is a page inside the playground\./);
    await expect(titleOf(page)).toBeFocused();
    await expect(firstBlock(page)).toHaveAttribute('data-blok-component', 'header');
  });

  test('Backspace at the start of a heading first block makes it a paragraph first, then joins', async ({ page }) => {
    // Remove the intro paragraph so the heading is the first block.
    await caretToStart(firstField(page));
    await page.keyboard.press('Backspace');
    await expect(firstBlock(page)).toHaveAttribute('data-blok-component', 'header');
    const joined = (await titleOf(page).textContent()) ?? '';

    await caretToStart(firstField(page));
    await page.keyboard.press('Backspace');

    await expect(firstBlock(page)).toHaveAttribute('data-blok-component', 'paragraph');
    await expect(firstField(page)).toHaveText('Things to try');
    await expect(titleOf(page)).toHaveText(joined);

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Blok drops a second identical key within 50ms
    await page.waitForTimeout(KEY_GAP_MS);
    await page.keyboard.press('Backspace');

    await expect(titleOf(page)).toHaveText(`${joined}Things to try`);
  });
});

interface MorphRecord {
  /** `ready` settled: 'ok', or the error name when the browser skipped the transition (a hard cut). */
  ready: string;
  /** The morph rules on the page being left. */
  leaving: string;
  /** The morph rules in force once the new page is in. */
  arriving: string;
}

declare global {
  interface Window {
    pgMorphs?: MorphRecord[];
  }
}

/** Records every page transition: whether it ran, and which parts it named on arrival. */
const recordMorphs = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const start = document.startViewTransition?.bind(document);

    if (start === undefined) {
      return;
    }
    window.pgMorphs = [];
    document.startViewTransition = (update?: ViewTransitionUpdateCallback | StartViewTransitionOptions) => {
      // The transition's own sheet starts with the body rule; playground.css also mentions these names.
      const rules = (side: string): string => [...document.head.querySelectorAll('style')]
        .map((style) => style.textContent ?? '')
        .filter((text) => text.startsWith(`#tab-editor { view-transition-name: ${side}; }`))
        .join('\n');
      const record: MorphRecord = { ready: 'pending', leaving: rules('pg-page-out'), arriving: '' };

      window.pgMorphs?.push(record);
      const callback = typeof update === 'function' ? update : undefined;
      const transition = start(async () => {
        await callback?.();
        record.arriving = rules('pg-page-in');
      });

      transition.ready.then(() => {
        record.ready = 'ok';
      }, (error: unknown) => {
        record.ready = error instanceof Error ? error.name : 'rejected';
      });

      return transition;
    };
  });
};

const lastMorph = (page: Page): Promise<MorphRecord | undefined> => page.evaluate(() => window.pgMorphs?.at(-1));

test.describe('playground page morphs', () => {
  test.setTimeout(90_000);

  test('opening a page from its link block morphs the row into Blok\'s title and icon', async ({ page }) => {
    await recordMorphs(page);
    await page.goto(url('/editor/page/getting-started'));
    await expect(titleOf(page)).toHaveText('Getting started');

    await page.getByTestId('page-link').getByTestId('page-title').click();
    await expect(titleOf(page)).toHaveText('Keyboard shortcuts');

    await expect.poll(async () => (await lastMorph(page))?.ready).toBe('ok');
    const morph = await lastMorph(page);

    expect(morph?.arriving).toContain('[data-blok-testid="page-header-title"] { view-transition-name: pg-page-title; }');
    expect(morph?.arriving).toContain('[data-blok-testid="page-header-icon"] { view-transition-name: pg-page-icon; }');
  });

  test('a page with no icon morphs its title and names no icon', async ({ page }) => {
    const seedPages: unknown = JSON.parse(readFileSync(resolve(__dirname, '../../../../playground-pages.json'), 'utf8'));
    const seedRecord: unknown = typeof seedPages === 'object' && seedPages !== null ? Reflect.get(seedPages, 'keyboard-shortcuts') : undefined;

    if (typeof seedRecord !== 'object' || seedRecord === null) {
      throw new Error('playground-pages.json has no keyboard-shortcuts page');
    }
    const { icon: _icon, ...withoutIcon } = Object.fromEntries(Object.entries(seedRecord));

    await recordMorphs(page);
    await page.goto(url('/editor'));
    await page.evaluate((record) => {
      localStorage.setItem('blok-playground-pages', JSON.stringify({ 'keyboard-shortcuts': record }));
    }, withoutIcon);
    await page.goto(url('/editor/page/getting-started'));
    await expect(titleOf(page)).toHaveText('Getting started');

    await page.getByTestId('page-link').getByTestId('page-title').click();
    await expect(titleOf(page)).toHaveText('Keyboard shortcuts');
    await expect(page.getByTestId('page-header-add-icon')).toBeAttached();

    await expect.poll(async () => (await lastMorph(page))?.ready).toBe('ok');
    const morph = await lastMorph(page);

    expect(morph?.arriving).toContain('view-transition-name: pg-page-title;');
    // A view-transition name, not a class: the CSS-selector lint misreads it inside toContain.
    expect(morph?.arriving.includes('view-transition-name: pg-page-icon;')).toBe(false);
  });

  test('going back up morphs Blok\'s title and icon into the parent\'s link block', async ({ page }) => {
    await recordMorphs(page);
    await page.goto(url('/editor/page/getting-started'));
    await expect(titleOf(page)).toHaveText('Getting started');
    await page.getByTestId('page-link').getByTestId('page-title').click();
    await expect(titleOf(page)).toHaveText('Keyboard shortcuts');
    await expect.poll(async () => (await lastMorph(page))?.ready).toBe('ok');

    // Browser Back, not a crumb: a crumb opens the page out of the crumb and morphs no part.
    await page.goBack();
    await expect(titleOf(page)).toHaveText('Getting started');

    await expect.poll(() => page.evaluate(() => window.pgMorphs?.length)).toBe(2);
    await expect.poll(async () => (await lastMorph(page))?.ready).toBe('ok');
    const morph = await lastMorph(page);

    expect(morph?.leaving).toContain('[data-blok-testid="page-header-title"] { view-transition-name: pg-page-title; }');
    expect(morph?.leaving).toContain('[data-blok-testid="page-header-icon"] { view-transition-name: pg-page-icon; }');
    expect(morph?.arriving).toContain('[data-blok-testid="page-title"] { view-transition-name: pg-page-title; }');
    expect(morph?.arriving).toContain('[data-blok-testid="page-icon"] { view-transition-name: pg-page-icon; }');
  });
});

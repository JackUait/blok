import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

// Made by test/playwright/fixtures/pdf/make-fixtures.mjs.
const PDF_FIXTURES = join(process.cwd(), 'test/playwright/fixtures/pdf');
const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

/** A fresh editor with the File tool, which test.html does not register. */
const createBlokWithFile = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
    // @ts-expect-error built bundle has no TS types — runtime-only dynamic import
    const { File: FileTool } = await import('/dist/tools.mjs?_v=1') as Record<string, new (...args: unknown[]) => unknown>;
    const blok = new window.Blok({ holder, tools: { file: { class: FileTool } } });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

/** Uploads a fixture into a new File block and opens its preview. */
const openPdf = async (page: Page, name: string): Promise<Locator> => {
  await createBlokWithFile(page);
  await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`).click();
  await page.keyboard.type('/file', { delay: 50 });
  await page.locator('[data-blok-item-name="file"]').click();
  await page.getByTestId('file-input').setInputFiles(join(PDF_FIXTURES, name));
  await page.getByRole('button', { name: new RegExp(name.replace('.', '\\.'), 'i') }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  return dialog;
};

/** Counts the canvas pixels that are not white paper. */
const inkedPixels = (region: Locator): Promise<number> => region.evaluate((box) => {
  const canvas = box.querySelector('canvas');
  if (canvas === null || canvas.width === 0 || canvas.height === 0) {
    return 0;
  }
  const context = canvas.getContext('2d');
  if (context === null) {
    return 0;
  }
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let inked = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) {
      inked += 1;
    }
  }

  return inked;
});

test.describe('PDF preview', () => {
  test('draws each page, with text that can be selected', async ({ page }) => {
    const dialog = await openPdf(page, 'three-pages.pdf');
    const pages = dialog.getByRole('region', { name: /^Page \d$/ });
    const first = dialog.getByRole('region', { name: 'Page 1', exact: true });

    await expect(pages).toHaveCount(3);
    expect(await dialog.evaluate((node) => node.querySelectorAll('iframe').length)).toBe(0);
    await expect.poll(() => inkedPixels(first)).toBeGreaterThan(100);

    const title = first.getByText('Blok PDF page 1', { exact: true });
    await expect(title).toBeVisible();
    await title.selectText();
    expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe('Blok PDF page 1');
  });

  test('the next page button moves the counter', async ({ page }) => {
    const dialog = await openPdf(page, 'three-pages.pdf');
    const counter = dialog.locator('[data-role="file-preview-page"]');

    await expect(counter).toHaveText('Page 1 / 3');
    await dialog.getByRole('button', { name: 'Next page' }).click();

    await expect(counter).toHaveText('Page 2 / 3');
  });

  test('a link inside the PDF scrolls to its page', async ({ page }) => {
    const dialog = await openPdf(page, 'three-pages.pdf');
    const first = dialog.getByRole('region', { name: 'Page 1', exact: true });
    const third = dialog.getByRole('region', { name: 'Page 3', exact: true });

    await first.getByRole('link', { name: 'Go to page 3' }).click();

    await expect(third).toBeInViewport();
    await expect(dialog.locator('[data-role="file-preview-page"]')).toHaveText('Page 3 / 3');
  });

  test('a link out of the PDF opens in a new tab without an opener', async ({ page }) => {
    const dialog = await openPdf(page, 'three-pages.pdf');
    const link = dialog.getByRole('region', { name: 'Page 1', exact: true }).getByRole('link', { name: 'Blok website' });

    await expect(link).toHaveAttribute('href', 'https://example.com/blok');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('a protected PDF asks for its password until it is right', async ({ page }) => {
    const dialog = await openPdf(page, 'password-blok.pdf');
    const password = dialog.getByLabel('This PDF is protected. Enter its password.');

    await expect(password).toBeFocused();
    await password.fill('nope');
    await dialog.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('That password is wrong. Try again.');

    await password.fill('blok');
    await dialog.getByRole('button', { name: 'Open', exact: true }).click();

    const first = dialog.getByRole('region', { name: 'Page 1', exact: true });
    await expect(first.getByText('Blok secret page', { exact: true })).toBeVisible();
    await expect.poll(() => inkedPixels(first)).toBeGreaterThan(100);
  });

  test('a broken PDF shows the error card with its download', async ({ page }) => {
    const dialog = await openPdf(page, 'corrupt.pdf');
    const card = dialog.locator('[data-role="file-preview-error"]');

    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'corrupt.pdf');
    await expect(card.getByRole('link', { name: 'Download' })).toHaveAttribute('href', /^blob:/);
    await expect(card.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('target', '_blank');
    await expect(dialog.getByRole('region', { name: 'Page 1', exact: true })).toHaveCount(0);
  });
});

const REMOTE = 'https://pdfs.blok.test';
const THREE_PAGES = readFileSync(join(PDF_FIXTURES, 'three-pages.pdf'));
// The test server's own file under another origin (the page runs on localhost):
// a real cross-origin answer without CORS headers. A route would not do, as
// the browser does not apply CORS to a fulfilled route.
const NO_CORS = 'http://127.0.0.1:4444/test/playwright/fixtures/pdf/three-pages.pdf';

interface RemoteOptions {
  /** Give the File tool a fetchPreview hook that reads through this same-origin proxy path. */
  proxy?: string;
}

/** An editor holding one File block for `url`, with its preview open. */
const openRemotePdf = async (page: Page, url: string, options: RemoteOptions = {}): Promise<Locator> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, url: fileUrl, proxy }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
    // @ts-expect-error built bundle has no TS types — runtime-only dynamic import
    const { File: FileTool } = await import('/dist/tools.mjs?_v=1') as Record<string, new (...args: unknown[]) => unknown>;
    const config = proxy === undefined
      ? {}
      : { fetchPreview: (target: string) => fetch(`${proxy}?url=${encodeURIComponent(target)}`) };
    const blok = new window.Blok({
      holder,
      tools: { file: { class: FileTool, config } },
      data: { blocks: [{ type: 'file', data: { url: fileUrl, fileName: 'remote.pdf', mimeType: 'application/pdf' } }] },
    });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, url, proxy: options.proxy });
  await page.getByRole('button', { name: /remote\.pdf/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  return dialog;
};

test.describe('PDF preview of an http(s) file', () => {
  test('draws a PDF its host shares with CORS', async ({ page }) => {
    await page.route(`${REMOTE}/cors.pdf`, (route) => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' },
      body: THREE_PAGES,
    }));
    const dialog = await openRemotePdf(page, `${REMOTE}/cors.pdf`);
    const first = dialog.getByRole('region', { name: 'Page 1', exact: true });

    await expect(dialog.getByRole('region', { name: /^Page \d$/ })).toHaveCount(3);
    await expect.poll(() => inkedPixels(first)).toBeGreaterThan(100);
    expect(await dialog.evaluate((node) => node.querySelectorAll('iframe').length)).toBe(0);
  });

  test('offers the link when the host shares no CORS and no hook can help', async ({ page }) => {
    const asked = { count: 0 };
    const onRequest = (request: { url(): string }): void => {
      if (request.url() === NO_CORS) {
        asked.count += 1;
      }
    };
    page.on('request', onRequest);
    const dialog = await openRemotePdf(page, NO_CORS);
    const link = dialog.locator('[data-role="file-preview-external"]').getByRole('link', { name: 'Open in new tab' });

    await expect(link).toHaveAttribute('href', NO_CORS);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    page.off('request', onRequest);
    // The browser did ask and then blocked the answer: the link is the fallback, not a skipped try.
    expect(asked.count).toBeGreaterThan(0);
    await expect(dialog.getByRole('region', { name: 'Page 1', exact: true })).toHaveCount(0);
  });

  test('draws a PDF without CORS through the host\'s fetchPreview hook', async ({ page }) => {
    const proxied: string[] = [];
    await page.route('**/__pdf-proxy?*', (route) => {
      proxied.push(new URL(route.request().url()).searchParams.get('url') ?? '');

      return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/pdf' }, body: THREE_PAGES });
    });
    const dialog = await openRemotePdf(page, NO_CORS, { proxy: '/__pdf-proxy' });
    const first = dialog.getByRole('region', { name: 'Page 1', exact: true });

    await expect(dialog.getByRole('region', { name: /^Page \d$/ })).toHaveCount(3);
    await expect.poll(() => inkedPixels(first)).toBeGreaterThan(100);
    expect(proxied).toEqual([NO_CORS]);
  });

  test('ends on the error card, with nothing framed, when the url sends HTML', async ({ page }) => {
    await page.route(`${REMOTE}/page.pdf`, (route) => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' },
      body: '<!doctype html><html><body><script>top.__pdfHtmlRan = true</script>Not a PDF</body></html>',
    }));
    const dialog = await openRemotePdf(page, `${REMOTE}/page.pdf`);
    const card = dialog.locator('[data-role="file-preview-error"]');

    await expect(card).toBeVisible();
    await expect(card.getByRole('link', { name: 'Download' })).toHaveAttribute('href', `${REMOTE}/page.pdf`);
    expect(await page.evaluate(() => document.querySelectorAll('iframe, object, embed').length)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pdfHtmlRan?: boolean }).__pdfHtmlRan)).toBeUndefined();
    await expect(dialog.locator('[data-role="file-preview-external"]')).toHaveCount(0);
  });
});

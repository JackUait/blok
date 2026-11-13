import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { manyPagesPdf } from '../../fixtures/pdf/make-fixtures.mjs';
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

  test('Cmd/Ctrl+F finds words across pages and Enter jumps to the next page', async ({ page }) => {
    const dialog = await openPdf(page, 'three-pages.pdf');
    const counter = dialog.locator('[data-role="file-preview-page"]');
    await expect(dialog.getByRole('region', { name: 'Page 1', exact: true }).getByText('Blok PDF page 1')).toBeVisible();

    await page.keyboard.press('ControlOrMeta+f');
    const find = dialog.getByRole('textbox', { name: 'Find in page' });
    await expect(find).toBeFocused();
    await find.fill('blok pdf');

    const count = dialog.locator('[data-role="file-preview-find-count"]');
    await expect(count).toHaveText('1 / 3');
    // The current match is painted over page 1's text layer.
    await expect.poll(() => page.evaluate(() => [...CSS.highlights.get('blok-find-match-active') ?? []].map((range) => (range instanceof Range ? range.toString() : ''))))
      .toEqual(['Blok PDF']);
    await find.press('Enter');
    await expect(count).toHaveText('2 / 3');
    await expect(counter).toHaveText('Page 2 / 3');
    await find.press('Shift+Enter');
    await expect(count).toHaveText('1 / 3');

    await find.press('Escape');
    await expect(find).toHaveCount(0);
    await expect(dialog).toBeVisible();
  });

  test('Ctrl+wheel zooms the pages, not the page', async ({ page }) => {
    const dialog = await openPdf(page, 'three-pages.pdf');
    const first = dialog.getByRole('region', { name: 'Page 1', exact: true });
    await expect.poll(() => inkedPixels(first)).toBeGreaterThan(100);
    const before = await first.evaluate((box) => box.getBoundingClientRect().width);

    await first.hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    await expect(dialog.locator('[data-role="file-preview-zoom"]')).not.toHaveText('100%');
    await expect.poll(() => first.evaluate((box) => box.getBoundingClientRect().width)).toBeGreaterThan(before);
    await expect.poll(() => inkedPixels(first)).toBeGreaterThan(100);
  });

  test('the thumbnail rail jumps to a page by click or Enter', async ({ page }) => {
    const dialog = await openPdf(page, 'three-pages.pdf');
    const counter = dialog.locator('[data-role="file-preview-page"]');
    const toggle = dialog.getByRole('button', { name: 'Page thumbnails' });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const rail = dialog.getByRole('group', { name: 'Page thumbnails' });
    const thumbs = rail.getByRole('button', { name: /^Page \d$/ });
    await expect(thumbs).toHaveCount(3);
    await expect(thumbs.first()).toHaveAttribute('aria-current', 'true');
    await expect.poll(() => thumbs.nth(2).evaluate((thumb) => thumb.querySelector('canvas')?.width ?? 0)).toBeGreaterThan(0);

    await thumbs.nth(2).click();
    await expect(counter).toHaveText('Page 3 / 3');
    await expect(thumbs.nth(2)).toHaveAttribute('aria-current', 'true');

    await thumbs.nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(counter).toHaveText('Page 2 / 3');

    await toggle.click();
    await expect(rail).toBeHidden();
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
  /** Give the File tool a Blok server preview endpoint at this same-origin path. */
  previewEndpoint?: string;
}

/** An editor holding one File block for `url`, with its preview open. */
const openRemotePdf = async (page: Page, url: string, options: RemoteOptions = {}): Promise<Locator> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, url: fileUrl, proxy, previewEndpoint }) => {
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
    const config = {
      // These tests count the preview's own requests; the card would add its own.
      cardPreview: false,
      ...(proxy === undefined ? {} : { fetchPreview: (target: string) => fetch(`${proxy}?url=${encodeURIComponent(target)}`) }),
      ...(previewEndpoint === undefined ? {} : { previewEndpoint: { url: `${location.origin}${previewEndpoint}` } }),
    };
    const blok = new window.Blok({
      holder,
      tools: { file: { class: FileTool, config } },
      data: { blocks: [{ type: 'file', data: { url: fileUrl, fileName: 'remote.pdf', mimeType: 'application/pdf' } }] },
    });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, url, proxy: options.proxy, previewEndpoint: options.previewEndpoint });
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

test.describe('PDF preview through the Blok server', () => {
  const MIB = 1_048_576;
  // 50 pages of about 200 KB each: a file of ten 1 MiB chunks.
  const LARGE: Buffer = manyPagesPdf(50, 200_000);

  test('reads a large PDF in ranges of at most 1 MiB, only where it draws', async ({ page }) => {
    const ranges: string[] = [];
    await page.route('**/file-bytes?*', (route) => {
      const range = route.request().headers().range ?? '';
      ranges.push(range);
      const [start, end] = range.replace('bytes=', '').split('-').map(Number);
      const last = Math.min(end, LARGE.length - 1);
      if (last - start + 1 > MIB) {
        return route.fulfill({ status: 413, body: 'range too large\n' });
      }

      return route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Range': `bytes ${start}-${last}/${LARGE.length}`,
          'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
        },
        body: LARGE.subarray(start, last + 1),
      });
    });
    const dialog = await openRemotePdf(page, NO_CORS, { previewEndpoint: '/file-bytes' });
    const first = dialog.getByRole('region', { name: 'Page 1', exact: true });
    const last = dialog.getByRole('region', { name: 'Page 50', exact: true });

    await expect(dialog.getByRole('region', { name: /^Page \d+$/ })).toHaveCount(50);
    await expect.poll(() => inkedPixels(first)).toBeGreaterThan(100);
    const atOpen = ranges.length;
    await last.scrollIntoViewIfNeeded();
    await expect.poll(() => inkedPixels(last)).toBeGreaterThan(100);

    test.info().annotations.push({ type: 'file-bytes requests', description: `${atOpen} to open, ${ranges.length} after page 50 (${LARGE.length} bytes)` });
    expect(ranges[0]).toBe(`bytes=0-${MIB - 1}`);
    for (const range of ranges) {
      const [start, end] = range.replace('bytes=', '').split('-').map(Number);
      expect(end - start + 1).toBeLessThanOrEqual(MIB);
    }
    // No read-ahead: opening reads the head and the cross-reference table at
    // the tail; page 50 adds only the chunk its content sits in.
    expect(atOpen).toBe(2);
    expect(ranges.length).toBeLessThan(Math.ceil(LARGE.length / MIB));
    expect(new Set(ranges).size).toBe(ranges.length);
  });
});

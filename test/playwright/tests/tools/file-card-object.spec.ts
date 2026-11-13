// The object a file card shows on its far side, built from the file itself.

import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const FILE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="file"]`;
const REMOTE = 'https://files.blok.test';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

interface FileFixture {
  url: string;
  fileName: string;
  size?: number;
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const createBlokWithFile = async (page: Page, file: FileFixture, config: Record<string, unknown> = {}): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, data, toolConfig }) => {
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
    const blok = new window.Blok({
      holder,
      tools: { file: { class: FileTool, config: toolConfig } },
      data: { blocks: [{ type: 'file', data }] },
    });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data: file, toolConfig: config });
};

/** Serves `body` for `path` on the remote host, with CORS, and counts the requests. */
const serve = async (page: Page, path: string, body: string | Buffer, contentType: string): Promise<{ count: number }> => {
  const seen = { count: 0 };
  await page.route(`${REMOTE}${path}`, (route) => {
    seen.count += 1;

    return route.fulfill({ status: 200, headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' }, body });
  });

  return seen;
};

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test.describe('file card object', () => {
  test('a code file shows an editor tab with the first lines the file really has', async ({ page }) => {
    await serve(page, '/main.ts', 'export const answer = 42;\nconsole.log(answer);\n', 'text/plain');
    await createBlokWithFile(page, { url: `${REMOTE}/main.ts`, fileName: 'main.ts', size: 2048 });
    const block = page.locator(FILE_BLOCK_SELECTOR);

    await expect(block.locator('[data-role="file-object"]')).toHaveAttribute('data-file-object', 'code');
    await expect(block.locator('[data-role="file-object-tab"]')).toHaveText('TSmain.ts');
    await expect(block.locator('[data-role="file-object-code"]')).toHaveText('export const answer = 42;\nconsole.log(answer);');
    await expect(block.locator('[data-role="file-object-line-numbers"]')).toHaveText('1\n2');
    await expect(block.locator('[data-role="file-size"]')).toHaveText('2 lines · 2 KB');
  });

  test('reads only the start of a long text file', async ({ page }) => {
    const long = Array.from({ length: 200_000 }, (_, i) => `line ${i}`).join('\n');
    await serve(page, '/big.txt', long, 'text/plain');
    await createBlokWithFile(page, { url: `${REMOTE}/big.txt`, fileName: 'big.txt' });
    const text = page.locator(FILE_BLOCK_SELECTOR).locator('[data-role="file-object-text"]');

    await expect(text).toContainText('line 0\nline 1\n');
    await expect(text).not.toContainText('line 100\n');
    // The file was not read to its end, so there is no line count to show.
    await expect(page.locator(FILE_BLOCK_SELECTOR).locator('[data-role="file-size"]')).toHaveCount(0);
  });

  test('a CSV shows its real cells with a selected cell', async ({ page }) => {
    await serve(page, '/people.csv', 'Name,Team,Total\nAda,Design,12\nGrace,Platform,7\n', 'text/csv');
    await createBlokWithFile(page, { url: `${REMOTE}/people.csv`, fileName: 'people.csv' });
    const block = page.locator(FILE_BLOCK_SELECTOR);
    const table = block.locator('[data-role="file-object-table"]');

    await expect(table.locator('[data-cell="head"]')).toHaveText(['Name', 'Team', 'Total', '']);
    await expect(table.locator('[data-cell="number"]')).toHaveText(['12', '7']);
    await expect(block.locator('[data-role="file-object-selection"]')).toBeVisible();
  });

  test('a file that cannot be read keeps the plain card', async ({ page }) => {
    const asked = { count: 0 };
    await page.route(`${REMOTE}/secret.ts`, (route) => {
      asked.count += 1;

      return route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'no' });
    });
    await createBlokWithFile(page, { url: `${REMOTE}/secret.ts`, fileName: 'secret.ts', size: 2048 });
    const block = page.locator(FILE_BLOCK_SELECTOR);

    await expect.poll(() => asked.count).toBeGreaterThan(0);
    await expect(block.locator('[data-role="file-object"]')).toHaveCount(0);
    await expect(block.locator('[data-role="file-card-wrapper"]')).not.toHaveAttribute('data-file-object');
    await expect(block.locator('[data-role="file-size"]')).toHaveText('2 KB');
  });

  test('an archive shows a folder at once, titled by the file', async ({ page }) => {
    await page.route(`${REMOTE}/brand-assets.zip`, (route) => route.fulfill({ status: 404, body: '' }));
    await createBlokWithFile(page, { url: `${REMOTE}/brand-assets.zip`, fileName: 'brand-assets.zip' });
    const block = page.locator(FILE_BLOCK_SELECTOR);

    await expect(block.locator('[data-role="file-object"]')).toHaveAttribute('data-file-object', 'archive');
    await expect(block.locator('[data-role="file-object-title"]')).toHaveText('Brand assets');
    await expect(block.locator('[data-role="file-object-folder-sheet"]')).toHaveCount(3);
  });

  test('the object lifts while the pointer is over the card and settles back after', async ({ page }) => {
    await page.route(`${REMOTE}/a.zip`, (route) => route.fulfill({ status: 404, body: '' }));
    await createBlokWithFile(page, { url: `${REMOTE}/a.zip`, fileName: 'a.zip' });
    const block = page.locator(FILE_BLOCK_SELECTOR);
    const stage = block.locator('[data-role="file-object"]');
    const lift = (): Promise<string> => stage.evaluate((el) => (el.lastElementChild as HTMLElement).style.getPropertyValue('--blok-file-y'));

    await block.locator('[data-role="file-card-wrapper"]').hover();
    await expect(stage).toHaveAttribute('data-hot', '');
    await expect.poll(lift).toBe('-12.00px');

    await page.mouse.move(0, 0);
    await expect(stage).not.toHaveAttribute('data-hot');
    await expect.poll(lift).toBe('0.00px');
  });

  test('the object stays inside the card and takes no clicks: the card still opens the preview', async ({ page }) => {
    await serve(page, '/main.ts', 'const a = 1;\n', 'text/plain');
    await createBlokWithFile(page, { url: `${REMOTE}/main.ts`, fileName: 'main.ts' });
    const block = page.locator(FILE_BLOCK_SELECTOR);
    const stage = block.locator('[data-role="file-object"]');
    await expect(stage).toBeVisible();

    const box = await stage.boundingBox();
    const card = await block.locator('[data-role="file-card-wrapper"]').boundingBox();
    expect(box).not.toBeNull();
    expect(card).not.toBeNull();
    expect(box?.height).toBeLessThanOrEqual(card?.height ?? 0);

    // A click where the object is drawn lands on the card behind it.
    const tab = await block.locator('[data-role="file-object-tab"]').boundingBox();
    await page.mouse.click((tab?.x ?? 0) + 4, (card?.y ?? 0) + (card?.height ?? 0) - 6);
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('cardPreview: false keeps the plain card and asks for nothing', async ({ page }) => {
    const seen = await serve(page, '/main.ts', 'const a = 1;\n', 'text/plain');
    await createBlokWithFile(page, { url: `${REMOTE}/main.ts`, fileName: 'main.ts' }, { cardPreview: false });
    const block = page.locator(FILE_BLOCK_SELECTOR);

    await expect(block.locator('[data-role="file-card-wrapper"]')).toBeVisible();
    await expect(block.locator('[data-role="file-object"]')).toHaveCount(0);
    expect(seen.count).toBe(0);
  });
});

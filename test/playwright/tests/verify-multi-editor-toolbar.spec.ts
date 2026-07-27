import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { expect, gotoTestPage, test } from './helpers/shared-page';

/**
 * A page hosting several editors must still show ONE set of block controls
 * (plus button + drag handle), exactly as if it hosted a single editor.
 *
 * Root cause that this guards: every Blok instance binds its own document-level
 * mousemove listener and resolved hover on its own. Hovering editor B left
 * editor A's toolbar open where it was, and a hover in the page background made
 * every editor open its own toolbar via nearest-block detection — so two or more
 * plus/drag pairs were visible at once.
 */

declare global {
  interface Window {
    tb1?: Blok;
    tb2?: Blok;
  }
}

const bootTwo = async (page: Page): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async () => {
    const mk = (id: string): HTMLElement => {
      document.getElementById(id)?.remove();
      const d = document.createElement('div');

      d.id = id;
      /** A wide gap keeps the two editors' hover zones clearly apart */
      d.style.margin = '0 0 300px';
      document.body.appendChild(d);

      return d;
    };

    mk('tbed1');
    const b1 = new window.Blok({ holder: 'tbed1', data: { blocks: [
      { type: 'paragraph', data: { text: 'alpha-one' } },
      { type: 'paragraph', data: { text: 'alpha-two' } },
    ] } });

    window.tb1 = b1;
    await b1.isReady;

    mk('tbed2');
    const b2 = new window.Blok({ holder: 'tbed2', data: { blocks: [
      { type: 'paragraph', data: { text: 'beta-one' } },
      { type: 'paragraph', data: { text: 'beta-two' } },
    ] } });

    window.tb2 = b2;
    await b2.isReady;
  });
};

/**
 * Number of editors on the page currently showing an open block toolbar.
 */
const editorsWithOpenToolbar = (page: Page): Promise<number> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-blok-editor]')]
      .filter(editor => editor.querySelector('[data-blok-testid="toolbar"][data-blok-opened]') !== null)
      .length);

/**
 * Move the pointer onto the given text, in two steps so the throttled
 * mousemove handler always sees a genuine move.
 */
const hoverText = async (page: Page, text: string): Promise<void> => {
  const target = page.getByText(text).first();

  await target.hover();
  const box = await target.boundingBox();

  if (box !== null) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 1);
  }
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('block controls across multiple editors on one page', () => {
  test('only the hovered editor shows its block controls', async ({ page }) => {
    await bootTwo(page);

    await hoverText(page, 'alpha-two');
    await expect.poll(() => editorsWithOpenToolbar(page)).toBe(1);

    await hoverText(page, 'beta-two');
    await expect.poll(() => editorsWithOpenToolbar(page)).toBe(1);

    await hoverText(page, 'alpha-one');
    await expect.poll(() => editorsWithOpenToolbar(page)).toBe(1);
  });

  test('the hovered editor is the one that owns the controls', async ({ page }) => {
    await bootTwo(page);

    await hoverText(page, 'beta-one');

    await expect.poll(() => page.evaluate(() => {
      const editors = [...document.querySelectorAll('[data-blok-editor]')];

      return editors.findIndex(editor =>
        editor.querySelector('[data-blok-testid="toolbar"][data-blok-opened]') !== null);
    })).toBe(1);
  });

  test('the gap between editors never lights up both', async ({ page }) => {
    await bootTwo(page);

    const first = await page.getByText('alpha-two').first().boundingBox();
    const second = await page.getByText('beta-one').first().boundingBox();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    if (first === null || second === null) {
      return;
    }

    const midY = (first.y + first.height + second.y) / 2;
    const x = first.x + first.width / 2;

    await page.mouse.move(x, midY);
    await page.mouse.move(x, midY + 1);

    await expect.poll(() => editorsWithOpenToolbar(page)).toBeLessThanOrEqual(1);
  });
});

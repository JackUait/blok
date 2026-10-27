import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Scroller = 'window' | 'container' | 'transformed';

const SCROLLERS: Scroller[] = ['window', 'container', 'transformed'];

/**
 * Page margin left of the editor: a mousedown here arms the lasso. The band
 * must then reach into the editor, because a band that stays in the margin
 * outside the editor selects nothing by design.
 */
const BAND_X = 12;

/** A client x inside the blocks' content column. */
const contentX = async (page: Page): Promise<number> => {
  const left = await page.evaluate(() => document.querySelector('[data-blok-testid="block-wrapper"]')?.getBoundingClientRect().left ?? 0);

  return left + 40;
};

/** Height of the inner scroller; the page itself never scrolls in that mode. */
const SCROLLER_HEIGHT = 420;
const SCROLLER_TOP = 80;

/**
 * Mount an editor of `count` paragraphs that scrolls with `mode`: the window,
 * an overflow:auto box, or that box under a transformed ancestor (which
 * re-anchors the lasso's fixed overlay).
 */
const mount = async (page: Page, mode: Scroller, count: number): Promise<void> => {
  await page.evaluate(async ({ mode: m, count: n, top, height }) => {
    const host = document.createElement('div');
    const holder = document.createElement('div');

    host.id = 'band-host';
    holder.id = 'blok';
    holder.style.maxWidth = '560px';
    holder.style.margin = '0 auto';

    if (m === 'window') {
      host.appendChild(holder);
    } else {
      document.documentElement.style.overflow = 'hidden';
      host.style.position = 'absolute';
      host.style.top = `${top}px`;
      host.style.left = '0';
      host.style.right = '0';
      host.style.height = `${height}px`;
      host.style.overflow = 'auto';
      host.setAttribute('data-blok-testid', 'band-scroller');
      host.appendChild(holder);

      if (m === 'transformed') {
        const frame = document.createElement('div');

        frame.style.transform = 'translateZ(0)';
        frame.appendChild(host);
        document.body.appendChild(frame);
      }
    }

    if (host.parentElement === null) {
      document.body.appendChild(host);
    }

    const blok = new window.Blok({
      holder: 'blok',
      data: {
        blocks: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, type: 'paragraph', data: { text: `Row ${i}` } })),
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { mode, count, top: SCROLLER_TOP, height: SCROLLER_HEIGHT });
};

/** Client y of a block's vertical centre. */
const centreY = async (page: Page, index: number): Promise<number> => {
  return page.evaluate((i) => {
    const holder = document.querySelectorAll('[data-blok-testid="block-wrapper"]')[i];
    const rect = holder.getBoundingClientRect();

    return rect.top + rect.height / 2;
  }, index);
};

/**
 * Index of the first row whose bottom is below client y: the top row of a band whose top
 * edge is at y. In the 1px gap between rows it is the row below the gap.
 */
const rowAt = async (page: Page, y: number): Promise<number> => {
  return page.evaluate((clientY) => {
    const holders = Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"]'));
    const hit = holders.findIndex((h) => h.getBoundingClientRect().bottom > clientY);

    return hit === -1 ? holders.length - 1 : hit;
  }, y);
};

/**
 * Index of the last row whose top is above client y: the bottom row of a band whose bottom
 * edge is at y. In the 1px gap between rows it is the row above the gap, as the lasso sees it.
 */
const lastRowAbove = async (page: Page, y: number): Promise<number> => {
  return page.evaluate((clientY) => {
    const holders = Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"]'));

    return holders.filter((h) => h.getBoundingClientRect().top < clientY).length - 1;
  }, y);
};

const selectedIndices = async (page: Page): Promise<number[]> => {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"]'))
    .flatMap((h, i) => (h.getAttribute('data-blok-selected') === 'true' ? [i] : [])));
};

const scrollOffset = async (page: Page, mode: Scroller): Promise<number> => {
  return page.evaluate((m) => {
    return m === 'window'
      ? window.scrollY
      : document.querySelector('[data-blok-testid="band-scroller"]')?.scrollTop ?? 0;
  }, mode);
};

/** Bottom edge of the visible scroll area, in client y. */
const visibleBottom = async (page: Page, mode: Scroller): Promise<number> => {
  return page.evaluate((m) => {
    return m === 'window'
      ? document.documentElement.clientHeight
      : document.querySelector('[data-blok-testid="band-scroller"]')?.getBoundingClientRect().bottom ?? 0;
  }, mode);
};

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test.describe('rubber band selection while the page scrolls', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test.afterEach(async ({ page }) => {
    await page.mouse.up().catch(() => undefined);
    await page.evaluate(() => {
      document.documentElement.style.overflow = '';
      window.scrollTo(0, 0);
    });
  });

  for (const mode of SCROLLERS) {
    test.describe(`scroller: ${mode}`, () => {
      test('a wheel scroll while the band is held selects every row the pointer now reaches', async ({ page }) => {
        await mount(page, mode, 60);

        const startY = await centreY(page, 1);

        await page.mouse.move(BAND_X, startY);
        await page.mouse.down();
        const pointerY = await centreY(page, 4);

        await page.mouse.move(await contentX(page), pointerY, { steps: 6 });
        await expect.poll(() => selectedIndices(page)).toEqual(range(1, 4));

        const before = await scrollOffset(page, mode);

        await page.mouse.wheel(0, 300);
        await expect.poll(() => scrollOffset(page, mode)).toBeGreaterThan(before + 200);

        // The pointer has not moved on screen; the content scrolled under it.
        const lastRow = await lastRowAbove(page, pointerY);

        await expect.poll(() => selectedIndices(page)).toEqual(range(1, lastRow));
        await page.mouse.up();

        expect(await selectedIndices(page)).toEqual(range(1, lastRow));
      });

      test('holding the band at the bottom edge auto-scrolls the scroller and keeps selecting', async ({ page }) => {
        await mount(page, mode, 60);

        const edgeY = await visibleBottom(page, mode) - 10;

        await page.mouse.move(BAND_X, await centreY(page, 1));
        await page.mouse.down();
        await page.mouse.move(await contentX(page), edgeY, { steps: 8 });

        await expect.poll(() => scrollOffset(page, mode), { timeout: 5000 }).toBeGreaterThan(400);

        await page.mouse.up();

        const lastRow = await lastRowAbove(page, edgeY);

        expect(await selectedIndices(page)).toEqual(range(1, lastRow));
      });

      test('a band released below the last block keeps every row it covers', async ({ page }) => {
        await mount(page, mode, 6);

        const lastBottom = await page.evaluate(() => {
          const holders = document.querySelectorAll('[data-blok-testid="block-wrapper"]');

          return holders[holders.length - 1].getBoundingClientRect().bottom;
        });

        await page.mouse.move(BAND_X, await centreY(page, 1));
        await page.mouse.down();
        await page.mouse.move(await contentX(page), lastBottom + 16, { steps: 1 });
        await page.mouse.up();

        expect(await selectedIndices(page)).toEqual(range(1, 5));
      });

      test('a band released in the gap between two rows stops at the row above it', async ({ page }) => {
        await mount(page, mode, 10);

        const gapY = await page.evaluate(() => {
          const holder = document.querySelectorAll('[data-blok-testid="block-wrapper"]')[4];

          return Math.ceil(holder.getBoundingClientRect().bottom);
        });

        await page.mouse.move(BAND_X, await centreY(page, 1));
        await page.mouse.down();
        await page.mouse.move(await contentX(page), gapY, { steps: 4 });
        await page.mouse.up();

        expect(await selectedIndices(page)).toEqual(range(1, await lastRowAbove(page, gapY)));
      });

      test('a quick drag released at once selects up to the release point', async ({ page }) => {
        await mount(page, mode, 30);

        const endY = await centreY(page, 9);

        await page.mouse.move(BAND_X, await centreY(page, 1));
        await page.mouse.down();
        await page.mouse.move(await contentX(page), await centreY(page, 3), { steps: 1 });
        await page.mouse.move(await contentX(page), endY, { steps: 1 });
        await page.mouse.up();

        expect(await selectedIndices(page)).toEqual(range(1, 9));
      });
    });
  }

  test('a band released under a fixed header keeps every row it auto-scrolled over', async ({ page }) => {
    await mount(page, 'window', 80);
    await page.evaluate(() => {
      const header = document.createElement('div');

      header.style.cssText = 'position:fixed;top:0;left:0;right:0;height:60px;background:#eee;z-index:10';
      document.getElementById('band-host')?.appendChild(header);
      window.scrollTo(0, 1500);
    });

    const startRow = await rowAt(page, 400);

    await page.mouse.move(BAND_X, await centreY(page, startRow));
    await page.mouse.down();
    await page.mouse.move(await contentX(page), 20, { steps: 8 });
    await expect.poll(() => scrollOffset(page, 'window'), { timeout: 5000 }).toBeLessThan(1100);
    await page.mouse.up();

    const topRow = await rowAt(page, 20);

    expect(await selectedIndices(page)).toEqual(range(topRow, startRow));
  });

  test('auto-scroll resumes after the pointer overshoots the bottom of the window and comes back', async ({ page }) => {
    await mount(page, 'window', 80);

    const viewport = await page.evaluate(() => document.documentElement.clientHeight);

    await page.mouse.move(BAND_X, await centreY(page, 1));
    await page.mouse.down();
    await page.mouse.move(await contentX(page), viewport - 10, { steps: 6 });
    await page.mouse.move(await contentX(page), viewport + 40, { steps: 2 });
    await page.mouse.move(await contentX(page), viewport - 10, { steps: 2 });

    const back = await scrollOffset(page, 'window');

    await expect.poll(() => scrollOffset(page, 'window'), { timeout: 5000 }).toBeGreaterThan(back + 300);
    await page.mouse.up();

    expect(await selectedIndices(page)).toEqual(range(1, await lastRowAbove(page, viewport - 10)));
  });

  test('auto-scroll speeds up while the band stays at the edge and starts slow again after leaving it', async ({ page }) => {
    await mount(page, 'window', 400);

    const viewport = await page.evaluate(() => document.documentElement.clientHeight);
    const x = await contentX(page);
    /** Pixels the window scrolls during the next half second. */
    const distance = (): Promise<number> => page.evaluate(async () => {
      const start = window.scrollY;

      await new Promise((done) => setTimeout(done, 500));

      return window.scrollY - start;
    });

    await page.mouse.move(BAND_X, await centreY(page, 1));
    await page.mouse.down();
    await page.mouse.move(x, viewport - 10, { steps: 6 });

    const early = await distance();

    await page.evaluate(() => new Promise((done) => setTimeout(done, 2000)));

    const late = await distance();

    // Out of the edge zone with the button still held, then back.
    await page.mouse.move(x, viewport / 2, { steps: 2 });
    await page.evaluate(() => new Promise((done) => setTimeout(done, 200)));
    await page.mouse.move(x, viewport - 10, { steps: 2 });

    const restarted = await distance();

    await page.mouse.up();

    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early * 2);
    expect(restarted).toBeLessThan(late / 2);
  });

  test('a band dragged past the bottom of a short page is still alive when it comes back', async ({ page }) => {
    await mount(page, 'window', 4);

    const bodyBottom = await page.evaluate(() => document.body.getBoundingClientRect().bottom);
    const viewport = await page.evaluate(() => document.documentElement.clientHeight);

    // The release point must lie below the body yet inside the window.
    expect(bodyBottom + 60).toBeLessThan(viewport - 50);

    await page.mouse.move(BAND_X, await centreY(page, 0));
    await page.mouse.down();
    await page.mouse.move(await contentX(page), bodyBottom + 60, { steps: 4 });
    await page.mouse.move(await contentX(page), await centreY(page, 2), { steps: 4 });
    await page.mouse.up();

    expect(await selectedIndices(page)).toEqual(range(0, 2));
  });
});

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const SCROLL_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-table-scroll]`;
const RIGHT_HAZE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-table-haze="right"]`;
const RESIZE_HANDLE_SELECTOR = '[data-blok-table-resize]';
const HAZE_VISIBLE_ATTR = 'data-blok-table-haze-visible';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, options: { data: OutputData; readOnly?: boolean }): Promise<void> => {
  const { data, readOnly = false } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, data: initialData, readOnly: isReadOnly }) => {
      const globalScope = window as unknown as Record<string, Record<string, unknown>>;
      const tableClass = globalScope.Blok?.Table;

      if (!tableClass) {
        throw new Error('Table tool is not available globally');
      }

      const blok = new window.Blok({
        holder,
        readOnly: isReadOnly,
        data: initialData,
        tools: {
          table: { class: tableClass as never },
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, data, readOnly }
  );

  await page.locator(SCROLL_SELECTOR).first().waitFor();
};

/** A 3-row table with `cols` columns in fluid (percent) mode — no colWidths. */
const fluidTable = (cols: number): OutputData => ({
  blocks: [
    {
      type: 'table',
      data: {
        withHeadings: false,
        content: Array.from({ length: 3 }, (_, r) =>
          Array.from({ length: cols }, (_, c) => `r${r}c${c}`)
        ),
      },
    },
  ],
});

type ScrollMetrics = {
  clientWidth: number;
  scrollWidth: number;
  overflowing: string[];
};

/**
 * Measure the scroll container and name every descendant whose right edge pokes
 * past the container's right edge. The list is what makes a failure actionable:
 * it names the element that inflated scrollWidth.
 */
const measureScroll = async (page: Page, selector: string): Promise<ScrollMetrics> =>
  page.evaluate((sel) => {
    const sc = document.querySelector(sel);

    if (!(sc instanceof HTMLElement)) {
      throw new Error('scroll container not found');
    }

    const scRight = sc.getBoundingClientRect().right + sc.scrollLeft;
    const overflowing = Array.from(sc.querySelectorAll<HTMLElement>('*'))
      .filter(el => el.getBoundingClientRect().right > scRight + 1)
      .map(el => `${el.tagName.toLowerCase()}${Array.from(el.attributes).map(a => `[${a.name}]`).join('')}`);

    return {
      clientWidth: sc.clientWidth,
      scrollWidth: sc.scrollWidth,
      overflowing,
    };
  }, selector);

test.describe('table horizontal overflow', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('a default table that fits its container does not scroll and shows no haze', async ({ page }) => {
    await createBlok(page, { data: fluidTable(3) });

    const metrics = await measureScroll(page, SCROLL_SELECTOR);

    expect(metrics.overflowing, 'no chrome element may poke past the scroll container').toEqual([]);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);

    await expect(page.locator(RIGHT_HAZE_SELECTOR)).not.toHaveAttribute(HAZE_VISIBLE_ATTR, '');
  });

  test('a table wider than its container still scrolls and shows the haze', async ({ page }) => {
    await createBlok(page, { data: fluidTable(20) });

    const metrics = await measureScroll(page, SCROLL_SELECTOR);

    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 1);

    await expect(page.locator(RIGHT_HAZE_SELECTOR)).toHaveAttribute(HAZE_VISIBLE_ATTR, '');
  });

  test('a read-only wide table still scrolls', async ({ page }) => {
    await createBlok(page, { data: fluidTable(20), readOnly: true });

    const metrics = await measureScroll(page, SCROLL_SELECTOR);

    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 1);
  });

  test('the last column resize handle stays grabbable at the grid right edge', async ({ page }) => {
    await createBlok(page, { data: fluidTable(3) });

    const handles = page.locator(`${SCROLL_SELECTOR} ${RESIZE_HANDLE_SELECTOR}`);

    await expect(handles).toHaveCount(3);

    const lastHandleBox = await handles.last().boundingBox();

    expect(lastHandleBox).not.toBeNull();

    // The grid is the scroll container's only child element.
    const gridRight = await page.evaluate((sel) => {
      const grid = document.querySelector(sel)?.firstElementChild;

      if (!(grid instanceof HTMLElement)) {
        throw new Error('grid not found');
      }

      return grid.getBoundingClientRect().right;
    }, SCROLL_SELECTOR);

    if (!lastHandleBox) {
      return;
    }

    const handleRight = lastHandleBox.x + lastHandleBox.width;

    // Must not poke out past the grid...
    expect(handleRight).toBeLessThanOrEqual(gridRight + 1);
    // ...but must still reach the grid's right border, or the last column could
    // never be dragged.
    expect(handleRight).toBeGreaterThanOrEqual(gridRight - 2);
  });
});

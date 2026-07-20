// test/playwright/tests/ui/content-max-width-honored.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * `--blok-content-max-width` is the documented public hook for the content
 * column cap, and `--max-width-content` is explicitly non-overridable
 * (tokens.css:1). Two consumers ignored the public token and read the private
 * default directly, so a host that narrowed the column got a layout that
 * disagreed with itself:
 *
 *   1. database.css centred stretched database/kanban blocks with
 *      `calc((100% - var(--max-width-content)) / 2)`, so database content stayed
 *      centred on the untouched 720px default while every other block honoured
 *      the override.
 *   2. The toolbar's stretched-block offset math (content-alignment.ts
 *      readMaxContentWidth) also read only the private token, so the floating
 *      +/⠿ controls were positioned against 720px regardless of the host cap.
 *
 * Source-grepping unit tests cannot catch either: both are about the value the
 * browser actually resolves. These drive the BUILT bundle and measure geometry.
 */

const HOLDER_ID = 'blok';
const HOLDER_WIDTH = 1400;
const NARROW_CAP = 500;
const DEFAULT_CAP = 720;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

const DATABASE_BLOCKS: OutputData['blocks'] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'New database',
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: {
            options: [
              { id: 'opt-backlog', label: 'Backlog', color: 'gray', position: 'a0' },
            ],
          },
        },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1', 'row-2'],
  } as unknown as OutputData['blocks'][number],
  {
    id: 'row-1',
    type: 'database-row',
    data: { position: 'a0', properties: { 'prop-title': 'Write documentation', 'prop-status': 'opt-backlog' } },
  } as unknown as OutputData['blocks'][number],
  {
    id: 'row-2',
    type: 'database-row',
    data: { position: 'a1', properties: { 'prop-title': 'Add dark mode support', 'prop-status': 'opt-backlog' } },
  } as unknown as OutputData['blocks'][number],
];

/**
 * Rebuilds the editor inside a holder wider than any cap, optionally setting the
 * public token on the holder. The holder must exceed the cap or the block never
 * stretches and the bug cannot manifest.
 */
const createWithCap = async (page: Page, cap: number | null): Promise<void> => {
  await page.evaluate(
    async ({ holder, width, contentCap }) => {
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }
      document.getElementById(holder)?.remove();

      const container = document.createElement('div');

      container.id = holder;
      container.style.width = `${width}px`;
      container.style.maxWidth = 'none';

      if (contentCap !== null) {
        container.style.setProperty('--blok-content-max-width', `${contentCap}px`);
      }
      document.body.appendChild(container);
    },
    { holder: HOLDER_ID, width: HOLDER_WIDTH, contentCap: cap }
  );

  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
        tools: {
          database: { class: window.BlokDatabase },
          'database-row': { class: window.BlokDatabaseRow },
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: DATABASE_BLOCKS }
  );
};

/**
 * Resolved centring padding of the database board, plus the width the `100%` in
 * `max(0px, calc((100% - cap) / 2))` resolves against.
 *
 * The board (not the title) is the element that carries the symmetric centring
 * padding in every view. `[data-blok-database-title]` deliberately has its
 * padding stripped in single-view mode — the offset moves to
 * `[data-blok-database-title-row][data-single-view]` — so measuring the title
 * yields a trivially-passing 0 regardless of the token.
 *
 * The board is block-level with no margins, so its own border-box width equals
 * the containing-block width that `100%` resolves against.
 */
const measureBoardCentring = async (page: Page): Promise<{ padding: number; basis: number }> => {
  const board = page.locator('[data-blok-database-board]').first();

  await board.waitFor({ state: 'attached' });

  return board.evaluate((el) => ({
    padding: parseFloat(getComputedStyle(el).paddingLeft),
    basis: el.getBoundingClientRect().width,
  }));
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('database centring follows --blok-content-max-width, not the private default', async ({ page }) => {
  await createWithCap(page, NARROW_CAP);

  const { padding, basis } = await measureBoardCentring(page);

  const expectedNarrow = Math.max(0, (basis - NARROW_CAP) / 2);
  const expectedDefault = Math.max(0, (basis - DEFAULT_CAP) / 2);

  // Guard that the two caps are actually distinguishable at this holder width,
  // so a trivially-zero padding cannot pass this test.
  expect(Math.abs(expectedNarrow - expectedDefault)).toBeGreaterThan(50);

  expect(padding).toBeGreaterThan(0);
  expect(Math.abs(padding - expectedNarrow)).toBeLessThan(2);
  expect(Math.abs(padding - expectedDefault)).toBeGreaterThan(50);
});

test('database centring still uses the 720px default when no token is set', async ({ page }) => {
  await createWithCap(page, null);

  const { padding, basis } = await measureBoardCentring(page);

  const expectedDefault = Math.max(0, (basis - DEFAULT_CAP) / 2);

  expect(expectedDefault).toBeGreaterThan(50);
  expect(padding).toBeGreaterThan(0);
  expect(Math.abs(padding - expectedDefault)).toBeLessThan(2);
});

test('toolbar controls follow --blok-content-max-width for stretched blocks', async ({ page }) => {
  await createWithCap(page, NARROW_CAP);

  const databaseBlock = page.locator('[data-blok-id="db-1"]');

  await databaseBlock.waitFor({ state: 'visible' });
  await databaseBlock.hover();

  const plusButton = page.locator('[data-blok-testid="plus-button"]');

  await expect(plusButton).toBeVisible();

  const { plusRight, laneLeftNarrow, laneLeftDefault } = await page.evaluate(
    ({ narrow, wide }) => {
      const wrapper = document.querySelector<HTMLElement>('[data-blok-redactor]');
      const plus = document.querySelector<HTMLElement>('[data-blok-testid="plus-button"]');

      if (wrapper === null || plus === null) {
        throw new Error('wrapper or plus button not found');
      }

      const wrapperRect = wrapper.getBoundingClientRect();

      return {
        plusRight: plus.getBoundingClientRect().right,
        laneLeftNarrow: wrapperRect.left + (wrapperRect.width - narrow) / 2,
        laneLeftDefault: wrapperRect.left + (wrapperRect.width - wide) / 2,
      };
    },
    { narrow: NARROW_CAP, wide: DEFAULT_CAP }
  );

  /*
   * The plus button sits in the gutter immediately left of the content lane, so
   * its right edge tracks the lane's left edge. Assert it is nearer the narrow
   * lane than the default one — reading the private token put it ~110px away.
   */
  const distanceToNarrow = Math.abs(plusRight - laneLeftNarrow);
  const distanceToDefault = Math.abs(plusRight - laneLeftDefault);

  expect(distanceToNarrow).toBeLessThan(distanceToDefault);
  expect(distanceToNarrow).toBeLessThan(60);
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

const HOLDER_ID = 'blok';

const resetAndCreate = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    /*
     * Force a holder wider than --max-width-content (720px) so the database's
     * stretched wrapper actually stretches — otherwise holder.width === content
     * lane width and the misalignment bug cannot manifest.
     */
    container.style.width = '1400px';
    container.style.maxWidth = 'none';
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });

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
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

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

test.describe('Toolbar position for stretched blocks (database)', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('database block: toolbar aligns with the visible content lane, not the far-left holder edge', async ({ page }) => {
    await resetAndCreate(page, DATABASE_BLOCKS);

    /*
     * Hover the database block to open the toolbar.
     */
    const databaseBlock = page.locator('[data-blok-id="db-1"]');

    await databaseBlock.waitFor({ state: 'visible' });
    await databaseBlock.hover();

    const plusButton = page.locator('[data-blok-testid="plus-button"]');

    await expect(plusButton).toBeVisible();

    const measurement = await page.evaluate(() => {
      const block = document.querySelector<HTMLElement>('[data-blok-id="db-1"]');

      if (block === null) {
        throw new Error('Database block not found');
      }

      const titleEl = block.querySelector<HTMLElement>('[data-blok-database-title]');

      if (titleEl === null) {
        throw new Error('Database title element not found');
      }

      const plusBtn = document.querySelector<HTMLElement>('[data-blok-testid="plus-button"]');

      if (plusBtn === null) {
        throw new Error('Plus button not found');
      }

      /*
       * Visible content lane left edge inside the database title element.
       * The title element is full-width (inside the stretched wrapper) but
       * centers its text with padding-left. So the visible text begins at
       * titleRect.left + paddingLeft.
       */
      const titleRect = titleEl.getBoundingClientRect();
      const titlePaddingLeft = parseFloat(getComputedStyle(titleEl).paddingLeft) || 0;
      const visibleContentLeft = titleRect.left + titlePaddingLeft;

      return {
        holder: block.getBoundingClientRect(),
        visibleContentLeft,
        plus: plusBtn.getBoundingClientRect(),
      };
    });

    console.log(
      `[database toolbar] holder=${measurement.holder.left.toFixed(1)}..${measurement.holder.right.toFixed(1)} `
      + `visibleContent.left=${measurement.visibleContentLeft.toFixed(1)} `
      + `plus.left=${measurement.plus.left.toFixed(1)} plus.right=${measurement.plus.right.toFixed(1)}`
    );

    /*
     * Sanity check: the fixture must actually stretch the database so
     * holder.width > visibleContentLeft - holder.left (otherwise the bug
     * cannot manifest and the test would false-pass).
     */
    expect(
      measurement.visibleContentLeft - measurement.holder.left,
      'fixture invalid: database is not stretched; content is not offset from holder left'
    ).toBeGreaterThan(50);

    /*
     * CRITICAL: the plus button (and by extension the drag handle to its
     * right) must sit just left of the visible database content, not
     * hundreds of pixels away at the holder's far-left edge.
     *
     * Expected layout: [plus][drag-handle][  visible database content ]
     * So plus.right should be within ~60px of visibleContentLeft.
     */
    expect(
      Math.abs(measurement.plus.right - measurement.visibleContentLeft),
      `plus.right=${measurement.plus.right.toFixed(1)} should sit next to `
      + `visibleContentLeft=${measurement.visibleContentLeft.toFixed(1)} `
      + `(holder.left=${measurement.holder.left.toFixed(1)})`
    ).toBeLessThanOrEqual(80);

    /*
     * Additional guard: plus button must NOT be flush at holder's far-left
     * edge when holder is much wider than the content lane.
     */
    expect(
      measurement.plus.left - measurement.holder.left,
      'plus button snapped to holder far-left edge — toolbar not aligned with content lane'
    ).toBeGreaterThan(50);
  });
});

/*
 * Generic invariant: Block.stretched is a public BlockAPI property, so any
 * consumer (built-in tool, third-party tool, test code) can flip it on. The
 * toolbar must stay aligned with the editor's canonical content column for
 * ANY stretched block, not just the database. These tests stretch plain
 * blocks via the public API to lock the invariant in.
 *
 * Without the content-alignment fix (computeVisualContentOffset), flipping
 * stretched on a paragraph would collapse `contentRect.left` onto
 * `holderRect.left`, snapping the toolbar plus/drag-handle to the far-left
 * edge of a wide holder. These tests fail fast if that regression returns.
 */

type StretchableCase = {
  name: string;
  id: string;
  blocks: OutputData['blocks'];
  focusSelector: string;
};

const STRETCHABLE_CASES: ReadonlyArray<StretchableCase> = [
  {
    name: 'paragraph',
    id: 'stretch-para',
    blocks: [
      { id: 'stretch-para', type: 'paragraph', data: { text: 'Stretched paragraph content' } },
    ],
    focusSelector: '[data-blok-id="stretch-para"] [contenteditable="true"]',
  },
  {
    name: 'header',
    id: 'stretch-header',
    blocks: [
      { id: 'stretch-header', type: 'header', data: { text: 'Stretched heading', level: 2 } },
    ],
    focusSelector: '[data-blok-id="stretch-header"] [contenteditable="true"]',
  },
  {
    name: 'quote',
    id: 'stretch-quote',
    blocks: [
      { id: 'stretch-quote', type: 'quote', data: { text: 'Stretched quote', size: 'default' } },
    ],
    focusSelector: '[data-blok-id="stretch-quote"] [contenteditable="true"]',
  },
];

test.describe('Toolbar position invariant: any stretched block aligns with the content lane', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  for (const scenario of STRETCHABLE_CASES) {
    test(`${scenario.name}: toolbar plus button aligns with --max-width-content lane when stretched`, async ({ page }) => {
      await resetAndCreate(page, scenario.blocks);

      /*
       * Flip stretched on via the public BlockAPI — mirrors what a custom
       * third-party tool would do in its `rendered()` hook.
       */
      await page.evaluate(() => {
        const instance = window.blokInstance;

        if (instance === undefined) {
          throw new Error('blokInstance missing');
        }

        const firstBlock = instance.blocks.getBlockByIndex(0);

        if (firstBlock === undefined) {
          throw new Error('first block missing');
        }

        firstBlock.stretched = true;
      });

      const editable = page.locator(scenario.focusSelector).first();

      await editable.click();

      const plusButton = page.locator('[data-blok-testid="plus-button"]');

      await expect(plusButton).toBeVisible();

      const measurement = await page.evaluate(({ blockId }) => {
        const block = document.querySelector<HTMLElement>(`[data-blok-id="${blockId}"]`);

        if (block === null) {
          throw new Error('block not found');
        }

        const contentEl = block.querySelector<HTMLElement>('[data-blok-element-content]');

        if (contentEl === null) {
          throw new Error('content element not found');
        }

        const plusBtn = document.querySelector<HTMLElement>('[data-blok-testid="plus-button"]');

        if (plusBtn === null) {
          throw new Error('plus button not found');
        }

        const maxContentRaw = getComputedStyle(block).getPropertyValue('--max-width-content').trim();
        const maxContent = parseFloat(maxContentRaw);

        return {
          holder: block.getBoundingClientRect(),
          content: contentEl.getBoundingClientRect(),
          plus: plusBtn.getBoundingClientRect(),
          stretched: block.getAttribute('data-blok-stretched'),
          maxContent,
        };
      }, { blockId: scenario.id });

      console.log(
        `[${scenario.name}] stretched=${measurement.stretched} holder=${measurement.holder.left.toFixed(1)}..${measurement.holder.right.toFixed(1)} `
        + `content=${measurement.content.left.toFixed(1)}..${measurement.content.right.toFixed(1)} `
        + `plus=${measurement.plus.left.toFixed(1)}..${measurement.plus.right.toFixed(1)} `
        + `maxContent=${measurement.maxContent}`
      );

      /*
       * Sanity: stretched must actually apply (data attribute + max-w-none),
       * otherwise the invariant we are testing doesn't hold.
       */
      expect(measurement.stretched, 'block.stretched = true must set data-blok-stretched').toBe('true');

      /*
       * Expected content-lane left edge: (holder.width - --max-width-content) / 2
       * from holder.left. Toolbar plus-button right edge must land inside this
       * region (within ~80px to account for actions-bar width + padding), NOT
       * at holder.left=0 which is what the old buggy code produced.
       */
      const expectedLaneLeft = measurement.holder.left + (measurement.holder.width - measurement.maxContent) / 2;

      expect(
        measurement.plus.left - measurement.holder.left,
        `[${scenario.name}] plus button snapped to holder far-left edge — stretched toolbar regression`
      ).toBeGreaterThan(50);

      expect(
        Math.abs(measurement.plus.right - expectedLaneLeft),
        `[${scenario.name}] plus.right=${measurement.plus.right.toFixed(1)} must land `
        + `near content-lane left edge ${expectedLaneLeft.toFixed(1)}`
      ).toBeLessThanOrEqual(80);
    });
  }
});

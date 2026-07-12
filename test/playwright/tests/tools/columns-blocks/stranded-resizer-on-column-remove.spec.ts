import { expect, test } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  createBlok,
} from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

/**
 * Reveal a LEAF block's own drag handle by hovering its holder (keyed by
 * data-blok-id, never text). Mirrors grabLeafHandle in the sibling specs.
 */
const grabLeafHandle = async (page: Page, blockId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${blockId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for leaf block ${blockId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const handle = page.locator(SETTINGS_BUTTON);

  await expect(handle).toBeVisible();

  return handle;
};

/** Drop `sourceHandle` on the bottom reorder edge of the root "Top root" block. */
const dragOutToRoot = async (page: Page, sourceHandle: Locator): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await page
    .getByTestId('block-wrapper')
    .filter({ hasText: 'Top root' })
    .boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('missing bounding box for drag-out-to-root');
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 1, { steps: 18 });

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );

  await page.mouse.up();

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true',
    { timeout: 2000 }
  );

  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
};

/**
 * Report the column_list's live child layout: for each direct child, whether it
 * is a resize separator or a column, in DOM order. Proves the separators are
 * rebuilt (one BETWEEN each adjacent column pair, never leading/trailing).
 */
const columnRowLayout = async (page: Page): Promise<Array<'resizer' | 'column'>> => {
  return await page.evaluate(() => {
    const row = document.querySelector('[data-blok-columns]');

    if (!(row instanceof HTMLElement)) {
      return [];
    }

    return Array.from(row.children).map((child) =>
      child.hasAttribute('data-blok-column-resizer') ? 'resizer' : 'column'
    );
  });
};

/**
 * Three-column layout. The FIRST column (c0) holds a single "subject" block; the
 * other two hold keepers. A root "Top root" paragraph is the drag-out target.
 * Dragging the subject out empties c0, which then deletes itself — leaving TWO
 * columns that must be re-separated by exactly ONE resizer between them.
 */
const threeColumnFixture = (): OutputData => ({
  blocks: [
    { id: 'top', type: 'paragraph', data: { text: 'Top root' } },
    { id: 'cl1', type: 'column_list', data: {}, content: ['c0', 'c1', 'c2'] },
    { id: 'c0', type: 'column', data: {}, parent: 'cl1', content: ['subject'] },
    { id: 'subject', type: 'paragraph', data: { text: 'Drag me out' }, parent: 'c0' },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['k1'] },
    { id: 'k1', type: 'paragraph', data: { text: 'Middle keeper' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['k2'] },
    { id: 'k2', type: 'paragraph', data: { text: 'Right keeper' }, parent: 'c2' },
  ],
});

test.beforeAll(async () => {
  await ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

/**
 * Regression: emptying and removing the LEFTMOST column of a 3-column list must
 * rebuild the resize separators. The bug left the separator that sat between the
 * removed column and its neighbour behind as a LEADING separator — a stray
 * full-height gutter bar at the far-left margin that pushed the columns right and
 * read as a phantom extra column.
 */
test('removing the leftmost column rebuilds separators (no stranded leading resizer)', async ({ page }) => {
  await createBlok(page, threeColumnFixture());

  // Sanity: 3 columns, 2 separators, laid out column/resizer/column/resizer/column.
  expect(await columnRowLayout(page)).toEqual([
    'column',
    'resizer',
    'column',
    'resizer',
    'column',
  ]);

  const handle = await grabLeafHandle(page, 'subject');

  await dragOutToRoot(page, handle);

  // c0 emptied and deleted itself → 2 columns remain, separated by exactly ONE
  // resizer BETWEEN them. Crucially, the row must NOT start with a resizer.
  await expect
    .poll(async () => columnRowLayout(page))
    .toEqual(['column', 'resizer', 'column']);

  // No resize separator may sit at the far-left margin (a leading/stranded one).
  const firstChildIsColumn = await page.evaluate(() => {
    const row = document.querySelector('[data-blok-columns]');
    const first = row?.firstElementChild;

    return first instanceof HTMLElement && !first.hasAttribute('data-blok-column-resizer');
  });

  expect(firstChildIsColumn).toBe(true);
});

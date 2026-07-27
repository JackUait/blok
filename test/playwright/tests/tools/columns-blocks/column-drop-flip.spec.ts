import type { Page, Locator } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import { ensureBlokBundleBuilt, createBlok } from './_helpers';

const BLOK = '[data-blok-interface=blok]';
const SETTINGS_BUTTON = `${BLOK} [data-blok-testid="settings-toggler"]`;

/**
 * A document tall enough that the drop point has real content underneath, and
 * whose dropped block is a heading — narrow columns wrap heading text into
 * several lines, which is what made the row transiently tall.
 */
const fixture = (): OutputData => ({
  blocks: [
    { id: 'lead', type: 'paragraph', data: { text: 'A lead paragraph above the drop point.' } },
    { id: 'sub', type: 'header', data: { text: 'A sub-heading that wraps when its column is narrow', level: 4 } },
    { id: 'target', type: 'paragraph', data: { text: 'A second paragraph — the editor keeps inline marks on save/reload.' } },
    { id: 'below1', type: 'paragraph', data: { text: 'First block below the drop point' } },
    { id: 'below2', type: 'paragraph', data: { text: 'Second block below the drop point' } },
    { id: 'below3', type: 'paragraph', data: { text: 'Third block below the drop point' } },
  ] as OutputData['blocks'],
});

/** Reveal a leaf block's drag handle by hovering its holder. */
const grabLeafHandle = async (page: Page, blockId: string): Promise<Locator> => {
  const holder = page.locator(`[data-blok-id="${blockId}"]`).first();
  const box = await holder.boundingBox();

  if (!box) {
    throw new Error(`missing bounding box for ${blockId}`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const handle = page.locator(SETTINGS_BUTTON);

  await expect(handle).toBeVisible();

  return handle;
};

/** Drag `sourceHandle` onto the right edge of `targetId`, stopping at mouseup. */
const sideDrop = async (page: Page, sourceHandle: Locator, targetId: string): Promise<void> => {
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await page
    .locator(`[data-blok-id="${targetId}"] [data-blok-element-content]`)
    .first()
    .boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('missing bounding box for side drop');
  }

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width - 4, targetBox.y + targetBox.height / 2, { steps: 15 });

  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );

  await page.mouse.up();
};

const visualTops = async (page: Page, ids: string[]): Promise<Record<string, number>> =>
  await page.evaluate(
    blockIds =>
      Object.fromEntries(
        blockIds.map(id => [
          id,
          Math.round(document.querySelector(`[data-blok-id="${id}"]`)?.getBoundingClientRect().top ?? NaN),
        ])
      ),
    ids
  );

test.beforeAll(async () => {
  await ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

const BELOW = ['below1', 'below2', 'below3'];

test.describe('column drop — FLIP of the blocks below', () => {
  test('the first animation frame shows them at their pre-drop positions, not ~200px away', async ({ page }) => {
    await createBlok(page, fixture());

    const before = await visualTops(page, BELOW);
    const handle = await grabLeafHandle(page, 'sub');

    await sideDrop(page, handle, 'target');

    // FLIP's contract: on the frame the transition starts, each moved block is
    // still painted at its OLD position. Reading the rect picks up the pinned
    // transform, so this is the block's on-screen position.
    const firstFrame = await page.evaluate(
      blockIds =>
        new Promise<Record<string, number>>(resolve => {
          requestAnimationFrame(() => {
            resolve(
              Object.fromEntries(
                blockIds.map(id => [
                  id,
                  Math.round(
                    document.querySelector(`[data-blok-id="${id}"]`)?.getBoundingClientRect().top ?? NaN
                  ),
                ])
              )
            );
          });
        }),
      BELOW
    );

    for (const id of BELOW) {
      expect(Math.abs(firstFrame[id] - before[id]), `${id} start-of-animation position`).toBeLessThanOrEqual(4);
    }
  });

  test('the columns row never grows past its settled height while the widths interpolate', async ({ page }) => {
    await createBlok(page, fixture());

    const handle = await grabLeafHandle(page, 'sub');

    await sideDrop(page, handle, 'target');

    // Sample the new row's height across the whole 200ms interpolation.
    const heights = await page.evaluate(
      () =>
        new Promise<number[]>(resolve => {
          const samples: number[] = [];
          const row = document.querySelector('[data-blok-columns]');
          const start = performance.now();

          const sample = (): void => {
            if (row !== null) {
              samples.push(Math.round(row.getBoundingClientRect().height));
            }
            if (performance.now() - start < 500) {
              requestAnimationFrame(sample);
            } else {
              resolve(samples);
            }
          };

          requestAnimationFrame(sample);
        })
    );

    const settled = heights[heights.length - 1];

    expect(Math.max(...heights), 'peak row height during the interpolation').toBeLessThanOrEqual(settled + 4);
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Regression guard for the CLASS of bug fixed for table cells in
 * table-cell-multiline-selection.spec.ts: every nesting tool renders its
 * children as separate contenteditable blocks inside a
 * [data-blok-nested-blocks] container, so the browser cannot extend a native
 * text selection across the "lines" — CrossBlockSelection must select the
 * child-block range instead. These tests pin that behavior for the other
 * nested-blocks containers: callout, toggle, and column.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';

const assertBoundingBox = (box: { x: number; y: number; width: number; height: number } | null, label: string): { x: number; y: number; width: number; height: number } => {
  expect(box, `${label} should have a bounding box`).toBeTruthy();

  return box as { x: number; y: number; width: number; height: number };
};

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

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, data: initialData });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data }
  );
};

/**
 * Drag the mouse from the center of one locator to the center of another.
 */
const dragBetween = async (page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>): Promise<void> => {
  const fromBox = assertBoundingBox(await from.boundingBox(), 'drag start');
  const toBox = assertBoundingBox(await to.boundingBox(), 'drag end');

  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 12 });
  await page.mouse.up();
};

const lineLocator = (page: Page, text: string): ReturnType<Page['locator']> =>
  page.locator('[data-blok-component="paragraph"]', { hasText: text });

test.describe('nested containers — selecting several lines inside one container', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.afterEach(async ({ page }) => {
    await resetBlok(page);
  });

  test('dragging across lines inside a callout selects the line blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'ca1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['p1', 'p2', 'p3'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'ca1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'ca1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Line three' }, parent: 'ca1' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const lineTwo = lineLocator(page, 'Line two');

    await expect(lineOne).toBeVisible();

    await dragBetween(page, lineOne, lineTwo);

    await expect(lineOne).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineTwo).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineLocator(page, 'Line three')).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(page.locator('[data-blok-component="callout"]')).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('dragging across lines inside an open toggle selects the line blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 't1', type: 'toggle', data: { text: 'My toggle', isOpen: true }, content: ['p1', 'p2', 'p3'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 't1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 't1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Line three' }, parent: 't1' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const lineTwo = lineLocator(page, 'Line two');

    await expect(lineOne).toBeVisible();

    await dragBetween(page, lineOne, lineTwo);

    await expect(lineOne).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineTwo).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineLocator(page, 'Line three')).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('dragging across lines inside one column selects the line blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1', 'p2', 'p3'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'c1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'c1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Line three' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right block' }, parent: 'c2' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const lineTwo = lineLocator(page, 'Line two');

    await expect(lineOne).toBeVisible();

    await dragBetween(page, lineOne, lineTwo);

    await expect(lineOne).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineTwo).toHaveAttribute('data-blok-selected', 'true');
    await expect(lineLocator(page, 'Line three')).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(lineLocator(page, 'Right block')).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('dragging from one column into another does not leave line blocks selected', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1', 'p2'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'c1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right block' }, parent: 'c2' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const rightBlock = lineLocator(page, 'Right block');

    await expect(lineOne).toBeVisible();

    await dragBetween(page, lineOne, rightBlock);

    // Intra-column line selection must not linger after the drag left the column
    await expect(page.locator('[data-blok-component="paragraph"][data-blok-selected="true"]')).toHaveCount(0);
  });

  test('pressing Delete removes the selected callout lines but keeps the callout', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'ca1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['p1', 'p2', 'p3'] },
        { id: 'p1', type: 'paragraph', data: { text: 'Line one' }, parent: 'ca1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Line two' }, parent: 'ca1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Line three' }, parent: 'ca1' },
      ],
    });

    const lineOne = lineLocator(page, 'Line one');
    const lineTwo = lineLocator(page, 'Line two');

    await expect(lineOne).toBeVisible();

    await dragBetween(page, lineOne, lineTwo);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(2);

    await page.keyboard.press('Delete');

    const callout = page.locator('[data-blok-component="callout"]');

    await expect(callout).toBeVisible();
    await expect(callout).toContainText('Line three');
    await expect(callout).not.toContainText('Line one');
  });
});

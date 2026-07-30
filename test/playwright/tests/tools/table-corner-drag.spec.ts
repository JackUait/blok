/**
 * Regression coverage for the table's bottom-right corner-drag resize.
 *
 * Two of the defects this locks down only bite at integration level, which is
 * why unit tests missed them for so long:
 *
 *   1. A caret click in any cell used to leave the handle at
 *      `pointer-events: none` until the user clicked outside the table, because
 *      the single-cell caret box was reported as an active selection. The
 *      ordinary "type in the table, then resize it" path was dead.
 *   2. A drag that added N rows produced N undo entries, because block
 *      operations call stopCapturing() per operation and the 500ms Yjs
 *      captureTimeout does not merge them.
 *
 * The remaining tests cover discoverability: the corner is unpainted, so the
 * hover tooltip is the only thing that names the gesture.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { TOOLTIP_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const CORNER_HANDLE_SELECTOR = '[data-blok-table-corner-drag]';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

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

  await page.evaluate(async ({ holder, initialData }) => {
    const blok = new window.Blok({
      holder,
      data: initialData,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const rowCount = (page: Page): Promise<number> =>
  page.locator('[data-blok-table-row]').count();

/** Drag the corner handle by (dx, dy) from its centre. */
const dragCorner = async (page: Page, dx: number, dy: number): Promise<void> => {
  const handle = page.locator(CORNER_HANDLE_SELECTOR);
  const box = await handle.boundingBox();

  if (box === null) {
    throw new Error('corner handle has no bounding box');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 10 });
  await page.mouse.up();
};

test.describe('Table corner drag resize', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page, {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['Alpha', 'Beta'], ['Gamma', 'Delta'], ['Epsilon', 'Zeta']],
          },
        },
        { type: 'paragraph', data: { text: 'AFTER' } },
      ],
    });
  });

  test('resizes after the caret has been placed in a cell', async ({ page }) => {
    const before = await rowCount(page);

    await page.locator('[data-blok-table-cell]').first().click();
    await page.keyboard.type('hello');

    await dragCorner(page, 0, 120);

    await expect.poll(() => rowCount(page)).toBeGreaterThan(before);
  });

  test('reverts a whole drag with a single undo', async ({ page }) => {
    const before = await rowCount(page);

    await dragCorner(page, 0, 120);

    await expect.poll(() => rowCount(page)).toBeGreaterThan(before);

    await page.locator('[data-blok-table-cell]').first().click();
    await page.keyboard.press(UNDO_SHORTCUT);

    await expect.poll(() => rowCount(page)).toBe(before);
  });

  test('teaches the gesture with a tooltip when the corner is hovered', async ({ page }) => {
    const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

    await expect(tooltip).toBeHidden();

    await page.locator(CORNER_HANDLE_SELECTOR).hover();

    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('Drag to add or remove rows/columns');
  });

  test('paints no mark at the corner', async ({ page }) => {
    await expect(page.getByTestId('table-corner-grip')).toHaveCount(0);
  });
});

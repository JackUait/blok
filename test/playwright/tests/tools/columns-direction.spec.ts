import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Columns follow reading order: the first column sits at the inline start
 * (left in LTR, right in RTL). Every scenario runs in both directions and is
 * phrased as "start"/"end"; `physical()` maps that to the screen.
 */

type Direction = 'ltr' | 'rtl';
type LogicalSide = 'start' | 'end';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const physical = (side: LogicalSide, dir: Direction): 'left' | 'right' =>
  (side === 'start') === (dir === 'ltr') ? 'left' : 'right';

const createBlok = async (page: Page, dir: Direction, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData, direction }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: initialData, i18n: { direction } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data, direction: dir });
};

const saveBlok = async (page: Page): Promise<OutputData> =>
  await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });

/** Grab the drag handle of the block that shows `text`. */
const handleOf = async (page: Page, text: string): Promise<{ x: number; y: number }> => {
  await page.getByTestId('block-wrapper').filter({ hasText: text }).last().hover();
  const handle = page.locator(SETTINGS_BUTTON);

  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();

  if (!box) {
    throw new Error('missing drag handle box');
  }

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const startDrag = async (page: Page, from: { x: number; y: number }, x: number, y: number): Promise<void> => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 15 });
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );
};

const finishDrag = async (page: Page): Promise<void> => {
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

/** Drag the block showing `sourceText` onto a physical edge of the block showing `targetText`. */
const dropOnEdge = async (
  page: Page,
  sourceText: string,
  targetText: string,
  side: 'left' | 'right'
): Promise<void> => {
  const from = await handleOf(page, sourceText);
  const box = await page.getByTestId('block-wrapper').filter({ hasText: targetText }).last()
    .locator('[data-blok-element-content]').first().boundingBox();

  if (!box) {
    throw new Error('missing target box');
  }

  const x = side === 'right' ? box.x + box.width - 4 : box.x + 4;

  await startDrag(page, from, x, box.y + box.height / 2);
  await finishDrag(page);
};

/** Drag the block showing `sourceText` into the editor margin beside the column row. */
const dropInMargin = async (page: Page, sourceText: string, side: 'left' | 'right'): Promise<void> => {
  const from = await handleOf(page, sourceText);
  const holderBox = await page.locator('[data-blok-element]:has([data-blok-columns])').first().boundingBox();
  const rowBox = await page.getByTestId('column-list').boundingBox();

  if (!holderBox || !rowBox) {
    throw new Error('missing row box');
  }

  const x = side === 'left' ? holderBox.x + 6 : holderBox.x + holderBox.width - 6;

  await startDrag(page, from, x, rowBox.y + rowBox.height / 2);
  await finishDrag(page);
};

/** Column texts in physical order, left to right. */
const columnsLeftToRight = async (page: Page): Promise<string[]> =>
  await page.evaluate(() => {
    const row = document.querySelector('[data-blok-columns]');

    if (!row) {
      return [];
    }

    return Array.from(row.children)
      .filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-blok-element]'))
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .map(el => (el.textContent ?? '').trim());
  });

/** Column texts in saved (reading) order. */
const savedColumnTexts = (saved: OutputData): string[] =>
  saved.blocks
    .filter(block => block.type === 'column')
    .map(column => saved.blocks
      .filter(block => block.parent === column.id)
      .map(block => String((block.data as { text?: string }).text ?? ''))
      .join(' '));

const inStartOrder = (leftToRight: string[], dir: Direction): string[] =>
  dir === 'ltr' ? leftToRight : [...leftToRight].reverse();

const twoColumns = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['a'] },
    { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['b'] },
    { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
    { id: 'n', type: 'paragraph', data: { text: 'Newcomer' } },
  ],
});

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

for (const dir of ['ltr', 'rtl'] as const) {
  test.describe(`Columns in ${dir}`, () => {
    test.beforeEach(async ({ page }) => {
      await gotoTestPage(page);
      await page.waitForFunction(() => typeof window.Blok === 'function');
      await page.setViewportSize({ width: 1024, height: 800 });
    });

    for (const side of ['start', 'end'] as const) {
      test(`dropping on the inline-${side} edge of a block puts the new column at the ${side}`, async ({ page }) => {
        await createBlok(page, dir, {
          blocks: [
            { id: 't', type: 'paragraph', data: { text: 'Target' } },
            { id: 's', type: 'paragraph', data: { text: 'Dragged' } },
          ],
        });

        await dropOnEdge(page, 'Dragged', 'Target', physical(side, dir));

        const expected = side === 'start' ? ['Dragged', 'Target'] : ['Target', 'Dragged'];

        expect(savedColumnTexts(await saveBlok(page))).toEqual(expected);
        expect(inStartOrder(await columnsLeftToRight(page), dir)).toEqual(expected);
      });
    }

    test('the outer inline-start edge of the first column prepends a column', async ({ page }) => {
      await createBlok(page, dir, twoColumns());

      await dropOnEdge(page, 'Newcomer', 'Col A', physical('start', dir));

      const expected = ['Newcomer', 'Col A', 'Col B'];

      expect(savedColumnTexts(await saveBlok(page))).toEqual(expected);
      expect(inStartOrder(await columnsLeftToRight(page), dir)).toEqual(expected);
    });

    test('the outer inline-end edge of the last column appends a column', async ({ page }) => {
      await createBlok(page, dir, twoColumns());

      await dropOnEdge(page, 'Newcomer', 'Col B', physical('end', dir));

      const expected = ['Col A', 'Col B', 'Newcomer'];

      expect(savedColumnTexts(await saveBlok(page))).toEqual(expected);
      expect(inStartOrder(await columnsLeftToRight(page), dir)).toEqual(expected);
    });

    test('the inner edge of the first column stacks into it', async ({ page }) => {
      await createBlok(page, dir, twoColumns());

      await dropOnEdge(page, 'Newcomer', 'Col A', physical('end', dir));

      const saved = await saveBlok(page);

      expect(saved.blocks.filter(block => block.type === 'column').map(block => block.id)).toEqual(['c1', 'c2']);
      expect(saved.blocks.find(block => block.id === 'n')?.parent).toBe('c1');
    });

    test('the inner edge of the last column stacks into it', async ({ page }) => {
      await createBlok(page, dir, twoColumns());

      await dropOnEdge(page, 'Newcomer', 'Col B', physical('start', dir));

      const saved = await saveBlok(page);

      expect(saved.blocks.filter(block => block.type === 'column').map(block => block.id)).toEqual(['c1', 'c2']);
      expect(saved.blocks.find(block => block.id === 'n')?.parent).toBe('c2');
    });

    for (const side of ['start', 'end'] as const) {
      test(`the inline-${side} editor margin beside a row adds a column at the ${side}`, async ({ page }) => {
        await createBlok(page, dir, twoColumns());

        await dropInMargin(page, 'Newcomer', physical(side, dir));

        const expected = side === 'start'
          ? ['Newcomer', 'Col A', 'Col B']
          : ['Col A', 'Col B', 'Newcomer'];

        expect(savedColumnTexts(await saveBlok(page))).toEqual(expected);
        expect(inStartOrder(await columnsLeftToRight(page), dir)).toEqual(expected);
      });
    }

    test('the gutter inserts a column between the two, with the indicator on the separator', async ({ page }) => {
      await createBlok(page, dir, twoColumns());

      const from = await handleOf(page, 'Newcomer');
      const gutter = await page.getByTestId('column-resizer').first().boundingBox();

      if (!gutter) {
        throw new Error('missing gutter box');
      }

      const gutterCenter = gutter.x + gutter.width / 2;

      await startDrag(page, from, gutterCenter, gutter.y + gutter.height / 2);

      const barCenter = await page.evaluate(() => {
        const el = document.querySelector('[data-drop-indicator]');

        if (!(el instanceof HTMLElement)) {
          return null;
        }

        const before = getComputedStyle(el, '::before');

        return el.getBoundingClientRect().left + parseFloat(before.left) + parseFloat(before.width) / 2;
      });

      await finishDrag(page);

      const expected = ['Col A', 'Newcomer', 'Col B'];

      expect(savedColumnTexts(await saveBlok(page))).toEqual(expected);
      expect(inStartOrder(await columnsLeftToRight(page), dir)).toEqual(expected);
      expect(barCenter).not.toBeNull();
      expect(Math.abs((barCenter ?? 0) - gutterCenter)).toBeLessThan(6);
    });

    test('dragging the divider right grows the column on its left', async ({ page }) => {
      await createBlok(page, dir, twoColumns());

      const leftWidth = async (): Promise<number> => await page.evaluate(() => {
        const columns = Array.from(document.querySelectorAll('[data-blok-column]'))
          .map(el => el.getBoundingClientRect())
          .sort((a, b) => a.left - b.left);

        return columns[0].width;
      });

      const before = await leftWidth();
      const box = await page.getByTestId('column-resizer').first().boundingBox();

      if (!box) {
        throw new Error('missing resizer box');
      }

      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;

      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 120, y, { steps: 8 });
      await page.mouse.up();

      expect(await leftWidth()).toBeGreaterThan(before + 80);
    });

    test('ArrowRight on the divider grows the column on its left', async ({ page }) => {
      await createBlok(page, dir, twoColumns());

      const leftWidth = async (): Promise<number> => await page.evaluate(() => {
        const columns = Array.from(document.querySelectorAll('[data-blok-column]'))
          .map(el => el.getBoundingClientRect())
          .sort((a, b) => a.left - b.left);

        return columns[0].width;
      });

      const before = await leftWidth();

      await page.getByTestId('column-resizer').first().focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      expect(await leftWidth()).toBeGreaterThan(before + 16);
    });
  });
}

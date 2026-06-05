import { expect, test } from '@playwright/test';
import { createBlok, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

test.describe('double-click divider equalizes column widths', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.setViewportSize({ width: 1024, height: 800 });
  });

  test('an uneven layout returns to equal widths on divider double-click', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: { widthRatio: 3 }, parent: 'cl1', content: ['l1'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
      ],
    });

    const resizer = page.getByTestId('column-resizer').first();

    await resizer.dblclick();

    const grows = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-blok-columns] > [data-blok-element]')
      ).map(el => (el as HTMLElement).style.flexGrow)
    );

    expect(grows).toEqual(['1', '1']);
  });
});

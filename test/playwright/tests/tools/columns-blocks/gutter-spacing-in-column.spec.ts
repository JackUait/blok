import { createBlok, ensureBlokBundleBuilt} from './_helpers';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

/**
 * Notion inserts a fixed `min(32px, 4vw)` spacer between every two adjacent
 * columns — 32px on wide viewports, shrinking to 4vw on narrower ones. The gap
 * is constant per boundary regardless of column count (a 3-column layout just
 * has two 32px gaps, a 4-column has three). Blok forms that gap with the
 * resize separator between columns, so the separator's width is the gutter.
 */
test.describe('column gutter matches Notion spacing', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  const seedColumns = async (
    page: Parameters<typeof createBlok>[0],
    count: number
  ): Promise<void> => {
    const columnIds = Array.from({ length: count }, (_, i) => `c${i + 1}`);
    await createBlok(page, {
      blocks: [
        { id: 'cl1', type: 'column_list', data: {}, content: columnIds },
        ...columnIds.flatMap((columnId, i) => [
          { id: columnId, type: 'column', data: {}, parent: 'cl1', content: [`p${i + 1}`] },
          { id: `p${i + 1}`, type: 'paragraph', data: { text: `Col ${i + 1}` }, parent: columnId },
        ]),
      ],
    });
  };

  test('gutter is 32px on wide viewports (two columns)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await seedColumns(page, 2);

    const box = await page.getByTestId('column-resizer').first().boundingBox();

    expect(box?.width).toBeCloseTo(32, 0);
  });

  test('every gutter is 32px regardless of column count (four columns)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await seedColumns(page, 4);

    const resizers = page.getByTestId('column-resizer');
    await expect(resizers).toHaveCount(3);

    const widths = await resizers.evaluateAll(els =>
      els.map(el => el.getBoundingClientRect().width)
    );

    for (const width of widths) {
      expect(width).toBeCloseTo(32, 0);
    }
  });

  test('gutter tracks 4vw on narrow (non-stacked) viewports', async ({ page }) => {
    // 700px is above the 651px stacking breakpoint, so columns stay side by
    // side and the gutter follows 4vw (≈28px) rather than the 32px cap.
    await page.setViewportSize({ width: 700, height: 800 });
    await seedColumns(page, 2);

    const box = await page.getByTestId('column-resizer').first().boundingBox();

    expect(box?.width).toBeGreaterThan(26);
    expect(box?.width).toBeLessThan(30);
  });
});

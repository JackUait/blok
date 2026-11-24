import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

const FILL = (color: string, text: string): string => `<mark style="background-color: var(--blok-color-${color}-bg);">${text}</mark>`;

test.beforeAll(ensureBlokBundleBuilt);

const boot = async (page: Page, readOnly = false): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async ({ blocks, readOnly: isReadOnly }) => {
    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:120px auto;padding:0 8px';
    document.body.append(holder);
    window.changes = 0;
    window.blokInstance = new window.Blok({
      holder,
      readOnly: isReadOnly,
      data: { blocks },
      onChange: () => {
        window.changes += 1;
      },
    });
    await window.blokInstance.isReady;
  }, {
    readOnly,
    blocks: [
      { id: 'touching', type: 'paragraph', data: { text: `a ${FILL('gray', 'Notion sub-')}${FILL('blue', 'page')}.` } },
      { id: 'apart', type: 'paragraph', data: { text: `a ${FILL('gray', 'Notion')} ${FILL('blue', 'page')}.` } },
    ],
  });
};

declare global {
  interface Window {
    changes: number;
  }
}

/**
 * The corner radii of both marks of a block and the gap between their boxes.
 */
const shapeOf = async (page: Page, id: string): Promise<{ first: string[]; second: string[]; gap: number }> => {
  return page.locator(`[data-blok-id="${id}"] [data-blok-tool]`).evaluate((tool) => {
    const [first, second] = [...tool.querySelectorAll('mark')];
    const radii = (mark: Element): string[] => {
      const style = getComputedStyle(mark);

      return [style.borderTopLeftRadius, style.borderBottomLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius];
    };

    return {
      first: radii(first),
      second: radii(second),
      gap: second.getBoundingClientRect().left - first.getBoundingClientRect().right,
    };
  });
};

test.describe('touching background fills share a square edge', () => {
  for (const readOnly of [false, true]) {
    test(`two touching fills are square where they meet and round outside (readOnly: ${String(readOnly)})`, async ({ page }) => {
      await boot(page, readOnly);
      await expect(page.locator('[data-blok-id="touching"] mark').first()).toHaveAttribute('data-blok-mark-joined', 'end');

      const touching = await shapeOf(page, 'touching');

      expect(touching.first).toEqual(['4px', '4px', '0px', '0px']);
      expect(touching.second).toEqual(['0px', '0px', '4px', '4px']);
      // The two fills meet on one line: no overlap, no slit.
      expect(touching.gap).toBeCloseTo(0, 1);

      const apart = await shapeOf(page, 'apart');

      expect(apart.first).toEqual(['4px', '4px', '4px', '4px']);
      expect(apart.second).toEqual(['4px', '4px', '4px', '4px']);
    });
  }

  test('the join follows typing and is neither saved nor reported as a change', async ({ page }) => {
    await boot(page);
    const first = page.locator('[data-blok-id="touching"] mark').first();

    await expect(first).toHaveAttribute('data-blok-mark-joined', 'end');
    // The idle-time input binding may write once more; let it settle.
    await page.waitForFunction(() => new Promise((resolve) => requestIdleCallback(() => resolve(true))));
    expect(await page.evaluate(() => window.changes)).toBe(0);

    const saved = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0].data.text);

    expect(saved).toEqual([
      { text: 'a ' },
      { text: 'Notion sub-', marks: { background: 'gray' } },
      { text: 'page', marks: { background: 'blue' } },
      { text: '.' },
    ]);

    await page.locator('[data-blok-id="touching"] [data-blok-tool]').evaluate((tool) => {
      tool.querySelectorAll('mark')[1].before(' ');
    });

    await expect(first).not.toHaveAttribute('data-blok-mark-joined');
    expect((await shapeOf(page, 'touching')).first).toEqual(['4px', '4px', '4px', '4px']);
  });
});

import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

/**
 * » Minimize shows only while the pointer or a keyboard focus is on the toolbar
 * (notion-motion.md Round 102 §1 #1-#3). A keyboard user must still reach it.
 */
const HOLDER_ID = 'blok';

const MORE_VIEWS = [
  { id: 'v3', name: 'Gallery', type: 'gallery', position: 'a2', sorts: [], filters: [], properties: [{ id: 't', visible: true }] },
  { id: 'v4', name: 'Calendar', type: 'calendar', position: 'a3', sorts: [], filters: [], properties: [{ id: 't', visible: true }] },
];

const blocks = (sorts: unknown[], views: number): OutputData['blocks'] => [{
  id: 'db-1',
  type: 'database',
  data: {
    schema: [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'n', name: 'Number', type: 'number', position: 'a1' },
    ],
    views: [
      { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts, filters: [], properties: [{ id: 't', visible: true, width: 280 }, { id: 'n', visible: true, width: 200 }] },
      { id: 'v2', name: 'List', type: 'list', position: 'a1', sorts: [], filters: [], properties: [{ id: 't', visible: true }] },
      ...MORE_VIEWS.slice(0, views - 2),
    ],
    activeViewId: 'v1',
  },
  content: [],
}];

const create = async (page: Page, sorts: unknown[], views: number): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.style.width = '1000px';
    document.body.appendChild(container);
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
  }, { holder: HOLDER_ID, blokBlocks: blocks(sorts, views) });
};

/** Widens the holder until the tabs run up to the toolbar, where a » with no room would hide. */
const packTabs = async (page: Page): Promise<void> => {
  const packed = await page.evaluate(async (holder) => {
    const container = document.getElementById(holder);
    const bar = (): Element | null => document.querySelector('[data-blok-database-view-bar]');

    for (let width = 700; width <= 1500; width += 4) {
      if (container === null) return false;
      container.style.width = `${width}px`;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (bar()?.hasAttribute('data-blok-database-fold-minimize') === true) return true;
    }

    return false;
  }, HOLDER_ID);

  expect(packed).toBe(true);
};

test.describe('Database — » Minimize from the keyboard', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await gotoTestPage(page);
  });

  const SORT = [{ propertyId: 'n', direction: 'ascending' }];
  // Four views run the tabs up to the toolbar: a sorted view's » keeps its room there.
  const cases = [['a sort', SORT, 2], ['a sort and four views', SORT, 4], ['no rule', [], 2]] as const;

  for (const [name, sorts, views] of cases) {
    test(`Shift+Tab from Filter reaches » with ${name}, and Enter moves between » and «`, async ({ page }) => {
      await create(page, [...sorts], views);
      if (views > 2) await packTabs(page);
      const minimize = page.getByTestId('database-toolbar-minimize');
      const expand = page.getByTestId('database-toolbar-expand');
      const filter = page.getByTestId('database-toolbar-filter');

      await page.mouse.move(5, 700);
      await page.keyboard.press('Shift');
      await filter.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(minimize).toBeFocused();
      await expect(minimize).toBeVisible();

      await page.keyboard.press('Enter');
      await expect(expand).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(minimize).toBeFocused();
      await expect(minimize).toBeVisible();
    });
  }
});

const expandOpacityAt = async (page: Page, x: number, y: number): Promise<string> => {
  await page.mouse.move(x, y);

  // « fades over 200ms: read it once the fade is done, or a mid-fade 0 passes for hidden.
  return page.getByTestId('database-toolbar-expand').evaluate(async (el) => {
    await Promise.all(el.getAnimations().map(async (animation) => animation.finished));

    return getComputedStyle(el).opacity;
  });
};

test.describe('Database — « hover zone in a one-view title row', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await gotoTestPage(page);
  });

  // notion-motion.md Round 107 §1 #2 (r107-n-expand-zone.raw): « shows only over the controls strip, from the title
  // strip's end to the controls' end. Not over the title, and not past the last control.
  test('shows « only between the title strip and the end of the controls', async ({ page }) => {
    await create(page, [], 2);
    await page.evaluate(async () => {
      const blok = window.blokInstance;
      const block = (await blok?.save())?.blocks[0];

      if (blok === undefined || block === undefined) return;
      const data = block.data as { views: Array<Record<string, unknown>> };

      data.views = [{ ...data.views[0], toolbarMinimized: true }];
      await blok.render({ blocks: [block] });
    });
    const row = page.locator('[data-blok-database-title-row]');
    const toolbar = row.locator('[data-blok-database-view-toolbar]');
    const title = row.locator('[data-blok-database-title]');

    await expect(page.getByTestId('database-toolbar-expand')).toBeVisible();
    const rowBox = await row.boundingBox();
    const toolbarBox = await toolbar.boundingBox();
    const titleBox = await title.boundingBox();
    const stripEnd = await row.evaluate((el) => Math.max(...[...el.children]
      .filter((child) => !child.hasAttribute('data-blok-database-view-toolbar'))
      .map((child) => child.getBoundingClientRect().right)));

    if (rowBox === null || toolbarBox === null || titleBox === null) throw new Error('title row not laid out');
    const y = rowBox.y + rowBox.height / 2;
    const controlsEnd = toolbarBox.x + toolbarBox.width;

    expect(rowBox.x + rowBox.width - controlsEnd).toBeGreaterThan(8);
    await expect.poll(() => expandOpacityAt(page, titleBox.x + titleBox.width / 2, y)).toBe('0');
    await expect.poll(() => expandOpacityAt(page, controlsEnd + 4, y)).toBe('0');
    await expect.poll(() => expandOpacityAt(page, stripEnd + 4, y)).toBe('1');
    await expect.poll(() => expandOpacityAt(page, controlsEnd - 2, y)).toBe('1');
  });
});

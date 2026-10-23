/**
 * The "N more…" view list (research/13-notion-tabs-extras.md:81-82): a
 * "Search for a view..." field, every view with a drag handle and "•••",
 * then "New view".
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const NAMES = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];

const blocks = (activeViewId: string): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: NAMES.map((name, i) => ({
        id: `v${i}`, name, type: 'table', position: `a${i}`, sorts: [], filters: [], visibleProperties: [],
      })),
      activeViewId,
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const mount = async (page: Page, activeViewId = 'v0'): Promise<void> => {
  await page.evaluate(async ({ data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:520px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { data: blocks(activeViewId) });
  await expect(page.getByRole('grid')).toBeVisible();
};

const setWidth = (page: Page, width: number): Promise<void> => page.evaluate((w) => {
  const holder = document.getElementById('blok');

  if (holder !== null) {
    holder.style.maxWidth = `${w}px`;
  }
}, width);

const savedViewNames = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();
  const views = (saved?.blocks.find((block) => block.type === 'database')?.data as { views: Array<{ name: string; position: string }> }).views;

  return [...views].sort((a, b) => (a.position < b.position ? -1 : 1)).map((view) => view.name);
});

const openList = async (page: Page): Promise<Locator> => {
  await page.getByRole('button', { name: /more…$/ }).click();
  const list = page.locator('[data-blok-database-tab-overflow-dropdown]');

  await expect(list).toBeVisible();

  return list;
};

const rowOf = (list: Locator, name: string): Locator =>
  list.locator('[data-blok-database-tab-overflow-item]').filter({ hasText: name });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('database view overflow list', () => {
  test('the current view stays a tab, after the leading ones, and the list still marks it (research/21 §2)', async ({ page }) => {
    await mount(page, 'v6');
    await setWidth(page, 700);
    const shownTabs = page.locator('[data-blok-database-tab]:visible');

    // The 700px holder holds a few tabs, never all eight. Polled: the bar refolds after the resize.
    await expect.poll(async () => {
      const count = await shownTabs.count();

      return count > 1 && count < NAMES.length;
    }).toBe(true);
    const names = await shownTabs.allTextContents();
    expect(names.map((name) => name.trim())).toEqual([...NAMES.slice(0, names.length - 1), 'Seventh']);
    await expect(page.getByRole('tab', { name: 'Seventh' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: /more…$/ })).toHaveText(`${NAMES.length - names.length} more…`);

    const list = await openList(page);

    await expect(list.locator('[data-blok-database-tab-overflow-item]')).toHaveCount(NAMES.length);
    await expect(rowOf(list, 'Seventh')).toHaveAttribute('data-active', '');
    await expect(list.locator('[data-highlighted]')).toHaveText('Seventh');
  });

  test('"N more…" keeps its own room: no tab runs into it at any width', async ({ page }) => {
    await mount(page);
    const overlaps: string[] = [];

    for (let width = 360; width <= 900; width += 15) {
      await setWidth(page, width);
      // Two frames: the bar's ResizeObserver runs, then layout settles.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const problem = await page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>('[data-blok-database-tab-bar]');
        const more = bar?.querySelector<HTMLElement>('[data-blok-database-tab-more]');

        if (bar === null || bar === undefined || more === null || more === undefined) {
          return null;
        }
        const tabs = [...bar.querySelectorAll<HTMLElement>('[data-blok-database-tab]')].filter((tab) => tab.style.display !== 'none');
        const last = tabs.at(-1)?.getBoundingClientRect();
        const moreBox = more.getBoundingClientRect();
        const barRight = bar.getBoundingClientRect().right;
        const add = bar.querySelector<HTMLElement>('[data-blok-database-add-view]')?.getBoundingClientRect();
        const end = add?.left ?? barRight;
        const clipped = tabs.some((tab) => tab.scrollWidth > tab.clientWidth + 1) || more.scrollWidth > more.clientWidth + 1;
        // A crowded row squeezes the 28px add button and pushes it past the bar.
        // Only the current tab left: nothing more can fold, so it may still crowd.
        const squeezed = tabs.length > 1 && add !== undefined && (add.width < 27.5 || add.right > barRight + 0.5);

        if ((last !== undefined && last.right > moreBox.left + 0.5) || moreBox.right > end + 0.5 || clipped || squeezed) {
          return `tab right ${last?.right}, more ${moreBox.left}-${moreBox.right}, add ${add?.left}-${add?.right}, bar ${barRight}, clipped ${clipped}`;
        }

        return null;
      });

      if (problem !== null) {
        overlaps.push(`${width}px: ${problem}`);
      }
    }

    expect(overlaps).toEqual([]);
  });

  test('arrow keys skip the tabs folded into "N more…"', async ({ page }) => {
    await mount(page, 'v6');
    await setWidth(page, 700);
    const visibleNames = async (): Promise<string[]> =>
      (await page.locator('[data-blok-database-tab]:visible').allTextContents()).map((name) => name.trim());

    // Polled: the bar refolds after the resize; wait for a shown tab left of Seventh with some folded.
    await expect.poll(async () => {
      const names = await visibleNames();

      return names.length < NAMES.length && names.indexOf('Seventh') > 0;
    }).toBe(true);
    const shown = await visibleNames();
    const leftOfSeventh = shown[shown.indexOf('Seventh') - 1];
    await page.getByRole('tab', { name: 'Seventh' }).focus();
    await page.keyboard.press('ArrowLeft');

    await expect(page.getByRole('tab', { name: leftOfSeventh })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: leftOfSeventh })).toBeFocused();
  });

  test('picking a folded view from the list brings its tab into the bar', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await rowOf(list, 'Sixth').click();

    await expect(page.getByRole('tab', { name: 'Sixth', includeHidden: true })).toHaveAttribute('aria-selected', 'true');
    // Polled: the new bar shows every tab for a frame before it folds.
    await expect.poll(async () => {
      const names = (await page.locator('[data-blok-database-tab]:visible').allTextContents()).map((name) => name.trim());

      return names.length < NAMES.length && names.join() === [...NAMES.slice(0, names.length - 1), 'Sixth'].join();
    }).toBe(true);
  });

  test('lists every view under a focused search field, then New view', async ({ page }) => {
    await mount(page);
    const list = await openList(page);
    const search = list.getByPlaceholder('Search for a view...');

    await expect(search).toBeFocused();
    for (const name of NAMES) {
      await expect(rowOf(list, name)).toBeVisible();
    }
    await expect(list.getByRole('button', { name: 'Drag to reorder' })).toHaveCount(NAMES.length);
    await expect(list.getByRole('button', { name: 'More actions' })).toHaveCount(NAMES.length);
    await expect(list.getByRole('option', { name: 'New view' })).toBeVisible();
  });

  // research/21 §2: the highlight runs through "New view" and "New data source" and wraps.
  test('arrows move a highlight from the current view through New view and New data source, wrapping both ways', async ({ page }) => {
    await mount(page, 'v6');
    const list = await openList(page);
    const search = list.getByPlaceholder('Search for a view...');
    const highlighted = list.locator('[data-highlighted]');

    await expect(highlighted).toHaveText('Seventh');
    await expect(search).toHaveAttribute('aria-activedescendant', await rowOf(list, 'Seventh').getAttribute('id') ?? '');

    await search.press('ArrowDown');
    await expect(highlighted).toHaveText('Eighth');
    await search.press('ArrowDown');
    await expect(highlighted).toHaveText('New view');
    await search.press('ArrowDown');
    await expect(highlighted).toHaveText('New data source');
    await search.press('ArrowDown');
    await expect(highlighted).toHaveText('First');
    await search.press('ArrowUp');
    await expect(highlighted).toHaveText('New data source');
    await expect(search).toBeFocused();
  });

  test('typing highlights the first match and Enter opens it', async ({ page }) => {
    await mount(page);
    const list = await openList(page);
    const search = list.getByPlaceholder('Search for a view...');

    await search.fill('fif');
    await expect(list.locator('[data-highlighted]')).toHaveText('Fifth');
    await search.press('Enter');

    await expect(list).toBeHidden();
    await expect.poll(() => page.evaluate(async () => {
      const saved = await window.blokInstance?.save();

      return (saved?.blocks.find((block) => block.type === 'database')?.data as { activeViewId: string }).activeViewId;
    })).toBe('v4');
  });

  test('no match shows "No results" and highlights nothing', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await list.getByPlaceholder('Search for a view...').fill('zzz');

    await expect(list.getByText('No results', { exact: true })).toBeVisible();
    await expect(list.locator('[data-highlighted]')).toHaveCount(0);
    await expect(list.getByRole('option', { name: 'New view' })).toBeVisible();
  });

  test('Enter on New view opens the add-view menu', async ({ page }) => {
    await mount(page);
    const list = await openList(page);
    const search = list.getByPlaceholder('Search for a view...');

    await search.press('ArrowUp');
    await search.press('ArrowUp');
    await expect(list.locator('[data-highlighted]')).toHaveText('New view');
    await search.press('Enter');

    await expect(list).toBeHidden();
    await expect(page.locator('[data-blok-database-view-option="board"]')).toBeVisible();
  });

  test('arrows inside an open row menu do not move the list highlight', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await rowOf(list, 'Third').getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await page.keyboard.press('ArrowDown');

    await expect(list.locator('[data-highlighted]')).toHaveText('First');
  });

  test('search narrows the rows by name', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await list.getByPlaceholder('Search for a view...').fill('seve');

    await expect(rowOf(list, 'Seventh')).toBeVisible();
    await expect(rowOf(list, 'First')).toBeHidden();
    await expect(rowOf(list, 'Eighth')).toBeHidden();
    await expect(list.getByRole('option', { name: 'New view' })).toBeVisible();
  });

  test('"•••" opens the view menu and Rename renames the view in its row', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await rowOf(list, 'Eighth').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = list.getByRole('textbox', { name: 'Rename' });

    await expect(input).toBeFocused();
    await input.fill('Renamed');
    await input.press('Enter');

    await expect.poll(() => savedViewNames(page)).toContain('Renamed');
    expect(await savedViewNames(page)).not.toContain('Eighth');
  });

  test('one Escape closes the row menu, the next closes the list', async ({ page }) => {
    await mount(page);
    const list = await openList(page);

    await rowOf(list, 'Third').getByRole('button', { name: 'More actions' }).click();
    const rename = page.getByRole('menuitem', { name: 'Rename' });

    await expect(rename).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rename).toBeHidden();
    await expect(list).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
  });

  test('dragging a row by its handle reorders the tabs', async ({ page }) => {
    await mount(page);
    const list = await openList(page);
    const handle = rowOf(list, 'Eighth').getByRole('button', { name: 'Drag to reorder' });
    const target = await rowOf(list, 'First').boundingBox();
    const from = await handle.boundingBox();

    expect(target).not.toBeNull();
    expect(from).not.toBeNull();
    if (target === null || from === null) {
      return;
    }
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await savedViewNames(page))[0]).toBe('Eighth');
    await expect(page.getByRole('tab').first()).toHaveAccessibleName(/Eighth/);
  });
});

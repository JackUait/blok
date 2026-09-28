import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const openConversion = async (page: Page, surface: 'settings' | 'inline', currentType = 'Text'): Promise<void> => {
  const content = page.getByText('A clearer convert menu', { exact: true });

  if (surface === 'inline') {
    await selectAllInEditable(content);
    await page.getByTestId('inline-toolbar').getByRole('menuitem', { name: currentType, exact: true }).click();
  } else {
    await content.click();
    await page.getByTestId('settings-toggler').click();
    await page.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
  }
};

const saveBlocks = async (page: Page): Promise<OutputData['blocks']> => page.evaluate(async () => {
  if (window.blokInstance === undefined) {
    throw new Error('Editor is unavailable');
  }

  return (await window.blokInstance.save()).blocks;
});

// Fake-selection highlights can stamp edit time without changing saved content.
const withoutLastEditedAt = (blocks: OutputData['blocks']): OutputData['blocks'] =>
  blocks.map(({ lastEditedAt: _lastEditedAt, ...block }) => block);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    holder.id = 'convert-menu-polish';
    holder.style.cssText = 'max-width:650px;margin:100px auto';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: {
        blocks: [{ type: 'paragraph', data: { text: 'A clearer convert menu' } }],
      },
    });
    await window.blokInstance.isReady;
  });
});

const LIST_ORDER = [
  'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6',
  'Bulleted list', 'Numbered list', 'To-do list', 'Toggle list', 'Callout', 'Quote', 'Code',
  'Toggle heading 1', 'Toggle heading 2', 'Toggle heading 3', 'Toggle heading 4', 'Toggle heading 5', 'Toggle heading 6',
];

const conversionMenu = (page: Page): Locator =>
  page.getByTestId('popover-container').filter({ has: page.locator('[data-blok-convert-item]') }).last();

for (const surface of ['settings', 'inline'] as const) {
  for (const [theme, width] of [
    ['light', 1280],
    ['dark', 1280],
    ['light', 390],
    ['light', 320],
  ] as const) {
    test.describe(`${surface}, ${theme}, ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test('choices form one plain list with full labels, no tabs and no tiles', async ({ page }) => {
        await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
        const before = await saveBlocks(page);

        await openConversion(page, surface);
        const menu = conversionMenu(page);

        await expect(menu).toBeVisible();
        await expect(menu.getByRole('tab')).toHaveCount(0);
        await expect(menu.getByRole('separator', { includeHidden: true })).toHaveCount(0);

        const rows = menu.locator('[data-blok-convert-item]');

        await expect.poll(() => rows.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label') ?? element.textContent?.trim())))
          .toEqual(LIST_ORDER);

        // Layout boxes, not client rects: the mobile scroll reel scales rows near the edge.
        const measurements = await rows.evaluateAll(elements => elements.map(element => {
          if (!(element instanceof HTMLElement)) {
            throw new Error('Row is not an HTML element');
          }

          const rect = { x: element.offsetLeft, y: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
          const title = element.querySelector('[data-blok-popover-item-title]');
          const icon = element.querySelector('[data-blok-popover-item-icon]');

          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            titleFits: title !== null && title.scrollWidth <= title.clientWidth + 1,
            hasIcon: icon instanceof HTMLElement && icon.offsetWidth > 0,
          };
        }));
        const first = measurements[0];

        if (first === undefined) {
          throw new Error('Conversion list is empty');
        }

        measurements.forEach(row => {
          expect.soft(Math.abs(row.x - first.x)).toBeLessThanOrEqual(1);
          expect.soft(Math.abs(row.width - first.width)).toBeLessThanOrEqual(1);
          expect.soft(row.height).toBeGreaterThanOrEqual(width < 651 ? 44 : 28);
          expect.soft(row.titleFits).toBe(true);
          expect.soft(row.hasIcon).toBe(true);
        });
        // Stacked: each row starts below the one before it.
        measurements.slice(1).forEach((row, index) => {
          const previous = measurements[index] ?? row;

          expect.soft(row.y).toBeGreaterThanOrEqual(previous.y + previous.height - 1);
        });

        // A compact search line on desktop. Phone menus keep their own touch sizing.
        const searchHeight = width < 651 ? 0 : await menu.getByTestId('popover-search-field')
          .evaluate(element => element instanceof HTMLElement ? element.offsetHeight : Infinity);

        expect.soft(searchHeight).toBeLessThanOrEqual(28);

        const box = await menu.boundingBox();

        expect.soft(box?.width).toBeLessThanOrEqual(232);
        expect.soft(box?.x).toBeGreaterThanOrEqual(0);
        expect.soft((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
        expect(await saveBlocks(page)).toEqual(before);

        await menu.getByRole('menuitem', { name: 'Quote', exact: true }).click();
        expect(await saveBlocks(page)).toEqual([
          expect.objectContaining({ type: 'quote', data: expect.objectContaining({ text: 'A clearer convert menu' }) }),
        ]);
      });
    });
  }

  test(`${surface}: arrow keys walk the list and Enter converts`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openConversion(page, surface);
    const menu = conversionMenu(page);
    const search = page.getByRole('combobox', { name: 'Find an action…', exact: true }).last();

    await expect(search).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Heading 1', exact: true })).toHaveAttribute('data-blok-focused', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Heading 2', exact: true })).toHaveAttribute('data-blok-focused', 'true');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'A clearer convert menu', level: 2 })).toBeVisible();
    expect(await saveBlocks(page)).toEqual([
      expect.objectContaining({ type: 'header', data: expect.objectContaining({ text: 'A clearer convert menu', level: 2 }) }),
    ]);
  });

  for (const isToggleable of [false, true]) {
    test(`${surface}: current ${isToggleable ? 'Toggle heading' : 'Heading'} 1 carries a checkmark and selecting it is a no-op`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(async toggle => {
        const blok = window.blokInstance;

        if (blok === undefined) {
          throw new Error('Editor is unavailable');
        }

        await blok.blocks.render({ blocks: [
          { id: 'current-heading', type: 'header', data: { text: 'A clearer convert menu', level: 1, isToggleable: toggle } },
        ] });
      }, isToggleable);
      const before = withoutLastEditedAt(await saveBlocks(page));
      const holder = await page.evaluateHandle(() => window.blokInstance?.blocks.getBlockByIndex(0)?.holder);
      const title = `${isToggleable ? 'Toggle heading' : 'Heading'} 1`;

      await openConversion(page, surface, title);
      const menu = conversionMenu(page);
      const current = menu.getByRole('menuitemcheckbox', { name: title, exact: true })
        .or(menu.getByRole('menuitem', { name: title, exact: true }));

      await expect(current).toBeVisible();
      await expect(current).toHaveAttribute('data-blok-popover-item-active', 'true');
      await page.mouse.move(5, 850);
      // Selected is gray, never blue: a neutral fill, same ink as any other row, plus the checkmark.
      const plainInk = await menu.getByRole('menuitem', { name: 'Quote', exact: true }).evaluate(element => getComputedStyle(element).color);
      const fill = await current.evaluate(element => getComputedStyle(element).backgroundColor);
      const [r = 0, g = 0, b = 0, alpha = 1] = (fill.match(/[\d.]+/g) ?? []).map(Number);

      expect(alpha).toBeGreaterThan(0);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(10);
      await expect(current).toHaveCSS('color', plainInk);
      await expect(current.getByTestId('popover-item-trailing-icon')).toBeVisible();
      await expect(current.getByTestId('popover-item-trailing-icon')).toHaveCSS('color', plainInk);
      await expect(menu.locator('[data-blok-convert-item][data-blok-popover-item-active="true"]')).toHaveCount(1);
      await expect(menu.getByTestId('popover-item-trailing-icon')).toHaveCount(1);

      const search = page.getByRole('combobox', { name: 'Find an action…', exact: true }).last();

      await search.fill('te');
      await page.mouse.move(5, 850);
      const textOption = menu.getByRole('menuitem', { name: 'Text', exact: true });

      await expect(textOption).toBeVisible();
      await expect(textOption).not.toHaveAttribute('data-blok-focused', 'true');
      await page.keyboard.press('Enter');
      expect(withoutLastEditedAt(await saveBlocks(page))).toEqual(before);
      await page.keyboard.press('ArrowDown');
      await expect(textOption).toHaveAttribute('data-blok-focused', 'true');

      await search.fill('');
      await expect(current).toBeVisible();
      await expect(current).toHaveAttribute('data-blok-popover-item-active', 'true');
      await current.click();
      expect(withoutLastEditedAt(await saveBlocks(page))).toEqual(before);
      expect(await page.evaluate(original => window.blokInstance?.blocks.getBlockByIndex(0)?.holder === original, holder))
        .toBe(true);
      await holder.dispose();
    });
  }
}

test('custom heading without level data keeps its original icon', async ({ page }) => {
  await page.evaluate(() => {
    const blok = window.blokInstance;
    const icon = blok?.tools.getBlockTools().find(tool => tool.name === 'header')?.toolbox?.[0]?.icon;

    if (blok === undefined || icon === undefined) {
      throw new Error('Header toolbox is unavailable');
    }

    blok.tools.update('header', { toolbox: { icon, titleKey: 'tools.header.heading1' } });
  });
  await page.getByText('A clearer convert menu', { exact: true }).click();
  await page.getByTestId('settings-toggler').click();
  await page.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
  const heading = page.getByRole('menuitem', { name: 'Heading 1', exact: true });

  await expect(heading).toBeVisible();
  await expect(heading.locator('[data-blok-popover-item-icon]')).toBeVisible();
});

test('partial heading group keeps Columns on its own row', async ({ page }) => {
  await page.evaluate(async () => {
    const blok = window.blokInstance;

    if (blok === undefined) {
      throw new Error('Editor is unavailable');
    }

    await blok.blocks.render({ blocks: [
      { type: 'paragraph', data: { text: 'First block' } },
      { type: 'paragraph', data: { text: 'Second block' } },
    ] });
    const tools = blok.tools.getBlockTools();
    const icon = tools.find(tool => tool.name === 'header')?.toolbox?.[0]?.icon;

    if (icon === undefined) {
      throw new Error('Header toolbox is unavailable');
    }

    for (const tool of tools) {
      blok.tools.update(tool.name, { toolbox: false });
    }
    blok.tools.update('header', {
      toolbox: { icon, titleKey: 'tools.header.heading1', data: { level: 1 } },
    });
  });
  await page.getByText('First block', { exact: true }).click();
  for (let stage = 0; stage < 3; stage++) {
    await page.keyboard.press('ControlOrMeta+A');
  }
  await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(2);
  await page.getByTestId('settings-toggler').click();
  await page.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
  const heading = page.getByRole('menuitem', { name: 'Heading 1', exact: true });
  const columns = page.getByRole('menuitem', { name: 'Columns', exact: true });

  await expect(heading).toBeVisible();
  await expect(columns).toBeVisible();
  await heading.evaluate(async element => {
    const animations = element.closest('[data-blok-popover]')?.getAnimations({ subtree: true }) ?? [];

    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
  });
  const headingBounds = await heading.boundingBox();
  const columnsBounds = await columns.boundingBox();

  if (headingBounds === null || columnsBounds === null) {
    throw new Error('Conversion choices have no visible bounds');
  }

  expect(columnsBounds.y).toBeGreaterThanOrEqual(headingBounds.y + headingBounds.height);
});

test('search keeps full conversion labels and keyboard activation', async ({ page }) => {
  await page.getByText('A clearer convert menu', { exact: true }).click();
  await page.getByTestId('settings-toggler').click();
  await page.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Find an action…', exact: true }).last();

  await search.fill('Toggle heading 6');
  const result = page.getByRole('menuitem', { name: 'Toggle heading 6', exact: true });

  await expect(result).toBeVisible();
  await expect.poll(() => result.evaluate(element => {
    const icon = element.querySelector('svg');
    const bounds = icon?.getBoundingClientRect();

    return icon !== null && (bounds?.width ?? 0) > 0 && (bounds?.height ?? 0) > 0 &&
      getComputedStyle(icon).visibility === 'visible';
  })).toBe(true);
  const title = result.getByTestId('popover-item-title');
  const titleBounds = await title.boundingBox();

  expect(titleBounds?.width).toBeGreaterThan(1);
  await expect(result).not.toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(result).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'A clearer convert menu', level: 6 })).toBeVisible();

  const saved = await page.evaluate(async () => window.blokInstance?.save());

  expect(saved?.blocks[0]).toMatchObject({
    type: 'header',
    data: { text: 'A clearer convert menu', level: 6, isToggleable: true },
  });
});

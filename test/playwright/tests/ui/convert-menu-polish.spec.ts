import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

for (const surface of ['settings', 'inline'] as const) {
  for (const [theme, width] of [
    ['light', 1280],
    ['light', 390],
    ['dark', 1280],
    ['dark', 390],
    ['light', 320],
    ['light', 375],
    ['light', 384],
  ] as const) {
    test.describe(`${surface}, ${theme}, ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test('family tabs show readable, flat 3-by-2 previews without converting the block', async ({ page }) => {
        await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
        const before = await saveBlocks(page);

        await openConversion(page, surface);
        const headingTab = page.getByRole('tab', { name: 'Heading', exact: true });
        const toggleTab = page.getByRole('tab', { name: 'Toggle heading', exact: true });

        await expect(headingTab).toBeVisible();
        await expect(toggleTab).toBeVisible();
        await headingTab.evaluate(async element => {
          const animations = element.closest('[data-blok-popover]')?.getAnimations({ subtree: true }) ?? [];

          await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
        });
        await expect(headingTab).toHaveAttribute('aria-selected', 'true');
        await expect(toggleTab).toHaveAttribute('aria-selected', 'false');

        for (const tab of [headingTab, toggleTab]) {
          const bounds = await tab.boundingBox();
          const minimumSize = width < 651 ? 44 : 1;

          expect.soft(bounds?.width).toBeGreaterThanOrEqual(minimumSize);
          expect.soft(bounds?.height).toBeGreaterThanOrEqual(minimumSize);
        }

        for (const [group, title, tab, otherTab, inactiveGroup] of [
          ['heading', 'Heading', headingTab, toggleTab, 'toggle-heading'],
          ['toggle-heading', 'Toggle heading', toggleTab, headingTab, 'heading'],
        ] as const) {
          await tab.click();
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          await expect(otherTab).toHaveAttribute('aria-selected', 'false');
          await expect(page.locator('[data-blok-convert-group][data-blok-convert-level]:visible')).toHaveCount(6);
          expect(await saveBlocks(page)).toEqual(before);
          await tab.hover();

          const items = page.locator(`[data-blok-convert-group="${group}"][data-blok-convert-level]`);

          for (const level of [1, 2, 3, 4, 5, 6]) {
            const item = items.and(page.locator(`[data-blok-convert-level="${level}"]`));
            const preview = item.getByTestId('popover-item-title');

            await expect(item).toBeVisible();
            await expect(item).toHaveAccessibleName(`${title} ${level}`);
            await expect(preview).toBeVisible();
            expect(await preview.innerText()).toMatch(new RegExp(`^(?:Toggle )?[Hh]eading ${level}$`));
            await expect(page.locator(`[data-blok-convert-group="${inactiveGroup}"][data-blok-convert-level="${level}"]`))
              .not.toBeVisible();
          }

          await items.first().evaluate(async element => {
            const animations = element.closest('[data-blok-popover]')?.getAnimations({ subtree: true }) ?? [];

            await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
          });
          const measurements = await items.evaluateAll(elements => elements.map(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const preview = element.querySelector('[data-blok-testid="popover-item-title"]');

            if (preview === null) {
              throw new Error('Heading preview is unavailable');
            }

            const range = document.createRange();

            range.selectNodeContents(preview);
            const text = range.getBoundingClientRect();
            const textStyle = getComputedStyle(preview);

            return {
              x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
              width: rect.width, height: rect.height,
              background: style.backgroundColor, shadow: style.boxShadow,
              border: parseFloat(style.borderTopWidth),
              textFits: text.width > 0 && text.height > 0 &&
                text.left >= rect.left && text.right <= rect.right + 1 &&
                text.top >= rect.top && text.bottom <= rect.bottom + 1 &&
                preview.scrollWidth <= preview.clientWidth + 1 &&
                preview.scrollHeight <= preview.clientHeight + 1,
              textOpacity: parseFloat(textStyle.opacity),
              fontSize: parseFloat(textStyle.fontSize),
            };
          }));

          expect(measurements).toHaveLength(6);
          measurements.forEach((item, index) => {
            const column = measurements[index % 3];
            const row = measurements[index < 3 ? 0 : 3];

            if (column === undefined || row === undefined) {
              throw new Error('Heading preview grid is incomplete');
            }

            expect.soft(item.textFits).toBe(true);
            expect.soft(item.textOpacity).toBeGreaterThan(0);
            expect.soft(item.background).toBe('rgba(0, 0, 0, 0)');
            expect.soft(item.shadow).toBe('none');
            expect.soft(item.border).toBe(0);
            expect.soft(item.width).toBeGreaterThanOrEqual(width < 651 ? 44 : 40);
            expect.soft(item.height).toBeGreaterThanOrEqual(width < 651 ? 44 : 40);
            expect.soft(item.x).toBeGreaterThanOrEqual(0);
            expect.soft(item.right).toBeLessThanOrEqual(width);
            expect.soft(Math.abs(item.x - column.x)).toBeLessThanOrEqual(1);
            expect.soft(Math.abs(item.y - row.y)).toBeLessThanOrEqual(1);

          });
          for (const index of [1, 2, 4, 5]) {
            expect.soft(measurements[index]?.x).toBeGreaterThanOrEqual(measurements[index - 1]?.right ?? Infinity);
          }
          for (const index of [3, 4, 5]) {
            expect.soft(measurements[index]?.y).toBeGreaterThanOrEqual(measurements[index - 3]?.bottom ?? Infinity);
          }
          expect.soft(measurements[0]?.fontSize).toBeGreaterThan(measurements[5]?.fontSize ?? Infinity);

          for (const name of ['Bulleted list', 'Numbered list', 'To-do list', 'Toggle list', 'Quote', 'Callout', 'Code']) {
            await expect(page.locator('[data-blok-convert-item]').and(page.getByRole('menuitem', { name, exact: true })))
              .toBeVisible();
          }

          const second = items.and(page.locator('[data-blok-convert-level="2"]'));

          await second.hover();
          await expect.poll(() => second.evaluate(element => {
            const color = getComputedStyle(element).backgroundColor;
            const alpha = color.includes('/') ? color.split('/')[1] : color.split(',')[3];

            return parseFloat(alpha ?? '1') / (alpha?.includes('%') ? 100 : 1);
          })).toBeGreaterThan(0);
          const hover = await second.evaluate(element => {
            const style = getComputedStyle(element);
            const alpha = style.backgroundColor.includes('/') ?
              style.backgroundColor.split('/')[1] : style.backgroundColor.split(',')[3];

            return {
              alpha: parseFloat(alpha ?? '1') / (alpha?.includes('%') ? 100 : 1),
              radius: parseFloat(style.borderRadius),
              shadow: style.boxShadow,
            };
          });

          expect.soft(hover.alpha).toBeLessThanOrEqual(0.15);
          expect.soft(hover.radius).toBeGreaterThan(0);
          expect.soft(hover.shadow).toBe('none');
          await tab.hover();
          await expect.poll(() => second.evaluate(element => getComputedStyle(element).backgroundColor))
            .toBe('rgba(0, 0, 0, 0)');
        }

        await headingTab.click();
        await expect(headingTab).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-blok-convert-group="heading"][data-blok-convert-level="1"]')).toBeVisible();
        expect(await saveBlocks(page)).toEqual(before);
        const overflow = await headingTab.evaluate(element => {
          const menu = element.closest('[data-blok-popover-container]');
          const scroller = menu?.querySelector('[data-blok-popover-items]');

          if (scroller === null || scroller === undefined) {
            throw new Error('Conversion items scroller is unavailable');
          }

          return {
            page: document.documentElement.scrollWidth > window.innerWidth,
            menu: menu !== null && menu.scrollWidth > menu.clientWidth,
            items: scroller.scrollHeight > scroller.clientHeight + 1,
          };
        });

        expect.soft(overflow).toEqual({ page: false, menu: false, items: false });
        await page.locator('[data-blok-convert-item]').and(page.getByRole('menuitem', { name: 'Quote', exact: true })).click();
        expect(await saveBlocks(page)).toEqual([
          expect.objectContaining({ type: 'quote', data: expect.objectContaining({ text: 'A clearer convert menu' }) }),
        ]);
      });
    });
  }

  for (const entryKey of ['Tab', 'ArrowDown']) {
    test(`${surface}: tab arrows switch families and native navigation skips hidden previews (${entryKey} entry)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const before = await saveBlocks(page);

      await openConversion(page, surface);
      const headingTab = page.getByRole('tab', { name: 'Heading', exact: true });
      const toggleTab = page.getByRole('tab', { name: 'Toggle heading', exact: true });
      const search = page.getByRole('combobox', { name: 'Find an action…', exact: true }).last();

      await expect(search).toBeFocused();
      await page.keyboard.press(entryKey);
      await page.keyboard.press('ArrowRight');
      await expect(toggleTab).toBeFocused();
      await expect(toggleTab).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowLeft');
      await expect(headingTab).toBeFocused();
      await expect(headingTab).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowRight');
      await expect(toggleTab).toHaveAttribute('aria-selected', 'true');
      expect(await saveBlocks(page)).toEqual(before);

      await page.keyboard.press('ArrowDown');
      const first = page.locator('[data-blok-convert-group="toggle-heading"][data-blok-convert-level="1"]');
      const second = page.locator('[data-blok-convert-group="toggle-heading"][data-blok-convert-level="2"]');

      await expect(first).toHaveAttribute('data-blok-focused', 'true');
      await page.keyboard.press('Tab');
      await expect(second).toHaveAttribute('data-blok-focused', 'true');
      await page.keyboard.press('ArrowUp');
      await expect(first).toHaveAttribute('data-blok-focused', 'true');

      for (const level of [2, 3, 4, 5, 6]) {
        await page.keyboard.press('ArrowDown');
        const item = page.locator(`[data-blok-convert-group="toggle-heading"][data-blok-convert-level="${level}"]`);

        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute('data-blok-focused', 'true');
      }

      await page.keyboard.press('ArrowDown');
      await expect(page.locator('[data-blok-convert-item][data-blok-focused="true"]:not([data-blok-convert-group])')).toBeVisible();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'A clearer convert menu', level: 6 })).toBeVisible();
      expect(await saveBlocks(page)).toEqual([
        expect.objectContaining({
          type: 'header',
          data: expect.objectContaining({ text: 'A clearer convert menu', level: 6, isToggleable: true }),
        }),
      ]);
    });
  }

  for (const isToggleable of [false, true]) {
    test(`${surface}: current ${isToggleable ? 'Toggle heading' : 'Heading'} 1 stays marked and selecting it is a no-op`, async ({ page }) => {
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
      const title = isToggleable ? 'Toggle heading' : 'Heading';
      const group = isToggleable ? 'toggle-heading' : 'heading';

      await openConversion(page, surface, `${title} 1`);
      await expect(page.getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: isToggleable ? 'Heading' : 'Toggle heading', exact: true }))
        .toHaveAttribute('aria-selected', 'false');
      const current = page.locator(`[data-blok-convert-item][data-blok-convert-group="${group}"][data-blok-convert-level="1"]`);

      await expect(current).toBeVisible();
      await expect(current).toHaveAccessibleName(`${title} 1`);
      await expect(current.getByTestId('popover-item-title')).toBeVisible();
      await expect(current.getByTestId('popover-item-trailing-icon')).toHaveCount(0);
      await expect(current).toHaveAttribute('data-blok-popover-item-active', 'true');
      await expect(page.locator('[data-blok-convert-item][data-blok-popover-item-active="true"]')).toHaveCount(1);
      await expect(page.locator('[data-blok-convert-group][data-blok-convert-level]:visible')).toHaveCount(6);
      const search = page.getByRole('combobox', { name: 'Find an action…', exact: true }).last();

      await search.fill('te');
      await page.mouse.move(5, 850);
      const textOption = page.locator('[data-blok-convert-item]').and(page.getByRole('menuitem', { name: 'Text', exact: true }));

      await expect(textOption).toBeVisible();
      await expect(textOption).not.toHaveAttribute('data-blok-focused', 'true');
      await expect(textOption).not.toHaveAttribute('data-blok-popover-item-active');
      await expect(textOption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(textOption).toHaveCSS('outline-style', 'none');
      await page.keyboard.press('Enter');
      expect(withoutLastEditedAt(await saveBlocks(page))).toEqual(before);
      await page.keyboard.press('ArrowDown');
      await expect(textOption).toHaveAttribute('data-blok-focused', 'true');

      await search.fill(`${title} 1`);
      await expect(current).toBeVisible();
      await expect(current).toHaveAccessibleName(`${title} 1`);
      await expect(current).toHaveAttribute('data-blok-popover-item-active', 'true');
      await expect.poll(() => current.getByTestId('popover-item-title').innerText()).toBe(`${title} 1`);
      await expect(page.locator('[data-blok-convert-item][data-blok-popover-item-active="true"]')).toHaveCount(1);

      await search.fill('');
      await expect(page.getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: isToggleable ? 'Heading' : 'Toggle heading', exact: true }))
        .toHaveAttribute('aria-selected', 'false');
      await expect(current).toBeVisible();
      await expect(current).toHaveAttribute('data-blok-popover-item-active', 'true');
      await expect(page.locator('[data-blok-convert-item][data-blok-popover-item-active="true"]')).toHaveCount(1);
      await expect(page.locator('[data-blok-convert-group][data-blok-convert-level]:visible')).toHaveCount(6);
      expect(withoutLastEditedAt(await saveBlocks(page))).toEqual(before);
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

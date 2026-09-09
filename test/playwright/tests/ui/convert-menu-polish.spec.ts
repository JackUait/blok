import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

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

      test(`conversion number strips stay readable and aligned in ${surface}, ${theme}, ${width}px`, async ({ page }) => {
        await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
        const paragraph = page.getByText('A clearer convert menu', { exact: true });

        if (surface === 'inline') {
          await selectAllInEditable(paragraph);
        } else {
          await paragraph.click();
          await page.getByTestId('settings-toggler').click();
        }

        await page.getByRole('menuitem', { name: surface === 'inline' ? 'Text' : 'Convert to', exact: true }).click();
        const heading = page.getByRole('menuitem', { name: 'Heading 1', exact: true });

        await expect(heading).toBeVisible();
        const levels = page.locator('[data-blok-convert-group]');

        await expect(levels).toHaveCount(12);
        await heading.evaluate(async element => {
          const animations = element.closest('[data-blok-popover]')?.getAnimations({ subtree: true }) ?? [];

          await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
        });
        await page.getByText('Heading', { exact: true }).hover();
        let headingRowBottom = 0;
        let toggleHeadingRowTop = 0;

        for (const [group, title] of [
          ['heading', 'Heading'],
          ['toggle-heading', 'Toggle heading'],
        ] as const) {
          const label = page.locator(`[data-blok-item-name="convert-${group}-label"]`);

          await expect(label).toBeVisible();
          await expect(label).toHaveText(title);
          const labelBounds = await label.boundingBox();

          if (labelBounds === null) {
            throw new Error(`${title} label has no visible bounds`);
          }

          for (const level of [1, 2, 3, 4, 5, 6]) {
            const item = page.getByRole('menuitem', { name: `${title} ${level}`, exact: true });

            await expect(item).toBeVisible();
            await expect(item).toHaveAttribute('data-blok-convert-level', String(level));
          }

          const measurements = await page.locator(`[data-blok-convert-group="${group}"]`)
            .evaluateAll(elements => elements.map(element => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              const numberStyle = getComputedStyle(element, '::before');
              const icon = element.querySelector('svg');
              const iconBounds = icon?.getBoundingClientRect();

              return {
                x: rect.x,
                y: rect.y,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
                background: style.backgroundColor,
                focused: element.getAttribute('data-blok-focused') === 'true',
                leftRadius: style.borderTopLeftRadius,
                rightRadius: style.borderTopRightRadius,
                number: numberStyle.content,
                fontSize: parseFloat(numberStyle.fontSize),
                numberDisplay: numberStyle.display,
                numberVisibility: numberStyle.visibility,
                numberOpacity: parseFloat(numberStyle.opacity),
                iconHidden: icon !== null && (iconBounds?.width === 0 || iconBounds?.height === 0 ||
                  getComputedStyle(icon).visibility === 'hidden'),
              };
            }));
          const first = measurements[0];

          if (first === undefined) {
            throw new Error(`${title} strip has no level controls`);
          }

          expect(measurements).toHaveLength(6);
          expect.soft(labelBounds.x).toBeGreaterThanOrEqual(0);
          expect.soft(labelBounds.x + labelBounds.width).toBeLessThanOrEqual(width);

          for (const [index, item] of measurements.entries()) {
            expect.soft(item.number).toMatch(new RegExp(`^"${index + 1}"(?: / "")?$`));
            expect.soft(item.fontSize).toBeGreaterThanOrEqual(13);
            expect.soft(item.fontSize).toBeLessThanOrEqual(15);
            expect.soft(item.numberDisplay).not.toBe('none');
            expect.soft(item.numberVisibility).toBe('visible');
            expect.soft(item.numberOpacity).toBeGreaterThan(0);
            expect.soft(item.iconHidden).toBe(true);
            expect.soft(item.background).not.toBe('rgba(0, 0, 0, 0)');
            expect.soft(item.width).toBeGreaterThanOrEqual(width < 651 ? 44 : 40);
            expect.soft(item.height).toBeGreaterThanOrEqual(width < 651 ? 44 : 40);
            expect.soft(item.x).toBeGreaterThanOrEqual(0);
            expect.soft(item.right).toBeLessThanOrEqual(width);
            expect.soft(Math.abs(item.y - first.y)).toBeLessThanOrEqual(1);
          }

          const gaps = measurements.slice(1).map((item, index) =>
            Math.abs(item.x - (measurements[index]?.right ?? NaN)));
          const labelAligned = width < 384 || measurements.every(item =>
            Math.abs(labelBounds.y + labelBounds.height / 2 - item.y - item.height / 2) <= 1);
          const labelTrailingEdge = width < 384 ? labelBounds.y + labelBounds.height : labelBounds.x + labelBounds.width;
          const stripLeadingEdge = width < 384 ? first.y : first.x;
          const restingBackgrounds = measurements.filter(item => !item.focused).map(item => item.background);

          expect.soft(gaps.every(gap => gap <= 1)).toBe(true);
          expect.soft(measurements.slice(1).map(item => item.leftRadius)).toEqual(['0px', '0px', '0px', '0px', '0px']);
          expect.soft(measurements.slice(0, -1).map(item => item.rightRadius)).toEqual(['0px', '0px', '0px', '0px', '0px']);
          expect.soft(labelAligned).toBe(true);
          expect.soft(labelTrailingEdge).toBeLessThanOrEqual(stripLeadingEdge);
          expect.soft(new Set(restingBackgrounds).size).toBe(1);

          if (group === 'heading') {
            headingRowBottom = first.bottom;
          } else {
            toggleHeadingRowTop = first.y;
          }
        }

        const dividersBetweenRows = await heading.evaluate((element, bounds) => {
          const menu = element.closest('[data-blok-popover-container]');
          const separators = menu?.querySelectorAll('[role="separator"]') ?? [];

          return Array.from(separators).filter(separator => {
            const rect = separator.getBoundingClientRect();

            return rect.height > 0 && rect.bottom > bounds.top && rect.y < bounds.bottom;
          }).length;
        }, { top: headingRowBottom, bottom: toggleHeadingRowTop });
        const rowGap = toggleHeadingRowTop - headingRowBottom;
        const rowsTightlySpaced = width < 384 || (rowGap >= 0 && rowGap <= 4);

        expect.soft(dividersBetweenRows).toBe(0);
        expect.soft(rowsTightlySpaced).toBe(true);

        const overflow = await heading.evaluate(element => {
          const menu = element.closest('[data-blok-popover-container]');

          return {
            page: document.documentElement.scrollWidth > window.innerWidth,
            menu: menu !== null && menu.scrollWidth > menu.clientWidth,
          };
        });

        expect.soft(overflow).toEqual({ page: false, menu: false });
        const secondHeading = page.getByRole('menuitem', { name: 'Heading 2', exact: true });
        const restingBackground = await secondHeading.evaluate(element => getComputedStyle(element).backgroundColor);

        await secondHeading.hover();
        await expect.poll(() => secondHeading.evaluate(element => getComputedStyle(element).backgroundColor))
          .not.toBe(restingBackground);
        await page.getByText('Heading', { exact: true }).hover();
        await expect.poll(() => secondHeading.evaluate(element => getComputedStyle(element).backgroundColor))
          .toBe(restingBackground);

        const checkKeyboard = surface === 'settings' && theme === 'light' && width === 1280;

        if (checkKeyboard) {
          const search = page.getByRole('combobox', { name: 'Find an action…', exact: true }).last();

          await search.fill('Heading');
          await search.fill('');
        }

        await expect.poll(() => checkKeyboard ? heading.getAttribute('data-blok-focused') : null)
          .toBe(checkKeyboard ? 'true' : null);

        if (checkKeyboard) {
          await page.keyboard.press('ArrowDown');
        }

        const expectedKeyboardState = checkKeyboard ?
          { firstFocused: false, secondFocused: true, highlighted: true } : null;

        await expect.poll(async () => {
          if (!checkKeyboard) {
            return null;
          }

          return {
            firstFocused: await heading.getAttribute('data-blok-focused') === 'true',
            secondFocused: await secondHeading.getAttribute('data-blok-focused') === 'true',
            highlighted: await secondHeading.evaluate(element => getComputedStyle(element).backgroundColor) !== restingBackground,
          };
        }).toEqual(expectedKeyboardState);
      });
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
  await expect(result).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'A clearer convert menu', level: 6 })).toBeVisible();

  const saved = await page.evaluate(async () => window.blokInstance?.save());

  expect(saved?.blocks[0]).toMatchObject({
    type: 'header',
    data: { text: 'A clearer convert menu', level: 6, isToggleable: true },
  });
});

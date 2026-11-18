import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

const EIGHT_RECENTS = [
  { name: 'blue', field: 'text' },
  { name: 'yellow', field: 'text' },
  { name: 'orange', field: 'text' },
  { name: 'pink', field: 'bg' },
  { name: 'green', field: 'bg' },
  { name: 'red', field: 'text' },
  { name: 'purple', field: 'bg' },
  { name: 'yellow', field: 'bg' },
];

test.beforeAll(ensureBlokBundleBuilt);

const boot = async (page: Page, recents: Array<{ name: string; field: string }>): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async (stored) => {
    localStorage.setItem('blok-recent-colors', JSON.stringify(stored));
    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:120px auto;padding:0 8px';
    document.body.append(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ type: 'paragraph', data: { text: 'Syntax highlighting (auto-detected)' } }] },
    });
    await window.blokInstance.isReady;
  }, recents);
};

const openBlockColors = async (page: Page): Promise<Locator> => {
  await page.getByTestId('block-wrapper').locator('[contenteditable="true"]').click();
  await page.getByTestId('settings-toggler').click();
  await page.getByRole('menuitem', { name: 'Color', exact: true }).click();
  const picker = page.getByTestId('block-color-picker');

  await expect(picker).toBeVisible();
  // The submenu scales in. Measure only once it has settled.
  await card(picker).evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });

  return picker;
};

const card = (picker: Locator): Locator => picker.locator('xpath=ancestor::*[@data-blok-popover-container][1]');

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const found = await locator.boundingBox();

  if (found === null) {
    throw new Error('element has no box');
  }

  return found;
};

const recentIds = async (picker: Locator): Promise<Array<string | null>> => {
  return picker.getByTestId('block-color-section-recent').getByRole('button').evaluateAll(
    (buttons) => buttons.map((button) => button.getAttribute('data-blok-testid'))
  );
};

test.describe('color picker, named rows', () => {
  test('the submenu card is as wide as the picker plus its own side padding', async ({ page }) => {
    await boot(page, EIGHT_RECENTS);
    const picker = await openBlockColors(page);
    const padding = await card(picker).evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft) + parseFloat(getComputedStyle(el).paddingRight));

    expect((await box(card(picker))).width - (await box(picker)).width).toBeCloseTo(padding, 0);
    expect((await box(card(picker))).width).toBeCloseTo(316, 0);
  });

  test('every tile starts on its section title\'s left edge', async ({ page }) => {
    await boot(page, EIGHT_RECENTS);
    const picker = await openBlockColors(page);

    for (const section of ['recent', 'textColor', 'backgroundColor']) {
      const host = picker.getByTestId(`block-color-section-${section}`);
      const title = await host.getByTestId('block-color-title').evaluate((el) => {
        const range = document.createRange();

        range.selectNodeContents(el);

        return range.getBoundingClientRect().left;
      });
      const tile = await box(host.getByRole('button').first().getByTestId('block-color-tile'));

      expect(Math.abs(tile.x - title), section).toBeLessThan(0.6);
    }
  });

  test('eight recent tiles of 28px fill the row with even gaps', async ({ page }) => {
    await boot(page, EIGHT_RECENTS);
    const picker = await openBlockColors(page);
    const pickerBox = await box(card(picker));
    const buttons = picker.getByTestId('block-color-section-recent').getByRole('button');

    await expect(buttons).toHaveCount(8);
    const tiles = await Promise.all(Array.from({ length: 8 }, (_, i) => box(buttons.nth(i).getByTestId('block-color-tile'))));
    const gaps = tiles.slice(1).map((tile, i) => tile.x - (tiles[i].x + tiles[i].width));

    for (const tile of tiles) {
      expect(tile.width).toBeCloseTo(28, 1);
      expect(tile.height).toBeCloseTo(28, 1);
    }
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0], 1);
    }
    expect(gaps[0]).toBeGreaterThan(9.5);
    expect(gaps[0]).toBeLessThan(11);
    // Same inset from the card's edges on both sides: 8px padding + 2px.
    expect(tiles[0].x - pickerBox.x).toBeCloseTo(10, 0);
    expect(pickerBox.x + pickerBox.width - (tiles[7].x + tiles[7].width)).toBeCloseTo(10, 0);
  });

  test('a recent tile\'s hover fill shows evenly on all four sides', async ({ page }) => {
    await boot(page, EIGHT_RECENTS);
    const picker = await openBlockColors(page);
    const button = picker.getByTestId('block-color-swatch-recent-text-yellow');

    await button.hover();
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    const plate = await button.evaluate((el) => {
      const style = getComputedStyle(el, '::before');
      const host = el.getBoundingClientRect();
      const tile = el.firstElementChild?.getBoundingClientRect();

      if (tile === undefined) {
        throw new Error('tile missing');
      }
      const left = host.left + parseFloat(style.left);
      const right = host.right - parseFloat(style.right);
      const top = host.top + parseFloat(style.top);
      const bottom = host.bottom - parseFloat(style.bottom);

      return { left: tile.left - left, right: right - tile.right, top: tile.top - top, bottom: bottom - tile.bottom };
    });

    expect(plate.left).toBeCloseTo(3, 1);
    expect(plate.right).toBeCloseTo(3, 1);
    expect(plate.top).toBeCloseTo(3, 1);
    expect(plate.bottom).toBeCloseTo(3, 1);
  });

  test('the picked row has a checkmark, no fill, and the same ink as the others', async ({ page }) => {
    await boot(page, EIGHT_RECENTS);
    const picker = await openBlockColors(page);
    const picked = picker.getByTestId('block-color-swatch-textColor-default');
    const other = picker.getByTestId('block-color-swatch-textColor-gray');

    // Park the pointer away from the rows: a hovered row is filled.
    await page.mouse.move(0, 0);
    await expect(picked).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const ink = await other.getByTestId('block-color-name').evaluate((el) => getComputedStyle(el).color);

    await expect(picked.getByTestId('block-color-name')).toHaveCSS('color', ink);
    await expect(picked.getByTestId('block-color-check')).toBeVisible();
    await expect(other.getByTestId('block-color-check')).toBeHidden();
    const check = await box(picked.getByTestId('block-color-check'));

    expect(check.width).toBeCloseTo(14, 1);
    // 2.25 on the icon's 20-unit box is about 1.6px at 14px: the weight of the name beside it.
    expect(await picked.getByTestId('block-color-check').evaluate((el) => {
      const stroke = el.firstElementChild?.firstElementChild;

      return stroke ? getComputedStyle(stroke).strokeWidth : null;
    })).toBe('2.25px');
  });

  test('rows are 28px tall with a 20px tile and a 14px regular name', async ({ page }) => {
    await boot(page, []);
    const picker = await openBlockColors(page);
    const row = picker.getByTestId('block-color-swatch-backgroundColor-orange');
    const rowBox = await box(row);
    const tile = await box(row.getByTestId('block-color-tile'));
    const name = row.getByTestId('block-color-name');

    expect(rowBox.height).toBeCloseTo(28, 1);
    expect(tile.width).toBeCloseTo(20, 1);
    expect(tile.height).toBeCloseTo(20, 1);
    await expect(name).toHaveText('Orange');
    await expect(name).toHaveCSS('font-size', '14px');
    await expect(name).toHaveCSS('font-weight', '400');
    expect((await box(name)).x - (tile.x + tile.width)).toBeCloseTo(8, 1);
    await expect(picker.getByRole('group', { name: 'Background color' })).toBeVisible();
    await expect(picker.getByTestId('block-color-section-recent')).toHaveCount(0);
  });

  test('the two columns sit side by side under the recent row', async ({ page }) => {
    await boot(page, EIGHT_RECENTS);
    const picker = await openBlockColors(page);
    const recent = await box(picker.getByTestId('block-color-section-recent'));
    const text = await box(picker.getByTestId('block-color-section-textColor'));
    const background = await box(picker.getByTestId('block-color-section-backgroundColor'));

    expect(text.y).toBeCloseTo(background.y, 1);
    expect(text.y).toBeGreaterThan(recent.y + recent.height);
    expect(background.x).toBeGreaterThan(text.x + text.width);
    expect(text.width).toBeCloseTo(background.width, 1);
  });

  test('recently used stays as it was until the block menu is opened again', async ({ page }) => {
    await boot(page, EIGHT_RECENTS);
    const picker = await openBlockColors(page);
    const before = await recentIds(picker);

    await picker.getByTestId('block-color-swatch-textColor-pink').click();
    await expect(picker.getByTestId('block-color-swatch-textColor-pink')).toHaveAttribute('aria-pressed', 'true');
    expect(await recentIds(picker)).toEqual(before);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    const reopened = await openBlockColors(page);

    expect(await recentIds(reopened)).toEqual(['block-color-swatch-recent-text-pink', ...before.slice(0, 7)]);
  });

  test('the inline color panel also waits for its next open', async ({ page }) => {
    await boot(page, [{ name: 'blue', field: 'text' }]);
    const paragraph = page.getByTestId('block-wrapper').locator('[contenteditable="true"]');
    const marker = page.locator('[data-blok-interface="inline-toolbar"] [data-blok-item-name="marker"]');
    const picker = page.getByTestId('marker-picker');
    const ids = async (): Promise<Array<string | null>> => picker.getByTestId('marker-section-recent').getByRole('button').evaluateAll(
      (buttons) => buttons.map((button) => button.getAttribute('data-blok-testid'))
    );

    await selectAllInEditable(paragraph);
    await marker.click();
    await picker.getByTestId('marker-swatch-color-red').click();
    expect(await ids()).toEqual(['marker-swatch-recent-text-blue']);

    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await selectAllInEditable(paragraph);
    await marker.click();
    await expect(picker).toBeVisible();
    expect(await ids()).toEqual(['marker-swatch-recent-text-red', 'marker-swatch-recent-text-blue']);
  });

  test('arrow keys walk the rows without closing the menu', async ({ page }) => {
    await boot(page, EIGHT_RECENTS);
    const picker = await openBlockColors(page);
    const focused = async (): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute('data-blok-testid') ?? null);

    await picker.getByTestId('block-color-swatch-backgroundColor-default').focus();
    await page.keyboard.press('ArrowDown');
    expect(await focused()).toBe('block-color-swatch-backgroundColor-gray');
    await page.keyboard.press('ArrowLeft');
    expect(await focused()).toBe('block-color-swatch-textColor-gray');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await focused()).toBe('block-color-swatch-recent-text-blue');
    await page.keyboard.press('ArrowRight');
    expect(await focused()).toBe('block-color-swatch-recent-text-yellow');
    await expect(picker).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(picker.getByTestId('block-color-swatch-textColor-yellow')).toHaveAttribute('aria-pressed', 'true');
  });
});

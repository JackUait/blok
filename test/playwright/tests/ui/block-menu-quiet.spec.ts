import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

interface Box { x: number; y: number; width: number; height: number; right: number }

const box = async (locator: Locator): Promise<Box> => {
  const bounds = await locator.boundingBox();

  if (bounds === null) {
    throw new Error('Element has no box');
  }

  return { ...bounds, right: bounds.x + bounds.width };
};

const style = (locator: Locator, property: string, pseudo?: string): Promise<string> =>
  locator.evaluate((el, [prop, ps]) => getComputedStyle(el, ps ?? undefined).getPropertyValue(prop), [property, pseudo ?? null] as const);

const openMenu = async (page: Page): Promise<Locator> => {
  await page.getByText('Every block has this menu.').click();
  await page.getByTestId('settings-toggler').click();
  const container = page.getByTestId('block-tunes-popover').getByTestId('popover-container').first();

  await expect(container).toBeVisible();
  await container.evaluate(async el => {
    // A cancelled animation rejects; either way it is over.
    await Promise.allSettled(el.getAnimations().map(animation => animation.finished));
  });

  return container;
};

const mount = async (page: Page, width: number): Promise<void> => {
  await page.setViewportSize({ width, height: 844 });
  await gotoTestPage(page);
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:120px auto';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [ { type: 'paragraph', data: { text: 'Every block has this menu.' } } ] },
    });
    await window.blokInstance.isReady;
  });
};

test.beforeEach(async ({ page }) => {
  await mount(page, 1280);
});

test('the block menu is a 264px card with 12px corners', async ({ page }) => {
  const container = await openMenu(page);

  expect((await box(container)).width).toBe(264);
  expect(await style(container, 'border-radius')).toBe('12px');
});

test('the search field is a soft fill with no glyph, and keeps the fill under a hairline while focused', async ({ page }) => {
  const container = await openMenu(page);
  const field = container.getByTestId('popover-search-field');
  const input = container.getByTestId('popover-search-input');

  await expect(input).toBeFocused();
  expect(await style(field, 'display', '::before')).toBe('none');
  expect(await style(field, 'border-top-color')).toBe('rgba(55, 53, 47, 0.09)');
  expect(await style(field, 'background-color')).toBe('rgba(55, 53, 47, 0.043)');
  expect(await style(field, 'border-radius')).toBe('6px');
  expect((await box(field)).height).toBe(30);
  expect(await style(input, 'font-size')).toBe('14px');
});

test('row icons and the search text start on one line, 3px apart for the glyph inset', async ({ page }) => {
  const container = await openMenu(page);
  const left = (await box(container)).x;
  const row = container.locator('[data-blok-item-name="copy-link"]');

  expect((await box(container.getByTestId('popover-search-input'))).x).toBe(left + 14);
  expect((await box(row.getByTestId('popover-item-icon').getByRole('img', { includeHidden: true }))).x).toBe(left + 11);
  expect((await box(row.getByTestId('popover-item-title'))).x).toBe(left + 37);
});

test('rows are 28px tall with regular 14px labels and 18px gray icons', async ({ page }) => {
  const container = await openMenu(page);
  const row = container.locator('[data-blok-item-name="copy-link"]');
  const next = container.locator('[data-blok-item-name="duplicate"]');
  const title = row.getByTestId('popover-item-title');
  const glyph = row.getByTestId('popover-item-icon').getByRole('img', { includeHidden: true });

  expect((await box(row)).height).toBe(28);
  expect((await box(next)).y - (await box(row)).y).toBe(28);
  expect(await style(title, 'font-weight')).toBe('400');
  expect(await style(title, 'font-size')).toBe('14px');
  expect(await style(title, 'color')).toBe('rgb(55, 53, 47)');
  expect((await box(glyph)).width).toBe(18);
  expect((await box(glyph)).height).toBe(18);
  expect(await style(glyph, 'color')).toBe('rgb(111, 110, 105)');
});

test('shortcuts and submenu arrows sit close to the right edge', async ({ page }) => {
  const container = await openMenu(page);
  const row = container.locator('[data-blok-item-name="copy-link"]');
  const shortcut = row.getByTestId('popover-item-secondary-title');
  const arrow = container.locator('[data-blok-item-name="convert-to"]').getByTestId('popover-item-chevron-right');

  expect((await box(shortcut)).right).toBe((await box(row)).right - 8);
  expect(await style(shortcut, 'font-size')).toBe('12px');
  expect((await box(arrow)).right).toBe((await box(row)).right - 5);
});

test('divider lines run from edge to edge', async ({ page }) => {
  const container = await openMenu(page);
  const card = await box(container);
  const separator = container.getByTestId('popover-item-separator').first();
  const line = await box(separator.locator('[data-blok-popover-item-separator-line]'));

  expect(line.x).toBe(card.x);
  expect(line.width).toBe(card.width);
  expect((await box(separator)).height).toBe(11);
});

test('the edit note is one line under the last divider', async ({ page }) => {
  const container = await openMenu(page);
  const note = container.locator('[data-blok-item-name="edit-metadata"]');
  const labelNode = note.locator('[data-edit-meta-label]');
  const label = await box(labelNode);
  const date = await labelNode.evaluate(el => {
    const next = el.nextElementSibling;

    if (next === null) {
      throw new Error('The edit note has no date');
    }
    const rect = next.getBoundingClientRect();

    return { x: rect.x, y: rect.y };
  });

  // The date follows the label on the same line.
  expect(date.y).toBe(label.y);
  expect(date.x).toBeGreaterThanOrEqual(label.right);
  expect(label.x).toBe((await box(container)).x + 14);
  expect(await style(note.locator('[data-edit-meta-label]'), 'font-size')).toBe('12px');
  await expect(note).toContainText(/Last edited\s*today, /);
});

test('Delete turns red with its icon and shortcut when pointed at', async ({ page }) => {
  const container = await openMenu(page);
  const row = container.locator('[data-blok-item-name="delete"]');

  await row.hover();
  const red = 'rgb(201, 54, 54)';

  await expect(row).toHaveCSS('color', red);
  await expect(row.getByTestId('popover-item-icon').getByRole('img', { includeHidden: true })).toHaveCSS('color', red);
  await expect(row.getByTestId('popover-item-secondary-title')).toHaveCSS('color', red);
});

test('dark theme keeps the soft label and solid gray icons', async ({ page }) => {
  await page.evaluate(() => document.documentElement.setAttribute('data-blok-theme', 'dark'));
  const container = await openMenu(page);
  const row = container.locator('[data-blok-item-name="copy-link"]');

  expect(await style(row.getByTestId('popover-item-title'), 'color')).toBe('rgb(214, 212, 207)');
  expect(await style(row.getByTestId('popover-item-icon').getByRole('img', { includeHidden: true }), 'color')).toBe('rgb(180, 179, 176)');
});

test('a submenu has the same rows as the menu', async ({ page }) => {
  const container = await openMenu(page);

  await container.locator('[data-blok-item-name="convert-to"]').hover();
  const row = page.getByTestId('block-tunes-popover').locator('[data-blok-nested="true"]').getByRole('menuitem', { name: 'Heading 1', exact: true });

  await expect(row).toBeVisible();
  // Layout height: the submenu may still be scaling in.
  expect(await row.evaluate(el => el instanceof HTMLElement ? el.offsetHeight : 0)).toBe(28);
  await expect(row.getByTestId('popover-item-title')).toHaveCSS('font-weight', '400');
  await expect(row.getByTestId('popover-item-icon').getByRole('img', { includeHidden: true })).toHaveCSS('color', 'rgb(111, 110, 105)');
});

test('a phone keeps the tall touch rows', async ({ page }) => {
  await mount(page, 390);
  const container = await openMenu(page);

  expect((await box(container.locator('[data-blok-item-name="copy-link"]'))).height).toBeGreaterThanOrEqual(44);
});

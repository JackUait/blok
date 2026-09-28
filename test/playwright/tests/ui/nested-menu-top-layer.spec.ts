import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
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

const TEXT = 'Nested menus sit above the host';

// Is the element painted at the centre of `target` inside `target` itself?
const isTopmost = (target: Locator): Promise<boolean> => target.evaluate(element => {
  const rect = element.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);

  return hit !== null && element.contains(hit);
});

const conversionMenu = (page: Page): Locator =>
  page.getByTestId('popover-container').filter({ has: page.locator('[data-blok-convert-item]') }).last();

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.evaluate(async text => {
    // A host header like the playground's: fixed, and as high as z-index goes.
    const header = document.createElement('header');

    header.style.cssText = 'position:fixed;inset:0 0 auto 0;height:150px;background:#fff;z-index:2147483647';
    document.body.appendChild(header);

    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:220px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ type: 'paragraph', data: { text } }] },
    });
    await window.blokInstance.isReady;
  }, TEXT);
});

test('inline toolbar submenu paints above a fixed host header', async ({ page }) => {
  await selectAllInEditable(page.getByText(TEXT, { exact: true }));
  await page.getByTestId('inline-toolbar').getByRole('menuitem', { name: 'Text', exact: true }).click();
  const menu = conversionMenu(page);
  const search = menu.getByTestId('popover-search-field');

  await expect(search).toBeVisible();
  // The tall list is clamped to the viewport top, under the header's 150px.
  expect((await search.boundingBox())?.y).toBeLessThan(150);
  await expect.poll(() => isTopmost(search)).toBe(true);
  await expect.poll(() => isTopmost(menu.getByRole('menuitem', { name: 'Heading 1', exact: true }))).toBe(true);

  // Still a working menu: a click on a row under the header converts the block.
  await menu.getByRole('menuitem', { name: 'Heading 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: TEXT, level: 1 })).toBeVisible();
});

test('inline toolbar submenu stays beside its trigger when the page scrolls', async ({ page }) => {
  // Room above and below, so the menu is not clamped to a viewport edge.
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.evaluate(() => {
    const holder = document.querySelector('[data-blok-interface]')?.parentElement;
    const above = document.createElement('div');
    const below = document.createElement('div');

    above.style.height = '500px';
    below.style.height = '2000px';
    holder?.before(above);
    document.body.appendChild(below);
  });
  await selectAllInEditable(page.getByText(TEXT, { exact: true }));
  const trigger = page.getByTestId('inline-toolbar').getByRole('menuitem', { name: 'Text', exact: true });

  await trigger.click();
  const menu = conversionMenu(page);

  await expect(menu).toBeVisible();
  // Top layer: fixed to the viewport, so it must follow the page by itself.
  await expect.poll(() => menu.evaluate(element => {
    const mount = element.closest('[data-blok-top-layer]');

    return mount === null ? 'none' : getComputedStyle(mount).position;
  })).toBe('fixed');

  const gap = async (): Promise<number> => {
    const [menuBox, triggerBox] = await Promise.all([menu.boundingBox(), trigger.boundingBox()]);

    return (menuBox?.y ?? 0) - (triggerBox?.y ?? 0);
  };
  // The entrance animation moves the card; measure where it settles.
  await menu.evaluate(async element => {
    const animations = element.closest('[data-blok-popover]')?.getAnimations({ subtree: true }) ?? [];

    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
  });
  const before = await gap();

  await page.evaluate(() => window.scrollBy(0, 60));
  await expect.poll(async () => Math.abs((await gap()) - before)).toBeLessThanOrEqual(1);
});

test('block settings submenu paints above a fixed host header', async ({ page }) => {
  await page.getByText(TEXT, { exact: true }).click();
  await page.getByTestId('settings-toggler').click();
  await page.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
  const search = conversionMenu(page).getByTestId('popover-search-field');

  await expect(search).toBeVisible();
  await expect.poll(() => isTopmost(search)).toBe(true);
});

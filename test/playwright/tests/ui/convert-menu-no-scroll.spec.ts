import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const TEXT = 'Turn me into something';
const MENU = process.platform === 'darwin' ? 'Meta+/' : 'Control+/';
// The list used to stop at this height and scroll.
const OLD_CAP = 520;

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.evaluate(async text => {
    const holder = document.createElement('div');

    holder.id = 'convert-menu-no-scroll';
    holder.style.cssText = 'max-width:650px;margin:40px auto';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ type: 'header', data: { text, level: 5 } }] },
    });
    await window.blokInstance.isReady;
  }, TEXT);
});

const measure = (list: Locator): Promise<{ overflow: number; height: number; top: number; bottom: number }> =>
  list.evaluate(async element => {
    const popover = element.closest('[data-blok-popover]');

    await Promise.all((popover?.getAnimations({ subtree: true }) ?? []).map(animation => animation.finished.catch(() => undefined)));
    const container = element.closest('[data-blok-popover-container]');
    const items = container?.querySelector(':scope > [data-blok-popover-items]');

    if (container === null || container === undefined || items === null || items === undefined) {
      throw new Error('convert menu container or items are missing');
    }
    const box = container.getBoundingClientRect();

    return { overflow: items.scrollHeight - items.clientHeight, height: box.height, top: box.top, bottom: box.bottom };
  });

test('Turn into shows every option without scrolling', async ({ page }) => {
  await page.getByText(TEXT, { exact: true }).click();
  await page.keyboard.press(MENU);
  await page.getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  const heading = page.getByRole('menuitem', { name: 'Heading 1', exact: true });

  await expect(heading).toBeVisible();
  const size = await measure(heading);

  expect(size.overflow).toBe(0);
  expect(size.height).toBeGreaterThan(OLD_CAP);
  expect(size.top).toBeGreaterThanOrEqual(0);
  expect(size.bottom).toBeLessThanOrEqual(900);
});

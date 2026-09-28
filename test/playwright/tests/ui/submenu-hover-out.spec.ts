import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const TEXT = 'Hover out of the menu';

const hoverRow = async (page: Page, row: Locator): Promise<void> => {
  const box = await row.boundingBox();

  if (box === null) {
    throw new Error('Row has no box');
  }
  await page.mouse.move(box.x + 24, box.y + box.height / 2, { steps: 6 });
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoTestPage(page);
  await page.evaluate(async text => {
    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:200px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: [{ type: 'paragraph', data: { text } }] } });
    await window.blokInstance.isReady;
  }, TEXT);
  await page.getByText(TEXT, { exact: true }).click();
  await page.getByTestId('settings-toggler').click();
});

for (const [name, keyboardFirst] of [['Convert to', false], ['Color', false], ['Color', true]] as const) {
  test(`"${name}" submenu closes and its row clears when the pointer leaves the menu${keyboardFirst ? ' (after a key press)' : ''}`, async ({ page }) => {
    const menu = page.getByTestId('block-tunes-popover');
    const row = menu.getByRole('menuitem', { name, exact: true });

    if (keyboardFirst) {
      // A key press leaves the page in keyboard modality, so the submenu
      // focuses its first swatch on open, like in the reported recording.
      await page.keyboard.press('Shift');
    }
    await hoverRow(page, row);
    await expect(page.locator('[data-blok-nested="true"]')).toHaveCount(1);
    await expect(row).toHaveAttribute('data-blok-popover-item-children-open', /.*/);
    // A hover open is a pointer gesture: no keyboard cursor on a row or swatch.
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement;
      const nested = document.querySelector('[data-blok-nested="true"]');

      return nested !== null && active !== null && nested.contains(active) && !(active instanceof HTMLInputElement);
    })).toBe(false);
    await expect(page.locator('[data-blok-nested="true"] [data-blok-focused="true"]')).toHaveCount(0);

    await page.mouse.move(1200, 860, { steps: 8 });

    await expect(page.locator('[data-blok-nested="true"]')).toHaveCount(0);
    await expect(row).not.toHaveAttribute('data-blok-popover-item-children-open', /.*/);
    await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
}

test('resting on a plain row closes the open submenu and lights that row', async ({ page }) => {
  const menu = page.getByTestId('block-tunes-popover');
  const convert = menu.getByRole('menuitem', { name: 'Convert to', exact: true });
  const remove = menu.getByRole('menuitem', { name: 'Delete', exact: true });

  await hoverRow(page, convert);
  await expect(page.locator('[data-blok-nested="true"]')).toHaveCount(1);
  await hoverRow(page, remove);

  await expect(page.locator('[data-blok-nested="true"]')).toHaveCount(0);
  await expect(convert).not.toHaveAttribute('data-blok-popover-item-children-open', /.*/);
  await expect(remove).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

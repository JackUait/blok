import { expect, test } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoTestPage(page);
  await page.evaluate(async () => {
    localStorage.removeItem('blok-recent-colors');
    const holder = document.createElement('div');

    holder.style.cssText = 'max-width:650px;margin:120px auto;padding:0 8px';
    document.body.append(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ type: 'paragraph', data: { text: 'A color of my own.' } }] },
    });
    await window.blokInstance.isReady;
  });
});

test('inline color tabs use native focus and keep hidden swatches out of the tab order', async ({ page }) => {
  const paragraph = page.getByTestId('block-wrapper').locator('[contenteditable="true"]');

  await selectAllInEditable(paragraph);
  await page.locator('[data-blok-interface="inline-toolbar"] [data-blok-item-name="marker"]').click();
  const picker = page.getByTestId('marker-picker');
  const tabs = picker.getByRole('tab');

  await expect(tabs).toHaveCount(2);
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.last()).toBeFocused();
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await expect(picker.getByRole('tabpanel')).toHaveCount(1);

  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    const hiddenFocus = await picker.evaluate(element =>
      Array.from(element.querySelectorAll('[role="tabpanel"][hidden]'))
        .some(panel => panel.contains(document.activeElement))
    );

    expect(hiddenFocus).toBe(false);
  }
  await picker.getByTestId('marker-swatch-background-color-blue').click();
  await expect.poll(() => paragraph.innerHTML()).toMatch(/style="[^"]*background-color:\s*var\(--blok-color-blue-bg\)/);
  await expect(paragraph).toHaveText('A color of my own.');
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
});

test('block color modes, recents and reset remain independent', async ({ page }) => {
  await page.getByTestId('block-wrapper').locator('[contenteditable="true"]').click();
  await page.getByTestId('settings-toggler').click();
  await page.getByRole('menuitem', { name: 'Color', exact: true }).click();
  const picker = page.getByTestId('block-color-picker');

  await expect(picker).toBeVisible();
  await picker.getByTestId('block-color-swatch-textColor-red').click();
  await picker.getByRole('tab').last().click();
  await picker.getByTestId('block-color-swatch-backgroundColor-blue').click();
  const data = async () => page.evaluate(async () => (await window.blokInstance.save()).blocks[0].data);

  await expect.poll(data).toMatchObject({ textColor: 'red', backgroundColor: 'blue' });
  await expect(picker.getByTestId('block-color-section-recent')).toBeVisible();
  await picker.getByTestId('block-color-reset-backgroundColor').click();
  await expect.poll(data).toMatchObject({ textColor: 'red' });
  await expect.poll(async () => (await data()).backgroundColor).toBeUndefined();
  await picker.getByRole('tab').first().click();
  await expect(picker.getByTestId('block-color-swatch-textColor-red')).toHaveAttribute('aria-pressed', 'true');
});

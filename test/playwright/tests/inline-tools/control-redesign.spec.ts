import { expect, test } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

for (const width of [1280, 390, 320]) {
  test(`formatting stays compact, reachable and preserves selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await gotoTestPage(page);
    await page.evaluate(async () => {
      const holder = document.createElement('div');

      holder.id = 'control-redesign';
      holder.style.cssText = 'max-width:650px;margin:120px auto;padding:0 8px';
      document.body.appendChild(holder);
      window.blokInstance = new window.Blok({
        holder,
        data: { blocks: [{ type: 'paragraph', data: { text: 'Make these words yours.' } }] },
      });
      await window.blokInstance.isReady;
    });
    const paragraph = page.getByTestId('block-wrapper').filter({ hasText: 'Make these words yours.' })
      .locator('[contenteditable="true"]');

    await selectAllInEditable(paragraph);
    const toolbar = page.locator('[data-blok-interface="inline-toolbar"]');
    const convert = toolbar.locator('[data-blok-item-name="convert-to"]');
    const bold = toolbar.getByRole('menuitemcheckbox', { name: 'Bold', exact: true });

    await expect(bold).toBeVisible();
    const header = await convert.boundingBox();
    const controls = await toolbar.locator('[data-blok-popover-item]:not([data-blok-item-name="convert-to"])')
      .evaluateAll(elements => elements.map(el => {
        const rect = el.getBoundingClientRect();

        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }));

    if (header === null || controls.length === 0) {
      throw new Error('Missing toolbar controls');
    }

    for (const control of controls) {
      expect(control.width).toBeGreaterThanOrEqual(40);
      expect(control.height).toBeGreaterThanOrEqual(40);
      expect(control.x).toBeGreaterThanOrEqual(0);
      expect(control.x + control.width).toBeLessThanOrEqual(width);
      expect(control.y).toBeCloseTo(controls[0].y, 0);
      const rowTop = width > 650 ? header.y : header.y + header.height;

      expect(control.y).toBeGreaterThanOrEqual(rowTop);
      expect(control.y).toBeLessThanOrEqual(rowTop + 2);
    }

    await bold.click();
    await expect.poll(() => paragraph.innerHTML()).toMatch(/^<(b|strong)>Make these words yours\.<\/\1>$/);
  });
}

test('configured formatting order stays intact in the compact bar', async ({ page }) => {
  await gotoTestPage(page);
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      inlineToolbar: ['underline', 'bold', 'italic'],
      data: { blocks: [{ type: 'paragraph', data: { text: 'Keep my tools in order.' } }] },
    });
    await window.blokInstance.isReady;
  });
  const paragraph = page.getByTestId('block-wrapper').filter({ hasText: 'Keep my tools in order.' })
    .locator('[contenteditable="true"]');

  await selectAllInEditable(paragraph);
  const tools = page.locator('[data-blok-interface="inline-toolbar"]').getByRole('menuitemcheckbox');

  await expect(tools).toHaveCount(3);
  await expect(tools.nth(0)).toHaveAccessibleName('Underline');
  await expect(tools.nth(1)).toHaveAccessibleName('Bold');
  await expect(tools.nth(2)).toHaveAccessibleName('Italic');
  await page.keyboard.press('Tab');
  await expect(tools.nth(0)).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tools.nth(1)).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tools.nth(0)).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => paragraph.innerHTML()).toBe('<u>Keep my tools in order.</u>');
});

for (const top of [480, 490, 495, 500, 505, 510, 520, 540, 560]) {
  test('wrapped toolbar stays inside a narrow editor viewport at ' + top + 'px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 620 });
    await gotoTestPage(page);
    await page.evaluate(async (offset) => {
      const holder = document.createElement('div');

      holder.style.cssText = 'position:absolute;left:8px;top:' + offset + 'px;width:180px';
      document.body.append(holder);
      window.blokInstance = new window.Blok({
        holder,
        minHeight: 0,
        data: { blocks: [{ type: 'paragraph', data: { text: 'Keep me visible.' } }] },
      });
      await window.blokInstance.isReady;
    }, top);
    const paragraph = page.getByTestId('block-wrapper').filter({ hasText: 'Keep me visible.' })
      .locator('[contenteditable="true"]');

    await selectAllInEditable(paragraph);
    const toolbar = page.locator('[data-blok-interface="inline-toolbar"]');
    const bold = toolbar.getByRole('menuitemcheckbox', { name: 'Bold', exact: true });

    await expect(bold).toBeVisible();
    const rects = await toolbar.locator('[data-blok-popover-item]')
      .or(toolbar.getByTestId('popover-container')).evaluateAll(elements =>
        elements.map(element => {
          const rect = element.getBoundingClientRect();

          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
        })
      );

    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(8);
      expect(rect.y).toBeGreaterThanOrEqual(8);
      expect(rect.right).toBeLessThanOrEqual(382);
      expect(rect.bottom).toBeLessThanOrEqual(612);
    }
    await bold.click();
    await expect.poll(() => paragraph.innerHTML()).toMatch(/^<(b|strong)>Keep me visible\.<\/\1>$/);
  });
}

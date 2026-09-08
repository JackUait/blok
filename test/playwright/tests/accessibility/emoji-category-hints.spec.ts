import { expect, test } from '@playwright/test';

import { TEST_PAGE_URL } from '../helpers/ensure-build';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    holder.id = 'category-hints';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ type: 'callout', data: { emoji: '💡' } }] },
    });
    await window.blokInstance.isReady;
  });
  await page.getByTestId('callout-emoji-btn').click();
  await expect(page.getByRole('dialog', { name: 'Edit icon' })).toBeVisible();
});

for (const category of ['callout', 'people', 'nature', 'foods', 'activity', 'places', 'objects', 'symbols', 'flags']) {
  test(`delays the ${category} category hint and dismisses it when clicked`, async ({ page }) => {
    const picker = page.getByRole('dialog', { name: 'Edit icon' });
    const buttons = picker.locator('[data-emoji-nav]');
    const button = picker.locator(`[data-emoji-nav="${category}"]`);
    const tooltip = page.getByRole('tooltip');

    await expect(buttons).toHaveCount(9);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.mouse.move(0, 0);
    await page.clock.runFor(400);
    await button.hover();
    await page.clock.runFor(299);
    await expect(tooltip).not.toBeVisible();
    await page.clock.runFor(1);
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(await button.getAttribute('aria-label') ?? '');
    await expect(button).not.toHaveAttribute('title');
    await button.click();
    await expect(tooltip).not.toBeVisible();
    await expect(picker).toBeVisible();
  });
}

for (const elapsed of [250, 299]) {
  test(`cancels a category hint when the pointer leaves at ${elapsed}ms`, async ({ page }) => {
    const category = page.getByRole('dialog', { name: 'Edit icon' }).locator('[data-emoji-nav]').first();
    const tooltip = page.getByRole('tooltip');

    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.mouse.move(0, 0);
    await page.clock.runFor(400);
    await category.hover();
    await page.clock.runFor(elapsed);
    await page.mouse.move(0, 0);
    await page.clock.runFor(300 - elapsed);
    await expect(tooltip).not.toBeVisible();
    await page.clock.runFor(1000);
    await expect(tooltip).not.toBeVisible();
    await expect(category).not.toHaveAttribute('aria-describedby');
  });
}

test('shows a category hint on keyboard focus and closes it with Escape', async ({ page }) => {
  const picker = page.getByRole('dialog', { name: 'Edit icon' });
  const category = picker.locator('[data-emoji-nav]').last();

  await page.mouse.move(0, 0);
  await picker.getByRole('searchbox').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(category).toBeFocused();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(page.getByRole('tooltip')).toHaveText(await category.getAttribute('aria-label') ?? '');
  await expect(category).toHaveAttribute('aria-describedby');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).not.toBeVisible();
});

test('keeps category hints attached and inside the viewport at each corner', async ({ page }) => {
  const picker = page.getByRole('dialog', { name: 'Edit icon' });

  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    await page.mouse.move(0, 0);
    await picker.evaluate((element, position) => {
      element.style.setProperty('position', 'fixed');
      element.style.setProperty('left', position.endsWith('left') ? '8px' : 'auto');
      element.style.setProperty('right', position.endsWith('right') ? '8px' : 'auto');
      element.style.setProperty('top', position.startsWith('top') ? '8px' : 'auto');
      element.style.setProperty('bottom', position.startsWith('bottom') ? '8px' : 'auto');
    }, corner);
    const category = picker.locator('[data-emoji-nav]').nth(corner.endsWith('left') ? 0 : 8);
    const anchor = await category.boundingBox();

    if (anchor === null) {
      throw new Error('Category button has no box');
    }
    await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
    const tooltip = page.getByRole('tooltip');

    await expect(tooltip).toBeVisible();
    await expect.poll(async () => tooltip.evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return rect.left >= 0 && rect.top >= 0
        && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
    })).toBe(true);
    const bubble = await tooltip.boundingBox();

    if (bubble === null) {
      throw new Error('Category hint has no box');
    }
    expect(Math.min(Math.abs(bubble.y + bubble.height - anchor.y), Math.abs(anchor.y + anchor.height - bubble.y))).toBeLessThan(24);
    await category.click();
    await expect(tooltip).not.toBeVisible();
  }
});

test('does not reveal a pending hint after the picker closes', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.mouse.move(0, 0);
  await page.clock.runFor(400);
  await page.getByRole('dialog', { name: 'Edit icon' }).locator('[data-emoji-nav]').last().hover();
  await page.clock.runFor(100);
  await page.keyboard.press('Escape');
  await page.clock.runFor(400);
  await expect(page.getByRole('dialog', { name: 'Edit icon' })).not.toBeVisible();
  await expect(page.getByRole('tooltip')).not.toBeVisible();
});

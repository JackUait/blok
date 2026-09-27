import { expect, gotoTestPage, test } from '../helpers/shared-page';

test('in-place reset removes an added body heading but keeps the fixture heading', async ({ page }) => {
  await gotoTestPage(page);

  await page.evaluate(() => {
    const heading = document.createElement('h1');

    heading.textContent = 'Added test heading';
    document.body.appendChild(heading);
    Object.assign(window, { __sharedPageResetMarker: true });
  });

  await expect(page.getByRole('heading', { name: 'Added test heading', level: 1 })).toBeVisible();
  await gotoTestPage(page);

  await expect(page.getByRole('heading', { name: 'Added test heading', level: 1 })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Blok test page', level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => '__sharedPageResetMarker' in window)).toBe(true);
});

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { gotoTestPage } from '../helpers/shared-page';

/**
 * The empty media surface must hold longer translations at the narrowest
 * width: the sentence wraps, the buttons wrap, and nothing leaves the surface.
 */
const TOOLS = ['image', 'video', 'audio', 'file'] as const;

const mount = async (page: Page, locale: string, width: number): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async ({ lang, w }) => {
    // @ts-expect-error built bundle has no TS types — runtime-only dynamic import
    const tools = await import('/dist/tools.mjs?_v=1') as Record<string, new (...args: unknown[]) => unknown>;
    const holder = document.createElement('div');

    holder.style.cssText = `max-width:${w}px;margin:10px auto 0`;
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      i18n: { locale: lang },
      tools: {
        image: { class: tools.Image, config: { maxSize: 10 * 1024 * 1024 } },
        video: { class: tools.Video, config: { maxSize: 2 * 1024 * 1024 * 1024 } },
        audio: { class: tools.Audio, config: { maxSize: 200 * 1024 * 1024 } },
        file: { class: tools.File },
      },
      data: { blocks: [ { type: 'image', data: {} }, { type: 'video', data: {} }, { type: 'audio', data: {} }, { type: 'file', data: {} } ] },
    });
    await window.blokInstance.isReady;
  }, { lang: locale, w: width });
};

const within = async (part: Locator, surface: Locator): Promise<boolean> => {
  const rect = await part.boundingBox();
  const box = await surface.boundingBox();

  return rect !== null && box !== null
    && rect.x >= box.x - 0.5 && rect.x + rect.width <= box.x + box.width + 0.5
    && rect.y >= box.y - 0.5 && rect.y + rect.height <= box.y + box.height + 0.5;
};

for (const locale of ['ru', 'de'] as const) {
  test(`${locale} at 320px: the sentence and both buttons stay inside every media surface`, async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 1600 });
    await mount(page, locale, 320);

    for (const tool of TOOLS) {
      const surface = page.locator(`[data-blok-tool="${tool}"]`).getByRole('group');
      const buttons = surface.getByRole('button');

      await expect(buttons, tool).toHaveCount(2);
      expect(await within(buttons.nth(0), surface), `${tool} choose`).toBe(true);
      expect(await within(buttons.nth(1), surface), `${tool} link`).toBe(true);
      expect(await surface.evaluate((el) => el.scrollWidth <= el.clientWidth), `${tool} overflow`).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('ru at 320px: the open link field fits, with its cross', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 1600 });
  await mount(page, 'ru', 320);

  const surface = page.locator('[data-blok-tool="video"]').getByRole('group');

  // proves the locale loaded: the surface is named in Russian
  await expect(page.getByRole('group', { name: 'Добавьте видео' })).toBeVisible();
  await surface.getByRole('button').nth(1).click();
  const field = surface.getByRole('textbox');

  await field.fill('https://www.youtube.com/watch?v=KPkkRuAbCdE&list=PL9tY0BWXOZFt&index=4');
  await expect(surface.getByRole('button')).toHaveCount(2);
  expect(await within(field, surface)).toBe(true);
  expect(await within(surface.getByRole('button').nth(0), surface)).toBe(true);
  expect(await within(surface.getByRole('button').nth(1), surface)).toBe(true);
});

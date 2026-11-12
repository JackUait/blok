import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoTestPage } from '../helpers/shared-page';

/**
 * While a file uploads, the block keeps the empty state's surface. A long file
 * name must give way: it ellipsizes, and the percent and the cancel cross stay
 * inside the surface.
 */
const LONG_NAME = `${'a-very-long-file-name-that-goes-on-and-on-'.repeat(3)}quarterly-report-final-v7.pdf`;

const mountHeldUpload = async (page: Page, width: number): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async ({ w }) => {
    // @ts-expect-error built bundle has no TS types — runtime-only dynamic import
    const tools = await import('/dist/tools.mjs?_v=1') as Record<string, new (...args: unknown[]) => unknown>;
    const holder = document.createElement('div');

    holder.style.cssText = `max-width:${w}px;margin:10px auto 0`;
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      tools: {
        file: {
          class: tools.File,
          // Reports 60% and never finishes, so the uploading state stays on screen.
          config: { uploader: { uploadByFile: (_file: File, options?: { onProgress?: (percent: number) => void }) => new Promise(() => options?.onProgress?.(60)) } },
        },
      },
      data: { blocks: [ { type: 'file', data: {} } ] },
    });
    await window.blokInstance.isReady;
  }, { w: width });
  await page.getByTestId('file-input').setInputFiles({ name: LONG_NAME, mimeType: 'application/pdf', buffer: Buffer.from('x') });
};

for (const [label, width, viewport] of [['760px', 760, 900], ['320px', 320, 380]] as const) {
  test(`uploading surface at ${label}: a long file name ellipsizes and nothing leaves the surface`, async ({ page }) => {
    await page.setViewportSize({ width: viewport, height: 700 });
    await mountHeldUpload(page, width);

    const surface = page.locator('[data-role="uploading"]');
    const name = surface.locator('[data-role="filename"]');
    const percent = surface.locator('[data-role="pct"]');
    const cancel = surface.getByRole('button', { name: 'Cancel upload' });

    await expect(percent).toHaveText('60%');
    await expect(surface.locator('[data-blok-media-preview="file"]')).toBeVisible();
    await expect(surface.getByRole('progressbar')).toBeVisible();

    const box = await surface.boundingBox();
    const inside = async (part: typeof name): Promise<boolean> => {
      const rect = await part.boundingBox();

      return rect !== null && box !== null
        && rect.x >= box.x && rect.x + rect.width <= box.x + box.width
        && rect.y >= box.y && rect.y + rect.height <= box.y + box.height;
    };

    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await inside(name)).toBe(true);
    expect(await inside(percent)).toBe(true);
    expect(await inside(cancel)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

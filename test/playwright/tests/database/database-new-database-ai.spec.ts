/**
 * The "New database" panel's AI prompt (research/26 §2, research/20 §1a), with a
 * stub `ai.setupDatabase` in place of the host's model.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    setupPrompts?: string[];
  }
}

const mount = async (page: Page, withLever: boolean): Promise<void> => {
  await page.evaluate(async (lever) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.setupPrompts = [];
    const ai = {
      autofill: () => Promise.resolve(undefined),
      setupDatabase: (request: { prompt: string }) => {
        window.setupPrompts?.push(request.prompt);

        return Promise.resolve({
          title: 'Trips',
          schema: [
            { id: 'h-title', name: 'Trip', type: 'title', position: 'a0' },
            { id: 'p-when', name: 'When', type: 'date', position: 'a1' },
          ],
        });
      },
    };

    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ id: 'p0', type: 'paragraph', data: { text: '' } }] },
      tools: {
        database: {
          class: (window as unknown as Record<string, unknown>).BlokDatabase,
          config: lever ? { ai } : {},
        },
        'database-row': { class: (window as unknown as Record<string, unknown>).BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, withLever);
};

const insertDatabase = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p0"] [contenteditable]').focus();
  await page.keyboard.type('/database');
  const toolbox = page.getByTestId('toolbox-popover');

  const item = toolbox.locator('[data-blok-item-name="database"]:visible');

  await expect(item).toContainText('Database');
  await item.click();
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('a new database opens "New database" with the prompt focused; the host answer builds it', async ({ page }) => {
  await mount(page, true);
  await insertDatabase(page);

  const panel = page.getByTestId('database-new-database-panel');
  const prompt = panel.getByRole('textbox', { name: 'Describe what you want to build' });
  const send = panel.getByRole('button', { name: 'Send' });

  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('width', '290px');
  await expect(panel.getByText('New database', { exact: true })).toBeVisible();
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveAttribute('placeholder', 'Describe what you want to build');
  await expect(send).toHaveAttribute('aria-disabled', 'true');
  await expect(panel.getByText('New empty data source')).toBeVisible();
  await expect(panel.getByText('Link to existing data source')).toBeVisible();

  const box = await panel.locator('[data-blok-database-ai-prompt]').evaluate((el) => {
    const style = getComputedStyle(el);

    // offset sizes: the opening animation scales the panel.
    return { width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight, radius: style.borderTopLeftRadius, border: style.borderTopWidth };
  });

  expect(box).toEqual({ width: 268, height: 56, radius: '12px', border: '1px' });
  expect(await send.evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight])).toEqual([20, 20]);

  await page.keyboard.type('Plan my trips');
  await expect(send).not.toHaveAttribute('aria-disabled');
  await page.keyboard.press('Enter');

  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => window.setupPrompts)).toEqual(['Plan my trips']);
  await expect(page.getByRole('columnheader', { name: 'When' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Trip' })).toBeVisible();

  const database = (await saved(page)).find((block) => block.type === 'database');
  const data = database?.data as { title?: string; schema?: Array<{ name: string; type: string }> } | undefined;

  expect(data?.title).toBe('Trips');
  expect(data?.schema?.map((p) => [p.name, p.type])).toEqual([['Trip', 'title'], ['When', 'date']]);
});

test('without the host lever a new database opens no panel', async ({ page }) => {
  await mount(page, false);
  await insertDatabase(page);

  await expect(page.locator('[data-blok-tool="database"]').first()).toBeVisible();
  // The panel would open a frame after the insert.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByTestId('database-new-database-panel')).toHaveCount(0);
});

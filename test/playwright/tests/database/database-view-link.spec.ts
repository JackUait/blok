/**
 * "Copy link to view" in a database's view settings, and opening that link.
 * Measured: docs/plans/2026-10-09-database-notion-parity/research/08-notion-signed-in-measurements.md
 * (View settings rows) and research/13-notion-tabs-extras.md §3b.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const view = (id: string, name: string, position: string): Record<string, unknown> =>
  ({ id, name, type: 'table', position, sorts: [], filters: [], visibleProperties: [] });

const blocks: OutputBlockData[] = [
  {
    id: 'db-link',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [view('vl-main', 'Main', 'a0'), view('vl-second', 'Second', 'a1')],
      activeViewId: 'vl-main',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-link', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, blocks);
  await expect(page.getByRole('grid').first()).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('database view link', () => {
  test('opens a copied view link on that view', async ({ page }) => {
    await mount(page);
    // A stub, so the copy reads the same in every browser without a permission prompt.
    await page.evaluate(() => {
      const copied: string[] = [];

      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
      (window as unknown as { copied: string[] }).copied = copied;
    });

    await page.getByRole('tab', { name: 'Second' }).click();
    await expect(page.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('database-toolbar-settings').click();
    await page.getByRole('button', { name: 'Copy link to view' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { copied: string[] }).copied.length)).toBe(1);
    const link = await page.evaluate(() => (window as unknown as { copied: string[] }).copied[0]);

    expect(new URL(link).hash).toBe('#view-vl-second');

    await page.evaluate((url) => window.history.replaceState(null, '', url), link);
    try {
      // The saved data still says Main is active: only the link picks Second.
      await mount(page);

      await expect(page.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: 'Main' })).toHaveAttribute('aria-selected', 'false');
    } finally {
      await page.evaluate(() => window.history.replaceState(null, '', window.location.pathname));
    }
  });
});

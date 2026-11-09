/**
 * Board column header controls, read from the browser:
 * - the hidden ⋯ and + take no pointer, but the keyboard still reaches and shows them (notion-motion.md "Round 8");
 * - the header holds no other control: Notion's has none.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const blocks: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
        {
          id: 'p-stage',
          name: 'Stage',
          type: 'select',
          position: 'a1',
          config: { options: [
            { id: 'o-todo', label: 'Not started', color: 'gray', position: 'a0' },
            { id: 'o-doing', label: 'In progress', color: 'blue', position: 'a1' },
          ] },
        },
      ],
      views: [{ id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-name': 'Alpha', 'p-stage': 'o-todo' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, blocks);
  await expect(page.locator('[data-blok-database-column]').first()).toBeVisible();
};

/** The element the pointer would hit at the centre of `target`, and whether it is `target` or inside it. */
const hitsCentre = async (target: Locator): Promise<boolean> => target.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

  return hit !== null && el.contains(hit);
});

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('the hidden ⋯ and + take no pointer, and the keyboard still reaches and shows them', async ({ page }) => {
  await mount(page);
  await page.mouse.move(2, 880);
  const column = page.locator('[data-blok-database-column][data-option-id="o-todo"]');
  const more = column.getByRole('button', { name: 'More group options' });
  const add = column.locator('[data-blok-database-column-new-page]');
  const actions = column.locator('[data-blok-database-column-actions]');

  await expect(actions).toHaveCSS('opacity', '0');
  expect(await hitsCentre(more)).toBe(false);
  expect(await hitsCentre(add)).toBe(false);

  // Blok keeps Tab outside a keyboard owner, so the way in is Shift+Tab out of the cards.
  await column.locator('[data-blok-database-card]').first().focus();
  await page.keyboard.press('Shift+Tab');

  await expect(add).toBeFocused();
  await expect(actions).toHaveCSS('opacity', '1');
  expect(await hitsCentre(add)).toBe(true);
});

test('the header holds only the count, ⋯ and +', async ({ page }) => {
  await mount(page);
  const header = page.locator('[data-blok-database-column][data-option-id="o-todo"] [data-blok-database-column-header]');

  await header.hover();
  await expect(header.getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Delete column' })).toHaveCount(0);
});

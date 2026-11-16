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

// notion-motion.md Round 35 (r35-groupmenu.raw): the menu opens with "Edit groups" in the hover tint, with no ring.
// The tint then follows the pointer, so one row is filled at a time.
test('the group ⋯ menu opens with its first row filled, and the fill follows the pointer', async ({ page }) => {
  await mount(page);
  const column = page.locator('[data-blok-database-column][data-option-id="o-doing"]');

  await column.locator('[data-blok-database-column-header]').hover();
  await column.getByRole('button', { name: 'More group options' }).click();

  const menu = page.locator('[data-blok-popover-custom-class~="blok-database-group-menu"][data-blok-popover-opened="true"]');
  const rows = menu.locator('[data-blok-popover-item]:visible');
  const filled = menu.locator('[data-blok-popover-item][data-blok-focused="true"]');

  await expect(filled).toHaveCount(1);
  await expect(filled).toHaveAttribute('data-blok-item-name', 'edit-groups');
  await expect(filled).toHaveCSS('outline-style', 'none');

  const hoverFill = await rows.nth(2).evaluate((el) => {
    const probe = document.createElement('div');

    probe.style.backgroundColor = 'var(--blok-item-hover-bg)';
    el.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;

    probe.remove();

    return color;
  });

  await expect(filled).toHaveCSS('background-color', hoverFill);

  await rows.nth(2).hover();

  await expect(filled).toHaveCount(1);
  await expect(rows.nth(2)).toHaveAttribute('data-blok-focused', 'true');
  await expect(rows.nth(0)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

// notion-motion.md Round 53 §9A: near the window's right edge Notion's group menu keeps to the button's
// left, slid in to 12 from the window (x 1320 of 1512), instead of turning to end at the button.
test('the group ⋯ menu near the right edge slides in to 12 from the window', async ({ page }) => {
  await mount(page);
  const column = page.locator('[data-blok-database-column][data-option-id="o-doing"]');
  const header = column.locator('[data-blok-database-column-header]');
  const more = column.getByRole('button', { name: 'More group options' });

  await header.hover();
  const button = await more.boundingBox();

  if (button === null) throw new Error('no ⋯ button');
  // The holder is centred, so move it to put the button 100 from the window's end.
  const width = 1400;
  const shift = Math.round(width - 100 - (button.x + button.width));

  await page.evaluate((dx) => {
    const holder = document.getElementById('blok');

    if (holder !== null) holder.style.transform = `translateX(${dx}px)`;
  }, shift);
  await header.hover();
  await more.click();

  const menu = page.locator('[data-blok-popover-custom-class~="blok-database-group-menu"][data-blok-popover-opened="true"] [data-blok-popover-container]');

  await expect(menu).toBeVisible();
  // Read it at rest: it opens from scale 0.96.
  await menu.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  const box = await menu.boundingBox();
  const moved = await more.boundingBox();

  if (box === null || moved === null) throw new Error('no menu');
  expect(box.x + box.width).toBeCloseTo(width - 12, 0);
  expect(box.x).toBeGreaterThan(moved.x + moved.width - box.width);
});

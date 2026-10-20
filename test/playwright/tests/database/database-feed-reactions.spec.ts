/**
 * Feed card reactions (research/19 §2c, §2b, §2e): pills, Add reaction with
 * the full picker, the hover React and More actions. Checks the saved JSON.
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

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Feed', type: 'feed', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Launch' }, 'reactions:ada': { '👍': 1 } } },
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
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: {
          class: (window as unknown as Record<string, unknown>).BlokDatabase,
          config: { people: { list: () => Promise.resolve([{ id: 'ada', name: 'Ada' }, { id: 'me', name: 'Jack' }]), me: () => 'me' } },
        },
      },
    });
    await window.blokInstance.isReady;
  }, blocks());
};

/** Saved reactions by user id, read from each person's `reactions:<id>` key. */
const reactions = async (page: Page): Promise<Record<string, Record<string, number>>> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();
  const data = saved?.blocks.find((block) => block.id === 'r1')?.data ?? {};

  return Object.fromEntries(Object.entries(data)
    .filter(([key]) => key.startsWith('reactions:'))
    .map(([key, value]) => [key.slice('reactions:'.length), value as Record<string, number>]));
});

const card = (page: Page) => page.getByRole('listitem').filter({ hasText: 'Launch' });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('a pill adds your reaction, your pill is gray, and clicking it again takes it back', async ({ page }) => {
  await mount(page);
  const pill = card(page).getByRole('button', { name: '👍' });

  await expect(pill).toHaveText('👍1');
  await expect(pill).toHaveAttribute('aria-pressed', 'false');
  await pill.click();
  await expect(pill).toHaveText('👍2');
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  expect((await reactions(page)).me?.['👍']).toEqual(expect.any(Number));

  const [fill, ink] = await pill.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  const channels = (color: string): number[] => (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

  expect(Math.max(...channels(fill)) - Math.min(...channels(fill))).toBeLessThanOrEqual(10);
  expect(Math.max(...channels(ink)) - Math.min(...channels(ink))).toBeLessThanOrEqual(10);

  await pill.click();
  await expect(pill).toHaveText('👍1');
  expect(await reactions(page)).toEqual({ ada: { '👍': 1 } });
});

test('Add reaction opens the full picker with no Random or Remove; a pick adds a pill and Escape closes only the picker', async ({ page }) => {
  await mount(page);
  await card(page).getByRole('button', { name: 'Add reaction' }).click();
  const picker = page.getByRole('dialog', { name: 'Add reaction' });

  await expect(picker).toBeVisible();
  // Blok's shared picker keeps its own search wording, not Notion's "Filter…".
  await expect(picker.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search emojis…');
  await expect(picker.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'Random' })).toHaveCount(0);

  await picker.getByRole('searchbox').fill('party');
  await picker.getByRole('button', { name: /party popper/i }).first().click();
  await expect(picker).toBeHidden();
  await expect(card(page).getByRole('button', { name: '🎉' })).toHaveAttribute('aria-pressed', 'true');
  expect(Object.keys((await reactions(page)).me ?? {})).toEqual(['🎉']);

  await card(page).getByRole('button', { name: 'Add reaction' }).click();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(card(page)).toBeVisible();
});

test('the hint names who reacted, only after a hover delay', async ({ page }) => {
  await mount(page);
  await card(page).getByRole('button', { name: '👍' }).hover();
  await expect(page.getByText('Ada reacted with 👍')).toBeHidden();
  await expect(page.getByText('Ada reacted with 👍')).toBeVisible();
});

test('hovering a card shows React and More actions; More actions lists the row actions', async ({ page }) => {
  await mount(page);
  const react = card(page).getByRole('button', { name: 'React', exact: true });
  // The whole pill fades, not each button (research/21 §1j).
  const pill = card(page).locator('[data-blok-database-feed-card-actions]');

  await expect(pill).toHaveCSS('opacity', '0');
  await card(page).hover();
  await expect(pill).toHaveCSS('opacity', '1');
  await expect(react).toBeVisible();
  await card(page).getByRole('button', { name: 'More actions' }).click();

  await expect(page.getByPlaceholder('Search actions…')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Duplicate/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Move to Trash/ })).toBeVisible();
});

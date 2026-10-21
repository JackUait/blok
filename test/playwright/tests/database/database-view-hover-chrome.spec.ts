/**
 * Hover chrome Notion has, in light and dark (research/21 §1f, §1i, §1j, §1k):
 * feed card ring and action pill, the board card pill divider, the timeline
 * bar overlay and off-screen chip border, and the form builder question card.
 * Reads getComputedStyle and boxes, never the stylesheet.
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

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a2',
    config: { options: [{ id: 'o-gray', label: 'Not started', color: 'gray', position: 'a0' }] },
  },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-due': '2026-10-09', 'p-stage': 'o-gray' } },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-due': '2026-12-20' } },
];

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-title'], ...view }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    parent: 'db-1',
    data: { position: `a${i}`, properties: row.properties },
  })),
];

const mount = async (page: Page, input: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: data },
      tools: {
        database: {
          class: (window as unknown as Record<string, unknown>).BlokDatabase,
          // A user id gives the feed card its React button, so the pill holds two.
          config: { people: { list: () => Promise.resolve([{ id: 'me', name: 'Jack' }]), me: () => 'me' } },
        },
      },
    });
    await window.blokInstance.isReady;
  }, input);
};

const size = async (locator: Locator): Promise<{ width: number; height: number }> => {
  const box = await locator.boundingBox();

  return { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
};

const THEMES = [
  {
    scheme: 'light' as const,
    feedHover: 'rgba(0, 0, 0, 0.03) 0px 12px 32px 0px, rgba(0, 0, 0, 0.086) 0px 0px 0px 1px',
    pillBg: 'rgb(255, 255, 255)',
    pillBorder: 'rgb(240, 239, 237)',
    divider: 'rgba(42, 28, 0, 0.07)',
    overlay: 'linear-gradient(rgba(33, 27, 23, 0.05), rgba(33, 27, 23, 0.05))',
    chipBorder: 'rgb(255, 255, 255)',
    // research/26 §4d.
    chipHover: 'rgb(56, 56, 54)',
    questionBg: 'rgb(255, 255, 255)',
    questionRing: 'rgb(182, 212, 243) 0px 0px 0px 0.5px inset',
    // research/21 §1k.
    answerBorder: 'rgb(240, 239, 237)',
  },
  {
    scheme: 'dark' as const,
    feedHover: 'rgba(255, 255, 255, 0.1) 0px 0px 0px 1px inset',
    pillBg: 'rgb(47, 47, 47)',
    pillBorder: 'rgb(44, 44, 43)',
    divider: 'rgba(255, 255, 243, 0.082)',
    overlay: 'linear-gradient(rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.055))',
    chipBorder: 'rgb(25, 25, 25)',
    chipHover: 'rgb(230, 229, 227)',
    questionBg: 'rgb(25, 25, 25)',
    questionRing: 'rgb(53, 95, 139) 0px 0px 0px 0.5px inset',
    // research/21 §1k.
    answerBorder: 'rgb(44, 44, 43)',
  },
];

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 9, 9, 12));
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.mouse.move(0, 0);
});

test.afterEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
});

for (const theme of THEMES) {
  test.describe(`${theme.scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.scheme });
    });

    test('feed: the hovered card rings and shows React and More actions in one 55x30 pill', async ({ page }) => {
      await mount(page, blocks({ type: 'feed', visibleProperties: [] }));
      const card = page.getByRole('listitem').filter({ hasText: 'Alpha' });
      const pill = card.locator('[data-blok-database-feed-card-actions]');

      await expect(pill).toHaveCSS('opacity', '0');
      await card.hover();
      await expect(card).toHaveCSS('box-shadow', theme.feedHover);
      await expect(pill).toHaveCSS('opacity', '1');
      await expect(pill).toHaveCSS('background-color', theme.pillBg);
      await expect(pill).toHaveCSS('border-top-color', theme.pillBorder);
      await expect(pill).toHaveCSS('box-shadow', 'rgba(29, 27, 22, 0.06) 0px 2px 12px 0px');
      await expect(pill.getByRole('button')).toHaveCount(2);
      expect(await size(pill)).toEqual({ width: 55, height: 30 });
    });

    test('board: Edit and ••• are split by a divider in the cell border colour, 57px in all', async ({ page }) => {
      await mount(page, blocks({ type: 'board', groupBy: 'p-stage' }));
      const card = page.locator('[data-blok-database-card][data-row-id="r1"]');
      const edit = card.locator('[data-blok-database-edit-card]');

      await card.hover();
      await expect(card.locator('[data-blok-database-card-actions]')).toHaveCSS('opacity', '1');
      await expect(edit).toHaveCSS('border-right-color', theme.divider);
      await expect(edit).toHaveCSS('border-right-width', '1px');
      expect(await size(edit)).toEqual({ width: 29, height: 24 });
      expect(await size(card.locator('[data-blok-database-card-menu]'))).toEqual({ width: 28, height: 24 });
      expect(await size(card.locator('[data-blok-database-card-actions]'))).toEqual({ width: 57, height: 24 });
    });

    test('board: the card action pill and its buttons have 4px corners, as measured', async ({ page }) => {
      await mount(page, blocks({ type: 'board', groupBy: 'p-stage' }));
      const card = page.locator('[data-blok-database-card][data-row-id="r1"]');

      await card.hover();
      await expect(card.locator('[data-blok-database-card-actions]')).toHaveCSS('border-top-left-radius', '4px');
      await expect(card.locator('[data-blok-database-edit-card]')).toHaveCSS('border-top-left-radius', '4px');
      await expect(card.locator('[data-blok-database-card-menu]')).toHaveCSS('border-top-right-radius', '4px');
    });

    test('timeline: a hovered bar takes the hover overlay, and the off-screen chip has a page-coloured border', async ({ page }) => {
      await mount(page, blocks({ type: 'timeline' }));
      const bar = page.locator('[data-blok-database-timeline-bar][data-row-id="r1"]');
      const chip = page.locator('[data-blok-database-timeline-row][data-row-id="r2"] [data-blok-database-timeline-offscreen="after"]');

      await expect(bar).toHaveCSS('background-image', 'none');
      await bar.hover();
      await expect(bar).toHaveCSS('background-image', theme.overlay);
      await expect(chip).toBeVisible();
      await expect(chip).toHaveCSS('border-top-color', theme.chipBorder);
      await expect(chip).toHaveCSS('border-top-width', '1px');
      expect(await size(chip)).toEqual({ width: 16, height: 16 });
    });

    test('timeline: the off-screen chip fills on hover and draws a 14x12 icon (research/26 §4d)', async ({ page }) => {
      await mount(page, blocks({ type: 'timeline' }));
      const chip = page.locator('[data-blok-database-timeline-row][data-row-id="r2"] [data-blok-database-timeline-offscreen="after"]');

      await expect(chip).toBeVisible();
      await chip.hover();
      await expect(chip).toHaveCSS('background-color', theme.chipHover);
      expect(await chip.evaluate((el) => {
        const icon = el.firstElementChild?.getBoundingClientRect();

        return { width: Math.round(icon?.width ?? 0), height: Math.round(icon?.height ?? 0) };
      })).toEqual({ width: 14, height: 12 });
    });

    test('form builder: each question is a 12px card with a 0.5px inset ring and a 24px Edit question chip', async ({ page }) => {
      await mount(page, blocks({ type: 'form' }));
      const question = page.locator('[data-blok-database-form-question="p-title"]');
      const chip = question.getByTestId('database-form-question-menu');

      await expect(question).toHaveCSS('background-color', theme.questionBg);
      await expect(question).toHaveCSS('box-shadow', theme.questionRing);
      await expect(question.getByRole('textbox').first()).toHaveCSS('border-top-color', theme.answerBorder);
      await expect(question).toHaveCSS('border-top-left-radius', '12px');
      await expect(question).toHaveCSS('padding-top', '12px');
      await expect(chip).toHaveAccessibleName('Edit question');
      expect(await size(chip)).toEqual({ width: 24, height: 24 });
      expect(await chip.evaluate((el) => {
        const icon = el.firstElementChild?.getBoundingClientRect();

        return { width: Math.round(icon?.width ?? 0), height: Math.round(icon?.height ?? 0) };
      })).toEqual({ width: 16, height: 16 });
    });
  });
}

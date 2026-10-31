/**
 * A repeating template's schedule, set from the template banner's
 * "Duplicate every…" menu and its Edit cadence panel (research/21 §3):
 * frequency, "Every N <unit>", start date and time. Checks the saved JSON,
 * not only the DOM.
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

const blocks = (repeat?: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['tpl'],
  },
  { id: 'tpl', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Standup' }, template: true, ...(repeat === undefined ? {} : { repeat }) } },
];

const mount = async (page: Page, repeat?: Record<string, unknown>, width?: string): Promise<void> => {
  await page.evaluate(async ({ input, width: holderWidth }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    if (holderWidth !== undefined) holder.style.width = holderWidth;
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: { database: { class: (window as unknown as Record<string, unknown>).BlokDatabase } },
    });
    await window.blokInstance.isReady;
  }, { input: blocks(repeat), width });
};

const repeatOf = async (page: Page): Promise<Record<string, unknown> | undefined> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();

  return (saved?.blocks.find((block) => block.id === 'tpl')?.data as { repeat?: Record<string, unknown> }).repeat;
});

/** Whether the Discard question's backdrop is what a point on this control hits. */
const coveredByQuestion = (page: Page, label: string): Promise<boolean> => page.evaluate((name) => {
  const target = [...document.querySelectorAll<HTMLElement>('[data-blok-popover] *')]
    .find((el) => el.getAttribute('aria-label') === name || (el.childElementCount === 0 && el.textContent === name));
  const box = target?.getBoundingClientRect();
  const hit = box === undefined ? null : document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);

  return hit?.closest('[data-blok-database-confirm]') !== null && hit !== null && !(target?.contains(hit) ?? false);
}, label);

const openBanner = async (page: Page): Promise<void> => {
  await page.getByTestId('database-toolbar-new-menu').click();
  await page.getByRole('menuitem', { name: 'Standup' }).getByTestId('popover-item-more').click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('a new weekly repeat keeps the viewer\'s zone and closes the whole menu', async ({ page }) => {
  await mount(page);
  await openBanner(page);
  await page.getByRole('button', { name: 'Duplicate every…' }).click();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  // "Weekday" and "2 Weeks" also contain "Week".
  await page.getByRole('menuitem', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  await expect.poll(() => repeatOf(page)).toMatchObject({ frequency: 'weekly', timeZone: zone });
  await expect(page.getByText('Edit cadence')).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Week', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Cancel recurrence' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Duplicate every week' })).toBeVisible();
});

// The page is shared between tests, so its time zone is not ours to set: the
// schedule carries its own zone, and the fields read and write in that zone.
test('sets the interval and the start date and time of a schedule', async ({ page }) => {
  await mount(page, { frequency: 'weekly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await openBanner(page);
  await page.getByRole('button', { name: 'Duplicate every week' }).click();
  const every = page.getByRole('spinbutton', { name: 'Every' });
  const unit = page.getByRole('combobox', { name: 'Every' });

  await expect(every).toHaveValue('1');
  // One week reads "Week", not "Weeks"; the unit follows the typed number.
  await expect(unit.getByRole('option', { selected: true })).toHaveText('Week');
  await every.fill('2');
  await expect(unit.getByRole('option', { selected: true })).toHaveText('Weeks');

  // At and Starting are "Label  value ›" rows; their fields sit in submenus.
  // Starting is a month grid (research/35:400): October, then the next month, then the 2nd.
  await page.getByRole('menuitem', { name: /^Starting/ }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('gridcell', { name: 'November 2, 2026' }).click();
  await page.getByRole('menuitem', { name: /^At/ }).click();
  await expect(page.getByLabel('At', { exact: true })).toHaveValue('09:30');
  await page.getByLabel('At', { exact: true }).fill('18:00');
  await expect(page.getByRole('menuitem', { name: /^At/ })).toContainText('6:00');
  // Nothing is stored until Save.
  expect(await repeatOf(page)).toEqual({ frequency: 'weekly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await page.getByRole('button', { name: 'Save' }).click();

  // Berlin is on CET (UTC+1) on Nov 2.
  await expect.poll(() => repeatOf(page)).toEqual({ frequency: 'weekly', interval: 2, start: '2026-11-02T17:00:00.000Z', timeZone: 'Europe/Berlin' });
  await expect(page.getByRole('button', { name: 'Duplicate every 2 weeks' })).toBeVisible();
});

test('the ↻ hint in the templates list names the unit only, after the hint delay', async ({ page }) => {
  // Narrow: the submenu opens on the right here. The right-edge case is the next test.
  await mount(page, { frequency: 'weekly', interval: 2, start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' }, '900px');
  await page.getByTestId('database-toolbar-new-menu').click();
  await page.getByRole('img', { name: 'Duplicate weekly' }).hover();

  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveText('Duplicate weekly', { timeout: 2000 });
});

// research/30 X1: the template's submenu opens on a click of its "…", never on
// hover, so ↻ keeps its hint. At the window's right edge it opens over the list.
test('at the window\'s right edge the ↻ hint shows, and "…" opens the submenu over the list', async ({ page }) => {
  await mount(page, { frequency: 'weekly', interval: 2, start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await page.getByTestId('database-toolbar-new-menu').click();

  const containerRect = (name: string) => page.getByRole('menuitem', { name, exact: true }).evaluate((item) => {
    const rect = item.closest('[data-blok-popover-container]')?.getBoundingClientRect();

    return { left: rect?.left ?? Number.NaN, right: rect?.right ?? Number.NaN };
  });
  const list = await containerRect('Empty page');

  // No room for a submenu on the right.
  expect(1400 - list.right).toBeLessThan(250);

  await page.getByRole('menuitem', { name: /^Standup/ }).hover();
  await page.getByRole('img', { name: 'Duplicate weekly' }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Duplicate weekly', { timeout: 2000 });
  // Hover alone never opens the submenu.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)));
  await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toHaveCount(0);

  await page.getByRole('menuitem', { name: /^Standup/ }).getByTestId('popover-item-more').click();
  await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible();

  const more = await page.getByRole('menuitem', { name: /^Standup/ })
    .getByTestId('popover-item-more')
    .evaluate((el) => el.getBoundingClientRect().left);

  // Over the list, ending 12px before the "…". Polled: the first frames of
  // the open motion can read a few px off the resting spot.
  await expect.poll(async () => Math.abs((await containerRect('Edit')).right - (more - 12))).toBeLessThanOrEqual(1);
  const submenu = await containerRect('Edit');

  expect(submenu.left).toBeGreaterThan(list.left);

  // Crossing the list to the submenu keeps it open, and its items still work.
  const edit = await page.getByRole('menuitem', { name: 'Edit', exact: true }).boundingBox();

  await page.mouse.move(submenu.right - 20, (edit?.y ?? 0) + (edit?.height ?? 0) / 2, { steps: 8 });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Duplicate every 2 weeks' })).toBeVisible();
});

test('a monthly schedule picks its day from "On the [Nth] [Day]"', async ({ page }) => {
  // Starting reads "Today"/"Tomorrow" near Nov 1, so "Nov 1" needs a fixed today.
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00.000Z'));
  await mount(page, { frequency: 'monthly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await openBanner(page);
  await page.getByRole('button', { name: 'Duplicate every month' }).click();
  const ordinal = page.getByRole('combobox', { name: 'On the' });

  await expect(ordinal.getByRole('option', { selected: true })).toHaveText('5th');
  await expect(page.getByRole('combobox', { name: 'Day', exact: true }).getByRole('option')).toHaveText(['Day']);
  await ordinal.selectOption('1');
  await expect(page.getByRole('menuitem', { name: /^Starting/ })).toContainText('Nov 1');
  await page.getByRole('button', { name: 'Save' }).click();

  // 09:30 in Berlin on Nov 1 (CET) is 08:30Z.
  await expect.poll(() => repeatOf(page)).toEqual({ frequency: 'monthly', start: '2026-11-01T08:30:00.000Z', timeZone: 'Europe/Berlin' });
});

test('Ending and Timezone set the end and the zone from their submenus', async ({ page }) => {
  test.setTimeout(30_000);
  await mount(page, { frequency: 'daily', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await openBanner(page);
  await page.getByRole('button', { name: 'Duplicate every day' }).click();
  await expect(page.getByRole('menuitem', { name: /^Ending/ })).toContainText('Never');
  await page.getByRole('menuitem', { name: /^Ending/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Never' })).toBeVisible();
  await page.getByLabel('Ending', { exact: true }).fill('2026-12-31');
  await expect(page.getByRole('menuitem', { name: /^Ending/ })).toContainText('Dec 31, 2026');

  await page.getByRole('menuitem', { name: /^Timezone/ }).click();
  await page.getByPlaceholder('Search').last().fill('Tokyo');
  await page.getByRole('menuitemcheckbox', { name: /^Tokyo/ }).click();
  await expect(page.getByRole('menuitem', { name: /^Timezone/ })).toContainText('GMT+9');

  // The new zone keeps the wall clock: 09:30 and the end of Dec 31, both now in Tokyo.
  await expect(page.getByRole('menuitem', { name: /^Ending/ })).toContainText('Dec 31, 2026');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => repeatOf(page)).toEqual({
    frequency: 'daily', start: '2026-10-05T00:30:00.000Z', timeZone: 'Asia/Tokyo', end: '2026-12-31T14:59:59.999Z',
  });
});


// research/35 §13 (r35:400): Starting opens a 268px-wide month grid with no Today button and no time.
test('Starting opens a month grid as wide as Notion\'s, with no Today and no time', async ({ page }) => {
  await mount(page, { frequency: 'weekly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await openBanner(page);
  await page.getByRole('button', { name: 'Duplicate every week' }).click();
  await page.getByRole('menuitem', { name: /^Starting/ }).click();

  const grid = page.getByRole('grid').filter({ has: page.getByRole('gridcell', { name: 'October 5, 2026' }) });

  await expect(grid.getByRole('gridcell', { name: 'October 5, 2026' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Today' })).toHaveCount(0);
  // Unscaled: the submenu's open motion scales it.
  const box = (): Promise<{ width: number }> => grid.evaluate((el) => ({ width: el.closest<HTMLElement>('[data-blok-popover-container]')?.offsetWidth ?? 0 }));

  // Notion's is 268x294 (research/35:400). Its inner sizes were not measured, so only the width is pinned.
  await expect.poll(async () => (await box()).width).toBe(268);
});

// research/35 §13 (r35:406): Escape on an unsaved panel asks first; Cancel keeps it, Discard drops it.
test('Escape on an unsaved Edit cadence asks "Discard unsaved changes?"', async ({ page }) => {
  await mount(page, { frequency: 'weekly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await openBanner(page);
  await page.getByRole('button', { name: 'Duplicate every week' }).click();
  await page.getByRole('spinbutton', { name: 'Every' }).fill('3');
  await page.keyboard.press('Escape');

  const dialog = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Discard' })).toBeFocused();
  // Mounted inside the popover, it still covers the window and sits centred.
  const place = await dialog.evaluate((el) => {
    const backdrop = el.closest('[data-blok-database-confirm]')?.getBoundingClientRect();
    const box = el.getBoundingClientRect();

    return {
      backdrop: { x: backdrop?.x, y: backdrop?.y, width: backdrop?.width, height: backdrop?.height },
      centre: Math.round(box.x + box.width / 2),
    };
  });

  expect(place.backdrop).toEqual({ x: 0, y: 0, width: 1400, height: 900 });
  expect(Math.abs(place.centre - 700)).toBeLessThanOrEqual(1);
  // Its backdrop paints over the panel: a point on the panel hits the backdrop.
  expect(await coveredByQuestion(page, 'Edit cadence')).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Edit cadence')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Every' })).toHaveValue('3');

  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('Edit cadence')).toHaveCount(0);
  expect(await repeatOf(page)).toEqual({ frequency: 'weekly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
});

// research/35 §13 (r35:402): the Timezone submenu reads as the date editor's.
test('the Timezone submenu has the date editor\'s search and groups', async ({ page }) => {
  await mount(page, { frequency: 'daily', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await openBanner(page);
  await page.getByRole('button', { name: 'Duplicate every day' }).click();
  await page.getByRole('menuitem', { name: /^Timezone/ }).click();

  await expect(page.getByPlaceholder('Search cities, timezones…')).toBeVisible();
  await expect(page.getByText('Current timezone', { exact: true })).toBeVisible();
  await expect(page.getByText('Select a timezone', { exact: true })).toBeVisible();
});

// research/35 §1.8 (r35:150): template rows are 28px with the "…" 2px below the row top; other rows keep their height.
test('the templates menu rows are 28px, and the "…" submenu rows are not', async ({ page }) => {
  await mount(page);
  await page.getByTestId('database-toolbar-new-menu').click();

  const row = page.getByRole('menuitem', { name: /^Standup/ });
  // Layout sizes, not the rects: the menu's open motion scales them.
  const geometry = (): Promise<{ height: number; moreTop: number }> => row.evaluate((el) => {
    const more = el.querySelector<HTMLElement>('[data-blok-testid="popover-item-more"]');

    return { height: el instanceof HTMLElement ? el.offsetHeight : 0, moreTop: more === null ? -1 : more.getBoundingClientRect().top - el.getBoundingClientRect().top };
  });

  await expect.poll(geometry).toEqual({ height: 28, moreTop: 2 });
  await row.getByTestId('popover-item-more').click();
  const edit = await page.getByRole('menuitem', { name: 'Edit', exact: true }).evaluate((el) => (el instanceof HTMLElement ? el.offsetHeight : 0));

  expect(edit).toBe(36);
});

// A submenu is open when Escape is pressed: the question still draws above it.
test('the Discard question draws above an open cadence submenu', async ({ page }) => {
  await mount(page, { frequency: 'weekly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
  await openBanner(page);
  await page.getByRole('button', { name: 'Duplicate every week' }).click();
  await page.getByRole('spinbutton', { name: 'Every' }).fill('3');
  await page.getByRole('menuitem', { name: /^Starting/ }).click();
  await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible();
  await page.keyboard.press('Escape');

  const discard = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Discard' });

  await expect(discard).toBeFocused();
  // Its backdrop paints over the panel and over the open month grid.
  expect(await coveredByQuestion(page, 'Edit cadence')).toBe(true);
  expect(await coveredByQuestion(page, 'Next month')).toBe(true);
  await discard.click();
  await expect(page.getByText('Edit cadence')).toHaveCount(0);
  expect(await repeatOf(page)).toEqual({ frequency: 'weekly', start: '2026-10-05T07:30:00.000Z', timeZone: 'Europe/Berlin' });
});

/**
 * Date reminders (research/17 §1): the Remind row of the date picker, its
 * menu, the alarm in the cell and the property's Notifications default.
 * Checks the saved JSON, not only the DOM.
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

const blocks = (date: Record<string, unknown> = {}, reminders?: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-due', name: 'Due', type: 'date', position: 'a1', date },
      ],
      views: [{ id: 'v1', name: 'table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-due'] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-due': '2027-06-15' }, ...(reminders === undefined ? {} : { reminders }) } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Beta', 'p-due': null } } },
];

const mount = async (page: Page, date?: Record<string, unknown>, reminders?: Record<string, unknown>): Promise<void> => {
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
      tools: { database: { class: (window as unknown as Record<string, unknown>).BlokDatabase } },
    });
    await window.blokInstance.isReady;
  }, blocks(date, reminders));
};

const rowData = async (page: Page, id: string): Promise<{ properties: Record<string, unknown>; reminders?: Record<string, unknown> } | undefined> => page.evaluate(async (rowId) => {
  const saved = await window.blokInstance?.save();

  return saved?.blocks.find((block) => block.id === rowId)?.data as { properties: Record<string, unknown>; reminders?: Record<string, unknown> } | undefined;
}, id);

/** A reminder records the zone of whoever set it. */
const setInBrowserZone = async (page: Page, remind: string): Promise<Record<string, unknown>> =>
  ({ remind, timeZone: await page.evaluate(() => new Intl.DateTimeFormat().resolvedOptions().timeZone) });

const dueCell = (page: Page, title: string) => page.getByRole('row', { name: new RegExp(title) }).getByRole('gridcell').nth(1);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('Remind sits above Clear, lists the date-only reminders, and a pick shows an alarm in the reminder blue', async ({ page }) => {
  await mount(page);
  const cell = dueCell(page, 'Alpha');

  await expect(cell).toHaveText('June 15, 2027');
  const color = await cell.evaluate((el) => getComputedStyle(el.firstElementChild ?? el).color);

  await cell.click();
  const remind = page.getByRole('button', { name: /^Remind/ });

  await expect(remind).toHaveAccessibleName('Remind None');
  const clear = page.getByRole('button', { name: 'Clear' });

  expect((await remind.boundingBox())?.y ?? 0).toBeLessThan((await clear.boundingBox())?.y ?? 0);
  await remind.click();
  const menu = page.getByRole('menu', { name: 'Remind' });

  await expect(menu.getByRole('menuitemradio')).toHaveText(['None', 'On day of event (9:00 AM)', '1 day before (9:00 AM)', '2 days before (9:00 AM)', '1 week before (9:00 AM)']);
  await expect(menu.getByRole('menuitemradio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
  // Beside the picker, as Notion opens it.
  const picker = await page.getByRole('button', { name: 'Clear' }).evaluate((el) => el.closest('[data-blok-database-cell-editor]')?.getBoundingClientRect().right ?? 0);

  expect((await menu.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(picker);

  await menu.getByRole('menuitemradio', { name: '1 day before (9:00 AM)' }).click();
  await expect(menu).toBeHidden();
  await expect(remind).toHaveAccessibleName('Remind 1 day before');
  await expect.poll(async () => (await rowData(page, 'r1'))?.reminders).toEqual({ 'p-due': await setInBrowserZone(page, '1_day_before') });

  await page.keyboard.press('Escape');
  const alarm = cell.getByRole('img', { name: 'Reminder: 1 day before' });

  await expect(alarm).toBeVisible();
  // The token as the cell resolves it, so a theme override is followed too.
  const accent = await cell.evaluate((el) => {
    const probe = document.createElement('span');

    probe.style.color = 'var(--blok-database-reminder-text)';
    el.appendChild(probe);
    const value = getComputedStyle(probe).color;

    probe.remove();

    return value;
  });

  await expect.poll(() => cell.evaluate((el) => getComputedStyle(el.firstElementChild ?? el).color)).toBe(accent);
  expect(accent).not.toBe(color);
});

test('one Escape closes the Remind menu, the next closes the picker', async ({ page }) => {
  await mount(page);
  await dueCell(page, 'Alpha').click();
  await page.getByRole('button', { name: /^Remind/ }).click();
  const menu = page.getByRole('menu', { name: 'Remind' });

  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Clear' })).toBeHidden();
});

test('Include time switches to the timed reminders', async ({ page }) => {
  await mount(page);
  await dueCell(page, 'Alpha').click();
  await page.getByRole('switch', { name: 'Include time' }).click();
  await page.getByRole('button', { name: /^Remind/ }).click();

  await expect(page.getByRole('menu', { name: 'Remind' }).getByRole('menuitemradio')).toHaveText([
    'None', 'At time of event', '5 minutes before', '10 minutes before', '15 minutes before', '30 minutes before',
    '1 hour before', '2 hours before', '1 day before (9:00 AM)', '2 days before (9:00 AM)',
  ]);
});

test('Notifications pre-fills Remind for a new date and leaves an existing one alone', async ({ page }) => {
  await mount(page, { defaultReminder: '1_week_before' });

  await dueCell(page, 'Alpha').click();
  await expect(page.getByRole('button', { name: /^Remind/ })).toHaveAccessibleName('Remind None');
  await page.keyboard.press('Escape');

  await dueCell(page, 'Beta').click();
  await expect(page.getByRole('button', { name: /^Remind/ })).toHaveAccessibleName('Remind 1 week before');
  await page.getByRole('textbox', { name: 'Start date' }).fill('Jun 20, 2027');
  await page.keyboard.press('Enter');

  await expect.poll(async () => (await rowData(page, 'r2'))?.reminders).toEqual({ 'p-due': await setInBrowserZone(page, '1_week_before') });
  await expect.poll(async () => (await rowData(page, 'r1'))?.reminders).toBeUndefined();
});

test('the property menu sets Notifications from the date-only list', async ({ page }) => {
  await mount(page);
  await page.getByRole('columnheader', { name: 'Due' }).click();
  await page.getByRole('menuitem', { name: 'Edit property' }).click();
  await page.getByRole('menuitem', { name: /^Notifications/ }).click();
  await page.getByRole('menuitemcheckbox', { name: '1 week before (9:00 AM)' }).click();

  await expect.poll(() => page.evaluate(async () => {
    const saved = await window.blokInstance?.save();
    const data = saved?.blocks.find((block) => block.id === 'db-1')?.data as { schema: Array<{ id: string; date?: Record<string, unknown> }> };

    return data.schema.find((p) => p.id === 'p-due')?.date;
  })).toEqual({ defaultReminder: '1_week_before' });
});

test('the checked reminder is marked by a check on a neutral row, not a fill', async ({ page }) => {
  await mount(page);
  await dueCell(page, 'Alpha').click();
  await page.getByRole('button', { name: /^Remind/ }).click();
  const menu = page.getByRole('menu', { name: 'Remind' });
  const paint = (name: string) => menu.getByRole('menuitemradio', { name }).evaluate((el) => {
    const style = getComputedStyle(el);

    return { background: style.backgroundColor, color: style.color };
  });

  // Move the pointer away, so neither row is hovered.
  await page.mouse.move(0, 0);
  const checked = await paint('None');
  const unchecked = await paint('2 days before (9:00 AM)');

  expect(checked.background).toBe('rgba(0, 0, 0, 0)');
  expect(checked).toEqual(unchecked);
});

test('one undo takes back a first date and the default reminder it brought', async ({ page }) => {
  await mount(page, { defaultReminder: '1_week_before' });
  await dueCell(page, 'Beta').click();
  await page.getByRole('textbox', { name: 'Start date' }).fill('Jun 20, 2027');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await rowData(page, 'r2'))?.reminders).toEqual({ 'p-due': await setInBrowserZone(page, '1_week_before') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Clear' })).toBeHidden();

  await page.keyboard.press('ControlOrMeta+z');

  await expect.poll(async () => {
    const row = await rowData(page, 'r2');

    return { due: row?.properties['p-due'] ?? null, reminders: row?.reminders };
  }).toEqual({ due: null, reminders: undefined });
});

test('one undo after Clear brings back the date and its reminder', async ({ page }) => {
  await mount(page, undefined, { 'p-due': { remind: '1_day_before' } });
  await dueCell(page, 'Alpha').click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(async () => (await rowData(page, 'r1'))?.reminders).toBeUndefined();

  await page.keyboard.press('ControlOrMeta+z');

  await expect.poll(async () => {
    const row = await rowData(page, 'r1');

    return { due: row?.properties['p-due'], reminders: row?.reminders };
  }).toEqual({ due: '2027-06-15', reminders: { 'p-due': { remind: '1_day_before' } } });
});

const openRowPage = async (page: Page, title: string): Promise<void> => {
  const row = page.getByRole('row', { name: new RegExp(title) });

  await row.hover();
  await row.getByRole('button', { name: 'Open', exact: true }).click();
};

test('a duplicated page keeps its reminder, without the sent stamp, so the copy reminds too', async ({ page }) => {
  await mount(page, undefined, { 'p-due': { remind: '1_day_before', timeZone: 'Europe/Berlin', sentFor: '2027-06-14T07:00:00.000Z' } });
  await openRowPage(page, 'Alpha');
  await page.getByRole('button', { name: 'Page settings & actions' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();

  await expect.poll(() => page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return saved?.blocks.filter((block) => block.type === 'database-row' && block.id !== 'r1' && block.id !== 'r2')
      .map((block) => (block.data as { reminders?: unknown }).reminders);
  })).toEqual([{ 'p-due': { remind: '1_day_before', timeZone: 'Europe/Berlin' } }]);
});

test('the row page date picker has Remind, and its pick is saved on the row', async ({ page }) => {
  await mount(page);
  await openRowPage(page, 'Alpha');
  await page.getByRole('complementary', { name: 'Card details' }).getByLabel('Due', { exact: true }).click();
  await page.getByRole('button', { name: /^Remind/ }).click();
  await page.getByRole('menu', { name: 'Remind' }).getByRole('menuitemradio', { name: '2 days before (9:00 AM)' }).click();

  await expect(page.getByRole('button', { name: /^Remind/ })).toHaveAccessibleName('Remind 2 days before');
  await expect.poll(async () => (await rowData(page, 'r1'))?.reminders).toEqual({ 'p-due': await setInBrowserZone(page, '2_days_before') });
});

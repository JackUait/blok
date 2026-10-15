/**
 * Undo and redo reach the editor while focus sits inside a subtree that owns
 * its keyboard (data-blok-keyboard-owner): board cards, list rows, the
 * calendar grid, the timeline, the table of contents. Text fields there keep
 * their own native undo.
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
  {
    id: 'p-stage', name: 'Stage', type: 'select', position: 'a1',
    config: { options: [{ id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }] },
  },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a3' },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-stage': 'o-idea', 'p-due': '2026-10-12' } },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-stage': 'o-idea', 'p-due': '2026-10-14' } },
];

const doc = (view: Record<string, unknown>): OutputBlockData[] => [
  { id: 'p1', type: 'paragraph', data: { text: 'Start' } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-stage', 'p-due'], ...view }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({ id: row.id, type: 'database-row', data: { position: `a${i}`, properties: row.properties } })),
];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ data: input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { data });
};

const added = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"]`);

/**
 * One undoable step that leaves nothing on the browser's native undo stack, so
 * only Blok's own handling can undo it. Typed text would not do: Chromium
 * replays it through a historyUndo beforeinput on the text's own block.
 */
const insertBlock = async (page: Page, id: string): Promise<void> => {
  await page.evaluate((blockId) => {
    window.blokInstance?.blocks.insert('paragraph', { text: blockId }, undefined, 0, false, false, blockId);
  }, id);
  await expect(added(page, id)).toBeAttached();
};

/** Focuses a target inside a keyboard owner. */
const focusOwned = async (focusTarget: Locator): Promise<void> => {
  await focusTarget.focus();
  await expect(focusTarget).toBeFocused();
  await expect(focusTarget.locator('xpath=ancestor-or-self::*[@data-blok-keyboard-owner]').first()).toBeAttached();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.clock.setFixedTime(new Date(2026, 9, 9, 12));
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('undo and redo inside a keyboard-owner subtree', () => {
  const FOCUS_CASES: Array<{ name: string; blocks: OutputBlockData[]; target: (page: Page) => Locator }> = [
    { name: 'a focused board card', blocks: doc({ type: 'board', groupBy: 'p-stage' }), target: (page) => page.locator('[data-blok-database-card][data-row-id="r1"]') },
    { name: 'a focused list row', blocks: doc({ type: 'list' }), target: (page) => page.locator('[data-blok-database-list-row][data-row-id="r1"]') },
    { name: 'a focused calendar day', blocks: doc({ type: 'calendar' }), target: (page) => page.locator('[data-blok-database-calendar] [data-blok-keyboard-owner] [tabindex="0"]').first() },
    { name: 'the focused timeline', blocks: doc({ type: 'timeline' }), target: (page) => page.locator('[data-blok-keyboard-owner][tabindex="0"]').first() },
    {
      name: 'a focused table of contents entry',
      blocks: [
        { id: 'toc', type: 'table_of_contents', data: {} },
        { id: 'h1', type: 'header', data: { text: 'Goals', level: 2 } },
      ],
      target: (page) => page.locator('[data-blok-toc]').getByRole('link', { name: 'Goals' }),
    },
  ];

  for (const { name, blocks, target } of FOCUS_CASES) {
    test(`undo and redo work from ${name}`, async ({ page }) => {
      await mount(page, blocks);
      await insertBlock(page, 'added');
      await focusOwned(target(page));

      await page.keyboard.press('ControlOrMeta+z');
      await expect(added(page, 'added')).toHaveCount(0);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(added(page, 'added')).toBeAttached();
    });
  }

  const ONE_STEP_CASES: Array<{ name: string; blocks: OutputBlockData[]; target: (page: Page) => Locator }> = [
    { name: 'the table grid', blocks: doc({ type: 'table' }), target: (page) => page.getByRole('gridcell', { name: 'Alpha' }) },
    { name: 'the gallery', blocks: doc({ type: 'gallery' }), target: (page) => page.locator('[data-blok-database-gallery]') },
    {
      name: 'the tabs strip',
      blocks: [
        { id: 'tabs1', type: 'tabs', data: {}, content: ['t1'] },
        { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs1', content: ['b1'] },
        { id: 'b1', type: 'paragraph', data: { text: 'Alpha body' }, parent: 't1' },
      ],
      target: (page) => page.getByRole('tab', { name: 'Alpha', exact: true }),
    },
  ];

  for (const { name, blocks, target } of ONE_STEP_CASES) {
    test(`one press undoes one step from ${name}`, async ({ page }) => {
      await mount(page, blocks);
      await insertBlock(page, 'first');
      await insertBlock(page, 'second');
      await focusOwned(target(page));

      await page.keyboard.press('ControlOrMeta+z');

      await expect(added(page, 'second')).toHaveCount(0);
      await expect(added(page, 'first')).toBeAttached();
    });
  }

  test('typed text undoes one step from a board card, not twice through the native undo', async ({ page }) => {
    await mount(page, doc({ type: 'board', groupBy: 'p-stage' }));
    const paragraph = page.locator('[data-blok-id="p1"] [contenteditable="true"]');

    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' one');
    // A fresh pointer gesture closes the step, so ' two' is a second step.
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' two');
    await expect(paragraph).toHaveText('Start one two');
    await focusOwned(page.locator('[data-blok-database-card][data-row-id="r1"]'));

    await page.keyboard.press('ControlOrMeta+z');

    await expect(paragraph).toHaveText('Start one');
  });

  test('a checkbox toggled in a list row undoes from that row', async ({ page }) => {
    await mount(page, doc({ type: 'list', visibleProperties: ['p-done'] }));
    const done = page.locator('[data-blok-database-list-row][data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="p-done"]');
    const checked = (): Promise<unknown> => page.evaluate(async () => {
      const output = await window.blokInstance?.save();

      return (output?.blocks.find((block) => block.id === 'r1')?.data as { properties: Record<string, unknown> }).properties['p-done'];
    });

    await done.click();
    await expect.poll(checked).toBe(true);
    await page.locator('[data-blok-database-list-row][data-row-id="r1"]').focus();

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(checked).not.toBe(true);
  });

  test('a text field inside the list keeps its own undo and leaves the document alone', async ({ page }) => {
    await mount(page, doc({ type: 'list' }));
    await insertBlock(page, 'added');

    await page.locator('[data-blok-database-list-row][data-row-id="r1"]').focus();
    await page.keyboard.press('Shift+Enter');
    const input = page.locator('[data-blok-database-list-title-input]');

    await expect(input).toBeFocused();
    await page.keyboard.type('Ab');
    await page.keyboard.press('ControlOrMeta+z');

    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await expect(added(page, 'added')).toBeAttached();
  });
});

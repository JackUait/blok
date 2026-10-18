/**
 * Built-in database comments (research/12 §3, research/19 §2d) with only
 * `database` registered: it brings `database-comment` along.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData, OutputData } from '@/types';
import { blocksToHtml, blocksToMarkdown } from '../../../../src/view';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const blocks = (): OutputBlockData[] => [
  { id: 'p1', type: 'paragraph', data: { text: 'Intro' } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Launch' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');
    const globals = window as unknown as Record<string, unknown>;

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      // No database-comment entry: the database brings it.
      tools: { paragraph: globals.BlokParagraph, database: globals.BlokDatabase },
    });
    await window.blokInstance.isReady;
  }, blocks());
};

const save = async (page: Page): Promise<OutputData> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();

  if (saved === undefined) throw new Error('no editor');

  return saved;
});

const savedComments = async (page: Page): Promise<OutputBlockData[]> =>
  (await save(page)).blocks.filter((block) => block.type === 'database-comment');

const titleCell = (page: Page): Locator => page.getByRole('gridcell').filter({ hasText: 'Launch' });
const composer = (scope: Locator | Page): Locator => scope.getByRole('textbox', { name: 'Add a comment…' });
const badge = (page: Page): Locator => page.getByRole('button', { name: 'Open comments' });

const comment = async (page: Page, text: string): Promise<void> => {
  await titleCell(page).click({ button: 'right' });
  await expect(composer(page)).toBeFocused();
  await composer(page).fill(text);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem').filter({ hasText: text })).toBeVisible();
};

const moreActions = async (page: Page, text: string): Promise<void> => {
  const item = page.getByRole('listitem').filter({ hasText: text });

  await item.hover();
  await item.getByRole('button', { name: 'More actions' }).click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test('a cell right-click adds a comment on that cell and the row shows a badge with its count', async ({ page }) => {
  await comment(page, 'Looks good');

  await expect(badge(page)).toHaveText('1');
  expect((await savedComments(page)).map((block) => [block.parent, block.data.text, block.data.propertyId]))
    .toEqual([['r1', 'Looks good', 'p-title']]);
});

test('a second message replies to the thread, and the badge counts both', async ({ page }) => {
  await comment(page, 'First');
  await composer(page).fill('Second');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('listitem').filter({ hasText: 'Second' })).toBeVisible();
  await expect(badge(page)).toHaveText('2');
  const saved = await savedComments(page);

  expect(saved.map((block) => block.data.text)).toEqual(['First', 'Second']);
  expect(saved[1]?.parent).toBe(saved[0]?.id);
});

test('Edit changes the text and shows "(edited)"', async ({ page }) => {
  await comment(page, 'Typo');
  await moreActions(page, 'Typo');
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const field = page.getByRole('listitem').getByRole('textbox');

  await expect(field).toHaveValue('Typo');
  await field.fill('Fixed');
  await page.keyboard.press('Enter');

  const item = page.getByRole('listitem').filter({ hasText: 'Fixed' });

  await expect(item).toContainText('(edited)');
  expect((await savedComments(page))[0]?.data).toMatchObject({ text: 'Fixed', editedAt: expect.any(Number) });
});

test('Delete asks first, and Cancel keeps the comment', async ({ page }) => {
  await comment(page, 'Oops');
  await moreActions(page, 'Oops');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('Delete this comment?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await savedComments(page)).toHaveLength(1);

  await moreActions(page, 'Oops');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByRole('listitem').filter({ hasText: 'Oops' })).toHaveCount(0);
  expect(await savedComments(page)).toHaveLength(0);
  await expect(badge(page)).toHaveCount(0);
});

test('Resolve hides the thread and drops the badge', async ({ page }) => {
  await comment(page, 'Done?');
  await expect(badge(page)).toHaveText('1');
  const item = page.getByRole('listitem').filter({ hasText: 'Done?' });

  await item.hover();
  await item.getByRole('button', { name: 'Resolve' }).click();

  await expect(item).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
  expect((await savedComments(page))[0]?.data.resolved).toBe(true);
});

test('the row page has a Comments section with a composer that writes a row comment', async ({ page }) => {
  await titleCell(page).hover();
  await titleCell(page).getByRole('button', { name: 'Open' }).click();
  const section = page.getByRole('region', { name: 'Comments' });

  await expect(section).toBeVisible();
  await composer(section).fill('From the page');
  await composer(section).press('Enter');

  await expect(section.getByText('From the page')).toBeVisible();
  const saved = await savedComments(page);

  expect(saved).toHaveLength(1);
  expect(saved[0]?.parent).toBe('r1');
  expect(saved[0]?.data).not.toHaveProperty('propertyId');
});

test('Mod+Z undoes the page edit before a comment and leaves the comment', async ({ page }) => {
  const intro = page.getByText('Intro', { exact: true });

  await intro.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' typed');
  await expect(page.getByText('Intro typed')).toBeVisible();
  await comment(page, 'Keep me');
  await page.keyboard.press('Escape');
  await expect(composer(page)).toHaveCount(0);

  await page.getByText('Intro typed').click();
  await page.keyboard.press(`${MOD}+z`);

  await expect(page.getByText('Intro', { exact: true })).toBeVisible();
  expect((await savedComments(page)).map((block) => block.data.text)).toEqual(['Keep me']);
  await expect(badge(page)).toHaveText('1');
});

test('one Escape closes one layer: the actions menu, then the edit, then the popover', async ({ page }) => {
  await comment(page, 'Layers');
  await moreActions(page, 'Layers');
  const menu = page.getByRole('menu');

  await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(composer(page)).toBeVisible();

  await moreActions(page, 'Layers');
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const field = page.getByRole('listitem').getByRole('textbox');

  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Layers' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(composer(page)).toHaveCount(0);
});

test('the HTML and Markdown exports carry the row but no comment text', async ({ page }) => {
  await comment(page, 'Secret remark');
  const saved = await save(page);

  expect(saved.blocks.some((block) => block.type === 'database-comment')).toBe(true);
  const html = blocksToHtml(saved);
  const markdown = blocksToMarkdown(saved);

  expect(html).toContain('Launch');
  expect(markdown).toContain('Launch');
  expect(html).not.toContain('Secret remark');
  expect(markdown).not.toContain('Secret remark');
});

import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  ensureBlokBundleBuilt,
  createBlok,
  saveBlok,
} from './_helpers';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE = 600;

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => new Promise<void>((r) => window.setTimeout(r, t)), ms);
};

const dump = (saved: OutputData): string =>
  saved.blocks
    .map((b) => `${b.id}:${b.type}${(b as { parent?: string }).parent ? `<-${(b as { parent?: string }).parent}` : '<-ROOT'}`)
    .join('  |  ');

/**
 * A doc that mirrors the report: a 2-column layout with a header + a media
 * paragraph in each column, and a plain root paragraph directly below.
 */
const fixture = (): OutputData => ({
  blocks: [
    { id: 'intro', type: 'paragraph', data: { text: 'Intro' } },
    { id: 'cl1', type: 'column_list', data: { columnCount: 2 }, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1', 'm1'] },
    { id: 'h1', type: 'header', data: { text: 'Left', level: 3 }, parent: 'c1' },
    { id: 'm1', type: 'paragraph', data: { text: 'Left media' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['h2', 'm2'] },
    { id: 'h2', type: 'header', data: { text: 'Right', level: 3 }, parent: 'c2' },
    { id: 'm2', type: 'paragraph', data: { text: 'Right media' }, parent: 'c2' },
    { id: 'b1', type: 'paragraph', data: { text: 'Below one' } },
  ],
});

const invariant = async (page: Page, label: string): Promise<void> => {
  const saved = await saveBlok(page);
  const cols = saved.blocks.filter((b) => b.type === 'column');
  const lists = saved.blocks.filter((b) => b.type === 'column_list');

  // Exactly the original structure — no doubling, no orphaned columns at root,
  // no foreign child adopted into the column_list.
  expect(cols.length, `${label}: 2 columns`).toBe(2);
  for (const col of cols) {
    expect((col as { parent?: string }).parent, `${label}: ${col.id} parented to a column_list`).toBe(lists[0]?.id);
  }
  // No non-column child directly under the column_list.
  const listChildren = saved.blocks.filter((b) => (b as { parent?: string }).parent === lists[0]?.id);
  for (const child of listChildren) {
    expect(child.type, `${label}: column_list child ${child.id} is a column`).toBe('column');
  }
  // Live DOM: columns row holds only column wrappers + resizers.
  const foreign = await page.evaluate(() => {
    const row = document.querySelector('[data-blok-columns]');
    if (!row) return ['<no row>'];
    return Array.from(row.children)
      .filter((c) => !(c as HTMLElement).matches('[data-blok-column-resizer]'))
      .filter((c) => (c as HTMLElement).querySelector('[data-blok-column]') === null)
      .map((c) => (c as HTMLElement).getAttribute('data-blok-id') ?? '<anon>');
  });
  expect(foreign, `${label}: no foreign holder in the columns row — ${dump(saved)}`).toEqual([]);
};

test.beforeAll(() => ensureBlokBundleBuilt());

test('backspace-merge below columns then undo/redo keeps columns intact', async ({ page }) => {
  test.setTimeout(120_000);
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await createBlok(page, fixture());
  await expect(page.locator('[data-blok-column]')).toHaveCount(2);
  await invariant(page, 'initial');

  // Caret at very start of the root block below the columns, Backspace (merge
  // boundary against the columns region).
  const b1 = page.locator('[data-blok-id="b1"] [contenteditable="true"]').first();
  await b1.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await wait(page, CAPTURE);
  await invariant(page, 'after backspace');

  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press(UNDO);
    await wait(page, CAPTURE);
  }
  await invariant(page, 'after undo x5');

  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press(REDO);
    await wait(page, CAPTURE);
    await invariant(page, `after redo x${i}`);
  }
});

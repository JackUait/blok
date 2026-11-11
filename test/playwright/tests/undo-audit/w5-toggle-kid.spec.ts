/**
 * A toggle that becomes text keeps its children nested, in saved data AND on
 * screen: Backspace at the start of the title (U137) and Turn into Text (U090).
 * The editor is wider than the content column and centred, the layout where a
 * nested child used to move only half an indent step.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { openFixtureToggles } from '../helpers/toggle-open';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Default --blok-block-indent-step.
const STEP = 24;
// Past the 500ms Yjs capture window.
const CAPTURE_GAP = 800;
const SETTINGS_BUTTON = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

type SavedBlock = OutputData['blocks'][number];

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const createBlok = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await gotoTestPage(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async ({ holder, initial }) => {
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    // Wider than the 720px content column, so the column is centred in it.
    container.style.width = '1000px';
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: initial }, style: { contentAlign: 'center' } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks });
  await openFixtureToggles(page, { blocks });
};

const gap = async (page: Page): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, t);
    });
  }, CAPTURE_GAP);
};

/** Left edge of a block's text, in CSS px. */
const textLeft = async (page: Page, id: string): Promise<number> => page.evaluate((blockId) => {
  const editable = document.querySelector(`[data-blok-id="${blockId}"] [contenteditable]`);

  if (editable === null) {
    throw new Error(`no editable in ${blockId}`);
  }
  const range = document.createRange();

  range.selectNodeContents(editable);

  return range.getClientRects()[0]?.left ?? editable.getBoundingClientRect().left;
}, id);

const tree = async (page: Page): Promise<Array<[string, string, string | null]>> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();

  return (saved?.blocks ?? []).map(b => [b.id ?? '', b.type, b.parent ?? null] as [string, string, string | null]);
});

test.describe('toggle to text keeps its kids nested on screen', () => {
  test('U137: Backspace at the title start keeps "kid" one step in, through undo and redo', async ({ page }) => {
    await createBlok(page, [
      { id: 'b1', type: 'paragraph', data: { text: 'Above' } },
      { id: 'b2', type: 'toggle', data: { text: 'Tog', isOpen: true }, content: ['b3'] },
      { id: 'b3', type: 'paragraph', data: { text: 'kid' }, parent: 'b2' },
    ]);
    const setupKid = await textLeft(page, 'b3');

    await page.locator('[data-blok-id="b2"] [contenteditable]').first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await gap(page);

    expect(await textLeft(page, 'b3') - await textLeft(page, 'b2')).toBeCloseTo(STEP, 0);
    expect(await tree(page)).toEqual([['b1', 'paragraph', null], ['b2', 'paragraph', null], ['b3', 'paragraph', 'b2']]);

    await page.keyboard.press(UNDO);
    await gap(page);

    expect(await textLeft(page, 'b3')).toBeCloseTo(setupKid, 0);
    expect(await tree(page)).toEqual([['b1', 'paragraph', null], ['b2', 'toggle', null], ['b3', 'paragraph', 'b2']]);

    await page.keyboard.press(REDO);
    await gap(page);

    expect(await textLeft(page, 'b3') - await textLeft(page, 'b2')).toBeCloseTo(STEP, 0);
    expect(await tree(page)).toEqual([['b1', 'paragraph', null], ['b2', 'paragraph', null], ['b3', 'paragraph', 'b2']]);
  });

  test('U090: Turn into Text keeps both kids one step in, through undo and redo', async ({ page }) => {
    await createBlok(page, [
      { id: 'b1', type: 'toggle', data: { text: 'Parent', isOpen: true }, content: ['b2', 'b3'] },
      { id: 'b2', type: 'paragraph', data: { text: 'kid one' }, parent: 'b1' },
      { id: 'b3', type: 'paragraph', data: { text: 'kid two' }, parent: 'b1' },
      { id: 'a', type: 'paragraph', data: { text: 'Anchor' } },
    ]);
    const setupKids = [await textLeft(page, 'b2'), await textLeft(page, 'b3')];
    const converted: Array<[string, string, string | null]> = [['b1', 'paragraph', null], ['b2', 'paragraph', 'b1'], ['b3', 'paragraph', 'b1'], ['a', 'paragraph', null]];

    await page.locator('[data-blok-id="b1"]').hover({ position: { x: 10, y: 10 } });
    await page.locator(SETTINGS_BUTTON).click();
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    await page.getByRole('menuitem', { name: 'Turn into', exact: true }).click();
    await page.locator('[data-blok-nested="true"]').getByRole('menuitem', { name: 'Text', exact: true }).click();
    await page.keyboard.press('Escape');
    await gap(page);

    const parentLeft = await textLeft(page, 'b1');

    expect(await textLeft(page, 'b2') - parentLeft).toBeCloseTo(STEP, 0);
    expect(await textLeft(page, 'b3') - parentLeft).toBeCloseTo(STEP, 0);
    expect(await tree(page)).toEqual(converted);

    await page.getByText('Anchor', { exact: true }).click();
    await page.keyboard.press(UNDO);
    await gap(page);

    expect([await textLeft(page, 'b2'), await textLeft(page, 'b3')].map(Math.round)).toEqual(setupKids.map(Math.round));
    expect((await tree(page))[0]).toEqual(['b1', 'toggle', null]);

    await page.keyboard.press(REDO);
    await gap(page);

    expect(await textLeft(page, 'b2') - await textLeft(page, 'b1')).toBeCloseTo(STEP, 0);
    expect(await tree(page)).toEqual(converted);
  });
});

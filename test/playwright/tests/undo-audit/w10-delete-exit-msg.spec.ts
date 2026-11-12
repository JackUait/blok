import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const EXITED = 'Exited navigation mode';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = { id: string; type: string; data: Record<string, unknown>; parent?: string; content?: string[] };

const P = (id: string, text: string, parent?: string): SavedBlock =>
  parent === undefined ? { id, type: 'paragraph', data: { text } } : { id, type: 'paragraph', data: { text }, parent };

const createWith = async (page: Page, blocks: SavedBlock[]): Promise<void> => {
  await page.evaluate(async ({ holder, initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
    blok.history.clear();
  }, { holder: HOLDER_ID, initial: blocks });
};

const editableOf = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const savedIds = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => ((await window.blokInstance?.save())?.blocks ?? []).map((block) => block.id ?? ''));

/** Records every non-empty write to Blok's polite region from now on (it clears 1 s after each). */
const listen = async (page: Page): Promise<() => Promise<string[]>> => {
  await page.evaluate(() => {
    const heard: string[] = [];
    const region = document.querySelector('[data-blok-announcer][role="status"]');

    if (region === null) {
      throw new Error('no polite region');
    }
    new MutationObserver(() => {
      const text = region.textContent ?? '';

      if (text !== '') {
        heard.push(text);
      }
    }).observe(region, { subtree: true, childList: true, characterData: true });
    Object.assign(window, { heard });
  });

  return async () => page.evaluate(() => [...(window as unknown as { heard: string[] }).heard]);
};

/** Longer than the announcer's settle delay, so a queued message would have been written. */
const settle = async (page: Page): Promise<void> => {
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.setTimeout(resolve, 500);
  }));
};

const escapeSelect = async (page: Page, id: string): Promise<void> => {
  await editableOf(page, id).click();
  await page.keyboard.press('Escape');
  await expect(page.locator(`[data-blok-id="${id}"]`)).toHaveAttribute('data-blok-selected', 'true');
  // Escape's own "Navigation mode. ..." and position messages must be done before we listen.
  await settle(page);
};

// USER DECISION 2026-11-12 (A4-3): a block delete says only the count, like Notion (U054, U104, U135).
test.describe('undo audit — a block delete never says Exited navigation mode', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  for (const key of ['Backspace', 'Delete']) {
    test(`Escape then ${key} says only 1 block deleted`, async ({ page }) => {
      await createWith(page, [P('a', 'Alpha'), P('b', 'Beta'), P('c', 'Gamma')]);
      await escapeSelect(page, 'b');
      const heard = await listen(page);

      await page.keyboard.press(key);
      await expect.poll(() => savedIds(page)).toEqual(['a', 'c']);
      await settle(page);

      expect(await heard()).toEqual(['1 block deleted']);
    });
  }

  // Notion U135: a closed toggle with two children.
  test('Escape then Backspace on a toggle says only 1 block deleted', async ({ page }) => {
    await createWith(page, [
      { id: 'tg', type: 'toggle', data: { text: 'Tog', isOpen: false }, content: ['k1', 'k2'] },
      P('k1', 'kid one', 'tg'),
      P('k2', 'kid two', 'tg'),
      P('after', 'after'),
    ]);
    await escapeSelect(page, 'tg');
    const heard = await listen(page);

    await page.keyboard.press('Backspace');
    await expect.poll(() => savedIds(page)).toEqual(['after']);
    await settle(page);

    expect(await heard()).toEqual(['1 block deleted']);
  });

  test('Escape, Shift+ArrowDown, then Delete says only 2 blocks deleted', async ({ page }) => {
    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta'), P('c', 'Gamma')]);
    await escapeSelect(page, 'a');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('[data-blok-id="b"]')).toHaveAttribute('data-blok-selected', 'true');
    await settle(page);
    const heard = await listen(page);

    await page.keyboard.press('Delete');
    await expect.poll(() => savedIds(page)).toEqual(['c']);
    await settle(page);

    expect(await heard()).toEqual(['2 blocks deleted']);
  });

  // Notion U104: caret in the block, handle click, block menu Delete.
  test('block menu Delete says only 1 block deleted', async ({ page }) => {
    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta'), P('c', 'Gamma')]);
    await editableOf(page, 'b').click();
    await page.keyboard.press('End');
    await page.locator('[data-blok-id="b"] [data-blok-element-content]').first().hover();
    await page.locator(HANDLE).click();
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    await settle(page);
    const heard = await listen(page);

    await page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="delete"]`).click();
    await expect.poll(() => savedIds(page)).toEqual(['a', 'c']);
    await settle(page);

    expect(await heard()).toEqual(['1 block deleted']);
  });

  // A pointer press on the menu item after Escape still exits navigation mode on mousedown, before the delete. Not measured in Notion, so left as is.
  test('block menu Delete by keyboard after Escape says only 1 block deleted', async ({ page }) => {
    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta'), P('c', 'Gamma')]);
    await escapeSelect(page, 'b');
    await page.locator('[data-blok-id="b"] [data-blok-element-content]').first().hover();
    await page.locator(HANDLE).click();
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    const deleteItem = page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="delete"]`);

    while (await deleteItem.getAttribute('data-blok-focused') === null) {
      await page.keyboard.press('ArrowDown');
    }
    await settle(page);
    const heard = await listen(page);

    await page.keyboard.press('Enter');
    await expect.poll(() => savedIds(page)).toEqual(['a', 'c']);
    await settle(page);

    expect(await heard()).toEqual(['1 block deleted']);
  });

  // Leaving navigation mode without a delete still says so.
  test('Escape twice still says Exited navigation mode', async ({ page }) => {
    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta')]);
    await escapeSelect(page, 'b');
    const heard = await listen(page);

    await page.keyboard.press('Escape');
    await settle(page);

    expect(await heard()).toEqual([EXITED]);
  });

  test('a click in a block after Escape still says Exited navigation mode', async ({ page }) => {
    await createWith(page, [P('a', 'Alpha'), P('b', 'Beta')]);
    await escapeSelect(page, 'b');
    const heard = await listen(page);

    await editableOf(page, 'a').click();
    await settle(page);

    expect(await heard()).toContain(EXITED);
  });
});

import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const SETTINGS_BUTTON = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
// Yjs captureTimeout is 500ms; wait past it so gestures are separate undo steps.
const CAPTURE_WINDOW = 700;
const VIDEO_URL = 'https://example.com/clip.mp4';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => new Promise<void>((r) => window.setTimeout(r, t)), ms);
};

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, blocks: initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
  await wait(page, CAPTURE_WINDOW);
};

const dataOf = async (page: Page, id: string): Promise<Record<string, unknown> | undefined> => {
  return page.evaluate(async (blockId) => {
    const out = await window.blokInstance?.save();

    return out?.blocks.find((b) => b.id === blockId)?.data;
  }, id);
};

const openTunesOn = async (page: Page, id: string): Promise<void> => {
  await page.locator(`[data-blok-id="${id}"]`).hover({ position: { x: 10, y: 10 } });
  await page.locator(SETTINGS_BUTTON).click();
  await expect(page.locator(TUNES_POPOVER)).toBeVisible();
};

const tuneItem = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

/** Close menus and wait past the capture window. */
const settle = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await wait(page, CAPTURE_WINDOW);
};

/** Focus a plain paragraph so the shortcut reaches the editor, then press it. */
const press = async (page: Page, shortcut: string): Promise<void> => {
  await page.getByText('Anchor', { exact: true }).click();
  await page.keyboard.press(shortcut);
  await wait(page, 400);
};

const anchor = { id: 'p0', type: 'paragraph', data: { text: 'Anchor' } };

test.describe('undo audit: setData apply sweep', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(40_000);
    await gotoTestPage(page);
  });

  // Leaf media tools have no setData, so a replay re-renders them. This path works.
  test('video alignment: undo and redo update data and DOM', async ({ page }) => {
    await createBlok(page, [anchor, { id: 'v', type: 'video', data: { url: VIDEO_URL } }]);
    const root = page.locator('[data-blok-id="v"] [data-blok-tool="video"]');

    await openTunesOn(page, 'v');
    await tuneItem(page, 'video-alignment').hover();
    await page.locator('[data-blok-item-name="video-alignment-right"]').click();
    await settle(page);
    await expect(root).toHaveAttribute('data-align', 'right');
    await press(page, UNDO_SHORTCUT);
    expect((await dataOf(page, 'v'))?.alignment).toBeUndefined();
    await expect(root).toHaveAttribute('data-align', 'center');
    await press(page, REDO_SHORTCUT);
    expect((await dataOf(page, 'v'))?.alignment).toBe('right');
    await expect(root).toHaveAttribute('data-align', 'right');
  });

  // --- Key removal: save() omits the key and only the untracked pruneBlockData deletes it. ---

  // Undo must restore the exact prior state.
  test('APL-1: undo of turning "Hide controls" off does not hide the controls again', async ({ page }) => {
    await createBlok(page, [anchor, { id: 'v', type: 'video', data: { url: VIDEO_URL, hideControls: true } }]);
    await openTunesOn(page, 'v');
    await tuneItem(page, 'video-hide-controls').click();
    await settle(page);
    await press(page, UNDO_SHORTCUT);

    expect((await dataOf(page, 'v'))?.hideControls).toBe(true);
    await expect(page.locator('[data-blok-id="v"] [data-blok-tool="video"]')).toHaveAttribute('data-controls', 'off');
  });

  // One undo must revert the LAST gesture, not the one before it.
  test('APL-2: undo after turning video Loop off reverts the earlier alignment change instead', async ({ page }) => {
    await createBlok(page, [anchor, { id: 'v', type: 'video', data: { url: VIDEO_URL, loop: true } }]);
    await openTunesOn(page, 'v');
    await tuneItem(page, 'video-alignment').hover();
    await page.locator('[data-blok-item-name="video-alignment-left"]').click();
    await settle(page);
    await openTunesOn(page, 'v');
    await tuneItem(page, 'video-loop').click();
    await settle(page);
    await press(page, UNDO_SHORTCUT);
    const after = await dataOf(page, 'v');

    expect({ loop: after?.loop, alignment: after?.alignment }).toEqual({ loop: true, alignment: 'left' });
  });

  // --- First edit of a key the loaded data lacks. Undo deletes the key.
  //     The tool keeps or re-derives a value, a post-undo 'no-capture' flush writes it back,
  //     and redo then changes nothing. ---

  // Undo must restore the exact prior state, also when the data lacks `checked`.
  test('APL-5: undo of the first check on a to-do loaded without "checked" leaves it checked', async ({ page }) => {
    await createBlok(page, [anchor, { id: 'l', type: 'list', data: { text: 'Task', style: 'checklist' } }]);
    const box = page.locator('[data-blok-id="l"]').getByRole('checkbox');

    await box.click();
    await wait(page, CAPTURE_WINDOW);
    await press(page, UNDO_SHORTCUT);

    expect((await dataOf(page, 'l'))?.checked).toBe(false);
    await expect(box).not.toBeChecked();
  });

  // Undo must restore the exact prior state, also when the data lacks `isOpen`.
  test('APL-6: undo of the first collapse on a toggle loaded without "isOpen" leaves it collapsed', async ({ page }) => {
    await createBlok(page, [
      anchor,
      { id: 't', type: 'toggle', data: { text: 'Tog' }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Kid' }, parent: 't' },
    ]);
    await page.locator('[data-blok-id="t"] [data-blok-toggle-arrow]').first().click();
    await wait(page, CAPTURE_WINDOW);
    await press(page, UNDO_SHORTCUT);

    expect((await dataOf(page, 't'))?.isOpen).toBe(true);
    await expect(page.getByText('Kid', { exact: true })).toBeVisible();
  });

  // Redo must re-apply what undo reverted. The language picker UI path works; blocks.update does not.
  test('APL-8: redo of a blocks.update() language change on a code block loaded without "language" does nothing', async ({ page }) => {
    await createBlok(page, [anchor, { id: 'c', type: 'code', data: { code: 'x = 1' } }]);
    await page.evaluate(async () => {
      await window.blokInstance?.blocks.update('c', { language: 'python' });
    });
    await wait(page, CAPTURE_WINDOW);
    await press(page, UNDO_SHORTCUT);
    await press(page, REDO_SHORTCUT);

    expect((await dataOf(page, 'c'))?.language).toBe('python');
  });

  // --- Tool setData that does not apply every key. ---

  // Undo must restore the exact prior state, DOM included.
  test('APL-9: undo of "heading -> toggle heading" leaves the toggle arrow on screen', async ({ page }) => {
    await createBlok(page, [anchor, { id: 'h', type: 'header', data: { text: 'Head', level: 2 } }]);
    await openTunesOn(page, 'h');
    await page.getByRole('menuitem', { name: 'Convert to' }).click();
    await page.locator('[data-blok-popover-tabs] [role="tab"][data-blok-popover-tab="toggle-heading"]').click();
    await page.getByRole('menuitem', { name: 'Toggle heading 2' }).click();
    await settle(page);
    await press(page, UNDO_SHORTCUT);

    await expect(page.locator('[data-blok-id="h"] [data-blok-toggle-arrow]')).toHaveCount(0);
    expect((await dataOf(page, 'h'))?.isToggleable).toBeUndefined();
  });

  // Undo must restore the exact prior state, DOM included.
  test('APL-10: undo of "toggle heading -> heading" brings the toggle back without its arrow', async ({ page }) => {
    await createBlok(page, [anchor, { id: 'h', type: 'header', data: { text: 'Head', level: 2, isToggleable: true, isOpen: true } }]);
    await expect(page.locator('[data-blok-id="h"] [data-blok-toggle-arrow]')).toHaveCount(1);
    await openTunesOn(page, 'h');
    await page.getByRole('menuitem', { name: 'Convert to' }).click();
    await page.locator('[data-blok-popover-tabs] [role="tab"][data-blok-popover-tab="heading"]').click();
    await page.getByRole('menuitem', { name: 'Heading 2' }).click();
    await settle(page);
    await press(page, UNDO_SHORTCUT);

    await expect(page.locator('[data-blok-id="h"] [data-blok-toggle-arrow]')).toHaveCount(1);
    expect((await dataOf(page, 'h'))?.isToggleable).toBe(true);
  });

  // Undo must restore the exact prior state, and redo the new start on screen too.
  test('APL-11: undo of a blocks.update() list start number keeps the new start', async ({ page }) => {
    await createBlok(page, [anchor, { id: 'l', type: 'list', data: { text: 'One', style: 'ordered' } }]);
    await page.evaluate(async () => {
      await window.blokInstance?.blocks.update('l', { start: 5 });
    });
    await wait(page, CAPTURE_WINDOW);
    const marker = page.locator('[data-blok-id="l"] [data-list-marker]');

    await expect(marker).toHaveText('5.');
    await press(page, UNDO_SHORTCUT);

    expect((await dataOf(page, 'l'))?.start).toBeUndefined();
    await expect(marker).toHaveText('1.');
    await press(page, REDO_SHORTCUT);
    expect((await dataOf(page, 'l'))?.start).toBe(5);
    await expect(marker).toHaveText('5.');
  });
});

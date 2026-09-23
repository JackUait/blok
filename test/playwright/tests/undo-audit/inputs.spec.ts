import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE_GAP_MS = 700;
const IMAGE_URL = 'http://localhost:4444/test/playwright/fixtures/image/shot.png';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (list) => {
    document.getElementById('blok')?.remove();
    const d = document.createElement('div');

    d.id = 'blok';
    document.body.appendChild(d);
    const blok = new window.Blok({ holder: 'blok', data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, blocks);
};

const dataOf = (page: Page, id: string): Promise<Record<string, unknown>> =>
  page.evaluate(async (blockId) => {
    if (!window.blokInstance) {
      throw new Error('no editor');
    }
    const out = await window.blokInstance.save();

    return out.blocks.find((b) => b.id === blockId)?.data ?? {};
  }, id);

const canRedo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canRedo() ?? false);

const gap = (page: Page): Promise<void> => page.evaluate((ms) => new Promise<void>((r) => {
  window.setTimeout(r, ms);
}), CAPTURE_GAP_MS);

const typeAtEnd = async (page: Page, text: string, value: string): Promise<void> => {
  await page.getByText(text, { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(value);
};

const P = (id: string, text: string): OutputData['blocks'][number] => ({ id, type: 'paragraph', data: { text } });

// naturalWidth/naturalHeight are preset so the image load write-back (RDO-1) stays out of these tests.
const IMAGE = (): OutputData['blocks'][number] => ({
  id: 'img',
  type: 'image',
  data: { url: IMAGE_URL, alt: 'pic', naturalWidth: 800, naturalHeight: 600 },
});

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('undo audit: native inputs and keyboard owners', () => {
  // Source: undo must restore the exact prior state and keep redo.
  // Observed: canRedo Expected true, Received false; saved image data gains caption: "".
  test('INP-1: clicking an empty image caption does not cost the redo of the next undo', async ({ page }) => {
    test.fail();
    await mount(page, [P('p', 'alpha'), IMAGE()]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.locator('[data-blok-tool="image"]').getByRole('textbox').click();
    await page.keyboard.press(UNDO);
    await gap(page);

    expect(await canRedo(page)).toBe(true);
    expect((await dataOf(page, 'p')).text).toBe('alpha');
    expect((await dataOf(page, 'img')).caption).toBeUndefined();
  });

  // Source: undo must revert the user's latest edit first (the caption typing).
  test('INP-2: Cmd+Z while typing an image caption undoes the caption, not an older edit elsewhere', async ({ page }) => {
    await mount(page, [P('p', 'alpha'), IMAGE()]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    const caption = page.locator('[data-blok-tool="image"]').getByRole('textbox');

    await caption.click();
    await page.keyboard.type('cap');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);

    await expect(caption).toHaveText('', { timeout: 2000 });
    expect((await dataOf(page, 'p')).text).toBe('alphaX');
    await page.keyboard.press(REDO);
    await gap(page);
    await expect(caption).toHaveText('cap', { timeout: 2000 });
  });

  // Source: Notion parity (Cmd+Z right after ticking a to-do unticks it); undo must keep redo.
  // Focus stays on the native checkbox; Blok skips input targets, so the browser runs its own undo.
  // Observed: checked Expected false, Received true; paragraph "alphaX" became "alpha", canRedo false.
  test('INP-3: Cmd+Z after ticking a checklist item unticks it', async ({ page }) => {
    test.fail();
    await mount(page, [P('p', 'alpha'), { id: 'l', type: 'list', data: { text: 'todo', style: 'checklist', checked: false } }]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.getByRole('checkbox').click();
    await gap(page);
    expect((await dataOf(page, 'l')).checked).toBe(true);
    await page.keyboard.press(UNDO);
    await gap(page);

    expect((await dataOf(page, 'l')).checked).toBe(false);
    expect((await dataOf(page, 'p')).text).toBe('alphaX');
    expect(await canRedo(page)).toBe(true);
  });

  // Source: undo must keep redo and must not touch a block through the browser's own undo stack.
  // Focus sits on a swatch button inside a data-blok-keyboard-owner subtree; Blok stands down
  // there (not the input skip of ENT-6), so the browser runs its own undo on the paragraph.
  // The color itself is not asserted: CAP-1 already pins that a paragraph color undo keeps the color.
  // Observed: text Expected "alphaX", Received "alpha"; canRedo false.
  test('INP-4: Cmd+Z with focus on a color swatch does not run the browser undo on the paragraph', async ({ page }) => {
    test.fail();
    await mount(page, [P('p', 'alpha')]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.getByText('alphaX').hover();
    await page.getByTestId('settings-toggler').click();
    await page.getByRole('menuitem', { name: 'Color', exact: true }).hover();
    await page.getByTestId('block-color-picker').getByTestId('block-color-swatch-textColor-red').click();
    await gap(page);
    expect((await dataOf(page, 'p')).textColor).toBe('red');
    await page.keyboard.press(UNDO);
    await gap(page);

    expect((await dataOf(page, 'p')).text).toBe('alphaX');
    expect(await canRedo(page)).toBe(true);
  });
});

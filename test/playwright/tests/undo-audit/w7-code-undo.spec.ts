/**
 * Undo in a code block: every Tab, Shift+Tab, Enter and typed key is a step,
 * and no undo removes more than its own step.
 *
 * After an undo or redo the editor treats DOM changes as its own rewrite until
 * the next frame. A key the code tool handles itself (Tab, Shift+Tab, Enter)
 * fires no beforeinput, so a fast press in that frame was taken for the rewrite
 * and never became a step. The tests hold that frame open so the race is exact.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Longer than the typing window, so the next key opens a new step.
const CAPTURE_GAP_MS = 800;

declare global {
  interface Window {
    blokInstance?: Blok;
    w7HeldFrames?: FrameRequestCallback[];
    w7RealRaf?: typeof window.requestAnimationFrame;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async (list) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const d = document.createElement('div');

    d.id = 'blok';
    document.body.appendChild(d);
    const blok = new window.Blok({ holder: 'blok', data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, blocks);
};

const gap = (page: Page, ms = CAPTURE_GAP_MS): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const codeText = (page: Page): Promise<string> =>
  page.locator('[data-blok-id="c"] code[contenteditable]').evaluate((el) => el.textContent ?? '');

const mountCode = async (page: Page, code = '', language = 'plain text'): Promise<void> => {
  await mount(page, [{ id: 'c', type: 'code', data: { code, language } }]);
  await page.locator('[data-blok-id="c"] code[contenteditable]').click();
  await page.keyboard.press('ControlOrMeta+End');
};

/** Queue every animation frame until {@link releaseFrames}, so keys land before the next frame. */
const holdFrames = (page: Page): Promise<void> => page.evaluate(() => {
  window.w7HeldFrames = [];
  window.w7RealRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    window.w7HeldFrames?.push(cb);

    return 0;
  };
});

const releaseFrames = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    if (window.w7RealRaf !== undefined) {
      window.requestAnimationFrame = window.w7RealRaf;
    }
    const held = window.w7HeldFrames ?? [];

    window.w7HeldFrames = [];
    held.forEach((cb) => cb(performance.now()));
  });
  await gap(page);
};

/** Press `keys` back to back in the frame right after an undo or redo. */
const inSameFrame = async (page: Page, keys: string[]): Promise<void> => {
  await holdFrames(page);
  for (const key of keys) {
    await page.keyboard.press(key);
  }
  await releaseFrames(page);
};

const press = async (page: Page, key: string): Promise<string> => {
  await page.keyboard.press(key);
  await gap(page);

  return codeText(page);
};

test.describe('W7 code block undo', () => {
  test('W7-a: a Tab pressed right after an undo is its own step', async ({ page }) => {
    await mountCode(page, 'ab');
    await page.keyboard.type('cd');
    await gap(page);
    await inSameFrame(page, [UNDO, 'Tab']);
    expect(await codeText(page)).toBe('ab\t');

    expect(await press(page, UNDO)).toBe('ab');
    expect(await press(page, REDO)).toBe('ab\t');
  });

  test('W7-a2: two Tabs right after an undo are two steps', async ({ page }) => {
    await mountCode(page, 'ab');
    await page.keyboard.type('cd');
    await gap(page);
    await inSameFrame(page, [UNDO, 'Tab', 'Tab']);
    expect(await codeText(page)).toBe('ab\t\t');

    expect(await press(page, UNDO)).toBe('ab\t');
    expect(await press(page, UNDO)).toBe('ab');
  });

  test('W7-a3: Shift+Tab and Enter right after a redo are steps', async ({ page }) => {
    await mountCode(page, '\tab');
    await page.keyboard.press('Tab');
    await gap(page);
    expect(await press(page, UNDO)).toBe('\tab');
    await inSameFrame(page, [REDO, 'Shift+Tab']);
    expect(await codeText(page)).toBe('ab\t');
    expect(await press(page, UNDO)).toBe('\tab\t');

    await inSameFrame(page, [UNDO, 'Enter']);
    expect(await codeText(page)).toBe('\tab\n\t');
    expect(await press(page, UNDO)).toBe('\tab');
    expect(await press(page, REDO)).toBe('\tab\n\t');
  });

  test('W7-b: Tab, Shift+Tab, undo and redo never undo more than one step', async ({ page }) => {
    await mountCode(page);
    await page.keyboard.type('if (a) {');
    await gap(page);
    expect(await press(page, 'Enter')).toBe('if (a) {\n\t');
    await page.keyboard.type('x();');
    await gap(page);
    const typed = 'if (a) {\n\tx();';

    expect(await press(page, 'Enter')).toBe(`${typed}\n\t`);
    expect(await press(page, 'Tab')).toBe(`${typed}\n\t\t`);
    expect(await press(page, UNDO)).toBe(`${typed}\n\t`);
    await inSameFrame(page, [REDO, 'Shift+Tab', 'Shift+Tab']);
    expect(await codeText(page)).toBe(`${typed}\n`);
    expect(await press(page, UNDO)).toBe(`${typed}\n\t`);
    await inSameFrame(page, [UNDO, 'Tab', 'Tab']);
    expect(await codeText(page)).toBe(`${typed}\n\t\t\t\t`);
    expect(await press(page, UNDO)).toBe(`${typed}\n\t\t\t`);
    expect(await press(page, UNDO)).toBe(`${typed}\n\t\t`);
    expect(await press(page, UNDO)).toBe(`${typed}\n\t`);
    expect(await press(page, UNDO)).toBe(typed);
  });

  for (const language of ['plain text', 'javascript']) {
    test(`W7-c: a key typed right after an undo is its own step (${language})`, async ({ page }) => {
      await mountCode(page, 'ab', language);
      await page.keyboard.type('cd');
      await gap(page);
      await inSameFrame(page, [UNDO, 'X']);
      expect(await codeText(page)).toBe('abX');

      expect(await press(page, UNDO)).toBe('ab');
      expect(await press(page, REDO)).toBe('abX');
    });
  }
});

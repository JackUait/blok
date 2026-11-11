import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const create = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    localStorage.removeItem('blok:code:recent-languages');
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

/** The selected text, and whether the range runs forward (anchor before focus). */
const selectionState = async (page: Page): Promise<{ text: string; forward: boolean }> => page.evaluate(() => {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.anchorNode === null || selection.focusNode === null) {
    return { text: '', forward: false };
  }

  const anchor = document.createRange();

  anchor.setStart(selection.anchorNode, selection.anchorOffset);

  return {
    text: selection.toString(),
    forward: anchor.comparePoint(selection.focusNode, selection.focusOffset) > 0,
  };
});

/** Caret offset in the code text, or -1 when the caret is not in the code. */
const codeCaret = async (page: Page): Promise<number> => page.getByTestId('code-content').evaluate((code) => {
  const selection = window.getSelection();

  if (document.activeElement !== code || !selection || selection.rangeCount === 0 || !code.contains(selection.focusNode)) {
    return -1;
  }

  const range = document.createRange();

  range.selectNodeContents(code);
  range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);

  return range.toString().length;
});

const savedLanguage = async (page: Page): Promise<unknown> =>
  page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0]?.data.language);

test.describe('undo audit — UI around undo and redo', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  // Notion U070: the linked word stays selected after Enter, after undo and after redo.
  test('applying a link keeps the linked word selected through undo and redo', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'paragraph', data: { text: 'Hello brave world' } }]);
    const editable = editableOf(page, 'b1');
    const link = editable.getByRole('link', { name: 'brave' });

    await editable.getByText('Hello brave world').dblclick({ position: { x: 60, y: 8 } });
    await expect.poll(async () => (await selectionState(page)).text).toBe('brave');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('[data-blok-link-tool-input-opened="true"]')).toBeVisible();
    await page.keyboard.type('https://example.com');
    await page.keyboard.press('Enter');

    await expect(link).toBeVisible();
    expect(await selectionState(page)).toEqual({ text: 'brave', forward: true });
    // No fake-selection span is left around the word.
    expect(await editable.evaluate((el) => el.querySelectorAll('span').length)).toBe(0);

    await page.keyboard.press(UNDO);
    await expect(link).toHaveCount(0);
    expect(await selectionState(page)).toEqual({ text: 'brave', forward: true });

    await page.keyboard.press(REDO);
    await expect(link).toBeVisible();
    expect(await selectionState(page)).toEqual({ text: 'brave', forward: true });
  });

  // Notion U156: the caret stays in the code where it was.
  for (const how of ['click', 'Enter'] as const) {
    test(`a language pick by ${how} keeps the caret in the code`, async ({ page }) => {
      await create(page, [{ id: 'b1', type: 'code', data: { code: 'print(1)', language: 'plain text' } }]);
      const code = page.getByTestId('code-content');

      await code.click();
      await page.keyboard.press('End');
      await expect.poll(() => codeCaret(page)).toBe(8);

      await page.getByTestId('code-language-btn').click();
      await page.keyboard.type('Rust');
      const rust = page.getByRole('menuitemradio', { name: /^Rust/ });

      await expect(rust).toBeVisible();

      if (how === 'click') {
        await rust.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await expect.poll(() => savedLanguage(page)).toBe('rust');
      // Wait out the highlight pass, which rewrites the code markup.
      await page.evaluate(() => new Promise<void>((resolve) => {
        window.setTimeout(resolve, 300);
      }));
      expect(await codeCaret(page)).toBe(8);

      await page.keyboard.press(UNDO);
      await expect.poll(() => savedLanguage(page)).toBe('plain text');
      await expect.poll(() => codeCaret(page)).toBe(8);
    });
  }

  // Notion U200: after a fast burst the live region ends on the newest press, without old texts queued before it.
  test('a fast undo/redo burst ends on Redone without replaying the older texts', async ({ page }) => {
    await create(page, [{ id: 'b1', type: 'paragraph', data: { text: 'one' } }]);
    const steps = 6;

    // Each API call is its own step.
    await page.evaluate(async (count) => {
      for (let index = 0; index < count; index++) {
        window.blokInstance?.blocks.insert('paragraph', { text: `p${index}` }, undefined, index + 1);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 20);
        });
      }
    }, steps);
    await expect.poll(() => page.evaluate(async () => (await window.blokInstance?.save())?.blocks.length)).toBe(steps + 1);

    await editableOf(page, 'b1').click();
    await page.evaluate(() => {
      const heard: string[] = [];
      const region = document.querySelector('[data-blok-announcer][role="status"]');

      if (region === null) {
        throw new Error('no live region');
      }
      new MutationObserver(() => {
        const text = region.textContent ?? '';

        if (text !== '') {
          heard.push(text);
        }
      }).observe(region, { subtree: true, childList: true, characterData: true });
      Object.assign(window, { heard });
    });
    const heard = async (): Promise<string[]> => page.evaluate(() => (window as unknown as { heard: string[] }).heard);

    for (let index = 0; index < steps; index++) {
      await page.keyboard.press(UNDO);
    }
    for (let index = 0; index < steps; index++) {
      await page.keyboard.press(REDO);
    }

    await expect.poll(() => page.evaluate(async () => (await window.blokInstance?.save())?.blocks.length)).toBe(steps + 1);
    await expect.poll(async () => (await heard()).at(-1)).toBe('Redone');
    // Let any texts still queued come out.
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.setTimeout(resolve, 2500);
    }));

    const texts = await heard();

    expect(texts.at(-1)).toBe('Redone');
    // Twelve presses, but the older queued texts are dropped.
    expect(texts.length).toBeLessThanOrEqual(4);
  });
});

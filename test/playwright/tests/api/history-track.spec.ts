import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { htmlOf } from '../helpers/saved-as-html';

const HOLDER_ID = 'blok';
const TITLE_ID = 'host-title';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Yjs captureTimeout is 500ms.
const PAST_CAPTURE = 600;

declare global {
  interface Window {
    blokInstance?: Blok;
    titleChanges?: string[];
  }
}

/**
 * A host title outside the editor, wired the way the playground wires its page
 * title: typing records through `history.track`, Cmd+Z and Cmd+Shift+Z go to
 * the editor's history, and undo/redo write the value back.
 */
const setup = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder, titleId }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    document.getElementById(titleId)?.remove();

    const title = document.createElement('h1');

    title.id = titleId;
    title.contentEditable = 'true';
    title.textContent = 'Blok';

    const container = document.createElement('div');

    container.id = holder;
    document.body.append(title, container);

    const blok = new window.Blok({
      holder,
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'First' } }] },
    });

    window.blokInstance = blok;
    await blok.isReady;

    window.titleChanges = [];

    const tracked = blok.history.track<string>('title', (value, { source }) => {
      window.titleChanges?.push(`${value ?? ''}:${source}`);
      title.textContent = value ?? '';
    });

    tracked.set('Blok', { record: false });
    title.addEventListener('input', () => tracked.set(title.textContent ?? '', { typing: true }));
    title.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          blok.history.redo();
        } else {
          blok.history.undo();
        }
      }
    });
  }, { holder: HOLDER_ID, titleId: TITLE_ID });
};

const titleText = (page: Page): Promise<string | null> => page.locator(`#${TITLE_ID}`).textContent();

const firstBlockText = async (page: Page): Promise<string> => {
  const text = htmlOf(await page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0]?.data.text));

  return typeof text === 'string' ? text : '';
};

const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(async (timeout) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeout);
    });
  }, delayMs);
};

const typeInTitle = async (page: Page, text: string): Promise<void> => {
  await page.locator(`#${TITLE_ID}`).click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
};

test.describe('history.track', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await setup(page);
  });

  test('undo walks back through block and title edits in the order they happened', async ({ page }) => {
    await page.locator('[contenteditable="true"]', { hasText: 'First' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' block');
    await waitForDelay(page, PAST_CAPTURE);
    await typeInTitle(page, ' title');
    await waitForDelay(page, PAST_CAPTURE);

    await page.keyboard.press(UNDO);
    await expect.poll(() => titleText(page)).toBe('Blok');
    expect(await firstBlockText(page)).toBe('First block');

    await page.keyboard.press(UNDO);
    await expect.poll(() => firstBlockText(page)).toBe('First');
    expect(await titleText(page)).toBe('Blok');

    await page.keyboard.press(REDO);
    await expect.poll(() => firstBlockText(page)).toBe('First block');
    expect(await titleText(page)).toBe('Blok');

    // Blok drops a second identical history key within 50ms as a duplicate keydown.
    await waitForDelay(page, 60);
    await page.keyboard.press(REDO);
    await expect.poll(() => titleText(page)).toBe('Blok title');
  });

  test('one title typing run is one undo step', async ({ page }) => {
    await typeInTitle(page, ' rocks hard');
    await waitForDelay(page, PAST_CAPTURE);

    await page.keyboard.press(UNDO);

    await expect.poll(() => titleText(page)).toBe('Blok');
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
  });

  test('a value set with record: false is not undoable', async ({ page }) => {
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
    expect(await page.evaluate(() => window.blokInstance?.history.track<string>('title', () => undefined).get())).toBe('Blok');
  });

  test('a value write and a block insert in the same task undo as one step', async ({ page }) => {
    await page.evaluate(() => {
      const blok = window.blokInstance;

      if (blok === undefined) {
        throw new Error('no editor');
      }

      const title = document.getElementById('host-title');
      const tracked = blok.history.track<string>('title', (value) => {
        if (title !== null) {
          title.textContent = value ?? '';
        }
      });

      if (title !== null) {
        title.textContent = 'Bl';
      }
      tracked.set('Bl');
      blok.blocks.insert('paragraph', { text: 'ok' }, {}, 0, true);
    });
    await expect.poll(() => firstBlockText(page)).toBe('ok');

    await page.evaluate(() => window.blokInstance?.history.undo());

    await expect.poll(() => titleText(page)).toBe('Blok');
    expect(await firstBlockText(page)).toBe('First');
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
  });

  test('onChange says whether undo or redo made the change, and stays quiet for the host\'s own set', async ({ page }) => {
    await typeInTitle(page, '!');
    await waitForDelay(page, PAST_CAPTURE);
    expect(await page.evaluate(() => window.titleChanges)).toEqual([]);

    await page.keyboard.press(UNDO);
    await page.keyboard.press(REDO);

    await expect.poll(() => page.evaluate(() => window.titleChanges)).toEqual(['Blok:undo', 'Blok!:redo']);
  });
});

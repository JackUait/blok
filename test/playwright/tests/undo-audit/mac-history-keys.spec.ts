import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { blocksAsHtml } from '../helpers/saved-as-html';

// Blok picks its history keys from the user agent, so each describe pins one. CI runs on Linux.
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CAPTURE_GAP_MS = 800;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const mount = async (page: Page, text: string): Promise<void> => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (value) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    const blok = new window.Blok({
      holder: 'blok',
      data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: value } }] },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, text);
};

const gap = (page: Page): Promise<void> => page.evaluate((ms) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms);
}), CAPTURE_GAP_MS);

const savedText = async (page: Page): Promise<string> => {
  const blocks = blocksAsHtml(await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('no editor');
    }

    return (await window.blokInstance.save()).blocks;
  }));

  return String((blocks[0]?.data as { text?: unknown }).text);
};

const screenText = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector('#blok [data-blok-id] [contenteditable]')?.textContent ?? '');

const typeAtEnd = async (page: Page, anchor: string, value: string): Promise<void> => {
  await page.getByText(anchor, { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(value);
  await gap(page);
};

// Saved data and the DOM must agree: a native undo would change only the DOM.
const both = async (page: Page): Promise<{ saved: string; screen: string }> => ({
  saved: await savedText(page),
  screen: await screenText(page),
});

const same = (text: string): { saved: string; screen: string } => ({ saved: text, screen: text });

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('macOS history keys (Notion)', () => {
  test.use({ userAgent: MAC_UA });

  test('U189: Cmd+Y redoes', async ({ page }) => {
    await mount(page, 'alpha');
    await typeAtEnd(page, 'alpha', 'X');
    await page.keyboard.press('Meta+z');
    await gap(page);
    expect(await both(page)).toEqual(same('alpha'));

    await page.keyboard.press('Meta+y');
    await gap(page);
    expect(await both(page)).toEqual(same('alphaX'));
  });

  // U190 U191 U192 U194. The chords carry the browser's native undo/redo command, so this also proves
  // Blok cancels it: a native undo would rewind the DOM behind saved data, or run Blok's undo.
  for (const [name, modifiers, command] of [
    ['U191 Ctrl+Z', 2, 'undo'],
    ['U192 Ctrl+Shift+Z', 2 | 8, 'redo'],
    ['U194 Ctrl+Cmd+Z', 2 | 4, 'undo'],
    ['U190 Ctrl+Y', 2, 'redo'],
  ] as const) {
    test(`${name} changes nothing, even when the browser maps it to native ${command}`, async ({ page }) => {
      await mount(page, 'alpha');
      await typeAtEnd(page, 'alpha', 'X');
      if (command === 'redo') {
        await page.keyboard.press('Meta+z');
        await gap(page);
      }
      const before = command === 'redo' ? 'alpha' : 'alphaX';

      expect(await both(page)).toEqual(same(before));

      const letter = name.endsWith('Y') ? 'y' : 'z';
      const cdp = await page.context().newCDPSession(page);
      const key = {
        modifiers,
        key: modifiers & 8 ? letter.toUpperCase() : letter,
        code: letter === 'y' ? 'KeyY' : 'KeyZ',
        windowsVirtualKeyCode: letter === 'y' ? 89 : 90,
      };

      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key, commands: [command] });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      await gap(page);

      expect(await both(page)).toEqual(same(before));
    });
  }

  test('the native undo command really fires without the guard (control for the test above)', async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.evaluate(() => {
      const field = document.createElement('div');

      field.setAttribute('data-blok-testid', 'plain-field');
      field.contentEditable = 'true';
      document.body.appendChild(field);
    });
    await page.getByTestId('plain-field').click();
    await page.keyboard.type('typed');

    const cdp = await page.context().newCDPSession(page);
    const key = { modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 };

    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key, commands: ['undo'] });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });

    await expect(page.getByTestId('plain-field')).toHaveText('');
  });
});

test.describe('Windows and Linux history keys (unchanged)', () => {
  test.use({ userAgent: WINDOWS_UA });

  test('Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo, Meta+Y does nothing', async ({ page }) => {
    await mount(page, 'alpha');
    await typeAtEnd(page, 'alpha', 'X');

    await page.keyboard.press('Control+z');
    await gap(page);
    expect(await both(page)).toEqual(same('alpha'));

    await page.keyboard.press('Control+y');
    await gap(page);
    expect(await both(page)).toEqual(same('alphaX'));

    await page.keyboard.press('Control+z');
    await gap(page);
    await page.keyboard.press('Control+Shift+z');
    await gap(page);
    expect(await both(page)).toEqual(same('alphaX'));

    await page.keyboard.press('Control+z');
    await gap(page);
    await page.keyboard.press('Meta+y');
    await gap(page);
    expect(await both(page)).toEqual(same('alpha'));
  });
});

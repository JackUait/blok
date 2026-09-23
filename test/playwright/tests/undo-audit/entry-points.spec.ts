import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const CAPTURE_GAP_MS = 700;

declare global {
  interface Window {
    blokInstance?: Blok;
    b1?: Blok;
    b2?: Blok;
  }
}

type Which = 'blokInstance' | 'b1' | 'b2';

const mount = async (page: Page, specs: Array<{ key: Which; holder: string; blocks: OutputData['blocks'] }>): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (list) => {
    for (const spec of list) {
      document.getElementById(spec.holder)?.remove();
      const d = document.createElement('div');

      d.id = spec.holder;
      d.setAttribute('data-blok-testid', spec.holder);
      document.body.appendChild(d);
      const blok = new window.Blok({ holder: spec.holder, data: { blocks: spec.blocks } });

      window[spec.key] = blok;
      await blok.isReady;
    }
  }, specs);
};

const texts = (page: Page, which: Which = 'blokInstance'): Promise<string[]> =>
  page.evaluate(async (w) => {
    const instance = window[w];

    if (!instance) {
      throw new Error(`Editor ${w} not found`);
    }
    const out = await instance.save();

    return out.blocks.map((b) => String((b.data as { text?: string }).text ?? ''));
  }, which);

const domTexts = (page: Page, holder: string): Promise<string[]> =>
  page.evaluate((h) => Array.from(document.querySelectorAll(`#${h} [data-blok-testid="block-wrapper"] [contenteditable]`))
    .map((el) => (el as HTMLElement).innerText.replace(/\n$/, '')), holder);

const gap = (page: Page): Promise<void> => page.evaluate((ms) => new Promise<void>((r) => {
  window.setTimeout(r, ms);
}), CAPTURE_GAP_MS);

const typeAtEnd = async (page: Page, text: string, value: string): Promise<void> => {
  await page.getByText(text, { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(value);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const pressNative = async (page: Page, key: { key: string; code: string; vk: number }, commands: string[] = []): Promise<void> => {
  const cdp = await page.context().newCDPSession(page);
  const base = {
    modifiers: process.platform === 'darwin' ? 4 : 2,
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.vk,
  };

  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, commands });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
};

const canRedo = (page: Page): Promise<boolean | undefined> => page.evaluate(() => window.blokInstance?.history.canRedo());

test.describe('undo audit — entry points', () => {
  // Source: multi-editor document-listener law — one press acts in one editor.
  test('ENT-1: Cmd+Z with focus on <body> undoes at most one of two editors', async ({ page }) => {
    await mount(page, [
      { key: 'b1', holder: 'ed1', blocks: [{ type: 'paragraph', data: { text: 'one' } }] },
      { key: 'b2', holder: 'ed2', blocks: [{ type: 'paragraph', data: { text: 'two' } }] },
    ]);
    await typeAtEnd(page, 'one', 'X');
    await gap(page);
    await typeAtEnd(page, 'two', 'Y');
    await gap(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(UNDO);
    await gap(page);

    // Which editor should win is a policy call; only "not both" is asserted.
    const undone = [
      (await texts(page, 'b1'))[0] === 'one',
      (await texts(page, 'b2'))[0] === 'two',
    ].filter(Boolean).length;

    expect(undone).toBeLessThanOrEqual(1);
  });

  // Source: a key press in the host page's own field is not Blok's.
  test('ENT-2: Cmd+Z in a host contenteditable outside the editor leaves Blok alone', async ({ page }) => {
    await mount(page, [{ key: 'blokInstance', holder: 'blok', blocks: [{ type: 'paragraph', data: { text: 'alpha' } }] }]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.evaluate(() => {
      const host = document.createElement('div');

      host.contentEditable = 'true';
      host.setAttribute('data-blok-testid', 'host-ce');
      host.textContent = 'host';
      document.body.appendChild(host);
    });
    await page.getByTestId('host-ce').click();
    await page.keyboard.press('End');
    await page.keyboard.type('Q');
    await page.keyboard.press(UNDO);
    await gap(page);

    expect(await texts(page)).toEqual(['alphaX']);
    await expect(page.getByTestId('host-ce')).toHaveText('host');
  });

  // Source: undo must restore the exact prior state and keep redo.
  // Edit > Undo is simulated with a CDP key event carrying the native "undo" command (mac only).
  test('ENT-3: native undo (Edit menu, historyUndo) goes through Blok history', async ({ page }) => {
    test.skip(process.platform !== 'darwin', 'CDP editing commands exist only on mac');
    await mount(page, [{ key: 'blokInstance', holder: 'blok', blocks: [{ type: 'paragraph', data: { text: 'alpha' } }] }]);
    await typeAtEnd(page, 'alpha', 'XYZ');
    await gap(page);
    await pressNative(page, { key: 'q', code: 'KeyQ', vk: 81 }, ['undo']);
    await gap(page);

    expect(await canRedo(page)).toBe(true);
    await page.keyboard.press(UNDO);
    await gap(page);
    expect(await texts(page)).toEqual(['alpha']);
  });

  // Source: handleTurnInto already matches event.code so it works on any layout.
  // Assumption (not measured on a real layout): a Cyrillic layout sends key "я", code "KeyZ".
  test('ENT-4: Cmd/Ctrl+Z on a non-Latin layout runs Blok undo', async ({ page }) => {
    await mount(page, [{ key: 'blokInstance', holder: 'blok', blocks: [{ type: 'paragraph', data: { text: 'alpha' } }] }]);
    await typeAtEnd(page, 'alpha', 'XYZ');
    await gap(page);
    await pressNative(page, { key: 'я', code: 'KeyZ', vk: 90 });
    await gap(page);

    expect(await texts(page)).toEqual(['alpha']);
  });

  // Source: the audit spec — undo does nothing in read-only (the keyboard path already stands down).
  test('ENT-5: history.undo() does not change a read-only editor', async ({ page }) => {
    await mount(page, [{ key: 'blokInstance', holder: 'blok', blocks: [{ type: 'paragraph', data: { text: 'alpha' } }] }]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle(true);
    });
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);

    expect(await domTexts(page, 'blok')).toEqual(['alphaX']);
  });

  // Source: undo must restore the exact prior state and keep redo.
  // Focus sits in the block settings search input; Blok skips inputs, the browser
  // runs its own historyUndo on the paragraph behind it.
  test('ENT-6: Cmd+Z with block settings open does not run the browser undo on the block', async ({ page }) => {
    await mount(page, [{ key: 'blokInstance', holder: 'blok', blocks: [{ type: 'paragraph', data: { text: 'alpha' } }] }]);
    await typeAtEnd(page, 'alpha', 'XYZ');
    await gap(page);
    await page.getByText('alphaXYZ').hover();
    await page.getByTestId('settings-toggler').click();
    await page.keyboard.press(UNDO);
    await gap(page);
    const afterFirst = await texts(page);

    // Doing nothing in the search input is fine too; reverting the block without a redo entry is not.
    expect(afterFirst[0] === 'alpha' ? await canRedo(page) : true).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByText(/alpha/).first().click();
    await page.keyboard.press(UNDO);
    await gap(page);
    expect(await texts(page)).toEqual(['alpha']);
  });
});

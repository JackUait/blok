import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * A document that boots read-only is rendered while nothing may write to it,
 * so the load normalise and the emitted-keys record never run. Leaving
 * read-only in place re-renders nothing. The first edit after it must still
 * behave as it does in a document that booted editable.
 */

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const CAPTURE_GAP_MS = 700;

declare global {
  interface Window {
    blokInstance?: Blok;
    bootHolder?: Element | null;
  }
}

type Blocks = OutputData['blocks'];

/**
 * Boot with `blocks`. With `readOnlyBoot`, boot read-only and then leave
 * read-only in place (no re-render). The page defines a `flag` tool whose
 * save() carries `flag: true` only while its switch is on.
 */
const create = async (page: Page, blocks: Blocks, readOnlyBoot: boolean): Promise<void> => {
  await page.evaluate(async ({ holder, list, readOnly }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    class FlagTool {
      public static isReadOnlySupported = true;
      private readonly root: HTMLDivElement;

      constructor({ data }: { data: { text?: string; flag?: boolean } }) {
        this.root = document.createElement('div');
        const text = document.createElement('div');
        const toggle = document.createElement('button');

        text.contentEditable = 'true';
        text.innerHTML = data.text ?? '';
        toggle.type = 'button';
        toggle.textContent = 'flag';
        toggle.setAttribute('data-blok-testid', 'flag-switch');
        toggle.addEventListener('click', () => {
          this.root.toggleAttribute('data-flag');
        });
        this.root.append(text, toggle);
        if (data.flag === true) {
          this.root.setAttribute('data-flag', '');
        }
      }

      public render(): HTMLElement {
        return this.root;
      }

      public setReadOnly(): void {}

      public save(): { text: string; flag?: boolean } {
        const text = this.root.firstElementChild?.innerHTML ?? '';

        return this.root.hasAttribute('data-flag') ? { text, flag: true } : { text };
      }
    }

    const blok = new window.Blok({ holder, readOnly, tools: { flag: FlagTool }, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;

    if (readOnly) {
      window.bootHolder = document.querySelector('[data-blok-testid="block-wrapper"]');
      await blok.readOnly.toggle(false);
    }
  }, { holder: HOLDER_ID, list: blocks, readOnly: readOnlyBoot });

  if (readOnlyBoot) {
    // Guards the premise: leaving read-only kept the same DOM.
    expect(await page.evaluate(() => window.bootHolder === document.querySelector('[data-blok-testid="block-wrapper"]'))).toBe(true);
  }
};

const gap = (page: Page): Promise<void> => page.evaluate((ms) => new Promise<void>((r) => {
  window.setTimeout(r, ms);
}), CAPTURE_GAP_MS);

const saved = (page: Page): Promise<Array<{ type: string; data: unknown }>> => page.evaluate(async () => {
  const out = await window.blokInstance?.save();

  return (out?.blocks ?? []).map((block) => ({ type: block.type, data: block.data }));
});

const canUndo = (page: Page): Promise<boolean | undefined> => page.evaluate(() => window.blokInstance?.history.canUndo());

for (const readOnlyBoot of [false, true]) {
  const boot = readOnlyBoot ? 'after a read-only boot' : 'after an editable boot';

  test.describe(`first edit ${boot}`, () => {
    test.beforeAll(() => {
      ensureBlokBundleBuilt();
    });

    test.beforeEach(async ({ page }) => {
      await gotoTestPage(page);
    });

    test('Enter in the middle of a quote saved without its size is one undo step', async ({ page }) => {
      await create(page, [{ id: 'q', type: 'quote', data: { text: 'Quoted' } }], readOnlyBoot);
      await gap(page);
      const before = await saved(page);
      const editable = page.locator('[data-blok-id="q"] [contenteditable="true"]').first();

      await editable.click();
      await editable.evaluate((el) => {
        const range = document.createRange();

        range.setStart(el.firstChild ?? el, 3);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      });
      await page.keyboard.press('Enter');
      await gap(page);
      expect(await saved(page)).not.toEqual(before);

      await page.keyboard.press(UNDO);
      await gap(page);

      expect(await saved(page), 'one undo restores the quote').toEqual(before);
      expect(await canUndo(page), 'nothing is left to undo').toBe(false);
    });

    test('turning off a key the tool saved is undoable', async ({ page }) => {
      await create(page, [{ id: 'f', type: 'flag', data: { text: 'Flagged', flag: true } }], readOnlyBoot);
      await gap(page);
      const before = await saved(page);

      await page.locator('[data-blok-id="f"]').getByTestId('flag-switch').click();
      await gap(page);
      expect(await saved(page)).toEqual([{ type: 'flag', data: { text: 'Flagged' } }]);

      await page.locator('[data-blok-id="f"] [contenteditable="true"]').click();
      await page.keyboard.press(UNDO);
      await gap(page);

      expect(await saved(page), 'one undo turns the key back on').toEqual(before);
    });
  });
}

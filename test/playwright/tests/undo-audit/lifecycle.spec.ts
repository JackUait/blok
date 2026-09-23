import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_WINDOW = 600;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blocks: data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: data } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const waitForDelay = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (timeout) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeout);
    });
  }, ms);
};

const canUndo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canUndo() ?? false);

const saveBlok = (page: Page): Promise<OutputData> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('Blok instance not found');
  }

  return await window.blokInstance.save();
});

const blockTexts = (page: Page): Promise<string[]> => page.getByTestId('block-wrapper').allInnerTexts();

const typeAtEndOfFirstBlock = async (page: Page, text: string): Promise<void> => {
  const input = page.getByTestId('block-wrapper').first().locator('[contenteditable="true"]').first();

  await input.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
};

const BODYLESS_CALLOUT: OutputData['blocks'] = [
  { id: 'c', type: 'callout', data: { emoji: '💡' } },
  { id: 'z', type: 'paragraph', data: { text: 'Z' } },
];

test.describe('undo audit: lifecycle and programmatic API', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  // Expected: a freshly loaded document has nothing to undo (a load is not an edit).
  // Observed: Expected: false, Received: true — the load-time seed paragraph is an undo entry.
  test('LIF-1: loading a bodyless callout records its seeded body as an undo step', async ({ page }) => {
    test.fail();
    await createBlok(page, BODYLESS_CALLOUT);

    expect(await canUndo(page)).toBe(false);

    await page.getByText('Z').click();
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    await expect(page.locator('[data-blok-component="callout"] [contenteditable="true"]')).toHaveCount(1);
    expect((await saveBlok(page)).blocks.find((block) => block.id === 'c')?.content ?? []).toHaveLength(1);
  });

  // Same root cause as LIF-1, reached through render() instead of the constructor.
  // Observed: Expected: false, Received: true.
  test('LIF-1 (render path): render() of a bodyless callout records its seeded body as an undo step', async ({ page }) => {
    test.fail();
    await createBlok(page, [{ id: 'old', type: 'paragraph', data: { text: 'Old' } }]);
    await page.evaluate(async (blocks) => {
      await window.blokInstance?.render({ blocks });
    }, BODYLESS_CALLOUT);

    expect(await canUndo(page)).toBe(false);

    await page.evaluate(() => window.blokInstance?.history.undo());
    await waitForDelay(page, 300);

    expect((await saveBlok(page)).blocks.find((block) => block.id === 'c')?.content ?? []).toHaveLength(1);
  });

  // Expected: render() replaces the document and clears history (it does for any non-empty document).
  // Observed: Expected: false, Received: true — Cmd+Z then brings "Old doc" back.
  test('LIF-2: undo after render({ blocks: [] }) brings the previous document back', async ({ page }) => {
    test.fail();
    await createBlok(page, [{ id: 'old', type: 'paragraph', data: { text: 'Old doc' } }]);
    await page.evaluate(async () => {
      await window.blokInstance?.render({ blocks: [] });
    });

    expect(await canUndo(page)).toBe(false);

    await page.locator('[contenteditable="true"]').first().click();
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 300);

    await expect(page.getByText('Old doc')).toHaveCount(0);
  });

  // Expected: read-only must not change the document (Cmd+Z already no-ops there). Docs are silent
  // on the programmatic API in read-only, and blocks.update() shares the gap.
  // Observed: Expected: ["Ax"], Received: ["A"].
  test('LIF-3: history.undo() changes the document while read-only', async ({ page }) => {
    test.fail();
    await createBlok(page, [{ id: 'a', type: 'paragraph', data: { text: 'A' } }]);
    await typeAtEndOfFirstBlock(page, 'x');
    await waitForDelay(page, CAPTURE_WINDOW);
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.set(true);
    });

    await page.evaluate(() => window.blokInstance?.history.undo());
    await waitForDelay(page, 300);

    expect(await blockTexts(page)).toEqual(['Ax']);
  });

  // The fallback read-only toggle (a tool without setReadOnly) re-renders every block.
  // Docs: "undo history is deliberately left untouched" on that path.
  test('undo still works after a fallback read-only round trip', async ({ page }) => {
    await page.evaluate(async ({ holder }) => {
      class NoInPlaceReadOnly {
        private readonly text: string;

        constructor({ data }: { data: { text?: string } }) {
          this.text = data.text ?? '';
        }

        public static get isReadOnlySupported(): boolean {
          return true;
        }

        public render(): HTMLElement {
          const element = document.createElement('div');

          element.textContent = this.text;

          return element;
        }

        public save(element: HTMLElement): { text: string } {
          return { text: element.textContent ?? '' };
        }
      }

      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
      }
      document.getElementById(holder)?.remove();

      const container = document.createElement('div');

      container.id = holder;
      document.body.appendChild(container);

      const blok = new window.Blok({
        holder,
        tools: { noInPlace: { class: NoInPlaceReadOnly } },
        data: {
          blocks: [
            { id: 'a', type: 'paragraph', data: { text: 'A' } },
            { id: 'n', type: 'noInPlace', data: { text: 'N' } },
          ],
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    }, { holder: HOLDER_ID });

    await typeAtEndOfFirstBlock(page, 'x');
    await waitForDelay(page, CAPTURE_WINDOW);
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.set(true);
      await window.blokInstance?.readOnly.set(false);
    });

    await page.evaluate(() => window.blokInstance?.history.undo());
    await waitForDelay(page, 300);

    expect(await blockTexts(page)).toEqual(['A', 'N']);
    expect((await saveBlok(page)).blocks.map((block) => (block.data as { text: string }).text)).toEqual(['A', 'N']);

    await page.evaluate(() => window.blokInstance?.history.redo());
    await waitForDelay(page, 300);

    expect(await blockTexts(page)).toEqual(['Ax', 'N']);
  });
});

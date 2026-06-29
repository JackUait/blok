/**
 * Regression e2e specs for two caret-restoration bugs (Notion text/header parity):
 *
 *   BUG #9  — after Cmd/Ctrl+D the caret must land in the NEW copy ready to edit,
 *             not leave the copy block-selected.
 *   BUG #19 — Escape after Cmd+A twice (select ALL blocks) must clear the
 *             highlight AND return a text caret.
 *
 * NOTE FOR ORCHESTRATOR: these are e2e regression specs and are intentionally NOT
 * run by the authoring agent (port 4444 collision); run them serially.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.body.innerHTML = '';

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createParagraphBlok = async (page: Page, texts: string[]): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const blocks: OutputData['blocks'] = texts.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const getBlockWrapper = (page: Page, index: number): ReturnType<Page['locator']> =>
  page.locator(`:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`);

/**
 * Returns whether the current native selection lives inside a contenteditable
 * element within the editor — i.e. a real text caret is present.
 */
const caretIsInEditor = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const node = selection.getRangeAt(0).startContainer;
    const element = node instanceof Element ? node : node.parentElement;

    return element?.closest('[contenteditable="true"]') !== null;
  });

test.describe('caret restoration regressions', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('BUG #9: Cmd/Ctrl+D lands a caret in the duplicated copy ready to edit', async ({ page }) => {
    await createParagraphBlok(page, ['Hello']);

    const firstInput = getBlockWrapper(page, 0).locator('[contenteditable="true"]');

    await firstInput.click();
    await page.keyboard.press(`${MODIFIER_KEY}+d`);

    // A second block (the copy) now exists.
    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

    const copyWrapper = getBlockWrapper(page, 1);

    // The copy is NOT block-selected — the user is editing, not multi-selecting.
    await expect(copyWrapper).not.toHaveAttribute('data-blok-selected', 'true');

    // A real text caret is present, so typing flows into the copy.
    expect(await caretIsInEditor(page)).toBe(true);

    await page.keyboard.type('!');

    await expect(copyWrapper.locator('[contenteditable="true"]')).toContainText('Hello!');
    // The original block is untouched.
    await expect(getBlockWrapper(page, 0).locator('[contenteditable="true"]')).toHaveText('Hello');
  });

  test('BUG #19: Escape after select-all-blocks clears the highlight and restores the caret', async ({ page }) => {
    await createParagraphBlok(page, ['First', 'Second']);

    const firstInput = getBlockWrapper(page, 0).locator('[contenteditable="true"]');

    await firstInput.click();

    // Notion-style 3-stage Cmd+A: 1) select the block's text, 2) select THIS
    // block, 3) escalate to ALL blocks.
    await page.keyboard.press(`${MODIFIER_KEY}+a`);
    await page.keyboard.press(`${MODIFIER_KEY}+a`);
    await page.keyboard.press(`${MODIFIER_KEY}+a`);

    await expect(getBlockWrapper(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockWrapper(page, 1)).toHaveAttribute('data-blok-selected', 'true');

    await page.keyboard.press('Escape');

    // Highlight is cleared on every block...
    await expect(getBlockWrapper(page, 0)).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockWrapper(page, 1)).not.toHaveAttribute('data-blok-selected', 'true');

    // ...and a text caret is returned to the editor.
    expect(await caretIsInEditor(page)).toBe(true);
  });
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Clicking anywhere in a code line's horizontal strip (gutter number or empty
 * space after the text) must place the caret at the end of that text line.
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(ensureBlokBundleBuilt);

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const BLOCK_DATA: OutputData['blocks'] = [
  {
    type: 'code',
    data: {
      code: 'const a = 1;\nconst bb = 2;\nconst ccc = 3;',
      language: 'javascript',
    },
  },
];

const getCaretLineInfo = async (page: Page) => {
  return page.evaluate((holder) => {
    const codeEl = document.getElementById(holder)?.querySelector<HTMLElement>('pre > code');

    if (!codeEl) {
      throw new Error('code element not found');
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return { focused: false, lineIndex: -1, atLineEnd: false };
    }

    const range = selection.getRangeAt(0);

    if (!codeEl.contains(range.endContainer)) {
      return { focused: false, lineIndex: -1, atLineEnd: false };
    }

    const fullText = codeEl.textContent ?? '';
    const preRange = document.createRange();

    preRange.selectNodeContents(codeEl);
    preRange.setEnd(range.endContainer, range.endOffset);

    const caretOffset = preRange.toString().length;
    const before = fullText.slice(0, caretOffset);
    const lineIndex = (before.match(/\n/g) ?? []).length;
    const lines = fullText.split('\n');
    const currentLineStart = before.lastIndexOf('\n') + 1;
    const posInLine = caretOffset - currentLineStart;
    const atLineEnd = posInLine === lines[lineIndex].length;

    return { focused: true, lineIndex, atLineEnd };
  }, HOLDER_ID);
};

test.describe('Code block — click line to focus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('clicking gutter line places caret at end of that line', async ({ page }) => {
    await createBlok(page, BLOCK_DATA);

    const gutter = page.locator('[data-line-index="1"]');

    await gutter.click();

    const info = await getCaretLineInfo(page);

    expect(info.focused).toBe(true);
    expect(info.lineIndex).toBe(1);
    expect(info.atLineEnd).toBe(true);
  });

  test('clicking empty space to the right of line text places caret at end of that line', async ({ page }) => {
    await createBlok(page, BLOCK_DATA);

    const codeEl = page.locator('[data-blok-testid="code-content"]');
    const box = await codeEl.boundingBox();

    if (!box) {
      throw new Error('code element bounding box not found');
    }

    const lineHeight = box.height / 3;
    const targetY = box.y + lineHeight * 0.5 + lineHeight * 2; // third line
    const targetX = box.x + box.width - 4; // far right of code area

    await page.mouse.click(targetX, targetY);

    const info = await getCaretLineInfo(page);

    expect(info.focused).toBe(true);
    expect(info.lineIndex).toBe(2);
    expect(info.atLineEnd).toBe(true);
  });
});

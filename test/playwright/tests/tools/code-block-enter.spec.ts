import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Regression suite for pressing Enter inside a code block.
 *
 * Symptom: pressing Enter inside a code block inserted a newline locally AND
 * split the block — creating a new paragraph block and moving the caret into
 * it. Users saw "a string added below, then caret jumps to the top of the
 * block" because focus escaped the code element.
 *
 * Root cause: CodeTool did not declare `static get enableLineBreaks()`, so the
 * global KeyboardNavigation.handleEnter ran on top of the tool's own Enter
 * handler (handleCodeKeydown) and created a second block.
 *
 * The bug only reproduces when the code block is not the only block on the
 * page, because KeyboardNavigation.handleEnter's split path relies on a
 * sibling existing. The regression tests below therefore surround the code
 * block with paragraphs.
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

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

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

/**
 * Count rendered blocks in the DOM. Unlike blok.save(), this is NOT filtered
 * by per-tool validate() so empty paragraphs created by the bug are visible.
 */
const domBlockCount = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('[data-blok-id]').length);

const codeBlocksInDOM = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('[data-blok-component="code"]').length);

const getCodeText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-blok-testid="code-content"]');

    return el?.textContent ?? '';
  });

/**
 * Returns the caret offset within the code content element, or null if the
 * caret is not inside any code-content element.
 */
const codeCaretOffset = (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const sel = window.getSelection();

    if (sel === null || sel.rangeCount === 0) {
      return null;
    }
    const range = sel.getRangeAt(0);
    const codeEl = (range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement)?.closest('[data-blok-testid="code-content"]') as HTMLElement | null;

    if (codeEl === null || !codeEl.contains(range.startContainer)) {
      return null;
    }
    const pre = range.cloneRange();

    pre.selectNodeContents(codeEl);
    pre.setEnd(range.startContainer, range.startOffset);

    return pre.toString().length;
  });

/**
 * Click into the code element so BlockManager's currentBlock gets set, then
 * place the caret at the requested offset programmatically. A real click is
 * essential (programmatic ranges alone bypass BlockManager and would mask
 * the very bug this suite is here to detect). The programmatic caret avoids
 * cross-browser flakiness in ArrowRight loops over multi-line content.
 */
const focusCodeAtOffset = async (page: Page, offset: number): Promise<void> => {
  await page.getByTestId('code-content').click();
  await page.evaluate((target) => {
    const el = document.querySelector<HTMLElement>('[data-blok-testid="code-content"]');

    if (el === null) {
      return;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let node = walker.nextNode();

    while (node !== null) {
      const len = (node.textContent ?? '').length;

      if (acc + len >= target) {
        const range = document.createRange();

        range.setStart(node, target - acc);
        range.collapse(true);
        const sel = window.getSelection();

        sel?.removeAllRanges();
        sel?.addRange(range);

        return;
      }
      acc += len;
      node = walker.nextNode();
    }
  }, offset);
};

test.describe('Code block Enter regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('Enter in the middle of code inserts a newline in place, no extra block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'above' } },
        { type: 'code', data: { code: 'hello world', language: 'plain text' } },
        { type: 'paragraph', data: { text: 'below' } },
      ],
    });

    await focusCodeAtOffset(page, 5);

    const countBefore = await domBlockCount(page);

    await page.keyboard.press('Enter');

    expect(await domBlockCount(page)).toBe(countBefore);
    expect(await codeBlocksInDOM(page)).toBe(1);
    expect(await getCodeText(page)).toBe('hello\n world');
    expect(await codeCaretOffset(page)).toBe(6);
  });

  test('Enter at the end of code inserts trailing newline, no new block, caret stays in code', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'above' } },
        { type: 'code', data: { code: 'line1', language: 'plain text' } },
        { type: 'paragraph', data: { text: 'below' } },
      ],
    });

    await focusCodeAtOffset(page, 5);

    const countBefore = await domBlockCount(page);

    await page.keyboard.press('Enter');

    expect(await domBlockCount(page)).toBe(countBefore);
    // sentinel <br> appears after a trailing '\n' — textContent still reads as 'line1\n'
    expect(await getCodeText(page)).toBe('line1\n');
    expect(await codeCaretOffset(page)).toBe(6);
  });

  test('Enter at the start of code inserts leading newline, no new block, caret on the new first line', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'above' } },
        { type: 'code', data: { code: 'abc', language: 'plain text' } },
        { type: 'paragraph', data: { text: 'below' } },
      ],
    });

    await focusCodeAtOffset(page, 0);

    const countBefore = await domBlockCount(page);

    await page.keyboard.press('Enter');

    expect(await domBlockCount(page)).toBe(countBefore);
    expect(await getCodeText(page)).toBe('\nabc');
    expect(await codeCaretOffset(page)).toBe(1);
  });

  test('repeated Enter inside code never creates additional blocks', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'above' } },
        { type: 'code', data: { code: 'x', language: 'plain text' } },
        { type: 'paragraph', data: { text: 'below' } },
      ],
    });

    await focusCodeAtOffset(page, 1);

    const countBefore = await domBlockCount(page);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    expect(await domBlockCount(page)).toBe(countBefore);
    expect(await getCodeText(page)).toBe('x\n\n\n');
    expect(await codeCaretOffset(page)).toBe(4);
  });

  test('Enter keeps focus inside the code element (caret does not jump out)', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'paragraph', data: { text: 'above' } },
        { type: 'code', data: { code: 'hello', language: 'plain text' } },
        { type: 'paragraph', data: { text: 'below' } },
      ],
    });

    await focusCodeAtOffset(page, 5);
    await page.keyboard.press('Enter');

    const activeIsCode = await page.evaluate(() => {
      const active = document.activeElement;

      return active instanceof HTMLElement && active.getAttribute('data-blok-testid') === 'code-content';
    });

    expect(activeIsCode).toBe(true);
    expect(await codeCaretOffset(page)).not.toBeNull();
  });

  test('Shift+Enter inside code exits the block (creates a paragraph below)', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: 'hello', language: 'plain text' } },
      ],
    });

    await focusCodeAtOffset(page, 5);
    await page.keyboard.press('Shift+Enter');

    // The code stays intact; a paragraph is created right below it.
    const result = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (blok === undefined) {
        throw new Error('blok not ready');
      }
      const saved = await blok.save();

      return saved.blocks.map((b) => ({ type: b.type, data: b.data as Record<string, unknown> }));
    });

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('code');
    expect(result[0].data.code).toBe('hello');
    expect(result[1].type).toBe('paragraph');
  });
});

test.describe('Code block Enter — highlighted languages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('Enter inserts newline in a Prism-highlighted block (no stale-dispose revert)', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: 'const a = 1;', language: 'javascript' } },
      ],
    });

    // Let the initial highlightCode settle so _disposeHighlights is set.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));

    await focusCodeAtOffset(page, 5);
    await page.keyboard.press('Enter');

    // Wait past the scheduled RAF highlight — if the stale dispose fires, it
    // would rewrite innerHTML back to the pre-Enter snapshot.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));

    expect(await getCodeText(page)).toBe('const\n a = 1;');
    expect(await codeCaretOffset(page)).toBe(6);
  });

  test('Enter at end of highlighted code leaves a focusable new line (trailing <br> preserved)', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: 'const a = 1;', language: 'javascript' } },
      ],
    });

    // Let the initial Prism highlight finish so the subsequent RAF highlight
    // (triggered by Enter) runs through applyPrismHighlight which rewrites
    // innerHTML — this is what used to drop the trailing <br> sentinel.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));

    await focusCodeAtOffset(page, 12);
    await page.keyboard.press('Enter');

    // Wait past the scheduled highlight so applyPrismHighlight has rewritten
    // innerHTML before we assert.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));

    expect(await getCodeText(page)).toBe('const a = 1;\n');
    expect(await codeCaretOffset(page)).toBe(13);

    // Sentinel <br> is required — without it Chrome collapses the trailing
    // newline and the new line has no line box, so the caret sits nowhere
    // visible and a single keystroke cannot land on the new line.
    const lastChildIsBr = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-blok-testid="code-content"]');

      return el?.lastChild instanceof HTMLBRElement;
    });

    expect(lastChildIsBr).toBe(true);

    // Typing one character must land on the new line.
    await page.keyboard.type('X');
    expect(await getCodeText(page)).toBe('const a = 1;\nX');
  });
});

test.describe('Code block Enter — auto-indent and bracket expansion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('Enter preserves leading spaces of the current line', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '    hello', language: 'plain text' } },
      ],
    });

    await focusCodeAtOffset(page, 9);

    const countBefore = await domBlockCount(page);

    await page.keyboard.press('Enter');

    expect(await domBlockCount(page)).toBe(countBefore);
    expect(await getCodeText(page)).toBe('    hello\n    ');
    expect(await codeCaretOffset(page)).toBe(14);
  });

  test('Enter on an inner indented line preserves that line\'s indent (not line 1)', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: 'no indent\n    indented', language: 'plain text' } },
      ],
    });

    await focusCodeAtOffset(page, 22);
    await page.keyboard.press('Enter');

    expect(await getCodeText(page)).toBe('no indent\n    indented\n    ');
    expect(await codeCaretOffset(page)).toBe(27);
  });

  test('Enter between {} expands to three lines with caret on indented middle line', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '{}', language: 'plain text' } },
      ],
    });

    await focusCodeAtOffset(page, 1);
    await page.keyboard.press('Enter');

    expect(await getCodeText(page)).toBe('{\n  \n}');
    expect(await codeCaretOffset(page)).toBe(4);
  });

  test('Enter between () expands the same way', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '()', language: 'plain text' } },
      ],
    });

    await focusCodeAtOffset(page, 1);
    await page.keyboard.press('Enter');

    expect(await getCodeText(page)).toBe('(\n  \n)');
    expect(await codeCaretOffset(page)).toBe(4);
  });

  test('Enter between [] expands the same way', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '[]', language: 'plain text' } },
      ],
    });

    await focusCodeAtOffset(page, 1);
    await page.keyboard.press('Enter');

    expect(await getCodeText(page)).toBe('[\n  \n]');
    expect(await codeCaretOffset(page)).toBe(4);
  });

  test('Enter after a line ending with { indents one level deeper', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: 'if (x) {', language: 'plain text' } },
      ],
    });

    await focusCodeAtOffset(page, 8);
    await page.keyboard.press('Enter');

    expect(await getCodeText(page)).toBe('if (x) {\n  ');
    expect(await codeCaretOffset(page)).toBe(11);
  });

  test('Enter between {} on an indented line preserves outer indent and adds one unit', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '  if (x) {}', language: 'plain text' } },
      ],
    });

    await focusCodeAtOffset(page, 10);
    await page.keyboard.press('Enter');

    expect(await getCodeText(page)).toBe('  if (x) {\n    \n  }');
    expect(await codeCaretOffset(page)).toBe(15);
  });
});

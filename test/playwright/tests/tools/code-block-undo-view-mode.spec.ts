import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Regression suite for code block undo/redo view mode preservation.
 *
 * Original symptom: after switching a previewable code block (LaTeX, Mermaid)
 * from "preview" to "code" view mode and then performing undo (Ctrl/Cmd+Z),
 * the view mode would reset to "preview" — the user's view-mode choice was lost.
 *
 * Root cause: CodeTool lacked a `setData()` method, so undo/redo fell back to
 * a full re-render. The newly created CodeTool instance always initialised
 * `_viewMode = 'preview'` for previewable languages, discarding the transient
 * UI state.
 *
 * Fix: CodeTool now implements `setData()`, which updates code/language/lineNumbers
 * in place without destroying the instance, thus preserving the view mode.
 */

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

/** Wait for Yjs captureTimeout (500 ms) plus small buffer. */
const YJS_CAPTURE_TIMEOUT = 600;

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

const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    delayMs
  );
};

test.describe('Code block undo/redo view mode preservation', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('undo preserves "code" view mode on a previewable (latex) code block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: 'E = mc^2', language: 'latex' } },
      ],
    });

    // Previewable block should start in "preview" mode
    const previewBtn = page.getByTestId('code-mode-preview');
    const codeBtn = page.getByTestId('code-mode-code');

    await expect(previewBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(codeBtn).toHaveAttribute('aria-pressed', 'false');

    // Switch to "code" view mode by clicking the code button.
    // View mode buttons have opacity-0 by default; force-click to bypass.
    await codeBtn.click({ force: true });

    await expect(codeBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(previewBtn).toHaveAttribute('aria-pressed', 'false');

    // Wait for Yjs capture so the view-mode switch is a separate undo step
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Make an edit inside the code block
    const codeEl = page.getByTestId('code-content');

    await codeEl.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' + p');

    // Wait for Yjs to capture the edit
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Undo the text edit
    await page.keyboard.press(UNDO_SHORTCUT);

    // Wait a beat for the undo to propagate
    await waitForDelay(page, 200);

    // View mode must STILL be "code" — not reset to "preview"
    await expect(codeBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(previewBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('multiple undos do not reset view mode on a previewable code block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: '\\frac{a}{b}', language: 'latex' } },
      ],
    });

    const codeBtn = page.getByTestId('code-mode-code');
    const previewBtn = page.getByTestId('code-mode-preview');

    // Switch to "code" view
    await codeBtn.click({ force: true });
    await expect(codeBtn).toHaveAttribute('aria-pressed', 'true');

    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Make first edit
    const codeEl = page.getByTestId('code-content');

    await codeEl.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' + x');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Make second edit
    await page.keyboard.type(' + y');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Undo twice
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    // View mode should remain "code"
    await expect(codeBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(previewBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('undo preserves "split" view mode on a previewable code block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { type: 'code', data: { code: 'E = mc^2', language: 'latex' } },
      ],
    });

    const splitBtn = page.getByTestId('code-mode-split');
    const previewBtn = page.getByTestId('code-mode-preview');

    // Switch to "split" view
    await splitBtn.click({ force: true });
    await expect(splitBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(previewBtn).toHaveAttribute('aria-pressed', 'false');

    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Edit the code
    const codeEl = page.getByTestId('code-content');

    await codeEl.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' + z');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Undo
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    // View mode should still be "split"
    await expect(splitBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(previewBtn).toHaveAttribute('aria-pressed', 'false');
  });
});

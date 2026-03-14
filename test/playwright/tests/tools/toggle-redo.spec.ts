/**
 * Regression test for: redo (CMD+Shift+Z) after adding a block inside a toggle list/heading
 * places the block OUTSIDE the toggle instead of inside it.
 *
 * Steps that reproduce the bug:
 *  1. Create a toggle with existing content
 *  2. Press Enter at the end of the toggle to add a child block INSIDE it
 *  3. Undo (CMD+Z) — child block disappears
 *  4. Redo (CMD+Shift+Z) — child block should be restored INSIDE the toggle,
 *     but the bug causes it to appear outside the toggle
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOGGLE_CHILDREN_SELECTOR = '[data-blok-toggle-children]';
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;

// Shortcuts vary by platform
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

/** Yjs captureTimeout is 500 ms; wait a bit longer for reliability. */
const YJS_CAPTURE_TIMEOUT_MS = 600;

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
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, data: initialData });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data }
  );
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return window.blokInstance.save();
  });
};

const waitMs = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    ms
  );
};

test.describe('Toggle redo regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('redo after undoing Enter inside toggle list keeps child block inside toggle', async ({ page }) => {
    // 1. Start with a toggle that has no children
    await createBlok(page, {
      blocks: [{ type: 'toggle', data: { text: 'My toggle' } }],
    });

    // Toggle starts expanded in editing mode
    await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

    // 2. Click the toggle content and press Enter to add a child block inside
    const toggleContent = page.locator('[data-blok-toggle-content]');

    await toggleContent.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // A new paragraph should appear inside the toggle children container
    const childInsideToggle = page.locator(`${TOGGLE_CHILDREN_SELECTOR} [contenteditable]`);

    await expect(childInsideToggle).toBeVisible();

    // Wait for Yjs to capture the block-creation into the undo stack
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Sanity check: the new paragraph is a child of the toggle in saved data
    const dataAfterEnter = await saveBlok(page);
    const toggleAfterEnter = dataAfterEnter.blocks.find(b => b.type === 'toggle');
    const paragraphAfterEnter = dataAfterEnter.blocks.find(b => b.type === 'paragraph');

    expect(paragraphAfterEnter).toBeDefined();
    expect(toggleAfterEnter?.content).toContain(paragraphAfterEnter?.id);

    // 3. Undo — child block should disappear
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitMs(page, 200);

    const dataAfterUndo = await saveBlok(page);

    // After undo, toggle should have no children
    const toggleAfterUndo = dataAfterUndo.blocks.find(b => b.type === 'toggle');

    expect(toggleAfterUndo?.content ?? []).toHaveLength(0);
    expect(dataAfterUndo.blocks.filter(b => b.type === 'paragraph')).toHaveLength(0);

    // 4. Redo — child block should be restored INSIDE the toggle
    await page.keyboard.press(REDO_SHORTCUT);
    await waitMs(page, 200);

    const dataAfterRedo = await saveBlok(page);
    const toggleAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'toggle');
    const paragraphAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'paragraph');

    expect(paragraphAfterRedo).toBeDefined();

    // BUG: without the fix, paragraphAfterRedo has no parent (block outside toggle)
    // The paragraph's id must appear in the toggle's content array
    expect(toggleAfterRedo?.content).toContain(paragraphAfterRedo?.id);

    // Also assert the DOM: the restored paragraph must be inside the toggle children container
    const restoredChildInToggle = page.locator(`${TOGGLE_CHILDREN_SELECTOR} [contenteditable]`);

    await expect(restoredChildInToggle).toBeVisible();
  });

  test('redo after undoing Enter inside toggle heading keeps child block inside toggle heading', async ({ page }) => {
    // 1. Start with a toggle heading that has no children
    await createBlok(page, {
      blocks: [{ type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true } }],
    });

    // Toggle heading starts expanded in editing mode
    const header = page.getByRole('heading', { level: 2, name: 'Toggle heading' });

    await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');

    // 2. Click the heading and press Enter to add a child block inside
    await header.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Wait for Yjs to capture the block-creation into the undo stack
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Sanity check: the new paragraph is a child of the toggle heading in saved data
    const dataAfterEnter = await saveBlok(page);
    const headerAfterEnter = dataAfterEnter.blocks.find(b => b.type === 'header');
    const paragraphAfterEnter = dataAfterEnter.blocks.find(b => b.type === 'paragraph');

    expect(paragraphAfterEnter).toBeDefined();
    expect(headerAfterEnter?.content).toContain(paragraphAfterEnter?.id);

    // 3. Undo — child block should disappear
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitMs(page, 200);

    const dataAfterUndo = await saveBlok(page);
    const headerAfterUndo = dataAfterUndo.blocks.find(b => b.type === 'header');

    // After undo, toggle heading should have no children
    expect(headerAfterUndo?.content ?? []).toHaveLength(0);
    expect(dataAfterUndo.blocks.filter(b => b.type === 'paragraph')).toHaveLength(0);

    // 4. Redo — child block should be restored INSIDE the toggle heading
    await page.keyboard.press(REDO_SHORTCUT);
    await waitMs(page, 200);

    const dataAfterRedo = await saveBlok(page);
    const headerAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'header');
    const paragraphAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'paragraph');

    expect(paragraphAfterRedo).toBeDefined();

    // BUG: without the fix, paragraphAfterRedo has no parent (block outside toggle heading)
    // The paragraph's id must appear in the toggle heading's content array
    expect(headerAfterRedo?.content).toContain(paragraphAfterRedo?.id);

    // DOM assertion: the restored paragraph must be visible as a child of the toggle heading
    // (for toggle headings, children are rendered as indented sibling blocks rather than
    // inside [data-blok-toggle-children], so we check via saved data parent relationship)
    const paragraphBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

    await expect(paragraphBlock).toBeVisible();
  });
});

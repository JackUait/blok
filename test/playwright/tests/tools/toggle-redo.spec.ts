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
    // 1. Start with a toggle that has no children (explicitly open for this test)
    await createBlok(page, {
      blocks: [{ type: 'toggle', data: { text: 'My toggle', isOpen: true } }],
    });

    // Toggle is explicitly open via isOpen: true
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

  test('undo/redo of text typed in toggle child keeps block inside toggle', async ({ page }) => {
    // Exact user scenario: create toggle, Enter to add child, type text, undo text, redo text.
    // The child block must stay inside the toggle throughout.
    await createBlok(page, {
      blocks: [{ type: 'toggle', data: { text: 'My toggle' } }],
    });

    // Press Enter at end of toggle header to create child block inside
    const toggleContent = page.locator('[data-blok-toggle-content]');

    await toggleContent.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const childInsideToggle = page.locator(`${TOGGLE_CHILDREN_SELECTOR} [contenteditable]`);

    await expect(childInsideToggle).toBeVisible();
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Type text in the child block
    await childInsideToggle.click();
    await page.keyboard.type('hello world');
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Sanity: child is inside toggle and has text
    const dataAfterType = await saveBlok(page);
    const toggleAfterType = dataAfterType.blocks.find(b => b.type === 'toggle');
    const childAfterType = dataAfterType.blocks.find(
      b => b.type === 'paragraph' && String((b.data as Record<string, unknown>).text) === 'hello world'
    );

    expect(childAfterType).toBeDefined();
    expect(toggleAfterType?.content).toContain(childAfterType?.id);

    // Undo the text change — block must stay inside toggle
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitMs(page, 200);

    await expect(childInsideToggle).toBeVisible();

    const dataAfterUndo = await saveBlok(page);
    const toggleAfterUndo = dataAfterUndo.blocks.find(b => b.type === 'toggle');
    const childrenAfterUndo = dataAfterUndo.blocks.filter(b => b.type === 'paragraph');

    expect(childrenAfterUndo.some(p => toggleAfterUndo?.content?.includes(p.id ?? ''))).toBe(true);

    // Redo the text change — block must stay inside toggle with text restored
    await page.keyboard.press(REDO_SHORTCUT);
    await waitMs(page, 200);

    await expect(childInsideToggle).toBeVisible();

    const dataAfterRedo = await saveBlok(page);
    const toggleAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'toggle');
    const childAfterRedo = dataAfterRedo.blocks.find(
      b => b.type === 'paragraph' && String((b.data as Record<string, unknown>).text) === 'hello world'
    );

    expect(childAfterRedo).toBeDefined();
    expect(toggleAfterRedo?.content).toContain(childAfterRedo?.id);
  });

  test('undo/redo of text typed in toggle header keeps children inside', async ({ page }) => {
    // Variant: type in the toggle HEADER while children exist.
    // Children must stay inside the toggle through undo/redo of header text.
    await createBlok(page, {
      blocks: [{ type: 'toggle', data: { text: 'My toggle' } }],
    });

    // Add a child block
    const toggleContent = page.locator('[data-blok-toggle-content]');

    await toggleContent.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const childInsideToggle = page.locator(`${TOGGLE_CHILDREN_SELECTOR} [contenteditable]`);

    await expect(childInsideToggle).toBeVisible();

    // Type text in the child so it's not empty
    await childInsideToggle.click();
    await page.keyboard.type('child text');
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Now go back to the toggle header and type more text
    await toggleContent.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' extra');
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Sanity: toggle header has new text and child is still inside
    const dataAfterEdit = await saveBlok(page);
    const toggleAfterEdit = dataAfterEdit.blocks.find(b => b.type === 'toggle');

    expect(String((toggleAfterEdit?.data as Record<string, unknown> | undefined)?.text)).toContain('extra');

    const childAfterEdit = dataAfterEdit.blocks.find(
      b => b.type === 'paragraph' && String((b.data as Record<string, unknown>).text) === 'child text'
    );

    expect(toggleAfterEdit?.content).toContain(childAfterEdit?.id);

    // Undo the header text change
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitMs(page, 200);

    // Child must still be inside the toggle DOM
    await expect(childInsideToggle).toBeVisible();

    const dataAfterUndo = await saveBlok(page);
    const toggleAfterUndo = dataAfterUndo.blocks.find(b => b.type === 'toggle');
    const childAfterUndo = dataAfterUndo.blocks.find(
      b => b.type === 'paragraph' && String((b.data as Record<string, unknown>).text) === 'child text'
    );

    expect(toggleAfterUndo?.content).toContain(childAfterUndo?.id);

    // Redo the header text change — child must still be inside
    await page.keyboard.press(REDO_SHORTCUT);
    await waitMs(page, 200);

    await expect(childInsideToggle).toBeVisible();

    const dataAfterRedo = await saveBlok(page);
    const toggleAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'toggle');
    const childAfterRedo = dataAfterRedo.blocks.find(
      b => b.type === 'paragraph' && String((b.data as Record<string, unknown>).text) === 'child text'
    );

    expect(toggleAfterRedo?.content).toContain(childAfterRedo?.id);
  });

  test('undo/redo when Enter + typing are in same Yjs capture window keeps child inside toggle', async ({ page }) => {
    // If user presses Enter and types immediately (no 600ms wait),
    // both operations land in the same Yjs undo entry. CMD+Z removes
    // the entire block (not just text). CMD+Shift+Z must restore it inside toggle.
    await createBlok(page, {
      blocks: [{ type: 'toggle', data: { text: 'My toggle' } }],
    });

    const toggleContent = page.locator('[data-blok-toggle-content]');

    await toggleContent.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Type IMMEDIATELY — no wait for Yjs capture
    await page.keyboard.type('hello');

    // NOW wait for Yjs to capture everything as one entry
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Sanity: child with text exists inside toggle
    const dataBefore = await saveBlok(page);
    const toggleBefore = dataBefore.blocks.find(b => b.type === 'toggle');
    const childBefore = dataBefore.blocks.find(b => b.type === 'paragraph');

    expect(String((childBefore?.data as Record<string, unknown> | undefined)?.text)).toBe('hello');
    expect(toggleBefore?.content).toContain(childBefore?.id);

    // Undo — may remove entire block (Enter + text in same capture)
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitMs(page, 200);

    // Redo — must restore block INSIDE toggle
    await page.keyboard.press(REDO_SHORTCUT);
    await waitMs(page, 200);

    const dataAfterRedo = await saveBlok(page);
    const toggleAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'toggle');
    const childAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'paragraph');

    expect(childAfterRedo).toBeDefined();
    expect(toggleAfterRedo?.content).toContain(childAfterRedo?.id);

    // DOM: child must be inside toggle-children container
    const childInToggleDOM = page.locator(`${TOGGLE_CHILDREN_SELECTOR} [contenteditable]`);

    await expect(childInToggleDOM).toBeVisible();
  });

  test('multiple undo/redo cycles keep child inside toggle', async ({ page }) => {
    await createBlok(page, {
      blocks: [{ type: 'toggle', data: { text: 'My toggle' } }],
    });

    const toggleContent = page.locator('[data-blok-toggle-content]');

    await toggleContent.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    const childInsideToggle = page.locator(`${TOGGLE_CHILDREN_SELECTOR} [contenteditable]`);

    await expect(childInsideToggle).toBeVisible();

    // Type character by character with pauses to create multiple Yjs entries
    await childInsideToggle.click();

    for (const char of 'abc') {
      await page.keyboard.type(char);
      await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);
    }

    // Undo 3 times (each text entry), then undo the block creation
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitMs(page, 100);
    }

    // All undone — no paragraph blocks should remain
    const dataAllUndone = await saveBlok(page);

    expect(dataAllUndone.blocks.filter(b => b.type === 'paragraph')).toHaveLength(0);

    // Redo 4 times — restore block creation + 3 text entries
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press(REDO_SHORTCUT);
      await waitMs(page, 100);
    }

    // Child must be inside toggle with full text
    const dataAllRedone = await saveBlok(page);
    const toggleRedone = dataAllRedone.blocks.find(b => b.type === 'toggle');
    const childRedone = dataAllRedone.blocks.find(b => b.type === 'paragraph');

    expect(childRedone).toBeDefined();
    expect(String((childRedone?.data as Record<string, unknown> | undefined)?.text)).toBe('abc');
    expect(toggleRedone?.content).toContain(childRedone?.id);

    await expect(childInsideToggle).toBeVisible();
  });

  test('undo/redo of text in toggle heading body keeps child inside', async ({ page }) => {
    // Test toggle HEADING (not toggle list)
    await createBlok(page, {
      blocks: [{ type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true } }],
    });

    const header = page.getByRole('heading', { level: 2, name: 'Toggle heading' });

    await header.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Type in the child block
    const childBlock = page.locator(PARAGRAPH_BLOCK_SELECTOR);

    await expect(childBlock).toBeVisible();
    await childBlock.locator('[contenteditable]').click();
    await page.keyboard.type('heading child text');
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Undo text
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitMs(page, 200);

    // Child must still be a child of the heading
    const dataAfterUndo = await saveBlok(page);
    const headerAfterUndo = dataAfterUndo.blocks.find(b => b.type === 'header');
    const childAfterUndo = dataAfterUndo.blocks.find(b => b.type === 'paragraph');

    expect(childAfterUndo).toBeDefined();
    expect(headerAfterUndo?.content).toContain(childAfterUndo?.id);

    // Redo text
    await page.keyboard.press(REDO_SHORTCUT);
    await waitMs(page, 200);

    const dataAfterRedo = await saveBlok(page);
    const headerAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'header');
    const childAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'paragraph');

    expect(childAfterRedo).toBeDefined();
    expect(String((childAfterRedo?.data as Record<string, unknown> | undefined)?.text)).toBe('heading child text');
    expect(headerAfterRedo?.content).toContain(childAfterRedo?.id);
  });

  test('redo after undoing Enter inside toggle heading keeps child block inside toggle heading', async ({ page }) => {
    // 1. Start with a toggle heading that has no children (explicitly open for this test)
    await createBlok(page, {
      blocks: [{ type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true, isOpen: true } }],
    });

    // Toggle heading is explicitly open via isOpen: true
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

  test('Enter in child paragraph then undo/redo keeps new sibling inside toggle', async ({ page }) => {
    /**
     * Regression test: pressing Enter in a CHILD paragraph (not the toggle header)
     * goes through the module-level Enter handler (keyboardNavigation.ts createBlockOnEnter)
     * which calls insertDefaultBlockAtIndex + setBlockParent. The bug is that
     * insertDefaultBlockAtIndex writes the block to Yjs WITHOUT parentId, and
     * setBlockParent only updates in-memory state — never writing the child's
     * parentId to Yjs. On redo, handleYjsAdd reads parentId = undefined from Yjs,
     * so the block is placed at root level instead of inside the toggle.
     */

    // 1. Create a toggle with an existing child paragraph
    await createBlok(page, {
      blocks: [
        { id: 'toggle-1', type: 'toggle', data: { text: 'My toggle', isOpen: true }, content: ['child-1'] },
        { id: 'child-1', type: 'paragraph', data: { text: 'existing child' }, parent: 'toggle-1' },
      ],
    });

    await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

    // 2. Click on the existing child paragraph and press Enter to split it
    const existingChild = page.locator(`${TOGGLE_CHILDREN_SELECTOR} [contenteditable]`);

    await expect(existingChild).toBeVisible();
    await existingChild.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // A new (second) child paragraph should appear inside the toggle
    const childrenInToggle = page.locator(`${TOGGLE_CHILDREN_SELECTOR} [contenteditable]`);

    await expect(childrenInToggle).toHaveCount(2);
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Type in the new child
    await page.keyboard.type('new text');
    await waitMs(page, YJS_CAPTURE_TIMEOUT_MS);

    // Sanity check: both children are inside the toggle
    const dataAfterType = await saveBlok(page);
    const toggleAfterType = dataAfterType.blocks.find(b => b.type === 'toggle');
    const paragraphs = dataAfterType.blocks.filter(b => b.type === 'paragraph');

    expect(paragraphs).toHaveLength(2);
    expect(toggleAfterType?.content).toHaveLength(2);

    // 3. Undo text, then undo block creation
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitMs(page, 200);
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitMs(page, 200);

    // After undo, only the original child should remain
    const dataAfterUndo = await saveBlok(page);
    const paragraphsAfterUndo = dataAfterUndo.blocks.filter(b => b.type === 'paragraph');

    expect(paragraphsAfterUndo).toHaveLength(1);
    expect(String((paragraphsAfterUndo[0].data as Record<string, unknown>).text)).toBe('existing child');

    // 4. Redo block creation, then redo text
    await page.keyboard.press(REDO_SHORTCUT);
    await waitMs(page, 200);
    await page.keyboard.press(REDO_SHORTCUT);
    await waitMs(page, 200);

    // Both children must be inside the toggle
    const dataAfterRedo = await saveBlok(page);
    const toggleAfterRedo = dataAfterRedo.blocks.find(b => b.type === 'toggle');
    const paragraphsAfterRedo = dataAfterRedo.blocks.filter(b => b.type === 'paragraph');
    const newChild = paragraphsAfterRedo.find(p => String((p.data as Record<string, unknown>).text) === 'new text');

    expect(paragraphsAfterRedo).toHaveLength(2);
    expect(newChild).toBeDefined();

    // BUG: without the fix, newChild has no parent — it renders outside the toggle
    expect(toggleAfterRedo?.content).toContain(newChild?.id);

    // DOM: both children must be inside the toggle-children container
    await expect(childrenInToggle).toHaveCount(2);
  });
});

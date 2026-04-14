import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { validateHierarchy } from '../../../../src/components/utils/hierarchy-invariant';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Operation gauntlet: exercise a long sequence of mutations inside a container
 * block (insert, type, split, paste, delete, undo, redo, reload) and assert the
 * parent ↔ content hierarchy invariant after every single save.
 *
 * The paste-ejection bug was one symptom of a broader class: any mutation that
 * breaks `child.parent === X ⇒ X.content.includes(child.id)` corrupts the
 * legacy output and silently ejects children. The three reconciliation layers
 * (saver, insertMany, collapseToLegacy) should make the invariant hold after
 * every save — this suite proves it empirically by running a real editor
 * through a realistic user flow and failing loud on any drift.
 *
 * This is the property-based / fuzz-equivalent for the invariant: if any future
 * change introduces a mutation path that bypasses reconciliation, one of these
 * steps will flush it out.
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

const saveAndAssertInvariant = async (page: Page, label: string): Promise<OutputData> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());

  expect(saved, `save(${label}) returned undefined`).toBeDefined();

  if (saved === undefined) {
    throw new Error(`save(${label}) returned undefined`);
  }

  const violations = validateHierarchy(saved.blocks);

  if (violations.length > 0) {
    throw new Error(
      `Hierarchy invariant violated after "${label}":\n` +
      violations.map(v => `  - ${v.message}`).join('\n') +
      `\nFull blocks JSON:\n${JSON.stringify(saved.blocks, null, 2)}`
    );
  }

  return saved;
};

const simulatePaste = async (page: Page, opts: { html?: string; text?: string }): Promise<void> => {
  await page.evaluate((data) => {
    const dt = new DataTransfer();

    if (data.html !== undefined) {
      dt.setData('text/html', data.html);
    }
    dt.setData('text/plain', data.text ?? '');

    const active = document.activeElement ?? document.body;

    active.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
  }, opts);
  // eslint-disable-next-line playwright/no-wait-for-timeout -- async paste pipeline settle
  await page.waitForTimeout(300);
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

test.describe('Container hierarchy invariant gauntlet', () => {
  test('callout: invariant holds through insert, type, paste, split, delete, reload', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['hdr1', 'body1'] },
        { id: 'hdr1', type: 'header', data: { text: 'Note', level: 4 }, parent: 'cal1' },
        { id: 'body1', type: 'paragraph', data: { text: 'seed' }, parent: 'cal1' },
      ],
    };

    await createBlok(page, initial);

    await saveAndAssertInvariant(page, 'initial load');

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await page.keyboard.press('End');

    // Step 1 — type some text
    await page.keyboard.type(' line one');
    await saveAndAssertInvariant(page, 'after typing');

    // Step 2 — press Enter to split inside the callout
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    await saveAndAssertInvariant(page, 'after enter + type');

    // Step 3 — paste multi-line plain text
    await simulatePaste(page, { text: 'pasted A\npasted B\npasted C' });
    await saveAndAssertInvariant(page, 'after plain paste');

    // Step 4 — paste multi-paragraph HTML
    await simulatePaste(page, { html: '<p>HTML alpha</p><p>HTML beta</p>', text: 'HTML alpha\nHTML beta' });
    await saveAndAssertInvariant(page, 'after html paste');

    // Step 5 — delete one of the pasted lines via Backspace
    await page.keyboard.press('Backspace');
    const afterBackspace = await saveAndAssertInvariant(page, 'after backspace');

    // Invariant is the primary contract; sanity check: at least one child still
    // nested under the callout.
    const calloutChildren = afterBackspace.blocks.filter(b => b.parent === 'cal1');

    expect(calloutChildren.length).toBeGreaterThan(0);

    // Step 6 — reload with the last saved data. Exercises insertMany + collapseToLegacy.
    await createBlok(page, afterBackspace);
    const reloaded = await saveAndAssertInvariant(page, 'after reload');

    // Ensure no root-level orphaned paragraphs after the full cycle.
    const orphans = reloaded.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(orphans, `orphaned paragraphs after reload: ${JSON.stringify(orphans)}`).toHaveLength(0);
  });

  test('toggle: invariant holds through type, paste, split, reload', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'tog1', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: 'seed' }, parent: 'tog1' },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'toggle initial');

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await page.keyboard.press('End');

    await page.keyboard.type(' tail');
    await saveAndAssertInvariant(page, 'toggle after type');

    await page.keyboard.press('Enter');
    await page.keyboard.type('second line');
    await saveAndAssertInvariant(page, 'toggle after enter');

    await simulatePaste(page, { text: 'one\ntwo\nthree' });
    const afterPaste = await saveAndAssertInvariant(page, 'toggle after paste');

    // Reload and save — exercises the insertMany + collapseToLegacy round trip.
    await createBlok(page, afterPaste);
    const reloaded = await saveAndAssertInvariant(page, 'toggle after reload');

    const orphans = reloaded.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(orphans).toHaveLength(0);
  });

  test('toggleable header: invariant holds through type, paste, reload', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        {
          id: 'hdr1',
          type: 'header',
          data: { text: 'Section', level: 2, isToggleable: true, isOpen: true },
          content: ['body1'],
        },
        { id: 'body1', type: 'paragraph', data: { text: 'seed' }, parent: 'hdr1' },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'header initial');

    const body = page.locator('[data-blok-id="body1"] [contenteditable]');

    await body.click();
    await page.keyboard.press('End');

    await simulatePaste(page, { text: 'alpha\nbeta\ngamma' });
    const afterPaste = await saveAndAssertInvariant(page, 'header after paste');

    await createBlok(page, afterPaste);
    const reloaded = await saveAndAssertInvariant(page, 'header after reload');

    const orphans = reloaded.blocks.filter(b => b.type === 'paragraph' && b.parent === undefined);

    expect(orphans).toHaveLength(0);
  });

  /**
   * Cross-boundary hierarchy gauntlet — drag/merge/undo.
   *
   * The original gauntlet covers single-client edit flows inside a container.
   * These tests extend it to cross-boundary mutations that are the remaining
   * known drift vectors for the callout/toggle family:
   *
   *   A) drag a root block into a container (reparent through DragManager)
   *   B) merge a root block into a nested block via Backspace at start
   *   C) undo/redo around a reparent (history replay must not corrupt state)
   *
   * Invariant must hold at every save point. Uses the same saveAndAssertInvariant
   * helper as the rest of the suite; any drift becomes a loud failure.
   */
  const SETTINGS_BUTTON = '[data-blok-interface="blok"] [data-blok-testid="settings-toggler"]';
  const IS_MAC = process.platform === 'darwin';
  const UNDO_COMBO = IS_MAC ? 'Meta+Z' : 'Control+Z';
  const REDO_COMBO = IS_MAC ? 'Meta+Shift+Z' : 'Control+Shift+Z';

  const performDragDrop = async (
    page: Page,
    sourceLocator: ReturnType<Page['locator']>,
    targetLocator: ReturnType<Page['locator']>,
    targetVerticalPosition: 'top' | 'bottom'
  ): Promise<void> => {
    const sourceBox = await sourceLocator.boundingBox();
    const targetBox = await targetLocator.boundingBox();

    if (sourceBox === null || targetBox === null) {
      throw new Error('Cannot get bounding box for drag source or target');
    }

    const sourceX = sourceBox.x + sourceBox.width / 2;
    const sourceY = sourceBox.y + sourceBox.height / 2;
    const targetX = targetBox.x + targetBox.width / 2;
    const targetY = targetVerticalPosition === 'top'
      ? targetBox.y + 1
      : targetBox.y + targetBox.height - 1;

    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 15 });

    await page.waitForFunction(() => {
      const wrapper = document.querySelector('[data-blok-interface=blok]');

      return wrapper?.getAttribute('data-blok-dragging') === 'true';
    }, { timeout: 2000 });

    await page.mouse.up();

    await page.waitForFunction(() => {
      const wrapper = document.querySelector('[data-blok-interface=blok]');

      return wrapper?.getAttribute('data-blok-dragging') !== 'true';
    }, { timeout: 2000 });
  };

  const performAltDragDrop = async (
    page: Page,
    sourceLocator: ReturnType<Page['locator']>,
    targetLocator: ReturnType<Page['locator']>,
    targetVerticalPosition: 'top' | 'bottom'
  ): Promise<void> => {
    const sourceBox = await sourceLocator.boundingBox();
    const targetBox = await targetLocator.boundingBox();

    if (sourceBox === null || targetBox === null) {
      throw new Error('Cannot get bounding box for alt-drag source or target');
    }

    const sourceX = sourceBox.x + sourceBox.width / 2;
    const sourceY = sourceBox.y + sourceBox.height / 2;
    const targetX = targetBox.x + targetBox.width / 2;
    const targetY = targetVerticalPosition === 'top'
      ? targetBox.y + 1
      : targetBox.y + targetBox.height - 1;

    await page.mouse.move(sourceX, sourceY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 15 });

    await page.waitForFunction(() => {
      const wrapper = document.querySelector('[data-blok-interface=blok]');

      return wrapper?.getAttribute('data-blok-dragging') === 'true';
    }, { timeout: 2000 });

    await page.keyboard.down('Alt');

    await page.waitForFunction(() => {
      const wrapper = document.querySelector('[data-blok-interface=blok]');

      return wrapper?.getAttribute('data-blok-duplicating') === 'true';
    }, { timeout: 2000 });

    await page.mouse.up();
    await page.keyboard.up('Alt');

    await page.waitForFunction(() => {
      const wrapper = document.querySelector('[data-blok-interface=blok]');

      return wrapper?.getAttribute('data-blok-dragging') !== 'true';
    }, { timeout: 2000 });
  };

  test('drag-and-drop: paragraph reparents into callout with invariant intact', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['seed1'] },
        { id: 'seed1', type: 'paragraph', data: { text: 'seed' }, parent: 'cal1' },
        { id: 'p1', type: 'paragraph', data: { text: 'Root one' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Root two' } },
        { id: 'p3', type: 'paragraph', data: { text: 'Root three' } },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'drag initial');

    // Reveal the drag handle on the source paragraph.
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'Root two' });

    await source.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON);

    await expect(settingsButton).toBeVisible();

    // Target: the callout's inner nested-blocks container — the actual drop
    // zone for children. Dropping on the outer block wrapper's bottom edge
    // resolves to "insert after the callout at root level", not reparent.
    const calloutBody = page.locator('[data-blok-id="cal1"] [data-blok-nested-blocks]');

    await expect(calloutBody).toBeVisible();

    await performDragDrop(page, settingsButton, calloutBody, 'bottom');

    const afterDrop = await saveAndAssertInvariant(page, 'after drop into callout');

    const p2 = afterDrop.blocks.find(b => b.id === 'p2');
    const callout = afterDrop.blocks.find(b => b.id === 'cal1');

    expect(p2?.parent, 'p2 should now be a child of cal1').toBe('cal1');
    expect(callout?.content, 'callout content[] should include p2').toContain('p2');

    // Reload with the saved data; invariant must hold through the collapse/insertMany cycle.
    await createBlok(page, afterDrop);
    const reloaded = await saveAndAssertInvariant(page, 'drag reload');

    const orphans = reloaded.blocks.filter(b => b.type === 'paragraph' && b.id === 'p2' && b.parent === undefined);

    expect(orphans, 'p2 must not be ejected from callout after reload').toHaveLength(0);
  });

  test('merge-across-container: backspace at start of root paragraph below a callout', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['inside1'] },
        { id: 'inside1', type: 'paragraph', data: { text: 'inside' }, parent: 'cal1' },
        { id: 'outside1', type: 'paragraph', data: { text: 'outside' } },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'merge initial');

    // Place caret at the very start of the outside paragraph.
    // eslint-disable-next-line playwright/no-nth-methods -- contenteditable has no role/testid
    const outside = page.locator('[data-blok-id="outside1"] [contenteditable]').first();

    await outside.click();
    await page.keyboard.press('Home');

    // Backspace from the start of a root paragraph that sits after a container
    // block is the classic "merge across container boundary" vector.
    await page.keyboard.press('Backspace');

    const afterMerge = await saveAndAssertInvariant(page, 'after merge across container');

    // Whatever the exact merge behavior is — the critical contract is the
    // invariant holding and no root-level paragraph being orphaned with drift.
    // If "outside" survived as a separate block it must either be inside the
    // callout OR a clean root sibling; either way the invariant check above
    // is the real assertion. Belt-and-braces: no root paragraph should claim
    // a parent that does not exist, and no callout child should be missing
    // from the callout's content[].
    const hasPhantomParents = afterMerge.blocks.some((b) => {
      if (b.parent === undefined || b.parent === null) {
        return false;
      }
      const parent = afterMerge.blocks.find(p => p.id === b.parent);

      return parent === undefined;
    });

    expect(hasPhantomParents, 'no child block should reference a missing parent').toBe(false);

    // Reload + resave — catches drift that only surfaces through collapseToLegacy.
    await createBlok(page, afterMerge);
    await saveAndAssertInvariant(page, 'merge reload');
  });

  test('reparent + undo + redo keeps invariant at every save point', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'tog1', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: 'seed body' }, parent: 'tog1' },
        { id: 'p-root', type: 'paragraph', data: { text: 'root paragraph' } },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'undo initial');

    // Drag the root paragraph into the toggle.
    const source = page.getByTestId('block-wrapper').filter({ hasText: 'root paragraph' });

    await source.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON);

    await expect(settingsButton).toBeVisible();

    const toggleInner = page.locator('[data-blok-toggle-open="true"]');

    await expect(toggleInner).toBeVisible();

    await performDragDrop(page, settingsButton, toggleInner, 'bottom');

    const afterReparent = await saveAndAssertInvariant(page, 'after reparent');
    const reparentedChild = afterReparent.blocks.find(b => b.id === 'p-root');

    expect(reparentedChild?.parent, 'p-root should live inside the toggle').toBe('tog1');

    // Undo — step out. Click into an editable area first so the editor has focus.
    // eslint-disable-next-line playwright/no-nth-methods -- contenteditable has no role/testid
    await page.locator('[data-blok-id="body1"] [contenteditable]').first().click();

    await page.keyboard.press(UNDO_COMBO);

    const afterUndo = await saveAndAssertInvariant(page, 'after undo');
    const undoneChild = afterUndo.blocks.find(b => b.id === 'p-root');
    const undoneToggle = afterUndo.blocks.find(b => b.id === 'tog1');

    // One Cmd+Z must fully reverse the drag: p-root back at root level,
    // and the toggle no longer claims it as a child. The drag-history
    // integration (DragController wrapping handleDrop in `transactMoves`)
    // atomically rewinds the array move AND the parent reassignment.
    const reparentedId = 'p-root';

    expect(undoneChild, 'p-root should still exist after undo').toBeDefined();
    expect(undoneChild?.parent, 'p-root should be back at root level').toBeUndefined();
    expect(undoneToggle?.content ?? [], 'toggle should not list p-root as a child').not.toContain(reparentedId);

    // Re-focus the editor (save() may have stolen focus via a side effect).
    // eslint-disable-next-line playwright/no-nth-methods -- contenteditable has no role/testid
    await page.locator('[data-blok-id="body1"] [contenteditable]').first().click();

    // Wait past the 50ms undo/redo debounce window in the keyboard controller.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- needed to clear the 50ms debounce
    await page.waitForTimeout(80);

    // Redo — step back in.
    await page.keyboard.press(REDO_COMBO);

    const afterRedo = await saveAndAssertInvariant(page, 'after redo');
    const redoneChild = afterRedo.blocks.find(b => b.id === 'p-root');
    const redoneToggle = afterRedo.blocks.find(b => b.id === 'tog1');

    expect(redoneChild, 'p-root should still exist after redo').toBeDefined();
    expect(redoneChild?.parent, 'p-root should be inside the toggle after redo').toBe('tog1');
    expect(redoneToggle?.content ?? [], 'toggle should list p-root as a child after redo').toContain(reparentedId);
  });

  test('drag root reorder: single Cmd+Z restores original order', async ({ page }) => {
    const initial: OutputData = {
      blocks: [
        { id: 'p-a', type: 'paragraph', data: { text: 'Alpha' } },
        { id: 'p-b', type: 'paragraph', data: { text: 'Bravo' } },
        { id: 'p-c', type: 'paragraph', data: { text: 'Charlie' } },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'drag root reorder initial');

    // Drag Bravo (index 1) below Charlie (index 2) → [Alpha, Charlie, Bravo]
    const bravo = page.getByTestId('block-wrapper').filter({ hasText: 'Bravo' });

    await bravo.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON);

    await expect(settingsButton).toBeVisible();

    const charlie = page.getByTestId('block-wrapper').filter({ hasText: 'Charlie' });

    await performDragDrop(page, settingsButton, charlie, 'bottom');

    const afterDrag = await saveAndAssertInvariant(page, 'drag root reorder after drag');

    expect(afterDrag.blocks.map(b => b.id), 'order after drag').toStrictEqual([
      'p-a',
      'p-c',
      'p-b',
    ]);

    // Focus the editor before keyboard undo.
    // eslint-disable-next-line playwright/no-nth-methods -- contenteditable has no role/testid
    await page.locator('[data-blok-id="p-a"] [contenteditable]').first().click();

    await page.keyboard.press(UNDO_COMBO);

    const afterUndo = await saveAndAssertInvariant(page, 'drag root reorder after undo');

    expect(afterUndo.blocks.map(b => b.id), 'order after single undo').toStrictEqual([
      'p-a',
      'p-b',
      'p-c',
    ]);

    // eslint-disable-next-line playwright/no-nth-methods -- contenteditable has no role/testid
    await page.locator('[data-blok-id="p-a"] [contenteditable]').first().click();
    // Wait past the 50ms undo/redo debounce window in the keyboard controller.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- needed to clear the 50ms debounce
    await page.waitForTimeout(80);

    await page.keyboard.press(REDO_COMBO);

    const afterRedo = await saveAndAssertInvariant(page, 'drag root reorder after redo');

    expect(afterRedo.blocks.map(b => b.id), 'order after redo').toStrictEqual([
      'p-a',
      'p-c',
      'p-b',
    ]);
  });

  test('alt-drag duplicate: single Cmd+Z undoes the entire duplicate operation', async ({ page }) => {
    // Regression: alt-drag duplicate used to fragment into N separate Yjs
    // UndoManager entries (one per insert + one per setBlockParent), so
    // undoing required multiple Cmd+Z presses. Wrapping the sync tail of
    // `DragController.handleDuplicate` in `BlockManager.transactForTool`
    // collapses every write into a single undo stack item.
    const initial: OutputData = {
      blocks: [
        { id: 'p-a', type: 'paragraph', data: { text: 'Alpha' } },
        { id: 'p-b', type: 'paragraph', data: { text: 'Bravo' } },
        { id: 'p-c', type: 'paragraph', data: { text: 'Charlie' } },
      ],
    };

    await createBlok(page, initial);
    await saveAndAssertInvariant(page, 'alt-drag initial');

    // Alt-drag Alpha onto Charlie (bottom edge) → duplicate Alpha at root tail.
    const alpha = page.getByTestId('block-wrapper').filter({ hasText: 'Alpha' });

    await alpha.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON);

    await expect(settingsButton).toBeVisible();

    const charlie = page.getByTestId('block-wrapper').filter({ hasText: 'Charlie' });

    await performAltDragDrop(page, settingsButton, charlie, 'bottom');

    // 4 paragraphs: Alpha, Bravo, Charlie, Alpha-dup.
    await expect(page.getByTestId('block-wrapper')).toHaveCount(4);

    const afterAltDrag = await saveAndAssertInvariant(page, 'alt-drag after drop');

    expect(afterAltDrag.blocks, 'alt-drag should duplicate to 4 blocks').toHaveLength(4);

    // Focus editor before keyboard undo.
    // eslint-disable-next-line playwright/no-nth-methods -- contenteditable has no role/testid
    await page.locator('[data-blok-id="p-a"] [contenteditable]').first().click();

    await page.keyboard.press(UNDO_COMBO);

    // A single Cmd+Z must fully reverse the alt-drag — back to 3 paragraphs.
    await expect(
      page.getByTestId('block-wrapper'),
      'single undo should fully reverse alt-drag duplicate'
    ).toHaveCount(3);

    const afterUndo = await saveAndAssertInvariant(page, 'alt-drag after undo');

    expect(afterUndo.blocks.map(b => b.id), 'order after single undo').toStrictEqual([
      'p-a',
      'p-b',
      'p-c',
    ]);
  });
});

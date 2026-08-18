import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Notion parity: "Turn into → Toggle heading" adopts the heading's SECTION —
 * every following sibling until the next heading of the same or higher rank —
 * as toggle children ("all of the content within those headings will now be
 * collapsible"). Without adoption the user has to hand-feed every paragraph
 * into the fresh toggle, and blocks left behind read as "the editor put only
 * the first paragraph inside" (the user complaint this suite pins).
 *
 * Undo/redo atomicity rides on two fixes pinned here:
 * - the adoption runs inside YjsManager.transactMoves (redo-safe move entry),
 * - reparentFromHistoryReplay extends its atomic window through RAF so the
 *   toggle's deferred empty-state echo cannot clear the redo stack.
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

const convertToToggleHeading = async (page: Page, blockId: string, level: number): Promise<void> => {
  await page.evaluate(async ({ id, lvl }) => {
    await window.blokInstance?.blocks.convert(id, 'header', { level: lvl, isToggleable: true });
  }, { id: blockId, lvl: level });
};

const saveTree = async (page: Page): Promise<Array<{ id: string; parent: string | null; isToggleable: boolean }>> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());

  expect(saved).toBeDefined();

  return (saved as OutputData).blocks.map(b => ({
    id: b.id as string,
    parent: (b as { parent?: string }).parent ?? null,
    isToggleable: Boolean((b.data as { isToggleable?: boolean }).isToggleable),
  }));
};

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test.describe('Toggle heading conversion adopts its section (Notion parity)', () => {
  test('adopts following paragraphs up to the next same-level heading', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'hdr', type: 'header', data: { text: 'Section', level: 1 } },
        { id: 'p1', type: 'paragraph', data: { text: 'first paragraph' } },
        { id: 'p2', type: 'paragraph', data: { text: 'second paragraph' } },
        { id: 'next', type: 'header', data: { text: 'Next section', level: 1 } },
        { id: 'p3', type: 'paragraph', data: { text: 'foreign paragraph' } },
      ],
    });

    await convertToToggleHeading(page, 'hdr', 1);

    const tree = await saveTree(page);
    const toggleId = tree.find(b => b.isToggleable)?.id;

    expect(toggleId).toBeDefined();
    expect(tree.find(b => b.id === 'p1')?.parent).toBe(toggleId);
    expect(tree.find(b => b.id === 'p2')?.parent).toBe(toggleId);
    expect(tree.find(b => b.id === 'next')?.parent).toBeNull();
    expect(tree.find(b => b.id === 'p3')?.parent).toBeNull();

    // The adopted blocks live inside the toggle's children container in the DOM.
    const inContainer = await page.evaluate(() => {
      const container = document.querySelector('[data-blok-toggle-children]');

      return container === null
        ? null
        : [...container.querySelectorAll('[data-blok-id]')].map(el => el.getAttribute('data-blok-id'));
    });

    expect(inContainer).toEqual(['p1', 'p2']);
  });

  test('a lower-rank heading rides into the section with its own children', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'hdr', type: 'header', data: { text: 'Section', level: 1 } },
        { id: 'sub', type: 'header', data: { text: 'Subsection', level: 2, isToggleable: true, isOpen: true }, content: ['subChild'] },
        { id: 'subChild', type: 'paragraph', data: { text: 'inside subsection' }, parent: 'sub' },
        { id: 'tail', type: 'paragraph', data: { text: 'tail paragraph' } },
      ],
    });

    await convertToToggleHeading(page, 'hdr', 1);

    const tree = await saveTree(page);
    const toggleId = tree.find(b => b.isToggleable && b.id !== 'sub')?.id;

    expect(toggleId).toBeDefined();
    expect(tree.find(b => b.id === 'sub')?.parent).toBe(toggleId);
    expect(tree.find(b => b.id === 'tail')?.parent).toBe(toggleId);
    // The subsection keeps its own child — it rides along, never re-parented.
    expect(tree.find(b => b.id === 'subChild')?.parent).toBe('sub');
  });

  test('collapsing the converted toggle hides the adopted section', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'hdr', type: 'header', data: { text: 'Section', level: 2 } },
        { id: 'p1', type: 'paragraph', data: { text: 'hidden on collapse' } },
      ],
    });

    await convertToToggleHeading(page, 'hdr', 2);

    const paragraph = page.locator('[data-blok-id="p1"]');

    await expect(paragraph).toBeVisible();

    await page.locator('[data-blok-toggle-arrow]').first().click();

    await expect(paragraph).toBeHidden();
  });

  test('adoption undoes and redoes atomically with the conversion', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'hdr', type: 'header', data: { text: 'Section', level: 1 } },
        { id: 'p1', type: 'paragraph', data: { text: 'first paragraph' } },
        { id: 'p2', type: 'paragraph', data: { text: 'second paragraph' } },
      ],
    });

    await convertToToggleHeading(page, 'hdr', 1);
    await page.locator('[contenteditable]').first().click();

    // Undo until the document returns to its pre-convert shape.
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+z');
      const tree = await saveTree(page);

      expect(tree.every(b => !b.isToggleable && b.parent === null)).toBe(true);
    }).toPass({ timeout: 5000 });

    // Redo must restore BOTH the conversion and the adoption — a stranded
    // move entry here is the "redo silently no-ops" regression.
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+Shift+z');
      const tree = await saveTree(page);
      const toggleId = tree.find(b => b.isToggleable)?.id;

      expect(toggleId).toBeDefined();
      expect(tree.find(b => b.id === 'p1')?.parent).toBe(toggleId);
      expect(tree.find(b => b.id === 'p2')?.parent).toBe(toggleId);
    }).toPass({ timeout: 5000 });
  });

  test('multi-select convert makes each block its own toggle heading (no cascade nesting)', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'alpha' } },
        { id: 'b', type: 'paragraph', data: { text: 'beta' } },
        { id: 'c', type: 'paragraph', data: { text: 'gamma' } },
      ],
    });

    // Select all three paragraphs through the block-selection module (same
    // pattern drag-drop.spec.ts uses for deterministic multi-block selection).
    await page.evaluate(() => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }
      const blockSelection = (blok as unknown as {
        module: { blockSelection: { selectBlockByIndex: (index: number) => void } };
      }).module.blockSelection;

      blockSelection.selectBlockByIndex(0);
      blockSelection.selectBlockByIndex(1);
      blockSelection.selectBlockByIndex(2);
    });

    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(3);

    // Open block settings on the selection and convert via the real menu.
    await page.locator('[data-blok-id="c"] [contenteditable]').hover();
    await page.locator('[data-blok-testid="settings-toggler"]').click();
    await page.getByRole('menuitem', { name: 'Convert to' }).click();
    await page.getByRole('menuitem', { name: 'Toggle heading 1' }).click();

    // Every original block became a root-level toggle heading; none swallowed
    // the ones after it.
    await expect(async () => {
      const tree = await saveTree(page);
      const toggles = tree.filter(b => b.isToggleable);

      expect(toggles).toHaveLength(3);
      for (const toggle of toggles) {
        expect(toggle.parent).toBeNull();
      }
    }).toPass({ timeout: 5000 });
  });
});

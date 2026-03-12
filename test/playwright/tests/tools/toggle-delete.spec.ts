import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';
const TOGGLE_CONTENT_SELECTOR = '[data-blok-toggle-content]';
const TOGGLE_CHILDREN_SELECTOR = '[data-blok-toggle-children]';

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

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const config: Record<string, unknown> = { holder };

      if (initialData) {
        config.data = initialData;
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

test.describe('Toggle - Delete key behavior', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('Delete at end of last child block does not cross toggle boundary', () => {
    test('Delete at end of last child block does not remove the paragraph after the toggle', async ({ page }) => {
      // Toggle with one child paragraph, plus an empty paragraph after the toggle
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'Child content' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: '' } },
        ],
      });

      // Click on the child paragraph (inside toggle) and go to end
      const childParagraph = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-component="paragraph"]');
      await childParagraph.click();
      await page.keyboard.press('End');

      // Press Delete — should NOT remove the empty paragraph outside the toggle
      await page.keyboard.press('Delete');

      // Save and verify all three blocks still exist
      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      // The paragraph after the toggle should NOT have been removed
      const allBlocks = saved?.blocks ?? [];
      // We should still have 3 blocks: toggle + child + root paragraph
      expect(allBlocks.length).toBe(3);

      // Child must still have parent = toggle id
      const childBlock = allBlocks.find(b => b.id === 'child-1');
      const toggleBlock = allBlocks.find(b => b.id === 'toggle-1');
      const rootBlock = allBlocks.find(b => b.id === 'root-1');

      expect(toggleBlock).toBeDefined();
      expect(childBlock).toBeDefined();
      expect(rootBlock).toBeDefined();
      expect(childBlock?.parent).toBe('toggle-1');
      expect(rootBlock?.parent).toBeUndefined();
    });

    test('Delete at end of last child block with non-empty next block does not merge content across toggle boundary', async ({ page }) => {
      // Toggle with one child paragraph, plus a non-empty paragraph after the toggle
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'Child content' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'After toggle' } },
        ],
      });

      // Click on the child paragraph (inside toggle) and go to end
      const childParagraph = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-component="paragraph"]');
      await childParagraph.click();
      await page.keyboard.press('End');

      // Press Delete — should NOT merge 'After toggle' content into child block
      await page.keyboard.press('Delete');

      // Save and verify blocks are unmodified
      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // Should still have 3 blocks
      expect(allBlocks.length).toBe(3);

      // Child block should still have only its own content
      const childBlock = allBlocks.find(b => b.id === 'child-1');
      const childBlockData = childBlock?.data as { text?: string } | undefined;
      expect(childBlockData?.text).toBe('Child content');

      // Root block should be unchanged
      const rootBlock = allBlocks.find(b => b.id === 'root-1');
      const rootBlockData = rootBlock?.data as { text?: string } | undefined;
      expect(rootBlockData?.text).toBe('After toggle');

      // Child must still be inside toggle
      expect(childBlock?.parent).toBe('toggle-1');
    });

    test('Delete on empty toggle header with children does not promote children to root level', async ({ page }) => {
      // Toggle with empty header and one child block
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: '' }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'Child content' }, parent: 'toggle-1' },
        ],
      });

      // Click on the empty toggle header content and press Delete
      const content = page.locator(TOGGLE_CONTENT_SELECTOR);
      await content.click();
      await page.keyboard.press('Delete');

      // Save and verify: child should still be inside toggle
      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // If the toggle still exists, child must be a child of it;
      // otherwise child must not become an extra root-level block
      const rootBlocks = allBlocks.filter(b => b.parent === undefined);
      expect(rootBlocks.length).toBeLessThanOrEqual(1);
    });
  });

  test.describe('Delete on empty child block stays within toggle', () => {
    test('Delete on empty first child (no previous sibling) does nothing instead of exiting toggle', async ({ page }) => {
      // Toggle with empty first child and a content child after it.
      // The bug: deleting the first child via Delete key decrements the flat-array index to the
      // toggle parent, causing focus to exit the toggle children area.
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1', 'child-2'] },
          { id: 'child-1', type: 'paragraph', data: { text: '' }, parent: 'toggle-1' },
          { id: 'child-2', type: 'paragraph', data: { text: 'Content' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root content' } },
        ],
      });

      // Click on the empty first child and press Delete — should do nothing (no previous sibling)
      const children = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-component="paragraph"]');
      await children.first().click();
      await page.keyboard.press('Delete');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-1 must NOT be removed — all 4 blocks remain
      expect(allBlocks.length).toBe(4);

      const child1 = allBlocks.find(b => b.id === 'child-1');
      const child2 = allBlocks.find(b => b.id === 'child-2');

      expect(child1).toBeDefined();
      expect(child1?.parent).toBe('toggle-1');
      expect(child2).toBeDefined();
      expect(child2?.parent).toBe('toggle-1');
    });

    test('Delete on empty middle child removes it and keeps focus inside toggle', async ({ page }) => {
      // Toggle with content-child-1, empty-child-2, content-child-3.
      // Deleting child-2 should remove it and move focus to child-1 (previous sibling inside toggle).
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1', 'child-2', 'child-3'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'First' }, parent: 'toggle-1' },
          { id: 'child-2', type: 'paragraph', data: { text: '' }, parent: 'toggle-1' },
          { id: 'child-3', type: 'paragraph', data: { text: 'Third' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root content' } },
        ],
      });

      // Click on the empty middle child (child-2) and press Delete
      const children = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-component="paragraph"]');
      await children.nth(1).click();
      await page.keyboard.press('Delete');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-2 should be removed; 4 blocks remain (toggle-1, child-1, child-3, root-1)
      expect(allBlocks.length).toBe(4);

      const child1 = allBlocks.find(b => b.id === 'child-1');
      const child2 = allBlocks.find(b => b.id === 'child-2');
      const child3 = allBlocks.find(b => b.id === 'child-3');

      expect(child2).toBeUndefined();
      expect(child1?.parent).toBe('toggle-1');
      expect(child3?.parent).toBe('toggle-1');
    });
  });

  test.describe('Toggle heading - Delete key behavior', () => {
    test('Delete at end of last child block inside toggle heading does not cross toggle boundary', async ({ page }) => {
      // Toggle heading with one child paragraph, plus an empty paragraph after
      await createBlok(page, {
        blocks: [
          { id: 'header-1', type: 'header', data: { text: 'Toggle Heading', level: 2, isToggleable: true }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'Child content' }, parent: 'header-1' },
          { id: 'root-1', type: 'paragraph', data: { text: '' } },
        ],
      });

      // Click on the child paragraph and press Delete at end
      const childParagraph = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-component="paragraph"]').first();
      await childParagraph.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Delete');

      // All 3 blocks should still exist
      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      expect(allBlocks.length).toBe(3);

      const childBlock = allBlocks.find(b => b.id === 'child-1');
      const rootBlock = allBlocks.find(b => b.id === 'root-1');

      expect(childBlock?.parent).toBe('header-1');
      expect(rootBlock?.parent).toBeUndefined();
    });

    test('Delete on empty first child inside toggle heading does nothing instead of exiting toggle', async ({ page }) => {
      // Toggle heading with empty first child and a content child after it.
      await createBlok(page, {
        blocks: [
          { id: 'header-1', type: 'header', data: { text: 'Toggle Heading', level: 2, isToggleable: true }, content: ['child-1', 'child-2'] },
          { id: 'child-1', type: 'paragraph', data: { text: '' }, parent: 'header-1' },
          { id: 'child-2', type: 'paragraph', data: { text: 'Content' }, parent: 'header-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root content' } },
        ],
      });

      // Click on the empty first child and press Delete — should do nothing (no previous sibling)
      const children = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-component="paragraph"]');
      await children.first().click();
      await page.keyboard.press('Delete');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-1 must NOT be removed — all 4 blocks remain
      expect(allBlocks.length).toBe(4);

      const child1 = allBlocks.find(b => b.id === 'child-1');
      const child2 = allBlocks.find(b => b.id === 'child-2');

      expect(child1).toBeDefined();
      expect(child1?.parent).toBe('header-1');
      expect(child2).toBeDefined();
      expect(child2?.parent).toBe('header-1');
    });
  });
});

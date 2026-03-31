import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';
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

test.describe('Toggle - Backspace key behavior', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('Backspace on empty child block stays within toggle', () => {
    test('Backspace on empty first child with next sibling removes it and focuses next sibling inside toggle', async ({ page }) => {
      // Empty first child (no previous sibling) but has a next sibling in the same toggle.
      // Backspace should remove child-1 and focus child-2 (still inside the toggle).
      // It must NOT promote child-1 to root level.
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1', 'child-2'] },
          { id: 'child-1', type: 'paragraph', data: { text: '' }, parent: 'toggle-1' },
          { id: 'child-2', type: 'paragraph', data: { text: 'Content' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root' } },
        ],
      });

      // Click empty first child and press Backspace — should remove child-1
      const child1Block = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-id="child-1"]');
      await child1Block.click();
      await page.keyboard.press('Backspace');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-1 removed; toggle-1, child-2, root-1 remain
      expect(allBlocks.length).toBe(3);

      const child1 = allBlocks.find(b => b.id === 'child-1');
      const child2 = allBlocks.find(b => b.id === 'child-2');

      expect(child1).toBeUndefined();
      expect(child2?.parent).toBe('toggle-1');
    });

    test('Backspace on empty only child does nothing (no sibling to move to)', async ({ page }) => {
      // Empty only child — no previous sibling, no next sibling in the toggle.
      // Backspace should do nothing to prevent orphaning the toggle.
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: '' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root' } },
        ],
      });

      const child1Block = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-id="child-1"]');
      await child1Block.click();
      await page.keyboard.press('Backspace');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-1 stays inside toggle — 3 blocks remain
      expect(allBlocks.length).toBe(3);

      const child1 = allBlocks.find(b => b.id === 'child-1');

      expect(child1).toBeDefined();
      expect(child1?.parent).toBe('toggle-1');
    });

    test('Backspace on empty child with a previous sibling removes it and keeps focus inside toggle', async ({ page }) => {
      // child-2 is empty and has child-1 as a previous sibling in the same toggle.
      // Backspace should remove child-2 and focus child-1 (inside toggle), NOT promote child-2 to root.
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1', 'child-2'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'Previous' }, parent: 'toggle-1' },
          { id: 'child-2', type: 'paragraph', data: { text: '' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root' } },
        ],
      });

      // Click empty child-2 and press Backspace
      const child2Block = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-id="child-2"]');
      await child2Block.click();
      await page.keyboard.press('Backspace');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-2 removed; toggle-1, child-1, root-1 remain
      expect(allBlocks.length).toBe(3);

      const child1 = allBlocks.find(b => b.id === 'child-1');
      const child2 = allBlocks.find(b => b.id === 'child-2');

      expect(child2).toBeUndefined();
      expect(child1?.parent).toBe('toggle-1');
    });

    test('Backspace at start of non-empty first child does nothing instead of promoting block out', async ({ page }) => {
      // Non-empty first child, cursor positioned at start via Home key.
      // Currently promotes the block out of the toggle; should do nothing (no previous sibling).
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'Hello world' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root' } },
        ],
      });

      // Click child-1, go to start, press Backspace
      const childParagraph = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-component="paragraph"]');
      await childParagraph.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-1 must NOT be promoted — 3 blocks remain, child-1 still inside toggle with text intact
      expect(allBlocks.length).toBe(3);

      const child1 = allBlocks.find(b => b.id === 'child-1');

      expect(child1?.parent).toBe('toggle-1');
      const child1Data = child1?.data as { text?: string } | undefined;
      expect(child1Data?.text).toBe('Hello world');
    });

    test('Backspace at start of non-empty child with previous sibling merges into previous sibling inside toggle', async ({ page }) => {
      // child-2 has content, cursor at position 0. Previous sibling is child-1 (same toggle).
      // Backspace should merge child-2 into child-1 (standard merge), NOT promote child-2 to root.
      await createBlok(page, {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle' }, content: ['child-1', 'child-2'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'First' }, parent: 'toggle-1' },
          { id: 'child-2', type: 'paragraph', data: { text: 'Second' }, parent: 'toggle-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root' } },
        ],
      });

      // Click child-2, go to start, press Backspace
      const child2Block = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-id="child-2"]');
      await child2Block.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-2 merged into child-1; 3 blocks remain (toggle-1, child-1, root-1)
      expect(allBlocks.length).toBe(3);

      const child1 = allBlocks.find(b => b.id === 'child-1');
      const child2 = allBlocks.find(b => b.id === 'child-2');

      expect(child2).toBeUndefined();
      // child-1 stays inside toggle
      expect(child1?.parent).toBe('toggle-1');
      // merged content: "FirstSecond"
      const child1Data = child1?.data as { text?: string } | undefined;
      expect(child1Data?.text).toBe('FirstSecond');
    });
  });

  test.describe('Toggle heading - Backspace key behavior', () => {
    test('Backspace on empty first child with next sibling removes it and stays inside toggle heading', async ({ page }) => {
      // Empty first child has a next sibling in the same toggle heading.
      // Backspace should remove child-1 and focus child-2 (still inside the toggle heading).
      await createBlok(page, {
        blocks: [
          { id: 'header-1', type: 'header', data: { text: 'Toggle Heading', level: 2, isToggleable: true }, content: ['child-1', 'child-2'] },
          { id: 'child-1', type: 'paragraph', data: { text: '' }, parent: 'header-1' },
          { id: 'child-2', type: 'paragraph', data: { text: 'Content' }, parent: 'header-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root' } },
        ],
      });

      const child1Block = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-id="child-1"]');
      await child1Block.click();
      await page.keyboard.press('Backspace');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-1 removed; header-1, child-2, root-1 remain
      expect(allBlocks.length).toBe(3);

      const child1 = allBlocks.find(b => b.id === 'child-1');
      const child2 = allBlocks.find(b => b.id === 'child-2');

      expect(child1).toBeUndefined();
      expect(child2?.parent).toBe('header-1');
    });

    test('Backspace on empty only child inside toggle heading does nothing', async ({ page }) => {
      // Empty only child in toggle heading — no siblings. Backspace should do nothing.
      await createBlok(page, {
        blocks: [
          { id: 'header-1', type: 'header', data: { text: 'Toggle Heading', level: 2, isToggleable: true }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: '' }, parent: 'header-1' },
          { id: 'root-1', type: 'paragraph', data: { text: 'Root' } },
        ],
      });

      const child1Block = page.locator(TOGGLE_CHILDREN_SELECTOR).locator('[data-blok-id="child-1"]');
      await child1Block.click();
      await page.keyboard.press('Backspace');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const allBlocks = saved?.blocks ?? [];

      // child-1 stays inside toggle heading — 3 blocks remain
      expect(allBlocks.length).toBe(3);

      const child1 = allBlocks.find(b => b.id === 'child-1');

      expect(child1).toBeDefined();
      expect(child1?.parent).toBe('header-1');
    });
  });
});

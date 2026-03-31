import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOGGLE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="toggle"]`;
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
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

test.describe('Toggle Content - Adding blocks inside toggles', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('toggle list item', () => {
    test('Enter at end of open toggle creates child paragraph inside toggle', async ({ page }) => {
      await createBlok(page, {
        blocks: [{ type: 'toggle', data: { text: 'My toggle', isOpen: true } }],
      });

      // Toggle is explicitly open via isOpen: true — verify
      await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

      // Click the toggle content and move to end
      const content = page.locator('[data-blok-toggle-content]');

      await content.click();
      await page.keyboard.press('End');

      // Press Enter to create child block
      await page.keyboard.press('Enter');

      // A paragraph should now exist as a child of the toggle
      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();

      // Should have 2 blocks: the toggle and a child paragraph
      expect(savedData?.blocks.length).toBeGreaterThanOrEqual(2);

      const toggleBlock = savedData?.blocks.find(b => b.type === 'toggle');
      const paragraphBlock = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(toggleBlock).toBeDefined();
      expect(paragraphBlock).toBeDefined();

      // The paragraph should be a child of the toggle (has content relationship)
      expect(toggleBlock?.content).toBeDefined();
      expect(toggleBlock?.content?.length).toBeGreaterThan(0);
      expect(toggleBlock?.content).toContain(paragraphBlock?.id);
    });

    test('Enter at end of closed toggle creates sibling toggle', async ({ page }) => {
      await createBlok(page, {
        blocks: [{ type: 'toggle', data: { text: 'Closed toggle', isOpen: false } }],
      });

      // Toggle is explicitly closed — verify
      await expect(page.locator('[data-blok-toggle-open="false"]')).toBeVisible();

      // Click the toggle content and move to end
      const content = page.locator('[data-blok-toggle-content]');

      await content.click();
      await page.keyboard.press('End');

      // Press Enter
      await page.keyboard.press('Enter');

      // Should create a sibling toggle, not a child
      const toggleBlocks = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggleBlocks).toHaveCount(2);
    });
  });

  test.describe('toggle heading', () => {
    test('Enter at end of open toggle heading creates child paragraph', async ({ page }) => {
      await createBlok(page, {
        blocks: [{ type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true, isOpen: true } }],
      });

      const header = page.getByRole('heading', { level: 2, name: 'Toggle heading' });

      // Toggle heading is explicitly open via isOpen: true
      await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');

      // Disable the modifications observer to prevent MutationObserver feedback loop
      // (a pre-existing bug triggered by DOM changes from Enter key handling)
      await page.evaluate(() => {
        const blok = window.blokInstance as unknown as Record<string, unknown> | undefined;

        if (!blok) {
          return;
        }

        const modules = blok['module'] as Record<string, unknown> | undefined;
        const modObserver = modules?.['modificationsObserver'] as { disable: () => void } | undefined;

        modObserver?.disable();
      });

      // Click the heading text and move to end
      await header.click();
      await page.keyboard.press('End');

      // Press Enter to create a child block
      await page.keyboard.press('Enter');

      // A paragraph should now exist as a child of the toggle heading
      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();

      // Should have 2 blocks: the header and a child paragraph
      expect(savedData?.blocks.length).toBeGreaterThanOrEqual(2);

      const headerBlock = savedData?.blocks.find(b => b.type === 'header');
      const paragraphBlock = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(headerBlock).toBeDefined();
      expect(paragraphBlock).toBeDefined();

      // The paragraph should be a child of the toggle heading
      expect(headerBlock?.content).toBeDefined();
      expect(headerBlock?.content?.length).toBeGreaterThan(0);
      expect(headerBlock?.content).toContain(paragraphBlock?.id);
    });
  });

  test.describe('child blocks inside toggle', () => {
    test('Enter on child paragraph inside toggle creates another child paragraph', async ({ page }) => {
      // Create a toggle with an existing child paragraph via the API
      await createBlok(page);

      // Use the API to create a toggle with a child
      await page.evaluate(async () => {
        const blok = window.blokInstance;

        if (!blok) {
          return;
        }

        await blok.destroy?.();

        const container = document.getElementById('blok');

        if (!container) {
          return;
        }

        const newBlok = new window.Blok({
          holder: container,
          data: {
            blocks: [
              { id: 'toggle-1', type: 'toggle', data: { text: 'Parent toggle', isOpen: true }, content: ['child-1'] },
              { id: 'child-1', type: 'paragraph', data: { text: 'Child text' }, parent: 'toggle-1' },
            ],
          },
        });

        window.blokInstance = newBlok;
        await newBlok.isReady;
      });

      // Toggle is explicitly open via isOpen: true — verify
      await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

      // Click the child paragraph and move to end
      const childParagraph = page.locator(`${PARAGRAPH_BLOCK_SELECTOR} [contenteditable]`).filter({ hasText: 'Child text' });

      await childParagraph.click();
      await page.keyboard.press('End');

      // Press Enter to create a new block
      await page.keyboard.press('Enter');

      // Save and verify the new block is also a child of the toggle
      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();

      // Should have 3 blocks: toggle + 2 child paragraphs
      expect(savedData?.blocks).toHaveLength(3);

      const toggleBlock = savedData?.blocks.find(b => b.type === 'toggle');

      // The toggle should now have 2 children
      expect(toggleBlock?.content).toHaveLength(2);
    });
  });
});

test.describe('nesting any block type via toolbox inside toggle', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('slash menu replaces empty child paragraph with header — stays nested in toggle list', async ({ page }) => {
    // Create a toggle with a non-empty child paragraph, then Enter to create a new empty child,
    // then use slash to replace it with a heading. This exercises the exact code path where the bug manifests.
    await createBlok(page);

    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        return;
      }

      await blok.destroy?.();

      const container = document.getElementById('blok');

      if (!container) {
        return;
      }

      const newBlok = new window.Blok({
        holder: container,
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'My toggle', isOpen: true }, content: ['child-1'] },
            { id: 'child-1', type: 'paragraph', data: { text: 'Child text' }, parent: 'toggle-1' },
          ],
        },
      });

      window.blokInstance = newBlok;
      await newBlok.isReady;
    });

    // Verify toggle is open
    await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

    // Click the child paragraph and press Enter to create a new empty child
    const childParagraph = page.locator('[data-blok-toggle-children] [contenteditable]').filter({ hasText: 'Child text' });

    await expect(childParagraph).toBeVisible();
    await childParagraph.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Wait for new empty paragraph inside toggle children
    const newEmptyParagraph = page.locator('[data-blok-toggle-children] [contenteditable][data-blok-empty="true"]');

    await expect(newEmptyParagraph).toBeVisible();

    // Type "/" to open toolbox
    await page.keyboard.type('/');

    // Wait for toolbox popover to appear
    const toolboxPopover = page.locator('[data-blok-testid="toolbox-popover"]');

    await expect(toolboxPopover).toHaveAttribute('data-blok-popover-opened', 'true');

    // Type "heading" to filter — shows heading items
    await page.keyboard.type('heading');

    // Wait for a Heading 2 item to be visible
    const heading2Item = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])').filter({ hasText: 'Heading 2', hasNotText: 'Toggle' });

    await expect(heading2Item).toBeVisible();

    // Click the Heading 2 item — this should replace the empty paragraph with the header
    await heading2Item.click();

    // Save and verify
    const savedData = await page.evaluate(async () => window.blokInstance?.save());

    expect(savedData).toBeDefined();

    const toggleBlock = savedData?.blocks.find(b => b.type === 'toggle');
    const headerBlock = savedData?.blocks.find(b => b.type === 'header');
    const paragraphBlock = savedData?.blocks.find(b => b.type === 'paragraph');

    expect(toggleBlock).toBeDefined();
    expect(headerBlock).toBeDefined();
    expect(paragraphBlock).toBeDefined();

    // The header block must be nested inside the toggle (toggle's content contains its id)
    expect(toggleBlock?.content).toContain(headerBlock?.id);
    // There should be exactly 2 children: original paragraph + heading (not 3 with leftover empty paragraph)
    expect(toggleBlock?.content).toHaveLength(2);
  });

  test('slash menu inserts list block below non-empty child — both stay nested in toggle list', async ({ page }) => {
    // Create a toggle with a non-empty child paragraph
    await createBlok(page);

    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        return;
      }

      await blok.destroy?.();

      const container = document.getElementById('blok');

      if (!container) {
        return;
      }

      const newBlok = new window.Blok({
        holder: container,
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'My toggle', isOpen: true }, content: ['child-1'] },
            { id: 'child-1', type: 'paragraph', data: { text: 'Child text' }, parent: 'toggle-1' },
          ],
        },
      });

      window.blokInstance = newBlok;
      await newBlok.isReady;
    });

    // Verify toggle is open
    await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

    // Click the child paragraph and go to end of line
    const childParagraph = page.locator('[data-blok-toggle-children] [contenteditable]').filter({ hasText: 'Child text' });

    await expect(childParagraph).toBeVisible();
    await childParagraph.click();
    await page.keyboard.press('End');

    // Press Enter to create a new empty child paragraph inside the toggle
    await page.keyboard.press('Enter');

    // Wait for the new empty paragraph inside the toggle children to be focused
    const newEmptyParagraph = page.locator('[data-blok-toggle-children] [contenteditable][data-blok-empty="true"]');

    await expect(newEmptyParagraph).toBeVisible();

    // Type "/" to open toolbox from this new empty child
    await page.keyboard.type('/');

    const toolboxPopover = page.locator('[data-blok-testid="toolbox-popover"]');

    await expect(toolboxPopover).toHaveAttribute('data-blok-popover-opened', 'true');

    // Type "bulleted" to filter to bulleted list
    await page.keyboard.type('bulleted');

    // Wait for Bulleted list item to appear
    const bulletedListItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])').filter({ hasText: 'Bulleted list' });

    await expect(bulletedListItem).toBeVisible();

    // Click Bulleted list item
    await bulletedListItem.click();

    // Save and verify
    const savedData = await page.evaluate(async () => window.blokInstance?.save());

    expect(savedData).toBeDefined();

    const toggleBlock = savedData?.blocks.find(b => b.type === 'toggle');
    const paragraphBlock = savedData?.blocks.find(b => b.type === 'paragraph');
    const listBlock = savedData?.blocks.find(b => b.type === 'list');

    expect(toggleBlock).toBeDefined();
    expect(paragraphBlock).toBeDefined();
    expect(listBlock).toBeDefined();

    // Should have 3 blocks total: toggle + paragraph child + list child
    expect(savedData?.blocks).toHaveLength(3);

    // Both the paragraph and the list block must be children of the toggle
    expect(toggleBlock?.content).toContain(paragraphBlock?.id);
    expect(toggleBlock?.content).toContain(listBlock?.id);
    expect(toggleBlock?.content).toHaveLength(2);
  });

  test('slash menu inside toggle heading child inserts a block that stays nested', async ({ page }) => {
    // Create a toggle heading with a non-empty child paragraph, then Enter to create a new empty child,
    // then use slash to replace it with a bulleted list.
    await createBlok(page);

    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        return;
      }

      await blok.destroy?.();

      const container = document.getElementById('blok');

      if (!container) {
        return;
      }

      const newBlok = new window.Blok({
        holder: container,
        data: {
          blocks: [
            { id: 'toggle-heading-1', type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true }, content: ['child-1'] },
            { id: 'child-1', type: 'paragraph', data: { text: 'Child text' }, parent: 'toggle-heading-1' },
          ],
        },
      });

      window.blokInstance = newBlok;
      await newBlok.isReady;
    });

    // Verify toggle heading is open
    const header = page.getByRole('heading', { level: 2, name: 'Toggle heading' });

    await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');

    // For toggle headings, children are sibling blocks in the editor (not inside [data-blok-toggle-children])
    // Click the child paragraph and press Enter to create a new empty child
    const childParagraph = page.locator(`${PARAGRAPH_BLOCK_SELECTOR} [contenteditable]`).filter({ hasText: 'Child text' });

    await expect(childParagraph).toBeVisible();
    await childParagraph.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Wait for the new empty paragraph (sibling block after the child)
    const newEmptyParagraph = page.locator(`${PARAGRAPH_BLOCK_SELECTOR} [contenteditable][data-blok-empty="true"]`);

    await expect(newEmptyParagraph).toBeVisible();

    // Open toolbox with "/"
    await page.keyboard.type('/');

    const toolboxPopover = page.locator('[data-blok-testid="toolbox-popover"]');

    await expect(toolboxPopover).toHaveAttribute('data-blok-popover-opened', 'true');

    // Type "bulleted" to filter to bulleted list
    await page.keyboard.type('bulleted');

    // Click a Bulleted list item — this should replace the empty paragraph with the list
    const bulletedListItem = page.locator('[data-blok-testid="toolbox-popover"] [data-blok-item-name]:not([data-blok-hidden])').filter({ hasText: 'Bulleted list' });

    await expect(bulletedListItem).toBeVisible();
    await bulletedListItem.click();

    // Save and verify
    const savedData = await page.evaluate(async () => window.blokInstance?.save());

    expect(savedData).toBeDefined();

    const toggleHeadingBlock = savedData?.blocks.find(b => b.type === 'header' && (b.data as Record<string, unknown>)?.isToggleable === true);
    const listBlock = savedData?.blocks.find(b => b.type === 'list');
    const paragraphBlock = savedData?.blocks.find(b => b.type === 'paragraph');

    expect(toggleHeadingBlock).toBeDefined();
    expect(listBlock).toBeDefined();
    expect(paragraphBlock).toBeDefined();

    // The newly inserted list block must still be a child of the toggle heading
    expect(toggleHeadingBlock?.content).toContain(listBlock?.id);
    // There should be exactly 2 children: original paragraph + list (not 3 with leftover empty paragraph)
    expect(toggleHeadingBlock?.content).toHaveLength(2);
  });
});

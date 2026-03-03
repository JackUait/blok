import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOGGLE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="toggle"]`;
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;
const POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';

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

const createToggleData = (text: string): OutputData => ({
  blocks: [
    {
      type: 'toggle',
      data: { text },
    },
  ],
});

test.describe('Toggle Tool', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('rendering', () => {
    test('renders toggle block from saved data', async ({ page }) => {
      await createBlok(page, createToggleData('Toggle content'));

      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();

      const content = toggle.locator('[data-blok-toggle-content]');

      await expect(content).toHaveText('Toggle content');
    });

    test('starts expanded by default in editing mode', async ({ page }) => {
      await createBlok(page, createToggleData('Expanded toggle'));

      const toggleWrapper = page.locator('[data-blok-toggle-open]');

      await expect(toggleWrapper).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('renders arrow button', async ({ page }) => {
      await createBlok(page, createToggleData('Toggle with arrow'));

      const arrow = page.locator('[data-blok-toggle-arrow]');

      await expect(arrow).toBeVisible();
      await expect(arrow).toHaveAttribute('role', 'button');
    });
  });

  test.describe('expand/collapse', () => {
    test('collapses when arrow clicked (starts expanded)', async ({ page }) => {
      await createBlok(page, createToggleData('Collapsible'));

      const arrow = page.locator('[data-blok-toggle-arrow]');
      const toggleWrapper = page.locator('[data-blok-toggle-open]');

      await expect(toggleWrapper).toHaveAttribute('data-blok-toggle-open', 'true');

      await arrow.click();

      await expect(toggleWrapper).toHaveAttribute('data-blok-toggle-open', 'false');
    });

    test('re-expands when arrow clicked again', async ({ page }) => {
      await createBlok(page, createToggleData('Re-expandable'));

      const arrow = page.locator('[data-blok-toggle-arrow]');
      const toggleWrapper = page.locator('[data-blok-toggle-open]');

      // Collapse (starts expanded)
      await arrow.click();
      await expect(toggleWrapper).toHaveAttribute('data-blok-toggle-open', 'false');

      // Expand again
      await arrow.click();
      await expect(toggleWrapper).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('clicking text enters edit mode without toggling', async ({ page }) => {
      await createBlok(page, createToggleData('Editable text'));

      const content = page.locator('[data-blok-toggle-content]');
      const toggleWrapper = page.locator('[data-blok-toggle-open]');

      // Click the text content
      await content.click();

      // Toggle should still be expanded (default in editing mode)
      await expect(toggleWrapper).toHaveAttribute('data-blok-toggle-open', 'true');

      // Content should be editable — typing should work
      await page.keyboard.type(' edited');
      await expect(content).toContainText('edited');
    });
  });

  test.describe('slash command', () => {
    test('creates toggle via slash command', async ({ page }) => {
      await createBlok(page);

      // Focus the default empty paragraph's editable content
      const paragraphContent = page.locator(`${PARAGRAPH_BLOCK_SELECTOR} [contenteditable]`);

      await paragraphContent.click();

      // Type "/" to open toolbox
      await page.keyboard.type('/');

      // Wait for the Toggle list option to appear in the toolbox popover
      const toggleOption = page.locator(`${POPOVER_SELECTOR} [data-blok-item-name="toggle"]`);

      await expect(toggleOption).toBeVisible();
      await toggleOption.click();

      // Verify toggle block was created
      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();
    });
  });

  test.describe('markdown shortcut', () => {
    test('creates toggle when "> " typed in empty paragraph', async ({ page }) => {
      await createBlok(page);

      // Focus the default empty paragraph
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();

      // Type the markdown shortcut ("> " is keyboard input, not a CSS selector)
      // eslint-disable-next-line internal-playwright/no-css-selectors
      await page.keyboard.type('> ', { delay: 50 });

      // Wait for conversion to toggle
      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();
    });
  });

  test.describe('keyboard', () => {
    test('Enter does not insert newline in toggle content', async ({ page }) => {
      await createBlok(page, createToggleData('No newline'));

      const content = page.locator('[data-blok-toggle-content]').filter({ hasText: 'No newline' });

      await content.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Content should not have a <br> or newline - Enter splits the block instead
      const html = await content.innerHTML();

      expect(html).not.toContain('<br>');
      expect(html).not.toContain('\n');
    });

    test('Backspace on empty toggle converts to paragraph', async ({ page }) => {
      await createBlok(page, createToggleData(''));

      // Focus the toggle content
      const content = page.locator('[data-blok-toggle-content]');

      await content.click();

      await page.keyboard.press('Backspace');

      // Should convert to paragraph
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();

      // Toggle should be gone
      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toHaveCount(0);
    });
  });

  test.describe('placeholders', () => {
    test('header placeholder is always visible on empty unfocused toggle', async ({ page }) => {
      await createBlok(page, createToggleData(''));

      const content = page.locator('[data-blok-toggle-content]');

      // Click elsewhere to unfocus the toggle
      await page.mouse.click(0, 0);

      // The placeholder attribute should be set
      await expect(content).toHaveAttribute('data-blok-placeholder-active', 'Toggle');

      // Verify the element is empty (placeholder shows via CSS ::before when :empty)
      const isEmpty = await content.evaluate(el => el.innerHTML.trim() === '' || el.innerHTML.trim() === '<br>');

      expect(isEmpty).toBe(true);
    });

    test('body placeholder is visible on empty expanded toggle', async ({ page }) => {
      await createBlok(page, createToggleData('My toggle'));

      const bodyPlaceholder = page.locator('[data-blok-toggle-body-placeholder]');

      await expect(bodyPlaceholder).toBeVisible();
      await expect(bodyPlaceholder).toHaveText('Empty toggle. Click or drop blocks inside.');
    });

    test('body placeholder is hidden when toggle is collapsed', async ({ page }) => {
      await createBlok(page, createToggleData('Collapsible'));

      const arrow = page.locator('[data-blok-toggle-arrow]');
      const bodyPlaceholder = page.locator('[data-blok-toggle-body-placeholder]');

      // Body placeholder is visible when expanded
      await expect(bodyPlaceholder).toBeVisible();

      // Collapse the toggle
      await arrow.click();

      // Body placeholder should be hidden
      await expect(bodyPlaceholder).not.toBeVisible();
    });

    test('body placeholder disappears when child is added via Enter', async ({ page }) => {
      await createBlok(page, createToggleData('Parent toggle'));

      const bodyPlaceholder = page.locator('[data-blok-toggle-body-placeholder]');

      // Body placeholder should be visible initially (no children)
      await expect(bodyPlaceholder).toBeVisible();

      // Click the toggle content and press Enter to create a child
      const content = page.locator('[data-blok-toggle-content]');

      await content.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Body placeholder should disappear
      await expect(bodyPlaceholder).not.toBeVisible();
    });

    test('clicking body placeholder creates a child paragraph', async ({ page }) => {
      await createBlok(page, createToggleData('Click target'));

      const bodyPlaceholder = page.locator('[data-blok-toggle-body-placeholder]');

      await expect(bodyPlaceholder).toBeVisible();

      // Click the body placeholder
      await bodyPlaceholder.click();

      // A child paragraph should be created
      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();
      expect(savedData?.blocks.length).toBeGreaterThanOrEqual(2);

      const toggleBlock = savedData?.blocks.find(b => b.type === 'toggle');
      const paragraphBlock = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(toggleBlock).toBeDefined();
      expect(paragraphBlock).toBeDefined();
      expect(toggleBlock?.content).toContain(paragraphBlock?.id);

      // Body placeholder should be hidden after creating a child
      await expect(bodyPlaceholder).not.toBeVisible();
    });

    test('body placeholder is hidden when toggle has existing children', async ({ page }) => {
      // Create a toggle with an existing child paragraph
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

        const blok = new window.Blok({
          holder: container,
          data: {
            blocks: [
              { id: 'toggle-1', type: 'toggle', data: { text: 'Has children' }, content: ['child-1'] },
              { id: 'child-1', type: 'paragraph', data: { text: 'Existing child' }, parent: 'toggle-1' },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      const bodyPlaceholder = page.locator('[data-blok-toggle-body-placeholder]');

      // Body placeholder should be hidden since toggle has children
      await expect(bodyPlaceholder).not.toBeVisible();
    });
  });

  test.describe('save', () => {
    test('saves toggle data correctly', async ({ page }) => {
      await createBlok(page, createToggleData('Saved toggle'));

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();
      expect(savedData?.blocks).toHaveLength(1);
      expect(savedData?.blocks[0].type).toBe('toggle');
      expect((savedData?.blocks[0].data as { text: string }).text).toBe('Saved toggle');
    });

    test('round-trip preserves data', async ({ page }) => {
      const originalData = createToggleData('Round trip text');

      await createBlok(page, originalData);

      // Save
      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();

      // Reload with saved data
      await createBlok(page, savedData as OutputData);

      // Verify content preserved
      const content = page.locator('[data-blok-toggle-content]');

      await expect(content).toHaveText('Round trip text');
    });
  });
});

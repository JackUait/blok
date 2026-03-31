import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOGGLE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="toggle"]`;
const TOGGLE_ARROW_SELECTOR = '[data-blok-toggle-arrow]';
const TOGGLE_CONTENT_SELECTOR = '[data-blok-toggle-content]';
const TOGGLE_BODY_PLACEHOLDER_SELECTOR = '[data-blok-toggle-body-placeholder]';
const TOGGLE_CHILDREN_SELECTOR = '[data-blok-toggle-children]';
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';

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

const createBlok = async (page: Page, data?: OutputData, readOnly = false): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData, readOnlyMode }) => {
      const config: Record<string, unknown> = { holder, readOnly: readOnlyMode };

      if (initialData) {
        config.data = initialData;
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null, readOnlyMode: readOnly }
  );
};

const createToggleData = (text: string, extra: Record<string, unknown> = {}): OutputData => ({
  blocks: [
    {
      type: 'toggle',
      data: { text, ...extra },
    },
  ],
});

const createToggleWithChild = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      data: {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'Parent toggle' }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'Child paragraph' }, parent: 'toggle-1' },
        ],
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

test.describe('Toggle Tool', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('rendering', () => {
    test('renders toggle block from saved data with content text', async ({ page }) => {
      await createBlok(page, createToggleData('My toggle heading'));

      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();

      const content = toggle.locator(TOGGLE_CONTENT_SELECTOR);

      await expect(content).toHaveText('My toggle heading');
    });

    test('renders arrow button with role="button"', async ({ page }) => {
      await createBlok(page, createToggleData('Arrow test'));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await expect(arrow).toBeVisible();
      await expect(arrow).toHaveAttribute('role', 'button');
      await expect(arrow).toHaveAttribute('tabindex', '0');
    });

    test('defaults to open (data-blok-toggle-open="true") in edit mode when isOpen not in saved data', async ({ page }) => {
      await createBlok(page, createToggleData('Open by default'));

      const wrapper = page.locator('[data-blok-toggle-open]');

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('renders with isOpen=false when saved data specifies it', async ({ page }) => {
      await createBlok(page, createToggleData('Closed toggle', { isOpen: false }));

      const wrapper = page.locator('[data-blok-toggle-open]');

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'false');
    });

    test('renders with isOpen=true when saved data specifies it', async ({ page }) => {
      await createBlok(page, createToggleData('Explicitly open', { isOpen: true }));

      const wrapper = page.locator('[data-blok-toggle-open]');

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('renders children container', async ({ page }) => {
      await createBlok(page, createToggleData('With children area'));

      const children = page.locator(TOGGLE_CHILDREN_SELECTOR);

      await expect(children).toBeAttached();
    });
  });

  test.describe('expand and collapse', () => {
    test('arrow has aria-label="Collapse" and aria-expanded="true" when open', async ({ page }) => {
      await createBlok(page, createToggleData('Open toggle'));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await expect(arrow).toHaveAttribute('aria-label', 'Collapse');
      await expect(arrow).toHaveAttribute('aria-expanded', 'true');
    });

    test('arrow has aria-label="Expand" and aria-expanded="false" when closed', async ({ page }) => {
      await createBlok(page, createToggleData('Closed toggle', { isOpen: false }));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await expect(arrow).toHaveAttribute('aria-label', 'Expand');
      await expect(arrow).toHaveAttribute('aria-expanded', 'false');
    });

    test('clicking arrow collapses an open toggle', async ({ page }) => {
      await createBlok(page, createToggleData('Collapsible'));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);
      const wrapper = page.locator('[data-blok-toggle-open]');

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'true');

      await arrow.click();

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'false');
    });

    test('clicking arrow expands a collapsed toggle', async ({ page }) => {
      await createBlok(page, createToggleData('Expandable', { isOpen: false }));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);
      const wrapper = page.locator('[data-blok-toggle-open]');

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'false');

      await arrow.click();

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('aria attributes update after collapsing', async ({ page }) => {
      await createBlok(page, createToggleData('Aria update test'));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await arrow.click();

      await expect(arrow).toHaveAttribute('aria-label', 'Expand');
      await expect(arrow).toHaveAttribute('aria-expanded', 'false');
    });

    test('aria attributes update after expanding', async ({ page }) => {
      await createBlok(page, createToggleData('Aria re-expand', { isOpen: false }));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await arrow.click();

      await expect(arrow).toHaveAttribute('aria-label', 'Collapse');
      await expect(arrow).toHaveAttribute('aria-expanded', 'true');
    });

    test('children are hidden when toggle is collapsed', async ({ page }) => {
      await createToggleWithChild(page);

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      // Collapse
      await arrow.click();
      await expect(page.locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'false');

      // Child should not be visible
      const child = page.locator(PARAGRAPH_BLOCK_SELECTOR).filter({ hasText: 'Child paragraph' });

      await expect(child).not.toBeVisible();
    });

    test('children are visible when toggle is expanded', async ({ page }) => {
      await createToggleWithChild(page);

      // Starts expanded in edit mode
      await expect(page.locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'true');

      const child = page.locator(PARAGRAPH_BLOCK_SELECTOR).filter({ hasText: 'Child paragraph' });

      await expect(child).toBeVisible();
    });
  });

  test.describe('body placeholder', () => {
    test('body placeholder is visible when toggle is open with no children', async ({ page }) => {
      await createBlok(page, createToggleData('Empty open toggle'));

      const placeholder = page.locator(TOGGLE_BODY_PLACEHOLDER_SELECTOR);

      await expect(placeholder).toBeVisible();
      await expect(placeholder).toHaveText('Empty toggle. Click or drop blocks inside.');
    });

    test('body placeholder is hidden when toggle is collapsed', async ({ page }) => {
      await createBlok(page, createToggleData('Collapsible for placeholder'));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);
      const placeholder = page.locator(TOGGLE_BODY_PLACEHOLDER_SELECTOR);

      await expect(placeholder).toBeVisible();

      await arrow.click();

      await expect(placeholder).not.toBeVisible();
    });

    test('body placeholder is hidden when toggle has children', async ({ page }) => {
      await createToggleWithChild(page);

      const placeholder = page.locator(TOGGLE_BODY_PLACEHOLDER_SELECTOR);

      await expect(placeholder).not.toBeVisible();
    });
  });

  test.describe('save data', () => {
    test('save() includes the toggle text', async ({ page }) => {
      await createBlok(page, createToggleData('Saved text'));

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();
      expect(saved?.blocks).toHaveLength(1);
      expect(saved?.blocks[0].type).toBe('toggle');
      expect((saved?.blocks[0].data as { text: string }).text).toBe('Saved text');
    });

    test('save() preserves isOpen state when collapsed', async ({ page }) => {
      await createBlok(page, createToggleData('Collapsible save'));

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await arrow.click();
      await expect(page.locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'false');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();
      expect((saved?.blocks[0].data as { isOpen: boolean }).isOpen).toBe(false);
    });

    test('save() preserves isOpen state when expanded', async ({ page }) => {
      await createBlok(page, createToggleData('Expanded save'));

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();
      expect((saved?.blocks[0].data as { isOpen: boolean }).isOpen).toBe(true);
    });

    test('round-trip preserves toggle text and open state', async ({ page }) => {
      const original = createToggleData('Round trip', { isOpen: false });

      await createBlok(page, original);

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      await createBlok(page, saved as OutputData);

      const content = page.locator(TOGGLE_CONTENT_SELECTOR);

      await expect(content).toHaveText('Round trip');
      await expect(page.locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'false');
    });
  });

  test.describe('create from toolbox', () => {
    test('creates toggle block via slash command and toolbox item click', async ({ page }) => {
      await createBlok(page);

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      const paragraphInput = paragraph.locator('[contenteditable]');

      await paragraphInput.click();
      await page.keyboard.type('/toggle', { delay: 50 });

      const toggleItem = page.locator('[data-blok-item-name="toggle"]');

      await expect(toggleItem).toBeVisible();
      await toggleItem.click();

      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();
    });

    test('toolbox item for toggle is labelled "Toggle list"', async ({ page }) => {
      await createBlok(page);

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.hover();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await plusButton.click();

      const popover = page.locator(TOOLBOX_POPOVER_SELECTOR);
      const toggleItem = popover.locator('[data-blok-item-name="toggle"]');

      await expect(toggleItem).toContainText('Toggle list');
    });
  });

  test.describe('markdown shortcut', () => {
    test('typing "> " in an empty paragraph converts it to a toggle', async ({ page }) => {
      await createBlok(page);

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();

      // eslint-disable-next-line internal-playwright/no-css-selectors
      await page.keyboard.type('> ', { delay: 50 });

      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();
    });

    test('paragraph is gone after markdown shortcut converts it', async ({ page }) => {
      await createBlok(page);

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      // eslint-disable-next-line internal-playwright/no-css-selectors
      await page.keyboard.type('> ', { delay: 50 });

      // The original plain paragraph should have been replaced by the toggle
      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();

      // No plain (non-child) paragraphs should remain at top level
      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const nonChildParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && !b.parent);

      expect(nonChildParagraphs).toHaveLength(0);
    });
  });

  test.describe('keyboard behavior', () => {
    test('Enter at end of open toggle creates a child paragraph inside the toggle', async ({ page }) => {
      await createBlok(page, createToggleData('Parent toggle'));

      await expect(page.locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'true');

      const content = page.locator(TOGGLE_CONTENT_SELECTOR);

      await content.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();
      expect(saved?.blocks.length).toBeGreaterThanOrEqual(2);

      const toggleBlock = saved?.blocks.find(b => b.type === 'toggle');
      const paragraphBlock = saved?.blocks.find(b => b.type === 'paragraph');

      expect(toggleBlock).toBeDefined();
      expect(paragraphBlock).toBeDefined();
      expect(toggleBlock?.content).toContain(paragraphBlock?.id);
    });

    test('Backspace on an empty toggle converts it to a paragraph', async ({ page }) => {
      await createBlok(page, createToggleData(''));

      const content = page.locator(TOGGLE_CONTENT_SELECTOR);

      await content.click();
      await page.keyboard.press('Backspace');

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();

      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toHaveCount(0);
    });
  });

  test.describe('read-only mode', () => {
    test('toggle renders with arrow visible in read-only mode', async ({ page }) => {
      await createBlok(page, createToggleData('Read-only toggle'), true);

      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await expect(arrow).toBeVisible();
    });

    test('toggle defaults to open (isOpen=true) in read-only mode when isOpen not in saved data', async ({ page }) => {
      await createBlok(page, createToggleData('Read-only open'), true);

      const wrapper = page.locator('[data-blok-toggle-open]');

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('clicking arrow in read-only mode still toggles open state', async ({ page }) => {
      await createBlok(page, createToggleData('Read-only no-op', { isOpen: false }), true);

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);
      const wrapper = page.locator('[data-blok-toggle-open]');

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'false');

      await arrow.click();

      await expect(wrapper).toHaveAttribute('data-blok-toggle-open', 'true');
    });
  });
});

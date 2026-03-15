import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const HOLDER_ID = 'blok';
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`;
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;
const TOGGLE_ARROW_SELECTOR = '[data-blok-toggle-arrow]';
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type HeaderBlockData = {
  text: string;
  level: number;
  isToggleable?: boolean;
  isOpen?: boolean;
};

const isHeaderBlockData = (data: unknown): data is HeaderBlockData => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'text' in data &&
    'level' in data &&
    typeof (data as Record<string, unknown>).text === 'string' &&
    typeof (data as Record<string, unknown>).level === 'number'
  );
};

const getHeaderData = (savedData: OutputData | null | undefined, blockIndex = 0): HeaderBlockData => {
  if (!savedData?.blocks?.[blockIndex]) {
    throw new Error(`No block at index ${blockIndex} in saved data`);
  }
  const data: unknown = savedData.blocks[blockIndex].data;
  if (!isHeaderBlockData(data)) {
    throw new Error(`Block at index ${blockIndex} does not have expected header properties`);
  }
  return data;
};

// ---------------------------------------------------------------------------
// Global window augmentation
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

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

const createBlokWithData = async (
  page: Page,
  blocks: OutputData['blocks'],
  readOnly = false
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks, readOnlyMode }) => {
      const blok = new window.Blok({ holder, data: { blocks: blokBlocks }, readOnly: readOnlyMode });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks, readOnlyMode: readOnly }
  );
};

const createBlokEmpty = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({ holder });
    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

const makeToggleHeadingBlock = (
  text: string,
  level: number,
  isOpen?: boolean
): OutputData['blocks'][number] => ({
  type: 'header',
  data: {
    text,
    level,
    isToggleable: true,
    ...(isOpen !== undefined ? { isOpen } : {}),
  },
});

const makeRegularHeaderBlock = (text: string, level: number): OutputData['blocks'][number] => ({
  type: 'header',
  data: { text, level },
});

const makeParagraphBlock = (text: string, id?: string): OutputData['blocks'][number] => ({
  ...(id ? { id } : {}),
  type: 'paragraph',
  data: { text },
});

// ===========================================================================
// Tests
// ===========================================================================

test.describe('Toggle Heading', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // =========================================================================
  // 1. Rendering
  // =========================================================================

  test.describe('rendering', () => {
    test('renders toggle heading from saved data with arrow present', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Toggle H2', 2)]);

      const header = page.getByRole('heading', { level: 2, name: 'Toggle H2' });

      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute('data-blok-toggle-open');

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await expect(arrow).toBeVisible();
    });

    test('arrow is a sibling of the heading element, not nested inside it', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Arrow Structure', 2)]);

      // Arrow lives in the wrapper div that is the heading's parent.
      // If the arrow were inside the heading, this locator would find it — but it should not.
      const arrowInsideHeading = page.getByRole('heading', { level: 2 }).locator(TOGGLE_ARROW_SELECTOR);

      await expect(arrowInsideHeading).toHaveCount(0);

      // Arrow must be reachable from the heading's parent element (the wrapper div).
      const arrowInWrapper = await page.evaluate(() => {
        const heading = document.querySelector('h2[data-blok-toggle-open]');
        const wrapper = heading?.parentElement;
        return wrapper?.querySelector('[data-blok-toggle-arrow]') !== null;
      });

      expect(arrowInWrapper).toBe(true);
    });

    test('regular header has no toggle arrow', async ({ page }) => {
      await createBlokWithData(page, [makeRegularHeaderBlock('Regular H2', 2)]);

      await expect(page.getByRole('heading', { level: 2, name: 'Regular H2' })).toBeVisible();
      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toHaveCount(0);
    });

    test('regular header has no data-blok-toggle-open attribute', async ({ page }) => {
      await createBlokWithData(page, [makeRegularHeaderBlock('No Toggle', 3)]);

      const toggleAttr = await page.evaluate(() =>
        document.querySelector('h3')?.hasAttribute('data-blok-toggle-open')
      );

      expect(toggleAttr).toBe(false);
    });

    test('shows body placeholder when open toggle heading has no children', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Empty Toggle', 2)]);

      // The toggle is open by default and has no children — placeholder must be visible
      await expect(page.locator('[data-blok-toggle-body-placeholder]')).toBeVisible();
    });

    test('body placeholder is hidden when toggle heading is collapsed', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Collapsed No Placeholder', 2)]);

      await page.locator(TOGGLE_ARROW_SELECTOR).click();

      await expect(page.locator('[data-blok-toggle-body-placeholder]')).not.toBeVisible();
    });

    test('toggle heading defaults to open in edit mode when isOpen is absent from saved data', async ({ page }) => {
      // Saved data has isToggleable but no isOpen — should default to expanded in editing mode.
      await createBlokWithData(page, [makeToggleHeadingBlock('Default Open', 2)]);

      const header = page.getByRole('heading', { level: 2, name: 'Default Open' });

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('renders toggle H1 correctly', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Toggle H1', 1)]);

      const header = page.getByRole('heading', { level: 1, name: 'Toggle H1' });

      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute('data-blok-toggle-open');
      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toBeVisible();
    });

    test('renders toggle H3 correctly', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Toggle H3', 3)]);

      const header = page.getByRole('heading', { level: 3, name: 'Toggle H3' });

      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute('data-blok-toggle-open');
    });
  });

  // =========================================================================
  // 2. Arrow aria attributes
  // =========================================================================

  test.describe('arrow aria attributes', () => {
    test('arrow has role="button"', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Aria H2', 2)]);

      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toHaveAttribute('role', 'button');
    });

    test('arrow has tabindex="0"', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Focusable Arrow', 2)]);

      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toHaveAttribute('tabindex', '0');
    });

    test('arrow has aria-expanded="true" when heading is open', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Expanded Aria', 2)]);

      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toHaveAttribute('aria-expanded', 'true');
    });

    test('arrow has aria-expanded="false" after collapsing', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Collapse Aria', 2)]);

      await page.locator(TOGGLE_ARROW_SELECTOR).click();

      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toHaveAttribute('aria-expanded', 'false');
    });

    test('arrow aria-label is "Collapse" when heading is open', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Label Open', 2)]);

      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toHaveAttribute('aria-label', 'Collapse');
    });

    test('arrow aria-label is "Expand" when heading is collapsed', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Label Closed', 2)]);

      await page.locator(TOGGLE_ARROW_SELECTOR).click();

      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toHaveAttribute('aria-label', 'Expand');
    });
  });

  // =========================================================================
  // 3. Expand and collapse
  // =========================================================================

  test.describe('expand and collapse', () => {
    test('collapses when arrow is clicked — data-blok-toggle-open changes to "false"', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Collapsible H2', 2)]);

      const header = page.getByRole('heading', { level: 2, name: 'Collapsible H2' });
      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');

      await arrow.click();

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'false');
    });

    test('re-expands when arrow is clicked again', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Re-expandable H2', 2)]);

      const header = page.getByRole('heading', { level: 2, name: 'Re-expandable H2' });
      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);

      await arrow.click();
      await expect(header).toHaveAttribute('data-blok-toggle-open', 'false');

      await arrow.click();
      await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('child blocks are hidden when toggle heading is collapsed', async ({ page }) => {
      const toggleId = 'toggle-h2';
      const childId = 'child-para';

      await page.evaluate(
        async ({ holder, toggleId: tid, childId: cid }) => {
          if (window.blokInstance) {
            await window.blokInstance.destroy?.();
            window.blokInstance = undefined;
          }

          document.getElementById(holder)?.remove();

          const container = document.createElement('div');

          container.id = holder;
          container.setAttribute('data-blok-testid', holder);
          document.body.appendChild(container);

          const blok = new window.Blok({
            holder,
            data: {
              blocks: [
                { id: tid, type: 'header', data: { text: 'Parent H2', level: 2, isToggleable: true, isOpen: true }, content: [cid] },
                { id: cid, type: 'paragraph', data: { text: 'Child content' }, parent: tid },
              ],
            },
          });

          window.blokInstance = blok;
          await blok.isReady;
        },
        { holder: HOLDER_ID, toggleId, childId }
      );

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);
      const child = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(child).toBeVisible();

      await arrow.click();

      await expect(child).not.toBeVisible();
    });

    test('child blocks become visible when toggle heading is expanded', async ({ page }) => {
      const toggleId = 'toggle-h2-vis';
      const childId = 'child-para-vis';

      await page.evaluate(
        async ({ holder, toggleId: tid, childId: cid }) => {
          if (window.blokInstance) {
            await window.blokInstance.destroy?.();
            window.blokInstance = undefined;
          }

          document.getElementById(holder)?.remove();

          const container = document.createElement('div');

          container.id = holder;
          container.setAttribute('data-blok-testid', holder);
          document.body.appendChild(container);

          const blok = new window.Blok({
            holder,
            data: {
              blocks: [
                { id: tid, type: 'header', data: { text: 'Parent H2', level: 2, isToggleable: true, isOpen: true }, content: [cid] },
                { id: cid, type: 'paragraph', data: { text: 'Child content' }, parent: tid },
              ],
            },
          });

          window.blokInstance = blok;
          await blok.isReady;
        },
        { holder: HOLDER_ID, toggleId, childId }
      );

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR);
      const child = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      // Collapse then expand
      await arrow.click();
      await expect(child).not.toBeVisible();

      await arrow.click();
      await expect(child).toBeVisible();
    });
  });

  // =========================================================================
  // 4. Toolbox creation
  // =========================================================================

  test.describe('toolbox creation', () => {
    test('creates toggle H2 via toolbox item toggle-header-2', async ({ page }) => {
      await createBlokEmpty(page);

      const paragraphContent = page.locator(`${PARAGRAPH_BLOCK_SELECTOR} [contenteditable]`);

      await paragraphContent.click();
      await page.keyboard.type('/');

      const toolboxItem = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="toggle-header-2"]`);

      await expect(toolboxItem).toBeVisible();
      await toolboxItem.click();

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.level).toBe(2);
      expect(data.isToggleable).toBe(true);
    });

    test('creates toggle H1 via toolbox item toggle-header-1', async ({ page }) => {
      await createBlokEmpty(page);

      const paragraphContent = page.locator(`${PARAGRAPH_BLOCK_SELECTOR} [contenteditable]`);

      await paragraphContent.click();
      await page.keyboard.type('/');

      const toolboxItem = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="toggle-header-1"]`);

      await expect(toolboxItem).toBeVisible();
      await toolboxItem.click();

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.level).toBe(1);
      expect(data.isToggleable).toBe(true);
    });

    test('creates toggle H3 via toolbox item toggle-header-3', async ({ page }) => {
      await createBlokEmpty(page);

      const paragraphContent = page.locator(`${PARAGRAPH_BLOCK_SELECTOR} [contenteditable]`);

      await paragraphContent.click();
      await page.keyboard.type('/');

      const toolboxItem = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="toggle-header-3"]`);

      await expect(toolboxItem).toBeVisible();
      await toolboxItem.click();

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.level).toBe(3);
      expect(data.isToggleable).toBe(true);
    });
  });

  // =========================================================================
  // 5. Markdown shortcuts
  // =========================================================================

  test.describe('markdown shortcuts', () => {
    test('">## " in empty paragraph creates toggle H2', async ({ page }) => {
      await createBlokWithData(page, [makeParagraphBlock('', 'test-para')]);

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      // eslint-disable-next-line internal-playwright/no-css-selectors
      await page.keyboard.type('>## ', { delay: 50 });

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(0);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.level).toBe(2);
      expect(data.isToggleable).toBe(true);
      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toBeVisible();
    });

    test('"># " in empty paragraph creates toggle H1', async ({ page }) => {
      await createBlokWithData(page, [makeParagraphBlock('', 'test-para')]);

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      // eslint-disable-next-line internal-playwright/no-css-selectors
      await page.keyboard.type('># ', { delay: 50 });

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.level).toBe(1);
      expect(data.isToggleable).toBe(true);
    });

    test('">### " in empty paragraph creates toggle H3', async ({ page }) => {
      await createBlokWithData(page, [makeParagraphBlock('', 'test-para')]);

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      // eslint-disable-next-line internal-playwright/no-css-selectors
      await page.keyboard.type('>### ', { delay: 50 });

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.level).toBe(3);
      expect(data.isToggleable).toBe(true);
    });

    test('">## " shortcut preserves existing paragraph text', async ({ page }) => {
      await createBlokWithData(page, [makeParagraphBlock('Hello World', 'test-para')]);

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();

      // Move caret to beginning
      await page.evaluate(() => {
        const para = document.querySelector('[data-blok-tool="paragraph"]');
        if (para) {
          const range = document.createRange();
          const selection = window.getSelection();
          range.setStart(para, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      // eslint-disable-next-line internal-playwright/no-css-selectors
      await page.keyboard.type('>## ', { delay: 50 });

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.text).toBe('Hello World');
      expect(data.level).toBe(2);
      expect(data.isToggleable).toBe(true);
    });
  });

  // =========================================================================
  // 6. Save data
  // =========================================================================

  test.describe('save data', () => {
    test('saves isToggleable: true for a toggle heading', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Saved Toggle H2', 2)]);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());

      expect(savedData?.blocks).toHaveLength(1);
      expect(savedData?.blocks[0].type).toBe('header');

      const data = getHeaderData(savedData);

      expect(data.text).toBe('Saved Toggle H2');
      expect(data.level).toBe(2);
      expect(data.isToggleable).toBe(true);
    });

    test('saves isOpen reflecting the current collapsed state', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Collapsible Save', 2)]);

      await page.locator(TOGGLE_ARROW_SELECTOR).click();

      // After collapsing, heading attribute should be "false"
      await expect(page.getByRole('heading', { level: 2, name: 'Collapsible Save' })).toHaveAttribute(
        'data-blok-toggle-open',
        'false'
      );

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.isOpen).toBe(false);
    });

    test('does not save isToggleable for regular headers', async ({ page }) => {
      await createBlokWithData(page, [makeRegularHeaderBlock('Regular Header', 2)]);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());
      const data = getHeaderData(savedData);

      expect(data.isToggleable).toBeUndefined();
      expect(data.isOpen).toBeUndefined();
    });

    test('round-trip: saved toggle heading re-renders correctly', async ({ page }) => {
      const originalBlocks = [makeToggleHeadingBlock('Round Trip H3', 3)];

      await createBlokWithData(page, originalBlocks);

      const savedData = await page.evaluate(async () => window.blokInstance?.save());

      await createBlokWithData(page, savedData?.blocks ?? []);

      const header = page.getByRole('heading', { level: 3, name: 'Round Trip H3' });

      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute('data-blok-toggle-open');
      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toBeVisible();
    });
  });

  // =========================================================================
  // 7. Read-only mode
  // =========================================================================

  test.describe('read-only mode', () => {
    test('toggle heading starts collapsed in read-only mode when no isOpen in saved data', async ({ page }) => {
      // isToggleable true but no isOpen — read-only default is collapsed
      await createBlokWithData(page, [makeToggleHeadingBlock('Read-Only Closed', 2)], true);

      const header = page.getByRole('heading', { level: 2, name: 'Read-Only Closed' });

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'false');
    });

    test('toggle heading arrow is present in read-only mode', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Read-Only Arrow', 2)], true);

      await expect(page.locator(TOGGLE_ARROW_SELECTOR)).toBeVisible();
    });

    test('toggle heading starts with explicit isOpen:true preserved in read-only mode', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Read-Only Open', 2, true)], true);

      const header = page.getByRole('heading', { level: 2, name: 'Read-Only Open' });

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('toggle heading starts with explicit isOpen:false preserved in read-only mode', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Read-Only Explicit Closed', 2, false)], true);

      const header = page.getByRole('heading', { level: 2, name: 'Read-Only Explicit Closed' });

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'false');
    });
  });

  // =========================================================================
  // 8. Keyboard interactions
  // =========================================================================

  test.describe('keyboard interactions', () => {
    test('pressing Enter at end of open toggle heading creates a child block inside the toggle', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('My Toggle', 2)]);

      const heading = page.getByRole('heading', { level: 2, name: 'My Toggle' });

      await heading.click();
      // Move caret to end of heading text
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // A new paragraph block should exist inside the toggle
      const savedData = await page.evaluate(async () => window.blokInstance?.save());

      expect(savedData?.blocks).toHaveLength(2);
      expect(savedData?.blocks[1].type).toBe('paragraph');

      // The child block must have the toggle heading as parent
      const childBlock = savedData?.blocks[1];

      expect(childBlock?.parent).toBeDefined();
      expect(childBlock?.parent).toBe(savedData?.blocks[0].id);
    });
  });

  // =========================================================================
  // 9. Body placeholder click
  // =========================================================================

  test.describe('body placeholder click', () => {
    test('clicking body placeholder creates a child paragraph and hides placeholder', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Empty Toggle H2', 2)]);

      const placeholder = page.locator('[data-blok-toggle-body-placeholder]');

      await expect(placeholder).toBeVisible();

      await placeholder.click();

      // A new paragraph should exist as a child block
      const savedData = await page.evaluate(async () => window.blokInstance?.save());

      expect(savedData?.blocks).toHaveLength(2);
      expect(savedData?.blocks[1].type).toBe('paragraph');
      expect(savedData?.blocks[1].parent).toBe(savedData?.blocks[0].id);

      // The placeholder should now be hidden
      await expect(placeholder).not.toBeVisible();
    });

    test('clicking body placeholder focuses the new child paragraph', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Focus Test H2', 2)]);

      const placeholder = page.locator('[data-blok-toggle-body-placeholder]');

      await expect(placeholder).toBeVisible();
      await placeholder.click();

      // Focus should land inside the toggle children container
      await page.waitForFunction(() => {
        const container = document.querySelector('[data-blok-toggle-children]');

        return container !== null && container.contains(document.activeElement);
      });

      const focusInChildren = await page.evaluate(() => {
        const container = document.querySelector('[data-blok-toggle-children]');

        return container !== null && container.contains(document.activeElement);
      });

      expect(focusInChildren).toBe(true);
    });

    test('clicking body placeholder: typing immediately enters text in the new child block', async ({ page }) => {
      await createBlokWithData(page, [makeToggleHeadingBlock('Type Test H2', 2)]);

      const placeholder = page.locator('[data-blok-toggle-body-placeholder]');

      await expect(placeholder).toBeVisible();
      await placeholder.click();

      await page.keyboard.type('child text');

      // The child paragraph lives inside [data-blok-toggle-children]
      const childParagraph = page.locator('[data-blok-toggle-children] [data-blok-component="paragraph"]');

      await expect(childParagraph).toHaveText('child text');
    });
  });

  // =========================================================================
  // 10. Arrow positioning
  // =========================================================================

  test.describe('arrow positioning', () => {
    test('arrow stays vertically aligned to heading when multiple children are visible', async ({ page }) => {
      /**
       * Regression test: the arrow must remain aligned to the heading text row,
       * not drift to the vertical midpoint of (heading + all visible children).
       *
       * Previously the wrapper with `position:relative` contained both the heading
       * AND the [data-blok-toggle-children] container, so `top:50%` resolved to
       * the midpoint of the entire expanded block — not just the heading.
       */
      await createBlokWithData(page, [
        {
          id: 'h1',
          type: 'header',
          data: { text: 'Toggle H2 With Children', level: 2, isToggleable: true, isOpen: true },
          content: ['p1', 'p2', 'p3', 'p4', 'p5'],
        },
        { id: 'p1', type: 'paragraph', data: { text: 'Child paragraph 1' }, parent: 'h1' },
        { id: 'p2', type: 'paragraph', data: { text: 'Child paragraph 2' }, parent: 'h1' },
        { id: 'p3', type: 'paragraph', data: { text: 'Child paragraph 3' }, parent: 'h1' },
        { id: 'p4', type: 'paragraph', data: { text: 'Child paragraph 4' }, parent: 'h1' },
        { id: 'p5', type: 'paragraph', data: { text: 'Child paragraph 5' }, parent: 'h1' },
      ]);

      // All children must be visible so the wrapper is fully expanded.
      await expect(page.getByText('Child paragraph 5')).toBeVisible();

      const alignment = await page.evaluate(() => {
        const heading = document.querySelector('h2[data-blok-toggle-open]');
        const arrow = document.querySelector('[data-blok-toggle-arrow]');
        const headingRect = heading?.getBoundingClientRect() ?? new DOMRect();
        const arrowRect = arrow?.getBoundingClientRect() ?? new DOMRect();
        const headingMidY = headingRect.top + headingRect.height / 2;
        const arrowMidY = arrowRect.top + arrowRect.height / 2;

        return {
          found: heading !== null && arrow !== null,
          diff: Math.abs(headingMidY - arrowMidY),
        };
      });

      expect(alignment.found).toBe(true);
      // Arrow midpoint must be within 3 px of the heading text midpoint.
      expect(alignment.diff).toBeLessThanOrEqual(3);
    });
  });
});

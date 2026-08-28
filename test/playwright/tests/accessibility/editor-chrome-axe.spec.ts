/**
 * Accessibility coverage for the editor's floating CHROME — toolbar, toolbox,
 * block settings, inline toolbar, nested submenus, the color picker, the link
 * field and tooltips.
 *
 * Every one of these surfaces is top-layer / body-mounted and renders nothing
 * until it is opened, so each test OPENS its surface, asserts it is actually
 * on screen, and only then runs the scans. Without the presence assertion an
 * `include`-scoped axe run passes vacuously against an empty subtree.
 */
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR,
  TOOLTIP_INTERFACE_SELECTOR
} from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expectEveryControlIsNamed, expectNoA11yViolations } from '../helpers/a11y';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar"]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const SETTINGS_TOGGLER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const BLOCK_TUNES_POPOVER_SELECTOR = '[data-blok-testid="block-tunes-popover"]';
const POPOVER_CONTAINER = '[data-blok-testid="popover-container"]';
const POPOVER_ITEMS = '[data-blok-testid="popover-items"]';
const POPOVER_ITEM = '[data-blok-testid="popover-item"]';
const VISIBLE_POPOVER_ITEM = '[data-blok-testid="popover-item"]:not([data-blok-hidden="true"])';
const SEARCH_INPUT = '[data-blok-testid="popover-search-input"]';
const NESTED_POPOVER = '[data-blok-nested="true"]';
const BLOCK_COLOR_PICKER = '[data-blok-testid="block-color-picker"]';
const LINK_INPUT = '[data-blok-testid="inline-tool-input"]';

const expectPopoverSettled = async (popover: Locator): Promise<void> => {
  await expect(popover).toHaveCSS('opacity', '1');
};

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

const createBlok = async (
  page: Page,
  options: { data?: OutputData; config?: Record<string, unknown> } = {}
): Promise<void> => {
  const { data = null, config = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData, config: providedConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
        autofocus: true,
        ...providedConfig,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      initialData: data,
      config,
    }
  );
};

/**
 * Put a real DOM selection across `text` inside `locator` and notify the
 * editor, which is what makes the inline toolbar appear.
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const root = element as HTMLElement;
    const doc = root.ownerDocument;
    const fullText = root.textContent ?? '';

    if (!fullText.includes(targetText)) {
      throw new Error(`Text "${targetText}" was not found in element`);
    }

    const selection = doc.getSelection();

    if (!selection) {
      throw new Error('Selection is not available');
    }

    const startIndex = fullText.indexOf(targetText);
    const endIndex = startIndex + targetText.length;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    let accumulated = 0;
    let startNode: Node | null = null;
    let startOffset = 0;
    let endNode: Node | null = null;
    let endOffset = 0;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nodeText = node.textContent ?? '';
      const nodeStart = accumulated;
      const nodeEnd = nodeStart + nodeText.length;

      if (!startNode && startIndex >= nodeStart && startIndex < nodeEnd) {
        startNode = node;
        startOffset = startIndex - nodeStart;
      }

      if (!endNode && endIndex <= nodeEnd) {
        endNode = node;
        endOffset = endIndex - nodeStart;
        break;
      }

      accumulated = nodeEnd;
    }

    if (!startNode || !endNode) {
      throw new Error('Failed to locate text nodes for selection');
    }

    const range = doc.createRange();

    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    selection.removeAllRanges();
    selection.addRange(range);
    root.focus();
    doc.dispatchEvent(new Event('selectionchange'));
  }, text);
};

const singleParagraph = (text: string): OutputData => ({
  blocks: [{ type: 'paragraph', data: { text } }],
});

/**
 * Reveal the block toolbar by hovering the only block of the document.
 */
const hoverOnlyBlock = async (page: Page): Promise<Locator> => {
  const paragraph = page.locator(PARAGRAPH_SELECTOR);

  await expect(paragraph).toHaveCount(1);
  await paragraph.click();
  await paragraph.hover();

  return paragraph;
};

const openBlockSettings = async (page: Page): Promise<Locator> => {
  await hoverOnlyBlock(page);

  const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

  await expect(settingsToggler).toBeVisible();
  await settingsToggler.click();

  const container = page.locator(`${BLOCK_TUNES_POPOVER_SELECTOR} ${POPOVER_CONTAINER}`);

  await expect(container).toBeVisible();

  return container;
};

const openInlineToolbar = async (page: Page, text: string): Promise<Locator> => {
  const paragraph = page.locator(PARAGRAPH_SELECTOR);

  await expect(paragraph).toHaveCount(1);
  await selectText(paragraph, text);

  const toolbar = page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${POPOVER_CONTAINER}`);

  await expect(toolbar).toBeVisible();

  return toolbar;
};

test.describe('editor chrome accessibility', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test.describe('block toolbar', () => {
    test('exposes a labelled toolbar with named, collapsed controls', async ({ page }) => {
      await createBlok(page, { data: singleParagraph('First block') });

      await hoverOnlyBlock(page);

      const toolbar = page.locator(TOOLBAR_SELECTOR);

      await expect(toolbar).toBeVisible();
      await expect(toolbar).toHaveAttribute('role', 'toolbar');
      await expect(toolbar).toHaveAttribute('aria-label', /.+/);

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
      const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

      await expect(plusButton).toBeVisible();
      await expect(plusButton).toHaveAttribute('aria-haspopup', 'listbox');
      await expect(plusButton).toHaveAttribute('aria-expanded', 'false');

      await expect(settingsToggler).toBeVisible();
      await expect(settingsToggler).toHaveAttribute('aria-haspopup', 'menu');
      await expect(settingsToggler).toHaveAttribute('aria-expanded', 'false');

      await expectNoA11yViolations(page, {
        include: TOOLBAR_SELECTOR,
        label: 'block toolbar',
      });
      await expectEveryControlIsNamed(toolbar);
    });
  });

  test.describe('toolbox popover', () => {
    test('opened with "/" is a listbox of named options driven by a combobox', async ({ page }) => {
      test.fixme(
        true,
        'axe aria-required-children (critical): #blok-toolbox-popover role="listbox" owns role="separator" section headers instead of only options; '
        + 'axe color-contrast (serious): [data-blok-testid="toolbox-section-title"] renders text-gray-text/50 on the popover background'
      );

      await createBlok(page);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await expect(paragraph).toHaveCount(1);

      const editable = paragraph.locator('[contenteditable]');

      await editable.click();
      await expect(editable).toHaveAttribute('data-blok-empty', 'true');

      await page.keyboard.type('/');

      const popover = page.locator(TOOLBOX_POPOVER_SELECTOR);

      await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');
      await expect(popover.locator(POPOVER_CONTAINER)).toBeVisible();

      // The block's contentEditable becomes the combobox owning the listbox,
      // so the expanded state lives on it rather than on a button.
      await expect(editable).toHaveAttribute('role', 'combobox');
      await expect(editable).toHaveAttribute('aria-expanded', 'true');

      await expect(popover.locator(POPOVER_ITEMS)).toHaveAttribute('role', 'listbox');

      const firstOption = popover.locator(VISIBLE_POPOVER_ITEM).first();

      await expect(firstOption).toHaveAttribute('role', 'option');
      await expect(firstOption).toHaveAttribute('aria-selected', 'true');

      await expectNoA11yViolations(page, {
        include: TOOLBOX_POPOVER_SELECTOR,
        label: 'toolbox popover (slash)',
      });
      await expectEveryControlIsNamed(popover);
    });

    test('opened with the + button marks the trigger expanded', async ({ page }) => {

      await createBlok(page, { data: singleParagraph('Hello world') });

      await hoverOnlyBlock(page);

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await expect(plusButton).toBeVisible();
      await plusButton.click();

      const popover = page.locator(TOOLBOX_POPOVER_SELECTOR);

      await expect(popover.locator(POPOVER_CONTAINER)).toBeVisible();
      await expect(plusButton).toHaveAttribute('aria-expanded', 'true');
      await expect(popover.locator(VISIBLE_POPOVER_ITEM).first()).toBeVisible();

      await expectNoA11yViolations(page, {
        include: TOOLBOX_POPOVER_SELECTOR,
        label: 'toolbox popover (plus button)',
      });
      await expectEveryControlIsNamed(popover);
    });

    test('filtering with a query keeps the results surface announced and named', async ({ page }) => {
      await createBlok(page);

      const editable = page.locator(PARAGRAPH_SELECTOR).locator('[contenteditable]');

      await editable.click();
      await expect(editable).toHaveAttribute('data-blok-empty', 'true');
      await page.keyboard.type('/');

      const popover = page.locator(TOOLBOX_POPOVER_SELECTOR);

      await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

      const visibleItems = popover.locator(VISIBLE_POPOVER_ITEM);
      const unfilteredCount = await visibleItems.count();

      expect(unfilteredCount).toBeGreaterThan(1);

      await page.keyboard.type('head');

      await expect(visibleItems).not.toHaveCount(unfilteredCount);
      await expect(visibleItems.first()).toBeVisible();

      // Result-count changes must reach screen readers through a live region.
      const announcer = popover.locator('[data-blok-testid="popover-results-announcer"]');

      await expect(announcer).toHaveAttribute('role', 'status');
      await expect(announcer).toHaveAttribute('aria-live', 'polite');

      await expectNoA11yViolations(page, {
        include: TOOLBOX_POPOVER_SELECTOR,
        label: 'toolbox popover (filtered)',
      });
      await expectEveryControlIsNamed(popover);
    });
  });

  test.describe('block settings menu', () => {
    test('opened from the settings toggler is a named menu', async ({ page }) => {

      await createBlok(page, { data: singleParagraph('Some text') });

      const container = await openBlockSettings(page);
      const popover = page.locator(BLOCK_TUNES_POPOVER_SELECTOR);

      await expect(container).toBeVisible();
      await expect(page.locator(SETTINGS_TOGGLER_SELECTOR)).toHaveAttribute('aria-expanded', 'true');
      await expect(popover.locator(POPOVER_ITEMS)).toHaveAttribute('role', 'menu');

      const firstItem = popover.locator(VISIBLE_POPOVER_ITEM).first();

      await expect(firstItem).toBeVisible();
      await expect(firstItem).toHaveAttribute('role', /menuitem/);

      await expectNoA11yViolations(page, {
        include: BLOCK_TUNES_POPOVER_SELECTOR,
        label: 'block settings menu',
      });
      await expectEveryControlIsNamed(popover);
    });

    test('its search field is a labelled combobox that filters the menu', async ({ page }) => {
      await createBlok(page, { data: singleParagraph('Some text') });

      await openBlockSettings(page);

      const popover = page.locator(BLOCK_TUNES_POPOVER_SELECTOR);
      const searchInput = popover.locator(SEARCH_INPUT);

      await expect(searchInput).toBeVisible();
      await expect(searchInput).toHaveAttribute('role', 'combobox');
      await expect(searchInput).toHaveAttribute('aria-autocomplete', 'list');
      await expect(searchInput).toHaveAttribute('aria-expanded', 'true');
      await expect(searchInput).toHaveAttribute('aria-label', /.+/);

      const visibleItems = popover.locator(VISIBLE_POPOVER_ITEM);
      const unfilteredCount = await visibleItems.count();

      expect(unfilteredCount).toBeGreaterThan(1);

      await searchInput.fill('move');

      await expect(visibleItems).not.toHaveCount(unfilteredCount);

      await expectNoA11yViolations(page, {
        include: BLOCK_TUNES_POPOVER_SELECTOR,
        label: 'block settings search field',
      });
      await expectEveryControlIsNamed(popover);
    });
  });

  test.describe('nested popovers', () => {
    test('convert-to submenu opened from the block settings menu', async ({ page }) => {

      await createBlok(page, { data: singleParagraph('Some text') });

      await openBlockSettings(page);

      const convertTo = page.locator(
        `${BLOCK_TUNES_POPOVER_SELECTOR} ${POPOVER_ITEM}[data-blok-item-name="convert-to"]`
      );

      await expect(convertTo).toBeVisible();
      await expect(convertTo).toHaveAttribute('aria-expanded', 'false');

      // dispatchEvent instead of hover(): the submenu overlaps its own trigger
      // and fails Playwright's actionability check.
      await convertTo.dispatchEvent('mouseover');

      const nested = page.locator(`${NESTED_POPOVER} ${POPOVER_CONTAINER}`);

      await expect(nested).toBeVisible();
      await expect(convertTo).toHaveAttribute('aria-expanded', 'true');
      await expect(nested.locator(VISIBLE_POPOVER_ITEM).first()).toBeVisible();
      await expectPopoverSettled(nested);

      await expectNoA11yViolations(page, {
        include: NESTED_POPOVER,
        label: 'convert-to submenu (block settings)',
      });
      await expectEveryControlIsNamed(page.locator(NESTED_POPOVER));
    });

    test('convert-to submenu opened from the inline toolbar', async ({ page }) => {

      await createBlok(page, { data: singleParagraph('Some text to convert') });

      await openInlineToolbar(page, 'Some text to convert');

      const convertTo = page.locator(
        `${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${POPOVER_ITEM}[data-blok-item-name="convert-to"]`
      );

      await expect(convertTo).toBeVisible();
      await convertTo.click();

      const nested = page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${NESTED_POPOVER} ${POPOVER_CONTAINER}`);

      await expect(nested).toBeVisible();
      await expect(convertTo).toHaveAttribute('aria-expanded', 'true');

      await expectNoA11yViolations(page, {
        include: `${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${NESTED_POPOVER}`,
        label: 'convert-to submenu (inline toolbar)',
      });
      await expectEveryControlIsNamed(page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${NESTED_POPOVER}`));
    });

    test('block color picker submenu', async ({ page }) => {

      await createBlok(page, { data: singleParagraph('Some text') });

      await openBlockSettings(page);

      const colorItem = page.locator(
        `${BLOCK_TUNES_POPOVER_SELECTOR} ${POPOVER_ITEM}[data-blok-item-name="block-color"]`
      );

      await expect(colorItem).toBeVisible();
      await colorItem.dispatchEvent('mouseover');

      const picker = page.locator(BLOCK_COLOR_PICKER);
      const nested = page.locator(`${BLOCK_TUNES_POPOVER_SELECTOR} ${NESTED_POPOVER} ${POPOVER_CONTAINER}`);

      await expect(picker).toBeVisible();
      await expect(picker.getByRole('button').first()).toBeVisible();
      await expectPopoverSettled(nested);

      await expectNoA11yViolations(page, {
        include: BLOCK_COLOR_PICKER,
        label: 'block color picker',
      });
      await expectEveryControlIsNamed(picker);
    });
  });

  test.describe('inline toolbar', () => {
    test('shown on a text selection with named, checkable tools', async ({ page }) => {

      await createBlok(page, { data: singleParagraph('Some text to select') });

      const toolbar = await openInlineToolbar(page, 'text to select');

      await expect(toolbar).toBeVisible();

      const bold = page.locator(
        `${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${POPOVER_ITEM}[data-blok-item-name="bold"]`
      );

      await expect(bold).toBeVisible();
      await expect(bold).toHaveAttribute('role', 'menuitemcheckbox');
      await expect(bold).toHaveAttribute('aria-checked', 'false');

      await bold.click();

      await expect(bold).toHaveAttribute('aria-checked', 'true');

      await expectNoA11yViolations(page, {
        include: INLINE_TOOLBAR_INTERFACE_SELECTOR,
        label: 'inline toolbar',
      });
      await expectEveryControlIsNamed(page.locator(INLINE_TOOLBAR_INTERFACE_SELECTOR));
    });

    test('link editing field opened from the link tool', async ({ page }) => {

      await createBlok(page, { data: singleParagraph('<a href="https://google.com">Edit this link</a>') });

      await openInlineToolbar(page, 'Edit this link');

      const linkButton = page.locator(
        `${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${POPOVER_ITEM}[data-blok-item-name="link"]`
      );

      await expect(linkButton).toBeVisible();
      await linkButton.click();

      const linkInput = page.locator(LINK_INPUT);

      await expect(linkInput).toBeVisible();
      await expect(linkInput).toHaveValue('https://google.com');
      // Opening an existing link renders the edit-only affordances, so the
      // scan covers the remove action and the title field too.
      await expect(page.getByTestId('inline-tool-title-input')).toBeVisible();
      await expect(page.getByTestId('inline-tool-remove-link')).toBeVisible();

      const field = page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${NESTED_POPOVER}`);

      await expectNoA11yViolations(page, {
        include: `${INLINE_TOOLBAR_INTERFACE_SELECTOR} ${NESTED_POPOVER}`,
        label: 'inline link field',
      });
      await expectEveryControlIsNamed(field);
    });
  });

  test.describe('tooltips', () => {
    test('toolbar tooltip is an accessible, violation-free role=tooltip', async ({ page }) => {
      await createBlok(page, { data: singleParagraph('Tooltip host') });

      await hoverOnlyBlock(page);

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await expect(plusButton).toBeVisible();
      await plusButton.hover();

      const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

      await expect(tooltip).toBeVisible();
      await expect(tooltip).toHaveAttribute('role', 'tooltip');
      await expect(tooltip).toHaveAttribute('aria-hidden', 'false');
      // The trigger must point at the tooltip, otherwise the description is
      // invisible to assistive tech even while it is painted on screen.
      await expect(plusButton).toHaveAttribute('aria-describedby', /.+/);

      await expectNoA11yViolations(page, {
        include: TOOLTIP_INTERFACE_SELECTOR,
        label: 'toolbar tooltip',
      });
      await expectEveryControlIsNamed(tooltip);
    });
  });
});

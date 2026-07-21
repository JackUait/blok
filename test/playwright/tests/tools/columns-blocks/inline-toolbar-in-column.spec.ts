import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import {
  createBlok,
  saveBlok,
  reloadFromSave,
  findBlock,
  childrenOf,
  ensureBlokBundleBuilt,
} from './_helpers';

/**
 * Inline toolbar (bold/italic, link) and convert-to behavior for text blocks
 * that live INSIDE a column. The exhaustive fixture suite only loads pre-built
 * OutputData; it never drives the live inline toolbar while a block is nested
 * in a column. These tests exercise that surface: the formatting must persist
 * AND the block must keep its column parent (no promotion to root, no layout
 * collapse) after the re-render that formatting / convert-to triggers.
 */

const INLINE_TOOLBAR_INTERFACE_SELECTOR = '[data-blok-interface=inline-toolbar]';
const INLINE_TOOLBAR_CONTAINER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-container"]`;
const INLINE_TOOL_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-item"]`;
const LINK_INPUT_SELECTOR = '[data-blok-testid="inline-tool-input"]';

/**
 * A 2-column layout. Left column holds one paragraph, right column holds one.
 * Stable ids so we can assert parentage precisely after re-render.
 */
const twoColumnLayout = (leftText: string, rightText: string): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['colA', 'colB'] },
    { id: 'colA', type: 'column', data: {}, parent: 'cl1', content: ['pA'] },
    { id: 'pA', type: 'paragraph', data: { text: leftText }, parent: 'colA' },
    { id: 'colB', type: 'column', data: {}, parent: 'cl1', content: ['pB'] },
    { id: 'pB', type: 'paragraph', data: { text: rightText }, parent: 'colB' },
  ],
});

/**
 * Locate the editable content element of the block with the given id.
 * Resolves via the saved tree's holder, addressing the on-page block by its
 * rendered data-blok content node inside the column.
 */
const contentOfBlock = (page: Page, text: string): Locator => {
  const wrapper = page.getByTestId('block-wrapper').filter({ hasText: text }).last();

  return wrapper.locator('[data-blok-element-content]').first();
};

/**
 * Select a substring inside a contenteditable content element by text match.
 */
const selectSubstring = async (locator: Locator, substring: string): Promise<void> => {
  await locator.scrollIntoViewIfNeeded();
  await locator.focus();

  await locator.evaluate((element, target) => {
    const ownerDocument = element.ownerDocument;
    const selection = ownerDocument?.getSelection();

    if (!ownerDocument || !selection) {
      return;
    }

    const textNodes: Text[] = [];
    const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();

    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }

    const full = textNodes.map((node) => node.textContent ?? '').join('');
    const startOffset = full.indexOf(target);

    if (startOffset < 0) {
      throw new Error(`Substring "${target}" not found in content`);
    }

    const endOffset = startOffset + target.length;

    const findPosition = (offset: number): { node: Text; nodeOffset: number } | null => {
      let accumulated = 0;

      for (const node of textNodes) {
        const length = node.textContent?.length ?? 0;

        if (offset >= accumulated && offset <= accumulated + length) {
          return { node, nodeOffset: offset - accumulated };
        }

        accumulated += length;
      }

      return null;
    };

    const start = findPosition(startOffset);
    const end = findPosition(endOffset);

    if (!start || !end) {
      return;
    }

    const range = ownerDocument.createRange();

    range.setStart(start.node, start.nodeOffset);
    range.setEnd(end.node, end.nodeOffset);

    selection.removeAllRanges();
    selection.addRange(range);

    ownerDocument.dispatchEvent(new Event('selectionchange'));
  }, substring);
};

test.describe('Inline toolbar + convert-to inside a column', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('Bold applied to a selection inside a column persists and the block keeps its column parent', async ({ page }) => {
    await createBlok(page, twoColumnLayout('Make this bold here', 'Right side'));

    const content = contentOfBlock(page, 'Make this bold here');

    await expect(content).toBeVisible();

    await selectSubstring(content, 'bold');

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toBeVisible();

    const boldButton = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="bold"]`);

    await expect(boldButton).toBeVisible();
    await boldButton.click();

    // Close toolbar / settle re-render.
    await page.keyboard.press('Escape');

    const saved = await saveBlok(page);
    const pA = findBlock(saved, 'pA');

    // Formatting persisted (editor normalizes <b> to <strong>).
    expect((pA?.data as { text?: string }).text).toContain('<strong>');
    expect((pA?.data as { text?: string }).text).toContain('bold');

    // The block did NOT migrate out of its column.
    expect(pA?.parent).toBe('colA');
    expect(childrenOf(saved, 'colA')).toEqual(['pA']);
    expect(childrenOf(saved, 'cl1')).toEqual(['colA', 'colB']);

    // Round-trips with the same nested structure.
    const reloaded = await reloadFromSave(page);
    const reloadedPA = findBlock(reloaded, 'pA');

    expect(reloadedPA?.parent).toBe('colA');
    expect((reloadedPA?.data as { text?: string }).text).toContain('<strong>');
  });

  test('Adding a link via the inline toolbar inside a column persists the anchor and keeps the column parent', async ({ page }) => {
    await createBlok(page, twoColumnLayout('Link this word now', 'Right side'));

    const content = contentOfBlock(page, 'Link this word now');

    await expect(content).toBeVisible();

    await selectSubstring(content, 'word');

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toBeVisible();

    const linkButton = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="link"]`);

    await expect(linkButton).toBeVisible();
    await linkButton.click();

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    // The link popover must actually open and be reachable inside the narrow column.
    await expect(linkInput).toBeVisible();
    await linkInput.fill('https://example.com');
    await linkInput.press('Enter');

    const saved = await saveBlok(page);
    const pA = findBlock(saved, 'pA');

    // Anchor persisted.
    expect((pA?.data as { text?: string }).text).toContain('<a href="https://example.com"');
    expect((pA?.data as { text?: string }).text).toContain('word');

    // Still parented to the column.
    expect(pA?.parent).toBe('colA');
    expect(childrenOf(saved, 'colA')).toEqual(['pA']);

    // Round-trips.
    const reloaded = await reloadFromSave(page);
    const reloadedPA = findBlock(reloaded, 'pA');

    expect(reloadedPA?.parent).toBe('colA');
    expect((reloadedPA?.data as { text?: string }).text).toContain('<a href="https://example.com"');
  });

  test('Convert-to (paragraph to header) via inline toolbar keeps the converted block inside the column', async ({ page }) => {
    await createBlok(page, twoColumnLayout('Heading content here', 'Right side'));

    const content = contentOfBlock(page, 'Heading content here');

    await expect(content).toBeVisible();

    await selectSubstring(content, 'Heading content here');

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toBeVisible();

    const convertToOption = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

    await expect(convertToOption).toBeVisible();
    await convertToOption.click();

    const headerOption = page.locator(
      `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-item-name="header-2"]`
    );

    await expect(headerOption).toBeVisible();
    await headerOption.click();

    const saved = await saveBlok(page);

    // Convert routes through replace(), which mints a NEW block id for the
    // converted block (the old `pA` id is gone). Resolve the converted block by
    // the column's sole child instead of by the now-stale id.
    const convertedChildren = childrenOf(saved, 'colA');

    expect(convertedChildren).toHaveLength(1);

    const convertedId = convertedChildren[0];
    const converted = findBlock(saved, convertedId);

    // Tool was converted in place...
    expect(converted?.type).toBe('header');
    expect((converted?.data as { text?: string }).text).toContain('Heading content here');

    // ...and the converted block is STILL inside the column, not promoted to root.
    expect(converted?.parent).toBe('colA');
    expect(childrenOf(saved, 'cl1')).toEqual(['colA', 'colB']);

    // The right column is untouched.
    expect(childrenOf(saved, 'colB')).toEqual(['pB']);

    // Round-trips with header still nested.
    const reloaded = await reloadFromSave(page);
    const reloadedConverted = findBlock(reloaded, convertedId);

    expect(reloadedConverted?.type).toBe('header');
    expect(reloadedConverted?.parent).toBe('colA');
  });
});

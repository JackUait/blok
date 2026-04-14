import type { Locator } from '@playwright/test';

/**
 * Programmatically select all contents of a contenteditable (or any) element
 * and dispatch a synchronous `selectionchange` event.
 *
 * Use this instead of `locator.click()` + `keyboard.press('Meta+a')`.
 *
 * Under webkit headless the click → focus → keyboard sequence is racy:
 * the keyboard shortcut can fire before the contenteditable owns focus,
 * leaving the selection collapsed. `InlineSelectionValidator.canShow()`
 * then rejects the empty selection and the inline toolbar never opens,
 * which surfaces as a `toBeVisible()` timeout far away from the real cause.
 *
 * The Range-based approach bypasses the focus race, skips the 180ms
 * `selectionchange` debounce by dispatching the event ourselves, and
 * mirrors the pattern already used by the stable inline-tool tests.
 * @param editable - Playwright locator pointing at the element whose contents should be selected.
 */
export const selectAllInEditable = async (editable: Locator): Promise<void> => {
  await editable.evaluate((el) => {
    const doc = el.ownerDocument;
    const range = doc.createRange();

    range.selectNodeContents(el);

    const selection = doc.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    doc.dispatchEvent(new Event('selectionchange'));
  });
};

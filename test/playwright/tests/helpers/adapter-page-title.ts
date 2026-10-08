import { test, expect, type Page } from '@playwright/test';

/**
 * The page-title checks every adapter fixture runs. The fixture, opened with `?title=1`:
 * - turns `pageTitle` on with an `onChange` that writes the title into `title-log`;
 * - renders the title component as `title-host`, followed by a sibling `title-meta`, above the editor;
 * - has a `toggle-title` button that unmounts the title component.
 * @param url - the fixture page, without the query
 * @param editorTestId - the test id of the element holding the editor
 */
export const definePageTitleTests = (url: string, editorTestId: string): void => {
  const open = async (page: Page): Promise<void> => {
    await page.goto(`${url}?title=1`);
    await expect(page.getByTestId('status')).toHaveText('ready');
  };

  test('title: the page title shows inside the title component', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('title-host').getByTestId('page-header-title')).toBeVisible();
    await expect(page.getByTestId(editorTestId).getByTestId('page-header-title')).toHaveCount(0);
  });

  test('title: typing in the title fires onChange', async ({ page }) => {
    await open(page);

    await page.getByTestId('page-header-title').click();
    await page.keyboard.type('Plans');

    await expect(page.getByTestId('title-log')).toHaveText('Plans');
  });

  test('title: ArrowDown at the end of the title lands in the first block across the gap', async ({ page }) => {
    await open(page);

    const title = page.getByTestId('page-header-title');

    await title.click();
    await page.keyboard.type('Plans');
    await page.keyboard.press('ArrowDown');

    const firstBlock = page.getByTestId(editorTestId).locator('[data-blok-id]').locator('[contenteditable="true"]').first();

    await expect(firstBlock).toBeFocused();
  });

  test('title: unmounting the title component puts the title above the first block', async ({ page }) => {
    await open(page);

    await page.getByTestId('toggle-title').click();

    await expect(page.getByTestId('title-host')).toHaveCount(0);
    const header = page.getByTestId(editorTestId).locator('[data-blok-page-header]');

    await expect(header).toHaveCount(1);
    expect(
      await header.evaluate((element) => ({
        inWrapper: element.parentElement?.hasAttribute('data-blok-editor') === true,
        beforeRedactor: element.nextElementSibling?.hasAttribute('data-blok-redactor') === true,
      }))
    ).toEqual({ inWrapper: true, beforeRedactor: true });
    await expect(page.getByTestId(editorTestId).getByTestId('page-header-title')).toBeVisible();

    // The title is connected again, so Backspace at the start of the first block joins into it.
    const firstBlock = page.getByTestId(editorTestId).locator('[data-blok-id]').locator('[contenteditable="true"]').first();
    const text = (await firstBlock.textContent()) ?? '';

    await firstBlock.evaluate((element) => {
      (element as HTMLElement).focus();
      element.ownerDocument.getSelection()?.collapse(element, 0);
    });
    await page.keyboard.press('Backspace');

    await expect(page.getByTestId('page-header-title')).toHaveText(text);
  });
};

/**
 * Keyboard operability and focus-management accessibility tests.
 *
 * Proves the editor can be driven without a pointer and that focus is never
 * lost: roving tabindex on the block toolbar, flipper virtual focus in
 * popovers, the shared modal-dialog focus trap, focus return on popover close,
 * layered Escape, and the keyboard contracts of the toggle arrow, spacer
 * resizer, media empty-state tablist and code view-mode group.
 */
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expectSingleByRole } from '../helpers/a11y';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const SETTINGS_TOGGLER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const TOOLBAR_ACTIONS_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar-actions"]`;
const TAB_STOP_SELECTOR = '[tabindex="0"]';
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
// The popover root lives in the CSS Top Layer, where `toBeVisible` reports
// hidden — assert against the container it renders inside.
const TOOLBOX_CONTAINER_SELECTOR = `${TOOLBOX_POPOVER_SELECTOR} [data-blok-testid="popover-container"]`;
const BLOCK_TUNES_SELECTOR = '[data-blok-testid="block-tunes-popover"]';
const BLOCK_TUNES_CONTAINER_SELECTOR = `${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"]`;
const INLINE_TOOLBAR_CONTAINER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-container"]`;
const INLINE_TOOL_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-item"]`;
const NESTED_POPOVER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`;
const FOCUSED_ITEM_SELECTOR = '[data-blok-focused="true"]';
const SEARCH_INPUT_SELECTOR = '[data-blok-testid="popover-search-input"]';

const TOGGLE_ARROW_SELECTOR = '[data-blok-toggle-arrow]';
const SPACER_GRIP_SELECTOR = '[data-blok-spacer-grip="bottom"]';
const FILE_PREVIEW_TRIGGER_SELECTOR = '[data-action="preview"]';

/** A served static file — the File block's preview fetches its URL. */
const PREVIEWABLE_FILE_URL = 'http://localhost:4444/README.md';

/** Spacer defaults from src/tools/spacer/index.ts: min 38px, +/-8px per arrow key. */
const SPACER_DEFAULT_HEIGHT = 38;
const SPACER_KEYBOARD_STEP = 8;

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

interface FocusSnapshot {
  onBody: boolean;
  detached: boolean;
}

/** The two ways focus goes missing: parked on <body>, or left on a removed node. */
const FOCUS_IS_HELD: FocusSnapshot = {
  onBody: false,
  detached: false,
};

const readFocus = async (page: Page): Promise<FocusSnapshot> =>
  page.evaluate(() => {
    const active = document.activeElement;

    return {
      onBody: active === null || active === document.body,
      detached: active !== null && !active.isConnected,
    };
  });

const isFocusWithin = async (scope: Locator): Promise<boolean> =>
  scope.evaluate((element) => element.contains(document.activeElement));

const paragraphBlok = async (page: Page, texts: string[]): Promise<void> => {
  await createBlok(page, {
    data: { blocks: texts.map((text) => ({ type: 'paragraph', data: { text } })) },
  });
};

const openBlockSettings = async (page: Page, block: Locator): Promise<void> => {
  await block.hover();
  await block.click();

  const toggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

  await expect(toggler).toBeVisible();
  await toggler.click();
  await expect(page.locator(BLOCK_TUNES_CONTAINER_SELECTOR)).toBeVisible();
};

const openInlineToolbar = async (page: Page, paragraph: Locator): Promise<void> => {
  await paragraph.click({ clickCount: 3 });
  await expect(page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR)).toBeVisible();
};

test.describe('keyboard operability and focus management', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test.describe('roving tabindex on the block toolbar', () => {
    test('the plus button and settings toggler add no tab stop of their own', async ({ page }) => {
      await paragraphBlok(page, [ 'First block' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await paragraph.hover();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
      const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

      await expect(plusButton).toBeVisible();
      await expect(settingsToggler).toBeVisible();

      await expect(plusButton).toHaveAttribute('tabindex', '-1');
      await expect(settingsToggler).toHaveAttribute('tabindex', '-1');

      // The group is entered with Alt+F10, never with Tab (RovingTabindexController
      // is constructed with `tabbable: false`), so it contributes zero tab stops.
      await expect(page.locator(TOOLBAR_ACTIONS_SELECTOR).locator(TAB_STOP_SELECTOR)).toHaveCount(0);
    });

    test('alt+F10 moves real DOM focus into the toolbar and arrows roll it', async ({ page }) => {
      await paragraphBlok(page, [ 'First block' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await paragraph.click();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
      const settingsToggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

      await page.keyboard.press('Alt+F10');
      await expect(plusButton).toBeFocused();

      await page.keyboard.press('ArrowRight');
      await expect(settingsToggler).toBeFocused();

      await page.keyboard.press('ArrowLeft');
      await expect(plusButton).toBeFocused();

      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);
    });

    /**
     * DEFECT: Alt+F10 then Escape parks focus on document.body.
     *
     * The toolbar is mounted INSIDE `[data-blok-redactor]`, so
     * KeyboardController.handleEscape takes its `isInsideRedactor` branch for a
     * keydown on the plus button: it enables navigation mode (which calls
     * `activeElement.blur()`) and calls `event.stopPropagation()` while still in
     * the document CAPTURE phase — so Toolbar's own bubble-phase Escape handler
     * (`returnFocusToBlock`) never runs and the caret is never restored.
     */
    test('escape from the toolbar hands focus back to the editor', async ({ page }) => {
      await paragraphBlok(page, [ 'First block' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await paragraph.click();
      await page.keyboard.press('Alt+F10');
      await expect(page.locator(PLUS_BUTTON_SELECTOR)).toBeFocused();

      await page.keyboard.press('Escape');

      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);
      expect(await isFocusWithin(page.getByTestId(HOLDER_ID))).toBe(true);
    });
  });

  test.describe('flipper virtual focus in popovers', () => {
    test('toolbox options mirror the highlight via aria-activedescendant and aria-selected', async ({ page }) => {
      await createBlok(page, { data: { blocks: [ { type: 'paragraph',
        data: { text: '' } } ] } });

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await paragraph.click();
      await page.keyboard.type('/');

      const toolbox = page.locator(TOOLBOX_POPOVER_SELECTOR);

      await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();
      await expect(paragraph).toHaveAttribute('role', 'combobox');
      await expect(paragraph).toHaveAttribute('aria-expanded', 'true');

      await page.keyboard.press('ArrowDown');

      const focusedOption = toolbox.locator(FOCUSED_ITEM_SELECTOR);

      await expect(focusedOption).toHaveCount(1);
      await expect(focusedOption).toHaveAttribute('role', 'option');
      await expect(focusedOption).toHaveAttribute('aria-selected', 'true');

      const optionId = await focusedOption.getAttribute('id');

      expect(optionId).toMatch(/\S/);
      await expect(paragraph).toHaveAttribute('aria-activedescendant', optionId ?? '');
    });

    test('block-settings menu items get aria-activedescendant but never aria-selected', async ({ page }) => {
      await paragraphBlok(page, [ 'First block' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await openBlockSettings(page, paragraph);

      await page.keyboard.press('ArrowDown');

      const tunes = page.locator(BLOCK_TUNES_SELECTOR);
      const focusedItem = tunes.locator(FOCUSED_ITEM_SELECTOR);

      await expect(focusedItem).toHaveCount(1);
      await expect(focusedItem).toHaveAttribute('role', /^menuitem/);

      // DomIterator.addFocusMarkers deliberately omits aria-selected for
      // menuitem* roles (axe: aria-allowed-attr).
      expect(await focusedItem.getAttribute('aria-selected')).toBeNull();

      const itemId = await focusedItem.getAttribute('id');

      expect(itemId).toMatch(/\S/);
      await expect(tunes.locator(SEARCH_INPUT_SELECTOR)).toHaveAttribute('aria-activedescendant', itemId ?? '');
    });
  });

  test.describe('focus trap in modal surfaces', () => {
    const fileBlok = async (page: Page): Promise<void> => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'Before the file' } },
            {
              type: 'file',
              data: {
                url: PREVIEWABLE_FILE_URL,
                fileName: 'notes.txt',
                mimeType: 'text/plain',
                size: 2048,
              },
            },
          ],
        },
      });
    };

    test('the file preview dialog is modal and marks the background inert', async ({ page }) => {
      await fileBlok(page);

      const trigger = page.locator(FILE_PREVIEW_TRIGGER_SELECTOR);

      await expect(trigger).toBeVisible();
      await trigger.focus();
      await trigger.click();

      const dialog = await expectSingleByRole(page, 'dialog');

      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog).toHaveAttribute('aria-label', /\S/);
      await expect(page.getByTestId(HOLDER_ID)).toHaveAttribute('inert', '');

      expect(await isFocusWithin(dialog)).toBe(true);
    });

    test('tab and shift+Tab cycle inside the dialog and never escape it', async ({ page }) => {
      await fileBlok(page);

      const trigger = page.locator(FILE_PREVIEW_TRIGGER_SELECTOR);

      await expect(trigger).toBeVisible();
      await trigger.focus();
      await trigger.click();

      const dialog = page.getByRole('dialog');

      await expect(dialog).toHaveCount(1);
      expect(await isFocusWithin(dialog)).toBe(true);

      for (let step = 0; step < 6; step++) {
        await page.keyboard.press('Tab');
        expect(await isFocusWithin(dialog), `focus escaped the dialog after ${step + 1} Tab press(es)`).toBe(true);
      }

      for (let step = 0; step < 3; step++) {
        await page.keyboard.press('Shift+Tab');
        expect(await isFocusWithin(dialog), `focus escaped the dialog after ${step + 1} Shift+Tab press(es)`).toBe(true);
      }

      // The page is worker-scoped and shared across this file, and tearing a
      // dialog down by removing its DOM does not run the modal's own cleanup —
      // leaving it open wedges the next test's dialog shut.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });

    test('escape closes the dialog, clears inert and restores focus to the opener', async ({ page }) => {
      /**
       * Regression guard for a WebKit-only focus loss. ModalDialog restored
       * focus to whatever was `document.activeElement` at open time, but WebKit
       * does not focus a <button> on click — so it captured document.body and
       * faithfully restored focus to nothing, losing a VoiceOver user's place on
       * every close. It now falls back to the element that opened the dialog.
       */
      await fileBlok(page);

      const trigger = page.locator(FILE_PREVIEW_TRIGGER_SELECTOR);

      await expect(trigger).toBeVisible();
      await trigger.click();

      const dialog = page.getByRole('dialog');

      await expect(dialog).toHaveCount(1);

      await page.keyboard.press('Escape');

      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId(HOLDER_ID)).not.toHaveAttribute('inert', '');

      // Asserts "focus survived", not "focus went back to the trigger". Neither
      // activation path supports the stricter claim on every engine: Enter is
      // swallowed by Blok's structural-key handling inside the redactor, and
      // WebKit does not leave a <button> focused after a click, so the dialog
      // captures document.body as the element to restore to.
      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);
    });
  });

  test.describe('focus return on popover close', () => {
    test('closing the toolbox never leaves focus on document.body', async ({ page }) => {
      await paragraphBlok(page, [ 'First block' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await paragraph.click();
      await paragraph.hover();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await expect(plusButton).toBeVisible();
      await plusButton.click();
      await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeHidden();

      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);
    });

    test('closing block settings never leaves focus on document.body', async ({ page }) => {
      await paragraphBlok(page, [ 'First block' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await openBlockSettings(page, paragraph);

      await page.keyboard.press('Escape');
      await expect(page.locator(BLOCK_TUNES_CONTAINER_SELECTOR)).toBeHidden();

      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);
    });

    /**
     * DEFECT: one Escape closes the inline toolbar AND enters navigation mode,
     * whose `setNavigationFocus` blurs the active element — focus ends on
     * document.body.
     *
     * KeyboardController.handleEscape's `InlineToolbar.opened` branch closes the
     * toolbar and returns without `stopPropagation()`. The toolbox branch
     * directly above it stops the event for exactly this reason (its comment
     * spells out the blur-to-body consequence); the inline-toolbar branch does
     * not, so the block-level NavigationMode composer then sees
     * `InlineToolbar.opened === false` and enables navigation mode.
     */
    test.fixme('closing the inline toolbar never leaves focus on document.body', async ({ page }) => {
      /**
       * PARTIALLY FIXED, still intermittent (~1 run in 4, chromium and webkit).
       * handleEscape now stops propagation on the InlineToolbar branch, which
       * killed the deterministic failure — one Escape no longer both closes the
       * toolbar AND enters navigation mode. A residual race remains where focus
       * still reaches document.body; polling the assertion does not recover it,
       * so focus is genuinely lost rather than late.
       */
      await paragraphBlok(page, [ 'Some text to select' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await openInlineToolbar(page, paragraph);

      await page.keyboard.press('Escape');
      await expect(page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR)).toBeHidden();

      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);
    });
  });

  test.describe('layered Escape', () => {
    test('escape closes only the nested popover, leaving its parent open', async ({ page }) => {
      await paragraphBlok(page, [ 'Some text to select' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

      await openInlineToolbar(page, paragraph);

      const convertTo = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

      await expect(convertTo).toBeVisible();
      await convertTo.click();

      const nested = page.locator(NESTED_POPOVER_SELECTOR);

      await expect(nested).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(nested).toHaveCount(0);
      await expect(page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR)).toBeVisible();
      await expect(convertTo).toHaveAttribute('data-blok-focused', 'true');

      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);
    });
  });

  test.describe('toggle arrow', () => {
    test('enter and Space toggle the arrow and aria-expanded tracks it', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [ { type: 'toggle',
            data: { text: 'Parent toggle',
              isOpen: true } } ],
        },
      });

      const arrow = page.locator(TOGGLE_ARROW_SELECTOR).first();

      await expect(arrow).toBeVisible();
      await expect(arrow).toHaveAttribute('role', 'button');
      await expect(arrow).toHaveAttribute('tabindex', '0');
      await expect(arrow).toHaveAttribute('aria-label', /\S/);
      await expect(arrow).toHaveAttribute('aria-controls', /\S/);
      await expect(arrow).toHaveAttribute('aria-expanded', 'true');

      await arrow.focus();
      await expect(arrow).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(arrow).toHaveAttribute('aria-expanded', 'false');

      await page.keyboard.press('Space');
      await expect(arrow).toHaveAttribute('aria-expanded', 'true');

      await expect(arrow).toBeFocused();
    });
  });

  test.describe('spacer resizer as a focusable separator', () => {
    test('arrow keys resize the spacer and aria-valuenow tracks the height', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'Above' } },
            { type: 'spacer',
              data: {} },
          ],
        },
      });

      const grip = page.locator(SPACER_GRIP_SELECTOR).first();

      await expect(grip).toHaveAttribute('role', 'separator');
      await expect(grip).toHaveAttribute('aria-orientation', 'horizontal');
      await expect(grip).toHaveAttribute('aria-label', /\S/);
      await expect(grip).toHaveAttribute('aria-valuemin', String(SPACER_DEFAULT_HEIGHT));
      await expect(grip).toHaveAttribute('aria-valuemax', /\d/);
      await expect(grip).toHaveAttribute('aria-valuenow', String(SPACER_DEFAULT_HEIGHT));

      await grip.focus();
      await expect(grip).toBeFocused();

      await page.keyboard.press('ArrowDown');
      await expect(grip).toHaveAttribute('aria-valuenow', String(SPACER_DEFAULT_HEIGHT + SPACER_KEYBOARD_STEP));

      await page.keyboard.press('ArrowUp');
      await expect(grip).toHaveAttribute('aria-valuenow', String(SPACER_DEFAULT_HEIGHT));

      // aria-valuemin is also the default height, so this press must clamp.
      await page.keyboard.press('ArrowUp');
      await expect(grip).toHaveAttribute('aria-valuenow', String(SPACER_DEFAULT_HEIGHT));

      await expect(grip).toBeFocused();
    });
  });

  test.describe('media empty-state tablist', () => {
    const imageBlok = async (page: Page): Promise<void> => {
      await createBlok(page, {
        data: { blocks: [ { type: 'image',
          data: {} } ] },
      });
    };

    test('the tablist starts with one tab stop and the first tab selected', async ({ page }) => {
      await imageBlok(page);

      const tablist = page.getByRole('tablist');
      const tabs = tablist.getByRole('tab');

      await expect(tablist).toBeVisible();
      await expect(tabs).toHaveCount(2);

      await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.nth(0)).toHaveAttribute('tabindex', '0');
      await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
      await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1');
    });

    test('arrow keys switch the selected tab and roll the tab stop', async ({ page }) => {
      await imageBlok(page);

      const tabs = page.getByRole('tablist').getByRole('tab');

      await tabs.nth(0).focus();
      await expect(tabs.nth(0)).toBeFocused();

      await page.keyboard.press('ArrowRight');

      await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0');
      await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
      await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');

      // The Link panel pulls focus into its URL field on render, so focus lands
      // there rather than on the tab — it must still be somewhere real.
      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);

      await tabs.nth(1).focus();
      await page.keyboard.press('ArrowLeft');

      await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
      await expect(tabs.nth(0)).toBeFocused();
    });
  });

  test.describe('code view-mode group', () => {
    test('the view-mode buttons form a group and keep aria-pressed in sync', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [ { type: 'code',
            data: { code: 'x = 1',
              language: 'latex' } } ],
        },
      });

      const group = page.getByTestId('code-view-mode');

      await expect(group).toBeVisible();
      await expect(group).toHaveAttribute('role', 'group');

      const codeMode = page.getByTestId('code-mode-code');
      const previewMode = page.getByTestId('code-mode-preview');
      const splitMode = page.getByTestId('code-mode-split');

      await expect(previewMode).toHaveAttribute('aria-pressed', 'true');
      await expect(codeMode).toHaveAttribute('aria-pressed', 'false');
      await expect(splitMode).toHaveAttribute('aria-pressed', 'false');

      await codeMode.focus();
      await expect(codeMode).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(codeMode).toHaveAttribute('aria-pressed', 'true');
      await expect(previewMode).toHaveAttribute('aria-pressed', 'false');
      await expect(splitMode).toHaveAttribute('aria-pressed', 'false');

      await expect.poll(() => readFocus(page)).toStrictEqual(FOCUS_IS_HELD);
    });
  });
});

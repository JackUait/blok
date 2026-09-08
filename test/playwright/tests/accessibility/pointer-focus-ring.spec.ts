import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

/**
 * The Focus-Visible Law, measured at runtime.
 *
 * `test/unit/architecture/focus-visible-law.test.ts` proves no stylesheet
 * SPELLS a pointer-driven focus indicator. It cannot prove none APPEARS:
 * Chromium matches `:focus-visible` on an element that JavaScript focused,
 * even when the gesture that ran that JavaScript was a click. So the ring is
 * painted by a correct `:focus-visible` rule reacting to an incorrect
 * `.focus()` call, and only a real browser can see it.
 *
 * Every test here drives the editor with the MOUSE ONLY and then asserts the
 * page carries no focus affordance at all — neither the browser's
 * `:focus-visible`, nor Blok's own `data-blok-focused` popover cursor.
 *
 * Text-entry fields are the one exception the law allows, so the probe skips
 * them: a search field must look active however the user reached it.
 */

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_ITEM_SELECTOR = '[data-blok-testid="popover-item"]';
const TUNES_POPOVER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';
const CONVERT_TO_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]';
const INLINE_TOOLBAR_SELECTOR = '[data-blok-testid="inline-toolbar"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

test.beforeAll(ensureBlokBundleBuilt);

/**
 * What the page currently shows as a focus affordance.
 */
interface FocusAffordanceReport {
  /** Non-text elements matching `:focus-visible` that actually paint a ring. */
  painted: string[];
  /** Elements carrying Blok's own popover focus cursor. */
  cursors: string[];
}

/**
 * Reads every focus affordance a sighted mouse user would actually see.
 *
 * Matching `:focus-visible` is not on its own a violation — Blok suppresses the
 * ring for a pointer gesture in `preflight.css` while the element still matches.
 * What counts is PAINT, and it arrives two ways: the UA outline, and a
 * Tailwind `focus-visible:ring-*` utility, which is a box-shadow and cannot be
 * told apart from a decorative shadow by computed style alone. So the outline
 * is measured and the ring utilities are read off the class list.
 * @param page - the page under test
 * @returns the affordances visible right now
 */
const readFocusAffordances = async (page: Page): Promise<FocusAffordanceReport> => {
  return page.evaluate(() => {
    const TEXT_ENTRY = 'input, textarea, [contenteditable]';

    /**
     * Names an element precisely enough to find it in the source.
     * @param element - element to describe
     * @returns tag plus the Blok attributes that identify it
     */
    const describe = (element: Element): string => {
      const attributes = Array.from(element.attributes)
        .filter(attribute => attribute.name.startsWith('data-blok') || attribute.name === 'aria-label')
        .map(attribute => `${attribute.name}="${attribute.value}"`)
        .join(' ');

      return `<${element.tagName.toLowerCase()} ${attributes}>`.replace(/\s+>/, '>');
    };

    /**
     * Whether the browser is drawing an outline on this element right now.
     * @param element - element to inspect
     * @returns true when the outline is visible
     */
    const paintsOutline = (element: Element): boolean => {
      const style = getComputedStyle(element);

      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    };

    /**
     * Whether the element carries a focus-visible ring utility, which renders
     * as a box-shadow the moment the pseudo-class matches.
     * @param element - element to inspect
     * @returns true when a ring utility is present
     */
    const carriesRingUtility = (element: Element): boolean =>
      /focus-visible:(ring|border|shadow|outline)-/.test(element.className.toString());

    const painted = Array.from(document.querySelectorAll(':focus-visible'))
      .filter(element => !element.matches(TEXT_ENTRY))
      .filter(element => paintsOutline(element) || carriesRingUtility(element))
      .map(describe);

    const cursors = Array.from(document.querySelectorAll('[data-blok-focused="true"]')).map(describe);

    return {
      painted,
      cursors,
    };
  });
};

/**
 * Asserts the page shows no keyboard focus affordance.
 * @param page - the page under test
 * @param gesture - the mouse gesture just performed, quoted on failure
 */
const expectNoFocusAffordance = async (page: Page, gesture: string): Promise<void> => {
  const report = await readFocusAffordances(page);

  expect(report, `mouse gesture "${gesture}" left a keyboard focus affordance`).toEqual({
    painted: [],
    cursors: [],
  });
};

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
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: { text: 'Hello world' },
          },
          {
            type: 'paragraph',
            data: { text: '' },
          },
        ],
      } satisfies OutputData,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

/**
 * Hovers the first block so the toolbar (+ and ☰) mounts next to it.
 * @param page - the page under test
 */
const revealToolbar = async (page: Page): Promise<void> => {
  const block = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' });

  await block.hover();
  await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeVisible();
};

/**
 * Drags across the first paragraph so the inline toolbar opens from a pointer
 * gesture — the modality the law is about.
 * @param page - the page under test
 */
const selectParagraphWithMouse = async (page: Page): Promise<void> => {
  const paragraph = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' })
    .locator('[contenteditable]')
    .first();

  await paragraph.click();

  const box = await paragraph.boundingBox();

  if (box === null) {
    throw new Error('paragraph has no layout box');
  }

  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
};

/*
 * Every assertion in this file runs inside `expectNoFocusAffordance`, which the
 * playwright/expect-expect rule cannot see through.
 */
/* eslint-disable playwright/expect-expect */
test.describe('Focus-Visible Law — a mouse gesture never paints a focus affordance', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await createBlok(page);
  });

  test('clicking a block leaves no ring', async ({ page }) => {
    await page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' })
      .click();

    await expectNoFocusAffordance(page, 'click a paragraph');
  });

  test('opening the toolbox with the + button leaves no ring or cursor', async ({ page }) => {
    await revealToolbar(page);
    await page.locator(PLUS_BUTTON_SELECTOR).click();

    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
    await expectNoFocusAffordance(page, 'click the + button');
  });

  test('clicking a toolbox item leaves no ring or cursor', async ({ page }) => {
    await revealToolbar(page);
    await page.locator(PLUS_BUTTON_SELECTOR).click();
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

    await page.locator(`${TOOLBOX_POPOVER_SELECTOR} ${POPOVER_ITEM_SELECTOR}`).first()
      .click();
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeHidden();

    await expectNoFocusAffordance(page, 'click a toolbox item');
  });

  test('opening block settings with the toggler leaves no ring or cursor', async ({ page }) => {
    await revealToolbar(page);
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();

    await expect(page.locator(TUNES_POPOVER_SELECTOR)).toBeVisible();
    await expectNoFocusAffordance(page, 'click the block settings toggler');
  });

  test('opening a submenu by click leaves no ring or cursor', async ({ page }) => {
    await revealToolbar(page);
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();
    await expect(page.locator(TUNES_POPOVER_SELECTOR)).toBeVisible();

    await page.locator(CONVERT_TO_SELECTOR).click();
    await expect(page.locator('[data-blok-nested="true"] [data-blok-testid="popover-container"]')).toBeVisible();

    await expectNoFocusAffordance(page, 'click the Convert to item');
  });

  test('closing a menu by clicking outside leaves no ring or cursor', async ({ page }) => {
    await revealToolbar(page);
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();
    await expect(page.locator(TUNES_POPOVER_SELECTOR)).toBeVisible();

    await page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' })
      .click();
    await expect(page.locator(TUNES_POPOVER_SELECTOR)).toBeHidden();

    await expectNoFocusAffordance(page, 'click outside to dismiss block settings');
  });

  test('clicking a block tune leaves no ring or cursor', async ({ page }) => {
    await revealToolbar(page);
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();
    await expect(page.locator(TUNES_POPOVER_SELECTOR)).toBeVisible();

    const tune = page.locator(`${TUNES_POPOVER_SELECTOR} ${POPOVER_ITEM_SELECTOR}`)
      .filter({ hasNotText: 'Convert' })
      .first();

    await tune.click();

    await expectNoFocusAffordance(page, 'click a block tune');
  });

  test('selecting text with the mouse and clicking an inline tool leaves no ring', async ({ page }) => {
    const paragraph = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' })
      .locator('[contenteditable]')
      .first();

    await paragraph.click();
    await page.keyboard.up('Shift');

    const box = await paragraph.boundingBox();

    if (box === null) {
      throw new Error('paragraph has no layout box');
    }

    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    const inlineToolbar = page.locator('[data-blok-testid="inline-toolbar"]');

    await expect(inlineToolbar).toBeVisible();
    await expectNoFocusAffordance(page, 'select text with the mouse');

    await inlineToolbar.locator(POPOVER_ITEM_SELECTOR).first()
      .click();

    await expectNoFocusAffordance(page, 'click an inline tool');
  });

  test('closing an inline submenu by clicking another tool leaves no cursor on the trigger', async ({ page }) => {
    await selectParagraphWithMouse(page);

    const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);

    await expect(inlineToolbar).toBeVisible();

    await inlineToolbar.locator(`${POPOVER_ITEM_SELECTOR}[data-blok-item-name="convert-to"]`).click();
    await expect(page.locator(NESTED_POPOVER_SELECTOR)).toBeVisible();

    await inlineToolbar.locator(`${POPOVER_ITEM_SELECTOR}[data-blok-item-name="bold"]`).click();

    await expectNoFocusAffordance(page, 'click Bold while the Convert to submenu is open');
  });

  test('toggling an inline submenu shut with a second click leaves no cursor on the trigger', async ({ page }) => {
    await selectParagraphWithMouse(page);

    const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);

    await expect(inlineToolbar).toBeVisible();

    const convertTo = inlineToolbar.locator(`${POPOVER_ITEM_SELECTOR}[data-blok-item-name="convert-to"]`);

    await convertTo.click();
    await expect(page.locator(NESTED_POPOVER_SELECTOR)).toBeVisible();

    await convertTo.click();
    await expect(page.locator(NESTED_POPOVER_SELECTOR)).toBeHidden();

    await expectNoFocusAffordance(page, 'click the Convert to trigger a second time to close it');
  });

  /**
   * The colour picker is the case that only reproduces after a keystroke:
   * typing sets Blink's document-level focus-visible flag, and the picker's
   * tabs `preventDefault` their mousedown to keep the caret, so the click never
   * moves focus and never clears the flag. The next programmatic `.focus()`
   * then paints a real keyboard ring from a pure mouse click.
   */
  test('clicking a colour-picker tab after typing leaves no ring', async ({ page }) => {
    const paragraph = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Hello world' })
      .locator('[contenteditable]')
      .first();

    await paragraph.click();
    await page.keyboard.type(' typed');

    await revealToolbar(page);
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();
    await expect(page.locator(TUNES_POPOVER_SELECTOR)).toBeVisible();

    await page.locator(`${POPOVER_ITEM_SELECTOR}[data-blok-item-name="block-color"]`).click();

    const picker = page.locator('[data-blok-testid="block-color-picker"]');

    await expect(picker).toBeVisible();

    // One legal keyboard gesture inside the picker — this is what arms the flag.
    await page.keyboard.press('ArrowRight');

    const tabs = picker.getByRole('tab');

    await tabs.first().click();

    await expectNoFocusAffordance(page, 'click a colour-picker tab after typing and one arrow key');
  });
});

// test/playwright/tests/host-customization-tokens.spec.ts

import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';
import { expect, gotoTestPage, test } from './helpers/shared-page';

/**
 * Runtime regression net for the host `--blok-*` theming hooks against the
 * BUILT production bundle (not source-grepping unit tests, which cannot see
 * how lightningcss/Tailwind's production layer flattening changes cascade
 * outcomes). Two contracts were found broken by live CSSOM inspection of the
 * built stylesheet even though every unit test passed:
 *
 *   1. Heading tokens (--blok-heading-*) were declared at (0,0,0) via a
 *      blanket `:where(...)` wrapper. Production Tailwind utilities compile
 *      unlayered and scoped at (0,1,0) (`@layer utilities` only exists in
 *      dev), so they beat the heading rule in the built bundle — the tokens
 *      were completely inert in production.
 *   2. The read-only gutter collapse rule was a `:where(...)`-wrapped
 *      `padding-inline: 0` override at (0,1,0). lightningcss lowers the base
 *      gutter rule's `padding-inline-start` into a `:lang()`-guarded physical
 *      rule at (0,2,0) in production, so the collapse rule lost and the
 *      read-only editor kept its gutter.
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

interface CreateOptions {
  data?: OutputData;
  readOnly?: boolean;
  containerStyle?: Record<string, string>;
  styleTokens?: Record<string, string>;
  hideToolbar?: boolean;
  placeholder?: string;
}

const createBlok = async (page: Page, options: CreateOptions = {}): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  if (options.containerStyle) {
    await page.evaluate(({ holder, style }) => {
      const container = document.getElementById(holder);

      if (container) {
        for (const [prop, value] of Object.entries(style)) {
          container.style.setProperty(prop, value);
        }
      }
    }, { holder: HOLDER_ID, style: options.containerStyle });
  }

  await page.evaluate(
    async ({ holder, initialData, readOnly, styleTokens, hideToolbar, placeholder }) => {
      const blok = new window.Blok({
        holder,
        ...(initialData ? { data: initialData } : {}),
        ...(readOnly !== undefined ? { readOnly } : {}),
        ...(styleTokens ? { style: { tokens: styleTokens } } : {}),
        ...(hideToolbar !== undefined ? { hideToolbar } : {}),
        ...(placeholder !== undefined ? { placeholder } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: options.data ?? null, readOnly: options.readOnly, styleTokens: options.styleTokens, hideToolbar: options.hideToolbar, placeholder: options.placeholder }
  );
};

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test('--blok-heading-1-font-size overrides the h1 computed font-size in production', async ({ page }) => {
  await createBlok(page, {
    containerStyle: { '--blok-heading-1-font-size': '40px' },
    data: { blocks: [{ type: 'header', data: { text: 'Big heading', level: 1 } }] },
  });

  const header = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="header"][data-blok-heading-level="1"]`);

  await expect(header).toBeVisible();
  await expect(header).toHaveCSS('font-size', '40px');
});

test('--blok-heading-font-weight overrides heading computed font-weight in production', async ({ page }) => {
  await createBlok(page, {
    containerStyle: { '--blok-heading-font-weight': '300' },
    data: { blocks: [{ type: 'header', data: { text: 'Light heading', level: 2 } }] },
  });

  const header = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="header"][data-blok-heading-level="2"]`);

  await expect(header).toBeVisible();
  await expect(header).toHaveCSS('font-weight', '300');
});

test('--blok-heading-line-height overrides heading computed line-height in production', async ({ page }) => {
  await createBlok(page, {
    containerStyle: { '--blok-heading-line-height': '2' },
    data: { blocks: [{ type: 'header', data: { text: 'Tall heading', level: 3 } }] },
  });

  const header = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="header"][data-blok-heading-level="3"]`);

  await expect(header).toBeVisible();

  const { fontSize, lineHeight } = await header.evaluate((el) => {
    const style = getComputedStyle(el);

    return { fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight) };
  });

  expect(lineHeight).toBeCloseTo(fontSize * 2, 0);
});

test('default heading typography is unchanged: h1 font-size 30px, line-height 39px, margin-top 32px', async ({ page }) => {
  await createBlok(page, {
    data: { blocks: [{ type: 'header', data: { text: 'Default heading', level: 1 } }] },
  });

  const header = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="header"][data-blok-heading-level="1"]`);

  await expect(header).toBeVisible();
  await expect(header).toHaveCSS('font-size', '30px');
  await expect(header).toHaveCSS('line-height', '39px');
  await expect(header).toHaveCSS('margin-top', '32px');
});

test('read-only gutter collapses in production and restores when toggled back to editable', async ({ page }) => {
  await createBlok(page, {
    containerStyle: { '--blok-editor-gutter-start': '56px' },
    readOnly: true,
    data: { blocks: [{ type: 'paragraph', data: { text: 'Read only content' } }] },
  });

  const redactor = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-redactor]`);

  await expect(redactor).toBeVisible();
  await expect(redactor).toHaveCSS('padding-inline-start', '0px');

  await page.evaluate(async () => {
    const blok = window.blokInstance ?? (() => {
      throw new Error('Blok instance not found');
    })();

    await blok.readOnly.toggle(false);
  });

  await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === false);

  await expect(redactor).toHaveCSS('padding-inline-start', '56px');
});

test('--blok-embed-margin-top overrides embed computed margin-top in production', async ({ page }) => {
  await createBlok(page, {
    containerStyle: { '--blok-embed-margin-top': '32px' },
    data: {
      blocks: [
        {
          type: 'embed',
          data: {
            service: 'codepen',
            source: 'https://codepen.io/team/pen/abc123',
            embed: 'https://codepen.io/abc123?default-tab=result',
          },
        },
      ],
    },
  });

  const embed = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="embed"]`);

  await expect(embed).toBeVisible();
  await expect(embed).toHaveCSS('margin-top', '32px');
});

test('a single plain-selector palette override wins in production', async ({ page }) => {
  await createBlok(page);

  await page.evaluate(() => {
    const style = document.createElement('style');

    style.textContent = '[data-blok-interface] { --blok-selection: rgb(9, 99, 9); }';
    document.head.appendChild(style);
  });

  const wrapper = page.locator(BLOK_INTERFACE_SELECTOR);

  await expect(wrapper).toBeVisible();

  const value = await wrapper.evaluate((el) => getComputedStyle(el).getPropertyValue('--blok-selection').trim());

  expect(value).toBe('rgb(9, 99, 9)');
});

test('checklist padding token separates checklist indent from list indent', async ({ page }) => {
  await createBlok(page, {
    containerStyle: {
      '--blok-list-padding-start': '18px',
      '--blok-checklist-padding-start': '0px',
    },
    data: {
      blocks: [
        { type: 'list', data: { text: 'Bulleted item', style: 'unordered' } },
        { type: 'list', data: { text: 'Checklist item', style: 'checklist' } },
      ],
    },
  });

  const unordered = page.locator('[data-list-style="unordered"]').first();
  const checklist = page.locator('[data-list-style="checklist"]').first();

  await expect(unordered).toBeVisible();
  await expect(checklist).toBeVisible();
  await expect(unordered).toHaveCSS('padding-inline-start', '18px');
  await expect(checklist).toHaveCSS('padding-inline-start', '0px');
});

test('checklist follows --blok-list-padding-start when no checklist token is set', async ({ page }) => {
  await createBlok(page, {
    containerStyle: { '--blok-list-padding-start': '18px' },
    data: {
      blocks: [{ type: 'list', data: { text: 'Checklist item', style: 'checklist' } }],
    },
  });

  const checklist = page.locator('[data-list-style="checklist"]').first();

  await expect(checklist).toBeVisible();
  await expect(checklist).toHaveCSS('padding-inline-start', '18px');
});

test('style.tokens override is applied to body-mounted popover UI', async ({ page }) => {
  await createBlok(page, {
    styleTokens: { '--blok-popover-bg': 'rgb(1, 2, 3)' },
    data: { blocks: [{ type: 'paragraph', data: { text: '' } }] },
  });

  const paragraphBlock = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`
  );

  await expect(paragraphBlock).toHaveCount(1);

  const editable = paragraphBlock.locator('[contenteditable]');

  await editable.click();
  await editable.fill('');
  await editable.focus();

  // Open the toolbox via the "/" shortcut, which portals its popover to document.body.
  await page.keyboard.type('/');

  const popover = page.locator('[data-blok-popover]').first();

  await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

  // Prove the popover is actually portaled to document.body (the point of this test).
  const isBodyChild = await popover.evaluate((el) => el.parentElement === document.body);

  expect(isBodyChild).toBe(true);

  // Assert visibility on the inner container rather than the native `popover`
  // host itself: Chromium's checkVisibility() (which Playwright's toBeVisible
  // relies on) does not reliably reflect the top-layer `:popover-open` state
  // on the element that owns the `popover` attribute.
  const popoverContainer = popover.locator('[data-blok-testid="popover-container"]');

  await expect(popoverContainer).toBeVisible();

  const value = await popover.evaluate((el) => getComputedStyle(el).getPropertyValue('--blok-popover-bg').trim());

  expect(value).toBe('rgb(1, 2, 3)');
});

test('tokens.set repaints body-mounted popover UI at runtime (host theme toggle)', async ({ page }) => {
  await createBlok(page, {
    styleTokens: { '--blok-popover-bg': 'rgb(1, 2, 3)' },
    data: { blocks: [{ type: 'paragraph', data: { text: '' } }] },
  });

  /*
   * The whole point of the runtime API: a host light/dark toggle must reach
   * UI portaled OUT of the editor wrapper, which cannot inherit custom
   * properties from the holder. Unit tests only assert the generated CSS text,
   * so this drives the built bundle and reads the popover's computed value.
   */
  await page.evaluate(() => {
    window.blokInstance?.tokens.set({ '--blok-popover-bg': 'rgb(9, 8, 7)' });
  });

  const paragraphBlock = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`
  );

  await expect(paragraphBlock).toHaveCount(1);

  const editable = paragraphBlock.locator('[contenteditable]');

  await editable.click();
  await editable.fill('');
  await editable.focus();
  await page.keyboard.type('/');

  const popover = page.locator('[data-blok-popover]').first();

  await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

  const isBodyChild = await popover.evaluate((el) => el.parentElement === document.body);

  expect(isBodyChild).toBe(true);

  const value = await popover.evaluate((el) => getComputedStyle(el).getPropertyValue('--blok-popover-bg').trim());

  expect(value).toBe('rgb(9, 8, 7)');

  // Replace semantics: a token dropped from the new set stops applying.
  await page.evaluate(() => {
    window.blokInstance?.tokens.set({});
  });

  const cleared = await popover.evaluate((el) => getComputedStyle(el).getPropertyValue('--blok-popover-bg').trim());

  expect(cleared).not.toBe('rgb(9, 8, 7)');
});

test('runtime tokens survive a live theme toggle (the actual host scenario)', async ({ page }) => {
  await createBlok(page, {
    data: { blocks: [{ type: 'paragraph', data: { text: 'themed' } }] },
  });

  /*
   * The workaround this API replaces existed specifically because the host's
   * token bridge "must flip live on dark-mode toggle". So the contract that
   * matters is not just "tokens can be set at runtime" but "tokens set at
   * runtime still win after Blok switches theme" — Blok's own dark palette is
   * declared at zero specificity via :where(), while the injected sheet is a
   * plain (0,1,0) selector, so the override must survive. If the palette ever
   * stopped being :where()-wrapped, this is what would catch it.
   */
  const readPopoverBg = (): Promise<string> =>
    page.evaluate(() =>
      getComputedStyle(document.querySelector('[data-blok-interface]') as Element)
        .getPropertyValue('--blok-popover-bg')
        .trim()
    );

  await page.evaluate(() => {
    window.blokInstance?.theme.set('light');
    window.blokInstance?.tokens.set({ '--blok-popover-bg': 'rgb(11, 22, 33)' });
  });

  expect(await readPopoverBg()).toBe('rgb(11, 22, 33)');

  await page.evaluate(() => {
    window.blokInstance?.theme.set('dark');
  });

  expect(await page.evaluate(() => window.blokInstance?.theme.getResolved())).toBe('dark');
  expect(await readPopoverBg()).toBe('rgb(11, 22, 33)');

  // And the host can flip the palette itself on that toggle — the whole point.
  await page.evaluate(() => {
    window.blokInstance?.tokens.set({ '--blok-popover-bg': 'rgb(44, 55, 66)' });
  });

  expect(await readPopoverBg()).toBe('rgb(44, 55, 66)');
});

test('hideToolbar keeps the toolbar closed on hover and collapses the gutter', async ({ page }) => {
  await createBlok(page, {
    hideToolbar: true,
    data: { blocks: [{ type: 'paragraph', data: { text: 'No toolbar here' } }] },
  });

  const wrapper = page.locator(BLOK_INTERFACE_SELECTOR);

  await expect(wrapper).toHaveAttribute('data-blok-toolbar-hidden', '');

  const redactor = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-redactor]`);

  await expect(redactor).toHaveCSS('padding-inline-start', '0px');

  const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`);

  await paragraph.hover();

  // The hover toolbar (plus / drag controls) must never open.
  const plusButton = page.locator('[data-blok-testid="plus-button"]');

  await expect(plusButton).toBeHidden();
});

test('--blok-placeholder-color drives the empty-paragraph placeholder color in production', async ({ page }) => {
  await createBlok(page, {
    containerStyle: { '--blok-placeholder-color': 'rgb(255, 0, 0)' },
    placeholder: 'Type something…',
    data: { blocks: [{ type: 'paragraph', data: { text: '' } }] },
  });

  const editable = page
    .locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`)
    .locator('[contenteditable]')
    .first();

  await editable.click();

  const placeholderColor = await editable.evaluate((el) => getComputedStyle(el, '::before').color);

  expect(placeholderColor).toBe('rgb(255, 0, 0)');
});

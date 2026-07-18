// test/playwright/tests/host-customization-tokens.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';

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
    async ({ holder, initialData, readOnly, styleTokens }) => {
      const blok = new window.Blok({
        holder,
        ...(initialData ? { data: initialData } : {}),
        ...(readOnly !== undefined ? { readOnly } : {}),
        ...(styleTokens ? { style: { tokens: styleTokens } } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: options.data ?? null, readOnly: options.readOnly, styleTokens: options.styleTokens }
  );
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
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

  const popover = page.locator('body > [data-blok-popover]').first();

  await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

  // Assert visibility on the inner container rather than the native `popover`
  // host itself: Chromium's checkVisibility() (which Playwright's toBeVisible
  // relies on) does not reliably reflect the top-layer `:popover-open` state
  // on the element that owns the `popover` attribute.
  const popoverContainer = popover.locator('[data-blok-testid="popover-container"]');

  await expect(popoverContainer).toBeVisible();

  const value = await popover.evaluate((el) => getComputedStyle(el).getPropertyValue('--blok-popover-bg').trim());

  expect(value).toBe('rgb(1, 2, 3)');
});

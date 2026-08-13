/**
 * Screen-reader announcement coverage.
 *
 * Every state change a sighted user perceives visually has to reach assistive
 * technology through a live region. This spec walks the announcement surfaces
 * that are NOT drag & drop (see drag-drop-a11y.spec.ts for those): navigation
 * mode, block selection, keyboard block movement, programmatic navigation, the
 * popover results announcer, notifications, the inline equation preview, the
 * inline `role="alert"` error regions, and the ref-counted announcer singleton.
 */
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expectSingleByRole } from '../helpers/a11y';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const SECOND_HOLDER_ID = 'blok-second';

const ANY_ANNOUNCER = '[data-blok-announcer]';
const POLITE_ANNOUNCER = '[data-blok-announcer][role="status"]';
const ASSERTIVE_ANNOUNCER = '[data-blok-announcer][role="alert"]';
const PARAGRAPH_CONTENT = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    secondBlokInstance?: Blok;
    __recordedAnnouncements?: string[];
  }
}

/**
 * Record every message written into a live region from the moment this is
 * installed.
 *
 * The announcer clears itself ~1s after writing, so polling the region for a
 * steady-state value is a race that a slower engine loses: the message can be
 * written and cleared before the first poll runs. Observing mutations instead
 * captures the message even if it has already been cleared by assertion time.
 */
const recordAnnouncements = async (page: Page, selector: string): Promise<void> => {
  await page.evaluate((regionSelector) => {
    window.__recordedAnnouncements = [];

    const region = document.querySelector(regionSelector);

    if (region === null) {
      return;
    }

    new MutationObserver(() => {
      const text = region.textContent ?? '';

      if (text.trim() !== '') {
        window.__recordedAnnouncements?.push(text);
      }
    }).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }, selector);
};

const readRecordedAnnouncements = async (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__recordedAnnouncements ?? []);

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
 * Mount a SECOND editor next to the first one, tracked separately so each
 * instance can be destroyed exactly once (the announcer is reference-counted,
 * so a double destroy would tear the regions down while an editor still lives).
 */
const createSecondBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      data: { blocks: [ { type: 'paragraph',
        data: { text: 'Second editor' } } ] },
    });

    window.secondBlokInstance = blok;
    await blok.isReady;
  }, { holder: SECOND_HOLDER_ID });
};

/**
 * Resolve an i18n key through the live editor so assertions compare against the
 * real localized string instead of a transcription of
 * src/components/i18n/locales/en.json that would silently rot.
 */
const translate = async (
  page: Page,
  key: string,
  vars?: Record<string, string | number>
): Promise<string> => {
  return page.evaluate(({ dictKey, values }) => {
    const instance = window.blokInstance;

    if (!instance) {
      throw new Error('Blok instance is not available');
    }

    return instance.i18n.t(dictKey, values);
  }, { dictKey: key,
    values: vars });
};

/**
 * Select the whole text of an editable element through a real DOM Range, so the
 * inline toolbar sees the selection it would see from a user drag.
 */
const selectAllText = async (editable: Locator): Promise<void> => {
  await editable.evaluate((element) => {
    const doc = element.ownerDocument;
    const range = doc.createRange();

    range.selectNodeContents(element);

    const selection = doc.getSelection();

    if (!selection) {
      throw new Error('Selection is not available');
    }

    selection.removeAllRanges();
    selection.addRange(range);
  });
};

/**
 * Put the caret in the first (empty) paragraph and open the toolbox with "/".
 */
const openToolbox = async (page: Page): Promise<Locator> => {
  const paragraph = page.locator(PARAGRAPH_CONTENT).first();

  await paragraph.click();
  await expect(paragraph).toHaveAttribute('data-blok-empty', 'true');

  await page.keyboard.type('/');

  const popover = page.locator('[data-blok-testid="toolbox-popover"]');

  await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

  return popover;
};

/**
 * Insert a block through the public API rather than the slash menu, so no
 * popover teardown races the assertions that follow.
 */
const insertBlock = async (page: Page, toolName: string): Promise<void> => {
  await page.evaluate(async ({ tool }) => {
    await window.blokInstance?.blocks.insert(tool, {}, {}, 0, true, true);
  }, { tool: toolName });
};

test.describe('screen reader announcements', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test.describe('the shared live regions', () => {
    test('mounts a polite and an assertive region directly on the body', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: 'First block' } } ] },
      });

      const regions = page.locator(ANY_ANNOUNCER);

      await expect(regions).toHaveCount(2);

      const polite = page.locator(POLITE_ANNOUNCER);
      const assertive = page.locator(ASSERTIVE_ANNOUNCER);

      await expect(polite).toHaveAttribute('aria-live', 'polite');
      await expect(polite).toHaveAttribute('aria-atomic', 'true');
      await expect(assertive).toHaveAttribute('aria-live', 'assertive');
      await expect(assertive).toHaveAttribute('aria-atomic', 'true');

      // Outside [data-blok-interface] on purpose: an editor teardown that
      // removes its own wrapper must not take the live regions with it.
      const mountedOnBody = await regions.evaluateAll(
        (elements) => elements.map((element) => element.parentElement === document.body)
      );

      expect(mountedOnBody).toStrictEqual([ true, true ]);
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} ${ANY_ANNOUNCER}`)).toHaveCount(0);
    });

    test('hides the regions with inline styles that keep them in the a11y tree', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: 'First block' } } ] },
      });

      const polite = page.locator(POLITE_ANNOUNCER);

      // The regions live on document.body, outside the roots Blok's compiled
      // Tailwind utilities are scoped to, so an `.sr-only` CLASS would not
      // apply — the hiding has to ride on the element's own style attribute.
      const inlineStyles = await polite.evaluate((element) => {
        if (!(element instanceof HTMLElement)) {
          return null;
        }

        return {
          position: element.style.position,
          width: element.style.width,
          height: element.style.height,
          overflow: element.style.overflow,
          whiteSpace: element.style.whiteSpace,
        };
      });

      expect(inlineStyles).toStrictEqual({
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      });

      // display:none / visibility:hidden would drop the region out of the
      // accessibility tree entirely — clipping is what keeps it announceable.
      await expect(polite).toHaveCSS('display', 'block');
      await expect(polite).toHaveCSS('visibility', 'visible');
    });
  });

  test.describe('navigation mode', () => {
    test('announces entering navigation mode assertively', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'First block' } },
            { type: 'paragraph',
              data: { text: 'Second block' } },
          ],
        },
      });

      const expected = await translate(page, 'a11y.navigationModeEntered');

      expect(expected).not.toBe('');

      await page.getByText('First block').click();
      await page.keyboard.press('Escape');

      await expect(page.locator(ASSERTIVE_ANNOUNCER)).toHaveText(expected);
    });

    test('announces the focused block position politely while arrowing', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'First block' } },
            { type: 'paragraph',
              data: { text: 'Second block' } },
            { type: 'paragraph',
              data: { text: 'Third block' } },
          ],
        },
      });

      await page.getByText('First block').click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowDown');

      // "{tool}, {position} of {total}" — the tool label is resolved from the
      // toolbox entry, so assert its shape rather than a hard-coded name.
      await expect(page.locator(POLITE_ANNOUNCER)).toHaveText(/^.+, 2 of 3$/);
    });

    test('announces leaving navigation mode', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'First block' } },
            { type: 'paragraph',
              data: { text: 'Second block' } },
          ],
        },
      });

      const expected = await translate(page, 'a11y.navigationModeExited');

      expect(expected).not.toBe('');

      await page.getByText('First block').click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      await expect(page.locator(POLITE_ANNOUNCER)).toHaveText(expected);
    });
  });

  test.describe('block selection', () => {
    test('announces the selection size as Shift+Arrow grows it', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'First block' } },
            { type: 'paragraph',
              data: { text: 'Second block' } },
            { type: 'paragraph',
              data: { text: 'Third block' } },
          ],
        },
      });

      const expected = await translate(page, 'a11y.blocksSelected', { count: 2 });

      expect(expected).not.toBe('');

      await page.getByText('First block').click();
      await page.keyboard.press('Shift+ArrowDown');

      await expect(page.locator(POLITE_ANNOUNCER)).toHaveText(expected);
    });

    test('announces select-all distinctly from a partial selection', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'First block' } },
            { type: 'paragraph',
              data: { text: 'Second block' } },
            { type: 'paragraph',
              data: { text: 'Third block' } },
          ],
        },
      });

      const expected = await translate(page, 'a11y.allBlocksSelected', { count: 3 });

      expect(expected).not.toBe('');

      await page.getByText('First block').click();

      // Notion-style escalation: text -> this block -> every block.
      await page.keyboard.press(`${MODIFIER_KEY}+a`);
      await page.keyboard.press(`${MODIFIER_KEY}+a`);
      await page.keyboard.press(`${MODIFIER_KEY}+a`);

      await expect(page.locator(POLITE_ANNOUNCER)).toHaveText(expected);
    });
  });

  test.describe('keyboard block movement', () => {
    test('announces a completed move assertively, with its new position', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'First block' } },
            { type: 'paragraph',
              data: { text: 'Second block' } },
            { type: 'paragraph',
              data: { text: 'Third block' } },
          ],
        },
      });

      const expected = await translate(page, 'a11y.movedDown', { position: 2,
        total: 3 });

      expect(expected).not.toBe('');

      await page.getByText('First block').click();
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowDown`);

      await expect(page.locator(ASSERTIVE_ANNOUNCER)).toHaveText(expected);
    });

    test('announces a movement boundary politely', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph',
              data: { text: 'First block' } },
            { type: 'paragraph',
              data: { text: 'Second block' } },
          ],
        },
      });

      const expected = await translate(page, 'a11y.atTop');

      expect(expected).not.toBe('');

      await page.getByText('First block').click();
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      await expect(page.locator(POLITE_ANNOUNCER)).toHaveText(expected);
    });
  });

  test.describe('programmatic navigation', () => {
    test('announces a scrollToBlock jump', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'block-one',
              type: 'paragraph',
              data: { text: 'First block' } },
            { id: 'block-two',
              type: 'paragraph',
              data: { text: 'Second block' } },
          ],
        },
      });

      const expected = await translate(page, 'a11y.navigatedToBlock');

      expect(expected).not.toBe('');

      await page.evaluate(() => {
        const blocks = window.blokInstance?.blocks;

        if (blocks?.scrollToBlock === undefined) {
          throw new Error('blocks.scrollToBlock is not available');
        }

        blocks.scrollToBlock('block-two');
      });

      await expect(page.locator(POLITE_ANNOUNCER)).toHaveText(expected);
    });
  });

  test.describe('popover results announcer', () => {
    test('announces the toolbox search result count', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: '' } } ] },
      });

      const popover = await openToolbox(page);
      const announcer = popover.getByTestId('popover-results-announcer');

      await expect(announcer).toHaveAttribute('role', 'status');
      await expect(announcer).toHaveAttribute('aria-live', 'polite');

      await page.keyboard.type('head');

      // "Search results: {count}" — the count depends on the registered tool
      // set, so assert the template resolved with a real number.
      await expect(announcer).toHaveText(/\d+/);
    });

    test('announces the empty search state', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: '' } } ] },
      });

      const expected = await translate(page, 'popover.nothingFound');

      expect(expected).not.toBe('');

      const popover = await openToolbox(page);

      await page.keyboard.type('zzqqxx');

      await expect(popover.getByTestId('popover-results-announcer')).toHaveText(expected);
    });
  });

  test.describe('notifications', () => {
    test('announces an error toast assertively', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: 'First block' } } ] },
      });

      await page.evaluate(() => {
        window.blokInstance?.notifier.show({
          message: 'Upload failed',
          style: 'error',
        });
      });

      const toast = page.getByTestId('notification-error');
      const message = page.getByTestId('notification-message-text');

      await expect(toast).toHaveAttribute('role', 'status');
      await expect(message).toHaveText('Upload failed');
      await expect(message).toHaveAttribute('aria-live', 'assertive');
      await expect(message).toHaveAttribute('aria-atomic', 'true');
    });

    test('announces a non-error toast politely', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: 'First block' } } ] },
      });

      await page.evaluate(() => {
        window.blokInstance?.notifier.show({ message: 'Link copied' });
      });

      const message = page.getByTestId('notification-message-text');

      await expect(message).toHaveText('Link copied');
      await expect(message).toHaveAttribute('aria-live', 'polite');
      await expect(message).toHaveAttribute('aria-atomic', 'true');
    });

    test('turns the message into the dialog label when promoted to a dialog', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: 'First block' } } ] },
      });

      await page.evaluate(() => {
        window.blokInstance?.notifier.show({
          message: 'Delete this block?',
          type: 'confirm',
        });
      });

      const dialog = page.getByRole('alertdialog');

      await expect(dialog).toBeVisible();

      // A dialog label must not ALSO be a live region: the message would be
      // announced twice (once as the region, once as the dialog's name).
      const message = page.getByTestId('notification-message-text');

      await expect(message).not.toHaveAttribute('aria-live', /.*/);
      await expect(message).not.toHaveAttribute('aria-atomic', /.*/);
      await expect(dialog).toHaveAccessibleName('Delete this block?');

      // Leave the shared page interactive: the dialog makes its siblings inert.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  });

  test.describe('inline equation preview', () => {
    test('exposes the formula preview as a polite live region', async ({ page }) => {
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

      await page.waitForFunction(() => typeof window.Blok === 'function');

      await page.evaluate(async ({ holder }) => {
        // Runtime-only bundle: a non-literal specifier keeps it out of the
        // compile-time module graph (it exists only after a test build).
        const toolsUrl = '/dist/tools.mjs';
        const tools = await import(toolsUrl) as {
          Paragraph: unknown;
          Bold: unknown;
          Equation: unknown;
        };

        const blok = new window.Blok({
          holder,
          data: { blocks: [ { type: 'paragraph',
            data: { text: 'x^2' } } ] },
          tools: {
            paragraph: { class: tools.Paragraph },
            bold: { class: tools.Bold },
            equation: { class: tools.Equation },
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      await selectAllText(page.locator(PARAGRAPH_CONTENT).first());
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);

      const input = page.getByTestId('inline-equation-input');

      await expect(input).toBeFocused();

      const preview = page.locator('[data-blok-equation-preview]');

      await expect(preview).toHaveAttribute('aria-live', 'polite');

      await input.fill('\\frac{1}{2}');

      // The preview is what a sighted user reads to know the formula parsed;
      // the live region is what makes the same feedback reach a screen reader.
      await expect(preview).not.toBeEmpty();
    });
  });

  test.describe('inline error alerts', () => {
    test('link tool announces a rejected URL through an alert region', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: 'Link me' } } ] },
      });

      const expected = await translate(page, 'tools.link.invalidLink');

      expect(expected).not.toBe('');

      await selectAllText(page.locator(PARAGRAPH_CONTENT).first());
      await page.keyboard.press(`${MODIFIER_KEY}+KeyK`);

      const input = page.getByTestId('inline-tool-input');

      await expect(input).toBeVisible();

      await input.fill('javascript:alert(1)');
      await input.press('Enter');

      const error = page.locator('[data-blok-link-tool-error]');

      await expect(error).toBeVisible();
      await expect(error).toHaveAttribute('role', 'alert');
      await expect(error).toHaveText(expected);
      await expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    test('embed tool announces a rejected URL through an alert region', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: '' } } ] },
      });

      const expected = await translate(page, 'tools.embed.invalidUrl');

      expect(expected).not.toBe('');

      await insertBlock(page, 'embed');

      const emptyState = page.getByTestId('embed-empty');

      await expect(emptyState).toBeVisible();

      const urlInput = emptyState.getByRole('textbox');

      // Must be a syntactically valid URL: the field is <input type="url">, so a
      // malformed string is stopped by native constraint validation and never
      // reaches the tool's own rejection path.
      await urlInput.fill('https://example.com/not-embeddable');
      await urlInput.press('Enter');

      await expect(emptyState.getByRole('alert')).toHaveText(expected);
      await expect(urlInput).toHaveAttribute('aria-invalid', 'true');
    });

    test('media empty state announces its error through an alert region', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: '' } } ] },
      });

      await insertBlock(page, 'image');

      const emptyState = page.locator('[data-blok-media-empty-state]');

      await expect(emptyState).toBeVisible();

      // No default tool currently calls setError on the image/video/file empty
      // states (only the audio cover picker does), so the region is driven here
      // through the same element API a tool would use.
      await emptyState.evaluate((element) => {
        const surface = element as HTMLElement & { setError?: (message: string | null) => void };

        if (typeof surface.setError !== 'function') {
          throw new Error('media empty state does not expose setError');
        }

        surface.setError('That file is too large');
      });

      await expect(emptyState.getByRole('alert')).toHaveText('That file is too large');
    });
  });

  test.describe('multi-instance and teardown', () => {
    test('keeps exactly one shared announcer with two editors on the page', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: 'First block' } } ] },
      });
      await createSecondBlok(page);

      await expect(page.locator(BLOK_INTERFACE_SELECTOR)).toHaveCount(2);
      await expect(page.locator(ANY_ANNOUNCER)).toHaveCount(2);
      await expect(page.locator(POLITE_ANNOUNCER)).toHaveCount(1);

      // The assertive region is a role=alert; with no error surfaces open it is
      // the page's only one, so a leaked second announcer would show up here.
      const assertive = await expectSingleByRole(page, 'alert');

      await expect(assertive).toHaveAttribute('data-blok-announcer', '');

      // Both editors must reach the SAME region, otherwise one of them is
      // announcing into a detached node.
      const expected = await translate(page, 'a11y.navigationModeEntered');

      await recordAnnouncements(page, ASSERTIVE_ANNOUNCER);

      await page.getByText('Second editor').click();
      await page.keyboard.press('Escape');

      await expect.poll(() => readRecordedAnnouncements(page)).toContain(expected);
    });

    test('removes the live regions only after the last editor is destroyed', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [ { type: 'paragraph',
          data: { text: 'First block' } } ] },
      });
      await createSecondBlok(page);

      await expect(page.locator(ANY_ANNOUNCER)).toHaveCount(2);

      await page.evaluate(async () => {
        await window.secondBlokInstance?.destroy?.();
        window.secondBlokInstance = undefined;
      });

      await expect(page.locator(ANY_ANNOUNCER)).toHaveCount(2);

      await page.evaluate(async () => {
        await window.blokInstance?.destroy?.();
        window.blokInstance = undefined;
      });

      await expect(page.locator(ANY_ANNOUNCER)).toHaveCount(0);
    });
  });
});

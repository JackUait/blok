import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const PARAGRAPH_TEXT = 'Editing requires precision and care.';

const cases = [
  {
    name: 'single-clicking selected text closes the toolbar without mounting another popover',
    action: 'click',
    selection: '',
    mounts: [],
  },
  {
    name: 'double-clicking selected text mounts only one popover for the final word selection',
    action: 'dblclick',
    selection: 'precision',
    mounts: ['precision'],
  },
] as const;

test.describe('inline toolbar click flicker', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.evaluate(async (text) => {
      const holder = document.createElement('div');

      holder.setAttribute('data-blok-testid', 'blok');
      document.body.appendChild(holder);

      const blok = new window.Blok({
        holder,
        data: {
          blocks: [{ type: 'paragraph', data: { text } }],
        },
      });

      await blok.isReady;
    }, PARAGRAPH_TEXT);
  });

  for (const scenario of cases) {
    test(scenario.name, async ({ page }) => {
      const paragraph = page.getByTestId('block-wrapper').locator('[data-blok-tool="paragraph"][contenteditable="true"]');
      const toolbar = page.getByTestId('inline-toolbar');

      await expect(paragraph).toHaveText(PARAGRAPH_TEXT);
      await paragraph.focus();

      const position = await paragraph.evaluate((element) => {
        const text = element.firstChild;

        if (!(text instanceof Text)) {
          throw new Error('Expected a paragraph text node');
        }

        const start = text.data.indexOf('precision');

        if (start < 0) {
          throw new Error('Expected the word precision in the paragraph');
        }

        const range = document.createRange();

        range.setStart(text, start);
        range.setEnd(text, start + 'precision'.length);

        const word = range.getBoundingClientRect();
        const paragraphBox = element.getBoundingClientRect();

        return {
          x: word.left + word.width / 2 - paragraphBox.left,
          y: word.top + word.height / 2 - paragraphBox.top,
        };
      });

      await selectAllInEditable(paragraph);
      await expect(toolbar.getByTestId('popover-container')).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(PARAGRAPH_TEXT);

      const probe = await toolbar.evaluateHandle((element) => {
        const mounts: string[] = [];
        const observer = new MutationObserver((records) => {
          for (const node of records.flatMap((record) => Array.from(record.addedNodes))) {
            if (node instanceof Element && node.matches('[data-blok-testid="popover"]')) {
              mounts.push(window.getSelection()?.toString().trim() ?? '');
            }
          }
        });

        observer.observe(element, { childList: true, subtree: true });

        return { mounts, observer };
      });

      try {
        await paragraph[scenario.action]({ position });
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? '')).toBe(scenario.selection);

        // Observe past the 180ms selection debounce, including late remounts.
        // eslint-disable-next-line playwright/no-wait-for-timeout -- A negative mount assertion needs an observation window.
        await page.waitForTimeout(500);

        expect(await probe.evaluate(({ mounts }) => mounts)).toEqual(scenario.mounts);
        await expect(toolbar.getByTestId('popover')).toHaveCount(scenario.mounts.length);
        await expect(toolbar.locator('[data-blok-testid="popover"][data-blok-popover-opened="true"]')).toHaveCount(scenario.mounts.length);
      } finally {
        await probe.evaluate(({ observer }) => observer.disconnect());
        await probe.dispose();
      }
    });
  }
});

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
  }
}

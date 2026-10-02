import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
    blokInstance2?: Blok;
    __lastFindKey?: { code: string; prevented: boolean };
    __flashedNoResults?: boolean;
  }
}

// The browser runs on this host, and Blok picks the replace shortcut from the UA.
const IS_MAC = process.platform === 'darwin';
const FIND_KEY = 'ControlOrMeta+f';
const REPLACE_KEY = IS_MAC ? 'Meta+Alt+f' : 'Control+h';

type Blocks = OutputData['blocks'];

const paragraphs = (...texts: string[]): Blocks =>
  texts.map((text, i) => ({ id: `find-p${i}`, type: 'paragraph', data: { text } }));

const createEditor = async (
  page: Page,
  blocks: Blocks,
  options: { holder?: string; globalName?: 'blokInstance' | 'blokInstance2'; config?: Record<string, unknown>; width?: string } = {}
): Promise<void> => {
  const { holder = 'blok', globalName = 'blokInstance', config = {}, width } = options;

  await page.evaluate(({ holderId, holderWidth }) => {
    document.getElementById(holderId)?.remove();
    const div = document.createElement('div');

    div.id = holderId;
    div.setAttribute('data-blok-testid', holderId);
    if (holderWidth !== undefined) {
      div.style.width = holderWidth;
    }
    document.body.appendChild(div);
  }, { holderId: holder, holderWidth: width });

  await page.evaluate(
    async ({ holderId, key, data, extra }) => {
      const blok = new window.Blok({ holder: holderId, data: { blocks: data }, ...extra });

      window[key] = blok;
      await blok.isReady;
    },
    { holderId: holder, key: globalName, data: blocks, extra: config }
  );
};

const savedTexts = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return (saved?.blocks ?? []).map((block) => {
      const data = block.data as { text?: string; code?: string };

      return data.text ?? data.code ?? '';
    });
  });

/** Text of each painted range, per highlight name; null when the name is not registered. */
const pickOption = async (page: Page, name: 'Match case' | 'Match whole word'): Promise<void> => {
  await page.getByTestId('find-options').click();
  await page.getByRole('menuitemcheckbox', { name }).click();
};

const readHighlights = (page: Page): Promise<{ matches: string[] | null; active: string[] | null; activeBlockId: string | null }> =>
  page.evaluate(() => {
    const texts = (name: string): string[] | null => {
      const highlight = CSS.highlights.get(name);

      return highlight === undefined ? null : [...highlight].map((range) => (range instanceof Range ? range.toString() : ''));
    };
    const active = CSS.highlights.get('blok-find-match-active');
    const [first] = active === undefined ? [] : [...active];
    const node = first?.startContainer ?? null;
    const element = node instanceof Element ? node : node?.parentElement ?? null;

    return {
      matches: texts('blok-find-match'),
      active: texts('blok-find-match-active'),
      activeBlockId: element?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null,
    };
  });

/** Records whether the next F keydown ended up default-prevented, after every listener ran. */
const recordNextFKeydown = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.__lastFindKey = undefined;
    const listener = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyF') {
        return;
      }
      window.removeEventListener('keydown', listener, true);
      setTimeout(() => {
        window.__lastFindKey = { code: event.code, prevented: event.defaultPrevented };
      });
    };

    // Window capture runs before Blok's document listener, which stops propagation.
    window.addEventListener('keydown', listener, true);
  });
};

/** Click a paragraph and park the caret at its start: search starts from the caret. */
const focusParagraph = async (page: Page, text: string): Promise<void> => {
  const paragraph = page.getByText(text, { exact: true });

  await paragraph.click();
  // Home does not move the caret on macOS.
  await paragraph.evaluate((element) => {
    window.getSelection()?.collapse(element, 0);
  });
};

/** Outlasts the window onChange batches edits in, so a change would have arrived by now. */
const waitPastOnChangeBatch = (page: Page): Promise<void> =>
  page.evaluate((delay) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, delay);
  }), modificationsObserverBatchTimeout + 100);

const openFind = async (page: Page, query: string): Promise<void> => {
  await page.keyboard.press(FIND_KEY);
  await expect(page.getByTestId('find-input')).toBeFocused();
  await page.getByTestId('find-input').fill(query);
};

test.describe('find in page', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test.describe('opening', () => {
    test('Mod+F inside the editor opens the find bar and prevents the browser find', async ({ page }) => {
      await createEditor(page, paragraphs('alpha', 'beta'));
      await focusParagraph(page, 'alpha');
      await recordNextFKeydown(page);

      await page.keyboard.press(FIND_KEY);

      await expect(page.getByTestId('find-bar')).toBeVisible();
      await expect(page.getByTestId('find-input')).toBeFocused();
      await expect(page.getByRole('search')).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__lastFindKey)).toEqual({ code: 'KeyF', prevented: true });
    });

    test('a second Mod+F inside the find bar stays in the bar and selects the query', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'));
      await focusParagraph(page, 'alpha');
      await page.keyboard.press(FIND_KEY);
      const input = page.getByTestId('find-input');

      await input.fill('alp');
      await input.press('End');
      await recordNextFKeydown(page);

      await page.keyboard.press(FIND_KEY);

      await expect.poll(() => page.evaluate(() => window.__lastFindKey)).toEqual({ code: 'KeyF', prevented: true });
      await expect(page.getByTestId('find-bar')).toBeVisible();
      await expect(input).toBeFocused();
      await expect.poll(() => input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 3]);
    });

    test('Mod+F in the replace field moves to the find field, not the browser find', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'));
      await focusParagraph(page, 'alpha');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-replace-input').focus();
      await recordNextFKeydown(page);

      await page.keyboard.press(FIND_KEY);

      await expect.poll(() => page.evaluate(() => window.__lastFindKey)).toEqual({ code: 'KeyF', prevented: true });
      await expect(page.getByTestId('find-input')).toBeFocused();
      await expect(page.getByTestId('find-replace-row')).toBeVisible();
    });

    test('Mod+F in a host page title outside the editor opens the find bar, not the browser find', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'));
      await page.evaluate(() => {
        const title = document.createElement('h1');

        title.textContent = 'Page title';
        title.contentEditable = 'true';
        title.setAttribute('data-blok-testid', 'host-title');
        document.body.prepend(title);
      });
      await page.getByTestId('host-title').focus();
      await recordNextFKeydown(page);

      await page.keyboard.press(FIND_KEY);

      await expect.poll(() => page.evaluate(() => window.__lastFindKey)).toEqual({ code: 'KeyF', prevented: true });
      await expect(page.getByTestId('find-bar')).toBeVisible();
      await expect(page.getByTestId('find-input')).toBeFocused();
    });

    test('Mod+F on a selection in a host page title searches for it from there', async ({ page }) => {
      await createEditor(page, paragraphs('Zephyr in the editor'));
      await page.evaluate(() => {
        const title = document.createElement('h1');

        title.textContent = 'Zephyr title';
        title.contentEditable = 'true';
        title.setAttribute('data-blok-testid', 'host-title');
        document.body.appendChild(title);
      });
      await page.getByTestId('host-title').evaluate((title) => {
        const text = title.firstChild;

        if (!(title instanceof HTMLElement) || text === null) {
          throw new Error('title text missing');
        }
        title.focus();
        window.getSelection()?.setBaseAndExtent(text, 0, text, 6);
      });

      await page.keyboard.press(FIND_KEY);

      await expect(page.getByTestId('find-input')).toHaveValue('Zephyr');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
    });

    test('Mod+F on a selection never flashes "No results" before the matches show', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two'));
      await page.evaluate(() => {
        window.__flashedNoResults = false;
        new MutationObserver(() => {
          if (document.querySelector('[data-blok-testid="find-input"]')?.getAttribute('aria-invalid') === 'true') {
            window.__flashedNoResults = true;
          }
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-invalid'] });
      });
      await page.getByText('foo two').evaluate((paragraph) => {
        const text = paragraph.firstChild;

        if (!(paragraph instanceof HTMLElement) || text === null) {
          throw new Error('paragraph text missing');
        }
        paragraph.focus();
        window.getSelection()?.setBaseAndExtent(text, 0, text, 3);
      });

      await page.keyboard.press(FIND_KEY);

      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
      expect(await page.evaluate(() => window.__flashedNoResults)).toBe(false);
    });

    test('Mod+F on the body opens the find bar when the page has one editor', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'));
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
      await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);

      await page.keyboard.press(FIND_KEY);

      await expect(page.getByTestId('find-bar')).toBeVisible();
      await expect(page.getByTestId('find-input')).toBeFocused();
    });

    test('the replace shortcut opens the find bar with the replace row', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'));
      await focusParagraph(page, 'alpha');

      await page.keyboard.press(REPLACE_KEY);

      await expect(page.getByTestId('find-replace-row')).toBeVisible();
      await expect(page.getByTestId('find-replace-toggle')).toHaveAttribute('aria-expanded', 'true');
    });

    test('the chevron toggles the replace row', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'));
      await focusParagraph(page, 'alpha');
      await page.keyboard.press(FIND_KEY);
      await expect(page.getByTestId('find-replace-row')).toBeHidden();

      await page.getByTestId('find-replace-toggle').click();

      await expect(page.getByTestId('find-replace-row')).toBeVisible();
      await expect(page.getByTestId('find-replace-toggle')).toHaveAttribute('aria-expanded', 'true');
    });

    test('the replace row lines up under the find row, above the match map', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two'));
      await focusParagraph(page, 'foo one');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('foo');
      await expect(page.getByTestId('find-map')).toBeVisible();
      // The row grows open; measure once it has settled.
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== 'running'));

      const box = async (testId: string): Promise<{ left: number; right: number; top: number; bottom: number }> => {
        const rect = await page.getByTestId(testId).boundingBox();

        if (rect === null) {
          throw new Error(`${testId} has no box`);
        }

        return { left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height };
      };
      const findField = await box('find-field');
      const replaceField = await box('find-replace-field');
      const close = await box('find-close');
      const replaceAll = await box('find-replace-all');
      const map = await box('find-map');

      expect(replaceField.left).toBeCloseTo(findField.left, 0);
      expect(replaceField.right).toBeCloseTo(findField.right, 0);
      expect(replaceAll.right).toBeCloseTo(close.right, 0);
      expect(map.top).toBeGreaterThanOrEqual(replaceField.bottom);
    });

    test('the match map line spans from the find field to the close button', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-map')).toBeVisible();

      const geometry = await page.getByTestId('find-map').evaluate((map) => {
        const box = map.getBoundingClientRect();
        const line = getComputedStyle(map, '::before');
        const field = document.querySelector('[data-blok-testid="find-field"]')?.getBoundingClientRect();
        const close = document.querySelector('[data-blok-testid="find-close"]')?.getBoundingClientRect();

        return {
          lineLeft: box.left + parseFloat(line.left),
          lineRight: box.right - parseFloat(line.right),
          fieldLeft: field?.left ?? Number.NaN,
          closeRight: close?.right ?? Number.NaN,
        };
      });

      expect(geometry.lineLeft).toBeCloseTo(geometry.fieldLeft, 0);
      expect(geometry.lineRight).toBeCloseTo(geometry.closeRight, 0);
    });
  });

  test.describe('results', () => {
    test('the counter shows the active match and the total', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');

      await openFind(page, 'foo');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
    });

    test('with the bar open, Mod+F on a new selection searches for it from there', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'bar two', 'foo bar three'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');

      await page.locator('[data-blok-id="find-p2"] [contenteditable="true"]').evaluate((element) => {
        const text = element.firstChild;

        if (text === null) {
          return;
        }
        (element as HTMLElement).focus();
        window.getSelection()?.setBaseAndExtent(text, 4, text, 7);
      });
      await page.keyboard.press(FIND_KEY);

      await expect(page.getByTestId('find-input')).toHaveValue('bar');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
      expect((await readHighlights(page)).activeBlockId).toBe('find-p2');
    });

    test('the counter says "No results" when nothing matches', async ({ page }) => {
      await createEditor(page, paragraphs('foo one'));
      await focusParagraph(page, 'foo one');

      await openFind(page, 'zzz');

      await expect(page.getByTestId('find-counter')).toHaveText('No results');
      await expect(page.getByTestId('find-next')).toBeDisabled();
    });

    test('matches are painted with the Custom Highlight API, the active one apart', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');

      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      const paint = await readHighlights(page);

      expect(paint.active).toEqual(['foo']);
      expect(paint.matches).toEqual(['foo', 'foo']);
      expect(paint.activeBlockId).toBe('find-p0');
    });

    test('the match map draws one tick per match', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');

      await openFind(page, 'foo');

      await expect(page.getByTestId('find-map-tick')).toHaveCount(3);
      await expect(page.getByTestId('find-map')).toBeVisible();
    });
  });

  test.describe('navigation', () => {
    test('Enter moves to the next match and Shift+Enter back', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await page.keyboard.press('Enter');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');
      expect((await readHighlights(page)).activeBlockId).toBe('find-p1');

      await page.keyboard.press('Shift+Enter');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
      expect((await readHighlights(page)).activeBlockId).toBe('find-p0');
    });

    test('ArrowDown moves to the next match and ArrowUp back', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await page.keyboard.press('ArrowDown');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');
      expect((await readHighlights(page)).activeBlockId).toBe('find-p1');

      await page.keyboard.press('ArrowUp');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
      expect((await readHighlights(page)).activeBlockId).toBe('find-p0');
    });

    test('the ring lands on the new match at once and hugs its fill', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'a long line before foo two', 'foo three'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await page.keyboard.press('Enter');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');

      // A ring that glides would sit over unrelated text while the fill has already moved.
      const travelling = await page.getByTestId('find-lens-box').evaluate((box) =>
        box.getAnimations().filter((animation) => animation instanceof CSSTransition).length
      );

      expect(travelling).toBe(0);

      const offset = await page.getByTestId('find-lens-box').evaluate(async (box) => {
        await Promise.all(box.getAnimations().map((animation) => animation.finished));

        const active = CSS.highlights.get('blok-find-match-active');
        const [range] = active === undefined ? [] : [...active];

        if (!(range instanceof Range)) {
          return null;
        }

        const ring = box.getBoundingClientRect();
        const fill = range.getBoundingClientRect();

        return Math.max(
          Math.abs(ring.left - fill.left),
          Math.abs(ring.top - fill.top),
          Math.abs(ring.right - fill.right),
          Math.abs(ring.bottom - fill.bottom)
        );
      });

      expect(offset).not.toBeNull();
      expect(offset).toBeLessThan(0.5);
    });

    test('Enter wraps from the last match to the first', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');

      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
    });

    test('Mod+G moves to the next match and Shift+Mod+G back', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await page.keyboard.press('ControlOrMeta+g');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');

      await page.keyboard.press('Shift+ControlOrMeta+g');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
    });

    test('F3 moves to the next match and Shift+F3 back', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await page.keyboard.press('F3');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');

      await page.keyboard.press('Shift+F3');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
    });

    test('the next and previous buttons step through matches', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await page.getByTestId('find-next').click();
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');

      await page.getByTestId('find-previous').click();
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
    });
  });

  test.describe('closing', () => {
    test('Escape closes the bar, clears the paint and selects the active match', async ({ page }) => {
      await createEditor(page, paragraphs('alpha foo', 'beta foo'));
      await focusParagraph(page, 'alpha foo');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');

      await page.keyboard.press('Escape');

      const selection = await page.evaluate(() => {
        const current = window.getSelection();
        const node = current?.anchorNode ?? null;
        const element = node instanceof Element ? node : node?.parentElement ?? null;

        return {
          text: current?.toString() ?? '',
          blockId: element?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null,
        };
      });

      expect(selection).toEqual({ text: 'foo', blockId: 'find-p1' });
      await expect(page.getByTestId('find-bar')).toBeHidden();
      expect(await page.evaluate(() => CSS.highlights.has('blok-find-match') || CSS.highlights.has('blok-find-match-active'))).toBe(false);
    });

    test('Escape on a host match does not make host text editable through Find', async ({ page }) => {
      await createEditor(page, paragraphs('safeneedle in editor'));
      await page.evaluate(() => {
        const host = document.createElement('div');

        host.textContent = 'safeneedle outside';
        host.contentEditable = 'true';
        host.setAttribute('data-blok-testid', 'host-editable');
        document.body.appendChild(host);
      });
      await focusParagraph(page, 'safeneedle in editor');
      await openFind(page, 'safeneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');

      await page.keyboard.press('Escape');
      await page.keyboard.type('X');

      await expect(page.getByTestId('host-editable')).toHaveText('safeneedle outside');
    });

    test('Escape with no match gives focus back to where it was', async ({ page }) => {
      await createEditor(page, paragraphs('alpha', 'beta'));
      await focusParagraph(page, 'beta');
      await openFind(page, 'zzz');
      await expect(page.getByTestId('find-counter')).toHaveText('No results');

      await page.keyboard.press('Escape');

      await expect(page.getByText('beta', { exact: true })).toBeFocused();
      await expect(page.getByTestId('find-bar')).toBeHidden();
    });

    test('Escape closes the bar after clicking back into the text, and keeps the caret there', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');

      await page.getByText('foo two', { exact: true }).click();
      await page.keyboard.press('Escape');

      await expect(page.getByTestId('find-bar')).toBeHidden();
      // One Escape closes one layer: it must not also enter navigation mode.
      await expect(page.getByText('foo two', { exact: true })).toBeFocused();
    });

    test('Escape closes the bar when nothing has focus', async ({ page }) => {
      await createEditor(page, paragraphs('foo one'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
      await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);

      await page.keyboard.press('Escape');

      await expect(page.getByTestId('find-bar')).toBeHidden();
    });

    test('Escape in the text closes the formatting toolbar first, then the bar', async ({ page }) => {
      await createEditor(page, paragraphs('foo one'));
      await focusParagraph(page, 'foo one');
      await openFind(page, 'foo');
      await page.getByText('foo one', { exact: true }).evaluate((element) => {
        const text = element.firstChild;

        if (text !== null) {
          (element as HTMLElement).focus();
          window.getSelection()?.setBaseAndExtent(text, 4, text, 7);
        }
      });
      await expect(page.getByTestId('inline-toolbar')).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(page.getByTestId('inline-toolbar')).toBeHidden();
      await expect(page.getByTestId('find-bar')).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(page.getByTestId('find-bar')).toBeHidden();
    });

    test('the close button closes the bar', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'));
      await focusParagraph(page, 'alpha');
      await openFind(page, 'alpha');

      await page.getByTestId('find-close').click();

      await expect(page.getByTestId('find-bar')).toBeHidden();
    });
  });

  test.describe('page content', () => {
    test('finds host text before and after the editor in page order', async ({ page }) => {
      await page.evaluate(() => {
        const before = document.createElement('h1');

        before.textContent = 'saffronneedle before';
        before.setAttribute('data-blok-testid', 'host-before');
        document.body.appendChild(before);
      });
      await createEditor(page, paragraphs('saffronneedle in editor'));
      await page.evaluate(() => {
        const after = document.createElement('p');

        after.textContent = 'saffronneedle after';
        after.setAttribute('data-blok-testid', 'host-after');
        document.body.appendChild(after);
      });
      await focusParagraph(page, 'saffronneedle in editor');

      await openFind(page, 'saffronneedle');

      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');
      expect((await readHighlights(page)).activeBlockId).toBe('find-p0');

      await page.keyboard.press('Enter');
      await expect(page.getByTestId('find-counter')).toHaveText('3 of 3');
      expect(await page.evaluate(() => {
        const active = CSS.highlights.get('blok-find-match-active');
        const [range] = active === undefined ? [] : [...active];

        return range?.startContainer.parentElement?.getAttribute('data-blok-testid') ?? null;
      })).toBe('host-after');

      await page.keyboard.press('Enter');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
      expect(await page.evaluate(() => {
        const active = CSS.highlights.get('blok-find-match-active');
        const [range] = active === undefined ? [] : [...active];

        return range?.startContainer.parentElement?.getAttribute('data-blok-testid') ?? null;
      })).toBe('host-before');
    });

    test('keeps a host match active when match options change', async ({ page }) => {
      await createEditor(page, paragraphs('caseneedle in editor'));
      await page.evaluate(() => {
        const host = document.createElement('p');

        host.textContent = 'caseneedle outside';
        host.setAttribute('data-blok-testid', 'host-content');
        document.body.appendChild(host);
      });
      await focusParagraph(page, 'caseneedle in editor');
      await openFind(page, 'caseneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');

      await pickOption(page, 'Match case');

      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
    });

    test('continues to a later host match when the editor match stops matching', async ({ page }) => {
      await page.evaluate(() => {
        const before = document.createElement('p');

        before.textContent = 'casepath before';
        before.setAttribute('data-blok-testid', 'host-before');
        document.body.appendChild(before);
      });
      await createEditor(page, paragraphs('Casepath in editor'));
      await page.evaluate(() => {
        const after = document.createElement('p');

        after.textContent = 'casepath after';
        after.setAttribute('data-blok-testid', 'host-after');
        document.body.appendChild(after);
      });
      await focusParagraph(page, 'Casepath in editor');
      await openFind(page, 'casepath');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');

      await pickOption(page, 'Match case');

      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
      expect(await page.evaluate(() => {
        const active = CSS.highlights.get('blok-find-match-active');
        const [range] = active === undefined ? [] : [...active];

        return range?.startContainer.parentElement?.getAttribute('data-blok-testid') ?? null;
      })).toBe('host-after');
    });

    test('keeps the same host match when earlier page text shrinks', async ({ page }) => {
      await page.evaluate(() => {
        const before = document.createElement('p');

        before.textContent = 'x'.repeat(300);
        before.style.cssText = 'height:20px;overflow:hidden;white-space:nowrap';
        before.setAttribute('data-blok-testid', 'host-before');
        document.body.appendChild(before);
      });
      await createEditor(page, paragraphs('other words'));
      await page.evaluate(() => {
        const current = document.createElement('p');
        const spacer = document.createElement('p');
        const later = document.createElement('p');

        current.textContent = 'driftneedle current';
        current.setAttribute('data-blok-testid', 'host-current');
        spacer.textContent = 'y '.repeat(250);
        later.textContent = 'driftneedle later';
        later.setAttribute('data-blok-testid', 'host-later');
        document.body.append(current, spacer, later);
      });
      await focusParagraph(page, 'other words');
      await openFind(page, 'driftneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');

      await page.getByTestId('host-before').evaluate((element) => {
        const host = element;

        host.textContent = 'driftneedle before';
      });

      await expect(page.getByTestId('find-counter')).toContainText('of 3');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 3');
      expect(await page.evaluate(() => {
        const active = CSS.highlights.get('blok-find-match-active');
        const [range] = active === undefined ? [] : [...active];

        return range?.startContainer.parentElement?.getAttribute('data-blok-testid') ?? null;
      })).toBe('host-current');
    });

    test('does not count text in the find bar', async ({ page }) => {
      await createEditor(page, paragraphs('Replace this word'));
      await focusParagraph(page, 'Replace this word');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('Replace');

      await expect(page.getByTestId('find-replace-row')).toBeVisible();
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
    });

    test('updates matches when host-page text changes', async ({ page }) => {
      await createEditor(page, paragraphs('other words'));
      await page.evaluate(() => {
        const host = document.createElement('p');

        host.textContent = 'quillneedle outside';
        host.setAttribute('data-blok-testid', 'host-content');
        document.body.appendChild(host);
      });
      await focusParagraph(page, 'other words');
      await openFind(page, 'quillneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');

      await page.getByTestId('host-content').evaluate((element) => {
        const host = element;

        host.textContent = 'other words outside';
      });

      await expect(page.getByTestId('find-counter')).toHaveText('No results');
    });

    test('reveals a collapsed match in another editor', async ({ page }) => {
      await createEditor(page, paragraphs('otherneedle visible'));
      await createEditor(page, [
        { id: 'other-toggle', type: 'toggle', data: { text: 'Other toggle', isOpen: false }, content: ['other-child'] },
        { id: 'other-child', type: 'paragraph', data: { text: 'otherneedle hidden' }, parent: 'other-toggle' },
      ], { holder: 'blok2', globalName: 'blokInstance2' });
      await focusParagraph(page, 'otherneedle visible');

      await openFind(page, 'otherneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.keyboard.press('Enter');

      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
      await expect(page.locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('reveals a collapsed match in an editor with Find disabled', async ({ page }) => {
      await createEditor(page, paragraphs('peerneedle visible'));
      await createEditor(page, [
        { id: 'disabled-toggle', type: 'toggle', data: { text: 'Other toggle', isOpen: false }, content: ['disabled-child'] },
        { id: 'disabled-child', type: 'paragraph', data: { text: 'peerneedle hidden' }, parent: 'disabled-toggle' },
      ], { holder: 'blok2', globalName: 'blokInstance2', config: { find: false } });
      await focusParagraph(page, 'peerneedle visible');
      await openFind(page, 'peerneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');

      await page.keyboard.press('Enter');

      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
      await expect(page.getByTestId('blok2').locator('[data-blok-toggle-open]')).toHaveAttribute('data-blok-toggle-open', 'true');
      await expect(page.getByText('peerneedle hidden', { exact: true })).toBeVisible();
    });

    test('does not replace matches in a host contenteditable', async ({ page }) => {
      await createEditor(page, paragraphs('amberneedle in editor'));
      await page.evaluate(() => {
        const host = document.createElement('div');

        host.textContent = 'amberneedle outside';
        host.contentEditable = 'true';
        host.setAttribute('data-blok-testid', 'host-editable');
        document.body.appendChild(host);
      });
      await focusParagraph(page, 'amberneedle in editor');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('amberneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.getByTestId('find-replace-input').fill('changed');

      await page.getByTestId('find-replace-all').click();

      await expect.poll(() => savedTexts(page)).toEqual(['changed in editor']);
      await expect(page.getByTestId('host-editable')).toHaveText('amberneedle outside');
    });

    test('reveals a match inside a host scroll container', async ({ page }) => {
      await page.evaluate(() => {
        const scroller = document.createElement('div');
        const spacer = document.createElement('div');
        const target = document.createElement('p');

        scroller.setAttribute('data-blok-testid', 'host-scroller');
        scroller.style.cssText = 'height:100px;overflow:auto';
        spacer.style.height = '600px';
        target.textContent = 'oceanneedle outside';
        scroller.append(spacer, target);
        document.body.appendChild(scroller);
      });
      await createEditor(page, paragraphs('other words'));
      await focusParagraph(page, 'other words');

      await openFind(page, 'oceanneedle');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
      await expect.poll(() => page.getByTestId('host-scroller').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    });

    test('reveals a host match when its scroll container is offscreen', async ({ page }) => {
      await createEditor(page, paragraphs('other words'));
      await page.evaluate(() => {
        const before = document.createElement('div');
        const scroller = document.createElement('div');
        const inner = document.createElement('div');
        const target = document.createElement('p');
        const after = document.createElement('div');

        before.style.height = '1000px';
        scroller.style.cssText = 'height:120px;overflow:auto';
        inner.style.height = '600px';
        target.textContent = 'revealneedle outside';
        target.setAttribute('data-blok-testid', 'host-target');
        after.style.height = '1000px';
        scroller.append(inner, target);
        document.body.append(before, scroller, after);
      });
      await focusParagraph(page, 'other words');
      await openFind(page, 'revealneedle');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
      await expect(page.getByTestId('host-target')).toBeInViewport();
    });

    test('reveals a host match when its scroll container is partly visible', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await createEditor(page, paragraphs('other words'));
      await focusParagraph(page, 'other words');
      await page.evaluate(() => {
        const scroller = document.createElement('div');
        const inner = document.createElement('div');
        const target = document.createElement('p');
        const pageSpacer = document.createElement('div');

        scroller.style.cssText = 'position:absolute;top:690px;left:0;width:400px;height:300px;overflow:auto';
        inner.style.height = '500px';
        target.textContent = 'partialneedle outside';
        target.setAttribute('data-blok-testid', 'host-target');
        pageSpacer.style.height = '2000px';
        scroller.append(inner, target);
        document.body.append(scroller, pageSpacer);
      });

      await openFind(page, 'partialneedle');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(page.getByTestId('host-target')).toBeInViewport();
    });

    test('keeps the active ring on a host match while the page scrolls', async ({ page }) => {
      await createEditor(page, paragraphs('other words'));
      await page.evaluate(() => {
        const scroller = document.createElement('div');
        const before = document.createElement('div');
        const target = document.createElement('p');
        const after = document.createElement('div');
        const pageSpacer = document.createElement('div');

        scroller.setAttribute('data-blok-testid', 'host-scroller');
        scroller.style.cssText = 'height:260px;overflow:auto';
        before.style.height = '80px';
        target.textContent = 'scrollneedle outside';
        after.style.height = '600px';
        pageSpacer.style.height = '1400px';
        scroller.append(before, target, after);
        document.body.append(scroller, pageSpacer);
      });
      await focusParagraph(page, 'other words');
      await openFind(page, 'scrollneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');

      const ringOffset = (): Promise<number> => page.getByTestId('find-lens-box').evaluate((box) => {
        const active = CSS.highlights.get('blok-find-match-active');
        const [range] = active === undefined ? [] : [...active];

        if (!(range instanceof Range)) {
          return Number.POSITIVE_INFINITY;
        }

        return Math.abs(box.getBoundingClientRect().top - range.getBoundingClientRect().top);
      });

      await expect.poll(ringOffset).toBeLessThan(0.5);
      await page.getByTestId('host-scroller').evaluate((element) => {
        const scroller = element;

        scroller.scrollTop += 40;
      });
      await expect.poll(() => page.getByTestId('host-scroller').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expect.poll(ringOffset).toBeLessThan(0.5);

      const previousScrollY = await page.evaluate(() => window.scrollY);

      await page.evaluate(() => {
        window.scrollBy({ top: 50, behavior: 'instant' });
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(previousScrollY);
      await expect.poll(ringOffset).toBeLessThan(0.5);
    });

    test('keeps the active ring aligned when the host transforms the body', async ({ page }) => {
      await createEditor(page, paragraphs('other words'));
      await focusParagraph(page, 'other words');
      await page.evaluate(() => {
        const host = document.createElement('p');

        host.textContent = 'transformneedle outside';
        document.body.appendChild(host);
        document.body.style.transform = 'translateX(50px)';
      });

      try {
        await openFind(page, 'transformneedle');
        await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
        await expect.poll(() => page.getByTestId('find-lens-box').evaluate((box) => {
          const active = CSS.highlights.get('blok-find-match-active');
          const [range] = active === undefined ? [] : [...active];

          return range instanceof Range
            ? Math.abs(box.getBoundingClientRect().left - range.getBoundingClientRect().left)
            : Number.POSITIVE_INFINITY;
        })).toBeLessThan(0.5);
      } finally {
        await page.evaluate(() => {
          document.body.style.transform = '';
        });
      }
    });

    test('places host matches at different points on the match map', async ({ page }) => {
      await page.evaluate(() => {
        const first = document.createElement('p');
        const spacer = document.createElement('div');
        const second = document.createElement('p');

        first.textContent = 'mapneedle first';
        spacer.style.height = '500px';
        second.textContent = 'mapneedle second';
        document.body.append(first, spacer, second);
      });
      await createEditor(page, paragraphs('other words'));
      await focusParagraph(page, 'other words');

      await openFind(page, 'mapneedle');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      const positions = await page.getByTestId('find-map-tick').evaluateAll((ticks) =>
        ticks.map((tick) => tick.getBoundingClientRect().left)
      );

      expect(positions[1] - positions[0]).toBeGreaterThan(10);
    });

    test('paints host-page matches', async ({ page }) => {
      await createEditor(page, paragraphs('other words'));
      await page.evaluate(() => {
        const host = document.createElement('p');

        host.textContent = 'citronneedle outside';
        host.setAttribute('data-blok-testid', 'host-content');
        document.body.appendChild(host);
      });
      await focusParagraph(page, 'other words');
      await openFind(page, 'citronneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');

      const fill = await page.getByTestId('host-content').evaluate((element) =>
        getComputedStyle(element, '::highlight(blok-find-match-active)').backgroundColor
      );

      expect(fill).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('keeps the active ring color in sync with the editor theme', async ({ page }) => {
      await createEditor(page, paragraphs('themenoodle one', 'themenoodle two'));
      await focusParagraph(page, 'themenoodle one');
      await openFind(page, 'themenoodle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');

      await page.getByTestId('blok-editor').evaluate((element) => {
        (element as HTMLElement).style.setProperty('--blok-find-lens-ring', 'rgb(12, 34, 56)');
      });
      await page.keyboard.press('Enter');

      await expect(page.getByTestId('find-lens-box')).toHaveCSS('box-shadow', /rgb\(12, 34, 56\)/);
    });

    test('shows the active ring outside a clipped editor', async ({ page }) => {
      await createEditor(page, paragraphs('other words'));
      await page.getByTestId('blok').evaluate((element) => {
        const holder = element;

        holder.style.overflow = 'hidden';
        holder.style.height = '40px';
      });
      await page.evaluate(() => {
        const host = document.createElement('p');

        host.textContent = 'indigoneedle outside';
        host.setAttribute('data-blok-testid', 'host-content');
        document.body.appendChild(host);
      });
      await focusParagraph(page, 'other words');
      await openFind(page, 'indigoneedle');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');

      await expect(page.getByTestId('find-lens-box')).toBeInViewport();
      const offset = await page.getByTestId('find-lens-box').evaluate((box) => {
        const active = CSS.highlights.get('blok-find-match-active');
        const [range] = active === undefined ? [] : [...active];

        if (!(range instanceof Range)) {
          return null;
        }

        const ring = box.getBoundingClientRect();
        const fill = range.getBoundingClientRect();

        return Math.max(
          Math.abs(ring.left - fill.left),
          Math.abs(ring.top - fill.top),
          Math.abs(ring.right - fill.right),
          Math.abs(ring.bottom - fill.bottom)
        );
      });

      expect(offset).not.toBeNull();
      expect(offset).toBeLessThan(0.5);
    });
  });

  test.describe('matching', () => {
    test('matching ignores case by default', async ({ page }) => {
      await createEditor(page, paragraphs('Apple apple APPLE'));
      await focusParagraph(page, 'Apple apple APPLE');

      await openFind(page, 'apple');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
    });

    test('Match case keeps only exact-case matches', async ({ page }) => {
      await createEditor(page, paragraphs('Apple apple APPLE'));
      await focusParagraph(page, 'Apple apple APPLE');
      await openFind(page, 'apple');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await pickOption(page, 'Match case');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
      await expect(page.getByRole('menuitemcheckbox', { name: 'Match case' })).toHaveAttribute('aria-checked', 'true');
      expect((await readHighlights(page)).active).toEqual(['apple']);
    });

    test('Match whole word skips hits inside longer words', async ({ page }) => {
      await createEditor(page, paragraphs('cat catalog cat'));
      await focusParagraph(page, 'cat catalog cat');
      await openFind(page, 'cat');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await pickOption(page, 'Match whole word');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
    });

    test('arrow keys move across the search options and Enter checks one', async ({ page }) => {
      await createEditor(page, paragraphs('Apple apple APPLE'));
      await focusParagraph(page, 'Apple apple APPLE');
      await openFind(page, 'apple');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await page.getByTestId('find-options').focus();
      await page.keyboard.press('Enter');

      const matchCase = page.getByRole('menuitemcheckbox', { name: 'Match case' });
      const wholeWord = page.getByRole('menuitemcheckbox', { name: 'Match whole word' });

      await expect(matchCase).toHaveAttribute('data-blok-focused', 'true');
      await page.keyboard.press('ArrowDown');
      await expect(wholeWord).toHaveAttribute('data-blok-focused', 'true');
      await page.keyboard.press('ArrowUp');
      await expect(matchCase).toHaveAttribute('data-blok-focused', 'true');

      await page.keyboard.press('Enter');

      await expect(matchCase).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
    });

    test('Escape closes the options menu first, then the bar', async ({ page }) => {
      await createEditor(page, paragraphs('Apple apple APPLE'));
      await focusParagraph(page, 'Apple apple APPLE');
      await openFind(page, 'apple');

      await page.getByTestId('find-options').click();
      await expect(page.getByRole('menu')).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(page.getByRole('menu')).toBeHidden();
      await expect(page.getByTestId('find-bar')).toBeVisible();
      await expect(page.getByTestId('find-options')).toBeFocused();

      await page.keyboard.press('Escape');

      await expect(page.getByTestId('find-bar')).toBeHidden();
    });

    test('only a checked option shows its checkmark', async ({ page }) => {
      await createEditor(page, paragraphs('Apple apple APPLE'));
      await focusParagraph(page, 'Apple apple APPLE');
      await openFind(page, 'apple');
      await pickOption(page, 'Match case');

      const check = (name: string) => page.getByRole('menuitemcheckbox', { name }).getByTestId('popover-item-trailing-icon');

      await expect(check('Match case')).toBeVisible();
      await expect(check('Match whole word')).toBeHidden();
    });

    test('matching ignores accents', async ({ page }) => {
      await createEditor(page, paragraphs('Meet at the café'));
      await focusParagraph(page, 'Meet at the café');

      await openFind(page, 'cafe');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
      expect((await readHighlights(page)).active).toEqual(['café']);
    });

    test('a match spans inline formatting', async ({ page }) => {
      await createEditor(page, paragraphs('The road<i>map</i> is ready'));
      await focusParagraph(page, 'The roadmap is ready');

      await openFind(page, 'roadmap');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
      expect((await readHighlights(page)).active).toEqual(['roadmap']);
    });

    const toggleWithHiddenMatch: Blocks = [
      { id: 'find-tgl', type: 'toggle', data: { text: 'Toggle title', isOpen: false }, content: ['find-child'] },
      { id: 'find-child', type: 'paragraph', data: { text: 'hidden needle' }, parent: 'find-tgl' },
      { id: 'find-after', type: 'paragraph', data: { text: 'visible needle' } },
    ];

    test('typing counts a match inside a collapsed toggle but lands on a visible one', async ({ page }) => {
      await createEditor(page, toggleWithHiddenMatch);
      const toggleState = page.locator('[data-blok-toggle-open]');

      await expect(toggleState).toHaveAttribute('data-blok-toggle-open', 'false');
      await focusParagraph(page, 'Toggle title');

      await openFind(page, 'needle');

      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
      expect((await readHighlights(page)).activeBlockId).toBe('find-after');
      await expect(toggleState).toHaveAttribute('data-blok-toggle-open', 'false');
    });

    test('stepping onto a match inside a collapsed toggle opens the toggle', async ({ page }) => {
      await createEditor(page, toggleWithHiddenMatch);
      const toggleState = page.locator('[data-blok-toggle-open]');

      await focusParagraph(page, 'Toggle title');
      await openFind(page, 'needle');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');

      await page.keyboard.press('Enter');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await expect(toggleState).toHaveAttribute('data-blok-toggle-open', 'true');
      await expect(page.getByText('hidden needle', { exact: true })).toBeVisible();
      expect((await readHighlights(page)).activeBlockId).toBe('find-child');
    });
  });

  test.describe('replace', () => {
    test('Enter in the replace field replaces the current match only', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two'));
      await focusParagraph(page, 'foo one');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.getByTestId('find-replace-input').fill('bar');

      await page.getByTestId('find-replace-input').press('Enter');

      await expect.poll(() => savedTexts(page)).toEqual(['bar one', 'foo two']);
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
    });

    test('the Replace button replaces the current match only', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two'));
      await focusParagraph(page, 'foo one');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.getByTestId('find-replace-input').fill('bar');

      await page.getByTestId('find-replace').click();

      await expect.poll(() => savedTexts(page)).toEqual(['bar one', 'foo two']);
    });

    test('Mod+Enter in the replace field replaces every match', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'two foo', 'foo three foo'));
      await focusParagraph(page, 'foo one');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 4');
      await page.getByTestId('find-replace-input').fill('bar');

      await page.getByTestId('find-replace-input').press('ControlOrMeta+Enter');

      await expect.poll(() => savedTexts(page)).toEqual(['bar one', 'two bar', 'bar three bar']);
      await expect(page.getByTestId('find-counter')).toHaveText('No results');
    });

    test('Replace all is one undo step', async ({ page }) => {
      const original = ['foo one', 'two foo', 'foo three foo'];

      await createEditor(page, paragraphs(...original));
      await focusParagraph(page, 'foo one');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 4');
      await page.getByTestId('find-replace-input').fill('bar');
      await page.getByTestId('find-replace-input').press('ControlOrMeta+Enter');
      await expect.poll(() => savedTexts(page)).toEqual(['bar one', 'two bar', 'bar three bar']);

      // No match is left, so Escape hands focus back to the paragraph.
      await page.keyboard.press('Escape');
      await expect(page.getByText('bar one', { exact: true })).toBeFocused();
      await page.keyboard.press('ControlOrMeta+z');

      await expect.poll(() => savedTexts(page)).toEqual(original);
    });

    // With no match left the clicked button disables itself; focus must stay in the bar.
    test('after the Replace all button, Escape still closes the bar', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'two foo'));
      await focusParagraph(page, 'foo one');
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.getByTestId('find-replace-input').fill('bar');
      await page.getByTestId('find-replace-all').click();
      await expect.poll(() => savedTexts(page)).toEqual(['bar one', 'two bar']);

      await page.keyboard.press('Escape');

      await expect(page.getByTestId('find-bar')).toBeHidden();
    });

    test('replacing in a code block keeps focus in the find bar', async ({ page }) => {
      await createEditor(page, [
        { id: 'find-code', type: 'code', data: { code: 'const hello = "hello";', language: 'javascript' } },
        { id: 'find-after', type: 'paragraph', data: { text: 'after' } },
      ]);
      const code = page.getByTestId('code-content');

      // Prism paints token spans; the replace must be followed by that repaint.
      await expect.poll(() => code.evaluate((element) => element.querySelector('span') !== null)).toBe(true);
      await code.click();
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill('hello');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await page.getByTestId('find-replace-input').fill('bye');
      await code.evaluate((element) => {
        const flag = element as HTMLElement & { __repainted?: boolean };

        flag.__repainted = false;
        new MutationObserver((records, observer) => {
          if (records.some((record) => [...record.addedNodes].some((node) => node instanceof Element))) {
            flag.__repainted = true;
            observer.disconnect();
          }
        }).observe(element, { childList: true, subtree: true });
      });

      await page.getByTestId('find-replace-input').press('Enter');
      await expect.poll(() => code.evaluate((element) => (element as HTMLElement & { __repainted?: boolean }).__repainted)).toBe(true);
      // Let the frame after the repaint run too.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      await expect(page.getByTestId('find-replace-input')).toBeFocused();
      await expect(code).toHaveText('const bye = "hello";');
    });
  });

  test.describe('replace preview', () => {
    const PREVIEW = '[data-blok-find-preview-clone]';

    const typeReplacement = async (page: Page, query: string, replacement: string): Promise<void> => {
      await page.keyboard.press(REPLACE_KEY);
      await page.getByTestId('find-input').fill(query);
      await page.getByTestId('find-replace-input').fill(replacement);
    };

    test('shows each replacement in the text, next to the struck-out match', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'two foo'));
      await focusParagraph(page, 'foo one');

      await typeReplacement(page, 'foo', 'bar');

      await expect(page.locator(`${PREVIEW} [data-blok-find-preview-new]`)).toHaveText(['bar', 'bar']);
      await expect(page.locator(`${PREVIEW} [data-blok-find-preview-old]`)).toHaveText(['foo', 'foo']);
      await expect(page.locator(`${PREVIEW} [data-blok-find-preview-old]`).first()).toHaveCSS('text-decoration-line', 'line-through');
      await expect(page.getByText('foo one', { exact: true })).toBeHidden();
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
    });

    test('previews replacements only in the editor that opened the bar', async ({ page }) => {
      await createEditor(page, paragraphs('foo first'));
      await createEditor(page, [{ id: 'find-second', type: 'paragraph', data: { text: 'foo second' } }], {
        holder: 'blok2',
        globalName: 'blokInstance2',
      });
      await focusParagraph(page, 'foo first');

      await typeReplacement(page, 'foo', 'bar');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await expect(page.getByTestId('blok').locator(PREVIEW)).toHaveCount(1);
      await expect(page.getByTestId('blok2').locator(PREVIEW)).toHaveCount(0);
      await expect(page.getByText('foo second', { exact: true })).toBeVisible();
    });

    test('never changes the document, in a paragraph, a collapsed toggle or a table', async ({ page }) => {
      const blocks: Blocks = [
        { id: 'find-p', type: 'paragraph', data: { text: 'foo para' } },
        { id: 'find-tgl', type: 'toggle', data: { text: 'foo title', isOpen: false }, content: ['find-child'] },
        { id: 'find-child', type: 'paragraph', data: { text: 'foo child' }, parent: 'find-tgl' },
        { id: 'find-table', type: 'table', data: { withHeadings: false, content: [['foo cell', 'b']] } },
      ];

      const changes = (): Promise<number> => page.evaluate(() => (window as Window & { __findChanges?: number }).__findChanges ?? 0);

      await createEditor(page, blocks);
      await page.evaluate(async (data) => {
        const counter = window as Window & { __findChanges?: number };

        window.blokInstance?.destroy();
        document.getElementById('blok')?.replaceChildren();
        counter.__findChanges = 0;
        const blok = new window.Blok({
          holder: 'blok',
          data: { blocks: data },
          onChange: () => {
            counter.__findChanges = (counter.__findChanges ?? 0) + 1;
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, blocks);
      await focusParagraph(page, 'foo para');
      // Clicking may settle the editor; only what follows counts.
      await waitPastOnChangeBatch(page);
      const before = await changes();

      await typeReplacement(page, 'foo', 'bar');
      await expect(page.locator(`${PREVIEW} [data-blok-find-preview-new]`)).toHaveCount(4);
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 4');
      // onChange is batched; give it time to arrive if the preview set one off.
      await waitPastOnChangeBatch(page);

      expect(await changes()).toBe(before);
      await expect(page.locator('[data-blok-toggle-open]').first()).toHaveAttribute('data-blok-toggle-open', 'false');
    });

    test('Replace all writes what the preview showed, and the preview goes', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'two foo'));
      await focusParagraph(page, 'foo one');
      await typeReplacement(page, 'foo', 'bar');
      await expect(page.locator(PREVIEW)).toHaveCount(2);

      await page.getByTestId('find-replace-input').press('ControlOrMeta+Enter');

      await expect.poll(() => savedTexts(page)).toEqual(['bar one', 'two bar']);
      await expect(page.locator(PREVIEW)).toHaveCount(0);
      await expect(page.getByText('bar one', { exact: true })).toBeVisible();
    });

    test('Escape drops the preview and selects the real match', async ({ page }) => {
      await createEditor(page, paragraphs('foo one'));
      await focusParagraph(page, 'foo one');
      await typeReplacement(page, 'foo', 'bar');
      await expect(page.locator(PREVIEW)).toHaveCount(1);

      await page.keyboard.press('Escape');

      await expect(page.locator(PREVIEW)).toHaveCount(0);
      await expect(page.getByText('foo one', { exact: true })).toBeFocused();
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('foo');
    });
  });

  test.describe('configuration', () => {
    test('read-only: find works and the replace toggle is hidden', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two'), { config: { readOnly: true } });

      await page.keyboard.press(REPLACE_KEY);

      await expect(page.getByTestId('find-replace-toggle')).toBeHidden();
      await expect(page.getByTestId('find-replace-row')).toBeHidden();
      await page.getByTestId('find-input').fill('foo');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
    });

    test('find: false leaves Mod+F to the browser', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'), { config: { find: false } });
      await focusParagraph(page, 'alpha');
      await recordNextFKeydown(page);

      await page.keyboard.press(FIND_KEY);

      await expect.poll(() => page.evaluate(() => window.__lastFindKey)).toEqual({ code: 'KeyF', prevented: false });
      await expect(page.getByTestId('find-dock')).toHaveCount(0);
    });

    test('with two editors, Mod+F opens one bar and searches both editors', async ({ page }) => {
      await createEditor(page, paragraphs('first editor'), { holder: 'blok' });
      await createEditor(page, [{ id: 'find-second', type: 'paragraph', data: { text: 'second editor' } }], {
        holder: 'blok2',
        globalName: 'blokInstance2',
      });
      await focusParagraph(page, 'second editor');

      await page.keyboard.press(FIND_KEY);

      await expect(page.getByTestId('find-dock')).toHaveCount(1);
      await page.getByTestId('find-input').fill('editor');
      await expect(page.getByTestId('find-counter')).toHaveText('2 of 2');
      await expect.poll(async () => (await readHighlights(page)).activeBlockId).toBe('find-second');

      await page.keyboard.press('Enter');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
      await expect.poll(async () => (await readHighlights(page)).activeBlockId).toBe('find-p0');
    });
  });

  test.describe('placement', () => {
    const barBox = (page: Page): Promise<{ top: number; right: number; left: number; vw: number } | null> =>
      page.evaluate(() => {
        // The layout box: the entrance animation scales the visual one for a moment.
        const dock = document.querySelector<HTMLElement>('[data-blok-find]');

        if (dock === null) {
          return null;
        }

        return {
          top: dock.offsetTop,
          left: dock.offsetLeft,
          right: dock.offsetLeft + dock.offsetWidth,
          vw: document.documentElement.clientWidth,
        };
      });

    test('opens at the top-right of the window, where browsers put their find bar', async ({ page }) => {
      await createEditor(page, paragraphs('hello there'), { width: '380px' });
      await focusParagraph(page, 'hello there');
      await page.keyboard.press(FIND_KEY);
      await expect(page.getByTestId('find-bar')).toBeVisible();

      const box = await barBox(page);

      expect(box).not.toBeNull();
      expect(box?.top).toBeLessThan(40);
      expect((box?.vw ?? 0) - (box?.right ?? 0)).toBeLessThan(40);
    });

    test('sits in the top layer, above a host overlay with the highest z-index', async ({ page }) => {
      await createEditor(page, paragraphs('hello there'));
      await page.evaluate(() => {
        const cover = document.createElement('div');

        cover.id = 'host-cover';
        cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.1)';
        document.body.appendChild(cover);
      });
      await page.keyboard.press(FIND_KEY);

      const onTop = await page.evaluate(() => {
        const bar = document.querySelector('[data-blok-testid="find-bar"]');
        const box = bar?.getBoundingClientRect();

        if (bar === null || box === undefined) {
          return false;
        }

        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

        return hit !== null && bar.contains(hit) && bar.closest('[data-blok-find]')?.matches(':popover-open') === true;
      });

      expect(onTop).toBe(true);
    });

    test('sits where the host placed it, and people cannot drag it away', async ({ page }) => {
      await createEditor(page, paragraphs('hello there'), {
        config: { find: { placement: 'bottom-start', offset: { x: 40, y: 30 } } },
      });
      await focusParagraph(page, 'hello there');
      await page.keyboard.press(FIND_KEY);
      await expect(page.getByTestId('find-bar')).toBeVisible();

      const placed = await barBox(page);
      const viewportHeight = await page.evaluate(() => document.documentElement.clientHeight);
      const bottom = await page.evaluate(() => {
        const dock = document.querySelector<HTMLElement>('[data-blok-find]');

        return dock === null ? 0 : dock.offsetTop + dock.offsetHeight;
      });

      expect(placed?.left).toBe(40);
      expect(viewportHeight - bottom).toBe(30);

      const bar = await page.getByTestId('find-bar').boundingBox();

      if (bar === null) {
        throw new Error('bar not laid out');
      }
      await page.mouse.move(bar.x + 4, bar.y + 4);
      await page.mouse.down();
      await page.mouse.move(bar.x + 300, bar.y - 300, { steps: 6 });
      await page.mouse.up();

      expect(await barBox(page)).toEqual(placed);
    });
  });

  test.describe('reveal', () => {
    test('the revealed match is not left under the find bar', async ({ page }) => {
      await page.addStyleTag({ content: 'body { min-height: 4000px; }' });
      const texts = Array.from({ length: 40 }, (_, i) => (i === 15 ? 'Paragraph zebra here' : `Paragraph ${i} filler`));

      // Narrow, so the bar covers the whole text column.
      await createEditor(page, paragraphs(...texts), { width: '380px' });
      await page.evaluate(() => {
        const target = document.querySelector('[data-blok-id="find-p15"]');

        if (target !== null) {
          window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 12, behavior: 'instant' });
        }
      });
      await page.keyboard.press(FIND_KEY);
      await expect(page.getByTestId('find-bar')).toBeVisible();

      // Precondition: the target line starts under the bar, so a reveal has to move it.
      const coveredBefore = await page.evaluate(() => {
        const target = document.querySelector('[data-blok-id="find-p15"]');
        const bar = document.querySelector('[data-blok-testid="find-bar"]');

        return target !== null && bar !== null && target.getBoundingClientRect().top < bar.getBoundingClientRect().bottom;
      });

      expect(coveredBefore).toBe(true);

      await page.getByTestId('find-input').fill('zebra');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');

      await expect.poll(() => page.evaluate(() => {
        const active = CSS.highlights.get('blok-find-match-active');
        const [range] = active === undefined ? [] : [...active];
        const bar = document.querySelector('[data-blok-testid="find-bar"]');

        if (!(range instanceof Range) || bar === null) {
          return 'missing';
        }

        const match = range.getBoundingClientRect();
        const box = bar.getBoundingClientRect();

        return match.top >= box.bottom && match.bottom <= window.innerHeight ? 'clear' : `match ${match.top}-${match.bottom}, bar bottom ${box.bottom}`;
      }), { timeout: 5000 }).toBe('clear');
    });
  });
});

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
    blokInstance2?: Blok;
    __lastFindKey?: { code: string; prevented: boolean };
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
  options: { holder?: string; instanceKey?: 'blokInstance' | 'blokInstance2'; config?: Record<string, unknown>; width?: string } = {}
): Promise<void> => {
  const { holder = 'blok', instanceKey = 'blokInstance', config = {}, width } = options;

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
    { holderId: holder, key: instanceKey, data: blocks, extra: config }
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

    test('a second Mod+F inside the find bar is left to the browser', async ({ page }) => {
      await createEditor(page, paragraphs('alpha'));
      await focusParagraph(page, 'alpha');
      await page.keyboard.press(FIND_KEY);
      await expect(page.getByTestId('find-input')).toBeFocused();
      await recordNextFKeydown(page);

      await page.keyboard.press(FIND_KEY);

      await expect.poll(() => page.evaluate(() => window.__lastFindKey)).toEqual({ code: 'KeyF', prevented: false });
      await expect(page.getByTestId('find-bar')).toBeVisible();
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
  });

  test.describe('results', () => {
    test('the counter shows the active match and the total', async ({ page }) => {
      await createEditor(page, paragraphs('foo one', 'foo two', 'foo three'));
      await focusParagraph(page, 'foo one');

      await openFind(page, 'foo');

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');
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

    test('Escape with no match gives focus back to where it was', async ({ page }) => {
      await createEditor(page, paragraphs('alpha', 'beta'));
      await focusParagraph(page, 'beta');
      await openFind(page, 'zzz');
      await expect(page.getByTestId('find-counter')).toHaveText('No results');

      await page.keyboard.press('Escape');

      await expect(page.getByText('beta', { exact: true })).toBeFocused();
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

      await page.getByTestId('find-match-case').click();

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
      await expect(page.getByTestId('find-match-case')).toHaveAttribute('aria-pressed', 'true');
      expect((await readHighlights(page)).active).toEqual(['apple']);
    });

    test('Match whole word skips hits inside longer words', async ({ page }) => {
      await createEditor(page, paragraphs('cat catalog cat'));
      await focusParagraph(page, 'cat catalog cat');
      await openFind(page, 'cat');
      await expect(page.getByTestId('find-counter')).toHaveText('1 of 3');

      await page.getByTestId('find-whole-word').click();

      await expect(page.getByTestId('find-counter')).toHaveText('1 of 2');
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

    test('with two editors, Mod+F opens the bar of the focused one', async ({ page }) => {
      await createEditor(page, paragraphs('first editor'), { holder: 'blok' });
      await createEditor(page, [{ id: 'find-second', type: 'paragraph', data: { text: 'second editor' } }], {
        holder: 'blok2',
        instanceKey: 'blokInstance2',
      });
      await focusParagraph(page, 'second editor');

      await page.keyboard.press(FIND_KEY);

      await expect(page.getByTestId('blok2').getByTestId('find-bar')).toBeVisible();
      await expect(page.getByTestId('blok').getByTestId('find-dock')).toHaveCount(0);
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

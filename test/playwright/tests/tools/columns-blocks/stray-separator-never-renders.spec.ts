import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import {
  ensureBlokBundleBuilt,
  TEST_PAGE_URL,
  createBlok,
} from './_helpers';

/**
 * A two-column layout. The exact column-set-mutation path is irrelevant here:
 * this spec injects a stray separator directly into the live row to prove the
 * VISUAL backstop holds no matter how a separator ends up misplaced.
 */
const twoColumnFixture = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['k1'] },
    { id: 'k1', type: 'paragraph', data: { text: 'Left keeper' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['k2'] },
    { id: 'k2', type: 'paragraph', data: { text: 'Right keeper' }, parent: 'c2' },
  ],
});

/**
 * Clone the row's real separator and splice the clone in at `position`, then
 * report the clone's rendered width and whether it displaces the first column.
 * A clone of the genuine separator carries the same attributes/classes, so if it
 * renders as a bar the backstop has failed.
 */
const measureStraySeparator = async (
  page: Page,
  position: 'leading' | 'trailing' | 'doubled'
): Promise<{ display: string; width: number; firstColumnLeftShift: number }> => {
  return await page.evaluate((pos: 'leading' | 'trailing' | 'doubled') => {
    const row = document.querySelector('[data-blok-columns]');

    if (!(row instanceof HTMLElement)) {
      throw new Error('no column row');
    }

    const realSeparator = row.querySelector('[data-blok-column-resizer]');

    if (!(realSeparator instanceof HTMLElement)) {
      throw new Error('no separator to clone');
    }

    const columns = Array.from(row.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute('data-blok-column-resizer')
    );
    const firstColumnLeftBefore = columns[0].getBoundingClientRect().left;

    const stray = realSeparator.cloneNode(true) as HTMLElement;

    stray.setAttribute('data-stray', '');

    if (pos === 'leading') {
      row.insertBefore(stray, row.firstChild);
    } else if (pos === 'trailing') {
      row.appendChild(stray);
    } else {
      // Doubled: place the clone immediately AFTER the real separator so the two
      // sit adjacent (the "middle column removed" shape).
      realSeparator.after(stray);
    }

    // Force layout.
    void row.offsetWidth;

    const display = getComputedStyle(stray).display;
    const width = stray.getBoundingClientRect().width;
    const firstColumnLeftAfter = columns[0].getBoundingClientRect().left;

    stray.remove();

    return {
      display,
      width: Math.round(width),
      firstColumnLeftShift: Math.round(firstColumnLeftAfter - firstColumnLeftBefore),
    };
  }, position);
};

test.beforeAll(async () => {
  await ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
  await createBlok(page, twoColumnFixture());
});

/**
 * Structural backstop: a resize separator is ONLY valid between two columns. A
 * leading, trailing, or doubled separator — however it got there (a missed
 * rebuild, a raw DOM mutation, an undo/redo restoring stale structure) — must
 * never render as a gutter bar or displace the columns. This is the guarantee
 * that the far-left "phantom column" bar can never reappear under ANY path.
 */
for (const position of ['leading', 'trailing', 'doubled'] as const) {
  test(`a ${position} separator is display:none and never displaces columns`, async ({ page }) => {
    const result = await measureStraySeparator(page, position);

    expect(result.display).toBe('none');
    expect(result.width).toBe(0);
    expect(result.firstColumnLeftShift).toBe(0);
  });
}

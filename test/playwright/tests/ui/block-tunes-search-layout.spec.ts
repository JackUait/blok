import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const TEXT = 'Search the block menu';

const openBlockTunes = async (page: Page): Promise<void> => {
  await page.getByText(TEXT, { exact: true }).click();
  await page.getByTestId('settings-toggler').click();
  const popover = page.getByTestId('block-tunes-popover');

  await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');
  // Mid-entrance the width reads a pixel short, so measure after it ends.
  await popover.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
  });
};

const measure = (popover: Locator): Promise<{ width: number; fieldHeight: number; fieldBorder: string }> =>
  popover.evaluate(element => {
    const container = element.querySelector(':scope > [data-blok-popover-container]');
    const field = container?.querySelector('[data-blok-testid="popover-search-field"]');

    if (container === null || container === undefined || field === null || field === undefined) {
      throw new Error('popover container or search field is missing');
    }

    return {
      width: Math.round(container.getBoundingClientRect().width),
      fieldHeight: Math.round(field.getBoundingClientRect().height),
      fieldBorder: getComputedStyle(field).borderTopWidth,
    };
  });

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.evaluate(async text => {
    const holder = document.createElement('div');

    holder.id = 'block-tunes-search-layout';
    holder.style.cssText = 'max-width:650px;margin:100px auto';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [{ type: 'paragraph', data: { text } }] },
    });
    await window.blokInstance.isReady;
  }, TEXT);
});

test('block menu keeps its size and search field while results come and go', async ({ page }) => {
  await openBlockTunes(page);
  const popover = page.getByTestId('block-tunes-popover');
  const search = popover.getByRole('combobox');
  const idle = await measure(popover);

  // "a" and "head" pull in Convert to entries; "aa" and "dup" do not.
  for (const [query, convertMatches] of [['a', 1], ['aa', 0], ['a', 1], ['head', 1], ['dup', 0]] as const) {
    await search.fill(query);
    await expect(popover.getByRole('menuitem', { name: 'Heading 1', exact: true })).toHaveCount(convertMatches);

    expect(await measure(popover), `query "${query}"`).toEqual(idle);
  }
});

test('block menu search focuses the first result when Convert to entries match', async ({ page }) => {
  await openBlockTunes(page);
  const popover = page.getByTestId('block-tunes-popover');

  await popover.getByRole('combobox').fill('a');

  await expect(popover.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveAttribute('data-blok-focused', 'true');
});

for (const surface of ['settings', 'inline'] as const) {
  test(`${surface}: the real convert menu keeps its wide layout`, async ({ page }) => {
    const content = page.getByText(TEXT, { exact: true });

    if (surface === 'inline') {
      await selectAllInEditable(content);
      await page.getByTestId('inline-toolbar').getByRole('menuitem', { name: 'Text', exact: true }).click();
    } else {
      await openBlockTunes(page);
      await page.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
    }

    const heading = page.getByRole('menuitem', { name: 'Heading 1', exact: true });

    await expect(heading).toBeVisible();
    await expect.poll(() => heading.evaluate(element =>
      Math.round(element.closest('[data-blok-popover-container]')?.getBoundingClientRect().width ?? 0)
    )).toBe(392);
  });
}

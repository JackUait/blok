import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { openFixtureToggles } from '../helpers/toggle-open';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

type Child = 'list' | 'image' | 'embed';
type Container = 'toggle' | 'callout';

const childBlock = (child: Child): OutputData['blocks'][number] => {
  if (child === 'list') {
    return { id: 'kid', type: 'list', data: { text: 'Nested item', style: 'unordered' }, parent: 'box' };
  }

  if (child === 'image') {
    return { id: 'kid', type: 'image', data: {}, parent: 'box' };
  }

  return {
    id: 'kid',
    type: 'embed',
    data: { service: 'codepen', source: 'https://codepen.io/team/pen/abc123', embed: 'https://codepen.io/abc123?default-tab=result' },
    parent: 'box',
  };
};

const containerBlock = (container: Container): OutputData['blocks'][number] => container === 'toggle'
  ? { id: 'box', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['kid', 'tail'] }
  : { id: 'box', type: 'callout', data: { emoji: '💡' }, content: ['kid', 'tail'] };

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, data }) => {
    const host = document.createElement('div');

    host.id = holder;
    host.style.width = '700px';
    host.style.margin = '40px auto';
    document.body.appendChild(host);

    const blok = new window.Blok({ holder, data: { blocks: data } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data: blocks });
  await openFixtureToggles(page, { blocks });
};

const holder = (page: Page, id: string): ReturnType<Page['locator']> => page.locator(`[data-blok-id="${id}"]`);

/** Background of a block's own content wrapper. */
const ownPaint = (page: Page, id: string): Promise<string> => holder(page, id)
  .evaluate((el) => {
    const content = el.querySelector(':scope > [data-blok-element-content]');

    return content === null ? 'missing' : getComputedStyle(content).backgroundColor;
  });

/** The selection fill as the browser resolves it. */
const selectionColor = (page: Page): Promise<string> => page.evaluate(() => {
  const probe = document.createElement('div');

  probe.style.backgroundColor = 'var(--blok-selection)';
  document.querySelector('[data-blok-interface]')?.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;

  probe.remove();

  return color;
});

/** Lasso from the page margin (outside the editor) across the whole container. */
const lassoOver = async (page: Page, id: string): Promise<void> => {
  const box = await holder(page, id).boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }

  await page.mouse.move(12, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height - 4, { steps: 8 });
  await page.mouse.up();
};

/** Elements inside the nested block painted with the selection fill. */
const nestedSelectionPaints = (page: Page, id: string, fill: string): Promise<string[]> => holder(page, id)
  .evaluate((el, color) => Array.from(el.querySelectorAll<HTMLElement>('*'))
    .flatMap((node) => {
      const own = getComputedStyle(node).backgroundColor === color ? [node.tagName] : [];
      const before = getComputedStyle(node, '::before').backgroundColor === color ? [`${node.tagName}::before`] : [];

      return [...own, ...before];
    }), fill);

test.describe('a selected container paints itself, whatever it holds', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  for (const container of ['toggle', 'callout'] as const) {
    for (const child of ['list', 'image', 'embed'] as const) {
      test(`a ${container} holding ${child === 'image' ? 'an' : 'a'} ${child}`, async ({ page }) => {
        await mount(page, [
          containerBlock(container),
          childBlock(child),
          { id: 'tail', type: 'paragraph', data: { text: 'Plain child line' }, parent: 'box' },
        ]);

        await lassoOver(page, 'box');
        await expect(holder(page, 'box')).toHaveAttribute('data-blok-selected', 'true');

        const fill = await selectionColor(page);

        expect(fill).not.toBe(TRANSPARENT);
        // The content wrapper fades its fill in (transition-colors), so wait for it to settle.
        await expect.poll(() => ownPaint(page, 'box')).toBe(fill);
        // The container's fill already covers its children; a second fill on one of them reads as a different selection.
        expect(await nestedSelectionPaints(page, 'kid', fill)).toEqual([]);
      });
    }
  }
});

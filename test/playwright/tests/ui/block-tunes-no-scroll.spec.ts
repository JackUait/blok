import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const TEXT = 'A block with a long menu';
const MENU = process.platform === 'darwin' ? 'Meta+/' : 'Control+/';
// The menu used to stop at this height and scroll.
const OLD_CAP = 400;

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.evaluate(async text => {
    // Ten extra rows push the menu past the old cap whatever the core rows are.
    class LongMenuBlock {
      private readonly text: string;

      public static get toolbox(): { title: string; icon: string } {
        return { title: 'Long menu', icon: '<svg></svg>' };
      }

      constructor({ data }: { data: { text: string } }) {
        this.text = data.text;
      }

      public render(): HTMLElement {
        const element = document.createElement('div');

        element.contentEditable = 'true';
        element.textContent = this.text;

        return element;
      }

      public renderSettings(): Array<{ title: string; icon: string; onActivate: () => void }> {
        return Array.from({ length: 10 }, (_, index) => ({ title: `Extra ${index + 1}`, icon: '<svg></svg>', onActivate: () => undefined }));
      }

      public save(element: HTMLElement): { text: string } {
        return { text: element.textContent ?? '' };
      }
    }

    const holder = document.createElement('div');

    holder.id = 'block-tunes-no-scroll';
    holder.style.cssText = 'max-width:650px;margin:100px auto';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      tools: { longMenu: LongMenuBlock },
      data: { blocks: [{ type: 'longMenu', data: { text } }] },
    });
    await window.blokInstance.isReady;
  }, TEXT);
});

const openMenu = async (page: Page): Promise<{ overflow: number; height: number }> => {
  await page.getByText(TEXT, { exact: true }).click();
  await page.keyboard.press(MENU);
  const popover = page.getByTestId('block-tunes-popover');

  await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');
  await expect(popover.getByRole('menuitem', { name: 'Extra 10', exact: true })).toBeAttached();
  await popover.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
  });

  return popover.evaluate(element => {
    const container = element.querySelector(':scope > [data-blok-popover-container]');
    const items = container?.querySelector(':scope > [data-blok-popover-items]');

    if (container === null || container === undefined || items === null || items === undefined) {
      throw new Error('popover container or items are missing');
    }

    return { overflow: items.scrollHeight - items.clientHeight, height: container.getBoundingClientRect().height };
  });
};

test('block menu grows to fit its rows instead of scrolling', async ({ page }) => {
  const size = await openMenu(page);

  expect(size.overflow).toBe(0);
  expect(size.height).toBeGreaterThan(OLD_CAP);
});

test('block menu still stays inside a short window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 360 });
  const size = await openMenu(page);

  expect(size.height).toBeLessThanOrEqual(360 - 16);
});

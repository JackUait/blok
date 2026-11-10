import type { Locator, Page } from '@playwright/test';
import type { OutputBlockData, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const IMAGE_URL = 'http://127.0.0.1:4444/test/playwright/fixtures/image/shot.png';

const createBlok = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ holder, initialBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const defaults = (window as unknown as { defaultBlockTools: Record<string, { class: unknown }> }).defaultBlockTools;
    const blok = new window.Blok({
      holder,
      data: { blocks: initialBlocks },
      tools: { image: { class: defaults.image.class } },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialBlocks: blocks });
};

const save = async (page: Page): Promise<OutputData['blocks']> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('Blok instance not found');
  }

  return (await window.blokInstance.save()).blocks;
});

const texts = async (page: Page): Promise<unknown[]> => (await save(page)).map(block => block.data.text);

const input = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`);

const selected = (page: Page): Locator => page.locator('[data-blok-selected="true"]');

// Real key presses: Cmd+C used to count as a printable key and leave navigation mode before copy ran.
test.describe('copy and cut shortcuts in navigation mode', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('Escape then Cmd+C copies the block, and Cmd+V pastes it back', async ({ page }) => {
    await createBlok(page, [
      { id: 'src', type: 'paragraph', data: { text: 'Source <b>para</b>' } },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
    ]);

    const [source] = await texts(page);

    await input(page, 'src').click();
    await page.keyboard.press('Escape');
    await expect(selected(page)).toHaveCount(1);

    await page.evaluate(() => {
      const holder = document.getElementById('blok');

      window.addEventListener('copy', (event) => {
        holder?.setAttribute('data-copied-types', Array.from(event.clipboardData?.types ?? []).join(','));
      }, { once: true });
    });
    await page.keyboard.press('ControlOrMeta+C');

    await expect(selected(page)).toHaveCount(1);
    await expect(page.getByTestId(HOLDER_ID)).toHaveAttribute('data-copied-types', /application\/x-blok/);

    // A second copy still works, and Escape still leaves.
    await page.keyboard.press('ControlOrMeta+C');
    await expect(selected(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(selected(page)).toHaveCount(0);

    await input(page, 'tgt').click();
    await page.keyboard.press('ControlOrMeta+V');

    await expect.poll(() => texts(page)).toEqual([source, source]);
  });

  test('Escape then Cmd+X removes the block, and Cmd+V puts it back', async ({ page }) => {
    await createBlok(page, [
      { id: 'src', type: 'paragraph', data: { text: 'Cut <i>me</i>' } },
      { id: 'keep', type: 'paragraph', data: { text: 'Keep' } },
    ]);

    const [source, keep] = await texts(page);

    await input(page, 'src').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+X');

    await expect.poll(() => texts(page)).toEqual([keep]);

    await input(page, 'keep').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+V');

    await expect.poll(() => texts(page)).toEqual([keep, source]);
  });

  test('Escape, ArrowDown to an image, then Cmd+C and Cmd+V copies the image', async ({ page }) => {
    await createBlok(page, [
      { id: 'start', type: 'paragraph', data: { text: 'Start' } },
      { id: 'img', type: 'image', data: { url: IMAGE_URL, caption: 'Sunset' } },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
    ]);

    const image = page.locator('[data-blok-id="img"][data-blok-selected="true"]');

    await input(page, 'start').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await expect(image).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+C');
    await expect(image).toHaveCount(1);

    await input(page, 'tgt').click();
    await page.keyboard.press('ControlOrMeta+V');

    await expect.poll(async () => (await save(page))
      .filter(block => block.type === 'image')
      .map(block => [block.data.url, block.data.caption])).toEqual([
      [IMAGE_URL, 'Sunset'],
      [IMAGE_URL, 'Sunset'],
    ]);
  });
});

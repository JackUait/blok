import type { Page } from '@playwright/test';
import type { Blok, OutputData, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';

export { ensureBlokBundleBuilt, TEST_PAGE_URL };

export const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

export const resetBlok = async (page: Page): Promise<void> => {
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

export const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

export const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }
    return await window.blokInstance.save();
  });
};

/**
 * Full save -> reload -> save round-trip. Saves the current editor state,
 * re-creates the editor from that data, then returns the freshly re-saved output.
 */
export const reloadFromSave = async (page: Page): Promise<OutputData> => {
  const saved = await saveBlok(page);
  await createBlok(page, saved);
  return await saveBlok(page);
};

/**
 * Returns the OutputBlockData for a given block id, or undefined if absent.
 */
export const findBlock = (saved: OutputData, id: string): OutputBlockData | undefined => {
  return saved.blocks.find((block) => block.id === id);
};

/**
 * Returns the ids of blocks whose `parent` equals `parentId`, in saved-array order.
 */
export const childrenOf = (saved: OutputData, parentId: string): string[] => {
  return saved.blocks
    .filter((block) => block.parent === parentId)
    .map((block) => block.id)
    .filter((id): id is string => id !== undefined);
};

/**
 * Locate the block-wrapper containing `blockText`, focus its first editable
 * content element, select all, and type `newText`.
 */
export const editParagraphLikeText = async (page: Page, blockText: string, newText: string): Promise<void> => {
  const wrapper = page.getByTestId('block-wrapper').filter({ hasText: blockText }).last();
  const content = wrapper.locator('[data-blok-element-content]').first();

  await content.click();

  const isMac = process.platform === 'darwin';
  const selectAll = isMac ? 'Meta+A' : 'Control+A';

  await page.keyboard.press(selectAll);
  await page.keyboard.type(newText);
};

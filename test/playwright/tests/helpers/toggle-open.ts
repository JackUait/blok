import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';

/**
 * Open every fixture toggle and toggle heading marked `isOpen: true`, as if
 * this browser had left it open. A loaded toggle ignores that field and starts
 * collapsed. Opening is personal state, so it adds no undo step.
 * A block without an id is found by its fixture index, which matches the
 * editor's flat order only for fixtures listed parent-first.
 * @param page - page whose `window.blokInstance` holds the editor
 * @param data - the fixture the editor loaded
 */
export const openFixtureToggles = async (page: Page, data: Pick<OutputData, 'blocks'> | null | undefined): Promise<void> => {
  const targets = (data?.blocks ?? [])
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.data?.isOpen === true
      && (block.type === 'toggle' || (block.type === 'header' && block.data.isToggleable === true)))
    .map(({ block, index }) => ({ id: block.id ?? null, index }));

  if (targets.length === 0) {
    return;
  }

  await page.evaluate((toOpen) => {
    const blok = (window as unknown as { blokInstance?: Blok }).blokInstance;

    for (const { id, index } of toOpen) {
      const block = id === null ? blok?.blocks.getBlockByIndex(index) : blok?.blocks.getById(id);

      block?.call('expand');
    }
  }, targets);
};

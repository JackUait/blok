/**
 * Give paint and input a turn; scheduler.yield is optional in Safari/WebViews.
 * @returns promise resolved after the browser has had a scheduling opportunity
 */
const yieldToBrowser = (): Promise<void> => {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;

  return typeof scheduler?.yield === 'function'
    ? scheduler.yield()
    : new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * Keep each rendering slice within eight milliseconds or 25 blocks.
 * @param items - items to process in order
 * @param visit - synchronous work to perform for each item
 * @param cancelled - whether processing should stop before the next item
 */
export async function forEachRenderSlice<T>(
  items: readonly T[],
  visit: (item: T, index: number) => void,
  cancelled: () => boolean = () => false
): Promise<void> {
  const slice = { started: performance.now(), count: 0 };

  for (const [index, item] of items.entries()) {
    if (cancelled()) {
      return;
    }
    visit(item, index);
    slice.count++;
    if (index + 1 < items.length && (slice.count >= 25 || performance.now() - slice.started >= 8)) {
      await yieldToBrowser();
      slice.started = performance.now();
      slice.count = 0;
    }
  }
}

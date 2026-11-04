import type { Page } from '@playwright/test';

/** The element count of a style recalc trace event, 0 for any other event. */
const styledIn = (event: unknown): number => {
  if (typeof event !== 'object' || event === null || !('name' in event) || event.name !== 'UpdateLayoutTree' || !('args' in event)) {
    return 0;
  }
  const { args } = event;

  return typeof args === 'object' && args !== null && 'elementCount' in args && typeof args.elementCount === 'number'
    ? args.elementCount
    : 0;
};

/**
 * How many element styles Chrome computes while `action` runs, read from a
 * trace. An element's pseudo-elements and highlights count as more styles.
 * Chromium only.
 */
export const countStyled = async (page: Page, action: () => Promise<void>): Promise<number> => {
  const cdp = await page.context().newCDPSession(page);
  const events: unknown[] = [];

  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));

  await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  await action();
  await cdp.send('Tracing.end');
  await done;
  await cdp.detach();

  return events.reduce<number>((sum, event) => sum + styledIn(event), 0);
};

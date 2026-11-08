import type { Page } from '@playwright/test';

/** `console.timeStamp` labels that bracket the work `countStyled` counts with `{ marked: true }`. */
export const STYLE_MARK_START = 'blok-style-count-start';
export const STYLE_MARK_END = 'blok-style-count-end';

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

const tsOf = (event: unknown): number =>
  typeof event === 'object' && event !== null && 'ts' in event && typeof event.ts === 'number' ? event.ts : Number.NaN;

/** The time of the `console.timeStamp(label)` event. */
const markAt = (events: unknown[], label: string): number => {
  const mark = events.find((event) => {
    if (typeof event !== 'object' || event === null || !('name' in event) || event.name !== 'TimeStamp' || !('args' in event)) {
      return false;
    }
    const { args } = event;

    return typeof args === 'object' && args !== null && 'data' in args && typeof args.data === 'object' && args.data !== null
      && 'message' in args.data && args.data.message === label;
  });

  if (mark === undefined) {
    throw new Error(`no console.timeStamp('${label}') in the trace`);
  }

  return tsOf(mark);
};

/**
 * How many element styles Chrome computes while `action` runs, read from a
 * trace. An element's pseudo-elements and highlights count as more styles.
 * With `marked`, counts only the recalcs between `console.timeStamp(STYLE_MARK_START)`
 * and `console.timeStamp(STYLE_MARK_END)`, so a restyle the page runs on its own
 * meanwhile (a lazy sheet landing) is left out. Chromium only.
 */
export const countStyled = async (page: Page, action: () => Promise<void>, { marked = false } = {}): Promise<number> => {
  const cdp = await page.context().newCDPSession(page);
  const events: unknown[] = [];

  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));

  await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  await action();
  await cdp.send('Tracing.end');
  await done;
  await cdp.detach();

  if (!marked) {
    return events.reduce<number>((sum, event) => sum + styledIn(event), 0);
  }
  const start = markAt(events, STYLE_MARK_START);
  const end = markAt(events, STYLE_MARK_END);

  return events
    .filter((event) => tsOf(event) >= start && tsOf(event) <= end)
    .reduce<number>((sum, event) => sum + styledIn(event), 0);
};

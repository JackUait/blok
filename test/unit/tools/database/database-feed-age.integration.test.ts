import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA, buildTool, fakeRow, makeDoc, tableData } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const rerender = (tool: unknown): void => {
  (tool as { rerenderView: () => void }).rerenderView();
};

// research/36 §10: the byline age updates live, from one timer shared by every feed.
describe('Feed byline age in the database', () => {
  const now = new Date(2026, 9, 22, 9, 35, 0).getTime();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const feed = (createdAt = now - 55_000): ReturnType<typeof buildTool> => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'F1' }, 'a0')]);
    const block = doc.rows.get('a')?.block as unknown as { createdBy?: string; createdAt?: number };

    block.createdBy = 'u1';
    block.createdAt = createdAt;

    return buildTool(doc, {}, tableData(SCHEMA, { type: 'feed' }));
  };

  it('turns "Just now" into "1m" with the page left open', () => {
    const { tool, el } = feed();
    const time = (): string | null | undefined => el.querySelector('[data-blok-database-feed-time]')?.textContent;

    expect(time()).toBe('tools.database.feedJustNow');
    vi.advanceTimersByTime(30_000);
    expect(time()).toBe('1m');
    tool.destroy();
  });

  // research/36 §10: every card changed on the same wall-clock second, so the tick is the app's, not each view's.
  it('ticks every feed on the same clock, whenever each one mounted', () => {
    const first = feed();

    vi.advanceTimersByTime(20_000);
    const second = feed(Date.now() - 55_000);
    const time = (): string | null | undefined => second.el.querySelector('[data-blok-database-feed-time]')?.textContent;

    expect(time()).toBe('tools.database.feedJustNow');
    vi.advanceTimersByTime(10_000);
    expect(time()).toBe('1m');
    first.tool.destroy();
    second.tool.destroy();
  });

  it('leaves no timer behind after redraws and destroy', () => {
    const base = vi.getTimerCount();
    const { tool } = feed();

    vi.runOnlyPendingTimers();
    const running = vi.getTimerCount();

    rerender(tool);
    rerender(tool);
    vi.runOnlyPendingTimers();
    expect(vi.getTimerCount()).toBe(running);
    tool.destroy();
    vi.runOnlyPendingTimers();
    expect(vi.getTimerCount()).toBe(base);
  });
});

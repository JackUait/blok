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

// research/36 §10: the byline age updates live, from one timer per feed view.
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

  const feed = (): ReturnType<typeof buildTool> => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'F1' }, 'a0')]);
    const block = doc.rows.get('a')?.block as unknown as { createdBy?: string; createdAt?: number };

    block.createdBy = 'u1';
    block.createdAt = now - 55_000;

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

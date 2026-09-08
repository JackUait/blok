import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The engine requires a real Range, so the façade must not call it without one.
vi.mock('../../../../../src/components/marks/mark-engine', () => ({
  applyMark: vi.fn(() => []),
  findMark: vi.fn(() => null),
  hasMark: vi.fn(() => false),
  readMark: vi.fn(() => null),
  removeMark: vi.fn(() => []),
  toggleMark: vi.fn(() => true),
}));

import { MarksAPI } from '../../../../../src/components/modules/api/marks';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../../src/components/events';
import type * as MarkEngine from '../../../../../src/components/marks/mark-engine';
import type { MarkSpec } from '@/types/api';

/**
 * Mutant notes for src/components/modules/api/marks.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

const BOLD: MarkSpec = { tag: 'B' };

const makeApi = (): MarksAPI => new MarksAPI({
  config: {},
  eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
});

const engine = async (): Promise<typeof MarkEngine> =>
  import('../../../../../src/components/marks/mark-engine');

describe('MarksAPI range-guarded delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('reports no toggle and leaves the engine alone without a range', async () => {
    const { toggleMark } = await engine();

    expect(makeApi().toggle(BOLD)).toBe(false);
    expect(vi.mocked(toggleMark).mock.calls).toStrictEqual([]);
  });

  it('toggles through the engine on an explicit range', async () => {
    const { toggleMark } = await engine();
    const host = document.createElement('div');

    host.textContent = 'hello';
    document.body.appendChild(host);

    const range = document.createRange();

    range.selectNodeContents(host);

    expect(makeApi().toggle(BOLD, undefined, range)).toBe(true);
    expect(vi.mocked(toggleMark).mock.calls).toStrictEqual([[BOLD, undefined, range]]);
  });

  it('removes through the engine on an explicit range', async () => {
    const { removeMark } = await engine();
    const host = document.createElement('div');

    host.textContent = 'hello';
    document.body.appendChild(host);

    const wrapper = document.createElement('b');

    vi.mocked(removeMark).mockReturnValue([wrapper]);

    const range = document.createRange();

    range.selectNodeContents(host);

    expect(makeApi().remove(BOLD, range)).toStrictEqual([wrapper]);
    expect(vi.mocked(removeMark).mock.calls).toStrictEqual([[BOLD, range]]);
  });

  it('removes nothing and leaves the engine alone without a range', async () => {
    const { removeMark } = await engine();

    expect(makeApi().remove(BOLD)).toStrictEqual([]);
    expect(vi.mocked(removeMark).mock.calls).toStrictEqual([]);
  });

  it('toggles through the engine on the live selection', async () => {
    const { toggleMark } = await engine();
    const host = document.createElement('div');

    host.textContent = 'hello';
    document.body.appendChild(host);

    const range = document.createRange();

    range.selectNodeContents(host);

    const selection = window.getSelection();

    if (selection === null) {
      throw new Error('jsdom returned no selection');
    }

    selection.addRange(range);

    expect(makeApi().toggle(BOLD)).toBe(true);
    expect(vi.mocked(toggleMark).mock.calls).toStrictEqual([[BOLD, undefined, selection.getRangeAt(0)]]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onHover } from '../../../../src/components/utils/tooltip';
import { DatabaseBoardView } from '../../../../src/tools/database/database-board-view';
import type { I18n } from '../../../../types';

vi.mock('../../../../src/components/utils/tooltip', () => ({ onHover: vi.fn(), show: vi.fn(), hide: vi.fn() }));

const i18n: I18n = {
  t: (key: string) => key,
  has: () => true,
  getEnglishTranslation: () => '',
  getLocale: () => 'en',
};

const countOf = (board: HTMLElement): HTMLElement | null => board.querySelector<HTMLElement>('[data-blok-database-column-count]');

const hintsOn = (el: HTMLElement | null): unknown[] => vi.mocked(onHover).mock.calls.filter(([target]) => target === el).map(([, content]) => content);

describe('DatabaseBoardView column count hint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // research/23 §2a: Notion's "99+" button shows no tooltip with Count all.
  it('gives the count no hover hint when no calculation hint is set', () => {
    const view = new DatabaseBoardView({ readOnly: false, i18n, options: [{ id: 'opt-1', label: 'To Do', position: 'a0' }], getRows: () => [], titlePropertyId: 'title', aggregate: () => '99+' });
    const count = countOf(view.createView());

    expect(count?.textContent).toBe('99+');
    expect(hintsOn(count)).toEqual([]);
  });

  it('keeps the hint for a property calculation', () => {
    const view = new DatabaseBoardView({ readOnly: false, i18n, options: [{ id: 'opt-1', label: 'To Do', position: 'a0' }], getRows: () => [], titlePropertyId: 'title', aggregate: () => '12', aggregateHint: 'Sum in Points' });
    const count = countOf(view.createView());

    expect(hintsOn(count)).toEqual(['Sum in Points']);
  });

  // research/30 B26: "Latest date in Due date" sits above the value, centred on it.
  it('shows the calculation hint above the value with the default hint delay', () => {
    const view = new DatabaseBoardView({ readOnly: false, i18n, options: [{ id: 'opt-1', label: 'To Do', position: 'a0' }], getRows: () => [], titlePropertyId: 'title', aggregate: () => '04/16/2025', aggregateHint: 'Latest date in Due date' });
    const count = countOf(view.createView());
    const call = vi.mocked(onHover).mock.calls.find(([target]) => target === count);

    expect(call?.[2]).toEqual({ placement: 'top' });
  });

  it('puts the hint above the value in a sub-grouped board too', () => {
    const view = new DatabaseBoardView({
      readOnly: false, i18n, options: [{ id: 'opt-1', label: 'To Do', position: 'a0' }], getRows: () => [], titlePropertyId: 'title',
      aggregate: () => '04/16/2025', aggregateHint: 'Latest date in Due date', subGroups: [{ key: 'high', label: 'High' }],
    });
    const count = countOf(view.createView());
    const call = vi.mocked(onHover).mock.calls.find(([target]) => target === count);

    expect(call?.[2]).toEqual({ placement: 'top' });
  });
});

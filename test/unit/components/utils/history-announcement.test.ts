import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const announceMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/components/utils/announcer', () => ({ announce: announceMock }));

import { announceHistoryPress } from '../../../../src/components/utils/history-announcement';

describe('announceHistoryPress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['undo', true, 'a11y.undone'],
    ['redo', true, 'a11y.redone'],
    ['undo', false, 'a11y.nothingToUndo'],
    ['redo', false, 'a11y.nothingToRedo'],
  ] as const)('puts the %s text (applied: %s) in the history group', (direction, applied, key) => {
    announceHistoryPress((k) => k, direction, applied);

    expect(announceMock).toHaveBeenCalledWith(key, { group: 'history' });
  });
});

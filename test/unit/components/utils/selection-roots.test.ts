import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { announceDeletedRoots, selectionRoots } from '../../../../src/components/utils/selection-roots';
import { announce } from '../../../../src/components/utils/announcer';

vi.mock('../../../../src/components/utils/announcer', () => ({ announce: vi.fn() }));

const i18n = {
  t: (key: string, vars?: Record<string, string | number>): string => `${key}:${String(vars?.count)}`,
  has: (): boolean => true,
};

const block = (id: string, parentId: string | null = null): { id: string; parentId: string | null } => ({ id, parentId });

describe('selection roots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Notion U135: a selected toggle with two children is one block.
  it('leaves out blocks whose parent is selected too', () => {
    expect(selectionRoots([block('tg'), block('k1', 'tg'), block('k2', 'tg'), block('b')]).map(({ id }) => id)).toEqual(['tg', 'b']);
  });

  it('keeps a block whose parent is not selected', () => {
    expect(selectionRoots([block('k1', 'tg')]).map(({ id }) => id)).toEqual(['k1']);
  });

  it('announces how many of the roots are gone', () => {
    announceDeletedRoots(i18n, [block('a'), block('b'), block('c')], (id) => id === 'c');

    expect(vi.mocked(announce)).toHaveBeenCalledWith('a11y.blocksDeleted:2');
  });

  it('says nothing when no root was deleted', () => {
    announceDeletedRoots(i18n, [block('a')], () => true);

    expect(vi.mocked(announce)).not.toHaveBeenCalled();
  });
});

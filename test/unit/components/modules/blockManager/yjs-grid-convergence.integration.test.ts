import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { YjsManager } from '../../../../../src/components/modules/yjs';

/**
 * Task 7 convergence completion (deferred from Wave 2): per-cell grid merges
 * across TWO full editors' stores, exchanged through the binary seam. The
 * per-cell representation (Y.Array rows → Y.Array cells → Y.Map cell) is what
 * lets concurrent edits to DIFFERENT cells of the same table both survive.
 */

interface CellShape {
  blocks: string[];
}

const grid = (): CellShape[][] => [
  [{ blocks: ['c00'] }, { blocks: ['c01'] }],
  [{ blocks: ['c10'] }, { blocks: ['c11'] }],
];

const createManager = (): YjsManager => new YjsManager({
  config: {},
  eventsDispatcher: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as YjsManager['eventsDispatcher'],
});

/**
 * Exchange diffs computed against each peer's PRE-exchange state vector,
 * then apply both — Yjs guarantees convergence from the shared op set.
 */
const sync = (a: YjsManager, b: YjsManager): void => {
  const updateForB = a.encodeStateAsUpdate(b.getStateVector());
  const updateForA = b.encodeStateAsUpdate(a.getStateVector());

  b.applyRemoteUpdate(updateForB);
  a.applyRemoteUpdate(updateForA);
};

const readGrid = (manager: YjsManager): CellShape[][] => {
  const table = manager.toJSON().find((block) => block.id === 't1');

  if (table === undefined) {
    throw new Error('table block t1 missing from toJSON()');
  }

  return table.data.content as CellShape[][];
};

describe('per-cell grid convergence — two editors, one table, via the binary seam', () => {
  let managerA: YjsManager;
  let managerB: YjsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    managerA = createManager();
    managerB = createManager();

    // Single-seeder law: only A loads; B receives the doc through the seam.
    managerA.fromJSON([{ id: 't1', type: 'table', data: { content: grid() } }]);
    managerB.applyRemoteUpdate(managerA.encodeStateAsUpdate());
  });

  afterEach(() => {
    managerA.destroy();
    managerB.destroy();
    vi.restoreAllMocks();
  });

  it('concurrent edits to DIFFERENT cells of the same table merge — both values survive on both docs', () => {
    const gridA = grid();

    gridA[0][0] = { blocks: ['edited-by-A'] };
    managerA.updateBlockData('t1', 'content', gridA);

    const gridB = grid();

    gridB[1][1] = { blocks: ['edited-by-B'] };
    managerB.updateBlockData('t1', 'content', gridB);

    sync(managerA, managerB);

    expect(managerA.toJSON()).toEqual(managerB.toJSON());

    const merged = readGrid(managerA);

    expect(merged[0][0].blocks).toEqual(['edited-by-A']);
    expect(merged[1][1].blocks).toEqual(['edited-by-B']);
    expect(merged[0][1].blocks).toEqual(['c01']);
    expect(merged[1][0].blocks).toEqual(['c10']);
  });

  it('concurrent same-cell same-key edits: exactly one writer wins, identically on both docs', () => {
    const gridA = grid();

    gridA[0][0] = { blocks: ['A-wins'] };
    managerA.updateBlockData('t1', 'content', gridA);

    const gridB = grid();

    gridB[0][0] = { blocks: ['B-wins'] };
    managerB.updateBlockData('t1', 'content', gridB);

    sync(managerA, managerB);

    expect(managerA.toJSON()).toEqual(managerB.toJSON());

    const cellA = readGrid(managerA)[0][0].blocks;
    const cellB = readGrid(managerB)[0][0].blocks;

    // The winner is decided by clientID (random per doc) — never pin WHICH
    // side wins, only that both docs agree on ONE of the two writes.
    expect(cellA).toEqual(cellB);
    expect([['A-wins'], ['B-wins']]).toContainEqual(cellA);

    // The untouched cells survive the conflict untouched.
    const merged = readGrid(managerA);

    expect(merged[0][1].blocks).toEqual(['c01']);
    expect(merged[1][0].blocks).toEqual(['c10']);
    expect(merged[1][1].blocks).toEqual(['c11']);
  });
});

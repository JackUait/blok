import { describe, expect, it } from 'vitest';
import { repairMergeGrid } from '../../../src/shared/table-merge-repair';
import type { MergeRepairCell } from '../../../src/shared/table-merge-repair';

const plain = (...blocks: string[]): MergeRepairCell => ({ blocks });

describe('repairMergeGrid', () => {
  it('clamps a span to the grid edge and covers only slots that exist', () => {
    const repaired = repairMergeGrid([
      [{ blocks: ['o'], colspan: 5, rowspan: 4 }, plain()],
      [plain(), plain('d')],
    ]);

    expect(repaired).toStrictEqual([
      [{ blocks: ['o', 'd'], colspan: 2, rowspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [], mergedInto: [0, 0] }, { blocks: [], mergedInto: [0, 0] }],
    ]);
  });

  it('shrinks a later span away from a slot an earlier span already claims', () => {
    const repaired = repairMergeGrid([
      [plain('a'), { blocks: ['b'], rowspan: 2 }, plain('x')],
      [{ blocks: ['c'], colspan: 3 }, { blocks: [], mergedInto: [0, 1] }, plain('y')],
    ]);

    expect(repaired[1][0]).toStrictEqual({ blocks: ['c'] });
    expect(repaired[1][1]).toStrictEqual({ blocks: [], mergedInto: [0, 1] });
    expect(repaired[1][2]).toStrictEqual({ blocks: ['y'] });
  });

  it('stops a rowspan at a ragged row that has no slot for the span', () => {
    const repaired = repairMergeGrid([
      [{ blocks: ['o'], colspan: 2, rowspan: 3 }, plain('a')],
      [plain('b')],
      [plain('c'), plain('d')],
    ]);

    expect(repaired).toStrictEqual([
      [{ blocks: ['o', 'a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: ['b'] }],
      [{ blocks: ['c'] }, { blocks: ['d'] }],
    ]);
  });

  it('frees a mergedInto that no live span backs and keeps its blocks', () => {
    const repaired = repairMergeGrid([
      [plain('o'), { blocks: ['y'], mergedInto: [0, 0] }],
      [plain(), { blocks: [], mergedInto: [5, 5] }],
    ]);

    expect(repaired).toStrictEqual([
      [{ blocks: ['o'] }, { blocks: ['y'] }],
      [{ blocks: [] }, { blocks: [] }],
    ]);
  });

  it('does not change its input and is stable on a second pass', () => {
    const input = [
      [{ blocks: ['o'], colspan: 3 }, plain('a')],
      [plain('b'), { blocks: ['c'], mergedInto: [0, 0] as [number, number] }],
    ];
    const before = JSON.parse(JSON.stringify(input)) as unknown;
    const once = repairMergeGrid(input);

    expect(input).toStrictEqual(before);
    expect(repairMergeGrid(once)).toStrictEqual(once);
  });
});

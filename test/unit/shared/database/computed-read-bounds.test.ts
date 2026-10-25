// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputedProperties } from '../../../../src/shared/database/computed-properties';
import { MAX_RELATED_DATABASES, createComputedReader } from '../../../../src/shared/database/computed-read';

import type { ComputedReadBlock } from '../../../../src/shared/database/computed-read';

const SIZE = 10;

/** `size` databases; each relates to the next and rolls up its formula. `ring` closes the chain into a cycle. */
const related = (ring: boolean, rowsEach = 1, size = SIZE): Map<string, ComputedReadBlock> => {
  const blocks = new Map<string, ComputedReadBlock>();

  for (let i = 0; i < size; i++) {
    const wrap = ring ? 'db0' : undefined;
    const next = i + 1 < size ? `db${i + 1}` : wrap;
    const rowIds = Array.from({ length: rowsEach }, (_, r) => `db${i}-r${r}`);

    blocks.set(`db${i}`, {
      type: 'database',
      content: rowIds,
      data: {
        schema: [
          { id: 't', name: 'Name', type: 'title', position: 'a0' },
          { id: 'n', name: 'N', type: 'number', position: 'a1' },
          { id: 'f', name: 'F', type: 'formula', position: 'a2', formula: { expression: 'prop("N") + 1' } },
          ...(next === undefined ? [] : [
            { id: 'rel', name: 'Next', type: 'relation', position: 'a3', relation: { targetDatabaseId: next } },
            { id: 'ru', name: 'Sum', type: 'rollup', position: 'a4', rollup: { relationPropertyId: 'rel', targetPropertyId: 'f', function: 'sum' } },
            { id: 'rn', name: 'Sum N', type: 'rollup', position: 'a5', rollup: { relationPropertyId: 'rel', targetPropertyId: 'n', function: 'sum' } },
          ]),
        ],
      },
    });
    rowIds.forEach((id, r) => blocks.set(id, {
      type: 'database-row',
      content: [],
      data: { position: `a${r}`, properties: { n: i, ...(next === undefined ? {} : { rel: [{ id: `${next}-r0` }] }) } },
    }));
  }

  return blocks;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computed reads over related databases do bounded work', () => {
  it('works out each database of a chain once', () => {
    const apply = vi.spyOn(ComputedProperties.prototype, 'apply');
    const blocks = related(false);
    const read = createComputedReader(id => blocks.get(id));

    for (let i = 0; i < SIZE; i++) {
      expect(read(`db${i}-r0`, `db${i}`), `db${i}`).toBeDefined();
    }

    expect(apply.mock.calls.length).toBe(SIZE);
    expect(read('db0-r0', 'db0')).toMatchObject({ f: 1, ru: 2, rn: 1 });
  });

  it('works out each database of a cycle once, the same whichever is read first, and marks what the cycle hides', () => {
    const apply = vi.spyOn(ComputedProperties.prototype, 'apply');
    const blocks = related(true);
    const first = createComputedReader(id => blocks.get(id));
    const fromFirst = Array.from({ length: SIZE }, (_, i) => first(`db${i}-r0`, `db${i}`));

    expect(apply.mock.calls.length).toBe(SIZE);
    const last = createComputedReader(id => blocks.get(id));
    const fromLast = Array.from({ length: SIZE }, (_, i) => SIZE - 1 - i)
      .map(i => last(`db${i}-r0`, `db${i}`)).reverse();

    expect(fromLast).toEqual(fromFirst);
    // A rollup of a stored number still reads; one of a formula inside the cycle cannot.
    expect(fromFirst[0]).toMatchObject({ f: 1, rel: [{ id: 'db1-r0' }], rn: 1, ru: { unavailable: expect.stringMatching(/cycle|depends on/i) } });
  });

  it('marks every value of a read too large to work out, instead of working it out', () => {
    const apply = vi.spyOn(ComputedProperties.prototype, 'apply');
    const blocks = related(false, 1001);
    const read = createComputedReader(id => blocks.get(id));

    expect(read('db0-r0', 'db0')).toMatchObject({ f: { unavailable: expect.stringMatching(/too large/i) } });
    expect(apply.mock.calls.length).toBeLessThan(SIZE);
  });

  it('marks a read that follows too many related databases, without following them all', () => {
    const apply = vi.spyOn(ComputedProperties.prototype, 'apply');
    const blocks = related(false, 1, MAX_RELATED_DATABASES + 20);
    const read = createComputedReader(id => blocks.get(id));

    expect(read('db0-r0', 'db0')).toMatchObject({ f: { unavailable: expect.stringMatching(/too large/i) } });
    expect(apply).not.toHaveBeenCalled();
  });
});

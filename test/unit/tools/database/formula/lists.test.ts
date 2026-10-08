import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileFormula } from '../../../../../src/tools/database/formula';
import { compileError, run, schema } from './helpers';

describe('formula list functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['at([1, 2, 3], 1)', 2],
    ['at([1, 2, 3], -1)', 3],
    ['first([1, 2, 3])', 1],
    ['last([1, 2, 3])', 3],
    ['slice([1, 2, 3], 1, 2)', [2]],
    ['slice(["a", "b", "c"], 1)', ['b', 'c']],
    ['concat([1, 2], [3, 4])', [1, 2, 3, 4]],
    ['concat(["a", "b"], ["c", "d"])', ['a', 'b', 'c', 'd']],
    ['sort([3, 1, 2])', [1, 2, 3]],
    ['sort(["b", "c", "a"])', ['a', 'b', 'c']],
    ['reverse(["green", "eggs", "ham"])', ['ham', 'eggs', 'green']],
    ['unique([1, 1, 2])', [1, 2]],
    ['includes(["a", "b", "c"], "b")', true],
    ['includes([1, 2, 3], 4)', false],
    ['find(["a", "b", "c"], current == "b")', 'b'],
    ['findIndex(["a", "b", "c"], current == "b")', 1],
    ['findIndex([1, 2, 3], current > 100)', -1],
    ['filter([1, 2, 3], current > 1)', [2, 3]],
    ['filter(["a", "b", "c"], current == "a")', ['a']],
    ['some([1, 2, 3], current == 2)', true],
    ['some(["a", "b", "c"], current.length > 2)', false],
    ['every([1, 2, 3], current > 0)', true],
    ['every(["a", "b", "c"], current == "b")', false],
    ['map([1, 2, 3], current + 1)', [2, 3, 4]],
    ['map([1, 2, 3], current + index)', [1, 3, 5]],
    ['flat([1, 2, 3])', [1, 2, 3]],
    ['flat([[1, 2], [3, 4]])', [1, 2, 3, 4]],
    ['[1, 2, 3].map(current * 2).filter(current > 2).length()', 2],
    ['map([[1, 2], [3]], current.map(current * 10))', [[10, 20], [30]]],
    ['unique([[1], [1], [2]])', [[1], [2]]],
  ])('%s = %j', (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it('returns empty when find has no match or at is out of range', () => {
    expect(run('find([1, 2, 3], current > 100)')).toBeNull();
    expect(run('at([1], 5)')).toBeNull();
    expect(run('first([])')).toBeNull();
  });

  it('sorts empty values last', () => {
    expect(run('sort([2, empty(), 1])')).toEqual([1, 2, null]);
  });

  it('types the element of a list function', () => {
    const compiled = compileFormula('[1, 2].first()', schema);

    expect(compiled.ok && compiled.resultType).toEqual({ kind: 'number' });
  });

  it.each([
    ['current', '"current" can only be used inside a list function'],
    ['index + 1', '"index" can only be used inside a list function'],
    ['map(1, current)', 'Argument 1 of map() expects a list, got Number'],
    ['filter([1], current + 1)', 'filter() needs a condition that returns Boolean, got Number'],
    ['includes([1], "a")', 'Argument 2 of includes() expects Number, got Text'],
    ['first(1)', 'Argument 1 of first() expects a list, got Number'],
  ])('%s fails with "%s"', (source, message) => {
    expect(compileError(source)).toBe(message);
  });
});

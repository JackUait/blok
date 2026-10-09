import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addRelated,
  relationIdsOf,
  removeRelated,
  withoutMissing,
} from '../../../../src/tools/database/relation-values';

describe('relation values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads row ids from id objects and from bare ids written by hand', () => {
    expect(relationIdsOf([{ id: 'r1' }, { id: 'r2' }])).toEqual(['r1', 'r2']);
    expect(relationIdsOf(['r1'])).toEqual(['r1']);
    expect(relationIdsOf(null)).toEqual([]);
    expect(relationIdsOf(undefined)).toEqual([]);
  });

  it('drops a duplicate id, so a merged list that names a row twice shows it once', () => {
    expect(relationIdsOf([{ id: 'r1' }, { id: 'r1' }, { id: 'r2' }])).toEqual(['r1', 'r2']);
  });

  it('adds a row as an id object at the end', () => {
    expect(addRelated([{ id: 'r1' }], 'r2', null)).toEqual([{ id: 'r1' }, { id: 'r2' }]);
  });

  it('keeps a row that is already there in place', () => {
    expect(addRelated([{ id: 'r1' }, { id: 'r2' }], 'r1', null)).toEqual([{ id: 'r1' }, { id: 'r2' }]);
  });

  it('replaces the row when the limit is one page', () => {
    expect(addRelated([{ id: 'r1' }], 'r2', 1)).toEqual([{ id: 'r2' }]);
  });

  it('removes a row', () => {
    expect(removeRelated([{ id: 'r1' }, { id: 'r2' }], 'r1')).toEqual([{ id: 'r2' }]);
  });

  it('leaves out rows that no longer exist', () => {
    expect(withoutMissing([{ id: 'r1' }, { id: 'gone' }], new Set(['r1']))).toEqual(['r1']);
  });
});

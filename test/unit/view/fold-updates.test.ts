// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { foldUpdates } from '../../../src/view';

import type { UpdateBlock, UpdateRecord, UpdateRow } from '../../../types/view';

const SEC = 1000;
const NOW = Date.UTC(2026, 10, 9, 14, 0);
const ago = (ms: number): number => NOW - ms;
const p = (id: string, text: string) => ({ id, type: 'paragraph', data: { text } });
const changed = (id: string, before: string, after: string): UpdateBlock =>
  ({ id, type: 'paragraph', kind: 'changed', before: p(id, before), after: p(id, after) });

const typed = (sequence: number, secondsAgo: number, extra: Partial<UpdateRow> = {}, record: Partial<UpdateRecord> = {}): UpdateRow => ({
  lineage: 'L',
  sequence: 30,
  truncated: false,
  ...extra,
  record: { sequence, committedAt: ago(secondsAgo * SEC), actor: 'anna', blocks: [], page: ['values.title'], ...record },
});

describe('foldUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('folds a typing run by one person in one version into one entry', () => {
    const run = Array.from({ length: 20 }, (_, index) => typed(40 - index, 10 + index * 5));
    const folded = foldUpdates(run);

    expect(folded).toHaveLength(1);
    expect(folded[0].record.sequence).toBe(40);
    expect(folded[0].record.committedAt).toBe(run[0].record.committedAt);
    expect(folded[0].record.page).toEqual(['values.title']);
    expect(folded[0].sequence).toBe(30);
  });

  it('names each entry by its lineage and newest record, and lists its blocks', () => {
    const [entry] = foldUpdates([
      typed(5, 0, {}, { blocks: [changed('b', 'x', 'y')] }),
      typed(4, 10, {}, { blocks: [changed('a', 'x', 'y'), changed('b', 'w', 'x')] }),
    ]);

    expect(entry.key).toBe('L:5');
    expect(entry.blockIds).toEqual(['a', 'b']);
  });

  it('measures the gap between neighbours, not from the newest record', () => {
    expect(foldUpdates([typed(3, 0), typed(2, 100), typed(1, 200)])).toHaveLength(1);
    expect(foldUpdates([typed(2, 0), typed(1, 120)])).toHaveLength(2);
  });

  it('takes the gap from the caller', () => {
    expect(foldUpdates([typed(3, 0), typed(2, 270), typed(1, 540)], { gapMs: 5 * 60 * SEC })).toHaveLength(1);
    expect(foldUpdates([typed(2, 0), typed(1, 30)], { gapMs: 30 * SEC })).toHaveLength(2);
  });

  it('keeps other people, other versions and undated or anonymous records apart', () => {
    expect(foldUpdates([typed(2, 0), typed(1, 10, {}, { actor: 'ben' })])).toHaveLength(2);
    expect(foldUpdates([typed(2, 0), typed(1, 10, { sequence: 20 })])).toHaveLength(2);
    expect(foldUpdates([typed(2, 0), typed(1, 10, { lineage: 'K' })])).toHaveLength(2);
    expect(foldUpdates([typed(2, 0), typed(1, 10, {}, { committedAt: null })])).toHaveLength(2);
    expect(foldUpdates([typed(2, 0, {}, { actor: null }), typed(1, 10, {}, { actor: null })])).toHaveLength(2);
  });

  it('drops records that change nothing a reader can see', () => {
    const folded = foldUpdates([
      typed(3, 0, {}, { page: [] }),
      typed(2, 10, {}, { page: undefined }),
      typed(1, 20),
    ]);

    expect(folded.map((entry) => entry.key)).toEqual(['L:1']);
  });

  it('combines blocks: oldest before, newest after, and the kind of the whole run', () => {
    const oldest = typed(1, 20, {}, { page: ['title'], blocks: [
      changed('a', 'one', 'two'),
      { id: 'b', type: 'paragraph', kind: 'added', after: p('b', 'new') },
      { id: 'c', type: 'paragraph', kind: 'added', after: p('c', 'x') },
      { id: 'd', type: 'paragraph', kind: 'moved', before: p('d', 'd'), after: p('d', 'd') },
      changed('e', 'e', 'e2'),
    ] });
    const newest = typed(2, 0, {}, { page: ['values.k'], blocks: [
      changed('a', 'two', 'three'),
      { id: 'b', type: 'paragraph', kind: 'removed', before: p('b', 'new') },
      changed('c', 'x', 'y'),
      changed('d', 'd', 'd!'),
      { id: 'e', type: 'paragraph', kind: 'removed', before: p('e', 'e2') },
      { id: 'f', type: 'paragraph', kind: 'added', after: p('f', 'f') },
    ] });
    const [folded] = foldUpdates([newest, oldest]);

    expect(folded.record.blocks).toEqual([
      { id: 'a', type: 'paragraph', kind: 'changed', before: p('a', 'one'), after: p('a', 'three') },
      { id: 'c', type: 'paragraph', kind: 'added', after: p('c', 'y') },
      { id: 'd', type: 'paragraph', kind: 'changed', before: p('d', 'd'), after: p('d', 'd!') },
      { id: 'e', type: 'paragraph', kind: 'removed', before: p('e', 'e') },
      { id: 'f', type: 'paragraph', kind: 'added', after: p('f', 'f') },
    ]);
    expect(folded.blockIds).toEqual(['a', 'c', 'd', 'e', 'f']);
    expect(folded.record.page).toEqual(['title', 'values.k']);
  });

  it('keeps the truncation note when any folded record carried it', () => {
    expect(foldUpdates([typed(2, 0), typed(1, 10, { truncated: true })])[0].truncated).toBe(true);
    expect(foldUpdates([typed(1, 0, { truncated: undefined })])[0].truncated).toBe(false);
  });
});

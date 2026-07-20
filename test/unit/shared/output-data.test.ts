import { describe, expect, it } from 'vitest';

import { equalsOutputData, isEmptyOutputData, normalizeOutputBlocks } from '../../../src/shared/output-data';

import type { OutputData } from '../../../types';

const doc = (blocks: OutputData['blocks']): OutputData => ({
  time: 1000,
  version: '1.0.0',
  blocks,
});

describe('equalsOutputData', () => {
  it('treats documents with identical blocks as equal regardless of time and version', () => {
    const a = { time: 1, version: '1.0.0', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Hello' } }] };
    const b = { time: 2, version: '2.0.0', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Hello' } }] };

    expect(equalsOutputData(a, b)).toBe(true);
  });

  it('detects differing block content', () => {
    const a = doc([{ id: 'b1', type: 'paragraph', data: { text: 'Hello' } }]);
    const b = doc([{ id: 'b1', type: 'paragraph', data: { text: 'Changed' } }]);

    expect(equalsOutputData(a, b)).toBe(false);
  });

  it('detects differing block ids', () => {
    const a = doc([{ id: 'b1', type: 'paragraph', data: { text: 'Hello' } }]);
    const b = doc([{ id: 'b2', type: 'paragraph', data: { text: 'Hello' } }]);

    expect(equalsOutputData(a, b)).toBe(false);
  });

  it('compares deeply nested block data structurally', () => {
    const a = doc([{ id: 't1', type: 'table', data: { content: [['a', 'b'], ['c', 'd']] } }]);
    const b = doc([{ id: 't1', type: 'table', data: { content: [['a', 'b'], ['c', 'd']] } }]);
    const c = doc([{ id: 't1', type: 'table', data: { content: [['a', 'b'], ['c', 'x']] } }]);

    expect(equalsOutputData(a, b)).toBe(true);
    expect(equalsOutputData(a, c)).toBe(false);
  });

  it('treats nullish documents and empty documents as equal', () => {
    expect(equalsOutputData(undefined, { blocks: [] })).toBe(true);
    expect(equalsOutputData(null, undefined)).toBe(true);
    expect(equalsOutputData({ blocks: [] }, null)).toBe(true);
  });

  it('does not equate a nullish document with real content', () => {
    expect(equalsOutputData(null, doc([{ id: 'b1', type: 'paragraph', data: { text: 'Hi' } }]))).toBe(false);
  });
});

describe('normalizeOutputBlocks', () => {
  it('coerces null data to an empty object and drops null/empty ids', () => {
    const normalized = normalizeOutputBlocks([
      { id: null, type: 'paragraph', data: null },
      { id: '', type: 'paragraph', data: { text: 'kept' } },
    ]);

    expect(normalized).toEqual([
      { type: 'paragraph', data: {} },
      { type: 'paragraph', data: { text: 'kept' } },
    ]);
    expect('id' in normalized[0]).toBe(false);
  });

  it('preserves valid ids, data and passthrough fields untouched', () => {
    const normalized = normalizeOutputBlocks([
      { id: 'b1', type: 'table', data: { content: [] }, parent: 'p1', tunes: { align: 'center' } },
    ]);

    expect(normalized).toEqual([
      { id: 'b1', type: 'table', data: { content: [] }, parent: 'p1', tunes: { align: 'center' } },
    ]);
  });
});

describe('isEmptyOutputData', () => {
  it('treats nullish and blockless documents as empty', () => {
    expect(isEmptyOutputData(undefined)).toBe(true);
    expect(isEmptyOutputData(null)).toBe(true);
    expect(isEmptyOutputData({ blocks: [] })).toBe(true);
  });

  it('treats blank and whitespace-only text blocks as empty', () => {
    expect(isEmptyOutputData(doc([{ id: 'b1', type: 'paragraph', data: { text: '' } }]))).toBe(true);
    expect(isEmptyOutputData(doc([{ id: 'b1', type: 'paragraph', data: { text: '   ' } }]))).toBe(true);
  });

  it('ignores numeric and boolean metadata when judging emptiness', () => {
    // A header always carries `level`; a checklist item always carries `checked`.
    expect(isEmptyOutputData(doc([{ id: 'h1', type: 'header', data: { text: '', level: 2 } }]))).toBe(true);
    expect(isEmptyOutputData(doc([{ id: 'c1', type: 'checklist', data: { text: '', checked: true } }]))).toBe(true);
  });

  it('treats blocks with textual content as non-empty', () => {
    expect(isEmptyOutputData(doc([{ id: 'b1', type: 'paragraph', data: { text: 'Hello' } }]))).toBe(false);
  });

  it('treats non-empty arrays and nested structures as content', () => {
    expect(isEmptyOutputData(doc([{ id: 'l1', type: 'list', data: { items: [{ content: 'One' }] } }]))).toBe(false);
    expect(isEmptyOutputData(doc([{ id: 'l1', type: 'list', data: { items: [] } }]))).toBe(true);
  });

  it('treats a null-data block (loose wire shape) as empty', () => {
    const wireDoc = { blocks: [{ id: null, type: 'paragraph', data: null }] };

    expect(isEmptyOutputData(wireDoc)).toBe(true);
  });

  it('returns false as soon as any block carries content', () => {
    const mixed = doc([
      { id: 'b1', type: 'paragraph', data: { text: '' } },
      { id: 'b2', type: 'paragraph', data: { text: 'Something' } },
    ]);

    expect(isEmptyOutputData(mixed)).toBe(false);
  });
});

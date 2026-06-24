import { describe, it, expect } from 'vitest';
import { deepEqual } from '../../../src/react/deep-equal';

describe('deepEqual', () => {
  it('treats identical references as equal', () => {
    const value = { blocks: [] };

    expect(deepEqual(value, value)).toBe(true);
  });

  it('treats structurally identical objects with different references as equal', () => {
    expect(deepEqual({ blocks: [] }, { blocks: [] })).toBe(true);
  });

  it('compares nested block data structurally', () => {
    const a = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'hi' } }] };
    const b = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'hi' } }] };

    expect(deepEqual(a, b)).toBe(true);
  });

  it('detects differences in nested values', () => {
    const a = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'hi' } }] };
    const b = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'bye' } }] };

    expect(deepEqual(a, b)).toBe(false);
  });

  it('detects differing array lengths', () => {
    expect(deepEqual({ blocks: [1] }, { blocks: [1, 2] })).toBe(false);
  });

  it('detects differing key sets', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(false);
  });

  it('distinguishes arrays from objects', () => {
    expect(deepEqual([], {})).toBe(false);
  });

  it('handles primitives and null', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });
});

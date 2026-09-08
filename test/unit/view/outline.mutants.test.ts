/**
 * Mutation coverage for `src/view/outline.ts`.
 *
 * Four recorded mutants are PROVEN equivalent and cannot be killed:
 *
 * 1. Line 34, dropping the `typeof value !== 'number'` disjunct (to `false`).
 *    `Number.isFinite` never coerces — it returns false for every non-number
 *    (checked: `'3'`, `undefined`, `null` all give false) — so the second
 *    disjunct is already true whenever the first one is. The result is the same
 *    for every value.
 *
 * 2. Line 77, replacing `block.id !== undefined` with `true` in the cycle guard.
 *    `active` only ever receives `block.id` under the same guard on line 81, so
 *    it never holds `undefined`; for an id-less block `active.has(undefined)` is
 *    false and the guard falls through exactly as before.
 *
 * 3. Line 81, replacing `block.id !== undefined` with `true` before
 *    `active.add`. The only read of `active` is line 77, reached only when
 *    `block.id !== undefined`, so an `undefined` member can never be observed.
 *
 * 4. Line 89, replacing `block.id !== undefined` with `true` before
 *    `active.delete`. By the same argument `active` never contains `undefined`,
 *    so the extra delete removes nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { outlineFromOutputData } from '../../../src/view/outline';

import type { OutputBlockData, OutputData } from '../../../types';

const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('outlineFromOutputData — heading level', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to level 1 when the level is missing or not a number', () => {
    expect(outlineFromOutputData(doc([
      { id: 'a', type: 'header', data: { text: 'No level' } },
      { id: 'b', type: 'header', data: { text: 'Level as text', level: 'two' } },
    ]))).toEqual([
      { id: 'a', level: 1, text: 'No level' },
      { id: 'b', level: 1, text: 'Level as text' },
    ]);
  });

  it('falls back to level 1 for a numeric level that is not finite', () => {
    // Infinity would otherwise clamp to 6 and NaN would survive the clamp
    // untouched, so both have to be rejected before the clamp runs.
    expect(outlineFromOutputData(doc([
      { id: 'inf', type: 'header', data: { text: 'Endless', level: Number.POSITIVE_INFINITY } },
      { id: 'nan', type: 'header', data: { text: 'Nonsense', level: Number.NaN } },
    ]))).toEqual([
      { id: 'inf', level: 1, text: 'Endless' },
      { id: 'nan', level: 1, text: 'Nonsense' },
    ]);
  });
});

describe('outlineFromOutputData — heading text and id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips a heading whose text is missing or not a string', () => {
    expect(outlineFromOutputData(doc([
      { id: 'no-text', type: 'header', data: { level: 2 } },
      { id: 'number-text', type: 'header', data: { text: 42, level: 2 } },
    ]))).toEqual([]);
  });

  it('omits the id key for a heading that carries no id', () => {
    const outline = outlineFromOutputData(doc([
      { type: 'header', data: { text: 'Anonymous', level: 3 } },
    ]));

    // toEqual would accept an explicit `id: undefined` here; the key must be absent.
    expect(outline).toStrictEqual([{ level: 3, text: 'Anonymous' }]);
    expect('id' in outline[0]).toBe(false);
  });
});

describe('outlineFromOutputData — repeated block ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops a parent-reference cycle instead of walking it forever', () => {
    // A cycle is only reachable from the top when two entries share an id:
    // a plain a-to-b-to-a loop leaves no top-level block to start from.
    expect(outlineFromOutputData(doc([
      { id: 'root', type: 'header', data: { text: 'Root', level: 1 } },
      { id: 'loop', type: 'header', data: { text: 'Loop', level: 2 }, parent: 'root' },
      { id: 'inner', type: 'header', data: { text: 'Inner', level: 3 }, parent: 'loop' },
      { id: 'loop', type: 'header', data: { text: 'Loop again', level: 2 }, parent: 'inner' },
    ]))).toEqual([
      { id: 'root', level: 1, text: 'Root' },
      { id: 'loop', level: 2, text: 'Loop' },
      { id: 'inner', level: 3, text: 'Inner' },
    ]);
  });

  it('collects a repeated id again once its own subtree is finished', () => {
    // The cycle guard covers the walk stack only — leaving the subtree has to
    // release the id, or the second heading is silently dropped.
    expect(outlineFromOutputData(doc([
      { id: 'a', type: 'paragraph', data: {} },
      { id: 'b', type: 'paragraph', data: {} },
      { id: 'dup', type: 'header', data: { text: 'First', level: 2 }, parent: 'a' },
      { id: 'dup', type: 'header', data: { text: 'Second', level: 2 }, parent: 'b' },
    ]))).toEqual([
      { id: 'dup', level: 2, text: 'First' },
      { id: 'dup', level: 2, text: 'Second' },
    ]);
  });
});

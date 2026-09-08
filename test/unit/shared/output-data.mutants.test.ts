import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEmittedEchoWindow,
  equalsOutputData,
  isEmptyOutputData,
  normalizeOutputBlocks,
} from '../../../src/shared/output-data';

import type { LooseOutputData } from '../../../types';

/**
 * Mutation-coverage tests for `src/shared/output-data.ts`.
 *
 * Equivalence proofs for the mutants deliberately left alive:
 *
 * - L64/L65 `idA !== ''` / `idB !== ''` replaced by `true`. Both ids come from
 *   `normalizeOutputBlock`, which destructures `id` out of `rest` and re-adds it
 *   only when it is a non-empty string. So the destructured id is either a
 *   non-empty string or `undefined`, and `typeof id === 'string'` already
 *   implies `id !== ''`. The operand cannot change the guard.
 * - L273 `value === undefined` replaced by `false`. `undefined` is not a string,
 *   not an array and `typeof undefined !== 'object'`, so it reaches the trailing
 *   `return true` — the same answer the removed branch gave.
 * - L303 `data?.blocks ?? []` replaced by `["Stryker was here"]`. The fallback is
 *   only ever consumed by `.every((block) => isEmptyValue(block.data))`. Reading
 *   `.data` off the injected string yields `undefined`, which is empty, so the
 *   predicate holds for every element; both the empty array and the injected one
 *   answer `true` for every input.
 */

/** Wire-shape document literal, so loose spellings of "absent" stay typed. */
const wire = (blocks: LooseOutputData['blocks']): LooseOutputData => ({ blocks });

const para = (text: string): LooseOutputData['blocks'][number] => ({ type: 'paragraph', data: { text } });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('output-data mutants — normalizeOutputBlocks', () => {
  it('drops an empty-string parent, the same way it drops a null one', () => {
    const normalized = normalizeOutputBlocks([{ id: 'b1', type: 'paragraph', data: { text: 'x' }, parent: '' }]);

    expect('parent' in normalized[0]).toBe(false);
    expect(normalized[0]).toEqual({ id: 'b1', type: 'paragraph', data: { text: 'x' } });
  });
});

describe('output-data mutants — equalsOutputData id participation', () => {
  // Only '' spells "absent". Every other string is a real id and must be
  // compared, including strings a mutation engine likes to inject.
  it.each(['a', ' ', '0', 'Stryker was here!'])('compares %j against a different id on the left', (id) => {
    expect(equalsOutputData(wire([{ id, ...para('x') }]), wire([{ id: 'other', ...para('x') }]))).toBe(false);
  });

  it.each(['a', ' ', '0', 'Stryker was here!'])('compares %j against a different id on the right', (id) => {
    expect(equalsOutputData(wire([{ id: 'other', ...para('x') }]), wire([{ id, ...para('x') }]))).toBe(false);
  });
});

describe('output-data mutants — createEmittedEchoWindow', () => {
  it('matches nothing before any payload is recorded', () => {
    const echoes = createEmittedEchoWindow();

    expect(echoes.matches({ blocks: [] })).toBe(false);
    expect(echoes.matches(null)).toBe(false);
    expect(echoes.matches(wire([para('typed')]))).toBe(false);
  });
});

describe('output-data mutants — isEmptyOutputData value classification', () => {
  it('judges an array by its elements, not by properties hung off the array', () => {
    // Object.values() on an array also yields its non-index own properties, so
    // the array branch must not fall through into the plain-object branch.
    const items = Object.assign([''], { label: 'text' });

    expect(isEmptyOutputData(wire([{ type: 'list', data: { items } }]))).toBe(true);
  });

  it('treats a non-object value as metadata even when it carries properties', () => {
    const handler = Object.assign(() => undefined, { label: 'text' });

    expect(isEmptyOutputData(wire([{ type: 'paragraph', data: { handler } }]))).toBe(true);
  });

  it('needs every value of a block data object to be empty, not just one', () => {
    expect(isEmptyOutputData(wire([{ type: 'paragraph', data: { text: 'Hello', caption: '' } }]))).toBe(false);
  });
});

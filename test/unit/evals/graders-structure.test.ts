import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../types';
import { marks, schemaValid, sequence, shape, text, unchanged, untouched } from '../../evals/agent/graders/structure';
import type { GraderInput } from '../../evals/agent/types';

const doc = (blocks: OutputData['blocks']): OutputData => ({ blocks });

const input = (final: OutputData, seed: OutputData = doc([])): GraderInput => ({ seed, final, actorId: 'agent', log: [] });

const toggle = doc([
  { id: 't', type: 'toggle', data: { text: [{ text: 'FAQ' }] }, content: ['a', 'b'] },
  { id: 'a', type: 'paragraph', parent: 't', data: { text: [{ text: 'quarterly', marks: { bold: true } }, { text: ' report' }] } },
  { id: 'b', type: 'paragraph', parent: 't', data: { text: 'plain' } },
]);

describe('structural graders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shape matches a container and its ordered children, and rejects a wrong order', () => {
    const good = shape('faq toggle', { type: 'toggle', children: [{ type: 'paragraph', id: 'a' }, { type: 'paragraph', id: 'b' }] });
    const bad = shape('faq toggle', { type: 'toggle', children: [{ type: 'paragraph', id: 'b' }, { type: 'paragraph', id: 'a' }] });

    expect(good.check(input(toggle)).pass).toBe(true);
    expect(bad.check(input(toggle)).pass).toBe(false);
  });

  it('shape count consumes a run of same-type children', () => {
    expect(shape('two paras', { type: 'toggle', children: [{ type: 'paragraph', count: 2 }] }).check(input(toggle)).pass).toBe(true);
    expect(shape('three paras', { type: 'toggle', children: [{ type: 'paragraph', count: 3 }] }).check(input(toggle)).pass).toBe(false);
  });

  it('shape with loose children allows other children between, in order', () => {
    const loose = (ids: string[]) => shape('loose', { type: 'toggle', loose: true, children: ids.map(id => ({ type: 'paragraph', id })) });

    expect(loose(['b']).check(input(toggle)).pass).toBe(true);
    expect(loose(['a', 'b']).check(input(toggle)).pass).toBe(true);
    expect(loose(['b', 'a']).check(input(toggle)).pass).toBe(false);
    expect(loose(['a', 'a']).check(input(toggle)).pass).toBe(false);
  });

  it('sequence finds consecutive root types', () => {
    const final = doc([
      { id: 'h', type: 'header', data: { text: 'Plan', level: 2 } },
      { id: 'p', type: 'paragraph', data: { text: 'x' } },
    ]);

    expect(sequence('plan', ['header', 'paragraph']).check(input(final)).pass).toBe(true);
    expect(sequence('plan', ['paragraph', 'header']).check(input(final)).pass).toBe(false);
  });

  it('text reads segments and HTML strings alike', () => {
    expect(text('b text', { id: 'b' }, 'plain').check(input(toggle)).pass).toBe(true);
    expect(text('a text', { id: 'a' }, /^quarterly report$/).check(input(toggle)).pass).toBe(true);
  });

  it('marks checks every character of the substring', () => {
    expect(marks('bold quarterly', { id: 'a' }, 'quarterly', { bold: true }).check(input(toggle)).pass).toBe(true);
    expect(marks('bold report', { id: 'a' }, 'report', { bold: true }).check(input(toggle)).pass).toBe(false);
  });

  it('untouched fails when a block outside the allowed set changed', () => {
    const seed = doc([{ id: 'x', type: 'paragraph', data: { text: [{ text: 'same' }] } }]);
    const changed = doc([{ id: 'x', type: 'paragraph', data: { text: [{ text: 'edited' }] } }]);

    expect(untouched([]).check(input(changed, seed)).pass).toBe(false);
    expect(untouched(['x']).check(input(changed, seed)).pass).toBe(true);
    expect(unchanged().check(input(seed, seed)).pass).toBe(true);
  });

  it('schemaValid reports the validator errors', () => {
    expect(schemaValid(() => ['/blocks/0: bad']).check(input(toggle))).toEqual({ pass: false, detail: '/blocks/0: bad' });
    expect(schemaValid(() => []).check(input(toggle)).pass).toBe(true);
  });
});

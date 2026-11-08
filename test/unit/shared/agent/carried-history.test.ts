import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../../types/data-formats/output-data';
import { carriedHistory } from '../../../../src/shared/agent/carried-history';
import { contentRevision } from '../../../../src/shared/agent/revision';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

const doc = (text: string): OutputData => ({ blocks: [{ id: 'p1', type: 'paragraph', data: { text } }] });
const revisionOf = (document: OutputData): string => contentRevision(DocSnapshot.fromOutput(document).toOutput());
const isDocument = (value: unknown): value is OutputData =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'blocks'));
const same = (document: OutputData): OutputData => document;

describe('carriedHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the steps, each loaded, while the document is the one they were taken on', () => {
    const current = doc('now');
    const load = vi.fn(same);

    expect(carriedHistory({ past: [doc('before'), 'other'], future: [], revision: revisionOf(current) }, current, load, isDocument))
      .toEqual({ past: [doc('before'), 'other'], future: [], lost: false });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('drops the steps and marks them lost when the document changed since', () => {
    expect(carriedHistory({ past: [doc('before')], future: ['other'], revision: revisionOf(doc('then')) }, doc('now'), same, isDocument))
      .toEqual({ past: [], future: [], lost: true });
  });

  it('marks nothing lost when there were no steps to lose', () => {
    expect(carriedHistory({}, doc('now'), same, isDocument)).toEqual({ past: [], future: [], lost: false });
  });

  it('keeps an earlier loss', () => {
    const current = doc('now');

    expect(carriedHistory({ past: [], future: [], lost: true, revision: revisionOf(current) }, current, same, isDocument))
      .toEqual({ past: [], future: [], lost: true });
  });

  it('skips entries that are not documents, and answers undefined for no history', () => {
    const current = doc('now');

    expect(carriedHistory({ past: [7, { blocks: 'x' }, doc('a')], future: null, revision: revisionOf(current) }, current, same, isDocument))
      .toEqual({ past: [doc('a')], future: [], lost: false });
    expect(carriedHistory(undefined, current, same, isDocument)).toBeUndefined();
    expect(carriedHistory([], current, same, isDocument)).toBeUndefined();
  });
});

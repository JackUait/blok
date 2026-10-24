// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession } from '../../agent/harness';

import type { AgentBatch, OutputData } from '../../../../types';

// The seed runs carry marks: a scan keys only marked runs, so plain ones would hide it.
const docOf = (size: number): OutputData => ({
  blocks: Array.from({ length: size }, (_, index) => ({
    id: `b${index}`, type: 'paragraph', data: { text: [{ text: `old ${index}`, marks: { bold: true } }] },
  })),
});

const inserts = (count: number, marked: boolean): AgentBatch['commands'] => Array.from({ length: count }, (_, index) => ({
  name: 'block.insert',
  args: { type: 'paragraph', data: { text: [{ text: `new ${index}`, ...(marked && { marks: { italic: true } }) }] } },
}));

/** JSON.stringify calls one batch makes: a stand-in for work that a wall clock under load cannot measure. */
const stringifyCalls = async (doc: OutputData, commands: AgentBatch['commands']): Promise<number> => {
  const session = openJsonSession(doc);
  const spy = vi.spyOn(JSON, 'stringify');

  try {
    spy.mockClear();
    const result = await session.execute({ commands });

    expect(result.ok).toBe(true);

    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
    await session.close();
  }
};

/** What K more inserts cost on top of K, so per-batch work (snapshots, output) cancels out. */
const marginal = async (doc: OutputData, count: number, marked: boolean): Promise<number> =>
  await stringifyCalls(doc, inserts(count * 2, marked)) - await stringifyCalls(doc, inserts(count, marked));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reading agent rich text does not scale with the document', () => {
  it.each([true, false])('an insert costs about the same in a 2000-block document as in a tiny one (marked: %s)', async (marked) => {
    const small = await marginal(docOf(5), 10, marked);
    const big = await marginal(docOf(2000), 10, marked);

    expect(big).toBeLessThanOrEqual(small * 1.5 + 50);
  }, 120_000);
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentBatch, OutputData } from '../../../types';
import { openJsonSession, openStoreSession } from './harness';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const coloured = { text: 'T', textColor: 'red', backgroundColor: 'yellow' };

const run = async (open: typeof openJsonSession | typeof openStoreSession, seed: OutputData, batch: AgentBatch): Promise<{ error: unknown; doc: OutputData }> => {
  const session = open(seed);

  try {
    const result = await session.execute(batch);

    return { error: result.ok ? null : result.error, doc: session.output() };
  } finally {
    await session.close();
  }
};

const togglesOf = (doc: OutputData): unknown[] => doc.blocks.filter((block) => block.type === 'toggle').map((block) => block.data);

describe.each([
  ['stored', openJsonSession],
  ['live', openStoreSession],
] as const)('a coloured toggle (%s session)', (_name, open) => {
  it('can be inserted with both colours', async () => {
    const { error, doc } = await run(open, { blocks: [] }, {
      commands: [{ name: 'block.insert', args: { type: 'toggle', data: coloured } }],
    });

    expect(error).toBeNull();
    expect(togglesOf(doc)).toEqual([expect.objectContaining({ textColor: 'red', backgroundColor: 'yellow' })]);
  });

  it('can be recoloured and cleared', async () => {
    const { error, doc } = await run(open, { blocks: [{ id: 't', type: 'toggle', data: { text: 'T', textColor: 'red' } }] }, {
      commands: [{ name: 'block.update', args: { id: 't', data: { textColor: null, backgroundColor: 'blue' } } }],
    });

    expect(error).toBeNull();
    expect(togglesOf(doc)).toEqual([expect.objectContaining({ backgroundColor: 'blue' })]);
    expect(togglesOf(doc)[0]).not.toHaveProperty('textColor');
  });

  it('can be duplicated', async () => {
    const { error, doc } = await run(open, { blocks: [{ id: 't', type: 'toggle', data: coloured }] }, {
      commands: [{ name: 'block.duplicate', args: { id: 't' } }],
    });

    expect(error).toBeNull();
    expect(togglesOf(doc)).toHaveLength(2);
    expect(togglesOf(doc)[1]).toMatchObject({ textColor: 'red', backgroundColor: 'yellow' });
  });

  it('can be duplicated inside a parent toggle', async () => {
    const { error, doc } = await run(open, {
      blocks: [
        { id: 'p', type: 'toggle', data: { text: 'Parent' }, content: ['t'] },
        { id: 't', type: 'toggle', data: coloured, parent: 'p' },
      ],
    }, { commands: [{ name: 'block.duplicate', args: { id: 'p' } }] });

    expect(error).toBeNull();
    expect(togglesOf(doc).filter((data) => (data as { textColor?: string }).textColor === 'red')).toHaveLength(2);
  });

  it('can be duplicated inside a column list', async () => {
    const { error, doc } = await run(open, {
      blocks: [
        { id: 'L', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'L', content: ['t'] },
        { id: 't', type: 'toggle', data: coloured, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'L', content: ['q'] },
        { id: 'q', type: 'paragraph', data: { text: 'q' }, parent: 'c2' },
      ],
    }, { commands: [{ name: 'block.duplicate', args: { id: 'L' } }] });

    expect(error).toBeNull();
    expect(togglesOf(doc).filter((data) => (data as { textColor?: string }).textColor === 'red')).toHaveLength(2);
  });

  it('can be copied with its table row', async () => {
    const { error, doc } = await run(open, {
      blocks: [
        { id: 'tb', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['t'] }, { blocks: ['b'] }]] }, content: ['t', 'b'] },
        { id: 't', type: 'toggle', data: coloured, parent: 'tb' },
        { id: 'b', type: 'paragraph', data: { text: 'b' }, parent: 'tb' },
      ],
    }, { commands: [{ name: 'table.duplicateRows', args: { id: 'tb', at: 0 } }] });

    expect(error).toBeNull();
    expect(togglesOf(doc).filter((data) => (data as { textColor?: string }).textColor === 'red')).toHaveLength(2);
  });
});

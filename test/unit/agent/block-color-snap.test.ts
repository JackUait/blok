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

const run = async (open: typeof openJsonSession | typeof openStoreSession, seed: OutputData, batch: AgentBatch): Promise<{ error: unknown; warnings: unknown[]; doc: OutputData }> => {
  const session = open(seed);

  try {
    const result = await session.execute(batch);

    return { error: result.ok ? null : result.error, warnings: result.warnings, doc: session.output() };
  } finally {
    await session.close();
  }
};

const dataOf = (doc: OutputData, id: string): Record<string, unknown> | undefined => doc.blocks.find((block) => block.id === id)?.data;
const insert = (type: string, data: Record<string, unknown>): AgentBatch => ({ commands: [{ name: 'block.insert', args: { id: 'n', type, data } }] });

// The block colour menu and the slash colour commands save only preset names.
describe.each([
  ['stored', openJsonSession],
  ['live', openStoreSession],
] as const)('block colours the agent writes (%s session)', (_name, open) => {
  it('stores a hex colour as the nearest preset and says so', async () => {
    const { error, warnings, doc } = await run(open, { blocks: [] }, insert('paragraph', { text: 'x', textColor: '#d44c47' }));

    expect(error).toBeNull();
    expect(dataOf(doc, 'n')?.textColor).toBe('red');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', field: 'textColor' }));
  });

  it('reads a preset variable and any case of a preset name', async () => {
    const { doc } = await run(open, { blocks: [] }, insert('header', { text: 'x', level: 2, textColor: 'Blue', backgroundColor: 'var(--blok-color-green-bg)' }));

    expect(dataOf(doc, 'n')).toMatchObject({ textColor: 'blue', backgroundColor: 'green' });
  });

  it('drops a value that is not a colour, with a warning', async () => {
    const { error, warnings, doc } = await run(open, { blocks: [] }, insert('callout', { emoji: '💡', backgroundColor: 'url(javascript:alert(1))' }));

    expect(error).toBeNull();
    expect(dataOf(doc, 'n')?.backgroundColor ?? null).toBeNull();
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'CORRECTED', field: 'backgroundColor' }));
  });

  it('snaps a colour written by block.update on a toggle', async () => {
    const { doc } = await run(open, { blocks: [{ id: 't', type: 'toggle', data: { text: 'T' } }] }, {
      commands: [{ name: 'block.update', args: { id: 't', data: { backgroundColor: 'rgb(251, 236, 221)' } } }],
    });

    expect(dataOf(doc, 't')?.backgroundColor).toBe('orange');
  });

  it('keeps the colour a block had when the new one is dropped', async () => {
    const { doc } = await run(open, { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x', textColor: 'red' } }] }, {
      commands: [{ name: 'block.update', args: { id: 'p', data: { textColor: 'not a colour' } } }],
    });

    expect(dataOf(doc, 'p')?.textColor).toBe('red');
  });

  it('leaves a stored colour alone when it copies or edits the block', async () => {
    const { error, doc } = await run(open, { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x', textColor: '#ff0000' } }] }, {
      commands: [
        { name: 'block.duplicate', args: { id: 'p' } },
        { name: 'block.update', args: { id: 'p', data: { backgroundColor: 'red' } } },
      ],
    });

    expect(error).toBeNull();
    expect(doc.blocks.map((block) => block.data.textColor)).toEqual(['#ff0000', '#ff0000']);
  });
});

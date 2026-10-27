import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from '../../agent/harness';

import type { AgentResult, AgentSession, OutputData } from '../../../../types';

/** notion-spec-2 §14.10: a rollup picks up its Number target's format, not its Show as. */

type Session = AgentSession & { output?: () => OutputData };

const sessions: Array<[string, (seed: OutputData) => Session]> = [
  ['json', seed => openJsonSession(seed)],
  ['store', seed => openStoreSession(seed)],
];

const seed = (): OutputData => ({
  blocks: [
    {
      id: 'db', type: 'database', content: ['r1'],
      data: {
        title: 'Tasks',
        schema: [
          { id: 't', name: 'Name', type: 'title', position: 'a0' },
          { id: 'num', name: 'Amount', type: 'number', position: 'a1', number: { format: 'euro', showAs: 'ring', color: 'green', divideBy: 100 } },
          { id: 'plain', name: 'Plain', type: 'number', position: 'a2' },
          { id: 'rel', name: 'Link', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db' } },
          { id: 'far', name: 'Far', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'db2' } },
          { id: 'r', name: 'Roll', type: 'rollup', position: 'a5' },
          { id: 'r-dollar', name: 'Roll dollar', type: 'rollup', position: 'a6', number: { format: 'dollar' } },
          { id: 'r-set', name: 'Roll set', type: 'rollup', position: 'a7', rollup: { relationPropertyId: 'rel', targetPropertyId: 'num', function: 'sum' } },
        ],
        views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v1',
      },
    },
    { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', num: 50, rel: [{ id: 'r1' }] }, position: 'a0' } },
    {
      id: 'db2', type: 'database', content: [],
      data: {
        title: 'Other',
        schema: [
          { id: 't2', name: 'Name', type: 'title', position: 'a0' },
          { id: 'yen', name: 'Price', type: 'number', position: 'a1', number: { format: 'yen' } },
        ],
        views: [{ id: 'v2', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v2',
      },
    },
  ],
});

const update = (session: Session, propertyId: string, settings: Record<string, unknown>): Promise<AgentResult> =>
  session.execute({ commands: [{ name: 'database.updateProperty', args: { id: 'db', propertyId, settings } }] });

const numberOf = async (session: Session, propertyId: string): Promise<unknown> => {
  const read = await session.read({ ids: ['db'], detail: 'full' });
  const schema = (read.blocks.find(block => block.id === 'db')?.data as { schema: Array<{ id: string; number?: unknown }> }).schema;

  return schema.find(property => property.id === propertyId)?.number;
};

describe.each(sessions)('an agent rollup on a %s session', (_name, open) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes its Number target\'s format, and not its Show as, when the target is picked', async () => {
    const session = open(seed());

    expect((await update(session, 'r', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'num', function: 'show_original' } })).ok).toBe(true);
    expect(await numberOf(session, 'r')).toEqual({ format: 'euro' });
  });

  it('takes the format from a target in another database', async () => {
    const session = open(seed());

    expect((await update(session, 'r', { rollup: { relationPropertyId: 'far', targetPropertyId: 'yen', function: 'sum' } })).ok).toBe(true);
    expect(await numberOf(session, 'r')).toEqual({ format: 'yen' });
  });

  it('keeps a format the rollup already has', async () => {
    const session = open(seed());

    await update(session, 'r-dollar', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'num', function: 'sum' } });
    expect(await numberOf(session, 'r-dollar')).toEqual({ format: 'dollar' });
  });

  it('keeps a format given in the same update, and adds the format beside other number settings', async () => {
    const session = open(seed());

    await update(session, 'r', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'num', function: 'sum' }, number: { format: 'pound' } });
    expect(await numberOf(session, 'r')).toEqual({ format: 'pound' });

    const other = open(seed());

    await update(other, 'r', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'num', function: 'sum' }, number: { showAs: 'bar' } });
    expect(await numberOf(other, 'r')).toEqual({ showAs: 'bar', format: 'euro' });
  });

  it('leaves the format alone when only the calculation changes', async () => {
    const session = open(seed());

    await update(session, 'r-set', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'num', function: 'average' } });
    expect(await numberOf(session, 'r-set')).toBeUndefined();
  });

  it('adds nothing for a target with no format', async () => {
    const session = open(seed());

    await update(session, 'r', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'plain', function: 'sum' } });
    expect(await numberOf(session, 'r')).toBeUndefined();
  });
});

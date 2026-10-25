import { openJsonSession, openStoreSession } from './harness';

import type { AgentBatch, AgentResult, AgentSession, OutputData } from '../../../types';

type Seeded = { id: string; type: string; data: Record<string, unknown>; parent?: string; content?: string[] };

export const SESSIONS: Array<[string, (seed: OutputData) => AgentSession]> = [
  ['json', seed => openJsonSession(seed)],
  ['store', seed => openStoreSession(seed)],
];

export const property = (id: string, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, name: id, type, position: `a${id}`, ...extra });

export const row = (id: string, properties: Record<string, unknown>, extra: Record<string, unknown> = {}): Omit<Seeded, 'parent'> =>
  ({ id, type: 'database-row', data: { properties, position: `a${id}`, ...extra } });

/** Database blocks with their rows; `children` hangs blocks under a row. */
export const seedOf = (
  databases: Array<{ id: string; schema: Array<Record<string, unknown>>; rows: Array<Omit<Seeded, 'parent'>> }>,
  children: Array<Seeded> = []
): OutputData => {
  const blocks: Array<Record<string, unknown>> = [
    ...databases.flatMap(database => [
      {
        id: database.id,
        type: 'database',
        data: { schema: database.schema, views: [{ id: `${database.id}-v`, name: 'Table', type: 'table', position: 'a0' }], activeViewId: `${database.id}-v` },
        content: database.rows.map(each => each.id),
      },
      ...database.rows.map(each => ({
        ...each,
        parent: database.id,
        content: children.filter(child => child.parent === each.id).map(child => child.id),
      })),
    ]),
    ...children.map(child => ({ ...child, content: child.content ?? [] })),
  ];

  return { blocks: blocks as unknown as OutputData['blocks'] };
};

export const run = (session: AgentSession, name: string, args: Record<string, unknown>): Promise<AgentResult> =>
  session.execute({ commands: [{ name, args }] } as AgentBatch);

export const errorOf = (result: AgentResult): { code: string; message: string } | undefined =>
  (result.ok ? undefined : { code: result.error.code, message: result.error.message });

export const dataOf = async (session: AgentSession, id: string): Promise<Record<string, unknown> | undefined> =>
  (await session.read({ detail: 'full' })).blocks.find(block => block.id === id)?.data;

export const valuesOf = async (session: AgentSession, id: string): Promise<Record<string, unknown>> =>
  ((await dataOf(session, id))?.properties ?? {}) as Record<string, unknown>;

export const idsOf = async (session: AgentSession): Promise<string[]> =>
  (await session.read({ detail: 'full' })).blocks.map(block => block.id);

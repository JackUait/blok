import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from '../../agent/harness';

import type { AgentBatch, AgentResult, AgentSession, OutputBlockData, OutputData } from '../../../../types';

type Session = AgentSession & { output?: () => OutputData };

const sessions: Array<[string, (seed: OutputData) => Session]> = [
  ['json', seed => openJsonSession(seed)],
  ['store', seed => openStoreSession(seed)],
];

const schema = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'st', name: 'Stage', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }, { id: 'o2', label: 'Done', position: 'a1' }] } },
  { id: 'n', name: 'Size', type: 'number', position: 'a2' },
  { id: 'd', name: 'Due', type: 'date', position: 'a3' },
];

const baseView = { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

const databaseBlock = (views: Array<Record<string, unknown>> = [baseView], extra: Record<string, unknown> = {}): OutputBlockData => ({
  id: 'db', type: 'database', content: ['r1'],
  data: { title: 'Tasks', schema, views, activeViewId: String(views[0]?.id), ...extra },
});

const seedOf = (block: OutputBlockData = databaseBlock()): OutputData => ({
  blocks: [
    block,
    { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One', st: 'o1' }, position: 'a0' } },
  ],
});

const run = (session: AgentSession, commands: AgentBatch['commands']): Promise<AgentResult> => session.execute({ commands });

const errorOf = (result: AgentResult): { code: string; message: string } | undefined =>
  result.ok ? undefined : { code: result.error.code, message: result.error.message };

describe.each(sessions)('database view settings on a %s session', (_name, open) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('view actions work on a relation tab view, which carries propertyOrder alphabetical', async () => {
    const session = open(seedOf(databaseBlock([{ ...baseView, propertyOrder: 'alphabetical', properties: [] }])));

    try {
      const result = await run(session, [{ name: 'database.renameView', args: { id: 'db', viewId: 'v1', name: 'Sub-items' } }]);

      expect(errorOf(result)).toBeUndefined();
    } finally {
      await session.close();
    }
  });
});

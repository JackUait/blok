import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from '../../agent/harness';

import type { AgentApprovalRequest, AgentBatch, AgentResult, AgentSession, OutputBlockData, OutputData } from '../../../../types';

type Approve = (request: AgentApprovalRequest) => Promise<boolean>;

const sessions: Array<[string, (seed: OutputData) => AgentSession]> = [
  ['json', seed => openJsonSession(seed)],
  ['store', seed => openStoreSession(seed)],
];

const title = (locked: boolean): Record<string, unknown> => ({
  id: 't', name: 'Name', type: 'title', position: 'a0', ...(locked && { databaseLocked: true }),
});

const database = (id: string, locked: boolean, rows: string[] = []): OutputBlockData => ({
  id, type: 'database', content: rows,
  data: {
    title: id === 'db' ? 'Tasks' : 'Other',
    schema: [title(locked)],
    views: [{ id: `${id}-v`, name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    activeViewId: `${id}-v`,
  },
});

const seed = (locked = true): OutputData => ({ blocks: [database('db', locked), database('db2', locked)] });

const unlock = (id = 'db'): AgentBatch['commands'][number] => ({ name: 'database.setLock', args: { id, locked: false } });

const run = (session: AgentSession, commands: unknown[], approve?: Approve): Promise<AgentResult> =>
  session.execute({ commands } as AgentBatch, approve === undefined ? {} : { approve });

const isLocked = async (session: AgentSession, id = 'db'): Promise<boolean> => {
  const read = await session.read({ ids: [id], detail: 'full' });
  const schema = read.blocks.find(block => block.id === id)?.data?.schema;

  return Array.isArray(schema) && schema.some(property => typeof property === 'object' && property !== null
    && 'databaseLocked' in property && property.databaseLocked === true);
};

const codeOf = (result: AgentResult): string | undefined => (result.ok ? undefined : result.error.code);

describe.each(sessions)('unlocking a database a person locked, on a %s session', (_name, open) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is refused where no person can be asked, and the database stays locked', async () => {
    const session = open(seed());

    try {
      const result = await run(session, [unlock()]);

      expect(await isLocked(session)).toBe(true);
      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(result.ok ? undefined : result.error.details).toMatchObject({ reason: 'no-channel', approval: { kind: 'database.unlock', blockId: 'db' } });
    } finally {
      session.close();
    }
  });

  it('unlocks once the person approves, asking exactly once with the database', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      const result = await run(session, [unlock()], approve);

      expect(codeOf(result)).toBeUndefined();
      expect(await isLocked(session)).toBe(false);
      expect(approve).toHaveBeenCalledTimes(1);
      expect(approve).toHaveBeenCalledWith({ kind: 'database.unlock', blockId: 'db', title: 'Tasks' });
    } finally {
      session.close();
    }
  });

  it('a denial applies nothing in the batch and says so', async () => {
    const session = open(seed());

    try {
      const result = await run(session, [
        { name: 'block.insert', args: { type: 'paragraph', data: { text: [{ text: 'before' }] }, position: 'end' } },
        unlock(),
      ], () => Promise.resolve(false));

      expect(await isLocked(session)).toBe(true);
      expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
      expect(result.ok ? undefined : result.error.details).toMatchObject({ reason: 'denied' });
      expect(result.ok ? '' : result.error.message).toMatch(/Nothing in this batch was applied/);
      expect((await session.read({})).blocks.map(block => block.type)).toEqual(['database', 'database']);
    } finally {
      session.close();
    }
  });

  it('a yes for one database never unlocks another', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>(request => Promise.resolve(request.blockId === 'db2'));

    try {
      expect(codeOf(await run(session, [unlock('db')], approve))).toBe('APPROVAL_REQUIRED');
      expect(await isLocked(session, 'db')).toBe(true);
      expect(codeOf(await run(session, [unlock('db'), unlock('db2')], approve))).toBe('APPROVAL_REQUIRED');
      expect(await isLocked(session, 'db2')).toBe(true);
      expect(codeOf(await run(session, [unlock('db2')], approve))).toBeUndefined();
      expect(await isLocked(session, 'db2')).toBe(false);
      expect(await isLocked(session, 'db')).toBe(true);
    } finally {
      session.close();
    }
  });

  it('asks again on every batch: an approval never outlives its batch', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    try {
      expect(codeOf(await run(session, [unlock()], approve))).toBe('APPROVAL_REQUIRED');
      expect(codeOf(await run(session, [unlock()], approve))).toBeUndefined();
      expect(approve).toHaveBeenCalledTimes(2);
      expect(codeOf(await run(session, [{ name: 'database.setLock', args: { id: 'db', locked: true } }]))).toBeUndefined();
      expect(codeOf(await run(session, [unlock()]))).toBe('APPROVAL_REQUIRED');
      expect(await isLocked(session)).toBe(true);
    } finally {
      session.close();
    }
  });

  it('asks for both databases in one batch, once each', async () => {
    const session = open(seed());
    const approve = vi.fn<Approve>(() => Promise.resolve(true));

    try {
      expect(codeOf(await run(session, [unlock('db'), unlock('db2')], approve))).toBeUndefined();
      expect(approve.mock.calls.map(([request]) => request.blockId)).toEqual(['db', 'db2']);
      expect(await isLocked(session, 'db2')).toBe(false);
    } finally {
      session.close();
    }
  });

  it('does not ask to lock, or to unlock a database that is not locked', async () => {
    const session = open(seed(false));
    const approve = vi.fn<Approve>(() => Promise.resolve(false));

    try {
      expect(codeOf(await run(session, [unlock()], approve))).toBeUndefined();
      expect(codeOf(await run(session, [{ name: 'database.setLock', args: { id: 'db', locked: true } }], approve))).toBeUndefined();
      expect(approve).not.toHaveBeenCalled();
    } finally {
      session.close();
    }
  });

  describe('the model cannot approve by itself', () => {
    it('an approval flag in the command args is refused', async () => {
      const session = open(seed());

      try {
        expect(codeOf(await run(session, [{ name: 'database.setLock', args: { id: 'db', locked: false, approved: true } }]))).toBe('INVALID_ARGS');
        expect(await isLocked(session)).toBe(true);
      } finally {
        session.close();
      }
    });

    it('an approval field on the batch is ignored, and the unlock still refused', async () => {
      const session = open(seed());

      try {
        const result = await session.execute({ commands: [unlock()], approved: true, approve: true } as unknown as AgentBatch);

        expect(codeOf(result)).toBe('APPROVAL_REQUIRED');
        expect(await isLocked(session)).toBe(true);
      } finally {
        session.close();
      }
    });

    it('writing the schema directly is refused', async () => {
      const session = open(seed());

      try {
        const result = await run(session, [{ name: 'block.update', args: { id: 'db', data: { schema: [title(false)] } } }]);

        expect(codeOf(result)).toBe('FIELD_NOT_WRITABLE');
        expect(await isLocked(session)).toBe(true);
      } finally {
        session.close();
      }
    });

    it('locking and unlocking in one batch still asks', async () => {
      const session = open(seed(false));
      const approve = vi.fn<Approve>(() => Promise.resolve(false));

      try {
        expect(codeOf(await run(session, [{ name: 'database.setLock', args: { id: 'db', locked: true } }, unlock()], approve))).toBe('APPROVAL_REQUIRED');
        expect(approve).toHaveBeenCalledTimes(1);
      } finally {
        session.close();
      }
    });
  });
});

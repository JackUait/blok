// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, openStoreSession } from '../../agent/harness';
import { COMPUTED_DB, COMPUTED_DB_EXPECTED } from '../../agent/fixtures/computed-database';

import type { AgentSession, ViewBlock } from '../../../../types/agent';

const BROKEN = { unavailable: expect.stringMatching(/^The formula has an error: .+ The cell shows nothing\.$/) };

const rowsOf = (blocks: ViewBlock[]): Record<string, ViewBlock> =>
  Object.fromEntries(blocks.filter(block => block.type === 'database-row').map(block => [block.id, block]));

const runtimes: Array<[string, () => AgentSession & { close(): Promise<void> | void }]> = [
  ['json session', () => openJsonSession(COMPUTED_DB)],
  ['store session', () => openStoreSession(COMPUTED_DB)],
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(runtimes)('database rows read with computed values (%s)', (_name, open) => {
  it('shows every computed value next to the stored properties, never inside data', async () => {
    const session = open();

    try {
      const rows = rowsOf((await session.read({ detail: 'full' })).blocks);

      expect(rows.r1?.computed).toEqual({ ...COMPUTED_DB_EXPECTED.r1, bad: BROKEN });
      expect(rows.r2?.computed).toEqual({ ...COMPUTED_DB_EXPECTED.r2, bad: BROKEN });
      expect(rows.r3?.computed).toEqual({ ...COMPUTED_DB_EXPECTED.r3, bad: BROKEN });
      expect(rows.s1?.computed).toEqual(COMPUTED_DB_EXPECTED.s1);
      expect(rows.r1?.data).not.toHaveProperty('computed');
      expect(rows.r1?.data?.properties).toEqual({ t: 'Stale mirror', n: 21, rel: [{ id: 'r2' }], xrel: [{ id: 'remote-1' }] });
    } finally {
      await session.close();
    }
  });

  it('gives a template no computed values, as views never compute one', async () => {
    const session = open();

    try {
      const [tpl] = (await session.read({ ids: ['tpl'] })).blocks;

      expect(tpl?.id).toBe('tpl');
      expect(tpl).not.toHaveProperty('computed');
    } finally {
      await session.close();
    }
  });

  it('leaves computed out of the outline read, as it leaves out data', async () => {
    const session = open();

    try {
      const rows = rowsOf((await session.read()).blocks);

      expect(rows.r1).not.toHaveProperty('computed');
    } finally {
      await session.close();
    }
  });

  it('shows the new computed values in the changed rows a write returns', async () => {
    const session = open();

    try {
      const result = await session.execute({ commands: [{ name: 'database.setRowValues', args: { id: 'db', rowId: 'r2', values: { n: 7 } } }] });

      expect(result.ok).toBe(true);
      const changed = rowsOf(result.ok ? result.blocks ?? [] : []);

      expect(changed.r2?.computed).toMatchObject({ f: 14, ru: 21 });
      const rows = rowsOf((await session.read({ ids: ['r1', 's1'] })).blocks);

      expect(rows.r1?.computed).toMatchObject({ ru: 7 });
      expect(rows.s1?.computed).toMatchObject({ total: 56 });
    } finally {
      await session.close();
    }
  });

  it('credits the person the agent acts for as the last editor of a row it writes', async () => {
    const session = open();

    try {
      await session.execute({ commands: [{ name: 'database.setRowValues', args: { id: 'db', rowId: 'r2', values: { n: 7 } } }] });
      const rows = rowsOf((await session.read({ ids: ['r2'] })).blocks);

      expect(rows.r2?.computed).toMatchObject({ lb: [{ id: 'human-1' }] });
    } finally {
      await session.close();
    }
  });
});

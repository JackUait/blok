// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentBatch, AgentResult, AgentSession, OutputData } from '../../../types';
import { openJsonSession, openStoreSession } from '../agent/harness';
import { LEDGER, isExempt } from './agent-coverage.ledger';
import type { Coverage } from './agent-coverage.ledger';
import { KNOWN_GAPS, ROUTE_PROBES } from './agent-coverage/probes';

/**
 * ARCHITECTURE LAW — a ledger route must work, not only name a real command.
 * A generic block command can be refused on a block whose parent places its
 * own children (database rows), so each such row carries a probe that runs.
 */

const GENERIC = new Set(['block.duplicate', 'block.move']);
const SELF_PLACING = /^(menu:database\/|ui-file:src\/tools\/database\/)/;

const routeNames = (coverage: Coverage): string[] => {
  if ('command' in coverage) {
    return [coverage.command];
  }

  return 'commands' in coverage ? coverage.commands : [];
};

const sessions: Array<[string, (seed: OutputData) => AgentSession]> = [
  ['json', (seed) => openJsonSession(seed)],
  ['store', (seed) => openStoreSession(seed)],
];

const run = async (open: (seed: OutputData) => AgentSession, id: string): Promise<AgentResult> => {
  const probe = ROUTE_PROBES[id];
  const session = open(probe.seed);

  try {
    return await session.execute({ commands: probe.commands } as AgentBatch);
  } finally {
    await session.close();
  }
};

describe('agent coverage probes law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('every database row routed through a generic block command has a probe', () => {
    const unprobed = Object.entries(LEDGER)
      .filter(([id, c]) => SELF_PLACING.test(id) && !isExempt(c) && routeNames(c).some((name) => GENERIC.has(name)))
      .map(([id]) => id)
      .filter((id) => ROUTE_PROBES[id] === undefined);

    expect(unprobed, 'Add a minimal batch for each in agent-coverage/probes.ts ROUTE_PROBES.').toEqual([]);
  });

  it('every probe runs only commands its ledger row names', () => {
    const problems = Object.entries(ROUTE_PROBES).flatMap(([id, probe]) => {
      const coverage = LEDGER[id];

      if (coverage === undefined || isExempt(coverage)) {
        return [`${id}: no routed ledger row`];
      }

      const named = new Set(routeNames(coverage));

      return probe.commands.filter((c) => !named.has(c.name)).map((c) => `${id}: runs ${c.name}, which the row does not name`);
    });

    expect(problems).toEqual([]);
  });

  it('every known gap names a probe or a field row', () => {
    const stale = Object.keys(KNOWN_GAPS).filter((id) => {
      const coverage = LEDGER[id];

      return ROUTE_PROBES[id] === undefined && (coverage === undefined || !('field' in coverage));
    });

    expect(stale).toEqual([]);
  });

  describe.each(sessions)('%s session', (_label, open) => {
    it.each(Object.keys(ROUTE_PROBES))('%s: the route works, or is listed as a known gap that still fails', async (id) => {
      const result = await run(open, id);
      const detail = result.ok ? 'ok' : `${result.error.code}: ${result.error.message}`;

      if (KNOWN_GAPS[id] !== undefined) {
        expect(result.ok, `${id} now works (${detail}); drop it from KNOWN_GAPS`).toBe(false);
      } else {
        expect(detail).toBe('ok');
      }
    });
  });
});

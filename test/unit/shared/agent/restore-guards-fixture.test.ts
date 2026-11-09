import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { restoreShares, restoreTouchesLocked, unlockedBetween } from '../../../../src/shared/agent/approval';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import type { OutputBlockData, OutputData } from '../../../../types/data-formats/output-data';

/**
 * The servers guard an HTTP restore with the agent's rules. restore-guards.json is captured from C#,
 * and the Go and Rust servers read it too; this keeps the TS rules the same as what they read.
 */
interface Guard { kind: 'share' | 'unlock' | 'lockedReshape'; blockId: string; viewId?: string }

interface GuardCase { name: string; current: OutputBlockData[]; target: OutputBlockData[]; guards: Guard[] }

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'test/unit/server-conformance/fixtures/collab-history/restore-guards.json'),
  'utf8',
)) as { cases: GuardCase[] };

const key = (guard: Guard): string => JSON.stringify([guard.kind, guard.blockId, guard.viewId ?? null]);

const repeats = (blocks: OutputBlockData[]): boolean => new Set(blocks.map(block => block.id)).size < blocks.length;

/** The first copy of each id, as the servers' restore planner writes it. */
const firstCopies = (blocks: OutputBlockData[]): OutputBlockData[] =>
  blocks.filter((block, index) => blocks.findIndex(other => other.id === block.id) === index);

// A DocSnapshot refuses a repeated or empty id. The agent reads the live document as one, so it never meets a
// repeat there, and history.restore refuses a version with an empty id before it asks anything.
const agentCases = fixture.cases.filter(entry => !repeats(entry.current) && !entry.target.some(block => block.id === ''));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One view at a time, so a view the agent refuses to read (it throws) still names itself. */
const shareGuards = (now: DocSnapshot, target: OutputData): Guard[] => target.blocks.flatMap((block) => {
  const views = isRecord(block.data) && Array.isArray(block.data.views) ? block.data.views : [];

  return block.type !== 'database' || block.id === undefined ? [] : views.filter(isRecord).flatMap((view) => {
    const single: OutputData = { blocks: [{ ...block, data: { ...block.data, views: [view] } }] };
    const viewId = typeof view.id === 'string' ? view.id : '';

    try {
      return restoreShares(now, single).map(step => ({ kind: 'share' as const, blockId: step.blockId, viewId: step.viewId }));
    } catch (error) {
      expect(error).toBeInstanceOf(AgentFailure);

      return [{ kind: 'share' as const, blockId: block.id ?? '', viewId }];
    }
  });
});

const agentGuards = (current: OutputBlockData[], target: OutputBlockData[]): Guard[] => {
  const now = DocSnapshot.fromOutput({ blocks: current });
  const restored: OutputData = { blocks: firstCopies(target) };
  const unlocked = new Set(unlockedBetween(now, DocSnapshot.fromOutput(restored)));
  const locks = restoreTouchesLocked(now, restored)
    .map(blockId => ({ kind: unlocked.has(blockId) ? 'unlock' as const : 'lockedReshape' as const, blockId }));

  return [...locks, ...shareGuards(now, restored)];
};

describe('restore-guards.json agrees with the agent rules', () => {
  it('has cases of every kind', () => {
    const kinds = new Set(fixture.cases.flatMap(entry => entry.guards.map(guard => guard.kind)));

    expect([...kinds].sort()).toEqual(['lockedReshape', 'share', 'unlock']);
    expect(fixture.cases.some(entry => entry.guards.length === 0)).toBe(true);
  });

  it.each(agentCases.map(entry => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(agentGuards(entry.current, entry.target).map(key).sort()).toEqual(entry.guards.map(key).sort());
  });

  it('the lock guards together are exactly what restoreTouchesLocked asks about', () => {
    for (const entry of agentCases) {
      const ids = restoreTouchesLocked(DocSnapshot.fromOutput({ blocks: entry.current }), { blocks: entry.target });

      expect(entry.guards.filter(guard => guard.kind !== 'share').map(guard => guard.blockId).sort()).toEqual([...ids].sort());
    }
  });

  it('has cases where the target repeats an id', () => {
    expect(agentCases.filter(entry => repeats(entry.target)).length).toBeGreaterThanOrEqual(4);
  });

  it('restoreShares reads the first copy of a repeated id, as the servers do', () => {
    for (const entry of agentCases.filter(entry => repeats(entry.target))) {
      const steps = restoreShares(DocSnapshot.fromOutput({ blocks: entry.current }), { blocks: entry.target });

      expect(steps.map(step => key({ kind: 'share', blockId: step.blockId, viewId: step.viewId })).sort())
        .toEqual(entry.guards.filter(guard => guard.kind === 'share').map(key).sort());
    }
  });
});

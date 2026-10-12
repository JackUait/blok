import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../types';
import { ackedOnly, agentVisible, attributed, humanPreserved, leftRoom } from '../../evals/agent/graders/collab';
import type { ExecuteResult, GraderInput, Observed } from '../../evals/agent/types';

const final: OutputData = {
  blocks: [
    { id: 'h', type: 'paragraph', data: { text: [{ text: 'human typed this' }] }, lastEditedBy: 'human' },
    { id: 'a', type: 'list', data: { text: [{ text: 'summary' }], style: 'unordered' }, lastEditedBy: 'agent' },
  ],
};
const results: ExecuteResult[] = [{ ok: true, changed: { created: ['a'], updated: [], moved: [], removed: [] } }];
const observed: Observed = {
  humanId: 'human',
  humanTyped: { blockId: 'h', text: 'human typed this' },
  participants: [{ id: 'human', name: 'Ana' }, { id: 'agent', name: 'Agent' }],
  participantsAfterClose: [{ id: 'human', name: 'Ana' }],
  peerSawAgentCursorOn: ['a'],
  journalActors: ['human', 'agent'],
  serverAckedSequences: ['l1:7'],
};
const run = (over: Partial<GraderInput> = {}): GraderInput => ({ seed: { blocks: [] }, final, actorId: 'agent', log: [], results, observed, ...over });

describe('collab graders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('humanPreserved needs every typed character', () => {
    expect(humanPreserved().check(run()).pass).toBe(true);
    expect(humanPreserved().check(run({ observed: { ...observed, humanTyped: { blockId: 'h', text: 'human typed this too' } } })).pass).toBe(false);
  });

  it('agentVisible needs the participant row and a cursor on a touched block', () => {
    expect(agentVisible().check(run()).pass).toBe(true);
    expect(agentVisible().check(run({ observed: { ...observed, peerSawAgentCursorOn: [] } })).pass).toBe(false);
    expect(agentVisible().check(run({ observed: { ...observed, participants: [{ id: 'human', name: 'Ana' }] } })).pass).toBe(false);
  });

  it('attributed fails when a human-only block carries the agent id (06 C3)', () => {
    const stolen: OutputData = { blocks: final.blocks.map((b) => (b.id === 'h' ? { ...b, lastEditedBy: 'agent' } : b)) };

    expect(attributed().check(run()).pass).toBe(true);
    expect(attributed().check(run({ final: stolen })).pass).toBe(false);
  });

  it('attributed fails when the journal does not name the agent', () => {
    expect(attributed().check(run({ observed: { ...observed, journalActors: ['human'] } })).pass).toBe(false);
  });

  it('ackedOnly fails on durable work the server never acked', () => {
    const durable = (seq: string | null): ExecuteResult[] => [{ ok: true, delivery: { durable: true, pending: false, serverSequence: seq, savedVersion: null } }];

    expect(ackedOnly().check(run({ results: durable('l1:7') })).pass).toBe(true);
    expect(ackedOnly().check(run({ results: durable('l1:9') })).pass).toBe(false);
    expect(ackedOnly().check(run({ results: durable(null) })).pass).toBe(false);
  });

  it('leftRoom needs the agent gone from the participants after close', () => {
    expect(leftRoom().check(run()).pass).toBe(true);
    expect(leftRoom().check(run({ observed: { ...observed, participantsAfterClose: observed.participants } })).pass).toBe(false);
  });
});

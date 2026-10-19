// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { ANSWER_ID_LIMIT, modelAnswer } from '../../../../src/shared/agent/model-answer';

import type { AgentResult } from '../../../../types';

const ids = (count: number, prefix = 'b'): string[] => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

const success = (over: Partial<Extract<AgentResult, { ok: true }>> = {}): Extract<AgentResult, { ok: true }> => ({
  ok: true,
  revision: 'r1',
  results: [{}],
  refs: {},
  changed: { created: [], updated: [], moved: [], removed: [] },
  warnings: [],
  ...over,
});

describe('modelAnswer', () => {
  it('leaves out empty refs, warnings and changed lists', () => {
    const answer = modelAnswer(success({ changed: { created: [], updated: ['p'], moved: [], removed: [] } }));

    expect(answer).toEqual({ ok: true, revision: 'r1', results: [{}], changed: { updated: ['p'] } });
  });

  it('keeps the field order of the full result', () => {
    const answer = modelAnswer(success({ refs: { a: 'p' }, changed: { created: ['p'], updated: [], moved: [], removed: [] }, blocks: [] }));

    expect(Object.keys(answer)).toEqual(['ok', 'revision', 'results', 'refs', 'changed', 'blocks']);
  });

  it('leaves out changed when the batch changed nothing', () => {
    expect(modelAnswer(success())).toEqual({ ok: true, revision: 'r1', results: [{}] });
  });

  it('keeps refs and warnings that carry something', () => {
    const warning = { code: 'LOOKS_LIKE_MARKDOWN' as const, message: 'm', blockId: 'p' };
    const answer = modelAnswer(success({ refs: { a: 'p' }, warnings: [warning] }));

    expect(answer).toMatchObject({ refs: { a: 'p' }, warnings: [warning] });
  });

  it('caps a long changed list and says how many it left out', () => {
    const removed = ids(ANSWER_ID_LIMIT + 7);
    const answer = modelAnswer(success({ changed: { created: [], updated: [], moved: [], removed } }));

    expect(answer).toMatchObject({ changed: { removed: removed.slice(0, ANSWER_ID_LIMIT), moreRemoved: 7 } });
  });

  it('caps the ids a delete lists and says how many it left out', () => {
    const removedIds = ids(ANSWER_ID_LIMIT + 3, 'r');
    const liftedIds = ids(ANSWER_ID_LIMIT + 1, 'l');
    const answer = modelAnswer(success({ results: [{ removedIds, liftedIds }] }));

    expect(answer).toMatchObject({
      results: [{
        removedIds: removedIds.slice(0, ANSWER_ID_LIMIT), moreRemovedIds: 3,
        liftedIds: liftedIds.slice(0, ANSWER_ID_LIMIT), moreLiftedIds: 1,
      }],
    });
  });

  it('keeps every id a create returns, so the model can address the new blocks', () => {
    const childIds = ids(ANSWER_ID_LIMIT * 4, 'c');
    const created = ['t', ...childIds];
    const answer = modelAnswer(success({ results: [{ id: 't', childIds }, { ids: created }] }));

    expect(answer).toMatchObject({ results: [{ id: 't', childIds }, { ids: created }] });
  });

  it('keeps a list at the limit whole', () => {
    const removed = ids(ANSWER_ID_LIMIT);
    const answer = modelAnswer(success({ changed: { created: [], updated: [], moved: [], removed } }));

    expect(answer).toEqual({ ok: true, revision: 'r1', results: [{}], changed: { removed } });
  });

  it('leaves out empty warnings on a failure and keeps the rest', () => {
    const error = { code: 'BLOCK_NOT_FOUND' as const, message: 'No block', retryable: false };

    expect(modelAnswer({ ok: false, revision: 'r1', error, warnings: [] })).toEqual({ ok: false, revision: 'r1', error });
  });

  it('keeps fields it does not know, such as MCP delivery', () => {
    const delivery = { durable: true, pending: false, serverSequence: null, savedVersion: 'v' };

    const result: AgentResult & { delivery: typeof delivery } = { ...success(), delivery };

    expect(modelAnswer(result)).toMatchObject({ delivery });
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { caseStrings, projectAnswers } from './answers';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('projectAnswers', () => {
  it('keeps what the model reads and drops revision and delivery', () => {
    expect(projectAnswers([{
      ok: true,
      revision: 'r1',
      delivery: { durable: true },
      warnings: [{ code: 'TEXT_NORMALIZED', message: 'Any wording', commandIndex: 0, blockId: 'p1' }],
      changed: { updated: ['p1'] },
      results: [{ id: 'p1' }],
    }], new Set(['p1']))).toEqual([{
      ok: true,
      warnings: [{ code: 'TEXT_NORMALIZED', commandIndex: 0 }],
      changed: { created: [], updated: ['p1'], moved: [], removed: [] },
      blocks: [],
      refs: {},
    }]);
  });

  it('answers a refusal with its error code only', () => {
    expect(projectAnswers([{ ok: false, error: { code: 'BLOCK_NOT_FOUND', message: 'No block "x".' }, warnings: [] }], new Set()))
      .toEqual([{ ok: false, error: 'BLOCK_NOT_FOUND', warnings: [] }]);
  });

  it('labels minted ids by ref name, then by row order, the same way in every batch', () => {
    const answers = projectAnswers([
      {
        ok: true,
        refs: { first: 'mint-a' },
        changed: { created: ['mint-b', 'mint-a'] },
        blocks: [
          { id: 'mint-a', type: 'toggle', depth: 0 },
          { id: 'mint-b', type: 'paragraph', depth: 1, parentId: 'mint-a', data: { text: 'Hi' } },
        ],
      },
      { ok: true, changed: { removed: ['mint-b'] } },
    ], new Set());

    expect(answers).toEqual([
      {
        ok: true,
        warnings: [],
        refs: { first: '@first' },
        changed: { created: ['#1', '@first'], updated: [], moved: [], removed: [] },
        blocks: [
          { id: '@first', type: 'toggle', depth: 0 },
          { id: '#1', type: 'paragraph', depth: 1, parentId: '@first', data: { text: 'Hi' } },
        ],
      },
      { ok: true, warnings: [], refs: {}, blocks: [], changed: { created: [], updated: [], moved: [], removed: ['#1'] } },
    ]);
  });

  it('gives two engines that mint different ids the same projection', () => {
    const run = (prefix: string): unknown => projectAnswers([{
      ok: true,
      changed: { created: [`${prefix}-1`] },
      blocks: [{ id: `${prefix}-1`, type: 'paragraph', depth: 0, data: { text: 'x' } }],
    }], new Set());

    expect(run('json')).toEqual(run('mcp'));
  });

  it('keeps a load default in row data, since the model reads it', () => {
    const [answer] = projectAnswers([{
      ok: true, blocks: [{ id: 'q', type: 'quote', depth: 0, attrs: { size: 'default' }, data: { text: 'Q', size: 'default' } }],
    }], new Set(['q']));

    expect(answer.blocks).toEqual([{ id: 'q', type: 'quote', depth: 0, attrs: { size: 'default' }, data: { text: 'Q', size: 'default' } }]);
  });

  it('masks database ids inside row data as the document normalizer does', () => {
    const row = (propertyId: string): unknown => projectAnswers([{
      ok: true,
      blocks: [{
        id: 'db', type: 'database', depth: 0,
        data: { schema: [{ id: propertyId, name: 'Title', type: 'title', position: `a0${propertyId}` }], views: [] },
      }],
    }], new Set(['db']));

    expect(row('prop-x')).toEqual(row('prop-y'));
  });

  it('masks minted ids inside row data and attrs, and keeps the ones the case wrote', () => {
    const run = (minted: string): unknown => projectAnswers([{
      ok: true,
      blocks: [
        { id: 'img', type: 'image', depth: 0, data: { markup: [{ id: 'm1' }, { id: `${minted}-shape` }] } },
        { id: 't', type: 'table', depth: 0, data: { content: [[{ blocks: [`${minted}-cell`, 'seed-cell'] }]] } },
        {
          id: 'db', type: 'database', depth: 0, attrs: { activeViewId: `${minted}-view`, title: 'Tasks' },
          data: { schema: [], views: [{ id: `${minted}-view`, name: 'Table', type: 'table', position: 'a0' }], activeViewId: `${minted}-view` },
        },
      ],
    }], new Set(['img', 't', 'db', 'm1', 'seed-cell']));

    expect(run('json')).toEqual(run('mcp'));
    expect(JSON.stringify(run('json'))).toContain('"m1"');
    expect(JSON.stringify(run('json'))).toContain('"seed-cell"');
    expect(JSON.stringify(run('json'))).toContain('"title":"Tasks"');
  });
});

describe('caseStrings', () => {
  it('collects every string the seed and the commands write', () => {
    expect([...caseStrings({
      name: 'c',
      seed: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Hi' } }] },
      batches: [{ commands: [{ name: 'image.addMarkup', args: { id: 'img', items: [{ id: 'm1' }] } }] }],
    })].sort()).toEqual(['Hi', 'img', 'm1', 'p1', 'paragraph']);
  });
});

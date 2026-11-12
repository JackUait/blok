import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { filterMoveTargets, listMoveTargets, type MoveToBlock } from '../../../../../src/components/modules/toolbar/move-to';

const block = (id: string, name: string, parentId: string | null, data: Record<string, unknown> = {}, lastEditedAt?: number): MoveToBlock =>
  ({ id, name, parentId, preservedData: data, lastEditedAt });

const DATABASE = block('db', 'database', null, {
  title: 'Tasks',
  schema: [{ id: 'prop-title', name: 'Name', type: 'title', position: 'a0' }],
});

const allowAll = { canMoveInto: (): boolean => true, isReadOnly: (): boolean => false };

describe('listMoveTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers each database row whose body lives in this document, as a page', () => {
    const source = block('p', 'paragraph', null);
    const blocks = [
      source,
      DATABASE,
      block('r1', 'database-row', 'db', { title: 'Plan', icon: '📌', properties: {} }),
      block('r2', 'database-row', 'db', { properties: { 'prop-title': 'Old title' } }),
    ];

    expect(listMoveTargets(blocks, [source], allowAll)).toEqual([
      { pageId: 'r1', title: 'Plan', icon: { type: 'emoji', value: '📌' }, path: ['Tasks'] },
      { pageId: 'r2', title: 'Old title', path: ['Tasks'] },
    ]);
  });

  it('leaves out a row whose page lives in another document', () => {
    const source = block('p', 'paragraph', null);
    const blocks = [source, DATABASE, block('r1', 'database-row', 'db', { title: 'Moved out', pageId: 'page-9', properties: {} })];

    expect(listMoveTargets(blocks, [source], allowAll)).toEqual([]);
  });

  it('leaves out the page every moved block already sits in', () => {
    const source = block('p', 'paragraph', 'r1');
    const blocks = [DATABASE, block('r1', 'database-row', 'db', { title: 'Here', properties: {} }), source, block('r2', 'database-row', 'db', { title: 'There', properties: {} })];

    expect(listMoveTargets(blocks, [source], allowAll).map((target) => target.pageId)).toEqual(['r2']);
  });

  it('leaves out a row the core refuses or that is read-only', () => {
    const source = block('p', 'paragraph', null);
    const blocks = [source, DATABASE, block('r1', 'database-row', 'db', { properties: {} }), block('r2', 'database-row', 'db', { properties: {} })];

    expect(listMoveTargets(blocks, [source], {
      canMoveInto: (_root, rowId) => rowId !== 'r1',
      isReadOnly: () => false,
    }).map((target) => target.pageId)).toEqual(['r2']);
    expect(listMoveTargets(blocks, [source], {
      canMoveInto: () => true,
      isReadOnly: (candidate) => candidate.id === 'r2',
    }).map((target) => target.pageId)).toEqual(['r1']);
  });

  it('puts the most recently edited page first, counting edits in its body', () => {
    const source = block('p', 'paragraph', null);
    const blocks = [
      source,
      DATABASE,
      block('r1', 'database-row', 'db', { title: 'Old', properties: {} }, 100),
      block('r2', 'database-row', 'db', { title: 'Body edited', properties: {} }, 50),
      block('r2-body', 'paragraph', 'r2', {}, 500),
      block('r3', 'database-row', 'db', { title: 'Never edited', properties: {} }),
    ];

    expect(listMoveTargets(blocks, [source], allowAll).map((target) => target.pageId)).toEqual(['r2', 'r1', 'r3']);
  });
});

describe('filterMoveTargets', () => {
  it('keeps the pages whose title holds the query, ignoring case', () => {
    const targets = [{ pageId: 'a', title: 'Roadmap' }, { pageId: 'b', title: 'Notes' }, { pageId: 'c' }];

    expect(filterMoveTargets(targets, 'MAP', 'Untitled').map((target) => target.pageId)).toEqual(['a']);
    expect(filterMoveTargets(targets, 'untit', 'Untitled').map((target) => target.pageId)).toEqual(['c']);
    expect(filterMoveTargets(targets, '  ', 'Untitled')).toHaveLength(3);
  });
});

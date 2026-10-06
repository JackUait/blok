import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../types';
import { movePageBlocks, turnBlocksIntoPage, turnPageIntoBlocks } from '../../../src/view';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

const doc = (blocks: OutputBlockData[]): OutputData => ({ blocks });

describe('movePageBlocks', () => {
  it('moves an owning page pointer without copying the page body', () => {
    const source = doc([{ id: 'ptr', type: 'page', data: { pageId: 'child-page' } }]);
    const target = doc([{ id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } }]);

    const moved = movePageBlocks(source, target, ['ptr'], { parentId: null, afterId: 'anchor' });

    expect(moved.target.blocks.map((block) => block.id)).toEqual(['anchor', 'ptr']);
    expect(moved.target.blocks[1]?.data).toEqual({ pageId: 'child-page' });
    expect(moved.movedIds).toEqual(['ptr']);
    expect(moved.source.blocks).toEqual([]);
    expect(source.blocks[0]?.id).toBe('ptr');
    expect(target.blocks).toHaveLength(1);
  });

  it('moves children in content order when the flat array is shuffled', () => {
    const source = doc([
      { id: 'toggle', type: 'toggle', data: { text: 'Parent' }, content: ['first', 'second'] },
      { id: 'second', type: 'paragraph', parent: 'toggle', data: { text: '2' } },
      { id: 'first', type: 'paragraph', parent: 'toggle', data: { text: '1' } },
    ]);

    const moved = movePageBlocks(source, doc([]), ['toggle'], { parentId: null, afterId: null });

    expect(moved.movedIds).toEqual(['toggle', 'first', 'second']);
    expect(moved.target.blocks.map((block) => block.id)).toEqual(['toggle', 'first', 'second']);
    expect(moved.target.blocks[0]?.content).toEqual(['first', 'second']);
    expect(moved.target.blocks[1]?.parent).toBe('toggle');
    expect(source.blocks.map((block) => block.id)).toEqual(['toggle', 'second', 'first']);
  });

  it('inserts roots under a target container in requested order', () => {
    const source = doc([
      { id: 'one', type: 'paragraph', data: { text: 'One' } },
      { id: 'two', type: 'paragraph', data: { text: 'Two' } },
    ]);
    const target = doc([
      { id: 'container', type: 'toggle', data: { text: 'Target' }, content: ['anchor'] },
      { id: 'anchor', type: 'paragraph', parent: 'container', data: { text: 'Anchor' } },
    ]);

    const moved = movePageBlocks(source, target, ['two', 'one'], {
      parentId: 'container',
      afterId: 'anchor',
    });

    expect(moved.target.blocks[0]?.content).toEqual(['anchor', 'two', 'one']);
    expect(moved.target.blocks.map((block) => block.id)).toEqual(['container', 'anchor', 'two', 'one']);
    expect(moved.target.blocks[2]?.parent).toBe('container');
    expect(moved.target.blocks[3]?.parent).toBe('container');
    expect(target.blocks[0]?.content).toEqual(['anchor']);
  });

  it('places a root after the requested sibling when target descendants are shuffled', () => {
    const source = doc([{ id: 'moved', type: 'paragraph', data: { text: 'Moved' } }]);
    const target = doc([
      { id: 'anchor', type: 'toggle', data: {}, content: ['child'] },
      { id: 'next', type: 'paragraph', data: { text: 'Next' } },
      { id: 'child', type: 'paragraph', parent: 'anchor', data: { text: 'Child' } },
    ]);

    const moved = movePageBlocks(source, target, ['moved'], { parentId: null, afterId: 'anchor' });

    expect(moved.target.blocks.filter((block) => !block.parent).map((block) => block.id))
      .toEqual(['anchor', 'moved', 'next']);
    expect(target.blocks.map((block) => block.id)).toEqual(['anchor', 'next', 'child']);
  });

  it('rejects an unrelated dangling child before returning source and target snapshots', () => {
    const source = doc([
      { id: 'keep', type: 'toggle', data: {}, content: ['missing'] },
      { id: 'moved', type: 'paragraph', data: { text: 'Moved' } },
    ]);
    const before = JSON.stringify(source);

    expect(() => movePageBlocks(source, doc([]), ['moved'], { parentId: null, afterId: null }))
      .toThrow(/child/i);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects duplicate target content IDs', () => {
    const source = doc([{ id: 'moved', type: 'paragraph', data: {} }]);
    const target = doc([
      { id: 'container', type: 'toggle', data: {}, content: ['child', 'child'] },
      { id: 'child', type: 'paragraph', parent: 'container', data: {} },
    ]);

    expect(() => movePageBlocks(source, target, ['moved'], { parentId: 'container', afterId: 'child' }))
      .toThrow(/duplicate/i);
  });

  it('rejects a partial move from inside a table descendant', () => {
    const source = doc([
      { id: 'table', type: 'table', data: {}, content: ['container'] },
      { id: 'container', type: 'toggle', parent: 'table', data: {}, content: ['leaf'] },
      { id: 'leaf', type: 'paragraph', parent: 'container', data: { text: 'Value' } },
    ]);

    expect(() => movePageBlocks(source, doc([]), ['leaf'], { parentId: null, afterId: null }))
      .toThrow(/table/i);
  });

  it('rejects moving a database row without its database', () => {
    const source = doc([
      { id: 'database', type: 'database', data: {}, content: ['row'] },
      { id: 'row', type: 'database-row', parent: 'database', data: { properties: {} } },
    ]);
    const before = structuredClone(source);

    expect(() => movePageBlocks(source, doc([]), ['row'], { parentId: null, afterId: null }))
      .toThrow(/database/i);
    expect(source).toEqual(before);
  });

  it('rejects a target hierarchy cycle without changing either document', () => {
    const source = doc([{ id: 'm', type: 'paragraph', data: { text: 'M' } }]);
    const target = doc([
      { id: 'a', type: 'toggle', parent: 'b', content: ['b'], data: {} },
      { id: 'b', type: 'toggle', parent: 'a', content: ['a'], data: {} },
    ]);
    const before = JSON.stringify({ source, target });

    expect(() => movePageBlocks(source, target, ['m'], { parentId: 'a', afterId: null }))
      .toThrow(/cycle/i);
    expect(JSON.stringify({ source, target })).toBe(before);
  });

  it('rejects overlapping roots in either selection order', () => {
    const source = doc([
      { id: 'parent', type: 'toggle', data: {}, content: ['child'] },
      { id: 'child', type: 'paragraph', parent: 'parent', data: { text: 'Child' } },
    ]);
    const target = doc([]);
    const before = JSON.stringify({ source, target });
    const place = { parentId: null, afterId: null };

    expect(() => movePageBlocks(source, target, ['child', 'parent'], place))
      .toThrow(/selected twice/i);
    expect(() => movePageBlocks(source, target, ['parent', 'child'], place))
      .toThrow(/selected twice/i);
    expect(JSON.stringify({ source, target })).toBe(before);
  });

  it.each([
    [
      'duplicate roots',
      doc([{ id: 'm', type: 'paragraph', data: { text: 'M' } }]),
      ['m', 'm'],
      doc([]),
      { parentId: null, afterId: null },
      /roots/i,
    ],
    [
      'missing child',
      doc([{ id: 'container', type: 'toggle', data: {}, content: ['absent'] }]),
      ['container'],
      doc([]),
      { parentId: null, afterId: null },
      /child/i,
    ],
    [
      'target collision',
      doc([{ id: 'm', type: 'paragraph', data: { text: 'M' } }]),
      ['m'],
      doc([{ id: 'm', type: 'paragraph', data: {} }]),
      { parentId: null, afterId: null },
      /collision/i,
    ],
    [
      'missing target parent',
      doc([{ id: 'm', type: 'paragraph', data: { text: 'M' } }]),
      ['m'],
      doc([]),
      { parentId: 'absent', afterId: null },
      /parent/i,
    ],
    [
      'invalid target sibling',
      doc([{ id: 'm', type: 'paragraph', data: { text: 'M' } }]),
      ['m'],
      doc([]),
      { parentId: null, afterId: 'absent' },
      /sibling/i,
    ],
  ] as const)('rejects %s without changing either input', (_name, source, roots, target, place, error) => {
    const before = JSON.stringify({ source, target });

    expect(() => movePageBlocks(source, target, roots, place)).toThrow(error);
    expect(JSON.stringify({ source, target })).toBe(before);
  });

  it('rejects a partial move of a table cell', () => {
    const source = doc([
      { id: 'table', type: 'table', data: {}, content: ['cell'] },
      { id: 'cell', type: 'table-cell', parent: 'table', data: { text: 'Value' } },
    ]);
    const before = JSON.stringify(source);

    expect(() => movePageBlocks(source, doc([]), ['cell'], { parentId: null, afterId: null }))
      .toThrow(/table/i);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects a root whose source parent omits it', () => {
    const source = doc([
      { id: 'parent', type: 'toggle', data: {}, content: [] },
      { id: 'child', type: 'paragraph', parent: 'parent', data: { text: 'Lost' } },
    ]);

    expect(() => movePageBlocks(source, doc([]), ['child'], { parentId: null, afterId: null }))
      .toThrow(/source parent/i);
  });

  it('rejects a target child omitted from its parent content', () => {
    const source = doc([{ id: 'm', type: 'paragraph', data: { text: 'Move' } }]);
    const target = doc([
      { id: 'parent', type: 'toggle', data: {}, content: [] },
      { id: 'hidden', type: 'paragraph', parent: 'parent', data: { text: 'Hidden' } },
    ]);

    expect(() => movePageBlocks(source, target, ['m'], { parentId: 'parent', afterId: null }))
      .toThrow(/target parent/i);
  });

  it('moves a consumer page tool with its child blocks', () => {
    const source = doc([
      { id: 'custom-page', type: 'page', data: { text: 'Custom page' }, content: ['child'] },
      { id: 'child', type: 'paragraph', parent: 'custom-page', data: { text: 'Body' } },
    ]);

    const moved = movePageBlocks(source, doc([]), ['custom-page'], { parentId: null, afterId: null });

    expect(moved.target.blocks.map((block) => block.id)).toEqual(['custom-page', 'child']);
    expect(moved.target.blocks[0]?.content).toEqual(['child']);
  });

  it('places blocks under a consumer page tool', () => {
    const source = doc([{ id: 'child', type: 'paragraph', data: { text: 'Body' } }]);
    const target = doc([{ id: 'custom-page', type: 'page', data: { text: 'Custom page' }, content: [] }]);

    const moved = movePageBlocks(source, target, ['child'], { parentId: 'custom-page', afterId: null });

    expect(moved.target.blocks[0]?.content).toEqual(['child']);
    expect(moved.target.blocks[1]?.parent).toBe('custom-page');
  });

  it('rejects putting blocks under a page pointer', () => {
    const source = doc([{ id: 'm', type: 'paragraph', data: { text: 'M' } }]);
    const target = doc([{ id: 'page', type: 'page', data: { pageId: 'child-page' } }]);
    const before = JSON.stringify({ source, target });

    expect(() => movePageBlocks(source, target, ['m'], { parentId: 'page', afterId: null }))
      .toThrow(/page pointer/i);
    expect(JSON.stringify({ source, target })).toBe(before);
  });

  it('rejects putting blocks under a page link without changing either document', () => {
    const source = doc([{ id: 'm', type: 'paragraph', data: { text: 'M' } }]);
    const target = doc([{ id: 'link', type: 'page-link', data: { pageId: 'child-page' } }]);
    const before = structuredClone({ source, target });

    expect(() => movePageBlocks(source, target, ['m'], { parentId: 'link', afterId: null }))
      .toThrow(/page.link|contain|child/i);
    expect({ source, target }).toEqual(before);
  });

  it.each(['table', 'column_list'])('rejects a paragraph moved under a %s', (parentType) => {
    const source = doc([{ id: 'moved', type: 'paragraph', data: { text: 'Moved' } }]);
    const target = doc([{ id: 'parent', type: parentType, data: {}, content: [] }]);
    const before = structuredClone({ source, target });

    expect(() => movePageBlocks(source, target, ['moved'], { parentId: 'parent', afterId: null }))
      .toThrow(/table|column/i);
    expect({ source, target }).toEqual(before);
  });

  it('rejects a paragraph moved under a database', () => {
    const source = doc([{ id: 'paragraph', type: 'paragraph', data: { text: 'Hidden' } }]);
    const target = doc([{ id: 'database', type: 'database', data: {}, content: [] }]);
    const before = structuredClone({ source, target });

    expect(() => movePageBlocks(source, target, ['paragraph'], { parentId: 'database', afterId: null }))
      .toThrow(/database.*row/i);
    expect({ source, target }).toEqual(before);
  });

  it('rejects a paragraph moved under a tabs block', () => {
    const source = doc([{ id: 'moved', type: 'paragraph', data: { text: 'Moved' } }]);
    const target = doc([{ id: 'tabs', type: 'tabs', data: {}, content: [] }]);
    const before = structuredClone({ source, target });

    expect(() => movePageBlocks(source, target, ['moved'], { parentId: 'tabs', afterId: null }))
      .toThrow(/tabs only accepts tab children/i);
    expect({ source, target }).toEqual(before);
  });

  it('rejects moving one tab out of its tabs block', () => {
    const source = doc([
      { id: 'tabs', type: 'tabs', data: {}, content: ['tab'] },
      { id: 'tab', type: 'tab', parent: 'tabs', data: { title: 'One' } },
    ]);
    const before = structuredClone(source);

    expect(() => movePageBlocks(source, doc([]), ['tab'], { parentId: null, afterId: null }))
      .toThrow(/whole .*tabs/i);
    expect(source).toEqual(before);
  });

  it('moves a whole tabs block with its tabs and their content', () => {
    const source = doc([
      { id: 'tabs', type: 'tabs', data: {}, content: ['tab'] },
      { id: 'tab', type: 'tab', parent: 'tabs', data: { title: 'One' }, content: ['p'] },
      { id: 'p', type: 'paragraph', parent: 'tab', data: { text: 'Body' } },
    ]);

    const moved = movePageBlocks(source, doc([]), ['tabs'], { parentId: null, afterId: null });

    expect(moved.target.blocks.map((block) => block.id)).toEqual(['tabs', 'tab', 'p']);
    expect(moved.source.blocks).toEqual([]);
  });

  it('allows a column moved under a column list', () => {
    const source = doc([{ id: 'column', type: 'column', data: {} }]);
    const target = doc([{ id: 'columns', type: 'column_list', data: {}, content: [] }]);

    const moved = movePageBlocks(source, target, ['column'], { parentId: 'columns', afterId: null });

    expect(moved.target.blocks[0]?.content).toEqual(['column']);
    expect(moved.target.blocks[1]?.parent).toBe('columns');
  });
});

describe('turnBlocksIntoPage', () => {
  it('replaces selected blocks with an ID-only page pointer', () => {
    const source = doc([
      { id: 'before', type: 'paragraph', data: { text: 'Before' } },
      { id: 'selected', type: 'paragraph', data: { text: 'Selected' } },
      { id: 'after', type: 'paragraph', data: { text: 'After' } },
    ]);

    const result = turnBlocksIntoPage(source, ['selected'], {
      pageId: 'new-page',
      pointerId: 'ptr',
    });

    expect(result.source.blocks.map((block) => block.id)).toEqual(['before', 'ptr', 'after']);
    expect(result.source.blocks[1]?.data).toEqual({ pageId: 'new-page' });
    expect(result.pageBody.blocks.map((block) => block.id)).toEqual(['selected']);
    expect(result.pointerId).toBe('ptr');
    expect(source.blocks.map((block) => block.id)).toEqual(['before', 'selected', 'after']);
  });

  it('replaces adjacent nested siblings and preserves body child order', () => {
    const source = doc([
      { id: 'container', type: 'toggle', data: {}, content: ['before', 'first', 'second', 'after'] },
      { id: 'before', type: 'paragraph', parent: 'container', data: { text: 'Before' } },
      { id: 'first', type: 'toggle', parent: 'container', data: {}, content: ['child'] },
      { id: 'child', type: 'paragraph', parent: 'first', data: { text: 'Child' } },
      { id: 'second', type: 'paragraph', parent: 'container', data: { text: 'Second' } },
      { id: 'after', type: 'paragraph', parent: 'container', data: { text: 'After' } },
    ]);

    const result = turnBlocksIntoPage(source, ['first', 'second'], {
      pageId: 'nested-page',
      pointerId: 'ptr',
    });

    expect(result.source.blocks[0]?.content).toEqual(['before', 'ptr', 'after']);
    expect(result.source.blocks.find((block) => block.id === 'ptr')?.parent).toBe('container');
    expect(result.pageBody.blocks.map((block) => block.id)).toEqual(['first', 'child', 'second']);
    expect(result.pageBody.blocks[0]?.parent).toBeUndefined();
    expect(result.pageBody.blocks[1]?.parent).toBe('first');
    expect(result.pageBody.blocks[2]?.parent).toBeUndefined();
  });

  it('replaces a selected block inside a column without losing its position', () => {
    const source = doc([
      { id: 'column', type: 'column', data: {}, content: ['before', 'selected', 'after'] },
      { id: 'before', type: 'paragraph', parent: 'column', data: { text: 'Before' } },
      { id: 'selected', type: 'paragraph', parent: 'column', data: { text: 'Selected' } },
      { id: 'after', type: 'paragraph', parent: 'column', data: { text: 'After' } },
    ]);

    const result = turnBlocksIntoPage(source, ['selected'], { pageId: 'child', pointerId: 'ptr' });

    expect(result.source.blocks[0]?.content).toEqual(['before', 'ptr', 'after']);
    expect(result.source.blocks.find((block) => block.id === 'ptr')?.parent).toBe('column');
    expect(result.pageBody.blocks[0]?.id).toBe('selected');
    expect(source.blocks[0]?.content).toEqual(['before', 'selected', 'after']);
  });

  it('rejects a discontiguous or mixed-parent selection without changing the input', () => {
    const source = doc([
      { id: 'container', type: 'toggle', data: {}, content: ['first', 'middle', 'last'] },
      { id: 'first', type: 'paragraph', parent: 'container', data: {} },
      { id: 'middle', type: 'paragraph', parent: 'container', data: {} },
      { id: 'last', type: 'paragraph', parent: 'container', data: {} },
      { id: 'other', type: 'paragraph', data: {} },
    ]);
    const before = JSON.stringify(source);

    expect(() => turnBlocksIntoPage(source, ['first', 'last'], {
      pageId: 'new-page', pointerId: 'ptr',
    })).toThrow(/adjacent/i);
    expect(() => turnBlocksIntoPage(source, ['first', 'other'], {
      pageId: 'new-page', pointerId: 'ptr',
    })).toThrow(/parent/i);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('turnPageIntoBlocks', () => {
  it('keeps a page pointer when body loading failed or loaded the wrong page', () => {
    const source = doc([{ id: 'ptr', type: 'page', data: { pageId: 'child' } }]);
    const before = JSON.stringify(source);

    expect(() => turnPageIntoBlocks(source, 'ptr', null)).toThrow(/body/i);
    expect(() => turnPageIntoBlocks(source, 'ptr', { pageId: 'other', body: doc([]) }))
      .toThrow(/pageId/i);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('removes the pointer only after successfully loading an empty body', () => {
    const source = doc([{ id: 'ptr', type: 'page', data: { pageId: 'child' } }]);

    const result = turnPageIntoBlocks(source, 'ptr', { pageId: 'child', body: doc([]) });

    expect(result.source.blocks).toEqual([]);
    expect(result.retiredPageId).toBe('child');
    expect(result.movedIds).toEqual([]);
    expect(source.blocks).toHaveLength(1);
  });

  it('puts loaded body roots at the pointer position with unchanged IDs', () => {
    const source = doc([
      { id: 'container', type: 'toggle', data: {}, content: ['before', 'ptr', 'after'] },
      { id: 'before', type: 'paragraph', parent: 'container', data: {} },
      { id: 'ptr', type: 'page', parent: 'container', data: { pageId: 'child' } },
      { id: 'after', type: 'paragraph', parent: 'container', data: {} },
    ]);
    const body = doc([
      { id: 'first', type: 'toggle', data: {}, content: ['nested'] },
      { id: 'nested', type: 'paragraph', parent: 'first', data: { text: 'N' } },
      { id: 'second', type: 'paragraph', data: { text: 'S' } },
    ]);

    const result = turnPageIntoBlocks(source, 'ptr', { pageId: 'child', body });

    expect(result.source.blocks[0]?.content).toEqual(['before', 'first', 'second', 'after']);
    expect(result.source.blocks.map((block) => block.id)).toEqual([
      'container', 'before', 'first', 'nested', 'second', 'after',
    ]);
    expect(result.movedIds).toEqual(['first', 'nested', 'second']);
    expect(result.retiredPageId).toBe('child');
    expect(body.blocks[0]?.parent).toBeUndefined();
  });

  it('expands a loaded page pointer inside a column', () => {
    const source = doc([
      { id: 'column', type: 'column', data: {}, content: ['before', 'ptr', 'after'] },
      { id: 'before', type: 'paragraph', parent: 'column', data: { text: 'Before' } },
      { id: 'ptr', type: 'page', parent: 'column', data: { pageId: 'child' } },
      { id: 'after', type: 'paragraph', parent: 'column', data: { text: 'After' } },
    ]);
    const body = doc([{ id: 'from-page', type: 'paragraph', data: { text: 'Body' } }]);

    const result = turnPageIntoBlocks(source, 'ptr', { pageId: 'child', body });

    expect(result.source.blocks[0]?.content).toEqual(['before', 'from-page', 'after']);
    expect(result.source.blocks.find((block) => block.id === 'from-page')?.parent).toBe('column');
    expect(result.source.blocks.some((block) => block.id === 'ptr')).toBe(false);
    expect(source.blocks[0]?.content).toEqual(['before', 'ptr', 'after']);
  });

  it('rejects loaded block ID collisions without removing the pointer', () => {
    const source = doc([
      { id: 'ptr', type: 'page', data: { pageId: 'child' } },
      { id: 'same', type: 'paragraph', data: { text: 'Existing' } },
    ]);
    const before = JSON.stringify(source);

    expect(() => turnPageIntoBlocks(source, 'ptr', {
      pageId: 'child', body: doc([{ id: 'same', type: 'paragraph', data: {} }]),
    })).toThrow(/collision/i);
    expect(JSON.stringify(source)).toBe(before);
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockPosition, RichText, ToolActionImpl } from '../../../../types';
import type { ToolActionContext as ToolsActionContext } from '../../../../types/tools';

import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';
import type { FakeDoc } from './fake-ctx';

const rootIds = (doc: FakeDoc): string[] => [...doc.values()]
  .filter(block => block.parentId === null)
  .map(block => block.id);

const positions: Array<{ position: BlockPosition; inserted: string[]; moved: string[] }> = [
  { position: 'start', inserted: ['n1', 'a', 'b', 'c'], moved: ['c', 'a', 'b'] },
  { position: 'end', inserted: ['a', 'b', 'c', 'n1'], moved: ['a', 'b', 'c'] },
  { position: { before: 'b' }, inserted: ['a', 'n1', 'b', 'c'], moved: ['a', 'c', 'b'] },
  { position: { after: 'a' }, inserted: ['a', 'n1', 'b', 'c'], moved: ['a', 'c', 'b'] },
];

describe('fake recording ctx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records writes and lets later reads and the target see them', () => {
    const doc = docOf([{ id: 't', type: 'table', data: { content: [] } }]);
    const ctx = createFakeCtx(doc, 't');
    const child = ctx.insert({ type: 'paragraph', data: { text: [] }, parentId: 't' });

    ctx.update('t', { content: [[{ blocks: [child] }]] });

    expect(ctx.read('t')).toMatchObject({ children: ['n1'], data: { content: [[{ blocks: ['n1'] }]] } });
    expect(ctx.edits).toEqual([
      { op: 'insert', id: 'n1', type: 'paragraph', parentId: 't' },
      { op: 'update', id: 't', patch: { content: [[{ blocks: ['n1'] }]] } },
    ]);
    expect(ctx.block).toEqual({ id: 't', type: 'table', data: { content: [[{ blocks: ['n1'] }]] }, children: ['n1'] });
    expect(ctx.tool).toBe('table');
  });

  it('runs a create handler under the configured registry key', () => {
    const ctx: ToolsActionContext = createFakeCtx(docOf([]), undefined, 'grid');
    const action: ToolActionImpl<{ label: string }, string, string> = {
      run: (context, args, prepared) => context.insert({ type: context.tool, data: { label: args.label, prepared } }),
    };
    const id = action.run(ctx, { label: 'Grid' }, 'ready');

    expect(ctx.read(id)).toMatchObject({ type: 'grid', data: { label: 'Grid', prepared: 'ready' } });
    expect(ctx.block).toBeUndefined();
  });

  it('allows an explicit registry key for a target block', () => {
    const doc = docOf([{ id: 't', type: 'table', data: {} }]);

    expect(createFakeCtx(doc, 't', 'grid').tool).toBe('grid');
    expect(createFakeCtx(doc).tool).toBe('');
    expect(createFakeCtx(doc, 'missing').block).toBeUndefined();
    expect(createFakeCtx(doc).read('missing')).toBeNull();
  });

  it('builds child order from the input document', () => {
    const doc = docOf([
      { id: 'p', type: 'column', data: {} },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'a', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'r', type: 'paragraph', data: {} },
    ]);
    const ctx = createFakeCtx(doc);

    expect(ctx.read('p')?.children).toEqual(['b', 'a']);
    expect(ctx.read('a')?.parentId).toBe('p');
    expect(rootIds(doc)).toEqual(['p', 'r']);
  });

  it('inserts recursive child specs and records their parent links', () => {
    const ctx = createFakeCtx(docOf([]));
    const id = ctx.insert({
      type: 'column',
      children: [{ type: 'toggle', data: { text: [] }, children: [{ type: 'paragraph' }] }],
    });

    expect(ctx.read(id)?.children).toEqual(['n2']);
    expect(ctx.read('n2')).toEqual({ id: 'n2', type: 'toggle', data: { text: [] }, parentId: 'n1', children: ['n3'] });
    expect(ctx.read('n3')).toEqual({ id: 'n3', type: 'paragraph', data: {}, parentId: 'n2', children: [] });
    expect(ctx.edits).toEqual([
      { op: 'insert', id: 'n1', type: 'column', parentId: null },
      { op: 'insert', id: 'n2', type: 'toggle', parentId: 'n1' },
      { op: 'insert', id: 'n3', type: 'paragraph', parentId: 'n2' },
    ]);
  });

  it('uses an explicit child id reserved before insertion', () => {
    const ctx = createFakeCtx(docOf([]));
    const childId = ctx.newId();
    const parentId = ctx.insert({ type: 'column', children: [{ id: childId, type: 'paragraph' }] });

    expect(ctx.read(parentId)?.children).toEqual(['n1']);
    expect(ctx.read('n1')?.parentId).toBe('n2');
    expect(ctx.newId()).toBe('n3');
  });

  it('rejects an explicit child id that already belongs to a block', () => {
    const ctx = createFakeCtx(docOf([{ id: 'taken', type: 'paragraph', data: { text: 'kept' } }]));

    expect(() => ctx.insert({ type: 'column', children: [{ id: 'taken', type: 'paragraph' }] })).toThrow(FakeFailure);
    expect(ctx.read('taken')?.data).toEqual({ text: 'kept' });
  });

  it('consumes a reserved explicit child id only once even after removal', () => {
    const doc = docOf([]);
    const ctx = createFakeCtx(doc);
    const childId = ctx.newId();

    ctx.insert({ type: 'column', children: [{ id: childId, type: 'paragraph' }] });
    ctx.remove(childId);

    expect(() => createFakeCtx(doc).insert({ type: 'column', children: [{ id: childId, type: 'paragraph' }] })).toThrow(FakeFailure);
  });

  it.each([null, undefined])('deletes a data key set to %s and records null', value => {
    const ctx = createFakeCtx(docOf([{ id: 'a', type: 'paragraph', data: { removed: 'old', kept: 'yes' } }]), 'a');

    ctx.update('a', { removed: value, added: 'new' });

    expect(ctx.read('a')?.data).toEqual({ kept: 'yes', added: 'new' });
    expect(ctx.block?.data).toEqual({ kept: 'yes', added: 'new' });
    expect(ctx.edits).toEqual([{ op: 'update', id: 'a', patch: { removed: null, added: 'new' } }]);
  });

  it.each([null, undefined])('deletes an own __proto__ data key set to %s and records null', value => {
    const data = Object.fromEntries<unknown>([['__proto__', 'old'], ['kept', true]]);
    const patch = Object.fromEntries<unknown>([['__proto__', value]]);
    const ctx = createFakeCtx(docOf([{ id: 'a', type: 'paragraph', data }]), 'a');

    ctx.update('a', patch);

    expect(ctx.read('a')?.data).toEqual({ kept: true });
    expect(ctx.block?.data).toEqual({ kept: true });
    const edit = ctx.edits[0];

    if (edit?.op !== 'update') {
      throw new Error('Missing update edit');
    }
    expect(Object.entries(edit.patch)).toEqual([['__proto__', null]]);
  });

  it('preserves unrelated data fields for an own object-valued __proto__ patch', () => {
    const ctx = createFakeCtx(docOf([{ id: 'a', type: 'paragraph', data: { kept: true, untouched: null } }]), 'a');
    const patch = Object.fromEntries<unknown>([['__proto__', { kept: null }]]);

    ctx.update('a', patch);

    expect(ctx.read('a')?.data).toEqual({ kept: true, untouched: null, ['__proto__']: { kept: null } });
    expect(ctx.block?.data).toEqual({ kept: true, untouched: null, ['__proto__']: { kept: null } });
    const edit = ctx.edits[0];

    if (edit?.op !== 'update') {
      throw new Error('Missing update edit');
    }
    expect(Object.entries(edit.patch)).toEqual([['__proto__', { kept: null }]]);
  });

  it('sets rich text without running rich-text algorithms', () => {
    const ctx = createFakeCtx(docOf([{ id: 'a', type: 'paragraph', data: { kept: 1 } }]));
    const value: RichText = [{ text: 'Hello', marks: { bold: true } }];

    ctx.setRichText('a', 'text', value);

    expect(ctx.read('a')?.data).toEqual({ kept: 1, text: [{ text: 'Hello', marks: { bold: true } }] });
    expect(ctx.edits).toEqual([{ op: 'setRichText', id: 'a', field: 'text' }]);
  });

  it('does not overwrite an existing generated-style id', () => {
    const ctx = createFakeCtx(docOf([{ id: 'n1', type: 'paragraph', data: { text: 'kept' } }]));
    const id = ctx.insert({ type: 'column' });

    expect(id).toBe('n2');
    expect(ctx.read('n1')?.data).toEqual({ text: 'kept' });
    expect(rootIds(ctx.doc)).toEqual(['n1', 'n2']);
  });

  it('reserves new ids across contexts before they are inserted', () => {
    const doc = docOf([]);
    const first = createFakeCtx(doc);
    const second = createFakeCtx(doc);

    expect(first.newId()).toBe('n1');
    expect(second.newId()).toBe('n2');
    expect(first.insert({ type: 'paragraph' })).toBe('n3');
    expect(second.newId()).toBe('n4');
    expect(second.insert({ type: 'paragraph' })).toBe('n5');
    expect(createFakeCtx(doc).newId()).toBe('n6');
    expect(rootIds(doc)).toEqual(['n3', 'n5']);
  });

  it('does not reuse an id after its block is removed', () => {
    const doc = docOf([]);
    const ctx = createFakeCtx(doc);
    const id = ctx.insert({ type: 'paragraph' });

    ctx.remove(id);

    expect(createFakeCtx(doc).insert({ type: 'paragraph' })).toBe('n2');
  });

  it.each(positions)('orders root inserts at $position', ({ position, inserted }) => {
    const doc = docOf([
      { id: 'a', type: 'column', data: {} },
      { id: 'nested', type: 'paragraph', data: {}, parentId: 'a' },
      { id: 'b', type: 'paragraph', data: {} },
      { id: 'c', type: 'paragraph', data: {} },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.insert({ type: 'paragraph', position });

    expect(rootIds(doc)).toEqual(inserted);
    expect(ctx.read('a')?.children).toEqual(['nested']);
  });

  it.each(positions)('orders nested inserts at $position', ({ position, inserted }) => {
    const doc = docOf([
      { id: 'p', type: 'column', data: {} },
      { id: 'a', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'c', type: 'paragraph', data: {}, parentId: 'p' },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.insert({ type: 'paragraph', parentId: 'p', position });

    expect(ctx.read('p')?.children).toEqual(inserted);
    expect(rootIds(doc)).toEqual(['p']);
  });

  it.each(positions)('orders root moves at $position', ({ position, moved }) => {
    const doc = docOf([
      { id: 'a', type: 'column', data: {} },
      { id: 'b', type: 'paragraph', data: {} },
      { id: 'c', type: 'toggle', data: {} },
      { id: 'nested', type: 'paragraph', data: {}, parentId: 'c' },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.move('c', { position });

    expect(rootIds(doc)).toEqual(moved);
    expect(ctx.read('c')?.children).toEqual(['nested']);
    expect(ctx.read('nested')?.parentId).toBe('c');
    expect(ctx.edits).toEqual([{ op: 'move', id: 'c', parentId: null }]);
  });

  it.each(positions)('orders nested moves at $position', ({ position, moved }) => {
    const doc = docOf([
      { id: 'p', type: 'column', data: {} },
      { id: 'a', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'c', type: 'paragraph', data: {}, parentId: 'p' },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.move('c', { parentId: 'p', position });

    expect(ctx.read('p')?.children).toEqual(moved);
    expect(ctx.edits).toEqual([{ op: 'move', id: 'c', parentId: 'p' }]);
  });

  it('infers the parent of a before or after reference', () => {
    const doc = docOf([
      { id: 'p', type: 'column', data: {} },
      { id: 'a', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'moved', type: 'paragraph', data: {} },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.insert({ type: 'paragraph', position: { before: 'b' } });
    ctx.move('moved', { position: { after: 'a' } });

    expect(ctx.read('p')?.children).toEqual(['a', 'moved', 'n1', 'b']);
    expect(ctx.read('n1')?.parentId).toBe('p');
    expect(ctx.read('moved')?.parentId).toBe('p');
    expect(rootIds(doc)).toEqual(['p']);
  });

  it('moves a block between parents and back to the root', () => {
    const doc = docOf([
      { id: 'p', type: 'column', data: {} },
      { id: 'q', type: 'column', data: {} },
      { id: 'a', type: 'toggle', data: {}, parentId: 'p' },
      { id: 'child', type: 'paragraph', data: {}, parentId: 'a' },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'q' },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.move('a', { parentId: 'q', position: { before: 'b' } });

    expect(ctx.read('q')?.children).toEqual(['a', 'b']);
    expect(ctx.read('p')?.children).toEqual([]);
    expect(ctx.read('a')?.parentId).toBe('q');
    ctx.move('a', { parentId: null, position: 'start' });
    expect(rootIds(doc)).toEqual(['a', 'p', 'q']);
    expect(ctx.read('q')?.children).toEqual(['b']);
    expect(ctx.read('child')?.parentId).toBe('a');
  });

  it('promotes root children into the removed parent slot', () => {
    const doc = docOf([
      { id: 'before', type: 'paragraph', data: {} },
      { id: 'p', type: 'column', data: {} },
      { id: 'after', type: 'paragraph', data: {} },
      { id: 'a', type: 'toggle', data: {}, parentId: 'p' },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'nested', type: 'paragraph', data: {}, parentId: 'a' },
    ]);
    const ctx = createFakeCtx(doc, 'p');

    ctx.remove('p');

    expect(rootIds(doc)).toEqual(['before', 'a', 'b', 'after']);
    expect(ctx.read('a')?.parentId).toBeNull();
    expect(ctx.read('b')?.parentId).toBeNull();
    expect(ctx.read('nested')?.parentId).toBe('a');
    expect(ctx.read('p')).toBeNull();
    expect(ctx.block).toBeUndefined();
    expect(ctx.edits).toEqual([{ op: 'remove', id: 'p', withChildren: false }]);
  });

  it('promotes nested children into the removed parent slot', () => {
    const doc = docOf([
      { id: 'outer', type: 'column', data: {} },
      { id: 'before', type: 'paragraph', data: {}, parentId: 'outer' },
      { id: 'p', type: 'column', data: {}, parentId: 'outer' },
      { id: 'after', type: 'paragraph', data: {}, parentId: 'outer' },
      { id: 'a', type: 'toggle', data: {}, parentId: 'p' },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'nested', type: 'paragraph', data: {}, parentId: 'a' },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.remove('p', { withChildren: false });

    expect(ctx.read('outer')?.children).toEqual(['before', 'a', 'b', 'after']);
    expect(ctx.read('a')?.parentId).toBe('outer');
    expect(ctx.read('b')?.parentId).toBe('outer');
    expect(ctx.read('nested')?.parentId).toBe('a');
    expect(rootIds(doc)).toEqual(['outer']);
  });

  it('removes a subtree deepest first without removing unrelated siblings', () => {
    const doc = docOf([
      { id: 'outer', type: 'column', data: {} },
      { id: 'p', type: 'column', data: {}, parentId: 'outer' },
      { id: 'a', type: 'toggle', data: {}, parentId: 'p' },
      { id: 'nested', type: 'paragraph', data: {}, parentId: 'a' },
      { id: 'kept', type: 'paragraph', data: {}, parentId: 'outer' },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.remove('p', { withChildren: true });

    expect(ctx.read('nested')).toBeNull();
    expect(ctx.read('a')).toBeNull();
    expect(ctx.read('p')).toBeNull();
    expect(ctx.read('outer')?.children).toEqual(['kept']);
    expect(ctx.edits).toEqual([
      { op: 'remove', id: 'nested', withChildren: true },
      { op: 'remove', id: 'a', withChildren: true },
      { op: 'remove', id: 'p', withChildren: true },
    ]);
  });

  it('removes a root subtree and preserves other root order', () => {
    const doc = docOf([
      { id: 'before', type: 'paragraph', data: {} },
      { id: 'p', type: 'column', data: {} },
      { id: 'child', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'after', type: 'paragraph', data: {} },
    ]);
    const ctx = createFakeCtx(doc);

    ctx.remove('p', { withChildren: true });

    expect(rootIds(doc)).toEqual(['before', 'after']);
    expect(ctx.read('p')).toBeNull();
    expect(ctx.read('child')).toBeNull();
  });

  it('fails clearly when a test calls unsupported rich-text helpers', () => {
    const ctx = createFakeCtx(docOf([]));
    const calls = [
      () => ctx.richText.plainText([]),
      () => ctx.richText.length([]),
      () => ctx.richText.resolve([], 'all'),
      () => ctx.richText.slice([], 0, 0),
      () => ctx.richText.insert([], 0, []),
      () => ctx.richText.remove([], 0, 0),
      () => ctx.richText.format([], 0, 0),
      () => ctx.richText.canonicalize([]),
    ];

    for (const call of calls) {
      expect(call).toThrow('Fake context does not support rich-text helpers');
    }
  });

  it.each(['PRECONDITION_FAILED', 'INVALID_ARGS'] as const)('throws a typed %s failure with its message', code => {
    const ctx = createFakeCtx(docOf([]));

    expect(() => ctx.fail(code, 'nope')).toThrow(FakeFailure);
    try {
      ctx.fail(code, 'nope');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(FakeFailure);
      if (!(error instanceof FakeFailure)) {
        throw error;
      }
      expect(error.code).toBe(code);
      expect(error.message).toBe('nope');
    }
  });
});

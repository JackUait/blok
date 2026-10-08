// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFailure } from '../../../../src/shared/agent/errors';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

import type { SnapBlock } from '../../../../src/shared/agent/snapshot';
import type { OutputData } from '../../../../types/data-formats/output-data';
import type { PageIcon } from '../../../../types/tools/page';

const treeDocument = (): OutputData => ({
  blocks: [
    { id: 'branch', type: 'toggle', data: { text: [{ text: 'Branch' }] }, content: ['second', 'first'] },
    { id: 'first', type: 'paragraph', data: { text: [{ text: 'First' }] }, parent: 'branch' },
    { id: 'second', type: 'toggle', data: { text: [{ text: 'Second' }] }, parent: 'branch', content: ['deep'] },
    { id: 'deep', type: 'paragraph', data: { text: [{ text: 'Deep' }] }, parent: 'second' },
    {
      id: 'table', type: 'table',
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['cell1'] }, { blocks: ['cell2', 'cellExtra'] }],
          [{ blocks: [] }, { blocks: ['lower'] }],
        ],
      },
      content: ['cell1', 'cell2', 'cellExtra', 'lower'],
    },
    { id: 'cell1', type: 'paragraph', data: {}, parent: 'table' },
    { id: 'cell2', type: 'toggle', data: {}, parent: 'table', content: ['cellDeep'] },
    { id: 'cellDeep', type: 'toggle', data: {}, parent: 'cell2', content: ['leaf'] },
    { id: 'leaf', type: 'paragraph', data: {}, parent: 'cellDeep' },
    { id: 'cellExtra', type: 'paragraph', data: {}, parent: 'table' },
    { id: 'lower', type: 'paragraph', data: {}, parent: 'table' },
    { id: 'tail', type: 'paragraph', data: {} },
  ],
});

const isolationFixture = () => {
  const icon: PageIcon = { type: 'image', url: 'https://example.com/source.png' };
  const parent = {
    id: 'parent', type: 'toggle',
    data: { text: [{ text: 'Source' }], metadata: { labels: ['source'] } },
    tunes: { custom: { labels: ['source'] } },
    content: ['child'],
    lastEditedAt: 10,
    lastEditedBy: 'source-user',
    extension: { labels: ['source'] },
  };
  const child = { id: 'child', type: 'paragraph', data: { text: [{ text: 'Child' }] }, parent: 'parent' };
  const input = {
    id: 'document-id', version: 'saved-version', time: 0, title: 'Source', icon,
    extension: { labels: ['source'] },
    blocks: [parent, child],
  };

  return { input, parent, child, icon };
};

const requireBlock = (snapshot: DocSnapshot, id: string): SnapBlock => {
  const block = snapshot.get(id);

  if (block === undefined) {
    throw new Error(`Expected fixture block "${id}"`);
  }

  return block;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');

const mutateNestedLists = (
  data: Record<string, unknown>,
  tunes: Record<string, unknown> | undefined,
  rest: Record<string, unknown>
): void => {
  const metadata = data.metadata;
  const tune = tunes?.custom;
  const extension = rest.extension;

  if (!isRecord(metadata) || !isRecord(tune) || !isRecord(extension)) {
    throw new Error('Expected nested fixture records');
  }

  for (const labels of [metadata.labels, tune.labels, extension.labels]) {
    if (!isStringArray(labels)) {
      throw new Error('Expected nested fixture labels');
    }
    labels.push('changed');
  }
};

const snapshotFailure = (input: OutputData): AgentFailure => {
  try {
    DocSnapshot.fromOutput(input);
  } catch (error: unknown) {
    if (error instanceof AgentFailure) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected malformed document rejection');
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DocSnapshot saved data', () => {
  it('keeps page fields, document metadata and unknown saved keys', () => {
    const input = {
      id: 'doc', version: 'custom-version', time: 0, title: 'Plan',
      icon: { type: 'emoji', value: '\u{1f4c4}' } satisfies PageIcon,
      extension: { flags: [false, null, { enabled: true }] },
      blocks: [{
        id: 'p', type: 'custom',
        data: { text: [{ text: 'Literal <b>text</b>', marks: { bold: true } }], nested: { values: [0, false, null] } },
        tunes: { scalar: 0, empty: null, array: ['x', { enabled: true }], object: { value: 'center' } },
        indent: 2, lastEditedAt: 123, lastEditedBy: 'user-1',
        extension: { keep: ['unknown', { nested: true }] },
      }],
    };
    const snapshot = DocSnapshot.fromOutput(input);

    expect(snapshot.toOutput()).toEqual(input);
    expect(snapshot.get('p')?.rest).toEqual({
      indent: 2, lastEditedAt: 123, lastEditedBy: 'user-1',
      extension: { keep: ['unknown', { nested: true }] },
    });
    expect(snapshot.title).toBe('Plan');
    expect(snapshot.icon).toEqual({ type: 'emoji', value: '\u{1f4c4}' });
  });

  it.each<{ name: string; icon: PageIcon }>([
    { name: 'emoji', icon: { type: 'emoji', value: '\u{1f4c4}' } },
    { name: 'image', icon: { type: 'image', url: 'https://example.com/page.png' } },
  ])('round-trips a $name page icon without inventing a title', ({ icon }) => {
    const snapshot = DocSnapshot.fromOutput({ icon, blocks: [] });

    expect(snapshot.toOutput()).toEqual({ icon, blocks: [] });
    expect(snapshot.title).toBeUndefined();
  });

  it('does not invent page fields or a default block for an empty document', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [] });

    expect(snapshot.toOutput()).toEqual({ blocks: [] });
    expect(snapshot.ids()).toEqual([]);
    expect(snapshot.childrenOf(null)).toEqual([]);
    expect(snapshot.readingOrder(null)).toEqual([]);
  });

  it('normalizes an empty saved title to absence', () => {
    const snapshot = DocSnapshot.fromOutput({ title: '', blocks: [] });

    expect(snapshot.toOutput()).toEqual({ blocks: [] });
    expect(snapshot.title).toBeUndefined();
  });

  it('saves changed page fields and omits fields cleared with undefined', () => {
    const snapshot = DocSnapshot.fromOutput({ title: 'Before', icon: { type: 'emoji', value: 'x' }, blocks: [] });

    snapshot.title = 'After';
    snapshot.icon = { type: 'image', url: 'https://example.com/after.png' };

    expect(snapshot.toOutput()).toEqual({ title: 'After', icon: { type: 'image', url: 'https://example.com/after.png' }, blocks: [] });

    snapshot.title = undefined;
    snapshot.icon = undefined;

    expect(snapshot.toOutput()).toEqual({ blocks: [] });
  });

  it('orders output by membership and content instead of the source array', () => {
    const input: OutputData = { blocks: [
      { id: 'a', type: 'paragraph', data: {}, parent: 'parent' },
      { id: 'deep', type: 'paragraph', data: {}, parent: 'b' },
      { id: 'root-before', type: 'paragraph', data: {} },
      { id: 'parent', type: 'toggle', data: {}, content: ['b', 'a'] },
      { id: 'b', type: 'toggle', data: {}, parent: 'parent', content: ['deep'] },
      { id: 'root-after', type: 'paragraph', data: {} },
    ] };
    const snapshot = DocSnapshot.fromOutput(input);

    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual(['root-before', 'parent', 'b', 'deep', 'a', 'root-after']);
    expect(snapshot.childrenOf(null)).toEqual(['root-before', 'parent', 'root-after']);
    expect(snapshot.childrenOf('parent')).toEqual(['b', 'a']);
    expect(input.blocks.map(block => block.id)).toEqual(['a', 'deep', 'root-before', 'parent', 'b', 'root-after']);
  });

  it('appends unlisted children in input order without editing the loaded document', () => {
    const parent = { id: 'parent', type: 'toggle', data: {}, content: ['listed'] };
    const input: OutputData = { blocks: [
      { id: 'late', type: 'paragraph', data: {}, parent: 'parent' },
      parent,
      { id: 'listed', type: 'paragraph', data: {}, parent: 'parent' },
      { id: 'early', type: 'paragraph', data: {}, parent: 'parent' },
    ] };
    const snapshot = DocSnapshot.fromOutput(input);

    expect(snapshot.childrenOf('parent')).toEqual(['listed', 'late', 'early']);
    expect(snapshot.toOutput().blocks).toEqual([
      { id: 'parent', type: 'toggle', data: {}, content: ['listed', 'late', 'early'] },
      { id: 'listed', type: 'paragraph', data: {}, parent: 'parent' },
      { id: 'late', type: 'paragraph', data: {}, parent: 'parent' },
      { id: 'early', type: 'paragraph', data: {}, parent: 'parent' },
    ]);
    expect(parent.content).toEqual(['listed']);
  });

  it('takes membership from the child and uses the first listed occurrence for order', () => {
    const input: OutputData = { blocks: [
      { id: 'left', type: 'toggle', data: {}, content: ['b', 'a', 'b', 'missing', 'foreign', 'root'] },
      { id: 'a', type: 'paragraph', data: {}, parent: 'left' },
      { id: 'b', type: 'paragraph', data: {}, parent: 'left' },
      { id: 'right', type: 'toggle', data: {} },
      { id: 'foreign', type: 'paragraph', data: {}, parent: 'right' },
      { id: 'root', type: 'paragraph', data: {} },
    ] };
    const snapshot = DocSnapshot.fromOutput(input);

    expect(snapshot.childrenOf('left')).toEqual(['b', 'a']);
    expect(snapshot.childrenOf('right')).toEqual(['foreign']);
    expect(snapshot.childrenOf(null)).toEqual(['left', 'right', 'root']);
    expect(snapshot.parentOf('foreign')).toBe('right');
    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual(['left', 'b', 'a', 'right', 'foreign', 'root']);
  });

  it('promotes a dangling parent and a self-parent to roots without losing their descendants', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'orphan', type: 'toggle', data: {}, parent: 'missing', content: ['child'] },
      { id: 'child', type: 'paragraph', data: {}, parent: 'orphan' },
      { id: 'self', type: 'toggle', data: {}, parent: 'self', content: ['self', 'self-child'] },
      { id: 'self-child', type: 'paragraph', data: {}, parent: 'self' },
    ] });

    expect(snapshot.toOutput().blocks).toEqual([
      { id: 'orphan', type: 'toggle', data: {}, content: ['child'] },
      { id: 'child', type: 'paragraph', data: {}, parent: 'orphan' },
      { id: 'self', type: 'toggle', data: {}, content: ['self-child'] },
      { id: 'self-child', type: 'paragraph', data: {}, parent: 'self' },
    ]);
    expect(snapshot.childrenOf(null)).toEqual(['orphan', 'self']);
    expect(snapshot.parentOf('orphan')).toBeNull();
    expect(snapshot.parentOf('self')).toBeNull();
  });
});

describe('DocSnapshot isolation', () => {
  it('does not retain mutable input data, tunes, rest, order or page fields', () => {
    const { input, parent, child, icon } = isolationFixture();
    const snapshot = DocSnapshot.fromOutput(input);

    parent.data.metadata.labels.push('changed');
    parent.tunes.custom.labels.push('changed');
    parent.extension.labels.push('changed');
    parent.content.push('changed');
    parent.lastEditedBy = 'changed-user';
    child.data.text.push({ text: 'changed' });
    input.extension.labels.push('changed');
    input.blocks.reverse();
    input.title = 'Changed';
    icon.url = 'https://example.com/changed.png';

    expect(snapshot.toOutput()).toEqual(isolationFixture().input);
  });

  it('keeps the original input unchanged when the working copy is edited', () => {
    const { input } = isolationFixture();
    const snapshot = DocSnapshot.fromOutput(input);
    const parent = requireBlock(snapshot, 'parent');

    mutateNestedLists(parent.data, parent.tunes, parent.rest);
    parent.rest.lastEditedBy = 'changed-user';
    parent.content.push('changed');
    snapshot.title = 'Changed';
    const icon = snapshot.icon;

    if (icon === undefined || icon.type !== 'image') {
      throw new Error('Expected the fixture image icon');
    }
    icon.url = 'https://example.com/changed.png';

    expect(input).toEqual(isolationFixture().input);
  });

  it('returns output that can be mutated without editing the snapshot', () => {
    const { input } = isolationFixture();
    const snapshot = DocSnapshot.fromOutput(input);
    const output = snapshot.toOutput();
    const parent = output.blocks.find(block => block.id === 'parent');

    if (parent === undefined || !isRecord(parent) || parent.content === undefined || !isRecord(output)) {
      throw new Error('Expected saved fixture records');
    }
    mutateNestedLists(parent.data, parent.tunes, parent);
    parent.content.push('changed');
    parent.lastEditedBy = 'changed-user';
    output.blocks.reverse();
    output.title = 'Changed';
    const extension = output.extension;
    const icon = output.icon;

    if (!isRecord(extension) || !isStringArray(extension.labels) || icon === undefined || icon.type !== 'image') {
      throw new Error('Expected saved fixture page fields');
    }
    extension.labels.push('changed');
    icon.url = 'https://example.com/changed.png';

    expect(snapshot.toOutput()).toEqual(isolationFixture().input);
  });

  it('lets a clone edit nested values, placement and page fields without editing its source', () => {
    const { input } = isolationFixture();
    const source = DocSnapshot.fromOutput(input);
    const copy = source.clone();
    const parent = requireBlock(copy, 'parent');

    mutateNestedLists(parent.data, parent.tunes, parent.rest);
    parent.rest.lastEditedBy = 'clone-user';
    copy.unlink('child');
    copy.link('child', null, 'parent');
    copy.title = 'Clone';
    const icon = copy.icon;

    if (icon === undefined || icon.type !== 'image') {
      throw new Error('Expected the clone image icon');
    }
    icon.url = 'https://example.com/clone.png';

    expect(source.toOutput()).toEqual(isolationFixture().input);
    expect(copy.childrenOf(null)).toEqual(['parent', 'child']);
    expect(copy.childrenOf('parent')).toEqual([]);
    expect(copy.parentOf('child')).toBeNull();
  });

  it('keeps a clone unchanged when the source is later edited', () => {
    const { input } = isolationFixture();
    const source = DocSnapshot.fromOutput(input);
    const copy = source.clone();
    const parent = requireBlock(source, 'parent');

    mutateNestedLists(parent.data, parent.tunes, parent.rest);
    parent.content.push('changed');
    source.unlink('child');
    source.link('child', null, 'parent');
    source.title = 'Changed';
    source.icon = undefined;

    expect(copy.toOutput()).toEqual(isolationFixture().input);
  });
});

describe('DocSnapshot tree queries', () => {
  it('exposes every loaded identity and a mutable block for planner updates', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    expect(snapshot.ids().sort()).toEqual([
      'branch', 'cell1', 'cell2', 'cellDeep', 'cellExtra', 'deep', 'first', 'leaf', 'lower', 'second', 'table', 'tail',
    ]);
    expect(snapshot.has('first')).toBe(true);
    expect(snapshot.has('missing')).toBe(false);
    expect(snapshot.get('missing')).toBeUndefined();

    const first = requireBlock(snapshot, 'first');

    first.data.text = [{ text: 'Updated', marks: { bold: true } }];
    first.tunes = { alignment: 'center' };
    first.rest.lastEditedAt = 20;

    expect(snapshot.toOutput().blocks.find(block => block.id === 'first')).toEqual({
      id: 'first', type: 'paragraph', data: { text: [{ text: 'Updated', marks: { bold: true } }] },
      tunes: { alignment: 'center' }, parent: 'branch', lastEditedAt: 20,
    });
  });

  it('answers direct membership and proper ancestry without treating a block as its own ancestor', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    expect(snapshot.childrenOf(null)).toEqual(['branch', 'table', 'tail']);
    expect(snapshot.childrenOf('branch')).toEqual(['second', 'first']);
    expect(snapshot.childrenOf('first')).toEqual([]);
    expect(snapshot.childrenOf('missing')).toEqual([]);
    expect(snapshot.parentOf('deep')).toBe('second');
    expect(snapshot.parentOf('branch')).toBeNull();
    expect(snapshot.parentOf('missing')).toBeNull();
    expect(snapshot.isUnder('second', 'branch')).toBe(true);
    expect(snapshot.isUnder('deep', 'branch')).toBe(true);
    expect(snapshot.isUnder('branch', 'branch')).toBe(false);
    expect(snapshot.isUnder('first', 'second')).toBe(false);
    expect(snapshot.isUnder('branch', 'deep')).toBe(false);
    expect(snapshot.isUnder('missing', 'branch')).toBe(false);
    expect(snapshot.isUnder('deep', 'missing')).toBe(false);
  });

  it('returns a root-first subtree in content order', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    expect(snapshot.subtree('branch')).toEqual(['branch', 'second', 'deep', 'first']);
    expect(snapshot.subtree('first')).toEqual(['first']);
  });

  it('reads descendants of a named root with direct children at depth zero', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    expect(snapshot.readingOrder('table')).toEqual([
      { id: 'cell1', depth: 0 }, { id: 'cell2', depth: 0 },
      { id: 'cellDeep', depth: 1 }, { id: 'leaf', depth: 2 },
      { id: 'cellExtra', depth: 0 }, { id: 'lower', depth: 0 },
    ]);
    expect(snapshot.readingOrder('first')).toEqual([]);
  });

  it('reads the entire document with roots at depth zero', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    expect(snapshot.readingOrder(null)).toEqual([
      { id: 'branch', depth: 0 }, { id: 'second', depth: 1 }, { id: 'deep', depth: 2 }, { id: 'first', depth: 1 },
      { id: 'table', depth: 0 }, { id: 'cell1', depth: 1 }, { id: 'cell2', depth: 1 },
      { id: 'cellDeep', depth: 2 }, { id: 'leaf', depth: 3 }, { id: 'cellExtra', depth: 1 }, { id: 'lower', depth: 1 },
      { id: 'tail', depth: 0 },
    ]);
  });
});

describe('DocSnapshot table cells', () => {
  it('finds zero-based coordinates for direct cell blocks and their deep descendants', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    expect(snapshot.cellOf('leaf')).toEqual({ tableId: 'table', row: 0, col: 1 });
    expect(snapshot.cellOf('cell2')).toEqual({ tableId: 'table', row: 0, col: 1 });
    expect(snapshot.cellOf('cellExtra')).toEqual({ tableId: 'table', row: 0, col: 1 });
    expect(snapshot.cellOf('cell1')).toEqual({ tableId: 'table', row: 0, col: 0 });
    expect(snapshot.cellOf('lower')).toEqual({ tableId: 'table', row: 1, col: 1 });
    expect(snapshot.cellOf('first')).toBeNull();
    expect(snapshot.cellOf('deep')).toBeNull();
    expect(snapshot.cellOf('table')).toBeNull();
    expect(snapshot.cellOf('missing')).toBeNull();
  });

  it('uses the nearest cell owner for nested table descendants', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'outer', type: 'table', data: { content: [[{ blocks: ['inner'] }]] }, content: ['inner'] },
      { id: 'inner', type: 'table', data: { content: [[{ blocks: [] }, { blocks: ['p'] }]] }, parent: 'outer', content: ['p'] },
      { id: 'p', type: 'toggle', data: {}, parent: 'inner', content: ['deep'] },
      { id: 'deep', type: 'paragraph', data: {}, parent: 'p' },
    ] });

    expect(snapshot.cellOf('deep')).toEqual({ tableId: 'inner', row: 0, col: 1 });
    expect(snapshot.cellOf('inner')).toEqual({ tableId: 'outer', row: 0, col: 0 });
  });

  it('recognizes cell references when a table uses another registry key', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'table', type: 'grid', data: { content: [[{ blocks: ['p'] }]] }, content: ['p'] },
      { id: 'p', type: 'paragraph', data: {}, parent: 'table' },
    ] });

    expect(snapshot.cellOf('p')).toEqual({ tableId: 'table', row: 0, col: 0 });
  });

  it('requires hierarchy membership instead of trusting a stale cell reference', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['p'] }]] }, content: ['p'] },
      { id: 'other', type: 'toggle', data: {}, content: ['p'] },
      { id: 'p', type: 'paragraph', data: {}, parent: 'other' },
    ] });

    expect(snapshot.cellOf('p')).toBeNull();
    expect(snapshot.childrenOf('table')).toEqual([]);
    expect(snapshot.childrenOf('other')).toEqual(['p']);
  });

  it('ignores unusable grid entries without compacting row or column coordinates', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'table', type: 'table', data: { content: [null, ['legacy', null, { blocks: [7, 'p', false] }]] }, content: ['p'] },
      { id: 'p', type: 'paragraph', data: {}, parent: 'table' },
    ] });

    expect(snapshot.cellOf('p')).toEqual({ tableId: 'table', row: 1, col: 2 });
  });

  it.each<{ name: string; grid: unknown }>([
    { name: 'no grid', grid: null },
    { name: 'non-array grid', grid: 7 },
    { name: 'non-array row', grid: [null] },
    { name: 'non-object cells', grid: [[null, 7, 'legacy']] },
    { name: 'non-array block references', grid: [[{ blocks: 'p' }]] },
    { name: 'non-string block references', grid: [[{ blocks: [7, null] }]] },
  ])('returns no cell for $name', ({ grid }) => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'table', type: 'table', data: { content: grid }, content: ['p'] },
      { id: 'p', type: 'paragraph', data: {}, parent: 'table' },
    ] });

    expect(snapshot.cellOf('p')).toBeNull();
  });
});

describe('DocSnapshot working-copy mutations', () => {
  it('registers a new block with put and places it only when link is called', () => {
    const snapshot = DocSnapshot.fromOutput({ blocks: [{ id: 'existing', type: 'paragraph', data: {} }] });
    const block: SnapBlock = {
      id: 'new', type: 'paragraph', data: { text: [{ text: 'New' }] },
      tunes: { custom: false }, parent: null, content: [], rest: { lastEditedBy: 'agent' },
    };

    snapshot.put(block);

    expect(snapshot.has('new')).toBe(true);
    expect(snapshot.ids().sort()).toEqual(['existing', 'new']);
    expect(snapshot.childrenOf(null)).toEqual(['existing']);

    snapshot.link('new', null, 'existing');

    expect(snapshot.toOutput().blocks).toEqual([
      { id: 'existing', type: 'paragraph', data: {} },
      { id: 'new', type: 'paragraph', data: { text: [{ text: 'New' }] }, tunes: { custom: false }, lastEditedBy: 'agent' },
    ]);
  });

  it('replaces a registered block value without duplicating its placement', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());
    const first = requireBlock(snapshot, 'first');

    snapshot.put({ ...first, type: 'header', data: { text: [{ text: 'Heading' }], level: 2 } });

    expect(snapshot.toOutput().blocks.find(block => block.id === 'first')).toEqual({
      id: 'first', type: 'header', data: { text: [{ text: 'Heading' }], level: 2 }, parent: 'branch',
    });
    expect(snapshot.childrenOf('branch')).toEqual(['second', 'first']);
    expect(snapshot.ids().filter(id => id === 'first')).toHaveLength(1);
  });

  it.each([
    { name: 'first root', parent: null, after: null, want: ['new', 'branch', 'table', 'tail'] },
    { name: 'middle root', parent: null, after: 'branch', want: ['branch', 'new', 'table', 'tail'] },
    { name: 'last root', parent: null, after: 'tail', want: ['branch', 'table', 'tail', 'new'] },
    { name: 'first child', parent: 'branch', after: null, want: ['new', 'second', 'first'] },
    { name: 'middle child', parent: 'branch', after: 'second', want: ['second', 'new', 'first'] },
    { name: 'last child', parent: 'branch', after: 'first', want: ['second', 'first', 'new'] },
  ])('links a detached block as the $name', ({ parent, after, want }) => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    snapshot.put({ id: 'new', type: 'paragraph', data: {}, parent: null, content: [], rest: {} });
    snapshot.link('new', parent, after);

    expect(snapshot.childrenOf(parent)).toEqual(want);
    expect(snapshot.parentOf('new')).toBe(parent);
    expect(snapshot.toOutput().blocks.filter(block => block.id === 'new')).toHaveLength(1);
  });

  it('unlinks a child without deleting it or automatically adding it to root order', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    snapshot.unlink('second');

    expect(snapshot.childrenOf('branch')).toEqual(['first']);
    expect(snapshot.childrenOf(null)).toEqual(['branch', 'table', 'tail']);
    expect(snapshot.has('second')).toBe(true);
    expect(snapshot.parentOf('second')).toBeNull();
    expect(snapshot.subtree('second')).toEqual(['second', 'deep']);
    expect(snapshot.parentOf('deep')).toBe('second');
  });

  it('moves a subtree from child order to root order while preserving descendant membership', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    snapshot.unlink('second');
    snapshot.link('second', null, 'branch');

    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual([
      'branch', 'first', 'second', 'deep', 'table', 'cell1', 'cell2', 'cellDeep', 'leaf', 'cellExtra', 'lower', 'tail',
    ]);
    expect(snapshot.childrenOf('branch')).toEqual(['first']);
    expect(snapshot.childrenOf(null)).toEqual(['branch', 'second', 'table', 'tail']);
    expect(snapshot.parentOf('second')).toBeNull();
    expect(snapshot.parentOf('deep')).toBe('second');
    expect(snapshot.isUnder('deep', 'branch')).toBe(false);
    expect(snapshot.isUnder('deep', 'second')).toBe(true);
  });

  it('unlinks a root before placing it among another block\'s children', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    snapshot.unlink('tail');
    snapshot.link('tail', 'branch', 'second');

    expect(snapshot.childrenOf(null)).toEqual(['branch', 'table']);
    expect(snapshot.childrenOf('branch')).toEqual(['second', 'tail', 'first']);
    expect(snapshot.parentOf('tail')).toBe('branch');
    expect(snapshot.toOutput().blocks.filter(block => block.id === 'tail')).toHaveLength(1);
  });

  it('drops a leaf from both the identity set and its parent order', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    snapshot.drop('first');

    expect(snapshot.has('first')).toBe(false);
    expect(snapshot.get('first')).toBeUndefined();
    expect(snapshot.ids()).not.toContain('first');
    expect(snapshot.childrenOf('branch')).toEqual(['second']);
    expect(snapshot.toOutput().blocks.some(block => block.id === 'first')).toBe(false);
  });

  it('drops a root from both the identity set and root order', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    snapshot.drop('tail');

    expect(snapshot.childrenOf(null)).toEqual(['branch', 'table']);
    expect(snapshot.has('tail')).toBe(false);
    expect(snapshot.toOutput().blocks.some(block => block.id === 'tail')).toBe(false);
  });

  it('supports bottom-up subtree deletion with drop', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    for (const id of snapshot.subtree('branch').reverse()) {
      snapshot.drop(id);
    }

    expect(snapshot.ids().sort()).toEqual(['cell1', 'cell2', 'cellDeep', 'cellExtra', 'leaf', 'lower', 'table', 'tail']);
    expect(snapshot.childrenOf(null)).toEqual(['table', 'tail']);
  });

  it('supports lifting children into the deleted parent\'s slot before dropping it', () => {
    const snapshot = DocSnapshot.fromOutput(treeDocument());

    snapshot.unlink('second');
    snapshot.link('second', null, null);
    snapshot.unlink('first');
    snapshot.link('first', null, 'second');
    snapshot.drop('branch');

    expect(snapshot.childrenOf(null)).toEqual(['second', 'first', 'table', 'tail']);
    expect(snapshot.subtree('second')).toEqual(['second', 'deep']);
    expect(snapshot.parentOf('first')).toBeNull();
    expect(snapshot.has('branch')).toBe(false);
  });
});

describe('DocSnapshot malformed identity and hierarchy', () => {
  it.each<{ name: string; input: OutputData; path: string }>([
    {
      name: 'missing IDs', path: '/blocks/0/id',
      input: { blocks: [{ type: 'paragraph', data: { text: [{ text: 'First' }] } }, { type: 'paragraph', data: { text: [{ text: 'Second' }] } }] },
    },
    {
      name: 'an empty ID', path: '/blocks/0/id',
      input: { blocks: [{ id: '', type: 'paragraph', data: {} }] },
    },
    {
      name: 'duplicate IDs', path: '/blocks/1/id',
      input: { blocks: [{ id: 'same', type: 'toggle', data: { text: [{ text: 'First' }] } }, { id: 'same', type: 'paragraph', data: { text: [{ text: 'Second' }] } }] },
    },
  ])('rejects $name instead of merging or inventing identities', ({ input, path }) => {
    const error = snapshotFailure(input);

    expect(error.error).toMatchObject({ code: 'INVALID_ARGS', path, retryable: false });
    expect(error.error.message.length).toBeGreaterThan(0);
    expect(error.error).not.toHaveProperty('commandIndex');
  });

  it.each<{ name: string; input: OutputData; paths: string[] }>([
    {
      name: 'two-block cycle', paths: ['/blocks/0/parent', '/blocks/1/parent'],
      input: { blocks: [
        { id: 'a', type: 'toggle', data: {}, parent: 'b', content: ['b'] },
        { id: 'b', type: 'toggle', data: {}, parent: 'a', content: ['a'] },
      ] },
    },
    {
      name: 'three-block cycle with an unrelated root', paths: ['/blocks/0/parent', '/blocks/1/parent', '/blocks/2/parent'],
      input: { blocks: [
        { id: 'a', type: 'toggle', data: {}, parent: 'b', content: ['c'] },
        { id: 'b', type: 'toggle', data: {}, parent: 'c', content: ['a'] },
        { id: 'c', type: 'toggle', data: {}, parent: 'a', content: ['b'] },
        { id: 'root', type: 'paragraph', data: {} },
      ] },
    },
  ])('rejects a $name before a root walk can hide its blocks', ({ input, paths }) => {
    const error = snapshotFailure(input);

    expect(error.error).toMatchObject({ code: 'INVALID_ARGS', retryable: false });
    expect(paths).toContain(error.error.path);
    expect(error.error.message).toMatch(/cycle/i);
    expect(error.error).not.toHaveProperty('commandIndex');
  });
});

describe('DocSnapshot unknown page icon keys', () => {
  type ExtendedIcon = PageIcon & {
    extension: { labels: string[]; nested: { labels: string[] } };
  };

  const iconCases: Array<{ name: string; create: () => ExtendedIcon }> = [
    {
      name: 'emoji',
      create: () => ({
        type: 'emoji', value: 'x',
        extension: { labels: ['source'], nested: { labels: ['nested'] } },
      }),
    },
    {
      name: 'image',
      create: () => ({
        type: 'image', url: 'https://example.com/icon.png',
        extension: { labels: ['source'], nested: { labels: ['nested'] } },
      }),
    },
  ];

  const mutateExtension = (icon: unknown): void => {
    if (!isRecord(icon) || !isRecord(icon.extension)) {
      throw new Error('Expected an extended fixture icon');
    }
    const extension = icon.extension;
    const nested = extension.nested;

    if (!isStringArray(extension.labels) || !isRecord(nested) || !isStringArray(nested.labels)) {
      throw new Error('Expected nested icon labels');
    }
    extension.labels.push('changed');
    nested.labels.push('changed');
  };

  it.each(iconCases)('isolates loaded $name icon extensions from input edits', ({ create }) => {
    const icon = create();
    const snapshot = DocSnapshot.fromOutput({ icon, blocks: [] });

    icon.extension.labels.push('changed');
    icon.extension.nested.labels.push('changed');

    expect(snapshot.toOutput()).toEqual({ icon: create(), blocks: [] });
  });

  it.each(iconCases)('isolates $name icon extensions from saved output edits', ({ create }) => {
    const snapshot = DocSnapshot.fromOutput({ icon: create(), blocks: [] });
    const output = snapshot.toOutput();

    mutateExtension(output.icon);

    expect(snapshot.toOutput()).toEqual({ icon: create(), blocks: [] });
  });

  it.each(iconCases)('keeps source $name icon extensions unchanged when its clone is edited', ({ create }) => {
    const source = DocSnapshot.fromOutput({ icon: create(), blocks: [] });
    const clone = source.clone();

    mutateExtension(clone.icon);

    expect(source.toOutput()).toEqual({ icon: create(), blocks: [] });
  });

  it.each(iconCases)('keeps cloned $name icon extensions unchanged when its source is edited', ({ create }) => {
    const source = DocSnapshot.fromOutput({ icon: create(), blocks: [] });
    const clone = source.clone();

    mutateExtension(source.icon);

    expect(clone.toOutput()).toEqual({ icon: create(), blocks: [] });
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyEdits } from '../../../../src/shared/agent/json-applier';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

import type { EditStamp } from '../../../../src/shared/agent/json-applier';
import type { SnapBlock } from '../../../../src/shared/agent/snapshot';
import type { Edit, PlannedBlock } from '../../../../types/agent';
import type { RichText } from '../../../../types/rich-text';
import type { PageIcon } from '../../../../types/tools/page';

const base = (): DocSnapshot => DocSnapshot.fromOutput({ blocks: [
  { id: 't', type: 'toggle', data: { text: [{ text: 'T' }] }, content: ['a', 'b'] },
  { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }], keep: 1 }, parent: 't' },
  { id: 'b', type: 'paragraph', data: {}, parent: 't' },
  { id: 'z', type: 'paragraph', data: {} },
] });

const attributedBase = (): DocSnapshot => {
  const doc = base().toOutput();

  return DocSnapshot.fromOutput({
    ...doc,
    id: 'document-1', version: 'saved-version', time: 0,
    blocks: doc.blocks.map(block => ({
      ...block,
      indent: 2,
      lastEditedBy: 'human-1',
      lastEditedAt: 7,
      extension: { labels: ['kept'] },
    })),
  });
};

const nested = (): DocSnapshot => DocSnapshot.fromOutput({ blocks: [
  { id: 'p', type: 'toggle', data: {}, content: ['before', 'branch', 'after'] },
  { id: 'before', type: 'paragraph', data: {}, parent: 'p' },
  { id: 'branch', type: 'toggle', data: {}, parent: 'p', content: ['b', 'a'] },
  { id: 'a', type: 'paragraph', data: {}, parent: 'branch' },
  { id: 'b', type: 'toggle', data: {}, parent: 'branch', content: ['deep'] },
  { id: 'deep', type: 'paragraph', data: {}, parent: 'b' },
  { id: 'after', type: 'paragraph', data: {}, parent: 'p' },
  { id: 'tail', type: 'paragraph', data: {} },
] });

const requireBlock = (snap: DocSnapshot, id: string): SnapBlock => {
  const block = snap.get(id);

  if (block === undefined) {
    throw new Error(`Expected fixture block "${id}"`);
  }

  return block;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');

const labelsOf = (value: unknown): string[] => {
  if (!isRecord(value) || !isStringArray(value.labels)) {
    throw new Error('Expected fixture labels');
  }

  return value.labels;
};

const stamp: EditStamp = { actorId: 'agent-1', at: 42 };
const contentEdits: Array<{ name: string; edit: Edit; expected: Pick<SnapBlock, 'type' | 'data' | 'tunes'> }> = [
  {
    name: 'setData', edit: { op: 'setData', id: 'a', patch: { extra: 'x' } },
    expected: { type: 'paragraph', data: { text: [{ text: 'A' }], keep: 1, extra: 'x' } },
  },
  {
    name: 'setRichText', edit: { op: 'setRichText', id: 'a', field: 'text', value: [{ text: 'B' }] },
    expected: { type: 'paragraph', data: { text: [{ text: 'B' }], keep: 1 } },
  },
  {
    name: 'setTunes', edit: { op: 'setTunes', id: 'a', tunes: { align: { value: 'center' } } },
    expected: { type: 'paragraph', data: { text: [{ text: 'A' }], keep: 1 }, tunes: { align: { value: 'center' } } },
  },
  {
    name: 'replaceType', edit: { op: 'replaceType', id: 'a', type: 'callout', data: { title: [{ text: 'B' }] } },
    expected: { type: 'callout', data: { title: [{ text: 'B' }] } },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyEdits supplied scenarios', () => {
  it('inserts a tree after a sibling and stamps every new block', () => {
    const snap = base();

    applyEdits(snap, [{
      op: 'insert', parentId: null, afterId: 't',
      block: { id: 'n', type: 'toggle', data: {}, children: [{ id: 'n1', type: 'paragraph', data: {}, children: [] }] },
    }], stamp);

    expect(snap.childrenOf(null)).toEqual(['t', 'n', 'z']);
    expect(snap.childrenOf('n')).toEqual(['n1']);
    expect(requireBlock(snap, 'n').rest).toEqual({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    expect(requireBlock(snap, 'n1').rest).toEqual({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    expect(requireBlock(snap, 'n1').parent).toBe('n');
    for (const id of ['t', 'a', 'b', 'z']) {
      expect(requireBlock(snap, id).rest).toEqual({});
    }
  });

  it('removes with children, or lifts them into the slot', () => {
    const gone = base();
    const lifted = base();

    applyEdits(gone, [{ op: 'remove', id: 't', withChildren: true }], stamp);
    applyEdits(lifted, [{ op: 'remove', id: 't', withChildren: false }], stamp);

    expect(gone.ids().sort()).toEqual(['z']);
    expect(lifted.childrenOf(null)).toEqual(['a', 'b', 'z']);
    expect(requireBlock(lifted, 'a').parent).toBeNull();
    expect(requireBlock(lifted, 'b').parent).toBeNull();
    expect(lifted.has('t')).toBe(false);
  });

  it('moves into a sibling slot and stamps only the moved block', () => {
    const snap = base();

    applyEdits(snap, [{ op: 'move', id: 'z', parentId: 't', afterId: 'a' }], stamp);

    expect(requireBlock(snap, 'z').rest).toEqual({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    expect(snap.childrenOf('t')).toEqual(['a', 'z', 'b']);
    expect(requireBlock(snap, 'z').parent).toBe('t');
    expect(snap.childrenOf(null)).toEqual(['t']);
    for (const id of ['t', 'a', 'b']) {
      expect(requireBlock(snap, id).rest).toEqual({});
    }
  });

  it('merges data, deletes a null key, and sets one rich field', () => {
    const snap = base();

    applyEdits(snap, [
      { op: 'setData', id: 'a', patch: { keep: null, extra: 'x' } },
      { op: 'setRichText', id: 'a', field: 'text', value: [{ text: 'B', marks: { bold: true } }] },
    ], stamp);

    expect(requireBlock(snap, 'a').data).toEqual({ text: [{ text: 'B', marks: { bold: true } }], extra: 'x' });
  });

  it('retypes in place and keeps children and tunes', () => {
    const snap = base();

    applyEdits(snap, [
      { op: 'setTunes', id: 't', tunes: { align: { value: 'center' } } },
      { op: 'replaceType', id: 't', type: 'callout', data: { title: [{ text: 'T' }] } },
    ], stamp);

    expect(requireBlock(snap, 't')).toMatchObject({
      id: 't', type: 'callout', data: { title: [{ text: 'T' }] }, tunes: { align: { value: 'center' } },
    });
    expect(snap.childrenOf('t')).toEqual(['a', 'b']);
    expect(snap.childrenOf(null)).toEqual(['t', 'z']);
    expect(requireBlock(snap, 't').parent).toBeNull();
    expect(requireBlock(snap, 'a').parent).toBe('t');
  });

  it('writes and clears the page fields on the saved document', () => {
    const snap = base();

    applyEdits(snap, [
      { op: 'setPageField', key: 'title', value: 'Plan' },
      { op: 'setPageField', key: 'icon', value: { type: 'emoji', value: '\u{1f680}' } },
    ], stamp);

    expect(snap.toOutput()).toMatchObject({ title: 'Plan', icon: { type: 'emoji', value: '\u{1f680}' } });

    applyEdits(snap, [
      { op: 'setPageField', key: 'title', value: '' },
      { op: 'setPageField', key: 'icon', value: null },
    ], stamp);

    expect(snap.toOutput()).not.toHaveProperty('title');
    expect(snap.toOutput()).not.toHaveProperty('icon');
  });
});

describe('applyEdits attribution', () => {
  it.each(contentEdits)('stamps only the block changed by $name and preserves its other metadata', ({ edit, expected }) => {
    const snap = attributedBase();
    const before = snap.toOutput();

    applyEdits(snap, [edit], stamp);

    expect(requireBlock(snap, 'a').rest).toEqual({
      indent: 2, lastEditedBy: 'agent-1', lastEditedAt: 42, extension: { labels: ['kept'] },
    });
    expect(requireBlock(snap, 'a')).toMatchObject(expected);
    expect(snap.toOutput().blocks.filter(block => block.id !== 'a'))
      .toEqual(before.blocks.filter(block => block.id !== 'a'));
    expect(requireBlock(snap, 'a').parent).toBe('t');
    expect(snap.childrenOf('t')).toEqual(['a', 'b']);
  });

  it.each(contentEdits)('preserves existing attribution when $name has no stamp', ({ edit, expected }) => {
    const snap = attributedBase();

    applyEdits(snap, [edit], null);

    expect(requireBlock(snap, 'a').rest).toEqual({
      indent: 2, lastEditedBy: 'human-1', lastEditedAt: 7, extension: { labels: ['kept'] },
    });
    expect(requireBlock(snap, 'a')).toMatchObject(expected);
  });

  it('leaves new blocks unattributed when the stamp is null', () => {
    const snap = attributedBase();
    const before = snap.toOutput();

    applyEdits(snap, [{
      op: 'insert', parentId: 't', afterId: 'a',
      block: { id: 'n', type: 'toggle', data: {}, children: [{ id: 'n1', type: 'paragraph', data: {}, children: [] }] },
    }], null);

    expect(requireBlock(snap, 'n').rest).toEqual({});
    expect(requireBlock(snap, 'n1').rest).toEqual({});
    expect(snap.childrenOf('t')).toEqual(['a', 'n', 'b']);
    expect(snap.childrenOf('n')).toEqual(['n1']);
    for (const id of ['t', 'a', 'b', 'z']) {
      expect(requireBlock(snap, id).rest).toEqual({
        indent: 2, lastEditedBy: 'human-1', lastEditedAt: 7, extension: { labels: ['kept'] },
      });
    }
    expect(snap.toOutput().blocks.filter(block => block.id !== 'n' && block.id !== 'n1' && block.id !== 't'))
      .toEqual(before.blocks.filter(block => block.id !== 't'));
  });

  it.each([true, false])('stamps only surviving moved IDs for removal withChildren %s', withChildren => {
    const snap = attributedBase();

    applyEdits(snap, [{ op: 'remove', id: 't', withChildren }], stamp);

    for (const id of snap.ids()) {
      const lifted = !withChildren && (id === 'a' || id === 'b');

      expect(requireBlock(snap, id).rest).toEqual({
        indent: 2,
        lastEditedBy: lifted ? 'agent-1' : 'human-1',
        lastEditedAt: lifted ? 42 : 7,
        extension: { labels: ['kept'] },
      });
    }
    expect(snap.childrenOf(null)).toEqual(withChildren ? ['z'] : ['a', 'b', 'z']);
  });

  it('stamps a moved subtree root but not its descendants or either parent', () => {
    const doc = nested().toOutput();
    const snap = DocSnapshot.fromOutput({
      ...doc,
      blocks: [
        ...doc.blocks.map(block => ({ ...block, lastEditedBy: 'human-1', lastEditedAt: 7 })),
        { id: 'target', type: 'toggle', data: {}, lastEditedBy: 'human-2', lastEditedAt: 9 },
      ],
    });

    applyEdits(snap, [{ op: 'move', id: 'branch', parentId: 'target', afterId: null }], stamp);

    expect(requireBlock(snap, 'branch').rest).toEqual({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    for (const id of ['p', 'before', 'a', 'b', 'deep', 'after', 'tail']) {
      expect(requireBlock(snap, id).rest).toEqual({ lastEditedBy: 'human-1', lastEditedAt: 7 });
    }
    expect(requireBlock(snap, 'target').rest).toEqual({ lastEditedBy: 'human-2', lastEditedAt: 9 });
    expect(snap.childrenOf(null)).toEqual(['p', 'tail', 'target']);
    expect(snap.childrenOf('p')).toEqual(['before', 'after']);
    expect(snap.childrenOf('target')).toEqual(['branch']);
    expect(snap.childrenOf('branch')).toEqual(['b', 'a']);
    expect(requireBlock(snap, 'branch').parent).toBe('target');
    expect(requireBlock(snap, 'b').parent).toBe('branch');
    expect(requireBlock(snap, 'deep').parent).toBe('b');
  });

  it.each<{ name: string; edit: Edit; roots: string[]; children: string[] }>([
    {
      name: 'move',
      edit: { op: 'move', id: 'z', parentId: 't', afterId: 'a' },
      roots: ['t'], children: ['a', 'z', 'b'],
    },
    {
      name: 'lift',
      edit: { op: 'remove', id: 't', withChildren: false },
      roots: ['a', 'b', 'z'], children: [],
    },
  ])('changes placement without changing attribution for a null-stamped $name', ({ edit, roots, children }) => {
    const snap = attributedBase();

    applyEdits(snap, [edit], null);

    for (const id of snap.ids()) {
      expect(requireBlock(snap, id).rest).toEqual({
        indent: 2, lastEditedBy: 'human-1', lastEditedAt: 7, extension: { labels: ['kept'] },
      });
    }
    expect(snap.childrenOf(null)).toEqual(roots);
    expect(snap.childrenOf('t')).toEqual(children);
  });

  it('stamps an emitted same-slot move without changing block order', () => {
    const snap = attributedBase();
    const before = snap.toOutput();

    applyEdits(snap, [{ op: 'move', id: 'z', parentId: null, afterId: 't' }], stamp);

    expect(requireBlock(snap, 'z').rest).toMatchObject({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    expect(snap.toOutput()).toEqual({
      ...before,
      blocks: before.blocks.map(block => block.id === 'z' ? { ...block, lastEditedBy: 'agent-1', lastEditedAt: 42 } : block),
    });
  });

  it('uses a zero timestamp for created and changed blocks', () => {
    const snap = attributedBase();

    applyEdits(snap, [
      { op: 'insert', parentId: null, afterId: 'z', block: { id: 'n', type: 'paragraph', data: {}, children: [] } },
      { op: 'setData', id: 'a', patch: { extra: 'x' } },
    ], { actorId: 'agent-zero', at: 0 });

    expect(requireBlock(snap, 'n').rest).toEqual({ lastEditedBy: 'agent-zero', lastEditedAt: 0 });
    expect(requireBlock(snap, 'a').rest).toMatchObject({ lastEditedBy: 'agent-zero', lastEditedAt: 0 });
  });

  it('changes page fields without stamping blocks or replacing document metadata', () => {
    const snap = attributedBase();
    const before = snap.toOutput();

    applyEdits(snap, [
      { op: 'setPageField', key: 'title', value: 'Plan' },
      { op: 'setPageField', key: 'icon', value: { type: 'image', url: 'https://example.com/icon.png' } },
    ], stamp);

    expect(snap.toOutput().blocks).toEqual(before.blocks);
    expect(snap.toOutput()).toMatchObject({ id: 'document-1', version: 'saved-version', time: 0, title: 'Plan' });
    expect(snap.toOutput()).not.toHaveProperty('page');
  });

  it('leaves an empty edit list unchanged', () => {
    const snap = attributedBase();
    const before = snap.toOutput();

    applyEdits(snap, [], stamp);

    expect(snap.toOutput()).toEqual(before);
  });

  it.each<{ name: string; patch: Record<string, unknown> }>([
    { name: 'empty', patch: {} },
    { name: 'value-equal', patch: { keep: 1 } },
  ])('stamps an emitted $name setData edit', ({ patch }) => {
    const snap = attributedBase();
    const before = snap.toOutput();

    applyEdits(snap, [{ op: 'setData', id: 'a', patch }], stamp);

    expect(requireBlock(snap, 'a').rest).toMatchObject({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    expect(snap.toOutput()).toEqual({
      ...before,
      blocks: before.blocks.map(block => block.id === 'a' ? { ...block, lastEditedBy: 'agent-1', lastEditedAt: 42 } : block),
    });
  });

  it('stamps an emitted value-equal setRichText edit', () => {
    const snap = attributedBase();
    const before = snap.toOutput();

    applyEdits(snap, [{ op: 'setRichText', id: 'a', field: 'text', value: [{ text: 'A' }] }], stamp);

    expect(requireBlock(snap, 'a').rest).toMatchObject({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    expect(snap.toOutput()).toEqual({
      ...before,
      blocks: before.blocks.map(block => block.id === 'a' ? { ...block, lastEditedBy: 'agent-1', lastEditedAt: 42 } : block),
    });
  });

  it.each<{ name: string; tunes: Record<string, unknown> }>([
    { name: 'empty', tunes: {} },
    { name: 'value-equal', tunes: { align: { value: 'left' } } },
  ])('stamps an emitted $name setTunes edit', ({ tunes }) => {
    const doc = attributedBase().toOutput();
    const snap = DocSnapshot.fromOutput({
      ...doc,
      blocks: doc.blocks.map(block => block.id === 'a' ? { ...block, tunes: { align: { value: 'left' } } } : block),
    });
    const before = snap.toOutput();

    applyEdits(snap, [{ op: 'setTunes', id: 'a', tunes }], stamp);

    expect(requireBlock(snap, 'a').rest).toMatchObject({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    expect(snap.toOutput()).toEqual({
      ...before,
      blocks: before.blocks.map(block => block.id === 'a' ? { ...block, lastEditedBy: 'agent-1', lastEditedAt: 42 } : block),
    });
  });

  it('stamps an emitted replaceType edit with the same type and data', () => {
    const snap = attributedBase();
    const before = snap.toOutput();

    applyEdits(snap, [{ op: 'replaceType', id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }], keep: 1 } }], stamp);

    expect(requireBlock(snap, 'a').rest).toMatchObject({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    expect(snap.toOutput()).toEqual({
      ...before,
      blocks: before.blocks.map(block => block.id === 'a' ? { ...block, lastEditedBy: 'agent-1', lastEditedAt: 42 } : block),
    });
  });
});

describe('applyEdits ordering and patch semantics', () => {
  it('prepends roots and children while retaining every planned descendant in reading order', () => {
    const snap = base();
    const block: PlannedBlock = {
      id: 'head', type: 'toggle', data: {},
      children: [
        { id: 'h1', type: 'paragraph', data: {}, children: [] },
        { id: 'h2', type: 'toggle', data: {}, children: [{ id: 'deep', type: 'paragraph', data: {}, children: [] }] },
      ],
    };

    applyEdits(snap, [
      { op: 'insert', parentId: null, afterId: null, block },
      { op: 'insert', parentId: 't', afterId: null, block: { id: 'first', type: 'paragraph', data: {}, children: [] } },
    ], stamp);

    expect(snap.toOutput().blocks.map(saved => saved.id)).toEqual(['head', 'h1', 'h2', 'deep', 't', 'first', 'a', 'b', 'z']);
    expect(snap.childrenOf(null)).toEqual(['head', 't', 'z']);
    expect(snap.childrenOf('head')).toEqual(['h1', 'h2']);
    expect(snap.childrenOf('h2')).toEqual(['deep']);
    expect(snap.childrenOf('t')).toEqual(['first', 'a', 'b']);
    for (const id of ['head', 'h1', 'h2', 'deep', 'first']) {
      expect(requireBlock(snap, id).rest).toEqual({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    }
  });

  it('reorders within one parent and then moves to the root without duplicating slots', () => {
    const snap = base();

    applyEdits(snap, [{ op: 'move', id: 'b', parentId: 't', afterId: null }], stamp);

    expect(snap.childrenOf('t')).toEqual(['b', 'a']);

    applyEdits(snap, [{ op: 'move', id: 'b', parentId: null, afterId: 't' }], stamp);

    expect(snap.childrenOf(null)).toEqual(['t', 'b', 'z']);
    expect(snap.childrenOf('t')).toEqual(['a']);
    expect(requireBlock(snap, 'b').parent).toBeNull();
    expect(snap.toOutput().blocks.map(block => block.id)).toEqual(['t', 'a', 'b', 'z']);
  });

  it('lifts direct children into a middle nested slot in content order and retains their subtrees', () => {
    const snap = nested();

    applyEdits(snap, [{ op: 'remove', id: 'branch', withChildren: false }], stamp);

    expect(snap.childrenOf('p')).toEqual(['before', 'b', 'a', 'after']);
    expect(snap.childrenOf(null)).toEqual(['p', 'tail']);
    expect(requireBlock(snap, 'b').parent).toBe('p');
    expect(requireBlock(snap, 'a').parent).toBe('p');
    expect(requireBlock(snap, 'deep').parent).toBe('b');
    expect(snap.childrenOf('b')).toEqual(['deep']);
    for (const id of ['a', 'b']) {
      expect(requireBlock(snap, id).rest).toEqual({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
    }
    for (const id of ['p', 'before', 'deep', 'after', 'tail']) {
      expect(requireBlock(snap, id).rest).toEqual({});
    }
    expect(snap.has('branch')).toBe(false);
    expect(snap.toOutput().blocks.map(block => block.id)).toEqual(['p', 'before', 'b', 'deep', 'a', 'after', 'tail']);
  });

  it('removes a nested subtree including grandchildren without deleting siblings', () => {
    const snap = nested();

    applyEdits(snap, [{ op: 'remove', id: 'branch', withChildren: true }], stamp);

    expect(snap.ids().sort()).toEqual(['after', 'before', 'p', 'tail']);
    expect(snap.childrenOf('p')).toEqual(['before', 'after']);
    expect(snap.childrenOf(null)).toEqual(['p', 'tail']);
  });

  it('shallow-merges data, deletes only top-level null keys, and retains JSON values', () => {
    const snap = DocSnapshot.fromOutput({ blocks: [{
      id: 'a', type: 'paragraph', data: {
        text: [{ text: 'A' }], keep: 1, settings: { old: true, label: 'before' },
      },
    }] });

    applyEdits(snap, [{ op: 'setData', id: 'a', patch: {
      keep: null, missing: null, settings: { label: 'after', nestedNull: null },
      zero: 0, disabled: false, blank: '', values: [null, false, 0, { key: 'value' }],
    } }], stamp);

    expect(requireBlock(snap, 'a').data).toEqual({
      text: [{ text: 'A' }], settings: { label: 'after', nestedNull: null },
      zero: 0, disabled: false, blank: '', values: [null, false, 0, { key: 'value' }],
    });
  });

  it('merges tune names, replaces a nested value, and deletes a null tune', () => {
    const snap = DocSnapshot.fromOutput({ blocks: [{
      id: 'a', type: 'paragraph', data: {},
      tunes: { align: { value: 'left', old: true }, remove: { active: true }, keep: { enabled: false } },
    }] });

    applyEdits(snap, [{ op: 'setTunes', id: 'a', tunes: {
      align: { value: 'center', nestedNull: null }, remove: null, zero: 0,
    } }], stamp);

    expect(requireBlock(snap, 'a').tunes).toEqual({
      align: { value: 'center', nestedNull: null }, keep: { enabled: false }, zero: 0,
    });
    expect(requireBlock(snap, 'a').rest).toEqual({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
  });

  it('omits tunes from saved output when the last tune is removed', () => {
    const snap = DocSnapshot.fromOutput({ blocks: [{
      id: 'a', type: 'paragraph', data: {}, tunes: { align: { value: 'left' } },
    }] });

    applyEdits(snap, [{ op: 'setTunes', id: 'a', tunes: { align: null } }], stamp);

    expect(requireBlock(snap, 'a').tunes).toBeUndefined();
    expect(snap.toOutput().blocks.find(block => block.id === 'a')).not.toHaveProperty('tunes');
  });

  it('sets only the named rich field and keeps other rich and plain data', () => {
    const snap = DocSnapshot.fromOutput({ blocks: [{
      id: 'a', type: 'custom', data: { title: [{ text: 'Title' }], body: [{ text: 'Old' }], keep: 1 },
    }] });

    applyEdits(snap, [{ op: 'setRichText', id: 'a', field: 'body', value: [
      { text: 'New', marks: { bold: true } }, { embed: { page: { id: 'page-1' } } },
    ] }], stamp);

    expect(requireBlock(snap, 'a').data).toEqual({
      title: [{ text: 'Title' }],
      body: [{ text: 'New', marks: { bold: true } }, { embed: { page: { id: 'page-1' } } }],
      keep: 1,
    });
  });

  it('applies all eight edit kinds in sequence so later edits see earlier writes', () => {
    const snap = base();
    const edits: readonly Edit[] = [
      { op: 'insert', parentId: null, afterId: 't', block: {
        id: 'n', type: 'toggle', data: {}, children: [{ id: 'n1', type: 'paragraph', data: { text: [{ text: 'Old' }] }, children: [] }],
      } },
      { op: 'setData', id: 'n1', patch: { keep: 1 } },
      { op: 'setRichText', id: 'n1', field: 'text', value: [{ text: 'New' }] },
      { op: 'setTunes', id: 'n', tunes: { align: { value: 'center' } } },
      { op: 'replaceType', id: 'n', type: 'callout', data: { title: [{ text: 'N' }] } },
      { op: 'move', id: 'n1', parentId: 't', afterId: 'a' },
      { op: 'remove', id: 'n', withChildren: false },
      { op: 'setPageField', key: 'title', value: 'Batch' },
    ];

    applyEdits(snap, edits, stamp);

    expect(snap.toOutput().blocks.map(block => block.id)).toEqual(['t', 'a', 'n1', 'b', 'z']);
    expect(requireBlock(snap, 'n1')).toMatchObject({
      data: { text: [{ text: 'New' }], keep: 1 }, parent: 't',
      rest: { lastEditedBy: 'agent-1', lastEditedAt: 42 },
    });
    expect(snap.childrenOf('t')).toEqual(['a', 'n1', 'b']);
    expect(requireBlock(snap, 't').rest).toEqual({});
    expect(snap.has('n')).toBe(false);
    expect(snap.toOutput().title).toBe('Batch');
  });
});

describe('applyEdits JSON copy boundaries', () => {
  it('copies planned data and tunes at every depth without retaining the planned child arrays', () => {
    const snap = base();
    const data = { nested: { labels: ['root'] } };
    const tunes = { custom: { labels: ['root-tune'] } };
    const childData = { nested: { labels: ['child'] } };
    const childTunes = { custom: { labels: ['child-tune'] } };
    const deepData = { nested: { labels: ['deep'] } };
    const deepTunes = { custom: { labels: ['deep-tune'] } };
    const child: PlannedBlock = {
      id: 'n1', type: 'toggle', data: childData, tunes: childTunes,
      children: [{ id: 'n2', type: 'paragraph', data: deepData, tunes: deepTunes, children: [] }],
    };
    const planned: PlannedBlock = {
      id: 'n', type: 'toggle', data, tunes, children: [child, { id: 'n3', type: 'paragraph', data: {}, children: [] }],
    };

    applyEdits(snap, [{ op: 'insert', parentId: null, afterId: 't', block: planned }], stamp);
    for (const labels of [
      data.nested.labels, tunes.custom.labels, childData.nested.labels,
      childTunes.custom.labels, deepData.nested.labels, deepTunes.custom.labels,
    ]) {
      labels.push('payload');
    }
    planned.children.reverse();
    child.children.length = 0;

    expect(requireBlock(snap, 'n').data).toEqual({ nested: { labels: ['root'] } });
    expect(requireBlock(snap, 'n').tunes).toEqual({ custom: { labels: ['root-tune'] } });
    expect(requireBlock(snap, 'n1').data).toEqual({ nested: { labels: ['child'] } });
    expect(requireBlock(snap, 'n1').tunes).toEqual({ custom: { labels: ['child-tune'] } });
    expect(requireBlock(snap, 'n2').data).toEqual({ nested: { labels: ['deep'] } });
    expect(requireBlock(snap, 'n2').tunes).toEqual({ custom: { labels: ['deep-tune'] } });
    expect(snap.childrenOf('n')).toEqual(['n1', 'n3']);
    expect(snap.childrenOf('n1')).toEqual(['n2']);

    for (const id of ['n', 'n1', 'n2']) {
      labelsOf(requireBlock(snap, id).data.nested).push('snapshot');
      labelsOf(requireBlock(snap, id).tunes?.custom).push('snapshot');
    }

    expect(data.nested.labels).toEqual(['root', 'payload']);
    expect(tunes.custom.labels).toEqual(['root-tune', 'payload']);
    expect(childData.nested.labels).toEqual(['child', 'payload']);
    expect(childTunes.custom.labels).toEqual(['child-tune', 'payload']);
    expect(deepData.nested.labels).toEqual(['deep', 'payload']);
    expect(deepTunes.custom.labels).toEqual(['deep-tune', 'payload']);
  });

  it('copies nested setData values and does not change the patch', () => {
    const snap = base();
    const patch = { nested: { labels: ['data'], values: [0, false, null] }, keep: null };

    applyEdits(snap, [{ op: 'setData', id: 'a', patch }], stamp);

    expect(patch).toEqual({ nested: { labels: ['data'], values: [0, false, null] }, keep: null });
    patch.nested.labels.push('payload');

    expect(requireBlock(snap, 'a').data.nested).toEqual({ labels: ['data'], values: [0, false, null] });

    labelsOf(requireBlock(snap, 'a').data.nested).push('snapshot');

    expect(patch.nested.labels).toEqual(['data', 'payload']);
  });

  it('copies rich segments, nested marks, and embeds without changing the value', () => {
    const snap = base();
    const link = { href: 'https://example.com/source' };
    const page = { id: 'source-page' };
    const value: RichText = [{ text: 'Rich', marks: { link } }, { embed: { page } }];

    applyEdits(snap, [{ op: 'setRichText', id: 'a', field: 'text', value }], stamp);

    expect(value).toEqual([{ text: 'Rich', marks: { link: { href: 'https://example.com/source' } } }, { embed: { page: { id: 'source-page' } } }]);
    link.href = 'https://example.com/payload';
    page.id = 'payload-page';
    value.push({ text: 'Payload' });

    expect(requireBlock(snap, 'a').data.text).toEqual([
      { text: 'Rich', marks: { link: { href: 'https://example.com/source' } } },
      { embed: { page: { id: 'source-page' } } },
    ]);

    const copied = requireBlock(snap, 'a').data.text;

    if (!isArray(copied)) {
      throw new Error('Expected copied rich segments');
    }
    const text = copied[0];
    const embed = copied[1];

    if (!isRecord(text) || !isRecord(text.marks) || !isRecord(text.marks.link)
      || !isRecord(embed) || !isRecord(embed.embed) || !isRecord(embed.embed.page)) {
      throw new Error('Expected copied rich marks and embed');
    }
    text.marks.link.href = 'https://example.com/snapshot';
    embed.embed.page.id = 'snapshot-page';

    expect(link.href).toBe('https://example.com/payload');
    expect(page.id).toBe('payload-page');
  });

  it('copies tune values without retaining or changing the tune patch', () => {
    const snap = base();
    const tunes = { custom: { labels: ['tune'] }, remove: null };

    applyEdits(snap, [{ op: 'setTunes', id: 'a', tunes }], stamp);

    expect(tunes).toEqual({ custom: { labels: ['tune'] }, remove: null });
    tunes.custom.labels.push('payload');

    expect(requireBlock(snap, 'a').tunes).toEqual({ custom: { labels: ['tune'] } });

    labelsOf(requireBlock(snap, 'a').tunes?.custom).push('snapshot');

    expect(tunes.custom.labels).toEqual(['tune', 'payload']);
  });

  it('copies replacement data without changing or retaining it', () => {
    const snap = base();
    const data = { nested: { labels: ['replacement'] } };

    applyEdits(snap, [{ op: 'replaceType', id: 'a', type: 'callout', data }], stamp);

    expect(data).toEqual({ nested: { labels: ['replacement'] } });
    data.nested.labels.push('payload');

    expect(requireBlock(snap, 'a').data).toEqual({ nested: { labels: ['replacement'] } });

    labelsOf(requireBlock(snap, 'a').data.nested).push('snapshot');

    expect(data.nested.labels).toEqual(['replacement', 'payload']);
  });

  it.each<{ name: string; icon: PageIcon & { extension: { labels: string[] } } }>([
    { name: 'emoji', icon: { type: 'emoji', value: '\u{1f680}', extension: { labels: ['icon'] } } },
    { name: 'image', icon: { type: 'image', url: 'https://example.com/icon.png', extension: { labels: ['icon'] } } },
  ])('copies a $name page icon including unknown nested JSON fields', ({ icon }) => {
    const snap = base();

    applyEdits(snap, [{ op: 'setPageField', key: 'icon', value: icon }], stamp);
    icon.extension.labels.push('payload');

    expect(snap.icon).toEqual({ ...icon, extension: { labels: ['icon'] } });

    const copied: unknown = snap.icon;

    if (!isRecord(copied)) {
      throw new Error('Expected copied icon');
    }
    labelsOf(copied.extension).push('snapshot');

    expect(icon.extension.labels).toEqual(['icon', 'payload']);
  });
});

describe('applyEdits own JSON keys', () => {
  it('keeps an own __proto__ data key through save and isolates its value', () => {
    const snap = DocSnapshot.fromOutput({ blocks: [{ id: 'a', type: 'custom', data: {} }] });
    const value = { labels: ['data'] };
    const patch: Record<string, unknown> = Object.fromEntries([['__proto__', value]]);

    applyEdits(snap, [{ op: 'setData', id: 'a', patch }], stamp);

    const data = requireBlock(snap, 'a').data;

    expect(Object.keys(data)).toEqual(['__proto__']);
    expect(snap.toOutput().blocks[0]?.data).toEqual(Object.fromEntries([['__proto__', { labels: ['data'] }]]));

    value.labels.push('payload');

    expect(data.__proto__).toEqual({ labels: ['data'] });

    labelsOf(data.__proto__).push('snapshot');

    expect(value.labels).toEqual(['data', 'payload']);
  });

  it('keeps an own __proto__ rich field through save and isolates its segments', () => {
    const snap = DocSnapshot.fromOutput({ blocks: [{ id: 'a', type: 'custom', data: {} }] });
    const page = { id: 'source-page' };
    const value: RichText = [{ embed: { page } }];

    applyEdits(snap, [{ op: 'setRichText', id: 'a', field: '__proto__', value }], stamp);

    const data = requireBlock(snap, 'a').data;

    expect(Object.keys(data)).toEqual(['__proto__']);
    expect(snap.toOutput().blocks[0]?.data).toEqual(Object.fromEntries([
      ['__proto__', [{ embed: { page: { id: 'source-page' } } }]],
    ]));

    page.id = 'payload-page';

    expect(data.__proto__).toEqual([{ embed: { page: { id: 'source-page' } } }]);

    const copied = data.__proto__;

    if (!isArray(copied)) {
      throw new Error('Expected copied rich segments');
    }
    const segment = copied[0];

    if (!isRecord(segment) || !isRecord(segment.embed) || !isRecord(segment.embed.page)) {
      throw new Error('Expected copied page embed');
    }
    segment.embed.page.id = 'snapshot-page';

    expect(page.id).toBe('payload-page');
  });

  it('keeps an own __proto__ tune name through save and isolates its value', () => {
    const snap = DocSnapshot.fromOutput({ blocks: [{ id: 'a', type: 'custom', data: {} }] });
    const value = { labels: ['tune'] };
    const patch: Record<string, unknown> = Object.fromEntries([['__proto__', value]]);

    applyEdits(snap, [{ op: 'setTunes', id: 'a', tunes: patch }], stamp);

    const tunes = requireBlock(snap, 'a').tunes;

    expect(Object.keys(tunes ?? {})).toEqual(['__proto__']);
    expect(snap.toOutput().blocks[0]?.tunes).toEqual(Object.fromEntries([['__proto__', { labels: ['tune'] }]]));

    value.labels.push('payload');

    expect(tunes?.__proto__).toEqual({ labels: ['tune'] });

    labelsOf(tunes?.__proto__).push('snapshot');

    expect(value.labels).toEqual(['tune', 'payload']);
  });
});

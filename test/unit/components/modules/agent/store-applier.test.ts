// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { StoreApplier } from '../../../../../src/components/modules/agent/store-applier';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { writePageField } from '../../../../../src/components/modules/yjs/page-fields';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { runBatch } from '../../../../../src/shared/agent/executor';
import { applyEdits } from '../../../../../src/shared/agent/json-applier';
import { htmlToSegmentsNode } from '../../../../../src/view/rich-text-node';
import { plannerContext } from '../../../shared/agent/fixtures';

import type { AgentApplier } from '../../../../../src/shared/agent/executor';
import type { DocSnapshot, SnapBlock } from '../../../../../src/shared/agent/snapshot';
import type { Plan } from '../../../../../src/shared/agent/types';
import type { Attribution } from '../../../../../src/shared/agent/attribution';
import type { AgentActor, AgentCommand, Edit } from '../../../../../types/agent';
import type { OutputBlockData } from '../../../../../types/data-formats/output-data';

const at = 1_234_567;
const actor: AgentActor = { id: 'agent-1', name: 'Agent', kind: 'agent' };
const originalStamp = { lastEditedAt: 7, lastEditedBy: 'human-1', createdAt: 1, createdBy: 'creator-1' };
const stores = new Set<DocumentStore>();
const appliers = new Set<StoreApplier>();
const subscriptions = new Set<() => void>();

const fields = (type: string): string[] => {
  if (type === 'custom') {
    return ['body'];
  }

  return ['paragraph', 'toggle', 'header'].includes(type) ? ['text'] : [];
};

const base = (): OutputBlockData[] => [
  { id: 'tg', type: 'toggle', data: { text: [{ text: 'T' }], obsolete: true }, content: ['a', 'b'], tunes: { style: 'neutral' } },
  { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }], keep: 1 }, parent: 'tg', tunes: { align: 'left', other: { enabled: true } } },
  { id: 'b', type: 'paragraph', data: { text: [] }, parent: 'tg' },
  { id: 'z', type: 'paragraph', data: { text: [{ text: 'Z' }] } },
];

const nested = (): OutputBlockData[] => [
  { id: 'outer', type: 'toggle', data: { text: [] }, content: ['before', 'tg', 'after'] },
  { id: 'before', type: 'paragraph', data: { text: [] }, parent: 'outer' },
  { id: 'tg', type: 'toggle', data: { text: [{ text: 'T' }] }, parent: 'outer', content: ['b', 'a'] },
  { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] }, parent: 'tg' },
  { id: 'b', type: 'toggle', data: { text: [{ text: 'B' }] }, parent: 'tg', content: ['deep'] },
  { id: 'deep', type: 'paragraph', data: { text: [] }, parent: 'b' },
  { id: 'after', type: 'paragraph', data: { text: [] }, parent: 'outer' },
  { id: 'tail', type: 'paragraph', data: { text: [] } },
];

const createStore = (blocks = base()): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer({
    htmlToSegments: htmlToSegmentsNode,
    richTextFieldsFor: fields,
  }));

  stores.add(store);
  store.fromJSON(blocks.map(block => ({ ...originalStamp, ...block })));

  return store;
};

const createApplier = (store: DocumentStore, attribution: Attribution = { by: actor.id }): StoreApplier => {
  const applier = new StoreApplier(store, {
    attribution,
    richTextFieldsFor: fields,
    htmlToSegments: htmlToSegmentsNode,
  });

  appliers.add(applier);

  return applier;
};

const plan = (edits: Edit[], touched: string[]): Plan => ({
  edits, results: [], refs: {},
  changed: { created: [], updated: [], moved: [], removed: [] },
  warnings: [], touched: new Set(touched),
});

const apply = (applier: StoreApplier, edits: Edit[], touched: string[] = []): Promise<void> => {
  const draft = applier.snapshot().clone();

  // The executor supplies the final draft; assertions below stay literal.
  applyEdits(draft, edits, { actorId: actor.id, at });

  return applier.apply(plan(edits, touched), draft);
};

const execute = (applier: AgentApplier, commands: AgentCommand[]) => runBatch({
  batch: { commands }, ctx: plannerContext(), applier, actor, log: [], batchNo: 1, now: () => at,
});

const requireBlock = (snapshot: DocSnapshot, id: string): SnapBlock => {
  const block = snapshot.get(id);

  if (block === undefined) {
    throw new Error(`Expected fixture block "${id}".`);
  }

  return block;
};

const requireBlockMap = (store: DocumentStore, id: string): Y.Map<unknown> => {
  const block = store.getBlockById(id);

  if (block === undefined) {
    throw new Error(`Expected stored block "${id}".`);
  }

  return block;
};

const requireMap = (value: unknown): Y.Map<unknown> => {
  if (!(value instanceof Y.Map)) {
    throw new Error('Expected a stored Y.Map.');
  }

  return value;
};

const localOrigins = (store: DocumentStore): unknown[] => {
  const origins: unknown[] = [];

  subscriptions.add(store.onUpdate((_update, origin) => origins.push(origin)));

  return origins;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(at);
});

afterEach(() => {
  try {
    subscriptions.forEach(stop => stop());
    subscriptions.clear();
    appliers.forEach(applier => applier.dispose());
    appliers.clear();
    stores.forEach(store => store.destroy());
    stores.clear();
  } finally {
    vi.restoreAllMocks();
  }
});

describe('StoreApplier', () => {
  it('reads rich fields as segments, page fields, hierarchy and stored metadata without writing', () => {
    const store = createStore([
      ...base(),
      { id: 'custom', type: 'custom', data: { body: '<b>Body</b>', plain: '<b>literal</b>' } },
    ]);

    store.pageFromJSON({ title: 'Original', icon: { type: 'emoji', value: 'P' } });
    const applier = createApplier(store);
    const origins = localOrigins(store);
    const snapshot = applier.snapshot();

    expect(requireBlock(snapshot, 'custom').data).toEqual({
      body: [{ text: 'Body', marks: { bold: true } }], plain: '<b>literal</b>',
    });
    expect(applier.runtime).toBe('node-live');
    expect(applier.isReadOnly()).toBe(false);
    expect(applier.revision()).toBe('l0');
    expect(snapshot.toOutput()).toMatchObject({ title: 'Original', icon: { type: 'emoji', value: 'P' } });
    expect(snapshot.childrenOf(null)).toEqual(['tg', 'z', 'custom']);
    expect(snapshot.childrenOf('tg')).toEqual(['a', 'b']);
    expect(requireBlock(snapshot, 'a')).toMatchObject({
      data: { text: [{ text: 'A' }], keep: 1 }, parent: 'tg',
      tunes: { align: 'left', other: { enabled: true } }, rest: originalStamp,
    });

    requireBlock(snapshot, 'a').data.keep = 9;
    snapshot.title = 'Detached';

    expect(requireBlock(applier.snapshot(), 'a').data.keep).toBe(1);
    expect(applier.snapshot().title).toBe('Original');
    expect(origins).toEqual([]);
    expect(applier.revision()).toBe('l0');
  });

  it('inserts a tree, edits rich text and writes a page field in one local update', async () => {
    const store = createStore();
    const applier = createApplier(store);
    const origins = localOrigins(store);

    await apply(applier, [
      {
        op: 'insert', parentId: null, afterId: 'tg',
        block: {
          id: 'n', type: 'toggle', data: { text: [{ text: 'N' }] }, tunes: { style: 'compact' },
          children: [
            { id: 'n1', type: 'paragraph', data: { text: [{ text: 'N1' }] }, children: [] },
            {
              id: 'n2', type: 'toggle', data: { text: [{ text: 'N2' }] },
              children: [{ id: 'n3', type: 'paragraph', data: { text: [] }, children: [] }],
            },
          ],
        },
      },
      { op: 'setRichText', id: 'a', field: 'text', value: [{ text: 'Changed', marks: { bold: true } }] },
      { op: 'setPageField', key: 'title', value: 'Live' },
    ], ['n', 'n1', 'n2', 'n3', 'a']);

    expect(origins).toEqual(['local']);
    const snapshot = applier.snapshot();

    expect(applier.revision()).toBe('l1');
    expect(snapshot.title).toBe('Live');
    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual(['tg', 'a', 'b', 'n', 'n1', 'n2', 'n3', 'z']);
    expect(snapshot.childrenOf(null)).toEqual(['tg', 'n', 'z']);
    expect(snapshot.childrenOf('n')).toEqual(['n1', 'n2']);
    expect(snapshot.childrenOf('n2')).toEqual(['n3']);
    expect(requireBlock(snapshot, 'n').tunes).toEqual({ style: 'compact' });
    expect(requireBlock(snapshot, 'n3').parent).toBe('n2');
    expect(requireBlock(snapshot, 'a').data).toEqual({
      text: [{ text: 'Changed', marks: { bold: true } }], keep: 1,
    });
    for (const id of ['n', 'n1', 'n2', 'n3', 'a']) {
      expect(requireBlock(snapshot, id).rest).toMatchObject({ lastEditedAt: at, lastEditedBy: actor.id });
    }
    for (const id of ['n', 'n1', 'n2', 'n3']) {
      expect(requireBlock(snapshot, id).rest, id).toMatchObject({ createdAt: at, createdBy: actor.id });
    }
    expect(requireBlock(snapshot, 'a').rest).toMatchObject({ createdAt: 1, createdBy: 'creator-1' });
    for (const id of ['tg', 'b', 'z']) {
      expect(requireBlock(snapshot, id).rest).toEqual(originalStamp);
    }
  });

  it('credits the person with the agent on an insert and an update', async () => {
    const store = createStore();
    const applier = createApplier(store, { by: 'human-1', with: actor.id });

    await apply(applier, [
      { op: 'insert', parentId: null, afterId: null, block: { id: 'n', type: 'paragraph', data: { text: [] }, children: [] } },
      { op: 'setData', id: 'z', patch: { keep: 2 } },
    ], ['n', 'z']);

    expect(requireBlock(applier.snapshot(), 'n').rest).toEqual({
      createdAt: at, createdBy: 'human-1', createdWith: actor.id, lastEditedAt: at, lastEditedBy: 'human-1', lastEditedWith: actor.id,
    });
    expect(requireBlock(applier.snapshot(), 'z').rest).toEqual({
      ...originalStamp, lastEditedAt: at, lastEditedBy: 'human-1', lastEditedWith: actor.id,
    });
  });

  it('drops an old co-editor when the agent edits alone', async () => {
    const store = createStore([{ id: 'z', type: 'paragraph', data: { text: [] }, lastEditedWith: 'agent-0' }]);
    const applier = createApplier(store);

    await apply(applier, [{ op: 'setData', id: 'z', patch: { keep: 2 } }], ['z']);

    expect(requireBlock(applier.snapshot(), 'z').rest).toEqual({ ...originalStamp, lastEditedAt: at, lastEditedBy: actor.id });
  });

  it('names no creator on a block added inside an anonymous form answer, nor on a new anonymous row', async () => {
    const store = createStore([
      { id: 'r', type: 'database-row', data: { properties: {}, anonymous: true } },
    ]);
    const applier = createApplier(store);

    await apply(applier, [
      { op: 'insert', parentId: 'r', afterId: null, block: { id: 'n', type: 'paragraph', data: { text: [] }, children: [] } },
      { op: 'insert', parentId: null, afterId: 'r', block: { id: 'q', type: 'database-row', data: { properties: {}, anonymous: true }, children: [] } },
    ], ['n', 'q']);

    for (const id of ['n', 'q']) {
      expect(requireBlock(applier.snapshot(), id).rest, id).toEqual({ createdAt: at, lastEditedAt: at });
    }
  });

  it('deletes a null data key and lifts root children without losing other keys or nested nulls', async () => {
    const store = createStore();
    const applier = createApplier(store);

    await apply(applier, [
      { op: 'setData', id: 'a', patch: { keep: null, added: { nested: null }, count: 0, enabled: false } },
      { op: 'remove', id: 'tg', withChildren: false },
    ], ['a', 'b']);

    const data = requireMap(requireBlockMap(store, 'a').get('data'));

    expect(data.has('keep')).toBe(false);
    expect(applier.snapshot().childrenOf(null)).toEqual(['a', 'b', 'z']);
    expect(store.getBlockById('tg')).toBeUndefined();
    expect(requireBlock(applier.snapshot(), 'a').parent).toBeNull();
    expect(requireBlock(applier.snapshot(), 'b').parent).toBeNull();
    expect(requireBlock(applier.snapshot(), 'a').data).toEqual({
      text: [{ text: 'A' }], added: { nested: null }, count: 0, enabled: false,
    });
    expect(requireBlock(applier.snapshot(), 'a').rest).toEqual({
      ...originalStamp, lastEditedAt: at, lastEditedBy: actor.id,
    });
  });

  it('merges tune keys, deletes null tune keys and omits an emptied tune map from output', async () => {
    const store = createStore();
    const applier = createApplier(store);
    const tunes = requireMap(requireBlockMap(store, 'a').get('tunes'));

    await apply(applier, [{ op: 'setTunes', id: 'a', tunes: {
      align: null, newTune: { count: 0, enabled: false },
    } }], ['a']);

    expect(tunes.has('align')).toBe(false);
    expect(requireBlock(applier.snapshot(), 'a').tunes).toEqual({
      other: { enabled: true }, newTune: { count: 0, enabled: false },
    });
    expect(requireBlock(applier.snapshot(), 'a').rest).toEqual({
      ...originalStamp, lastEditedAt: at, lastEditedBy: actor.id,
    });

    await apply(applier, [{ op: 'setTunes', id: 'a', tunes: { other: null, newTune: null } }], ['a']);

    expect(tunes.size).toBe(0);
    expect(requireBlock(applier.snapshot(), 'a').tunes).toBeUndefined();
    expect(requireBlockMap(store, 'a').get('tunes')).toBe(tunes);
  });

  it('moves a surviving block with its subtree and stamps only its touched id', async () => {
    const store = createStore(nested());
    const applier = createApplier(store);
    const origins = localOrigins(store);

    const result = await execute(applier, [{
      name: 'block.move', args: { id: 'b', parentId: null, position: { after: 'tail' } },
    }]);
    const snapshot = applier.snapshot();

    expect(requireBlock(snapshot, 'b').rest).toEqual({
      ...originalStamp, lastEditedAt: at, lastEditedBy: actor.id,
    });
    expect(result).toMatchObject({ ok: true, changed: { moved: ['b'] } });
    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual(['outer', 'before', 'tg', 'a', 'after', 'tail', 'b', 'deep']);
    expect(snapshot.childrenOf(null)).toEqual(['outer', 'tail', 'b']);
    expect(snapshot.childrenOf('tg')).toEqual(['a']);
    expect(snapshot.childrenOf('b')).toEqual(['deep']);
    expect(requireBlock(snapshot, 'b').parent).toBeNull();
    expect(requireBlock(snapshot, 'deep').parent).toBe('b');
    for (const id of ['outer', 'tg', 'a', 'deep', 'tail']) {
      expect(requireBlock(snapshot, id).rest).toEqual(originalStamp);
    }
    expect(origins).toEqual(['local']);
  });

  it('lifts direct children into a nested parent slot in content order and preserves their subtrees', async () => {
    const store = createStore(nested());
    const applier = createApplier(store);

    await apply(applier, [{ op: 'remove', id: 'tg', withChildren: false }], ['b', 'a', 'tg', 'missing']);

    const snapshot = applier.snapshot();

    expect(snapshot.childrenOf('outer')).toEqual(['before', 'b', 'a', 'after']);
    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual(['outer', 'before', 'b', 'deep', 'a', 'after', 'tail']);
    expect(store.getBlockById('tg')).toBeUndefined();
    expect(requireBlock(snapshot, 'b').parent).toBe('outer');
    expect(requireBlock(snapshot, 'a').parent).toBe('outer');
    expect(snapshot.childrenOf('b')).toEqual(['deep']);
    expect(requireBlock(snapshot, 'deep').parent).toBe('b');
    for (const id of ['b', 'a']) {
      expect(requireBlock(snapshot, id).rest).toEqual({
        ...originalStamp, lastEditedAt: at, lastEditedBy: actor.id,
      });
    }
    for (const id of ['outer', 'before', 'deep', 'after', 'tail']) {
      expect(requireBlock(snapshot, id).rest).toEqual(originalStamp);
    }
  });

  it('removes descendants before their parent and skips stamps for removed or missing ids', async () => {
    const store = createStore(nested());
    const applier = createApplier(store);
    const remove = vi.spyOn(store, 'removeBlock');

    await apply(applier, [{ op: 'remove', id: 'tg', withChildren: true }], ['tg', 'a', 'b', 'deep', 'missing']);

    for (const id of ['tg', 'a', 'b', 'deep']) {
      expect(store.getBlockById(id)).toBeUndefined();
    }
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['deep', 'b', 'a', 'tg']);
    const snapshot = applier.snapshot();

    expect(snapshot.childrenOf('outer')).toEqual(['before', 'after']);
    expect(snapshot.toOutput().blocks.map(block => block.id)).toEqual(['outer', 'before', 'after', 'tail']);
    for (const id of ['outer', 'before', 'after', 'tail']) {
      expect(requireBlock(snapshot, id).rest).toEqual(originalStamp);
    }
    expect(applier.isReadOnly()).toBe(false);
  });

  it('retypes in place, replacing data while preserving placement, children, tunes and creation metadata', async () => {
    const store = createStore();
    const applier = createApplier(store);
    const before = requireBlockMap(store, 'tg');

    await apply(applier, [{ op: 'replaceType', id: 'tg', type: 'header', data: {
      text: [{ text: 'Heading' }], level: 2,
    } }], ['tg']);

    const snapshot = applier.snapshot();

    expect(requireBlock(snapshot, 'tg').data).toEqual({ text: [{ text: 'Heading' }], level: 2 });
    expect(requireBlockMap(store, 'tg')).toBe(before);
    expect(requireBlock(snapshot, 'tg')).toMatchObject({
      type: 'header', parent: null, content: ['a', 'b'], tunes: { style: 'neutral' },
      rest: { ...originalStamp, lastEditedAt: at, lastEditedBy: actor.id },
    });
    expect(snapshot.childrenOf(null)).toEqual(['tg', 'z']);
    expect(requireBlock(snapshot, 'a').parent).toBe('tg');
    expect(requireBlock(snapshot, 'a').rest).toEqual(originalStamp);
  });

  it('writes and clears page fields without attributing unrelated blocks', async () => {
    const store = createStore();
    const applier = createApplier(store);
    const origins = localOrigins(store);

    await apply(applier, [
      { op: 'setPageField', key: 'title', value: 'Li\u0000ve' },
      { op: 'setPageField', key: 'icon', value: { type: 'emoji', value: 'P\u0000' } },
    ]);

    expect(applier.snapshot().toOutput()).toMatchObject({ title: 'Live', icon: { type: 'emoji', value: 'P' } });
    expect(applier.revision()).toBe('l1');

    await apply(applier, [
      { op: 'setPageField', key: 'title', value: '' },
      { op: 'setPageField', key: 'icon', value: null },
    ]);

    expect(store.page.has('title')).toBe(false);
    expect(store.page.has('icon')).toBe(false);
    expect(applier.snapshot().toOutput()).not.toHaveProperty('title');
    expect(applier.snapshot().toOutput()).not.toHaveProperty('icon');
    expect(origins).toEqual(['local', 'local']);
    expect(applier.revision()).toBe('l2');
    for (const id of ['tg', 'a', 'b', 'z']) {
      expect(requireBlock(applier.snapshot(), id).rest).toEqual(originalStamp);
    }
  });

  it('counts local, page and remote updates, but not empty transactions or repeated remote payloads', () => {
    const store = createStore();
    const peer = createStore([]);

    peer.applyRemoteUpdate(store.encodeStateAsUpdate());
    const applier = createApplier(store);
    const origins = localOrigins(store);

    expect(applier.revision()).toBe('l0');
    store.updateBlockData('a', 'keep', 2);
    expect(applier.revision()).toBe('l1');
    store.transact(() => writePageField(store.page, 'title', 'Local page'), 'local');
    expect(applier.revision()).toBe('l2');
    store.transact(() => {}, 'local');
    expect(applier.revision()).toBe('l2');

    peer.applyRemoteUpdate(store.encodeStateAsUpdate());
    peer.updateBlockData('a', 'keep', 3);
    const update = peer.encodeStateAsUpdate(store.getStateVector());

    store.applyRemoteUpdate(update, { source: 'peer' });

    expect(applier.revision()).toBe('l3');
    expect(requireBlock(applier.snapshot(), 'a').data.keep).toBe(3);
    expect(origins).toEqual(['local', 'local']);

    store.applyRemoteUpdate(update, { source: 'peer' });

    expect(applier.revision()).toBe('l3');
  });

  it('stops counting updates after dispose without destroying the caller-owned store', () => {
    const store = createStore();
    const applier = createApplier(store);

    store.updateBlockData('a', 'keep', 2);
    expect(applier.revision()).toBe('l1');
    appliers.delete(applier);
    applier.dispose();
    store.updateBlockData('a', 'keep', 3);

    expect(applier.revision()).toBe('l1');
    expect(store.toJSON().find(block => block.id === 'a')?.data.keep).toBe(3);
  });

  it('does not emit an update for an empty plan', async () => {
    const store = createStore();
    const applier = createApplier(store);
    const before = applier.snapshot().toOutput();
    const origins = localOrigins(store);

    await apply(applier, []);

    expect(origins).toEqual([]);
    expect(applier.revision()).toBe('l0');
    expect(applier.snapshot().toOutput()).toEqual(before);
  });

  it('reports a mid-apply failure, retains partial writes and fails closed on subsequent executor writes', async () => {
    const store = createStore();
    const applier = createApplier(store);
    const origins = localOrigins(store);
    const move = vi.spyOn(store, 'moveBlockTo').mockImplementation(() => {
      throw new Error('boom');
    });
    const result = await execute(applier, [
      { name: 'text.replace', args: { id: 'a', with: 'Partial' } },
      { name: 'doc.setTitle', args: { title: 'Partly applied' } },
      { name: 'block.move', args: { id: 'a', parentId: null, position: 'start' } },
      { name: 'doc.setTitle', args: { title: 'Must not be written' } },
    ]);

    expect(result).toMatchObject({
      ok: false, revision: 'l1', error: { code: 'APPLY_FAILED', retryable: false },
    });
    if (result.ok) {
      throw new Error('Expected a failed live apply.');
    }
    expect(result.error.message).toContain('boom');
    expect(result.error.message).toContain('partly');
    expect(applier.isReadOnly()).toBe(true);
    expect(origins).toEqual(['local']);
    const partial = applier.snapshot().toOutput();

    expect(partial.title).toBe('Partly applied');
    expect(requireBlock(applier.snapshot(), 'a')).toMatchObject({
      data: { text: [{ text: 'Partial' }], keep: 1 }, parent: 'tg', rest: originalStamp,
    });
    expect(move).toHaveBeenCalledTimes(1);

    const blocked = await execute(applier, [{ name: 'doc.setTitle', args: { title: 'Blocked' } }]);

    expect(blocked).toMatchObject({ ok: false, revision: 'l1', error: { code: 'READ_ONLY', retryable: false } });
    expect(applier.snapshot().toOutput()).toEqual(partial);
    expect(origins).toEqual(['local']);
    const read = await execute(applier, [{ name: 'doc.read', args: {} }]);

    expect(read).toMatchObject({ ok: true, revision: 'l1' });
    expect(applier.isReadOnly()).toBe(true);
    expect(applier.snapshot().toOutput()).toEqual(partial);
  });

  const history: Array<'history.undo' | 'history.redo'> = ['history.undo', 'history.redo'];

  it.each(history)('answers %s with nothing written when the applier has no step', async name => {
    const store = createStore();
    const applier: AgentApplier = createApplier(store);
    const before = applier.snapshot().toOutput();
    const origins = localOrigins(store);
    const result = await execute(applier, [{ name, args: {} }]);

    expect(result).toMatchObject({
      ok: false, revision: 'l0',
      error: { code: name === 'history.undo' ? 'NOTHING_TO_UNDO' : 'NOTHING_TO_REDO' },
    });
    expect(origins).toEqual([]);
    expect(applier.snapshot().toOutput()).toEqual(before);
  });

  it('a step checked as "none" that appears before the step runs is STALE, never undone or redone', async () => {
    const store = createStore();
    const applier = createApplier(store);
    const emptyUndo = applier.historyStepId('history.undo');
    const emptyRedo = applier.historyStepId('history.redo');

    expect([emptyUndo, emptyRedo]).toEqual([undefined, undefined]);
    await apply(applier, [{ op: 'setData', id: 'a', patch: { keep: 2 } }], ['a']);
    await expect(applier.undo({ expected: emptyUndo })).rejects.toMatchObject({ error: { code: 'STALE' } });
    expect(applier.snapshot().get('a')?.data.keep).toBe(2);
    await applier.undo();
    await expect(applier.redo({ expected: emptyRedo })).rejects.toMatchObject({ error: { code: 'STALE' } });
    expect(applier.snapshot().get('a')?.data.keep).toBe(1);
  });

  it("undoes its own step but not another 'local' write to the store", async () => {
    const store = createStore();
    const applier = createApplier(store);

    await apply(applier, [{ op: 'setData', id: 'a', patch: { keep: 2 } }], ['a']);
    store.updateBlockData('z', 'text', [{ text: 'Host wrote this' }]);
    await applier.undo();

    expect(applier.snapshot().get('a')?.data.keep).toBe(1);
    expect(applier.snapshot().get('z')?.data.text).toEqual([{ text: 'Host wrote this' }]);
    await expect(applier.undo()).rejects.toMatchObject({ error: { code: 'NOTHING_TO_UNDO' } });
  });
});

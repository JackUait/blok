import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import {
  LOCAL_ORIGIN_TAGS,
  type BlockChangeEvent,
  type BlockPlacement,
  type BlockReplayCapture,
  type LocalOriginTag,
} from '../../../../../src/components/modules/yjs/types';

type SingleBlockEvent = Extract<BlockChangeEvent, { blockId: string }>;
type BatchBlockEvent = Extract<BlockChangeEvent, { blockIds: string[] }>;

const createBlockObserver = (): BlockObserver => {
  return new BlockObserver();
};

describe('Replay capture boundary controls', () => {
  let serializer: YBlockSerializer;
  let store: DocumentStore;
  let peer: DocumentStore | undefined;
  let undoManager: Y.UndoManager;

  const dataOf = (id: string): Y.Map<unknown> => {
    const data: unknown = store.getBlockById(id)?.get('data');

    if (!(data instanceof Y.Map)) throw new Error('expected native block data');
    return data;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    serializer = new YBlockSerializer();
    store = new DocumentStore(serializer);
    store.fromJSON([
      { id: 'db', type: 'database', data: {} },
      { id: 'r1', type: 'database-row', parent: 'db', data: {
        title: 'Alpha', properties: { t: 'Alpha', notes: 'short', amount: 12 }, position: 'a0',
      } },
      { id: 'tpl', type: 'database-row', parent: 'db', data: {
        title: 'Reusable', properties: { t: 'Reusable', notes: 'template notes' },
        position: 'a1', template: true,
      } },
      { id: 'p1', type: 'paragraph', data: { text: 'Keep <b>marked</b> text' } },
    ]);
    undoManager = new Y.UndoManager(store.undoScope, { trackedOrigins: new Set(['local']) });
    peer = undefined;
  });

  afterEach(() => {
    peer?.destroy();
    undoManager.destroy();
    store.destroy();
    vi.restoreAllMocks();
  });

  it.each(['history-first', 'peer-first'] as const)(
    'characterizes scalar history keys independently of a same-row peer field (%s)',
    (arrival) => {
      peer = new DocumentStore(new YBlockSerializer());
      peer.applyRemoteUpdate(store.encodeStateAsUpdate());
      store.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'local edit', amount: 12 });
      undoManager.stopCapturing();
      peer.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short', amount: 99 });
      const properties: unknown = dataOf('r1').get('properties');

      if (!(properties instanceof Y.Map)) throw new Error('expected native properties');
      const changes: Array<{
        history: boolean;
        keys: Array<{ key: string; action: string; before: unknown; present: boolean; after: unknown }>;
      }> = [];

      properties.observe((event, transaction) => {
        changes.push({
          history: transaction.origin === undoManager,
          keys: [...event.changes.keys].map(([key, change]) => ({
            key, action: change.action, before: change.oldValue,
            present: properties.has(key), after: serializer.yValueToPlain(properties.get(key)),
          })),
        });
      });
      const applyPeer = (): void => {
        if (peer === undefined) throw new Error('expected peer');
        store.applyRemoteUpdate(peer.encodeStateAsUpdate(store.getStateVector()));
      };

      if (arrival === 'history-first') {
        undoManager.undo();
        applyPeer();
      } else {
        applyPeer();
        undoManager.undo();
      }

      expect(changes.filter((change) => change.history).flatMap((change) => change.keys)).toEqual([
        { key: 'notes', action: 'update', before: 'local edit', present: true, after: 'short' },
      ]);
      expect(changes.filter((change) => !change.history).flatMap((change) => change.keys)).toEqual([
        { key: 'amount', action: 'update', before: 12, present: true, after: 99 },
      ]);
      expect(serializer.yMapToObject(properties)).toEqual({ t: 'Alpha', notes: 'short', amount: 99 });
    },
  );

  it('characterizes missing property presence during numeric undo', () => {
    store.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short' });
    undoManager.clear();
    store.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short', amount: 42 });
    undoManager.stopCapturing();
    const properties: unknown = dataOf('r1').get('properties');

    if (!(properties instanceof Y.Map)) throw new Error('expected native properties');
    const changes: Array<{ key: string; action: string; before: unknown; present: boolean }> = [];

    properties.observe((event, transaction) => {
      if (transaction.origin !== undoManager) return;
      for (const [key, change] of event.changes.keys) {
        changes.push({ key, action: change.action, before: change.oldValue, present: properties.has(key) });
      }
    });
    undoManager.undo();

    expect(changes).toEqual([{ key: 'amount', action: 'delete', before: 42, present: false }]);
  });

  it('characterizes a deleted native template map before replay snapshot design', () => {
    const template = store.getBlockById('tpl');
    const properties: unknown = dataOf('tpl').get('properties');

    if (template === undefined || !(properties instanceof Y.Map)) throw new Error('expected template');
    const before = serializer.yBlockToOutputData(template);
    let removed: unknown;

    store.blocksMap.observe((event) => {
      removed = event.changes.keys.get('tpl')?.oldValue;
    });
    store.removeBlock('tpl');

    expect(serializer.yBlockToOutputData(template)).toBeNull();
    expect(removed).toBe(template);
    expect(serializer.yMapToObject(properties)).toEqual({});
    expect(before?.data).toEqual({
      title: 'Reusable', properties: { t: 'Reusable', notes: 'template notes' },
      position: 'a1', template: true,
    });
  });

  it('characterizes deleted rich text oldValue before replay snapshot design', () => {
    const data = dataOf('p1');
    const text: unknown = data.get('text');

    if (!(text instanceof Y.XmlText)) throw new Error('expected native rich text');
    const before: unknown = serializer.yValueToPlain(text);
    let removed: unknown;
    let oldReadback: unknown;

    data.observe((event) => {
      removed = event.changes.keys.get('text')?.oldValue;
      oldReadback = serializer.yValueToPlain(removed);
    });
    store.updateBlockData('p1', 'text', undefined);

    expect(oldReadback).toBe('');
    expect(removed).toBe(text);
    expect(text.toDelta()).toEqual([]);
    expect(before).toBe('Keep <strong>marked</strong> text');
    expect(data.has('text')).toBe(false);
  });
});

describe('Deleted replay identity controls', () => {
  let store: DocumentStore;
  let undoManager: Y.UndoManager;
  let serializer: YBlockSerializer;

  beforeEach(() => {
    vi.clearAllMocks();
    serializer = new YBlockSerializer();
    store = new DocumentStore(serializer);
    store.fromJSON([
      { id: 'db', type: 'database', data: {} },
      { id: 'tpl', type: 'database-row', parent: 'db', data: {
        title: 'Reusable', properties: { t: 'Reusable' }, position: 'a0', template: true,
      } },
    ]);
    undoManager = new Y.UndoManager(store.undoScope, { trackedOrigins: new Set(['local']) });
  });

  afterEach(() => {
    undoManager.destroy();
    store.destroy();
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    'characterizes pre-transaction native identity when template=%s is flipped and removed',
    (beforeTemplate) => {
      store.updateBlockData('tpl', 'template', beforeTemplate);
      undoManager.clear();
      const block = store.getBlockById('tpl');
      const data: unknown = block?.get('data');
      const doc = store.blocksMap.doc;

      if (block === undefined || !(data instanceof Y.Map) || doc === null) {
        throw new Error('expected native template');
      }
      let captured: unknown;

      doc.on('afterTransaction', (transaction) => {
        if (transaction.origin !== 'local' || store.blocksMap.has('tpl')) return;
        const items: Y.Item[] = [];

        Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
          if (struct instanceof Y.Item
            && struct.id.clock < (transaction.beforeState.get(struct.id.client) ?? 0)) {
            items.push(struct);
          }
        });
        const scalarSlot = (parent: Y.Map<unknown>, key: string): unknown => {
          const item = items.find((candidate) => candidate.parent === parent && candidate.parentSub === key);
          const value: unknown = item?.content.getContent()[0];

          return value;
        };
        const oldData: unknown = scalarSlot(block, 'data');

        captured = {
          id: scalarSlot(block, 'id'),
          type: scalarSlot(block, 'type'),
          parent: scalarSlot(block, 'parentId'),
          template: oldData instanceof Y.Map ? scalarSlot(oldData, 'template') : undefined,
        };
      });
      store.transact(() => {
        data.set('template', !beforeTemplate);
        store.removeBlock('tpl');
      }, 'local');

      expect(captured).toEqual({
        id: 'tpl', type: 'database-row', parent: 'db', template: beforeTemplate,
      });
      expect(serializer.yBlockToOutputData(block)).toBeNull();
      undoManager.undo();
      const restored = store.getBlockById('tpl');

      expect(restored === undefined ? undefined : serializer.yBlockToOutputData(restored)?.data.template)
        .toBe(beforeTemplate);
    },
  );
});

describe('Transaction-owned replay captures', () => {
  let observer: BlockObserver;
  let serializer: YBlockSerializer;
  let store: DocumentStore;
  let peer: DocumentStore | undefined;
  let undoManager: Y.UndoManager;
  let events: BlockChangeEvent[];

  const dataOf = (id: string): Y.Map<unknown> => {
    const data: unknown = store.getBlockById(id)?.get('data');

    if (!(data instanceof Y.Map)) throw new Error('expected native data');
    return data;
  };
  const propertiesOf = (id: string): Y.Map<unknown> => {
    const properties: unknown = dataOf(id).get('properties');

    if (!(properties instanceof Y.Map)) throw new Error('expected native properties');
    return properties;
  };
  const capturesOf = (event: BlockChangeEvent): unknown[] => {
    const captures: unknown = 'captures' in event ? event.captures : undefined;

    return Array.isArray(captures) ? captures : [];
  };
  const orderedChanges = (record: unknown): unknown => {
    if (typeof record !== 'object' || record === null || !('changes' in record)) return record;
    const changes: unknown = record.changes;

    if (!Array.isArray(changes)) return record;
    return {
      ...record,
      changes: [...changes].sort((left: unknown, right: unknown) => {
        const pathOf = (change: unknown): string => typeof change === 'object' && change !== null &&
          'path' in change ? JSON.stringify(change.path) : '';

        return pathOf(left).localeCompare(pathOf(right));
      }),
    };
  };
  const recordsFor = (id: string, origin: string): unknown[] =>
    events.filter((event) => event.origin === origin)
      .flatMap(capturesOf)
      .filter((record) => typeof record === 'object' && record !== null &&
        'blockId' in record && record.blockId === id).map(orderedChanges);
  const rowIdentity = (template?: boolean) => ({
    type: 'database-row',
    parent: { present: true, value: 'db' },
    template: template === undefined ? { present: false } : { present: true, value: template },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    serializer = new YBlockSerializer();
    store = new DocumentStore(serializer);
    store.fromJSON([
      { id: 'db', type: 'database', data: {}, content: ['r1', 'r2', 'tpl'] },
      { id: 'r1', type: 'database-row', parent: 'db', data: {
        properties: { t: 'Alpha', notes: 'short', amount: 12 }, position: 'a0',
      } },
      { id: 'r2', type: 'database-row', parent: 'db', data: {
        properties: { t: 'Bravo', notes: 'second' }, position: 'a1',
      } },
      { id: 'tpl', type: 'database-row', parent: 'db', data: {
        properties: { t: 'Reusable' }, position: 'a2', template: true,
      } },
    ]);
    undoManager = new Y.UndoManager(store.undoScope, { trackedOrigins: new Set(['local']) });
    observer = createBlockObserver();
    observer.observe({ blocksMap: store.blocksMap, rootOrder: store.rootOrder }, undoManager);
    events = [];
    observer.onBlocksChanged((event) => { events.push(event); });
    peer = undefined;
  });

  afterEach(() => {
    observer.destroy();
    peer?.destroy();
    undoManager.destroy();
    store.destroy();
    vi.restoreAllMocks();
  });

  it.each(['history-first', 'peer-first'] as const)(
    'keeps history owned keys separate from a same-row peer field (%s)',
    (arrival) => {
      peer = new DocumentStore(new YBlockSerializer());
      peer.applyRemoteUpdate(store.encodeStateAsUpdate());
      store.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'local edit', amount: 12 });
      undoManager.stopCapturing();
      peer.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short', amount: 99 });
      events.length = 0;
      const applyPeer = (): void => {
        if (peer === undefined) throw new Error('expected peer');
        store.applyRemoteUpdate(peer.encodeStateAsUpdate(store.getStateVector()));
      };

      if (arrival === 'history-first') {
        undoManager.undo();
        applyPeer();
      } else {
        applyPeer();
        undoManager.undo();
      }

      expect(recordsFor('r1', 'undo')).toEqual([{
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys', native: rowIdentity(),
        changes: [{ path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' }],
      }]);
      expect(recordsFor('r1', 'remote')).toEqual([{
        blockId: 'r1', type: 'update', origin: 'remote', scope: 'keys', native: rowIdentity(),
        changes: [{ path: ['properties', 'amount'], beforePresent: true, afterPresent: true, after: 99 }],
      }]);
      expect(serializer.yMapToObject(propertiesOf('r1'))).toEqual({ t: 'Alpha', notes: 'short', amount: 99 });
    },
  );

  it('keeps key presence separate from false, zero, empty text and null', () => {
    const values = { flag: false, zero: 0, empty: '', nullable: null };
    const properties = propertiesOf('r1');

    store.transact(() => {
      for (const [key, value] of Object.entries(values)) properties.set(key, value);
    }, 'local');

    expect(recordsFor('r1', 'local')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
      changes: Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({
        path: ['properties', key], beforePresent: false, afterPresent: true, after: value,
      })),
    }]);
    events.length = 0;
    store.transact(() => {
      for (const key of Object.keys(values)) properties.set(key, 'changed');
    }, 'local');
    expect(recordsFor('r1', 'local')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
      changes: Object.keys(values).sort().map((key) => ({
        path: ['properties', key], beforePresent: true, afterPresent: true, after: 'changed',
      })),
    }]);
    events.length = 0;
    store.transact(() => {
      for (const key of Object.keys(values)) properties.delete(key);
    }, 'local');
    expect(recordsFor('r1', 'local')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
      changes: Object.keys(values).sort().map((key) => ({
        path: ['properties', key], beforePresent: true, afterPresent: false,
      })),
    }]);
  });

  it('captures numeric undo deletion without inventing a present null value', () => {
    store.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short' });
    undoManager.clear();
    store.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short', amount: 42 });
    undoManager.stopCapturing();
    events.length = 0;
    undoManager.undo();

    expect(recordsFor('r1', 'undo')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys', native: rowIdentity(),
      changes: [{ path: ['properties', 'amount'], beforePresent: true, afterPresent: false }],
    }]);
  });

  it('captures every affected block before the first add subscriber rewrites another row', () => {
    let rewritten = false;

    observer.onBlocksChanged((event) => {
      if (event.type !== 'add' || event.blockId !== 'born' || rewritten) return;
      rewritten = true;
      store.transact(() => {
        propertiesOf('r2').set('notes', 'subscriber edit');
        dataOf('r2').set('template', true);
      }, 'local');
    });
    store.transact(() => {
      propertiesOf('r1').set('notes', 'outer first');
      propertiesOf('r2').set('notes', 'outer second');
      store.addBlock({ id: 'born', type: 'paragraph', data: { text: 'New block' } });
    }, 'local');
    const rowRecords = recordsFor('r2', 'local');

    expect(rowRecords).toEqual(expect.arrayContaining([
      {
        blockId: 'r2', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
        changes: [{ path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'outer second' }],
      },
      {
        blockId: 'r2', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(true),
        changes: [
          { path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'subscriber edit' },
          { path: ['template'], beforePresent: false, afterPresent: true, after: true },
        ],
      },
    ]));
    expect(rowRecords).toHaveLength(2);
    expect(propertiesOf('r2').get('notes')).toBe('subscriber edit');
  });

  it('retains detached current-after values across an await and deletion of their source', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let retained: unknown;
    let afterAwait: unknown;
    let completion: Promise<void> | undefined;

    observer.onBlocksChanged((event) => {
      if (event.type !== 'update' || event.blockId !== 'r1' || retained !== undefined) return;
      retained = capturesOf(event)[0];
      completion = (async () => {
        await gate;
        afterAwait = retained;
      })();
    });
    const source = { labels: ['captured'], nested: { enabled: false } };

    try {
      store.transact(() => { propertiesOf('r1').set('opaque', source); }, 'local');
      const stored: unknown = propertiesOf('r1').get('opaque');

      if (typeof stored !== 'object' || stored === null || !('labels' in stored) || !('nested' in stored)) {
        throw new Error('expected stored opaque value');
      }
      const labels: unknown = stored.labels;
      const nested: unknown = stored.nested;

      if (!Array.isArray(labels) || typeof nested !== 'object' || nested === null) {
        throw new Error('expected stored nested value');
      }
      const record = retained;
      const changes: unknown = typeof record === 'object' && record !== null && 'changes' in record
        ? record.changes : undefined;
      const change: unknown = Array.isArray(changes) ? changes[0] : undefined;
      const after: unknown = typeof change === 'object' && change !== null && 'after' in change
        ? change.after : undefined;

      expect(after).toEqual({ labels: ['captured'], nested: { enabled: false } });
      expect(after).not.toBe(stored);
      if (typeof after === 'object' && after !== null && 'labels' in after && 'nested' in after) {
        expect(after.labels).not.toBe(labels);
        expect(after.nested).not.toBe(nested);
      }
      labels.push('mutated native');
      Reflect.set(nested, 'enabled', true);
      store.removeBlock('r1');
      release?.();
      if (completion !== undefined) await completion;

      expect(afterAwait).toEqual({
        blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
        changes: [{
          path: ['properties', 'opaque'], beforePresent: false, afterPresent: true,
          after: { labels: ['captured'], nested: { enabled: false } },
        }],
      });
      expect(afterAwait).toBe(retained);
      expect(store.getBlockById('r1')).toBeUndefined();
    } finally {
      release?.();
      if (completion !== undefined) await completion;
    }
  });

  it('prevents the first subscriber from changing the capture retained by the second subscriber', () => {
    let retained: unknown;

    observer.onBlocksChanged((event) => {
      if (event.type !== 'update' || event.blockId !== 'r1') return;
      const record = capturesOf(event)[0];

      if (typeof record !== 'object' || record === null || !('changes' in record)) return;
      Reflect.set(record, 'scope', 'unknown');
      const changes: unknown = record.changes;

      if (!Array.isArray(changes)) return;
      const change: unknown = changes[0];

      if (typeof change !== 'object' || change === null || !('after' in change) || !('path' in change)) return;
      const after: unknown = change.after;
      const path: unknown = change.path;

      if (typeof after === 'object' && after !== null) Reflect.set(after, 'label', 'subscriber corruption');
      if (Array.isArray(path)) {
        try { path.push('subscriber corruption'); } catch {}
      }
    });
    observer.onBlocksChanged((event) => {
      if (event.type === 'update' && event.blockId === 'r1') retained = capturesOf(event)[0];
    });
    store.transact(() => { propertiesOf('r1').set('opaque', { label: 'captured' }); }, 'local');

    expect(retained).toEqual({
      blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
      changes: [{
        path: ['properties', 'opaque'], beforePresent: false, afterPresent: true, after: { label: 'captured' },
      }],
    });
  });

  it('does not invent field captures for a genuine same-parent order-only move', () => {
    store.moveBlockTo('r2', { parentId: 'db', afterId: null });
    const moves = events.filter((event) => event.type === 'move');

    expect(moves.flatMap(capturesOf)).toEqual([]);
    expect(moves.some((event) => event.type === 'move' && event.blockId === 'r2')).toBe(true);
    expect(events.filter((event) => event.type !== 'move')).toEqual([]);
    expect(store.getBlockById('r2')?.get('parentId')).toBe('db');
  });

  it.each(['block', 'data', 'properties'] as const)(
    'marks %s replacement as non-authorizing instead of reconstructing a row patch',
    (level) => {
      const row = store.getBlockById('r1');

      if (row === undefined) throw new Error('expected row');
      store.transact(() => {
        if (level === 'block') {
          store.blocksMap.set('r1', serializer.outputDataToYBlock({
            id: 'r1', type: 'database-row', parent: 'db',
            data: { properties: { t: 'Replacement', amount: 99 }, position: 'a0' },
          }));
        } else if (level === 'data') {
          row.set('data', serializer.objectToYMap({ properties: { t: 'Replacement', amount: 99 }, position: 'a0' }));
        } else {
          dataOf('r1').set('properties', serializer.objectToYMap({ t: 'Replacement', amount: 99 }));
        }
      }, 'local');

      expect(recordsFor('r1', 'local')).toEqual([expect.objectContaining({
        blockId: 'r1', type: 'update', origin: 'local', scope: 'replacement', changes: [],
      })]);
    },
  );

  it.each([
    {
      caseName: 'relation seeded empty',
      propertyId: 'related',
      seed: [],
      next: [{ id: 'q1' }],
    },
    {
      caseName: 'relation seeded nonempty',
      propertyId: 'related',
      seed: [{ id: 'q1' }],
      next: [{ id: 'q2' }, { id: 'q1' }],
    },
    {
      caseName: 'files seeded empty',
      propertyId: 'attachments',
      seed: [],
      next: [{ id: 'file-a', name: 'First.txt', url: 'https://example.invalid/first.txt' }],
    },
    {
      caseName: 'files seeded nonempty',
      propertyId: 'attachments',
      seed: [{ id: 'file-a', name: 'Before.txt', url: 'https://example.invalid/first.txt' }],
      next: [
        { id: 'file-a', name: 'After.txt', url: 'https://example.invalid/first.txt' },
        { id: 'file-b', name: 'Second.txt', url: 'https://example.invalid/second.txt' },
      ],
    },
  ])('owns the exported property during structured replay ($caseName)', ({ propertyId, seed, next }) => {
    const untouched = {
      t: 'Alpha',
      notes: 'short',
      amount: 12,
      otherRelation: [{ id: 'untouched-row' }],
    };

    store.updateBlockData('r1', 'properties', { ...untouched, [propertyId]: seed });
    const nativeBeforeUpdate: unknown = propertiesOf('r1').get(propertyId);

    if (!(nativeBeforeUpdate instanceof Y.Map) || !serializer.isGridMap(nativeBeforeUpdate)) {
      throw new Error('expected seeded identity-list property');
    }
    undoManager.clear();
    events.length = 0;
    store.updateBlockData('r1', 'properties', { ...untouched, [propertyId]: next });
    undoManager.stopCapturing();
    const localCaptures = recordsFor('r1', 'local');
    const nativeAfterUpdate: unknown = propertiesOf('r1').get(propertyId);

    events.length = 0;
    undoManager.undo();

    expect(recordsFor('r1', 'undo')).toEqual([{
      blockId: 'r1',
      type: 'update',
      origin: 'undo',
      scope: 'keys',
      native: rowIdentity(),
      changes: [{
        path: ['properties', propertyId],
        beforePresent: true,
        afterPresent: true,
        after: seed,
      }],
    }]);
    expect(localCaptures).toEqual([{
      blockId: 'r1',
      type: 'update',
      origin: 'local',
      scope: 'keys',
      native: rowIdentity(),
      changes: [{
        path: ['properties', propertyId],
        beforePresent: true,
        afterPresent: true,
        after: next,
      }],
    }]);
    expect(nativeAfterUpdate).toBe(nativeBeforeUpdate);
    expect(serializer.yMapToObject(propertiesOf('r1'))).toEqual({
      ...untouched, [propertyId]: seed,
    });
    events.length = 0;
    undoManager.redo();

    expect(recordsFor('r1', 'redo')).toEqual([{
      blockId: 'r1',
      type: 'update',
      origin: 'redo',
      scope: 'keys',
      native: rowIdentity(),
      changes: [{
        path: ['properties', propertyId],
        beforePresent: true,
        afterPresent: true,
        after: next,
      }],
    }]);
    expect(serializer.yMapToObject(propertiesOf('r1'))).toEqual({
      ...untouched, [propertyId]: next,
    });
  });

  it('marks native keyed-wrapper edits as unknown instead of exporting physical paths', () => {
    store.updateBlockData('db', 'schema', [{ id: 'column', name: 'Original' }]);
    const schema: unknown = dataOf('db').get('schema');

    if (!(schema instanceof Y.Map) || !serializer.isGridMap(schema)) {
      throw new Error('expected native keyed schema');
    }
    const rows: unknown = schema.get('__rows');

    if (!(rows instanceof Y.Map)) throw new Error('expected keyed schema entries');
    const column: unknown = rows.get('column');

    if (!(column instanceof Y.Map)) throw new Error('expected native schema column');
    events.length = 0;
    store.transact(() => { column.set('name', 'Renamed'); }, 'local');

    expect(recordsFor('db', 'local')).toEqual([{
      blockId: 'db', type: 'update', origin: 'local', scope: 'unknown',
      native: {
        type: 'database', parent: { present: false }, template: { present: false },
      },
      changes: [],
    }]);
    const block = store.getBlockById('db');

    if (block === undefined) throw new Error('expected database block');
    expect(serializer.yBlockToOutputData(block)?.data.schema).toEqual([
      { id: 'column', name: 'Renamed' },
    ]);
  });

  it('keeps native edit metadata alone non-authorizing', () => {
    store.updateBlockMetadata('r1', 101, 'local-author');

    expect(recordsFor('r1', 'local')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'local', scope: 'unknown', native: rowIdentity(), changes: [],
    }]);
  });

  it('keeps sparse data ownership through native edit stamps and their undo and redo', () => {
    store.transact(() => {
      store.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'stamped note', amount: 12 });
      store.updateBlockMetadata('r1', 101, 'local-author');
    }, 'local');

    expect(recordsFor('r1', 'local')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
      changes: [{ path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'stamped note' }],
    }]);
    undoManager.stopCapturing();
    events.length = 0;
    undoManager.undo();
    expect(recordsFor('r1', 'undo')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys', native: rowIdentity(),
      changes: [{ path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' }],
    }]);
    events.length = 0;
    undoManager.redo();
    expect(recordsFor('r1', 'redo')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'redo', scope: 'keys', native: rowIdentity(),
      changes: [{ path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'stamped note' }],
    }]);
  });

  it('keeps mixed data and another native block key non-authorizing beside edit stamps', () => {
    const row = store.getBlockById('r1');

    if (row === undefined) throw new Error('expected native row');
    store.transact(() => {
      store.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'mixed note', amount: 12 });
      store.updateBlockMetadata('r1', 101, 'local-author');
      row.set('parentId', 'another-database');
    }, 'local');

    expect(recordsFor('r1', 'local')).toEqual([{
      blockId: 'r1', type: 'update', origin: 'local', scope: 'unknown',
      native: { ...rowIdentity(), parent: { present: true, value: 'another-database' } }, changes: [],
    }]);
  });

  it('marks changes outside native data as unknown without granting owned key authority', () => {
    const tunes: unknown = store.getBlockById('r1')?.get('tunes');

    if (!(tunes instanceof Y.Map)) throw new Error('expected native tunes');
    const foreign = new Y.Array<unknown>();

    foreign.push(['uncharacterized']);
    store.transact(() => { tunes.set('foreign', foreign); }, 'local');

    expect(recordsFor('r1', 'local')).toEqual([expect.objectContaining({
      blockId: 'r1', type: 'update', origin: 'local', scope: 'unknown', changes: [],
    })]);
  });

  it('pairs batch births and redo births with their own detached values and template flags', () => {
    const births = [
      { id: 'template-born', template: true, position: 'a3', title: 'Template' },
      { id: 'ordinary-born', template: false, position: 'a4', title: 'Ordinary' },
    ];

    store.transact(() => {
      for (const birth of births) {
        store.addBlock({
          id: birth.id, type: 'database-row', parent: 'db',
          data: { properties: { t: birth.title }, position: birth.position, template: birth.template },
        });
      }
    }, 'local');
    const expectedBirths = (origin: 'local' | 'redo') => births.map((birth) => ({
      blockId: birth.id, type: 'add', origin, scope: 'keys', native: rowIdentity(birth.template),
      changes: [
        { path: ['position'], beforePresent: false, afterPresent: true, after: birth.position },
        { path: ['properties'], beforePresent: false, afterPresent: true, after: { t: birth.title } },
        { path: ['template'], beforePresent: false, afterPresent: true, after: birth.template },
      ],
    }));
    const batch = events.find((event) => event.type === 'batch-add');

    expect(batch === undefined ? [] : capturesOf(batch).map(orderedChanges)).toEqual(expect.arrayContaining(expectedBirths('local')));
    expect(batch?.type === 'batch-add' ? batch.blockIds : []).toEqual(births.map((birth) => birth.id));
    expect(batch === undefined ? [] : capturesOf(batch)).toHaveLength(2);
    undoManager.stopCapturing();
    events.length = 0;
    undoManager.undo();
    expect(events.flatMap(capturesOf)).toEqual(expect.arrayContaining(births.map((birth) => ({
      blockId: birth.id, type: 'remove', origin: 'undo', scope: 'keys', native: rowIdentity(birth.template), changes: [],
    }))));
    events.length = 0;
    undoManager.redo();
    const redoBatch = events.find((event) => event.type === 'batch-add');

    expect(redoBatch === undefined ? [] : capturesOf(redoBatch).map(orderedChanges)).toEqual(expect.arrayContaining(expectedBirths('redo')));
    expect(redoBatch === undefined ? [] : capturesOf(redoBatch)).toHaveLength(2);
  });

  describe('structured relation and files list boundaries', () => {
    const fileA = { id: 'file-a', name: 'Before.txt', url: 'https://example.invalid/a' };
    const fileB = { id: 'file-b', name: 'Second.txt', url: 'https://example.invalid/b' };
    const base = { t: 'Alpha', notes: 'short', amount: 12 };
    const seedLists = (): void => {
      store.updateBlockData('r1', 'properties', {
        ...base, attachments: [fileA, fileB], related: [{ id: 'q1' }, { id: 'q2' }],
      });
      if (!serializer.isGridMap(propertiesOf('r1').get('attachments')) ||
          !serializer.isGridMap(propertiesOf('r1').get('related'))) {
        throw new Error('expected keyed list wrappers');
      }
      events.length = 0;
    };
    const keyedItem = (propertyId: string, itemId: string): Y.Map<unknown> => {
      const wrapper: unknown = propertiesOf('r1').get(propertyId);
      const rows: unknown = wrapper instanceof Y.Map ? wrapper.get('__rows') : undefined;
      const item: unknown = rows instanceof Y.Map ? rows.get(itemId) : undefined;

      if (!(item instanceof Y.Map)) throw new Error('expected keyed list item');
      return item;
    };

    it('captures a leaf-only file rename as the whole detached files list', () => {
      seedLists();
      store.updateBlockData('r1', 'properties', {
        ...base, attachments: [{ ...fileA, name: 'After.txt' }, fileB], related: [{ id: 'q1' }, { id: 'q2' }],
      });

      expect(recordsFor('r1', 'local')).toEqual([{
        blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
        changes: [{
          path: ['properties', 'attachments'], beforePresent: true, afterPresent: true,
          after: [{ ...fileA, name: 'After.txt' }, fileB],
        }],
      }]);
      expect(keyedItem('attachments', 'file-a').get('name')).toBe('After.txt');
    });

    it('captures an order-only relation reorder as the reordered list', () => {
      seedLists();
      store.updateBlockData('r1', 'properties', {
        ...base, attachments: [fileA, fileB], related: [{ id: 'q2' }, { id: 'q1' }],
      });

      expect(recordsFor('r1', 'local')).toEqual([{
        blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
        changes: [{
          path: ['properties', 'related'], beforePresent: true, afterPresent: true,
          after: [{ id: 'q2' }, { id: 'q1' }],
        }],
      }]);
    });

    it('keeps an absent list property apart from a present empty one', () => {
      store.updateBlockData('r1', 'properties', { ...base, related: [] });
      const born = recordsFor('r1', 'local');

      events.length = 0;
      store.updateBlockData('r1', 'properties', base);

      expect(born).toEqual([{
        blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
        changes: [{ path: ['properties', 'related'], beforePresent: false, afterPresent: true, after: [] }],
      }]);
      expect(recordsFor('r1', 'local')).toEqual([{
        blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
        changes: [{ path: ['properties', 'related'], beforePresent: true, afterPresent: false }],
      }]);
    });

    it('refuses to authorize a legacy plain list promoted to a keyed wrapper', () => {
      store.transactWithoutCapture(() => { propertiesOf('r1').set('related', []); });
      events.length = 0;
      store.updateBlockData('r1', 'properties', { ...base, related: [{ id: 'q1' }] });

      expect(recordsFor('r1', 'local')).toEqual([{
        blockId: 'r1', type: 'update', origin: 'local', scope: 'replacement', native: rowIdentity(), changes: [],
      }]);
      expect(serializer.isGridMap(propertiesOf('r1').get('related'))).toBe(true);
    });

    it('refuses a list edit made in the same transaction as a native parent edit', () => {
      seedLists();
      const row = store.getBlockById('r1');

      if (row === undefined) throw new Error('expected native row');
      store.transact(() => {
        keyedItem('attachments', 'file-a').set('name', 'Mixed.txt');
        row.set('parentId', 'another-database');
      }, 'local');

      expect(recordsFor('r1', 'local')).toEqual([{
        blockId: 'r1', type: 'update', origin: 'local', scope: 'unknown',
        native: { ...rowIdentity(), parent: { present: true, value: 'another-database' } }, changes: [],
      }]);
    });

    it('refuses a shared-type replacement under a keyed list wrapper', () => {
      seedLists();
      const wrapper: unknown = propertiesOf('r1').get('attachments');
      const rows: unknown = wrapper instanceof Y.Map ? wrapper.get('__rows') : undefined;

      if (!(rows instanceof Y.Map)) throw new Error('expected keyed list items');
      store.transact(() => {
        rows.set('file-a', serializer.objectToYMap({ ...fileA, name: 'Swapped.txt' }));
      }, 'local');

      expect(recordsFor('r1', 'local')).toEqual([{
        blockId: 'r1', type: 'update', origin: 'local', scope: 'replacement', native: rowIdentity(), changes: [],
      }]);
      expect(serializer.yValueToPlain(wrapper)).toEqual([{ ...fileA, name: 'Swapped.txt' }, fileB]);
    });

    it('does not capture a keyed list edit on a non-row block that looks like a row', () => {
      store.addBlock({
        id: 'lookalike', type: 'paragraph',
        data: { text: 'Not a row', properties: { related: [{ id: 'q1' }, { id: 'q2' }] } },
      });
      const lookalike: unknown = store.getBlockById('lookalike')?.get('data');
      const properties: unknown = lookalike instanceof Y.Map ? lookalike.get('properties') : undefined;

      if (!(properties instanceof Y.Map) || !serializer.isGridMap(properties.get('related'))) {
        throw new Error('expected a keyed list on the lookalike');
      }
      events.length = 0;
      store.updateBlockData('lookalike', 'properties', { related: [{ id: 'q2' }, { id: 'q1' }] });

      expect(recordsFor('lookalike', 'local')).toEqual([{
        blockId: 'lookalike', type: 'update', origin: 'local', scope: 'unknown',
        native: { type: 'paragraph', parent: { present: false }, template: { present: false } }, changes: [],
      }]);
    });

    it('keeps a captured list detached and frozen when the first subscriber mutates it and another awaits', async () => {
      seedLists();
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let retained: unknown;
      let afterAwait: unknown;
      let completion: Promise<void> | undefined;
      const listOf = (record: unknown): unknown => {
        const changes: unknown = typeof record === 'object' && record !== null && 'changes' in record
          ? record.changes : undefined;
        const change: unknown = Array.isArray(changes) ? changes[0] : undefined;

        return typeof change === 'object' && change !== null && 'after' in change ? change.after : undefined;
      };

      observer.onBlocksChanged((event) => {
        if (event.type !== 'update' || event.blockId !== 'r1') return;
        const list = listOf(capturesOf(event)[0]);

        if (!Array.isArray(list)) return;
        try { list.push({ id: 'subscriber' }); } catch {}
        const first: unknown = list[0];

        if (typeof first === 'object' && first !== null) {
          try { Reflect.set(first, 'name', 'Subscriber.txt'); } catch {}
        }
      });
      observer.onBlocksChanged((event) => {
        if (event.type !== 'update' || event.blockId !== 'r1' || retained !== undefined) return;
        retained = capturesOf(event)[0];
        completion = (async () => {
          await gate;
          afterAwait = retained;
        })();
      });

      try {
        store.updateBlockData('r1', 'properties', {
          ...base, attachments: [{ ...fileA, name: 'After.txt' }, fileB], related: [{ id: 'q1' }, { id: 'q2' }],
        });
        store.transact(() => { keyedItem('attachments', 'file-a').set('name', 'Native later.txt'); }, 'local');
        store.removeBlock('r1');
        release?.();
        if (completion !== undefined) await completion;

        expect(afterAwait).toEqual({
          blockId: 'r1', type: 'update', origin: 'local', scope: 'keys', native: rowIdentity(),
          changes: [{
            path: ['properties', 'attachments'], beforePresent: true, afterPresent: true,
            after: [{ ...fileA, name: 'After.txt' }, fileB],
          }],
        });
        const list = listOf(afterAwait);

        expect(Object.isFrozen(list)).toBe(true);
        expect(Array.isArray(list) && list.every((item: unknown) => Object.isFrozen(item))).toBe(true);
        expect(store.getBlockById('r1')).toBeUndefined();
      } finally {
        release?.();
        if (completion !== undefined) await completion;
      }
    });
  });

  it.each([true, false])(
    'captures pre-transaction template=%s identity when the flag is flipped and the native row is removed',
    (beforeTemplate) => {
      store.transactWithoutCapture(() => { dataOf('tpl').set('template', beforeTemplate); });
      events.length = 0;
      store.transact(() => {
        dataOf('tpl').set('template', !beforeTemplate);
        store.removeBlock('tpl');
      }, 'local');

      expect(recordsFor('tpl', 'local')).toEqual([{
        blockId: 'tpl', type: 'remove', origin: 'local', scope: 'keys', native: rowIdentity(beforeTemplate), changes: [],
      }]);
      expect(store.getBlockById('tpl')).toBeUndefined();
    },
  );
});

describe('BlockObserver', () => {
  let observer: BlockObserver;
  let store: DocumentStore;
  let blocksMap: Y.Map<Y.Map<unknown>>;
  let rootOrder: Y.Array<string>;
  let undoManager: Y.UndoManager;

  /**
   * Add root-level paragraph blocks through the real write path
   * (DocumentStore.addBlock), all in one transaction.
   */
  const addBlocks = (ids: string[]): void => {
    store.transact(() => {
      for (const id of ids) {
        store.addBlock({ id, type: 'paragraph', data: {} });
      }
    }, 'local');
  };

  /**
   * Add one block under a parent through the real write path.
   */
  const addChild = (id: string, parent: string): void => {
    store.addBlock({ id, type: 'paragraph', data: {}, parent });
  };

  const moveBlock = (id: string, placement: BlockPlacement): void => {
    store.moveBlockTo(id, placement);
  };

  const removeBlock = (id: string): void => {
    store.removeBlock(id);
  };

  beforeEach(() => {
    observer = createBlockObserver();
    store = new DocumentStore(new YBlockSerializer());
    blocksMap = store.blocksMap;
    rootOrder = store.rootOrder;
    undoManager = new Y.UndoManager(store.undoScope, {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });

    observer.observe({ blocksMap, rootOrder }, undoManager);
  });

  afterEach(() => {
    observer.destroy();
    undoManager.destroy();
    store.destroy();
  });

  describe('initialization', () => {
    it('creates observer without errors', () => {
      expect(observer).toBeDefined();
    });
  });

  describe('onBlocksChanged', () => {
    it('registers callback and returns unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = observer.onBlocksChanged(callback);

      expect(typeof unsubscribe).toBe('function');

      // Trigger an event
      addBlocks(['b1']);

      expect(callback).toHaveBeenCalled();

      // Unsubscribe
      unsubscribe();

      // Reset and trigger again
      callback.mockClear();
      addBlocks(['b2']);

      // Should not be called after unsubscribe
      expect(callback).not.toHaveBeenCalled();
    });

    it('emits add event when block is added', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      addBlocks(['b1']);

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('add');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });

    it('emits remove event when block is removed', () => {
      addBlocks(['b1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      removeBlock('b1');

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('remove');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });

    it('emits move event when block is moved', () => {
      addBlocks(['b1', 'b2']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move block: root-order edit only, the Y.Map stays put
      moveBlock('b1', { parentId: null, afterId: 'b2' });

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('move');
      expect(event.blockId).toBe('b1');
    });

    it('emits update event when block data changes', () => {
      addBlocks(['b1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      store.updateBlockData('b1', 'text', 'Updated');

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('update');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });
  });

  describe('mapTransactionOrigin', () => {
    it('maps "local" origin to "local"', () => {
      expect(observer.mapTransactionOrigin('local')).toBe('local');
    });

    it('maps "load" origin to "load"', () => {
      expect(observer.mapTransactionOrigin('load')).toBe('load');
    });

    it('maps undoManager origin to "undo" when undoing', () => {
      undoManager.undoing = true;
      expect(observer.mapTransactionOrigin(undoManager)).toBe('undo');
      undoManager.undoing = false;
    });

    it('maps undoManager origin to "redo" when not undoing', () => {
      expect(observer.mapTransactionOrigin(undoManager)).toBe('redo');
    });

    it('maps "move" origin to "local"', () => {
      expect(observer.mapTransactionOrigin('move')).toBe('local');
    });

    it('maps "move-undo" origin to "undo"', () => {
      expect(observer.mapTransactionOrigin('move-undo')).toBe('undo');
    });

    it('maps "move-redo" origin to "redo"', () => {
      expect(observer.mapTransactionOrigin('move-redo')).toBe('redo');
    });

    // Regression: 'no-capture' is used by DocumentStore.transactWithoutCapture
    // for local auto-repair writes (e.g. Table.ensureCellHasBlock inserting a
    // placeholder paragraph after Insert Row Below). Before the fix this
    // origin fell through to the `'remote'` default, which made BlockYjsSync
    // call `Table.setData(staleYjsData)` mid-operation and clobbered the
    // just-inserted row, making the row undeletable afterwards.
    it('maps "no-capture" origin to "local"', () => {
      expect(observer.mapTransactionOrigin('no-capture')).toBe('local');
    });

    it('maps unknown origin to "remote"', () => {
      expect(observer.mapTransactionOrigin('unknown')).toBe('remote');
    });

    // A null origin is local only when the transaction shows a yjs format
    // cleanup; with no transaction to inspect it stays remote.
    it('maps a null origin with no transaction to inspect to "remote"', () => {
      expect(observer.mapTransactionOrigin(null)).toBe('remote');
    });

    // Regression guard: every tag in LOCAL_ORIGIN_TAGS must map to a
    // non-'remote' classification. If a future dev adds a new origin string
    // without teaching the mapper, this test fails in CI before the silent
    // `setData(staleYjsData)` clobber bug can reappear. See block-observer.ts
    // and the original table-row-removal regression for context.
    it('maps every LOCAL_ORIGIN_TAGS entry away from "remote"', () => {
      for (const tag of LOCAL_ORIGIN_TAGS) {
        const mapped = observer.mapTransactionOrigin(tag satisfies LocalOriginTag);

        expect(mapped, `tag "${tag}" must not fall through to "remote"`).not.toBe('remote');
      }
    });
  });

  describe('destroy', () => {
    it('clears callbacks and references', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      observer.destroy();

      // Trigger an event after destroy
      addBlocks(['b1']);

      // Callback should not be called after destroy
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('multiple callbacks', () => {
    it('calls all registered callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      observer.onBlocksChanged(callback1);
      observer.onBlocksChanged(callback2);

      addBlocks(['b1']);

      // Both callbacks should be called with the same event
      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();

      // Verify the observable behavior: the document state
      expect(blocksMap.size).toBe(1);
      expect(blocksMap.get('b1')?.get('id')).toBe('b1');
      expect(rootOrder.toArray()).toEqual(['b1']);

      // Verify both callbacks received the same event data
      const event1 = callback1.mock.calls[0]?.[0] as SingleBlockEvent;
      const event2 = callback2.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event1.type).toBe('add');
      expect(event2.type).toBe('add');
      expect(event1.blockId).toBe('b1');
      expect(event2.blockId).toBe('b1');
    });

    it('allows unregistering individual callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const unsubscribe1 = observer.onBlocksChanged(callback1);
      observer.onBlocksChanged(callback2);
      observer.onBlocksChanged(callback3);

      // Unsubscribe callback1
      unsubscribe1();

      addBlocks(['b1']);

      // Verify the observable behavior: the document state
      expect(blocksMap.size).toBe(1);
      expect(blocksMap.get('b1')?.get('id')).toBe('b1');

      // Verify callback registration/unregistration behavior
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
      expect(callback3).toHaveBeenCalled();

      // Verify the remaining callbacks received the correct event data
      const event2 = callback2.mock.calls[0]?.[0] as SingleBlockEvent;
      const event3 = callback3.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event2.type).toBe('add');
      expect(event3.type).toBe('add');
      expect(event2.blockId).toBe('b1');
      expect(event3.blockId).toBe('b1');
    });
  });

  describe('move detection edge cases', () => {
    it('emits move event for an order-array edit whose id was not added or removed', () => {
      addBlocks(['b1', 'b2', 'b3']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      moveBlock('b3', { parentId: null, afterId: null });

      const moveEvent = callback.mock.calls.find(
        (call) => (call[0] as BlockChangeEvent)?.type === 'move'
      )?.[0] as SingleBlockEvent;

      expect(moveEvent).toBeDefined();
      expect(moveEvent.type).toBe('move');
      expect(moveEvent.blockId).toBe('b3');
    });

    it('correctly handles multiple moves in a single transaction', () => {
      addBlocks(['b1', 'b2', 'b3', 'b4', 'b5']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move multiple blocks in one transaction
      store.transact(() => {
        store.moveBlockTo('b5', { parentId: null, afterId: null });
        store.moveBlockTo('b4', { parentId: null, afterId: 'b5' });
      }, 'local');

      const moveEvents = callback.mock.calls.filter(
        (call) => (call[0] as BlockChangeEvent)?.type === 'move'
      );

      // Should have 2 move events
      expect(moveEvents.length).toBe(2);
    });

    it('emits both move and pure add/remove in same transaction', () => {
      addBlocks(['b1', 'b2', 'b3']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move b3, add b4, remove b2 — one transaction
      store.transact(() => {
        store.moveBlockTo('b3', { parentId: null, afterId: null });
        store.addBlock({ id: 'b4', type: 'paragraph', data: {} });
        store.removeBlock('b2');
      }, 'local');

      const events = callback.mock.calls.map((call) => call[0] as BlockChangeEvent);
      const types = events.map((e) => e.type);

      // Should have move, add, and remove events
      expect(types).toContain('move');
      expect(types).toContain('add');
      expect(types).toContain('remove');

      // The moved id must not surface as an add or a remove
      const moveIds = events
        .filter((e): e is SingleBlockEvent => e.type === 'move')
        .map((e) => e.blockId);

      expect(moveIds).toEqual(['b3']);
    });

    it('emits move for an in-place contentIds reorder', () => {
      addBlocks(['parent-1']);
      addChild('child-a', 'parent-1');
      addChild('child-b', 'parent-1');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Reorder within the parent: child-b goes first.
      moveBlock('child-b', { parentId: 'parent-1', afterId: null });

      const moveEvents = callback.mock.calls
        .map((call) => call[0] as BlockChangeEvent)
        .filter((event): event is SingleBlockEvent => event.type === 'move');

      expect(moveEvents.map((event) => event.blockId)).toEqual(['child-b']);
    });
  });

  describe('top-level yblock key updates', () => {
    it('emits a remote update when a peer reparents the block (parentId key write)', () => {
      addBlocks(['callout-1', 'child-1']);

      // Second peer receives the doc through the binary seam, reparents
      // child-1, and its diff comes back as ONE remote transaction.
      const mirror = new DocumentStore(new YBlockSerializer());

      mirror.applyRemoteUpdate(store.encodeStateAsUpdate());

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      mirror.applyPlacement('child-1', { parentId: 'callout-1', afterId: null }, 'local');
      store.applyRemoteUpdate(mirror.encodeStateAsUpdate(store.getStateVector()));
      mirror.destroy();

      const updateEvents = callback.mock.calls
        .map((call) => call[0] as BlockChangeEvent)
        .filter((event): event is SingleBlockEvent => event.type === 'update');

      const childUpdate = updateEvents.find((event) => event.blockId === 'child-1');

      expect(childUpdate).toBeDefined();
      expect(childUpdate?.origin).toBe('remote');
    });

    /**
     * The v1 serializer never writes a Y.Text, but a foreign or future-format
     * client can put one under a block's data and its DELTA events target the
     * Y.Text itself. Dropping those leaves the doc and the DOM silently
     * diverged — the Phase-0 blind-spot class. The walk only needs `.parent`,
     * so any shared type must be a legal starting node.
     */
    it('emits a remote update when a peer edits a Y.Text nested under block data', () => {
      const foreign = new Y.Doc();

      foreign.transact(() => {
        const block = new Y.Map<unknown>();
        const data = new Y.Map<unknown>();

        data.set('text', new Y.Text('hello'));
        block.set('id', 'yt-1');
        block.set('type', 'paragraph');
        block.set('data', data);
        foreign.getMap<Y.Map<unknown>>('blocks').set('yt-1', block);
        foreign.getArray<string>('root').push(['yt-1']);
      });
      store.applyRemoteUpdate(Y.encodeStateAsUpdate(foreign));

      const callback = vi.fn();

      observer.onBlocksChanged(callback);

      const data = foreign.getMap<Y.Map<unknown>>('blocks').get('yt-1')?.get('data') as Y.Map<unknown>;

      (data.get('text') as Y.Text).insert(5, ' world');
      store.applyRemoteUpdate(Y.encodeStateAsUpdate(foreign, store.getStateVector()));
      foreign.destroy();

      const updateEvents = callback.mock.calls
        .map((call) => call[0] as BlockChangeEvent)
        .filter((event): event is SingleBlockEvent => event.type === 'update');
      const textUpdate = updateEvents.find((event) => event.blockId === 'yt-1');

      expect(textUpdate).toBeDefined();
      expect(textUpdate?.origin).toBe('remote');
    });

    it('emits update event when the contentIds KEY is overwritten on the yblock', () => {
      addBlocks(['toggle-1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // A raw key overwrite (plain-array contentIds) cannot be produced by
      // the store API — this pins the classification of hostile/legacy
      // shapes: a key change on the block map is an update for that block.
      store.transact(() => {
        blocksMap.get('toggle-1')?.set('contentIds', ['child-a', 'child-b']);
      }, 'local');

      const updateEvents = callback.mock.calls
        .map((call) => call[0] as BlockChangeEvent)
        .filter((event) => event.type === 'update');

      expect(updateEvents.length).toBeGreaterThanOrEqual(1);
      const event = updateEvents[0] as SingleBlockEvent;

      expect(event.blockId).toBe('toggle-1');
    });
  });

  describe('formatted rich text (Y.XmlText) events', () => {
    const SENTENCE = 'The quick brown fox jumps';

    /** A peer of `store`, holding its paragraph `p1`, with a fixed client id. */
    const peerWithParagraph = (ownId: number, peerId: number): DocumentStore => {
      const doc = store.blocksMap.doc;

      if (doc !== null) {
        doc.clientID = ownId;
      }
      store.addBlock({ id: 'p1', type: 'paragraph', data: { text: SENTENCE } });

      const peer = new DocumentStore(new YBlockSerializer());
      const peerDoc = peer.blocksMap.doc;

      if (peerDoc !== null) {
        peerDoc.clientID = peerId;
      }
      peer.applyRemoteUpdate(store.encodeStateAsUpdate());

      return peer;
    };

    const eventsFor = (callback: ReturnType<typeof vi.fn>, id: string): Array<{ type: string; origin: string }> =>
      callback.mock.calls
        .map((call) => call[0] as BlockChangeEvent)
        .filter((event): event is SingleBlockEvent => 'blockId' in event && event.blockId === id)
        .map((event) => ({ type: event.type, origin: event.origin }));

    it('mints the paragraph text as a Y.XmlText (the class these cases exercise)', () => {
      const peer = peerWithParagraph(1, 2);

      expect((blocksMap.get('p1')?.get('data') as Y.Map<unknown>).get('text')).toBeInstanceOf(Y.XmlText);
      peer.destroy();
    });

    it('emits a remote update for a peer\'s attributes-only format', () => {
      const peer = peerWithParagraph(1, 2);
      const callback = vi.fn();

      observer.onBlocksChanged(callback);
      peer.updateBlockData('p1', 'text', 'The <b>quick</b> brown fox jumps');
      store.applyRemoteUpdate(peer.encodeStateAsUpdate(store.getStateVector()));
      peer.destroy();

      expect(eventsFor(callback, 'p1')).toEqual([{ type: 'update', origin: 'remote' }]);
    });

    it('emits a remote update for a peer\'s embed insert', () => {
      const peer = peerWithParagraph(1, 2);
      const callback = vi.fn();
      const text = (peer.getBlockById('p1')?.get('data') as Y.Map<unknown>).get('text') as Y.XmlText;

      observer.onBlocksChanged(callback);
      peer.transact(() => text.insertEmbed(3, { equation: { expression: 'x' } }, {}), 'local');
      store.applyRemoteUpdate(peer.encodeStateAsUpdate(store.getStateVector()));
      peer.destroy();

      expect(eventsFor(callback, 'p1')).toEqual([{ type: 'update', origin: 'remote' }]);
    });

    it.each([
      [1, 2],
      [2, 1],
    ])('classifies the format cleanup after a peer deletes a range this editor bolded as local (ids %i/%i)', (ownId, peerId) => {
      const peer = peerWithParagraph(ownId, peerId);
      const callback = vi.fn();
      const doc = store.blocksMap.doc;
      const cleanups: number[] = [];

      doc?.on('afterTransaction', (transaction: Y.Transaction) => {
        if (transaction.origin === null && transaction.changed.size > 0) {
          cleanups.push(transaction.changed.size);
        }
      });

      store.updateBlockData('p1', 'text', 'The q<b>uic</b>k brown fox jumps');
      peer.updateBlockData('p1', 'text', 'The  fox jumps');
      observer.onBlocksChanged(callback);
      store.applyRemoteUpdate(peer.encodeStateAsUpdate(store.getStateVector()));
      peer.destroy();

      expect(eventsFor(callback, 'p1')).toEqual([
        { type: 'update', origin: 'remote' },
        { type: 'update', origin: 'local' },
      ]);
      // Guard: yjs really ran a cleanup that changed the text.
      expect(cleanups).toHaveLength(1);
    });

    // A null origin is local only for yjs's cleanup: no inserts, format deletes
    // only. Any other null-origin write must still re-render.
    it('classifies a bare text insert outside any transaction (null origin) as remote', () => {
      const peer = peerWithParagraph(1, 2);
      const callback = vi.fn();
      const text = (blocksMap.get('p1')?.get('data') as Y.Map<unknown>).get('text') as Y.XmlText;

      peer.destroy();
      observer.onBlocksChanged(callback);
      text.insert(0, 'X');

      expect(eventsFor(callback, 'p1')).toEqual([{ type: 'update', origin: 'remote' }]);
    });

    it('classifies a null-origin delete of a non-format item as remote', () => {
      const peer = peerWithParagraph(1, 2);
      const callback = vi.fn();
      const data = blocksMap.get('p1')?.get('data') as Y.Map<unknown>;

      peer.destroy();
      store.transact(() => data.set('extra', 1), 'local');
      observer.onBlocksChanged(callback);
      data.doc?.transact(() => data.delete('extra'));

      expect(eventsFor(callback, 'p1')).toEqual([{ type: 'update', origin: 'remote' }]);
    });

    it('classifies a null-origin text delete as remote', () => {
      const peer = peerWithParagraph(1, 2);
      const callback = vi.fn();
      const text = (blocksMap.get('p1')?.get('data') as Y.Map<unknown>).get('text') as Y.XmlText;

      peer.destroy();
      observer.onBlocksChanged(callback);
      text.delete(0, 4);

      expect(eventsFor(callback, 'p1')).toEqual([{ type: 'update', origin: 'remote' }]);
    });
  });

  describe('nested map updates', () => {
    it('emits update event when tunes change', () => {
      addBlocks(['b1']);

      store.updateBlockTune('b1', 'alignment', 'left');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      store.updateBlockTune('b1', 'alignment', 'center');

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event.type).toBe('update');
      expect(event.blockId).toBe('b1');
    });
  });

  describe('owning-block resolution', () => {
    it('finds the owning block for a nested data map', () => {
      addBlocks(['b1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      store.updateBlockData('b1', 'text', 'Updated');

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event.blockId).toBe('b1');
    });
  });

  describe('batch-add events', () => {
    it('emits batch-add when multiple blocks are added in a single transaction', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      store.transact(() => {
        store.addBlock({ id: 'table-1', type: 'paragraph', data: {} });
        store.addBlock({ id: 'child-1', type: 'paragraph', data: {}, parent: 'table-1' });
        store.addBlock({ id: 'child-2', type: 'paragraph', data: {}, parent: 'table-1' });
      }, 'local');

      // Should emit a single batch-add event instead of individual add events
      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0]?.[0] as BatchBlockEvent;
      expect(event.type).toBe('batch-add');
      expect(event.blockIds).toEqual(['table-1', 'child-1', 'child-2']);
    });

    it('emits regular add for a single block', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      addBlocks(['single-1']);

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event.type).toBe('add');
      expect(event.blockId).toBe('single-1');
    });
  });

  describe('edge cases', () => {
    it('handles a block value without an id field during remove (the key IS the id)', () => {
      // Store a block whose VALUE carries no 'id' key — a shape the store
      // API cannot produce (hostile/legacy payload); the map key names it.
      store.transact(() => {
        const bare = new Y.Map<unknown>();

        bare.set('type', 'paragraph');
        bare.set('data', new Y.Map<unknown>());
        blocksMap.set('keyed-block', bare);
        rootOrder.push(['keyed-block']);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Remove the block - should not throw
      expect(() => {
        removeBlock('keyed-block');
      }).not.toThrow();

      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;

      expect(event.type).toBe('remove');
      expect(event.blockId).toBe('keyed-block');
    });

    it('emits remove with correct data after deletion', () => {
      addBlocks(['b1']);

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Verify initial state - block exists
      expect(blocksMap.size).toBe(1);
      expect(blocksMap.get('b1')?.get('id')).toBe('b1');

      // Delete should work without errors
      removeBlock('b1');

      // Verify observable behavior: the document state after deletion
      expect(blocksMap.size).toBe(0);
      expect(rootOrder.length).toBe(0);

      // Verify the event was emitted with correct data
      expect(callback).toHaveBeenCalled();
      const event = callback.mock.calls[0]?.[0] as SingleBlockEvent;
      expect(event.type).toBe('remove');
      expect(event.blockId).toBe('b1');
    });

    it('does not emit update for changes to unrelated maps', () => {
      // Create a separate unrelated Y.Map (never integrated into the doc)
      const unrelatedMap = new Y.Map<unknown>();
      unrelatedMap.set('key', 'value');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Modify unrelated map - should not trigger callback
      store.transact(() => {
        unrelatedMap.set('key', 'updated');
      }, 'local');

      expect(callback).not.toHaveBeenCalled();
    });

    it('handles rapid successive changes without errors', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Rapid changes
      for (let i = 0; i < 10; i++) {
        addBlocks([`b${i}`]);
      }

      // Verify observable behavior: the document state after all changes
      expect(blocksMap.size).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(blocksMap.get(`b${i}`)?.get('id')).toBe(`b${i}`);
      }
      expect(rootOrder.toArray()).toEqual(
        Array.from({ length: 10 }, (_, i) => `b${i}`)
      );

      // Verify all events were emitted with correct data
      expect(callback).toHaveBeenCalledTimes(10);
      const eventTypes = callback.mock.calls.map((call) => (call[0] as BlockChangeEvent).type);
      expect(eventTypes.every((type) => type === 'add')).toBe(true);

      // Verify specific events contain correct block IDs
      const blockIds = callback.mock.calls.map((call) => {
        const event = call[0] as BlockChangeEvent;

        return event.type === 'batch-add' ? event.blockIds : [event.blockId];
      }).flat();

      for (let i = 0; i < 10; i++) {
        expect(blockIds).toContain(`b${i}`);
      }
    });
  });
});

/**
 * Emission-order CONTRACT (Task 3a pin): within ONE transaction the observer
 * emits moves → add/batch-add → removes → updates, regardless of which root
 * (blocks map or root order) each change came through. The reconciler relies
 * on this so the DOM can reposition before other changes land.
 *
 * Fixtures are built through DocumentStore APIs so the writes are the real
 * write shapes, not hand-rolled pushes.
 */
describe('BlockObserver — emission order contract', () => {
  let observer: BlockObserver;
  let store: DocumentStore;
  let undoManager: Y.UndoManager;
  let events: BlockChangeEvent[];

  const eventTypes = (): string[] => events.map((event) => event.type);

  const singleIds = (type: 'add' | 'remove' | 'update' | 'move'): string[] =>
    events
      .filter((event): event is Extract<BlockChangeEvent, { blockId: string }> => event.type === type)
      .map((event) => event.blockId);

  beforeEach(() => {
    observer = new BlockObserver();
    store = new DocumentStore(new YBlockSerializer());
    undoManager = new Y.UndoManager(store.undoScope, {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });

    observer.observe(
      { blocksMap: store.blocksMap, rootOrder: store.rootOrder },
      undoManager
    );

    events = [];
  });

  afterEach(() => {
    observer.destroy();
    undoManager.destroy();
    store.destroy();
  });

  const collectEvents = (): void => {
    observer.onBlocksChanged((event) => events.push(event));
  };

  it('emits moves → add → removes → updates for one transaction touching all four', () => {
    store.fromJSON([
      { id: 'b1', type: 'paragraph', data: { text: '1' } },
      { id: 'b2', type: 'paragraph', data: { text: '2' } },
      { id: 'b3', type: 'paragraph', data: { text: '3' } },
      { id: 'b4', type: 'paragraph', data: { text: '4' } },
    ]);
    collectEvents();

    store.transact(() => {
      store.moveBlockTo('b4', { parentId: null, afterId: null });
      store.addBlock({ id: 'b5', type: 'paragraph', data: { text: '5' } });
      store.removeBlock('b2');
      store.updateBlockData('b3', 'text', 'changed');
    }, 'local');

    expect(eventTypes()).toEqual(['move', 'add', 'remove', 'update']);
    expect(singleIds('move')).toEqual(['b4']);
    expect(singleIds('add')).toEqual(['b5']);
    expect(singleIds('remove')).toEqual(['b2']);
    expect(singleIds('update')).toEqual(['b3']);
  });

  it('emits the root-order move BEFORE the blocks-map add when both land in the SAME transaction', () => {
    store.fromJSON([
      { id: 'parent-1', type: 'paragraph', data: { text: 'p' } },
      { id: 'b1', type: 'paragraph', data: { text: '1' } },
      { id: 'b2', type: 'paragraph', data: { text: '2' } },
    ]);
    collectEvents();

    store.transact(() => {
      // Move comes from the ROOT ORDER array …
      store.moveBlockTo('b2', { parentId: null, afterId: null });
      // … while the add's membership goes into a parent's contentIds, so the
      // add is visible only through the blocks map.
      store.addBlock({ id: 'child-1', type: 'paragraph', data: { text: 'c' }, parent: 'parent-1' });
      // An explicit data write is what makes the parent an 'update' now:
      // contentIds arrays are created WITH the block Y.Map, so a first child
      // inserts into the existing array instead of overwriting the key.
      store.updateBlockData('parent-1', 'text', 'edited');
    }, 'local');

    expect(singleIds('move')).toEqual(['b2']);
    expect(singleIds('add')).toEqual(['child-1']);
    // … and the update must still come AFTER the cross-dispatch move and add.
    expect(singleIds('update')).toEqual(['parent-1']);
    expect(eventTypes()).toEqual(['move', 'add', 'update']);
  });

  it('holds for root + contentIds moves, batch adds, removes, and updates combined', () => {
    store.fromJSON([
      { id: 'p1', type: 'paragraph', data: { text: 'p1' } },
      { id: 'p2', type: 'paragraph', data: { text: 'p2' } },
      { id: 'parent-1', type: 'paragraph', data: { text: 'p' }, content: ['c1', 'c2'] },
      { id: 'c1', type: 'paragraph', data: { text: 'c1' }, parent: 'parent-1' },
      { id: 'c2', type: 'paragraph', data: { text: 'c2' }, parent: 'parent-1' },
    ]);
    collectEvents();

    store.transact(() => {
      // contentIds-array move: swap c1 after c2.
      store.moveBlockTo('c1', { parentId: 'parent-1', afterId: 'c2' });
      // Root-order move.
      store.moveBlockTo('p2', { parentId: null, afterId: null });
      // Two adds in one transaction → batch-add.
      store.addBlock({ id: 'n1', type: 'paragraph', data: { text: 'n1' } });
      store.addBlock({ id: 'n2', type: 'paragraph', data: { text: 'n2' } });
      store.removeBlock('p1');
      store.updateBlockData('c2', 'text', 'edited');
    }, 'local');

    expect(eventTypes()).toEqual(['move', 'move', 'batch-add', 'remove', 'update']);
    expect(new Set(singleIds('move'))).toEqual(new Set(['c1', 'p2']));
    expect(singleIds('remove')).toEqual(['p1']);
    expect(singleIds('update')).toEqual(['c2']);

    const batch = events.find(
      (event): event is Extract<BlockChangeEvent, { blockIds: string[] }> => event.type === 'batch-add'
    );

    expect(batch?.blockIds).toEqual(['n1', 'n2']);
  });
});

describe('Cross-parent replay relocation receipt', () => {
  let observer: BlockObserver;
  let serializer: YBlockSerializer;
  let store: DocumentStore;
  let peer: DocumentStore | undefined;
  let undoManager: Y.UndoManager;
  let events: BlockChangeEvent[];

  const blockOf = (id: string): Y.Map<unknown> => {
    const block = store.getBlockById(id);

    if (block === undefined) throw new Error(`expected block ${id}`);
    return block;
  };
  const dataOf = (id: string): Y.Map<unknown> => {
    const data: unknown = blockOf(id).get('data');

    if (!(data instanceof Y.Map)) throw new Error('expected native data');
    return data;
  };
  const propertiesOf = (id: string): Y.Map<unknown> => {
    const properties: unknown = dataOf(id).get('properties');

    if (!(properties instanceof Y.Map)) throw new Error('expected native properties');
    return properties;
  };
  const orderOf = (id: string): Y.Array<unknown> => {
    const order: unknown = blockOf(id).get('contentIds');

    if (!(order instanceof Y.Array)) throw new Error('expected native contentIds');
    return order;
  };
  const removeFrom = (id: string, rowId: string): void => {
    const index = orderOf(id).toArray().indexOf(rowId);

    if (index === -1) throw new Error(`expected ${rowId} in ${id}`);
    orderOf(id).delete(index, 1);
  };
  const rowCaptures = (origin: string): BlockReplayCapture[] =>
    events.filter((event) => event.origin === origin)
      .flatMap((event) => ('captures' in event ? event.captures ?? [] : []))
      .filter((capture) => capture.blockId === 'r1');
  const rowNative = (parent: string) => ({
    type: 'database-row',
    parent: { present: true, value: parent },
    template: { present: false },
  });
  const withOwnProto = (properties: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...properties };

    Object.defineProperty(result, '__proto__', { value: 'own', enumerable: true, writable: true, configurable: true });
    return result;
  };
  const commonProperties = { t: 'Alpha', flag: false, zero: 0, empty: '', nullable: null };
  const expectNoRelocation = (origin: string): void => {
    const captures = rowCaptures(origin);

    expect(captures.length).toBeGreaterThan(0);
    expect(captures.every((capture) => !('relocation' in capture))).toBe(true);
  };
  const startRecording = (): void => {
    undoManager.clear();
    events.length = 0;
  };
  /** One tracked transaction: rename a key, move position, and reparent r1 from db to db2. */
  const moveForward = (extra?: () => void): void => {
    store.transact(() => {
      propertiesOf('r1').delete('notes');
      propertiesOf('r1').set('n2', 'short');
      dataOf('r1').set('position', 'b0');
      store.applyPlacement('r1', { parentId: 'db2', afterId: 'q1' }, 'local');
      extra?.();
    }, 'local');
    undoManager.stopCapturing();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    serializer = new YBlockSerializer();
    store = new DocumentStore(serializer);
    store.fromJSON([
      { id: 'db', type: 'database', data: {}, content: ['r1', 'r2'] },
      { id: 'r1', type: 'database-row', parent: 'db', data: {
        properties: { ...commonProperties, notes: 'short' }, position: 'a0',
      } },
      { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Bravo' }, position: 'a1' } },
      { id: 'db2', type: 'database', data: {}, content: ['q1'] },
      { id: 'q1', type: 'database-row', parent: 'db2', data: { properties: { name: 'Q' }, position: 'a0' } },
      { id: 'db3', type: 'database', data: {}, content: [] },
    ]);
    undoManager = new Y.UndoManager(store.undoScope, { trackedOrigins: new Set(['local']) });
    observer = createBlockObserver();
    observer.observe({ blocksMap: store.blocksMap, rootOrder: store.rootOrder }, undoManager);
    events = [];
    observer.onBlocksChanged((event) => { events.push(event); });
    store.transact(() => { propertiesOf('r1').set('__proto__', 'own'); }, 'local');
    peer = undefined;
  });

  afterEach(() => {
    observer.destroy();
    peer?.destroy();
    undoManager.destroy();
    store.destroy();
    vi.restoreAllMocks();
  });

  it('hands undo and redo of a cross-parent row move a complete detached receipt', () => {
    startRecording();
    moveForward();
    events.length = 0;
    undoManager.undo();
    const undone = rowCaptures('undo');

    expect(undone).toEqual([expect.objectContaining({
      relocation: {
        before: rowNative('db2'),
        after: rowNative('db'),
        row: { properties: withOwnProto({ ...commonProperties, notes: 'short' }), position: 'a0' },
      },
    })]);
    expect(undone[0]).toEqual(expect.objectContaining({
      blockId: 'r1', type: 'update', origin: 'undo', scope: 'unknown', native: rowNative('db'), changes: [],
    }));
    const undoProperties = undone[0]?.relocation?.row.properties;

    expect(undoProperties !== undefined && Object.hasOwn(undoProperties, '__proto__') &&
      Object.getPrototypeOf(undoProperties) === Object.prototype).toBe(true);
    events.length = 0;
    undoManager.redo();

    expect(rowCaptures('redo')).toEqual([expect.objectContaining({
      blockId: 'r1', type: 'update', origin: 'redo', scope: 'unknown', native: rowNative('db2'), changes: [],
      relocation: {
        before: rowNative('db'),
        after: rowNative('db2'),
        row: { properties: withOwnProto({ ...commonProperties, n2: 'short' }), position: 'b0' },
      },
    })]);
  });

  it.each(['rewrites', 'deletes'] as const)(
    'keeps the receipt detached and frozen when the first move subscriber %s the row',
    (action) => {
      let retained: BlockReplayCapture | undefined;

      startRecording();
      moveForward();
      observer.destroy();
      observer = createBlockObserver();
      observer.observe({ blocksMap: store.blocksMap, rootOrder: store.rootOrder }, undoManager);
      observer.onBlocksChanged((event) => {
        if (event.type === 'move' && event.blockId === 'r1' && event.origin === 'undo') {
          store.transactWithoutCapture(() => {
            if (action === 'deletes') store.blocksMap.delete('r1');
            else propertiesOf('r1').set('t', 'rewritten');
          });
        }
        const properties = event.type === 'update' && event.blockId === 'r1'
          ? event.captures?.[0]?.relocation?.row.properties : undefined;

        if (properties !== undefined) {
          try { Reflect.set(properties, 't', 'subscriber corruption'); } catch {}
        }
      });
      observer.onBlocksChanged((event) => {
        if (event.type === 'update' && event.blockId === 'r1' && event.origin === 'undo') retained = event.captures?.[0];
      });
      undoManager.undo();

      const relocation = retained?.relocation;

      expect(relocation).toEqual({
        before: rowNative('db2'),
        after: rowNative('db'),
        row: { properties: withOwnProto({ ...commonProperties, notes: 'short' }), position: 'a0' },
      });
      expect(relocation !== undefined && [
        relocation, relocation.before, relocation.after, relocation.row, relocation.row.properties,
      ].every((part) => Object.isFrozen(part))).toBe(true);
    },
  );

  it.each([
    { caseName: 'bare parent change', forward: (): void => {
      store.transact(() => { blockOf('r1').set('parentId', 'db2'); }, 'local');
    } },
    { caseName: 'parent and removal only', forward: (): void => {
      store.transact(() => { blockOf('r1').set('parentId', 'db2'); removeFrom('db', 'r1'); }, 'local');
    } },
    { caseName: 'parent and insertion only', forward: (): void => {
      store.transact(() => { blockOf('r1').set('parentId', 'db2'); orderOf('db2').push(['r1']); }, 'local');
    } },
    { caseName: 'removal from the wrong owner', forward: (): void => {
      store.transact(() => {
        blockOf('r1').set('parentId', 'db2');
        removeFrom('db', 'r1');
        orderOf('db3').push(['r1']);
      }, 'local');
    } },
    { caseName: 'insertion into the wrong owner', seed: (): void => {
      store.transactWithoutCapture(() => { orderOf('db3').push(['r1']); });
    }, forward: (): void => {
      store.transact(() => {
        blockOf('r1').set('parentId', 'db2');
        removeFrom('db3', 'r1');
        orderOf('db2').push(['r1']);
      }, 'local');
    } },
    { caseName: 'owner replaced', forward: (): void => moveForward(() => {
      store.blocksMap.set('db2', serializer.outputDataToYBlock({ id: 'db2', type: 'database', data: {}, content: ['q1', 'r1'] }));
    }) },
    { caseName: 'owner deleted', forward: (): void => moveForward(() => { store.blocksMap.delete('db3'); store.blocksMap.delete('db'); }) },
    { caseName: 'owner retyped', forward: (): void => moveForward(() => { blockOf('db').set('type', 'paragraph'); }) },
    { caseName: 'contentIds array replaced', forward: (): void => moveForward(() => {
      blockOf('db2').set('contentIds', Y.Array.from(['q1', 'r1']));
    }) },
    { caseName: 'row type changed', forward: (): void => moveForward(() => { blockOf('r1').set('type', 'paragraph'); }) },
    { caseName: 'row template changed', forward: (): void => moveForward(() => { dataOf('r1').set('template', true); }) },
    { caseName: 'whole block replaced', forward: (): void => moveForward(() => {
      store.blocksMap.set('r1', serializer.outputDataToYBlock({
        id: 'r1', type: 'database-row', parent: 'db2', data: { properties: { t: 'Alpha' }, position: 'b0' },
      }));
    }) },
    { caseName: 'data replaced', forward: (): void => moveForward(() => {
      blockOf('r1').set('data', serializer.objectToYMap({ properties: { t: 'Alpha' }, position: 'b0' }));
    }) },
    { caseName: 'properties replaced', forward: (): void => moveForward(() => {
      dataOf('r1').set('properties', serializer.objectToYMap({ t: 'Alpha' }));
    }) },
  ])('gives no receipt for $caseName', ({ seed, forward }) => {
    seed?.();
    startRecording();
    forward();
    events.length = 0;
    undoManager.undo();

    expectNoRelocation('undo');
  });

  it('gives no receipt when evidence is split across replay transactions', () => {
    startRecording();
    store.transact(() => {
      blockOf('r1').set('parentId', 'db2');
      orderOf('db2').push(['r1']);
    }, 'local');
    undoManager.stopCapturing();
    store.transact(() => { removeFrom('db', 'r1'); }, 'local');
    undoManager.stopCapturing();
    events.length = 0;
    undoManager.undo();
    undoManager.undo();

    expectNoRelocation('undo');
  });

  it('undoes without throwing when a peer wrote a non-map at an owner id', () => {
    startRecording();
    moveForward();
    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(store.encodeStateAsUpdate());
    const remote = peer;
    const remoteBlocks = remote.blocksMap as unknown as Y.Map<unknown>;

    remote.transact(() => { remoteBlocks.set('db', 'garbage'); }, 'local');
    store.applyRemoteUpdate(remote.encodeStateAsUpdate(store.getStateVector()));
    events.length = 0;

    expect(() => undoManager.undo()).not.toThrow();
    expect(rowCaptures('undo').every((capture) => !('relocation' in capture))).toBe(true);
  });

  it('gives no receipt for a remote update applied with the manager object as origin', () => {
    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(store.encodeStateAsUpdate());
    const remote = peer;

    remote.transact(() => {
      remote.applyPlacement('r1', { parentId: 'db2', afterId: 'q1' }, 'local');
    }, 'local');
    events.length = 0;
    store.applyRemoteUpdate(remote.encodeStateAsUpdate(store.getStateVector()), undoManager);

    expectNoRelocation('redo');
  });

  it.each(['move-undo', 'move-redo'] as const)('gives no receipt for a local placement tagged %s', (tag) => {
    events.length = 0;
    store.transact(() => {
      propertiesOf('r1').set('n2', 'short');
      store.applyPlacement('r1', { parentId: 'db2', afterId: 'q1' }, tag);
    }, tag);

    expectNoRelocation(tag === 'move-undo' ? 'undo' : 'redo');
  });

  it.each([
    { caseName: 'plain object', value: (): unknown => ({ a: 1 }) },
    { caseName: 'array', value: (): unknown => [1] },
    { caseName: 'Y.Doc', value: (): unknown => new Y.Doc() },
    { caseName: 'Y.Text', value: (): unknown => new Y.Text('x') },
    { caseName: 'NaN', value: (): unknown => Number.NaN },
    { caseName: 'Infinity', value: (): unknown => Number.POSITIVE_INFINITY },
    { caseName: 'undefined', value: (): unknown => undefined },
  ])('gives no receipt for an unchanged $caseName property', ({ value }) => {
    store.transactWithoutCapture(() => { propertiesOf('r1').set('bad', value()); });
    startRecording();
    moveForward();
    events.length = 0;
    undoManager.undo();

    expectNoRelocation('undo');
  });
});

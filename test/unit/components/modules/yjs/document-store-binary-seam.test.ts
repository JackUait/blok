import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as Y from 'yjs';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import { LOCAL_ORIGIN_TAGS, type BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

const createStore = (): DocumentStore => {
  return new DocumentStore(new YBlockSerializer());
};

const createMockBlok = (): BlokModules => {
  const blockManager = {
    currentBlock: undefined,
    getBlockById: vi.fn(),
    getBlockByChildNode: vi.fn(),
    firstBlock: undefined,
  };

  const caret = {
    setToBlock: vi.fn(),
    setToInput: vi.fn(),
    positions: {
      START: 'start',
      DEFAULT: 'default',
    },
  };

  return {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    Caret: caret as unknown as BlokModules['Caret'],
  } as unknown as BlokModules;
};

const paragraph = (id: string, text: string): { id: string; type: string; data: { text: string } } => ({
  id,
  type: 'paragraph',
  data: { text },
});

describe('DocumentStore binary provider seam', () => {
  let storeA: DocumentStore;
  let storeB: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    storeA = createStore();
    storeB = createStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('state-vector round-trip', () => {
    it('converges an empty peer through encodeStateAsUpdate(peer state vector)', () => {
      storeA.addBlock(paragraph('a1', 'Hello'));
      storeA.addBlock({ id: 'a2', type: 'header', data: { text: 'Title', level: 2 } });
      storeA.updateBlockData('a1', 'text', 'Hello world');

      const stateVector = storeB.getStateVector();

      expect(stateVector).toBeInstanceOf(Uint8Array);

      const diff = storeA.encodeStateAsUpdate(stateVector);

      expect(diff).toBeInstanceOf(Uint8Array);

      storeB.applyRemoteUpdate(diff);

      expect(storeB.toJSON()).toEqual(storeA.toJSON());
      expect(storeB.toJSON().map((block) => block.id)).toEqual(['a1', 'a2']);
    });

    it('converges both stores after a two-way diff exchange', () => {
      storeA.addBlock(paragraph('a1', 'From A'));
      storeB.addBlock(paragraph('b1', 'From B'));

      const updateForB = storeA.encodeStateAsUpdate(storeB.getStateVector());
      const updateForA = storeB.encodeStateAsUpdate(storeA.getStateVector());

      storeB.applyRemoteUpdate(updateForB);
      storeA.applyRemoteUpdate(updateForA);

      expect(storeA.toJSON()).toEqual(storeB.toJSON());

      const ids = storeA.toJSON().map((block) => block.id);

      expect(ids).toHaveLength(2);
      expect(ids).toContain('a1');
      expect(ids).toContain('b1');
    });

    it('encodeStateAsUpdate without a state vector encodes the full document', () => {
      storeA.addBlock(paragraph('a1', 'Hello'));

      storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate());

      expect(storeB.toJSON()).toEqual(storeA.toJSON());
    });
  });

  describe('observer classification', () => {
    let history: UndoHistory;
    let observer: BlockObserver;
    let events: BlockChangeEvent[];

    beforeEach(() => {
      history = new UndoHistory(storeB.undoScope, createMockBlok());
      observer = new BlockObserver();
      observer.observe(
        { blocksMap: storeB.blocksMap, rootOrder: storeB.rootOrder },
        history.undoManager
      );
      events = [];
      observer.onBlocksChanged((event) => events.push(event));
    });

    afterEach(() => {
      observer.destroy();
      history.destroy();
    });

    it('classifies a seam-applied transaction as remote (default origin)', () => {
      storeA.addBlock(paragraph('a1', 'Hello'));

      storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate(storeB.getStateVector()));

      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.origin === 'remote')).toBe(true);
      expect(events.some((event) => event.type === 'add' && event.blockId === 'a1')).toBe(true);
    });

    it('classifies a seam-applied transaction as remote (custom provider origin)', () => {
      storeA.addBlock(paragraph('a1', 'Hello'));

      const providerOrigin = { provider: 'websocket' };

      storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate(storeB.getStateVector()), providerOrigin);

      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.origin === 'remote')).toBe(true);
    });
  });

  describe('undo scoping', () => {
    it('does not capture seam-applied transactions in undo history', () => {
      const history = new UndoHistory(storeB.undoScope, createMockBlok());

      storeA.addBlock(paragraph('a1', 'Remote text'));
      storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate(storeB.getStateVector()));

      expect(history.canUndo()).toBe(false);

      storeB.addBlock(paragraph('b1', 'Local text'));

      expect(history.canUndo()).toBe(true);

      history.undo();

      const ids = storeB.toJSON().map((block) => block.id);

      expect(ids).toContain('a1');
      expect(ids).not.toContain('b1');

      history.destroy();
    });
  });

  describe('onUpdate echo suppression', () => {
    it('skips seam-applied updates (default and custom origins), delivers local writes with their origin', () => {
      const received: { origin: unknown }[] = [];

      storeB.onUpdate((update, origin) => {
        received.push({ origin });
      });

      storeA.addBlock(paragraph('a1', 'One'));
      storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate(storeB.getStateVector()));

      expect(received).toHaveLength(0);

      // First use of a custom origin object: suppression must be registered
      // BEFORE the synchronous 'update' emission inside the apply.
      storeA.addBlock(paragraph('a2', 'Two'));
      storeB.applyRemoteUpdate(
        storeA.encodeStateAsUpdate(storeB.getStateVector()),
        { provider: 'websocket' }
      );

      expect(received).toHaveLength(0);

      storeB.addBlock(paragraph('b1', 'Local'));

      expect(received).toHaveLength(1);
      expect(received[0].origin).toBe('local');
    });

    it('suppresses echoes for a string provider origin on first use', () => {
      const callback = vi.fn();

      storeB.onUpdate(callback);

      storeA.addBlock(paragraph('a1', 'Hello'));
      storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate(storeB.getStateVector()), 'my-provider');

      expect(callback).not.toHaveBeenCalled();
      expect(storeB.toJSON().map((block) => block.id)).toEqual(['a1']);
    });

    it('relays onUpdate payloads: applying a captured local update syncs the peer', () => {
      const updates: Uint8Array[] = [];

      storeA.onUpdate((update) => {
        updates.push(update);
      });

      storeA.addBlock(paragraph('a1', 'Hello'));

      expect(updates).toHaveLength(1);
      expect(updates[0]).toBeInstanceOf(Uint8Array);

      storeB.applyRemoteUpdate(updates[0]);

      expect(storeB.toJSON()).toEqual(storeA.toJSON());
    });
  });

  describe('unsubscribe and destroy', () => {
    it('unsubscribe stops delivery', () => {
      const callback = vi.fn();
      const unsubscribe = storeA.onUpdate(callback);

      storeA.addBlock(paragraph('a1', 'One'));

      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      storeA.addBlock(paragraph('a2', 'Two'));

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('destroy unhooks update listeners before destroying the doc', () => {
      const store = createStore();
      const callback = vi.fn();
      const unsubscribe = store.onUpdate(callback);

      const rawDoc = (store as unknown as { ydoc: Y.Doc }).ydoc;
      const offSpy = vi.spyOn(rawDoc, 'off');
      const destroySpy = vi.spyOn(rawDoc, 'destroy');

      expect(() => store.destroy()).not.toThrow();

      expect(offSpy).toHaveBeenCalledWith('update', expect.any(Function));
      expect(offSpy.mock.invocationCallOrder[0]).toBeLessThan(destroySpy.mock.invocationCallOrder[0]);

      // A write after destroy must neither throw nor reach the unhooked callback.
      expect(() => store.addBlock(paragraph('late', 'Late'))).not.toThrow();
      expect(callback).not.toHaveBeenCalled();
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('origin type barrier', () => {
    it.each([...LOCAL_ORIGIN_TAGS])('rejects local origin tag "%s"', (tag) => {
      storeA.addBlock(paragraph('a1', 'Hello'));

      const update = storeA.encodeStateAsUpdate();

      expect(() => storeB.applyRemoteUpdate(update, tag)).toThrow(/local origin tag/);
      expect(storeB.toJSON()).toEqual([]);
    });

    it('a rejected origin does not poison echo suppression for local writes', () => {
      const callback = vi.fn();

      storeB.onUpdate(callback);

      storeA.addBlock(paragraph('a1', 'Hello'));

      expect(() => storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate(), 'local')).toThrow(/local origin tag/);

      storeB.addBlock(paragraph('b1', 'Local'));

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(expect.any(Uint8Array), 'local');
    });

    it('accepts a non-local string origin', () => {
      storeA.addBlock(paragraph('a1', 'Hello'));

      expect(() => {
        storeB.applyRemoteUpdate(storeA.encodeStateAsUpdate(), 'y-websocket-provider');
      }).not.toThrow();

      expect(storeB.toJSON()).toHaveLength(1);
    });
  });
});

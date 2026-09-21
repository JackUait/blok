import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputBlockData, OutputData } from '../../../../../types';

/**
 * The programmatic Blocks API against a remote peer editing the same document.
 *
 * Two real peers: a booted editor (its own YjsManager) and a second
 * DocumentStore, joined by the binary seam. Every assertion reads the Y.Doc —
 * the in-memory store and `save()` both looked right while `insertMany` was
 * emptying the document, so the store is not evidence.
 *
 * The defect these tests pin: `BlockMutation`'s stale-source guard
 * (`src/components/modules/blockManager/block-mutation.ts`) re-reads
 * `getBlockIndex(block)` after an await and returns the ORIGINAL block when it
 * is -1. The guard was written for a block the peer DELETED. It also fires for
 * a block the reconciler merely REPLACED (same id, new Block object) while
 * applying a peer's keystroke — and then the host's `update()` / `convert()`
 * is discarded with no error, no retry and a resolved promise.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: {
    getById: (id: string) => { id: string } | null;
    update: (id: string, data?: Record<string, unknown>) => Promise<{ id: string }>;
    convert: (id: string, type: string, overrides?: Record<string, unknown>) => Promise<{ id: string }>;
    delete: (index?: number, setCaret?: boolean) => Promise<void>;
    move: (toIndex: number, fromIndex?: number) => void;
    insert: (type?: string, data?: unknown, config?: unknown, index?: number) => { id: string };
    insertMany: (blocks: OutputBlockData[], index?: number) => Array<{ id: string }>;
  };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let local: YjsManager | undefined;
let peer: DocumentStore | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

const frame = async (): Promise<void> => {
  await flush();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await flush();
};

const requireLocal = (): YjsManager => {
  if (local === undefined) {
    throw new Error('the editor never built a YjsManager');
  }

  return local;
};

const requirePeer = (): DocumentStore => {
  if (peer === undefined) {
    throw new Error('the peer store was never created');
  }

  return peer;
};

/** Exchange updates until both peers hold the same document. */
const syncBothWays = (): void => {
  const a = requireLocal();
  const b = requirePeer();

  b.applyRemoteUpdate(a.encodeStateAsUpdate(b.getStateVector()));
  a.applyRemoteUpdate(b.encodeStateAsUpdate(a.getStateVector()));
  b.applyRemoteUpdate(a.encodeStateAsUpdate(b.getStateVector()));
};

/**
 * Deliver the peer's pending updates to the editor and return immediately —
 * the reconciler's DOM work is still in flight, which is the window a host's
 * API call falls into.
 */
const deliverPeerUpdate = (): void => {
  const a = requireLocal();

  a.applyRemoteUpdate(requirePeer().encodeStateAsUpdate(a.getStateVector()));
};

const docOf = (side: 'local' | 'peer'): OutputBlockData[] =>
  side === 'local' ? requireLocal().toJSON() : requirePeer().toJSON();

const idsOf = (side: 'local' | 'peer'): string[] =>
  docOf(side).map((block) => block.id).filter((id): id is string => typeof id === 'string');

const blockOf = (side: 'local' | 'peer', id: string): OutputBlockData | undefined =>
  docOf(side).find((block) => block.id === id);

const textOf = (side: 'local' | 'peer', id: string): unknown =>
  (blockOf(side, id)?.data as { text?: unknown } | undefined)?.text;

/** The peer types `insert` at offset `at` inside its own copy of the block. */
const peerTypes = (id: string, at: number, insert: string): void => {
  const data = requirePeer().blocksMap.get(id)?.get('data');

  if (!(data instanceof Y.Map)) {
    throw new Error(`the peer holds no data map for «${id}»`);
  }

  const text = data.get('text');

  if (!(text instanceof Y.Text)) {
    throw new Error(`the peer's «${id}».text is not mergeable`);
  }

  text.insert(at, insert);
};

describe('the programmatic Blocks API racing a remote peer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);

    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (
      this: YjsManager,
      blocks: Parameters<YjsManager['fromJSON']>[0]
    ) {
      local = this;

      return originalFromJSON.call(this, blocks);
    });
  });

  afterEach(async () => {
    editor?.destroy();
    await frame();
    holder?.remove();
    peer?.destroy();
    editor = undefined;
    holder = undefined;
    local = undefined;
    peer = undefined;
    vi.restoreAllMocks();
  });

  const boot = async (data: OutputData): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph,
        header: Header },
      data,
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(requireLocal().encodeStateAsUpdate(peer.getStateVector()));

    return instance;
  };

  const twoParagraphs = (): OutputData => ({
    blocks: [
      { id: 'one', type: 'paragraph', data: { text: 'alpha' } },
      { id: 'two', type: 'paragraph', data: { text: 'beta' } },
    ],
  });

  describe('blocks.update() while the peer\'s keystroke is reconciling', () => {
    it.fails('writes the caller\'s text into the document', async () => {
      const instance = await boot(twoParagraphs());

      peerTypes('one', 5, 'X');
      deliverPeerUpdate();

      await instance.blocks.update('one', { text: 'alphaX more' });
      await frame();
      syncBothWays();

      expect(textOf('peer', 'one')).toBe('alphaX more');
      expect(textOf('local', 'one')).toBe('alphaX more');
    });

    it('leaves the block in the document, so the update had a target to write to', async () => {
      const instance = await boot(twoParagraphs());

      peerTypes('one', 5, 'X');
      deliverPeerUpdate();

      await instance.blocks.update('one', { text: 'alphaX more' });
      await frame();

      // The guard that discards the write treats the block as gone. It is not:
      // the reconciler replaced the Block OBJECT, the id is still in the doc.
      expect(idsOf('local')).toContain('one');
      expect(instance.blocks.getById('one')).not.toBeNull();
    });

    it('control: the same update lands once the reconcile has settled', async () => {
      const instance = await boot(twoParagraphs());

      peerTypes('one', 5, 'X');
      deliverPeerUpdate();
      await frame();

      await instance.blocks.update('one', { text: 'alphaX more' });
      await frame();
      syncBothWays();

      expect(textOf('peer', 'one')).toBe('alphaX more');
    });

    it('control: an update with nothing reconciling reaches the document', async () => {
      const instance = await boot(twoParagraphs());

      await instance.blocks.update('one', { text: 'rewritten' });
      await frame();
      syncBothWays();

      expect(textOf('peer', 'one')).toBe('rewritten');
    });
  });

  describe('blocks.convert() while the peer\'s keystroke is reconciling', () => {
    it.fails('writes the new tool type into the document', async () => {
      const instance = await boot(twoParagraphs());

      peerTypes('one', 5, 'Z');
      deliverPeerUpdate();

      await instance.blocks.convert('one', 'header');
      await frame();
      syncBothWays();

      expect(blockOf('peer', 'one')?.type).toBe('header');
      expect(textOf('peer', 'one')).toContain('Z');
    });

    it('control: the same turn-into lands once the reconcile has settled', async () => {
      const instance = await boot(twoParagraphs());

      peerTypes('one', 5, 'Z');
      deliverPeerUpdate();
      await frame();

      await instance.blocks.convert('one', 'header');
      await frame();
      syncBothWays();

      expect(blockOf('peer', 'one')?.type).toBe('header');
    });
  });

  describe('races that do NOT lose anything', () => {
    it('keeps the peer\'s text when a DIFFERENT key of the same block is updated', async () => {
      const instance = await boot({
        blocks: [{ id: 'h', type: 'header', data: { text: 'title', level: 2 } }],
      });

      peerTypes('h', 5, '!!');
      deliverPeerUpdate();

      await instance.blocks.update('h', { level: 3 });
      await frame();
      syncBothWays();

      expect(textOf('peer', 'h')).toBe('title!!');
      expect((blockOf('peer', 'h')?.data as { level?: unknown }).level).toBe(3);
    });

    it('keeps the peer\'s new block through a local delete', async () => {
      const instance = await boot(twoParagraphs());

      requirePeer().addBlock({ id: 'peerblock',
        type: 'paragraph',
        data: { text: 'peer' } }, 2);
      deliverPeerUpdate();

      await instance.blocks.delete(0, false);
      await frame();
      syncBothWays();

      expect(idsOf('peer')).toContain('peerblock');
      expect(textOf('peer', 'peerblock')).toBe('peer');
    });

    it('keeps the peer\'s new block through a local insertMany', async () => {
      const instance = await boot(twoParagraphs());

      requirePeer().addBlock({ id: 'peerblock',
        type: 'paragraph',
        data: { text: 'peer' } }, 1);
      deliverPeerUpdate();

      instance.blocks.insertMany([{ id: 'm1',
        type: 'paragraph',
        data: { text: 'm1' } }], 1);
      await frame();
      syncBothWays();

      expect(idsOf('peer')).toContain('peerblock');
      expect(idsOf('peer')).toContain('m1');
    });

    it('leaves every id exactly once in the order arrays after a move against a peer insert', async () => {
      const instance = await boot({
        blocks: [
          { id: 'one', type: 'paragraph', data: { text: 'alpha' } },
          { id: 'two', type: 'paragraph', data: { text: 'beta' } },
          { id: 'three', type: 'paragraph', data: { text: 'gamma' } },
        ],
      });

      requirePeer().addBlock({ id: 'peerblock',
        type: 'paragraph',
        data: { text: 'peer' } }, 3);
      deliverPeerUpdate();

      instance.blocks.move(2, 0);
      await frame();
      syncBothWays();

      const ids = idsOf('peer');

      expect(new Set(ids).size).toBe(ids.length);
      expect(idsOf('local')).toEqual(ids);
      expect(ids).toContain('peerblock');
    });

    it('keeps the peer\'s characters when a local update touches another block', async () => {
      const instance = await boot(twoParagraphs());

      peerTypes('one', 5, 'S');
      deliverPeerUpdate();

      await instance.blocks.update('two', { text: 'beta edited' });
      await frame();
      syncBothWays();

      expect(textOf('peer', 'one')).toBe('alphaS');
      expect(textOf('peer', 'two')).toBe('beta edited');
    });
  });
});

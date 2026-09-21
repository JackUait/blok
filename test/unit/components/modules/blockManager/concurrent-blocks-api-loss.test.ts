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

/**
 * The peer types `count` characters at the end of `id`'s text, one per
 * microtask, delivering each to the editor as it lands — the shape of a peer
 * typing into the same block while a local API call is mid-flight.
 * @param id - block the peer is typing into
 * @param at - offset the first character goes to
 * @param count - how many characters to type
 */
const peerBurst = async (id: string, at: number, count: number): Promise<void> => {
  for (let index = 0; index < count; index++) {
    peerTypes(id, at + index, String(index));
    deliverPeerUpdate();
    await Promise.resolve();
  }
};

/** Resolve to 'landed' or 'refused' without letting a rejection escape. */
const settle = async (call: Promise<unknown>): Promise<'landed' | 'refused'> =>
  call.then(() => 'landed' as const, () => 'refused' as const);

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
    it('writes the caller\'s text into the document', async () => {
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
    it('writes the new tool type into the document', async () => {
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

    describe('a local API call must not write back a snapshot the peer has moved past', () => {
    const paragraphAndPeer = (): OutputData => ({
      blocks: [
        { id: 'one', type: 'paragraph', data: { text: 'alpha' } },
        { id: 'two', type: 'paragraph', data: { text: 'beta' } },
      ],
    });

    /**
     * `convert()` read the source across two awaits and `replace()` wrote that
     * snapshot back key by key. Every character the peer typed after the read
     * was diffed away, and BOTH peers converged on the truncated string — the
     * worst class of loss, because nothing looks wrong afterwards.
     *
     * A conversion is allowed to refuse (the block stays a paragraph). It is
     * never allowed to shorten the peer's text.
     */
    for (const count of [1, 2, 4, 6, 8]) {
      it(`keeps every one of the peer's ${count} characters through a convert()`, async () => {
        const instance = await boot(paragraphAndPeer());

        const burst = peerBurst('one', 5, count);
        const outcome = settle(instance.blocks.convert('one', 'header'));

        await burst;
        const landed = await outcome;

        await frame();
        syncBothWays();

        const expected = `alpha${Array.from({ length: count }, (_, index) => index).join('')}`;

        // The defect assertion first: nothing the peer typed may be missing.
        expect(textOf('peer', 'one')).toBe(expected);
        expect(textOf('local', 'one')).toBe(expected);

        // A refusal must be visible to the caller, never a resolved promise
        // over a conversion that did not happen.
        expect(blockOf('peer', 'one')?.type).toBe(landed === 'landed' ? 'header' : 'paragraph');
      });
    }

    /**
     * `update()` with a patch that does not mention `text` recomposed the Block
     * from a snapshot that still carried the PRE-keystroke text. Re-rendering
     * it made the MutationObserver sync that stale string back to Yjs, so a
     * cosmetic `level` change deleted the peer's typing.
     */
    for (const count of [1, 2, 3, 5, 6, 8]) {
      it(`keeps the peer's ${count} characters when update() changes only 'level'`, async () => {
        const instance = await boot({
          blocks: [{ id: 'h', type: 'header', data: { text: 'title', level: 2 } }],
        });

        const burst = peerBurst('h', 5, count);
        const outcome = settle(instance.blocks.update('h', { level: 3 }));

        await burst;
        await outcome;
        await frame();
        syncBothWays();

        const expected = `title${Array.from({ length: count }, (_, index) => index).join('')}`;

        // The defect assertion first.
        expect(textOf('peer', 'h')).toBe(expected);
        expect((blockOf('peer', 'h')?.data as { level?: unknown }).level).toBe(3);
      });
    }

    it('still converts when the peer pauses between keystrokes', async () => {
      const instance = await boot(paragraphAndPeer());

      peerTypes('one', 5, 'Z');
      deliverPeerUpdate();
      await frame();

      await instance.blocks.convert('one', 'header');
      await frame();
      syncBothWays();

      expect(textOf('peer', 'one')).toBe('alphaZ');
      expect(blockOf('peer', 'one')?.type).toBe('header');
    });
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

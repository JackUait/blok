import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import { BlockYjsSync } from '../../../../../src/components/modules/blockManager/yjs-sync';
import type { SyncHandlers } from '../../../../../src/components/modules/blockManager/yjs-sync';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * The replay baseline decides what happens to a write-back that lands while a
 * peer's edit is being applied. It must tell two things apart:
 *
 *  - the reconciler's OWN rewrite echoing back (drop it, or this client's
 *    sanitized view overwrites the peer's content in the shared document), and
 *  - a real user edit — a paste, an inline tool — that `beforeinput` never saw
 *    (replay it, or it is lost forever).
 *
 * The distinction cannot be "did the sanitizer change anything": the sanitizer
 * NORMALISES ordinary values. `a & b` — what any host-seeded block holds, from
 * `blocks.insert`, a server render or a migration — comes back as `a &amp; b`.
 * A block like that would have its baseline disarmed on EVERY peer update,
 * forever, and every paste into that window dropped.
 */

interface Priv {
  yjsSync: BlockYjsSync;
  repository: BlockRepository;
  blockDidMutated: (mutationType: string, block: unknown, detail: Record<string, unknown>) => unknown;
  syncBlockDataToYjs: (block: Block) => Promise<void>;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const drain = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
};

const settle = async (): Promise<void> => {
  await drain();
  await nextFrame();
  await drain();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await drain();
  await nextFrame();
  await drain();
};

describe('the replay baseline under a sanitizer that normalises', () => {
  let yjsManager: YjsManager;
  let peer: DocumentStore;
  let priv: Priv;
  let stub: {
    id: string;
    holder: HTMLElement;
    save: ReturnType<typeof vi.fn>;
    setData: ReturnType<typeof vi.fn>;
    preservedData: { text: string };
  };
  /** What the block's DOM holds — what `save()` reads back. */
  let domText = '';
  /** Fired from inside `setData`, i.e. inside the still-open reconcile window. */
  let duringRewrite: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    const config: BlokConfig = { defaultBlock: 'paragraph', user: { id: 'user-1' } };
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();

    yjsManager = new YjsManager({ config, eventsDispatcher });

    const blockManager = new BlockManager({ config, eventsDispatcher });

    blockManager.state = { YjsManager: yjsManager } as unknown as BlokModules;
    priv = blockManager as unknown as Priv;

    const workingArea = document.createElement('div');

    document.body.appendChild(workingArea);

    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');

    stub = {
      id: 'p1',
      name: 'paragraph',
      parentId: null,
      holder,
      contentIds: [],
      inputs: [],
      preservedData: { text: '' },
      preservedTunes: {},
      tool: { name: 'paragraph' },
      save: vi.fn(async () => {
        await Promise.resolve();

        return { data: { text: domText } };
      }),
      setData: vi.fn(async (data: { text: string }) => {
        await Promise.resolve();
        // The rewrite lands in the DOM…
        domText = data.text;
        stub.preservedData = { text: data.text };
        // …and whatever the test wants to happen inside the window happens now.
        duringRewrite?.();
        duringRewrite = null;

        return true;
      }),
      call: vi.fn(),
      destroy: vi.fn(),
    } as unknown as typeof stub;

    const rawBlocksStore = new Blocks(workingArea);

    rawBlocksStore.push(stub as unknown as Block);

    const blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

    const repository = new BlockRepository();

    repository.initialize(blocksStore);
    priv.repository = repository;

    priv.yjsSync = new BlockYjsSync(
      { YjsManager: yjsManager,
        isReadOnly: (): boolean => false },
      repository,
      { getTool: () => ({ sanitizeConfig: Paragraph.sanitize }) } as unknown as BlockFactory,
      { resyncBlockData: (block: Block): void => {
        void priv.syncBlockDataToYjs(block);
      } } as unknown as SyncHandlers,
      blocksStore
    );
    priv.yjsSync.subscribe();
  });

  afterEach(() => {
    priv.yjsSync.destroy();
    document.body.replaceChildren();
    duringRewrite = null;
    vi.restoreAllMocks();
  });

  /** Seed the document the way a host does — raw, unsanitized. */
  const seed = (text: string): void => {
    yjsManager.addBlock({ id: 'p1', type: 'paragraph', data: { text } });
    yjsManager.stopCapturing();
    domText = text;
    stub.preservedData = { text };

    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(yjsManager.encodeStateAsUpdate(peer.getStateVector()));
  };

  const pushPeerEdit = (text: string): void => {
    peer.updateBlockData('p1', 'text', text);
    yjsManager.applyRemoteUpdate(peer.encodeStateAsUpdate(yjsManager.getStateVector()));
  };

  const docText = (): unknown => {
    const data = yjsManager.getBlockById('p1')?.get('data');

    return data instanceof Y.Map ? (data.toJSON() as Record<string, unknown>).text : undefined;
  };

  it('replays a paste that lands while a bare-& block is being rewritten by a peer', async () => {
    seed('a & b');
    expect(docText()).toBe('a & b');

    duringRewrite = () => {
      // The user pastes into the block the reconciler is mid-rewrite.
      domText = `${domText}<i>pasted</i>`;
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });
    };

    pushPeerEdit('a & b!');
    await settle();

    // THE DEFECT: the paste must reach the document. `a &amp; b!` alone means
    // the write-back was dropped and the user's paste is gone for good.
    expect(docText()).toBe('a &amp; b!<i>pasted</i>');
  });

  it('still keeps a peer\'s markup this client strips out of the document', async () => {
    seed('plain');

    duringRewrite = () => {
      // No user edit — just the rewrite's own echo reaching the observer.
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });
    };

    pushPeerEdit('E = mc<sup>2</sup>');
    await settle();

    // The DOM holds the stripped value; the document must NOT.
    expect(domText).toBe('E = mc2');
    expect(docText()).toBe('E = mc<sup>2</sup>');
  });

  it('does not write back the sanitizer\'s own normalisation of a peer edit', async () => {
    seed('plain');

    duringRewrite = () => {
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });
    };

    pushPeerEdit('x & y');
    await settle();

    expect(domText).toBe('x &amp; y');
    expect(docText()).toBe('x & y');
  });

  it('reports a tool whose save() throws during the replay, and rejects nothing', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };

    process.on('unhandledRejection', onRejection);

    const errors: unknown[] = [];

    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    seed('plain');

    duringRewrite = () => {
      // No user provenance: this is the path that diffs against the baseline,
      // and the diff needs a save() the tool refuses to give.
      stub.save.mockRejectedValue(new Error('save boom'));
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });
    };

    pushPeerEdit('rewritten');
    await settle();
    // A real macrotask turn: that is when Node decides a rejection is unhandled.
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off('unhandledRejection', onRejection);

    // THE DEFECT: the replay's save() was awaited with no catcher, so a tool
    // that throws surfaced as an unhandled rejection a host reads as an
    // unattributed page error.
    expect(rejections).toEqual([]);

    // And nothing was swallowed to get there.
    expect(JSON.stringify(errors.map((entry) => String(entry)))).toContain('save boom');
  });
});

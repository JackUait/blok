import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputData } from '../../../../../types';

/**
 * The current block is the block the caret is in. A remote peer's edits are
 * applied straight to the block store, so a stored index would point at
 * another block after the peer inserts, removes or retypes above it.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  caret: { setToBlock: (id: string) => boolean };
  blocks: {
    insert: (type?: string, data?: unknown, config?: unknown, index?: number, needToFocus?: boolean, replace?: boolean, id?: string) => { id: string };
    getCurrentBlockIndex: () => number;
    getBlockByIndex: (index: number) => { id: string } | undefined;
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

const deliverPeerUpdate = async (): Promise<void> => {
  const a = requireLocal();

  a.applyRemoteUpdate(requirePeer().encodeStateAsUpdate(a.getStateVector()));
  await frame();
};

const currentId = (instance: TestEditor): string | undefined =>
  instance.blocks.getBlockByIndex(instance.blocks.getCurrentBlockIndex())?.id;

const threeParagraphs = (): OutputData => ({
  blocks: [
    { id: 'one', type: 'paragraph', data: { text: 'alpha' } },
    { id: 'two', type: 'paragraph', data: { text: 'beta' } },
    { id: 'three', type: 'paragraph', data: { text: 'gamma' } },
  ],
});

describe('the current block while a remote peer edits the document', () => {
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

  const bootOnTwo = async (): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph,
        header: Header },
      data: threeParagraphs(),
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(requireLocal().encodeStateAsUpdate(peer.getStateVector()));

    instance.caret.setToBlock('two');

    return instance;
  };

  it('stays on the same block when the peer inserts a block above it', async () => {
    const instance = await bootOnTwo();

    requirePeer().addBlock({ id: 'peerblock', type: 'paragraph', data: { text: 'peer' } }, 0);
    await deliverPeerUpdate();

    expect(currentId(instance)).toBe('two');
    expect(instance.blocks.getCurrentBlockIndex()).toBe(2);
  });

  it('stays on the same block when the peer removes a block above it', async () => {
    const instance = await bootOnTwo();

    requirePeer().removeBlock('one');
    await deliverPeerUpdate();

    expect(currentId(instance)).toBe('two');
    expect(instance.blocks.getCurrentBlockIndex()).toBe(0);
  });

  it('has no current block after the peer deletes it', async () => {
    const instance = await bootOnTwo();

    requirePeer().removeBlock('two');
    await deliverPeerUpdate();

    // Unlike a local delete, the remote path does not hand over to a neighbour.
    expect(instance.blocks.getCurrentBlockIndex()).toBe(-1);
  });

  it('stays on the same block when the peer converts it to another tool', async () => {
    const instance = await bootOnTwo();

    requirePeer().replaceBlockContent('two', 'header', { text: 'beta', level: 2 });
    await deliverPeerUpdate();

    expect(currentId(instance)).toBe('two');
    expect(instance.blocks.getCurrentBlockIndex()).toBe(1);
  });

  it('does not make a deleted block current again when the peer re-adds its id', async () => {
    const instance = await bootOnTwo();

    requirePeer().removeBlock('two');
    await deliverPeerUpdate();
    requirePeer().addBlock({ id: 'two', type: 'paragraph', data: { text: 'back' } }, 1);
    await deliverPeerUpdate();

    expect(instance.blocks.getBlockByIndex(1)?.id).toBe('two');
    expect(instance.blocks.getCurrentBlockIndex()).toBe(-1);
  });

  it('stays on the same block when the peer types into it', async () => {
    const instance = await bootOnTwo();
    const data = requirePeer().blocksMap.get('two')?.get('data');

    if (!(data instanceof Y.Map)) {
      throw new Error('the peer holds no data map for «two»');
    }

    const text = data.get('text');

    if (!(text instanceof Y.Text)) {
      throw new Error('the peer\'s «two».text is not mergeable');
    }

    text.insert(4, '!');
    await deliverPeerUpdate();

    expect(currentId(instance)).toBe('two');
    expect(instance.blocks.getCurrentBlockIndex()).toBe(1);
  });

  it('keeps the current block and the undo step when the API replaces the block above it without focus', async () => {
    const instance = await bootOnTwo();
    const stopCapturing = vi.spyOn(requireLocal(), 'stopCapturing');

    instance.blocks.insert('paragraph', { text: 'swapped' }, {}, 0, false, true, 'swap');
    await frame();

    expect(currentId(instance)).toBe('two');
    expect(instance.blocks.getCurrentBlockIndex()).toBe(1);
    // The current block's index did not move, so the undo step stays open.
    expect(stopCapturing).not.toHaveBeenCalled();
  });
});

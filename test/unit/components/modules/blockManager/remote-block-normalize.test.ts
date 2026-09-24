import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

interface TestEditor { isReady: Promise<unknown>; destroy: () => void }

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};
const frame = async (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
const settle = async (): Promise<void> => {
  await drain();
  await frame();
  await drain();
  await new Promise((resolve) => setTimeout(resolve, 600));
  await drain();
  await frame();
  await drain();
};

const headerLevel = (store: { toJSON: () => Array<{ id?: string; data?: Record<string, unknown> }> }): unknown =>
  store.toJSON().find((block) => block.id === 'h')?.data?.level;

/**
 * A peer adds a header whose record has no `level`, then picks H1 before this
 * client's writes reach it. Returns what this client wrote and where `level`
 * ends up once both sides have synced.
 */
const receiveHeaderFromPeer = async (peerClientId: number): Promise<{ receiverWrote: boolean; peerLevel: unknown; receiverLevel: unknown }> => {
  let captured: YjsManager | undefined;
  const originalFromJSON = YjsManager.prototype.fromJSON;

  vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (this: YjsManager, blocks: Parameters<YjsManager['fromJSON']>[0]) {
    captured = this;

    return originalFromJSON.call(this, blocks);
  });
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header },
    data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'hello' } }] },
  }) as unknown as TestEditor;

  await editor.isReady;
  await settle();

  if (captured === undefined) {
    throw new Error('YjsManager was not captured');
  }
  const receiver = captured;
  const peer = new DocumentStore(new YBlockSerializer());

  // Y.Map settles concurrent sets by client id, so the id decides who wins.
  (peer as unknown as { ydoc: Y.Doc }).ydoc.clientID = peerClientId;
  peer.applyRemoteUpdate(receiver.encodeStateAsUpdate(peer.getStateVector()));
  peer.transact(() => {
    peer.addBlock({ id: 'h', type: 'header', data: { text: 'Title' } });
  }, 'local');
  receiver.applyRemoteUpdate(peer.encodeStateAsUpdate(receiver.getStateVector()));
  const peerStateBefore = peer.getStateVector();

  peer.updateBlockData('h', 'level', 1);
  await settle();

  const fromReceiver = receiver.encodeStateAsUpdate(peerStateBefore);
  const receiverWrote = Y.decodeUpdate(fromReceiver).structs.length > 0;

  peer.applyRemoteUpdate(fromReceiver);
  receiver.applyRemoteUpdate(peer.encodeStateAsUpdate(receiver.getStateVector()));
  await settle();

  const result = { receiverWrote, peerLevel: headerLevel(peer), receiverLevel: headerLevel(receiver) };

  editor.destroy();
  await frame();
  await drain();
  peer.destroy();
  holder.remove();

  return result;
};

describe('a block that arrived from a peer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['a low', 1],
    ['a high', 4294967295],
  ])('is not normalised into the shared document (peer with %s client id)', async (_label, clientId) => {
    const result = await receiveHeaderFromPeer(clientId);

    expect(result.receiverWrote).toBe(false);
    expect(result.peerLevel).toBe(1);
    expect(result.receiverLevel).toBe(1);
  });
});

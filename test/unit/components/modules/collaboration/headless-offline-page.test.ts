import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok, { downloadOfflinePage } from '../../../../../src/blok';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { createOperationStore } from '../../../../../src/components/modules/collaboration/operation-store';
import type { StoredDocument } from '../../../../../src/components/modules/collaboration/operation-store';
import { encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputBlockData } from '../../../../../types';

const SYNC_URL = 'wss://sync.test/api/sync/child';
const DOC = 'child';
const SCOPE = 'account-a';
type ReadyEditor = Blok & Pick<API, 'blocks' | 'readOnly'>;
const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };
const NEW_TAG: WorkingSetTag = { format: 2, epoch: 1, lineage: 'fedcba9876543210fedcba9876543210' };

class ScriptedSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;

  public send(_data: ArrayBufferLike | ArrayBufferView): void {}

  public close(): void {
    this.readyState = 3;
  }

  public open(): void {
    this.readyState = 1;
    this.protocol = 'blok-sync.v1';
    this.onopen?.({});
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }

  public serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: 'forbidden' });
  }
}

type ScriptMode = 'sync' | 'open-only' | 'control-only' | 'forbidden';

const peerUpdate = (blocks: OutputBlockData[]): Uint8Array => {
  const peer = new DocumentStore(new YBlockSerializer());

  peer.fromJSON(blocks.map((block, index) => ({
    id: block.id ?? `peer-${index}`,
    type: block.type,
    data: block.data,
    ...(block.parent === undefined ? {} : { parent: block.parent }),
  })));
  const update = peer.encodeStateAsUpdate();

  peer.destroy();

  return update;
};

const makeSyncSocket = (options: {
  blocks?: OutputBlockData[];
  mode?: ScriptMode;
  tag?: WorkingSetTag;
  firstOnly?: boolean;
} = {}): { factory: CollabSocketFactory; requestedDocs: string[]; sockets: ScriptedSocket[] } => {
  const requestedDocs: string[] = [];
  const sockets: ScriptedSocket[] = [];
  const update = peerUpdate(options.blocks ?? []);
  const mode = options.mode ?? 'sync';

  const factory: CollabSocketFactory = (url) => {
    requestedDocs.push(new URL(url).pathname.split('/').at(-1) ?? '');
    const socket = new ScriptedSocket();

    sockets.push(socket);
    queueMicrotask(() => {
      if (socket.readyState === 3) {
        return;
      }

      socket.open();
      if (options.firstOnly === true && sockets.length > 1) {
        return;
      }
      if (mode === 'forbidden') {
        socket.serverClose(4403);

        return;
      }
      if (mode === 'open-only') {
        return;
      }

      socket.deliver({ type: 'control', tag: options.tag ?? TAG });
      if (mode === 'sync') {
        socket.deliver({ type: 'syncStep2', update });
      }
    });

    return socket;
  };

  return { factory, requestedDocs, sockets };
};

const openCache = async (): Promise<StoredDocument | null> => {
  const store = createOperationStore({ url: SYNC_URL, doc: DOC, offlineScope: SCOPE });

  try {
    return await store.open();
  } finally {
    await store.close();
  }
};

const cachedTexts = async (): Promise<string[]> => {
  const cached = await openCache();

  if (cached === null) {
    return [];
  }

  const replay = new DocumentStore(new YBlockSerializer());

  try {
    cached.updates.forEach(update => replay.applyRemoteUpdate(update));

    return replay.toJSON().map(block => (block.data as { text?: string }).text ?? '');
  } finally {
    replay.destroy();
  }
};

const waitFor = async (condition: () => boolean | Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + 3000;

  while (!(await condition())) {
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for headless sync');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

describe('downloadOfflinePage', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('makes only the selected unopened page adoptable after a completed sync', async () => {
    const socket = makeSyncSocket({
      blocks: [
        { id: 'p', type: 'paragraph', data: { text: 'Offline text' } },
        { id: 'ptr', type: 'page', data: { pageId: 'grandchild' } },
      ],
    });

    const bodyChildren = document.body.childElementCount;
    const result = await downloadOfflinePage({
      url: SYNC_URL,
      doc: DOC,
      offlineScope: SCOPE,
      ticket: async () => 'ticket',
      socketFactory: socket.factory,
      signal: AbortSignal.timeout(5000),
    });
    const cached = await openCache();

    expect(cached?.meta.lineage).toBe(result.lineage);
    expect(cached?.meta.writeDenied).toBe(true);
    expect(cached?.updates.length).toBeGreaterThan(0);
    expect(await cachedTexts()).toContain('Offline text');
    expect(socket.requestedDocs).toEqual(['child']);
    expect(document.body.childElementCount).toBe(bodyChildren);
  });

  it('does not adopt a page before a control frame', async () => {
    const socket = makeSyncSocket({ mode: 'open-only' });
    const controller = new AbortController();
    const pending = downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: controller.signal,
    });

    await waitFor(() => socket.sockets.length === 1);
    expect(await openCache()).toBeNull();
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it('does not adopt a page from a control frame without SyncStep2', async () => {
    const socket = makeSyncSocket({ mode: 'control-only' });
    const controller = new AbortController();
    const pending = downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: controller.signal,
    });

    await waitFor(() => socket.sockets.length === 1);
    expect(await openCache()).toBeNull();
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it('rejects forbidden access without writing an offline copy', async () => {
    const socket = makeSyncSocket({ mode: 'forbidden' });

    await expect(downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: AbortSignal.timeout(5000),
    })).rejects.toThrow(/forbidden/i);

    expect(await openCache()).toBeNull();
  });

  it('does not adopt a download when access is revoked during the cache transaction', async () => {
    const socket = makeSyncSocket({
      blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Revoked body' } }],
    });
    const add = IDBObjectStore.prototype.add;

    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(function (this: IDBObjectStore, value: unknown) {
      const request = add.call(this, value);

      const activeSocket = socket.sockets[0];

      if (activeSocket === undefined) {
        throw new Error('Sync socket was not opened');
      }
      activeSocket.serverClose(4403);

      return request;
    });

    await expect(downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: AbortSignal.timeout(5000),
    })).rejects.toThrow(/forbidden/i);

    expect(await openCache()).toBeNull();
  });

  it('rejects a changed lineage instead of adopting a reset as the old copy', async () => {
    const seed = createOperationStore({ url: SYNC_URL, doc: DOC, offlineScope: SCOPE });

    await seed.open();
    await seed.recordSession(TAG, true, 'v1', peerUpdate([
      { id: 'old', type: 'paragraph', data: { text: 'Earlier copy' } },
    ]));
    await seed.close();

    const socket = makeSyncSocket({
      blocks: [{ id: 'new', type: 'paragraph', data: { text: 'New lineage' } }],
      tag: NEW_TAG,
      firstOnly: true,
    });

    await expect(downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: AbortSignal.timeout(500),
    })).rejects.toThrow();

    const cached = await openCache();

    expect(cached?.meta.lineage).not.toBe(NEW_TAG.lineage);
    expect(await cachedTexts()).not.toContain('New lineage');
  });

  it('does not open a socket or a copy for an already-aborted request', async () => {
    const socket = makeSyncSocket();
    const controller = new AbortController();

    controller.abort();

    await expect(downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: controller.signal,
    })).rejects.toThrow();

    expect(socket.requestedDocs).toEqual([]);
    expect(await openCache()).toBeNull();
  });

  it('keeps an earlier copy when aborting during the cache transaction', async () => {
    const seed = createOperationStore({ url: SYNC_URL, doc: DOC, offlineScope: SCOPE });

    await seed.open();
    await seed.recordSession(TAG, true, 'v1', peerUpdate([
      { id: 'old', type: 'paragraph', data: { text: 'Earlier copy' } },
    ]));
    await seed.close();

    const controller = new AbortController();
    const socket = makeSyncSocket({
      blocks: [{ id: 'new', type: 'paragraph', data: { text: 'Not committed' } }],
    });
    const add = IDBObjectStore.prototype.add;

    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(function (this: IDBObjectStore, value: unknown) {
      const request = add.call(this, value);

      controller.abort();

      return request;
    });

    await expect(downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: controller.signal,
    })).rejects.toThrow();

    expect(await cachedTexts()).toEqual(['Earlier copy']);
  });

  it('refuses a download when IndexedDB cannot open', async () => {
    const socket = makeSyncSocket();

    vi.stubGlobal('indexedDB', { open: () => { throw new Error('storage unavailable'); } });

    await expect(downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: AbortSignal.timeout(5000),
    })).rejects.toThrow();

    expect(socket.requestedDocs).toEqual([]);
    vi.stubGlobal('indexedDB', new IDBFactory());
    expect(await openCache()).toBeNull();
  });

  it('rejects a failed cache transaction without making the page adoptable', async () => {
    const socket = makeSyncSocket({
      blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Not committed' } }],
    });

    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => {
      throw new Error('quota failure');
    });

    await expect(downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: AbortSignal.timeout(5000),
    })).rejects.toThrow(/quota failure/);

    expect(await openCache()).toBeNull();
  });

  it('keeps an earlier valid copy after a failed refresh', async () => {
    const seed = createOperationStore({ url: SYNC_URL, doc: DOC, offlineScope: SCOPE });

    await seed.open();
    await seed.recordSession(TAG, true, 'v1', peerUpdate([
      { id: 'old', type: 'paragraph', data: { text: 'Earlier copy' } },
    ]));
    await seed.close();

    const socket = makeSyncSocket({
      blocks: [{ id: 'new', type: 'paragraph', data: { text: 'Not committed' } }],
    });

    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => {
      throw new Error('quota failure');
    });

    await expect(downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: AbortSignal.timeout(5000),
    })).rejects.toThrow(/quota failure/);

    expect(await cachedTexts()).toEqual(['Earlier copy']);
  });

  it('lets a disconnected real editor open the downloaded body read-only', async () => {
    const socket = makeSyncSocket({
      blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Offline text' } }],
    });

    await downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: socket.factory, signal: AbortSignal.timeout(5000),
    });

    const payload = btoa(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      write: false,
    }));

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async (): Promise<unknown> => ({ ticket: `header.${payload}.signature` }),
    })));
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    const collaboration: CollaborationConfig = {
      doc: DOC,
      offline: true,
      offlineScope: SCOPE,
      socketFactory: () => new ScriptedSocket(),
    };
    const editor = new Blok({
      holder,
      server: 'https://sync.test/api/',
      ticket: '/tickets',
      collaboration,
      tools: {
        paragraph: { class: Paragraph },
        bookmark: { class: Bookmark },
      },
    });

    try {
      const ready = (await editor.isReady) as ReadyEditor;
      await waitFor(() => holder.textContent?.includes('Offline text') ?? false);
      const saved = await ready.blocks.getById('p')?.save();

      expect(saved?.data.text).toBe('Offline text');
      expect(ready.readOnly.isEnabled).toBe(true);
    } finally {
      editor.destroy();
      holder.remove();
    }
  });

  it('keeps a no-ticket headless download read-only after sync without a write grant', async () => {
    const downloadSocket = makeSyncSocket({
      blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Offline text' } }],
    });

    await downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: downloadSocket.factory, signal: AbortSignal.timeout(5000),
    });

    const holder = document.createElement('div');
    const editorSocket = new ScriptedSocket();

    document.body.appendChild(holder);
    const collaboration: CollaborationConfig = {
      doc: DOC,
      offline: true,
      offlineScope: SCOPE,
      socketFactory: () => editorSocket,
    };
    const editor = new Blok({
      holder,
      server: 'https://sync.test/api/',
      collaboration,
      tools: {
        paragraph: { class: Paragraph },
        bookmark: { class: Bookmark },
      },
    });

    try {
      const ready = (await editor.isReady) as ReadyEditor;
      await waitFor(() => holder.textContent?.includes('Offline text') ?? false);
      editorSocket.open();
      editorSocket.deliver({ type: 'control', tag: TAG });
      editorSocket.deliver({ type: 'syncStep2', update: peerUpdate([]) });
      await waitFor(() => holder.querySelector('[data-blok-collab]')?.getAttribute('data-blok-collab') === 'connected');

      expect(ready.readOnly.isEnabled).toBe(true);
    } finally {
      editor.destroy();
      holder.remove();
    }
  });

  it('keeps a no-ticket headless download read-only before the editor syncs', async () => {
    const downloadSocket = makeSyncSocket({
      blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Offline text' } }],
    });

    await downloadOfflinePage({
      url: SYNC_URL, doc: DOC, offlineScope: SCOPE,
      socketFactory: downloadSocket.factory, signal: AbortSignal.timeout(5000),
    });

    const holder = document.createElement('div');
    const editorSocket = new ScriptedSocket();

    document.body.appendChild(holder);
    const collaboration: CollaborationConfig = {
      doc: DOC,
      offline: true,
      offlineScope: SCOPE,
      socketFactory: () => editorSocket,
    };
    const editor = new Blok({
      holder,
      server: 'https://sync.test/api/',
      collaboration,
      tools: {
        paragraph: { class: Paragraph },
        bookmark: { class: Bookmark },
      },
    });

    try {
      const ready = (await editor.isReady) as ReadyEditor;
      await waitFor(() => holder.textContent?.includes('Offline text') ?? false);

      expect(ready.readOnly.isEnabled).toBe(true);
      expect(editorSocket.readyState).toBe(0);
      expect((await ready.blocks.getById('p')?.save())?.data.text).toBe('Offline text');
    } finally {
      editor.destroy();
      holder.remove();
    }
  });
});

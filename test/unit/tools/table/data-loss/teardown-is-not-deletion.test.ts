/**
 * Closing the editor must not delete what a container tool holds. A real
 * delete of the container must still take its children with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Core } from '../../../../../src/components/core';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
import type { API, OutputBlockData, OutputData } from '../../../../../types';
import type { BlockToolConstructable } from '../../../../../types/tools';
import { htmlOf, savedAsHtml } from '../../../helpers/saved-as-html';

const LINEAGE = '0123456789abcdef0123456789abcdef';

class MockSocket {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public readonly sent: Uint8Array[] = [];

  public constructor(public readonly url: string, public readonly protocols: string[]) {}

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== 1) {
      return;
    }
    this.sent.push(data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer));
  }

  public close(): void {
    this.readyState = 3;
  }

  public open(): void {
    this.protocol = 'blok-sync.v1';
    this.readyState = 1;
    this.onopen?.({});
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }
}

const TABLE: OutputBlockData[] = [
  {
    id: 'table-1',
    type: 'table',
    data: { withHeadings: false, content: [[{ blocks: ['c00'] }, { blocks: ['c01'] }]] },
  },
  { id: 'c00', type: 'paragraph', data: { text: 'A' }, parent: 'table-1' },
  { id: 'c01', type: 'paragraph', data: { text: 'B' }, parent: 'table-1' },
];

const TOOLS = {
  bookmark: { class: Bookmark },
  paragraph: { class: Paragraph },
  table: { class: Table as unknown as BlockToolConstructable },
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
};

const waitFor = async (predicate: () => boolean, label: string, timeoutMs = 15000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const holders: HTMLElement[] = [];

const newHolder = (): HTMLElement => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  return holder;
};

const textOf = (data: OutputData | undefined, id: string): unknown =>
  htmlOf(data?.blocks.find((block) => block.id === id)?.data.text);

/** Types into the cell paragraph so the change is still inside its batch window. */
const typeInto = (holder: HTMLElement, id: string, text: string): void => {
  const editable = holder.querySelector(`[data-blok-id="${id}"] [data-blok-element-content]`)?.firstElementChild;

  if (!(editable instanceof HTMLElement)) {
    throw new Error(`no editable for ${id}`);
  }
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
};

const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    (moduleInstance as { markDestroyed?: () => void } | null | undefined)?.markDestroyed?.();
  });
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as { destroy?: () => void; listeners?: { removeAll?: () => void } } | null | undefined;

    instance?.destroy?.();
    instance?.listeners?.removeAll?.();
  });
};

const bootLive = async (server: DocumentStore): Promise<{ core: Core; socket: MockSocket }> => {
  const sockets: MockSocket[] = [];
  const collaboration: CollaborationConfig = {
    doc: 'doc-1',
    socketFactory: (url: string, protocols: string[]) => {
      const socket = new MockSocket(url, protocols);

      sockets.push(socket);

      return socket;
    },
  };
  const core = new Core({
    holder: newHolder(),
    tools: TOOLS,
    server: 'https://sync.test/api/',
    collaboration,
  });

  await core.isReady;

  const socket = sockets.at(-1);

  if (socket === undefined) {
    throw new Error('no socket was opened');
  }

  socket.open();
  socket.deliver({ type: 'control', tag: { format: 2, epoch: 0, lineage: LINEAGE } });
  socket.deliver({ type: 'syncStep2', update: server.encodeStateAsUpdate() });
  await waitFor(() => !core.moduleInstances.ReadOnly.isEnabled, 'the veto to lift');
  await settle();

  return { core, socket };
};

const roomWithTable = (): DocumentStore => {
  const server = new DocumentStore(new YBlockSerializer());

  server.fromJSON(TABLE.map((block) => ({
    id: block.id ?? '',
    type: block.type,
    data: block.data,
    ...(block.parent !== undefined ? { parent: block.parent } : {}),
  })));

  return server;
};

const relay = (socket: MockSocket, server: DocumentStore): void => {
  socket.sent.splice(0).map(decode).forEach((frame) => {
    if (frame.type === 'update') {
      server.applyRemoteUpdate(frame.update);
    }
  });
};

const serverTexts = (server: DocumentStore): unknown[] => ['c00', 'c01']
  .map((id) => server.toJSON().find((block) => block.id === id)?.data.text);

describe('closing the editor is not a deletion', { timeout: 60000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  it('the final teardown save keeps the table\'s cells, and onChange hears no removal', async () => {
    const saves: OutputData[] = [];
    const removed: string[] = [];
    const holder = newHolder();
    const blok = new Blok({
      holder,
      tools: TOOLS,
      data: { blocks: TABLE },
      onSave: (data: OutputData) => {
        saves.push(data);
      },
      onChange: (_api, events) => {
        (Array.isArray(events) ? events : [events]).forEach((event) => {
          if (event.type === 'block-removed') {
            removed.push(event.detail.target.id);
          }
        });
      },
    });

    await blok.isReady;
    await settle();
    removed.splice(0);

    typeInto(holder, 'c00', 'A typed');
    await Promise.resolve();
    blok.destroy();
    await settle();

    expect(removed).toEqual([]);
    expect(saves.length).toBeGreaterThan(0);

    const last = saves.at(-1);

    expect([textOf(last, 'c00'), textOf(last, 'c01')]).toEqual(['A typed', 'B']);
  });

  it('the final teardown persistence.save keeps the table\'s cells', async () => {
    const saved: OutputData[] = [];
    const holder = newHolder();
    const blok = new Blok({
      holder,
      tools: TOOLS,
      persistence: {
        load: () => Promise.resolve({ blocks: TABLE }),
        save: (data: OutputData) => {
          saved.push(data);

          return Promise.resolve();
        },
      },
    });

    await blok.isReady;
    await settle();

    typeInto(holder, 'c00', 'A typed');
    await Promise.resolve();
    blok.destroy();
    await settle();

    expect(saved.length).toBeGreaterThan(0);

    const last = saved.at(-1);

    expect([textOf(last, 'c00'), textOf(last, 'c01')]).toEqual(['A typed', 'B']);
  });

  it('deleting the table for real still removes its cell blocks', async () => {
    const blok = new Blok({ holder: newHolder(), tools: TOOLS, data: { blocks: TABLE } }) as Blok & Pick<API, 'blocks'> & { save: () => Promise<OutputData> };

    await blok.isReady;
    await settle();

    await blok.blocks.delete(0, false);
    await settle();

    const saved: OutputData = savedAsHtml(await blok.save());
    const ids = saved.blocks.map((block) => block.id);

    expect(ids.filter((id) => id === 'table-1' || id === 'c00' || id === 'c01')).toEqual([]);
    blok.destroy();
  });

  it('teardown writes nothing to the local Yjs document that the offline cache or outbox could journal', async () => {
    const server = roomWithTable();
    const { core, socket } = await bootLive(server);

    relay(socket, server);

    const shadow = new DocumentStore(new YBlockSerializer());

    shadow.applyRemoteUpdate(server.encodeStateAsUpdate());

    const updates: Uint8Array[] = [];

    core.moduleInstances.YjsManager.onAnyDocUpdate((update) => {
      updates.push(update);
    });

    destroyCore(core);
    await settle();
    updates.forEach((update) => shadow.applyRemoteUpdate(update));

    expect(serverTexts(shadow)).toEqual(['A', 'B']);
    expect(shadow.toJSON()).toEqual(server.toJSON());
    shadow.destroy();
    server.destroy();
  });

  it('a cell edit still inside its batch window reaches the shared document when the editor closes', async () => {
    const server = roomWithTable();
    const { core, socket } = await bootLive(server);

    relay(socket, server);

    typeInto(core.moduleInstances.UI.nodes.holder, 'c00', 'A typed');
    await Promise.resolve();
    relay(socket, server);
    // Not sent yet, so only the teardown flush can deliver it.
    expect(serverTexts(server)).toEqual(['A', 'B']);
    destroyCore(core);
    await settle();
    relay(socket, server);

    expect(serverTexts(server)).toEqual(['A typed', 'B']);
    server.destroy();
  });

  it('deleting the table for real in a collaboration session removes its cells from the shared document', async () => {
    const server = roomWithTable();
    const { core, socket } = await bootLive(server);

    relay(socket, server);

    const index = core.moduleInstances.BlockManager.getBlockIndex(
      core.moduleInstances.BlockManager.getBlockById('table-1') ?? (() => {
        throw new Error('no table');
      })()
    );

    await core.moduleInstances.BlocksAPI.methods.delete(index, false);
    await settle();
    relay(socket, server);

    expect(server.toJSON().map((block) => block.id).filter((id) => id !== undefined && ['table-1', 'c00', 'c01'].includes(id))).toEqual([]);
    destroyCore(core);
    server.destroy();
  });
});

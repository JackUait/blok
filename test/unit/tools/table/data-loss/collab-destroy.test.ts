/**
 * Closing one editor of a collaboration session must not change the shared
 * document. Driven through the public `Blok` facade and its real teardown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
import type { API } from '../../../../../types';
import type { BlockToolConstructable } from '../../../../../types/tools';

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
    // A closed WebSocket drops what it is given.
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

describe('table — closing a collaborating editor', { timeout: 60000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  it('blok.destroy() sends nothing that deletes the table\'s cell blocks from the shared document', async () => {
    const server = new DocumentStore(new YBlockSerializer());

    server.fromJSON([
      {
        id: 'table-1',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['c00'] }, { blocks: ['c01'] }]] },
      },
      { id: 'c00', type: 'paragraph', data: { text: 'A' }, parent: 'table-1' },
      { id: 'c01', type: 'paragraph', data: { text: 'B' }, parent: 'table-1' },
    ]);

    const holder = document.createElement('div');

    document.body.appendChild(holder);
    holders.push(holder);

    const sockets: MockSocket[] = [];
    const collaboration: CollaborationConfig = {
      doc: 'doc-1',
      socketFactory: (url: string, protocols: string[]) => {
        const socket = new MockSocket(url, protocols);

        sockets.push(socket);

        return socket;
      },
    };
    const blok = new Blok({
      holder,
      tools: {
        bookmark: { class: Bookmark },
        paragraph: { class: Paragraph },
        table: { class: Table as unknown as BlockToolConstructable },
      },
      server: 'https://sync.test/api/',
      collaboration,
    }) as Blok & Pick<API, 'readOnly'>;

    await blok.isReady;

    const socket = sockets.at(-1);

    if (socket === undefined) {
      throw new Error('no socket was opened');
    }

    socket.open();
    socket.deliver({ type: 'control', tag: { format: 1, epoch: 0, lineage: LINEAGE } });
    socket.deliver({ type: 'syncStep2', update: server.encodeStateAsUpdate() });
    await waitFor(() => !blok.readOnly.isEnabled, 'the veto to lift');
    await settle();

    const relay = (): void => {
      socket.sent.splice(0).map(decode).forEach((frame) => {
        if (frame.type === 'update') {
          server.applyRemoteUpdate(frame.update);
        }
      });
    };

    relay();

    const texts = (): (string | undefined)[] => ['c00', 'c01']
      .map((id) => (server.toJSON().find((block) => block.id === id)?.data as { text?: string } | undefined)?.text);

    expect(texts()).toEqual(['A', 'B']);

    blok.destroy();
    await settle();
    relay();

    expect(texts()).toEqual(['A', 'B']);
    server.destroy();
  });
});

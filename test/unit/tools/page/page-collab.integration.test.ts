/**
 * A real editor and a real Yjs peer. A peer's cache write must land in place:
 * re-creating the block re-runs resolve, and two viewers whose resolve
 * disagrees would then rewrite each other forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { PageTool } from '../../../../src/tools/page';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { OutputData } from '../../../../types';

interface YjsSide {
  getStateVector: () => Uint8Array;
  encodeStateAsUpdate: (stateVector?: Uint8Array) => Uint8Array;
  applyRemoteUpdate: (update: Uint8Array) => void;
  toJSON: () => Array<{ id?: string; data: unknown }>;
}

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  module: { yjsManager: YjsSide };
}

let editor: Runtime | undefined;
let peer: DocumentStore | undefined;
let holder: HTMLDivElement | undefined;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const settleFrame = async (): Promise<void> => {
  await settle();
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  await settle();
};

const dataOf = (side: YjsSide | DocumentStore, id: string): unknown =>
  side.toJSON().find(block => block.id === id)?.data;

describe('a page block edited by a peer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    peer?.destroy();
    await settle();
    holder?.remove();
    editor = undefined;
    peer = undefined;
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('takes the peer cache in place: no resolve, no write back', async () => {
    // This viewer's host disagrees with the peer's on purpose.
    const resolve = vi.fn().mockResolvedValue({ title: 'Mine' });
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, page: { class: PageTool, config: { resolve } } },
      data: { blocks: [{ id: 'pg', type: 'page', data: { pageId: 'p1', cache: { title: 'Mine' } } }] },
    }) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settleFrame();

    const receiver = instance.module.yjsManager;
    const other = new DocumentStore(new YBlockSerializer());

    peer = other;
    other.applyRemoteUpdate(receiver.encodeStateAsUpdate(other.getStateVector()));
    resolve.mockClear();

    const before = other.getStateVector();

    other.updateBlockData('pg', 'cache', { title: 'Theirs' });
    receiver.applyRemoteUpdate(other.encodeStateAsUpdate(receiver.getStateVector()));
    await settleFrame();
    await settle(50);
    await settleFrame();

    expect(resolve).not.toHaveBeenCalled();
    other.applyRemoteUpdate(receiver.encodeStateAsUpdate(before));
    expect(dataOf(other, 'pg')).toEqual({ pageId: 'p1', cache: { title: 'Theirs' } });
    expect(dataOf(receiver, 'pg')).toEqual({ pageId: 'p1', cache: { title: 'Theirs' } });
    expect(holder?.querySelector('[data-blok-testid="page-title"]')?.textContent).toBe('Theirs');
  }, 30_000);
});

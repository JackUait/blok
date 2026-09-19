/**
 * Regression, jsdom twin of "a peer editing the same paragraph leaves the local
 * caret where it was" in `test/playwright/tests/modules/collaboration.spec.ts`.
 *
 * A peer's edit to the block the local user has their caret in used to throw
 * that caret to the start of the block: `BlockYjsSync.handleYjsUpdate` hands
 * every remote update to `block.setData`, which rewrites the tool's content
 * wholesale and detaches the text node the selection anchored into. The caret
 * is now read before the rewrite and put back after it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlokConfig } from '../../../../../types';
import { Core } from '../../../../../src/components/core';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Header } from '../../../../../src/tools/header';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';

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
    this.sent.push(data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer));
  }

  public close(): void {
    this.readyState = 3;
  }

  public open(protocol = 'blok-sync.v1'): void {
    this.protocol = protocol;
    this.readyState = 1;
    this.onopen?.({});
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }
}

const controlFrame = (): SyncWireFrame => ({
  type: 'control',
  tag: { format: 1, epoch: 0, lineage: LINEAGE },
});

const waitFor = async (predicate: () => boolean, label = 'condition', timeoutMs = 2000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const holders: HTMLElement[] = [];
const booted: Core[] = [];

const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const destroy = (moduleInstance as { destroy?: () => void }).destroy;

    if (typeof destroy === 'function') {
      try {
        destroy.call(moduleInstance);
      } catch {
        /* teardown is best effort */
      }
    }
  });
};

interface Booted {
  core: Core;
  socket: MockSocket;
  peer: DocumentStore;
  holder: HTMLElement;
}

/**
 * Boot an editor that is already synced with one peer holding `blocks`.
 * @param docName - the collaboration document id
 * @param tools - the tool classes to register
 * @param blocks - the document the peer starts from
 */
const boot = async (
  docName: string,
  tools: BlokConfig['tools'],
  blocks: { id: string; type: string; data: Record<string, unknown> }[]
): Promise<Booted> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const sockets: MockSocket[] = [];
  const collaboration = {
    doc: docName,
    socketFactory: (url: string, protocols: string[]) => {
      const socket = new MockSocket(url, protocols);

      sockets.push(socket);

      return socket;
    },
  } as unknown as CollaborationConfig;

  const core = new Core({
    holder,
    minHeight: 50,
    tools,
    server: 'https://sync.test/api/',
    collaboration,
  });

  await core.isReady;
  booted.push(core);

  const socket = sockets.at(-1);

  if (socket === undefined) {
    throw new Error('no socket was opened');
  }

  const peer = new DocumentStore(new YBlockSerializer());

  peer.fromJSON(blocks);

  socket.open();
  socket.deliver(controlFrame());
  socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate(core.moduleInstances.YjsManager.getStateVector()) });

  await waitFor(() => core.moduleInstances.BlockManager.blocks.length === blocks.length, 'the first sync');

  return { core, socket, peer, holder };
};

/**
 * Put a collapsed caret `offset` characters into `editable`'s first text node.
 * @param editable - the element holding the text
 * @param offset - character offset inside its first text node
 */
const putCaret = (editable: HTMLElement, offset: number): Node => {
  const textNode = editable.firstChild;

  if (textNode === null) {
    throw new Error('the block rendered no text node');
  }

  const selection = document.getSelection();

  if (selection === null) {
    throw new Error('jsdom has no selection');
  }

  const range = document.createRange();

  range.setStart(textNode, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  return textNode;
};

/**
 * A local edit the peer has not seen, left in both places a real keystroke
 * leaves it: in the live text node (so the caret's own node survives, the way
 * it does when a user types) and in the local document.
 *
 * The document half goes through `YjsManager.updateBlockData` — the call
 * `BlockManager.flushBlockDataWrites` makes when the mutation write buffer
 * closes its window. A local-origin write is filtered out of the sync, so it
 * never re-renders the block, which is exactly what typing does.
 * @param core - the booted editor
 * @param blockId - the block being typed into
 * @param editable - the element holding the text
 * @param appended - the characters the local user types at the end
 */
const typeLocallyAtEnd = (
  core: Core,
  blockId: string,
  editable: HTMLElement,
  appended: string
): void => {
  const textNode = editable.firstChild;

  if (textNode === null || textNode.nodeType !== Node.TEXT_NODE) {
    throw new Error('the block rendered no text node to type into');
  }

  const typed = textNode as Text;

  typed.insertData(typed.length, appended);

  if (!core.moduleInstances.YjsManager.updateBlockData(blockId, 'text', typed.data)) {
    throw new Error(`the local write for ${blockId} never reached the document`);
  }
};

/** What the live selection looks like, in the terms this defect is about. */
const readCaret = (holder: HTMLElement): Record<string, unknown> => {
  const live = document.getSelection();

  return {
    anchorInsideBlock: live !== null && live.rangeCount > 0 && holder.contains(live.anchorNode),
    anchorNode: live?.anchorNode?.nodeName ?? null,
    anchorText: live?.anchorNode?.textContent ?? null,
    // The node the caret HELD cannot survive: the update is applied by
    // rewriting the tool's content wholesale. What must survive is the caret —
    // a live text node, at the same character.
    anchorStillAttached: live?.anchorNode?.isConnected ?? false,
    offset: live?.anchorOffset ?? null,
    rangeCount: live?.rangeCount ?? 0,
  };
};

describe('a remote edit to the block the caret sits in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
  });

  it('leaves the local caret inside the block', async () => {
    const { core, socket, peer, holder } = await boot(
      'doc-caret',
      { paragraph: { class: Paragraph },
        bookmark: { class: Bookmark } },
      [{ id: 'b1', type: 'paragraph', data: { text: 'hello world' } }]
    );

    const block = core.moduleInstances.BlockManager.blocks[0];
    const editable = block.pluginsContent;

    // jsdom does not reflect `element.contentEditable = 'true'` onto the
    // attribute, and `DataPersistenceManager.setData` gates its in-place
    // innerHTML path on `getAttribute('contenteditable') === 'true'`. Without
    // this line the jsdom run silently exercises the RECREATE path instead of
    // the branch a browser takes. Compensating for the gap, not staging the bug.
    editable.setAttribute('contenteditable', 'true');

    await waitFor(() => (holder.textContent ?? '').includes('hello world'), 'the synced text to render');

    // The local user types first, and the peer never receives it: the update
    // that lands below is built on 'hello world', not on what this editor
    // holds. Both edits are after the caret, so the character it sits on is
    // the same one before and after the merge.
    typeLocallyAtEnd(core, 'b1', editable, ' now');

    putCaret(editable, 5);

    const before = readCaret(holder);

    expect(before.offset).toBe(5);

    peer.updateBlockData('b1', 'text', 'hello brave world');
    socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate(core.moduleInstances.YjsManager.getStateVector()) });
    peer.destroy();

    await waitFor(() => (holder.textContent ?? '').includes('brave'), "the peer's text");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Content before caret: a rewrite that threw the local typing away would
    // keep the caret perfectly and still have lost what the user wrote.
    expect(holder.textContent).toContain(' now');
    expect(holder.textContent).toContain('brave');

    expect(readCaret(holder), `caret before the peer's edit: ${JSON.stringify(before)}`).toEqual({
      anchorInsideBlock: true,
      anchorNode: '#text',
      anchorText: 'hello brave world now',
      anchorStillAttached: true,
      offset: 5,
      rangeCount: 1,
    });
    expect(core.moduleInstances.BlockManager.blocks[0].pluginsContent).toBe(editable);
  }, 30_000);

  // Header brings its OWN setData, so it never reaches the contenteditable
  // fast path paragraph takes. The caret is preserved around the setData CALL,
  // which is why one place covers both.
  it('leaves the caret alone in a tool that has its own setData', async () => {
    const { core, socket, peer, holder } = await boot(
      'doc-caret-header',
      { paragraph: { class: Paragraph },
        header: { class: Header },
        bookmark: { class: Bookmark } },
      [{ id: 'h1', type: 'header', data: { text: 'hello world', level: 2 } }]
    );

    const block = core.moduleInstances.BlockManager.blocks[0];
    const editable = block.pluginsContent;

    // Same jsdom contentEditable gap as above: without the attribute the
    // heading is not discoverable as one of the block's inputs at all.
    editable.setAttribute('contenteditable', 'true');

    await waitFor(() => (holder.textContent ?? '').includes('hello world'), 'the synced text to render');

    // Same divergence as above: local typing the peer never saw.
    typeLocallyAtEnd(core, 'h1', editable, ' now');

    putCaret(editable, 5);

    peer.updateBlockData('h1', 'text', 'hello brave world');
    socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate(core.moduleInstances.YjsManager.getStateVector()) });
    peer.destroy();

    await waitFor(() => (holder.textContent ?? '').includes('brave'), "the peer's text");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(holder.textContent).toContain(' now');
    expect(holder.textContent).toContain('brave');

    expect(readCaret(holder)).toEqual({
      anchorInsideBlock: true,
      anchorNode: '#text',
      anchorText: 'hello brave world now',
      anchorStillAttached: true,
      offset: 5,
      rangeCount: 1,
    });
  }, 30_000);

  it('does not rewrite the block when the update carries the data it already holds', async () => {
    const { core, socket, peer } = await boot(
      'doc-caret-equal',
      { paragraph: { class: Paragraph },
        bookmark: { class: Bookmark } },
      [{ id: 'b1', type: 'paragraph', data: { text: 'hello world' } }]
    );

    const block = core.moduleInstances.BlockManager.blocks[0];
    const setData = vi.spyOn(block, 'setData');

    peer.applyRemoteUpdate(core.moduleInstances.YjsManager.encodeStateAsUpdate());
    // A peer touching a key OUTSIDE the block's data: the update event fires,
    // the data is byte-identical to what this block was rendered with, so
    // there is nothing to rewrite and no caret to lose. No local edit is
    // staged before it: this is the ONE case where the two documents agreeing
    // is the premise, not something the test is hiding.
    peer.updateBlockMetadata('b1', Date.now(), 'someone-else');
    socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate(core.moduleInstances.YjsManager.getStateVector()) });
    peer.destroy();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(setData).not.toHaveBeenCalled();
  }, 30_000);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Core } from '../../../../src/components/core';
import type { CollaborationConfig } from '../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import { DatabaseTool } from '../../../../src/tools/database';
import type { AutofillSettings, DatabaseAutofillRequest, DatabaseConfig, PropertyValue } from '../../../../src/tools/database/types';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { BlockToolConstructable } from '../../../../types/tools';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: { yjsManager: { stopCapturing: () => void } };
}

const sleep = (ms = 0): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const quiet = async (): Promise<void> => {
  await sleep();
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await sleep();
};

/** Past the 500 ms settle of a fill on edit. */
const pastSettle = (): Promise<void> => sleep(650);

const answer = vi.fn((_request: DatabaseAutofillRequest): Promise<PropertyValue> => Promise.resolve('A summary'));

const summary = (settings: AutofillSettings): OutputBlockData => ({
  id: 'db',
  type: 'database',
  data: {
    schema: [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
      { id: 's', name: 'Summary', type: 'text', position: 'a2', autofill: settings },
    ],
    views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['notes', 's'] }],
    activeViewId: 'v',
  },
  content: ['r1', 'r2', 'tpl'],
});

const doc = (settings: AutofillSettings): OutputBlockData[] => [
  summary(settings),
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' }, content: ['c1'] },
  { id: 'c1', type: 'paragraph', parent: 'r1', data: { text: 'first body' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' }, content: ['c2'] },
  { id: 'c2', type: 'paragraph', parent: 'r2', data: { text: 'second body' } },
  { id: 'tpl', type: 'database-row', parent: 'db', data: { properties: { t: 'Template' }, position: 'a2', template: true }, content: ['ct'] },
  { id: 'ct', type: 'paragraph', parent: 'tpl', data: { text: 'template body' } },
];

const CONTENT: AutofillSettings = { mode: 'summary', onEditContent: true };

// The cover picker positions itself with elementFromPoint, which jsdom lacks.
if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const config = { ai: { autofill: answer } } satisfies DatabaseConfig;

  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: { class: DatabaseTool, config }, 'database-row': DatabaseRowTool },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const openRow = async (rowId: string): Promise<void> => {
  editor?.blocks.getById('db')?.call('openRow', { rowId });
  await quiet();
};

const editableOf = (id: string): HTMLElement => {
  const blockHolder = document.querySelector<HTMLElement>(`[data-blok-element][data-blok-id="${id}"]`);
  // jsdom does not reflect the contentEditable property to the attribute.
  const editable = blockHolder === null
    ? undefined
    : Array.from(blockHolder.querySelectorAll<HTMLElement>('*'))
      .find((element) => element.contentEditable === 'true' && element.closest('[data-blok-id]') === blockHolder);

  if (editable === undefined) throw new Error(`no editable for ${id}`);

  return editable;
};

/** Types into a body paragraph with the caret in it, then closes the history step. */
const typeInto = async (instance: TestEditor, id: string, text: string): Promise<void> => {
  const editable = editableOf(id);

  editable.focus();
  const range = document.createRange();

  range.selectNodeContents(editable);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await sleep(50);
  editable.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  await sleep(500);
  instance.module.yjsManager.stopCapturing();
};

const calls = (): Array<{ rowId: string; propertyId: string }> =>
  answer.mock.calls.map(([request]) => ({ rowId: request.rowId, propertyId: request.propertyId }));

const summaryOf = async (rowId: string): Promise<unknown> => {
  const block = (await editor?.save())?.blocks.find((candidate) => candidate.id === rowId);

  return (block?.data as { properties?: Record<string, unknown> } | undefined)?.properties?.s;
};

// Real timers: each settle waits 650 ms, so a test runs for seconds.
describe('AI Autofill — when page content is edited', { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    editor = undefined;
    await sleep();
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('a body edit fills that row once it settles; undo, redo and the fill\'s own write fill nothing more', async () => {
    const instance = await make(doc(CONTENT));

    await openRow('r1');
    await pastSettle();
    // Loading the document and opening the page are not edits.
    expect(calls()).toEqual([]);

    await typeInto(instance, 'c1', 'Beta is a red bicycle.');
    await pastSettle();
    expect(calls()).toEqual([{ rowId: 'r1', propertyId: 's' }]);
    expect(answer.mock.calls[0]?.[0].settings).toEqual(CONTENT);
    await quiet();
    expect(await summaryOf('r1')).toBe('A summary');
    await pastSettle();
    expect(calls()).toHaveLength(1);

    instance.history.undo();
    await quiet();
    await pastSettle();
    instance.history.undo();
    await quiet();
    await pastSettle();
    expect(calls()).toHaveLength(1);

    instance.history.redo();
    await quiet();
    await pastSettle();
    expect(calls()).toHaveLength(1);
  });

  it('a second body edit fills again', async () => {
    const instance = await make(doc(CONTENT));

    await openRow('r1');
    await typeInto(instance, 'c1', 'Beta is a red bicycle.');
    await pastSettle();
    await typeInto(instance, 'c1', 'Beta is a red bicycle. It is blue now.');
    await pastSettle();
    expect(calls()).toEqual([{ rowId: 'r1', propertyId: 's' }, { rowId: 'r1', propertyId: 's' }]);
  });

  it('a property edit with only the page content trigger on fills nothing; a body edit still does', async () => {
    const instance = await make(doc(CONTENT));

    instance.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'a note' } });
    await quiet();
    await pastSettle();
    expect(calls()).toEqual([]);

    await openRow('r1');
    await typeInto(instance, 'c1', 'Body text');
    await pastSettle();
    expect(calls()).toEqual([{ rowId: 'r1', propertyId: 's' }]);
  });

  it('with the switch off, a body edit fills nothing', async () => {
    const instance = await make(doc({ mode: 'summary', onEdit: true }));

    await openRow('r1');
    await typeInto(instance, 'c1', 'Body text');
    await pastSettle();
    expect(calls()).toEqual([]);
  });

  it('a template\'s body is not a page: editing it fills nothing', async () => {
    const instance = await make(doc(CONTENT));

    await openRow('r1');
    await typeInto(instance, 'c1', 'Body text');
    await pastSettle();
    expect(calls()).toEqual([{ rowId: 'r1', propertyId: 's' }]);
    await instance.blocks.update('ct', { text: 'template edit' });
    await quiet();
    await pastSettle();
    expect(calls()).toHaveLength(1);
  });

  it('opening a legacy body (it converts into blocks) fills nothing', async () => {
    await make([
      {
        ...summary(CONTENT),
        data: {
          ...summary(CONTENT).data,
          schema: [
            ...(summary(CONTENT).data as { schema: unknown[] }).schema,
            { id: 'd', name: 'Card details', type: 'richText', position: 'a3' },
          ],
        },
        content: ['r1'],
      },
      {
        id: 'r1',
        type: 'database-row',
        parent: 'db',
        data: {
          properties: { t: 'Old', d: { blocks: [{ id: 'x', type: 'paragraph', data: { text: 'legacy one' } }] } },
          position: 'a0',
        },
      },
    ]);
    await openRow('r1');
    await pastSettle();
    expect(editor?.blocks.getChildren('r1').length).toBeGreaterThan(0);
    expect(calls()).toEqual([]);
  });
});

class MockSocket {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public readonly sent: Uint8Array[] = [];

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    if (this.readyState !== 1) return;
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

interface LiveClient {
  core: Core;
  answer: ReturnType<typeof vi.fn>;
  takeSent: () => Uint8Array[];
  receive: (update: Uint8Array) => void;
}

describe('AI Autofill — page content edits from a peer', { timeout: 30000 }, () => {
  const holders: HTMLElement[] = [];
  const booted: Core[] = [];
  const server = { store: new DocumentStore(new YBlockSerializer()) };

  const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
    const deadline = Date.now() + 15000;

    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await sleep(10);
    }
  };

  const bootLive = async (): Promise<LiveClient> => {
    const liveHolder = document.createElement('div');
    const sockets: MockSocket[] = [];
    const own = vi.fn((_request: DatabaseAutofillRequest): Promise<PropertyValue> => Promise.resolve('A summary'));
    const collaboration: CollaborationConfig = {
      doc: 'doc-1',
      socketFactory: () => {
        const socket = new MockSocket();

        sockets.push(socket);

        return socket;
      },
    };

    document.body.appendChild(liveHolder);
    holders.push(liveHolder);
    const core = new Core({
      holder: liveHolder,
      minHeight: 50,
      dataModel: 'hierarchical',
      tools: {
        // Collaboration boot needs a bookmark tool.
        bookmark: { class: Bookmark },
        paragraph: { class: Paragraph },
        database: { class: DatabaseTool as unknown as BlockToolConstructable, config: { ai: { autofill: own } } },
        'database-row': { class: DatabaseRowTool as unknown as BlockToolConstructable },
      },
      server: 'https://sync.test/api/',
      collaboration,
    });

    await core.isReady;
    booted.push(core);
    const socket = sockets.at(-1);

    if (socket === undefined) throw new Error('no socket');
    socket.open();
    socket.deliver({ type: 'control', tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' } });
    socket.deliver({ type: 'syncStep2', update: server.store.encodeStateAsUpdate() });
    await waitFor(() => core.moduleInstances.API.methods.blocks.getById('c1') !== null, 'the shared document');
    let read = 0;

    return {
      core,
      answer: own,
      takeSent: () => {
        const fresh = socket.sent.slice(read);

        read = socket.sent.length;

        return fresh;
      },
      receive: (update) => socket.deliver({ type: 'update', update }),
    };
  };

  /** Relays every update each client sent to the server and the other clients. */
  const pump = async (clients: LiveClient[]): Promise<void> => {
    const relay = (client: LiveClient): void => client.takeSent().map(decode).forEach((frame) => {
      if (frame.type !== 'update') return;
      server.store.applyRemoteUpdate(frame.update, 'server');
      clients.filter((other) => other !== client).forEach((other) => other.receive(frame.update));
    });

    for (let round = 0; round < 4; round++) {
      clients.forEach(relay);
      await quiet();
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    server.store = new DocumentStore(new YBlockSerializer());
    server.store.fromJSON(doc(CONTENT));
  });

  afterEach(async () => {
    booted.splice(0).forEach((core) => {
      Object.values(core.moduleInstances).forEach((moduleInstance) => {
        (moduleInstance as { markDestroyed?: () => void } | null | undefined)?.markDestroyed?.();
      });
      Object.values(core.moduleInstances).forEach((moduleInstance) => {
        const instance = moduleInstance as { destroy?: () => void; listeners?: { removeAll?: () => void } } | null | undefined;

        instance?.destroy?.();
        instance?.listeners?.removeAll?.();
      });
    });
    holders.splice(0).forEach((element) => element.remove());
    await sleep();
    vi.restoreAllMocks();
  });

  it('fills on the client that edited the body, never on the peer that received it', async () => {
    const a = await bootLive();
    const b = await bootLive();

    await pump([a, b]);
    await a.core.moduleInstances.API.methods.blocks.update('c1', { text: 'Edited by A' });
    await pump([a, b]);
    await pastSettle();
    await pump([a, b]);
    await pastSettle();

    expect(a.answer).toHaveBeenCalledTimes(1);
    expect(b.answer).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { buildSdkServer } from '../../../src/mcp/sdk-server';
import { assembleMcp } from '../../../src/mcp/server';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-parse5';

import type { AssembledMcp } from '../../../src/mcp/server';
import type { BlokCustomToolsFile } from '../../../types/tool-manifest';

const REQ = { timeout: 20_000, maxTotalTimeout: 20_000 };
const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };

/** A host's inline tool, declared the way its class declares `static sanitize`. */
const manifest = {
  formatVersion: 1,
  blocks: [],
  inlineTools: [{ name: 'kbd', title: 'Keyboard', sanitize: { kbd: { 'data-key': true } } }],
} as BlokCustomToolsFile;

const KBD_TEXT = [{ text: 'Press ' }, { text: 'Ctrl', marks: { 'tag:kbd': { 'data-key': 'ctrl' } } }, { text: ' now' }];

class AckSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public sent: SyncWireFrame[] = [];
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  private sequence = 0;

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const frame = decode(bytes);

    if (frame.type === 'unknown' || frame.type === 'malformed') {
      return;
    }
    this.sent.push(frame);
    if (frame.type === 'operation') {
      this.sequence += 1;
      const ack: SyncWireFrame = { type: 'acknowledgement', lineage: frame.lineage, operationId: frame.operationId, serverSequence: String(this.sequence) };

      queueMicrotask(() => this.deliver(ack));
    }
  }

  public close(): void {
    this.readyState = 3;
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame).slice().buffer });
  }
}

interface Connected {
  call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  listed(): Promise<string>;
  close(): Promise<void>;
}

const connect = async (mcp: AssembledMcp): Promise<Connected> => {
  const server = buildSdkServer({
    tools: mcp.tools,
    instructions: mcp.instructions,
    dispatch: mcp.dispatch,
    caller: name => ({ principal: 'alice', clientName: name, scopes: null }),
    version: '0.0.0-test',
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'custom-inline', version: '1' });

  await server.connect(serverSide);
  await client.connect(clientSide, REQ);

  return {
    call: async (name, args) => {
      const result = await client.callTool({ name, arguments: args }, REQ);
      const content = result.structuredContent;

      return typeof content === 'object' && content !== null ? { ...content } : {};
    },
    listed: async () => JSON.stringify(await client.listTools(undefined, REQ)),
    close: async () => {
      await client.close();
      await server.close();
      await mcp.stop();
    },
  };
};

const handleOf = (opened: Record<string, unknown>): string => {
  if (typeof opened.handle !== 'string') {
    throw new Error(`blok_open failed: ${JSON.stringify(opened)}`);
  }

  return opened.handle;
};

const dirs: string[] = [];
const open: Connected[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(open.splice(0).map(connection => connection.close()));
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});

const storedServer = async (seed?: unknown): Promise<{ connection: Connected; saved(): unknown }> => {
  const dir = mkdtempSync(join(tmpdir(), 'blok-custom-inline-'));

  dirs.push(dir);
  if (seed !== undefined) {
    writeFileSync(join(dir, 'doc.json'), JSON.stringify(seed));
  }
  const connection = await connect(assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, manifest }));

  open.push(connection);

  return {
    connection,
    saved: () => {
      const doc: unknown = JSON.parse(readFileSync(join(dir, 'doc.json'), 'utf-8'));
      const blocks = typeof doc === 'object' && doc !== null && 'blocks' in doc && Array.isArray(doc.blocks) ? doc.blocks : [];

      return blocks.map((block: { id?: unknown; data?: { text?: unknown } }) => ({ id: block.id, text: block.data?.text }));
    },
  };
};

describe('MCP with a custom inline tool in the custom tools file (stored)', () => {
  it('keeps an existing custom mark when the agent bolds another word', async () => {
    const { connection, saved } = await storedServer({ blocks: [{ id: 'p', type: 'paragraph', data: { text: KBD_TEXT } }] });
    const handle = handleOf(await connection.call('blok_open', { documentId: 'doc', write: true }));
    const result = await connection.call('blok_execute', { handle, commands: [
      { name: 'text.format', args: { id: 'p', range: { find: 'now' }, set: { bold: true } } },
    ] });

    expect(saved()).toEqual([{ id: 'p', text: [
      { text: 'Press ' },
      { text: 'Ctrl', marks: { 'tag:kbd': { 'data-key': 'ctrl' } } },
      { text: ' ' },
      { text: 'now', marks: { bold: true } },
    ] }]);
    expect(result.warnings).toBeUndefined();
  });

  it('writes the custom mark with its declared attribute and drops an undeclared one', async () => {
    const { connection, saved } = await storedServer();
    const handle = handleOf(await connection.call('blok_open', { documentId: 'doc', write: true }));
    const result = await connection.call('blok_execute', { handle, commands: [
      { name: 'block.insert', args: { type: 'paragraph', id: 'p', data: { text: 'Press Ctrl' } } },
      { name: 'text.format', args: { id: 'p', range: { find: 'Ctrl' }, set: { 'tag:kbd': { 'data-key': 'ctrl', 'data-other': 'x' } } } },
    ] });

    expect(result.error).toBeUndefined();
    expect(saved()).toEqual([{ id: 'p', text: [{ text: 'Press ' }, { text: 'Ctrl', marks: { 'tag:kbd': { 'data-key': 'ctrl' } } }] }]);
  });

  it('accepts read text back when a stored mark carries an attribute the tool does not declare', async () => {
    const { connection, saved } = await storedServer({ blocks: [{ id: 'p', type: 'paragraph', data: { text: [
      { text: 'Ctrl', marks: { 'tag:kbd': { 'data-key': 'ctrl', 'data-old': 'x' } } },
    ] } }] });
    const handle = handleOf(await connection.call('blok_open', { documentId: 'doc', write: true }));
    const result = await connection.call('blok_execute', { handle, commands: [
      { name: 'block.update', args: { id: 'p', data: { text: [{ text: 'Ctrl', marks: { 'tag:kbd': { 'data-key': 'ctrl', 'data-old': 'x' } } }] } } },
    ] });

    expect(result.error).toBeUndefined();
    expect(saved()).toEqual([{ id: 'p', text: [{ text: 'Ctrl', marks: { 'tag:kbd': { 'data-key': 'ctrl' } } }] }]);
  });

  it('tells the model about the custom mark in the tool list and in blok_describe', async () => {
    const { connection } = await storedServer();
    const listed = await connection.listed();
    const handle = handleOf(await connection.call('blok_open', { documentId: 'doc' }));
    const described = await connection.call('blok_describe', { handle, tool: 'kbd' });

    expect(listed).toContain('"tag:kbd"');
    expect(listed).toContain('data-key');
    expect(described).toMatchObject({ inlineTool: { name: 'kbd', title: 'Keyboard', effect: { mark: 'tag:kbd' } } });
  });
});

describe('MCP with a custom inline tool in the custom tools file (live)', () => {
  it('keeps the custom mark across an unrelated edit, in what peers receive', async () => {
    const sockets: AckSocket[] = [];
    const factory: CollabSocketFactory = () => {
      const socket = new AckSocket();

      sockets.push(socket);
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.protocol = 'blok-sync.v2';
        socket.onopen?.({});
        socket.deliver({ type: 'control', tag: TAG });
        socket.deliver({ type: 'syncStep2', update: Y.encodeStateAsUpdate(new Y.Doc()) });
      });

      return socket;
    };
    const connection = await connect(assembleMcp(
      { transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync' }, manifest },
      { liveSocketFactory: factory, liveSyncTimeoutMs: 5000 }
    ));

    open.push(connection);
    const handle = handleOf(await connection.call('blok_open', { documentId: 'doc', write: true }));

    await connection.call('blok_execute', { handle, commands: [
      { name: 'block.insert', args: { type: 'paragraph', id: 'p', data: { text: KBD_TEXT } } },
    ] });
    await connection.call('blok_execute', { handle, commands: [
      { name: 'text.format', args: { id: 'p', range: { find: 'now' }, set: { bold: true } } },
    ] });
    const peer = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }));

    sockets.flatMap(socket => socket.sent).forEach(frame => {
      if (frame.type === 'operation' || frame.type === 'update') {
        peer.applyRemoteUpdate(frame.update, 'remote');
      }
    });

    // The peer store holds this rich field as the HTML its editor parses.
    expect(peer.toJSON().find(block => block.id === 'p')?.data.text).toBe('Press <kbd data-key="ctrl">Ctrl</kbd> <strong>now</strong>');
  });
});

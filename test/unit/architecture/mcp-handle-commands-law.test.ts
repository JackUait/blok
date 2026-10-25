// @vitest-environment node
/**
 * Law: a handle never refuses a command the listed blok_execute schema offers
 * without saying so. Each listed name either passes the handle's envelope
 * check or is in that handle's blok_open `unavailableCommands`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../src/components/modules/collaboration/types';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';

const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };
const caller: Caller = { principal: 'alice', clientName: 'law', scopes: null };
const REFUSALS = new Set(['COMMAND_UNAVAILABLE', 'UNKNOWN_COMMAND']);

class AckSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  private sequence = 0;

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const frame = decode(bytes);

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

const factory: CollabSocketFactory = () => {
  const socket = new AckSocket();

  queueMicrotask(() => {
    socket.readyState = 1;
    socket.protocol = 'blok-sync.v2';
    socket.onopen?.({});
    socket.deliver({ type: 'control', tag: TAG });
    socket.deliver({ type: 'syncStep2', update: new Uint8Array([0, 0]) });
  });

  return socket;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every command name the schema lets a model send: `name.enum` and `name.const` in any branch. */
const listedNames = (schema: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(schema)) {
    schema.forEach(item => listedNames(item, found));
  } else if (isRecord(schema)) {
    const name = isRecord(schema.properties) ? schema.properties.name : undefined;

    const values: unknown[] = isRecord(name) ? [...(Array.isArray(name.enum) ? name.enum : []), name.const] : [];

    values.forEach(value => typeof value === 'string' && found.add(value));
    Object.values(schema).forEach(value => listedNames(value, found));
  }

  return found;
};

const SCHEMAS = ['envelope', 'full', 'mixed'] as const;
const PAGE_TITLES = ['off', 'page-map'] as const;
const CASES = (['stored', 'live'] as const).flatMap(mode =>
  SCHEMAS.flatMap(schema => PAGE_TITLES.map(pageTitles => ({ mode, schema, pageTitles }))));

describe('MCP handle commands law', () => {
  let dir: string;
  let mcp: AssembledMcp | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'blok-mcp-law-'));
  });

  afterEach(async () => {
    await mcp?.stop();
    mcp = undefined;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each(CASES)('$mode, schema $schema, pageTitles $pageTitles: every listed command runs or is declared unavailable', async ({ mode, schema, pageTitles }) => {
    mcp = mode === 'stored'
      ? assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, schema, pageTitles })
      : assembleMcp(
        { transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync' }, schema, pageTitles },
        { liveSocketFactory: factory, liveSyncTimeoutMs: 1000 },
      );
    const execute = mcp.tools.find(tool => tool.name === 'blok_execute');
    const names = [...listedNames(execute?.inputSchema)];
    const opened = (await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, caller)).structuredContent;

    expect(opened).toMatchObject({ mode, write: true });
    const declared = new Map((Array.isArray(opened.unavailableCommands) ? opened.unavailableCommands : [])
      .flatMap(entry => isRecord(entry) && typeof entry.name === 'string' ? [[entry.name, entry.reason]] : []));
    const handle = opened.handle;
    const undeclared: string[] = [];

    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      const outcome = (await mcp.dispatch('blok_execute', { handle, commands: [{ name, args: {} }] }, caller)).structuredContent;
      const error = isRecord(outcome.error) ? outcome.error : undefined;

      if (error !== undefined && typeof error.code === 'string' && REFUSALS.has(error.code) && !declared.has(name)) {
        undeclared.push(name);
      }
    }

    expect(undeclared).toEqual([]);
    // Only listed commands are declared, each with the reason the refusal gives.
    expect([...declared.keys()].filter(name => !names.includes(name))).toEqual([]);
    expect([...declared.values()].every(reason => reason === 'runtime' || reason === 'service')).toBe(true);
  }, 30_000);
});

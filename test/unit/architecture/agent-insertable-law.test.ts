// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike } from '../../../src/components/modules/collaboration/types';
import { buildMcpContracts } from '../../../src/mcp/contract';
import type { Caller } from '../../../src/mcp/dispatcher';
import { assembleMcp } from '../../../src/mcp/server';

import { COMMANDS } from '../../../src/shared/agent';
import { buildAgentContract, buildToolManifest, PREPARES_INSERT } from '../../../src/shared/tool-manifest';
import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { snapshotWithCustomTools } from '../../../src/shared/custom-tools-file';
import { createHeadlessAgentSetup } from '../../../src/view/agent-runtime';
import { openJsonSession, openStoreSession } from '../agent/harness';
import { insertOutcome, PREPARED_CUSTOM_TOOLS } from './agent-insertable-fixtures';

import type { HostService } from '../../../types';
import type { AgentResult } from '../../../types/agent';

/**
 * The contract never says a block inserts when the runtime cannot insert it,
 * and never hides one it can: every type listed insertable inserts with
 * block.insert, every other one fails with COMMAND_UNAVAILABLE.
 */

const SERVICE_SETS: HostService[][] = [[], ['pageBackend']];
const RUNTIMES = ['node', 'node-live'] as const;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(RUNTIMES)('runtime %s', (runtime) => {
  describe.each(SERVICE_SETS.map(services => ({ services, label: services.join(',') || 'none' })))('services $label', ({ services }) => {
    const { contract } = createHeadlessAgentSetup({ runtime, services, customTools: PREPARED_CUSTOM_TOOLS });

    it.each(contract.manifest.blocks.map(block => ({ name: block.name, insertable: block.insertable })))(
      '$name (insertable: $insertable) inserts exactly when the contract says so',
      async ({ name, insertable }) => {
        const open = runtime === 'node' ? openJsonSession : openStoreSession;
        const session = open({ blocks: [] }, undefined, { names: services, impl: {} }, PREPARED_CUSTOM_TOOLS);

        try {
          const outcome = await insertOutcome(session, name);

          expect(outcome, `${name} in ${runtime} with [${services.join(', ')}]`).toBe(insertable ? 'ok' : 'COMMAND_UNAVAILABLE');
        } finally {
          await session.close();
        }
      }
    );
  });
});

describe('the runtime flag matches the applier', () => {
  it('only the editor applier prepares inserts by runtime; a headless one needs its host to prepare them', async () => {
    const { EditorApplier } = await import('../../../src/components/modules/agent/editor-applier');
    const { StoreApplier } = await import('../../../src/components/modules/agent/store-applier');

    expect(typeof EditorApplier.prototype.prepareInsert === 'function').toBe(PREPARES_INSERT.editor);
    expect(typeof Reflect.get(StoreApplier.prototype, 'prepareInsert') === 'function').toBe(PREPARES_INSERT['node-live']);
    expect(PREPARES_INSERT.node).toBe(false);
  });

  it('the editor contract keeps a prepared tool insertable, headless contracts do not', () => {
    const snapshot = snapshotWithCustomTools(buildBuiltInSnapshot({ blokVersion: 'test' }), PREPARED_CUSTOM_TOOLS);
    const manifest = buildToolManifest(snapshot);
    const insertable = (where: Parameters<typeof buildAgentContract>[2]): Record<string, boolean> => Object.fromEntries(
      buildAgentContract(manifest, COMMANDS, where).manifest.blocks
        .filter(block => (block.insertRequires?.length ?? 0) > 0)
        .map(block => [block.name, block.insertable])
    );

    expect(insertable({ runtime: 'editor', services: [] })).toEqual({ page: true, prepared: true });
    expect(insertable({ runtime: 'node', services: ['pageBackend'] })).toEqual({ page: false, prepared: false });
    expect(insertable({ runtime: 'node', services: ['pageBackend'], prepares: ['page'] })).toEqual({ page: true, prepared: false });
  });

  it('says a missing page backend is the host\'s, and a headless prepareInsert the runtime\'s', () => {
    const snapshot = snapshotWithCustomTools(buildBuiltInSnapshot({ blokVersion: 'test' }), PREPARED_CUSTOM_TOOLS);
    const manifest = buildToolManifest(snapshot);
    const reasons = (where: Parameters<typeof buildAgentContract>[2]): Record<string, unknown> => Object.fromEntries(
      buildAgentContract(manifest, COMMANDS, where).manifest.blocks
        .filter(block => (block.insertRequires?.length ?? 0) > 0)
        .map(block => [block.name, block.insertUnavailableReason])
    );

    for (const runtime of ['node', 'jint', 'node-live', 'csharp-live'] as const) {
      expect(reasons({ runtime, services: [] })).toEqual({ page: 'host', prepared: 'runtime' });
    }
    expect(reasons({ runtime: 'editor', services: [] })).toEqual({ page: undefined, prepared: undefined });
  });
});

const isResult = (value: Record<string, unknown>): value is Record<string, unknown> & AgentResult => typeof value.ok === 'boolean';

describe('blok-mcp stored with --page-titles page-map creates page documents', () => {
  const caller: Caller = { principal: 'alice', clientName: 'law', scopes: null };
  const dir = mkdtempSync(join(tmpdir(), 'blok-mcp-insertable-'));
  const { stored } = buildMcpContracts({ manifest: PREPARED_CUSTOM_TOOLS, pageTitles: 'page-map', createsPages: true });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists page as insertable and inserts it, with every other type as its contract says', async () => {
    writeFileSync(join(dir, 'doc.json'), JSON.stringify({ blocks: [] }));
    const mcp = assembleMcp({
      transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir }, pageTitles: 'page-map', manifest: PREPARED_CUSTOM_TOOLS,
    });

    try {
      const opened = (await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, caller)).structuredContent;
      const session = {
        execute: async (batch: unknown): Promise<AgentResult> => {
          const answer = (await mcp.dispatch('blok_execute', { handle: opened.handle, commands: typeof batch === 'object' && batch !== null && 'commands' in batch ? batch.commands : [] }, caller)).structuredContent;

          if (!isResult(answer)) {
            throw new Error(`blok_execute gave no result: ${JSON.stringify(answer)}`);
          }

          return answer;
        },
      };
      const outcomes: Record<string, string> = {};

      for (const { name } of stored.manifest.blocks) {
        outcomes[name] = await insertOutcome(session, name);
      }

      expect(opened.contractRevision).toBe(stored.revision);
      expect(stored.manifest.blocks.find(block => block.name === 'page')?.insertable).toBe(true);
      expect(outcomes).toEqual(Object.fromEntries(stored.manifest.blocks.map(block => [block.name, block.insertable ? 'ok' : 'COMMAND_UNAVAILABLE'])));
    } finally {
      await mcp.stop();
    }
  }, 60_000);
});

/** A sync service whose every room opens empty and acknowledges each operation. */
class EmptyRoomSocket implements WebSocketLike {
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

const emptyRooms: CollabSocketFactory = () => {
  const socket = new EmptyRoomSocket();

  queueMicrotask(() => {
    socket.readyState = 1;
    socket.protocol = 'blok-sync.v2';
    socket.onopen?.({});
    socket.deliver({ type: 'control', tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' } });
    socket.deliver({ type: 'syncStep2', update: new Uint8Array([0, 0]) });
  });

  return socket;
};

describe('blok-mcp live with --page-titles page-map creates page documents', () => {
  const caller: Caller = { principal: 'alice', clientName: 'law', scopes: null };
  // A sync URL gives live handles the version history, as assembleMcp sets it.
  const { live } = buildMcpContracts({ manifest: PREPARED_CUSTOM_TOOLS, pageTitles: 'page-map', createsPages: true, versionHistory: true });

  it('lists page as insertable and inserts it, with every other type as its contract says', async () => {
    const mcp = assembleMcp(
      { transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: 'wss://sync.test/sync' }, pageTitles: 'page-map', manifest: PREPARED_CUSTOM_TOOLS },
      { liveSocketFactory: emptyRooms, liveSyncTimeoutMs: 1000 },
    );

    try {
      const opened = (await mcp.dispatch('blok_open', { documentId: 'doc', write: true }, caller)).structuredContent;
      const session = {
        execute: async (batch: unknown): Promise<AgentResult> => {
          const answer = (await mcp.dispatch('blok_execute', { handle: opened.handle, commands: typeof batch === 'object' && batch !== null && 'commands' in batch ? batch.commands : [] }, caller)).structuredContent;

          if (!isResult(answer)) {
            throw new Error(`blok_execute gave no result: ${JSON.stringify(answer)}`);
          }

          return answer;
        },
      };
      const outcomes: Record<string, string> = {};

      for (const { name } of live.manifest.blocks) {
        outcomes[name] = await insertOutcome(session, name);
      }

      expect(opened.contractRevision).toBe(live.revision);
      expect(live.manifest.blocks.find(block => block.name === 'page')?.insertable).toBe(true);
      expect(outcomes).toEqual(Object.fromEntries(live.manifest.blocks.map(block => [block.name, block.insertable ? 'ok' : 'COMMAND_UNAVAILABLE'])));
    } finally {
      await mcp.stop();
    }
  }, 60_000);
});

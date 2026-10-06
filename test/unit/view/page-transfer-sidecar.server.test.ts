// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { createSidecarTransferHost } from '../../../src/view';
import type { PageTransferRequest, SidecarFetch, SidecarTransferLog, SidecarTransferRecord } from '../../../src/view';
import type { OutputBlockData } from '../../../types';
import { startDocEndpoint, type FixtureDocEndpoint } from '../server-conformance/doc-endpoint';
import { startServer, type RunningServer } from '../server-conformance/run-against';

/**
 * The sidecar adapter against the real C# host with --collab-journal. Opt-in
 * like the other conformance suites: BLOK_CONFORMANCE_SERVER points at a
 * built Blok.Server.Host, so a plain `yarn test` skips.
 */
const it = baseIt.skipIf(!process.env.BLOK_CONFORMANCE_SERVER);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

interface Harness {
  server: RunningServer;
  endpoint: FixtureDocEndpoint;
  directory: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withServer = async (run: (harness: Harness) => Promise<void>): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), 'blok-sidecar-transfer-'));
  const endpoint = await startDocEndpoint();
  const servers: RunningServer[] = [];

  try {
    const server = await startServer({
      args: [
        '--listen', '127.0.0.1:0',
        '--auth', 'none',
        '--storage-dir', '',
        '--rate-limit', '0',
        '--collab',
        '--collab-journal',
        '--collab-dir', directory,
        '--doc-endpoint', endpoint.url,
      ],
    });

    servers.push(server);
    await run({ server, endpoint, directory });
  } finally {
    await Promise.all(servers.map((server) => server.stop()));
    await endpoint.stop();
    await rm(directory, { recursive: true, force: true });
  }
};

const memoryLog = (): SidecarTransferLog => {
  const records = new Map<string, SidecarTransferRecord>();

  return {
    get: (operationId) => {
      const record = records.get(operationId);

      return record === undefined ? undefined : structuredClone(record);
    },
    put: (record) => {
      records.set(record.operationId, structuredClone(record));
    },
  };
};

const realFetch: SidecarFetch = (url, init) => fetch(url, init);

const hostFor = (harness: Harness, send: SidecarFetch = realFetch, log = memoryLog()) => createSidecarTransferHost({
  baseUrl: harness.server.baseUrl,
  ticketFor: () => 'unused',
  log,
  fetch: send,
});

const state = async (harness: Harness, doc: string): Promise<{ blocks: OutputBlockData[]; headers: Headers }> => {
  const response = await fetch(`${harness.server.baseUrl}/sync/${doc}/state`);
  const body: unknown = await response.json();

  if (response.status !== 200 || !isRecord(body) || !Array.isArray(body.blocks)) {
    throw new Error(`state ${doc}: HTTP ${response.status}`);
  }
  const blocks: OutputBlockData[] = body.blocks.filter(isRecord).map((block) => ({
    ...block,
    type: String(block.type),
    data: isRecord(block.data) ? block.data : {},
  }));

  return { blocks, headers: response.headers };
};

const ids = async (harness: Harness, doc: string): Promise<string[]> =>
  (await state(harness, doc)).blocks.map((block) => block.id ?? '');

const peerEdit = async (harness: Harness, doc: string, key: string, id: string, text: string): Promise<number> => {
  const response = await fetch(`${harness.server.baseUrl}/sync/${doc}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Blok-Idempotency-Key': key },
    body: JSON.stringify({ ops: [{ op: 'update', id, data: { text } }] }),
  });

  return response.status;
};

const seed = (endpoint: FixtureDocEndpoint): void => {
  endpoint.serve('source', { blocks: [
    { id: 'a', type: 'toggle', data: { text: 'A' }, content: ['a1'] },
    { id: 'a1', type: 'paragraph', parent: 'a', data: { text: 'A1' } },
    { id: 'b', type: 'paragraph', data: { text: 'B' } },
  ] });
  endpoint.serve('target', { blocks: [{ id: 't', type: 'paragraph', data: { text: 'T' } }] });
};

const move: PageTransferRequest = {
  kind: 'move-blocks',
  operationId: 'move-1',
  sourcePageId: 'source',
  targetPageId: 'target',
  rootIds: ['a'],
  place: { parentId: null, afterId: 't' },
};

describe('sidecar transfer host against the real server', () => {
  it('moves a subtree with its data unchanged and two journal receipts', async () => {
    await withServer(async (harness) => {
      seed(harness.endpoint);
      const receipt = await hostFor(harness).run(move);
      const target = await state(harness, 'target');

      expect(target.blocks.map((block) => block.id)).toEqual(['t', 'a', 'a1']);
      expect(target.blocks.slice(1)).toEqual([
        { id: 'a', type: 'toggle', data: { text: 'A' }, content: ['a1'] },
        { id: 'a1', type: 'paragraph', parent: 'a', data: { text: 'A1' } },
      ]);
      expect(await ids(harness, 'source')).toEqual(['b']);
      expect(receipt.durability.kind === 'saga' ? receipt.durability.steps.map((step) => step.doc) : []).toEqual(['target', 'source']);
    });
  });

  it('does not copy twice when the target response is lost and the run is retried', async () => {
    await withServer(async (harness) => {
      seed(harness.endpoint);
      const log = memoryLog();
      let lost = false;
      const losing: SidecarFetch = async (url, init) => {
        const response = await realFetch(url, init);

        if (!lost && init.method === 'POST' && url.includes('/sync/target/')) {
          lost = true;
          throw new TypeError('fetch failed');
        }

        return response;
      };

      await expect(hostFor(harness, losing, log).run(move)).rejects.toThrow(/fetch failed/);
      expect(await ids(harness, 'target')).toEqual(['t', 'a', 'a1']);

      await hostFor(harness, realFetch, log).run(move);

      expect(await ids(harness, 'target')).toEqual(['t', 'a', 'a1']);
      expect(await ids(harness, 'source')).toEqual(['b']);
    });
  });

  it('removes the copy, re-inserts the same IDs and succeeds after a peer edits the source (412)', async () => {
    await withServer(async (harness) => {
      seed(harness.endpoint);
      const statuses: number[] = [];
      let edited = false;
      const racing: SidecarFetch = async (url, init) => {
        if (!edited && init.method === 'POST' && url.includes('/sync/source/')) {
          edited = true;
          expect(await peerEdit(harness, 'source', 'peer-1', 'b', 'Peer')).toBe(204);
        }
        const response = await realFetch(url, init);

        statuses.push(response.status);

        return response;
      };

      await hostFor(harness, racing).run(move);
      const source = await state(harness, 'source');

      expect(await ids(harness, 'target')).toEqual(['t', 'a', 'a1']);
      expect(source.blocks.map((block) => block.id)).toEqual(['b']);
      expect(source.blocks[0]?.data.text).toBe('Peer');
      expect(statuses).toContain(412);
    });
  });

  it('moves a block under a target block that had no children', async () => {
    await withServer(async (harness) => {
      seed(harness.endpoint);
      await hostFor(harness).run({ ...move, place: { parentId: 't', afterId: null } });
      const target = await state(harness, 'target');

      expect(target.blocks.find((block) => block.id === 't')?.content).toEqual(['a']);
      expect(target.blocks.find((block) => block.id === 'a')?.parent).toBe('t');
      expect(await ids(harness, 'source')).toEqual(['b']);
    });
  });

  it('turns blocks into a never-written page, which reports a journal head', async () => {
    await withServer(async (harness) => {
      seed(harness.endpoint);
      const fresh = await state(harness, 'never-written');

      expect(fresh.blocks).toEqual([]);
      expect(fresh.headers.get('Blok-Doc-Lineage')).toBeTruthy();
      expect(fresh.headers.get('Blok-Doc-Sequence')).toBeTruthy();

      await hostFor(harness).run({
        kind: 'turn-into-page',
        operationId: 'tip-1',
        sourcePageId: 'source',
        targetPageId: 'never-written',
        rootIds: ['a'],
        pointerId: 'ptr',
      });

      expect(await ids(harness, 'never-written')).toEqual(['a', 'a1']);
      expect(await ids(harness, 'source')).toEqual(['ptr', 'b']);
    });
  });

  it('answers a stale If-Match with 412 without using up the key, and replays a committed key before If-Match', async () => {
    await withServer(async (harness) => {
      seed(harness.endpoint);
      const head = await state(harness, 'source');
      const ifMatch = `"${head.headers.get('Blok-Doc-Lineage') ?? ''}:${head.headers.get('Blok-Doc-Sequence') ?? ''}"`;
      const body = JSON.stringify({ ops: [{ op: 'update', id: 'b', data: { text: 'Mine' } }] });
      const post = (key: string, match: string): Promise<Response> => fetch(`${harness.server.baseUrl}/sync/source/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Blok-Idempotency-Key': key, 'If-Match': match },
        body,
      });

      expect(await peerEdit(harness, 'source', 'peer-1', 'a', 'Peer')).toBe(204);
      const stale = await post('k1', ifMatch);
      const fresh = await state(harness, 'source');
      const freshMatch = `"${fresh.headers.get('Blok-Doc-Lineage') ?? ''}:${fresh.headers.get('Blok-Doc-Sequence') ?? ''}"`;
      const applied = await post('k1', freshMatch);
      const replay = await post('k1', ifMatch);

      expect(stale.status).toBe(412);
      expect(applied.status).toBe(204);
      expect(replay.status).toBe(204);
      expect(replay.headers.get('Blok-Doc-Sequence')).toBe(applied.headers.get('Blok-Doc-Sequence'));
      expect(fresh.headers.get('ETag')).toBe(freshMatch);
    });
  });
});

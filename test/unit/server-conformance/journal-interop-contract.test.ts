// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it as baseIt } from 'vitest';

import { startDocEndpoint, type FixtureDocEndpoint } from './doc-endpoint';
import { sendRequest } from './http-client';
import { startServer, type RunningServer } from './run-against';

/**
 * One collaboration directory, two servers: what one host writes, the other
 * serves after a restart, and the reverse. The journal and the working set
 * are the same bytes on disk in every server (decision U8), so a deployment
 * can switch servers without losing a document, its history or its edit
 * receipts. `scripts/test-server-conformance.mjs --target interop` builds C#
 * and Go, and `--target interop-rust` builds Go and Rust; every ordered pair
 * of the servers it built runs.
 */
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const SERVER_VARIABLES = {
  csharp: 'BLOK_CONFORMANCE_CSHARP_SERVER',
  go: 'BLOK_CONFORMANCE_GO_SERVER',
  rust: 'BLOK_CONFORMANCE_RUST_SERVER',
} as const;

const KEY = 'Blok-Idempotency-Key';
const TIMEOUT_MS = 90_000;

type Target = keyof typeof SERVER_VARIABLES;

const built = (Object.keys(SERVER_VARIABLES) as Target[])
  .filter((target) => !unset(SERVER_VARIABLES[target]));

const pairs: [Target, Target][] = built.flatMap((writer) => built
  .filter((reader) => reader !== writer)
  .map((reader): [Target, Target] => [writer, reader]));

// With fewer than two servers built there is no pair; the C# and Go pair is
// still listed, skipped, so a run without the runner reports the suite.
const it = baseIt.skipIf(pairs.length === 0);

const binary = (target: Target): string => String(process.env[SERVER_VARIABLES[target]]);

const insertBody = (id: string, text: string): string => JSON.stringify({
  ops: [{ op: 'insert', id, block: { type: 'paragraph', data: { text } } }],
});

const updateBody = (id: string, text: string): string => JSON.stringify({
  ops: [{ op: 'update', id, data: { text } }],
});

let cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'blok-interop-'));

  cleanup.push(() => rm(path, { recursive: true, force: true }));

  return path;
}

async function endpoint(): Promise<FixtureDocEndpoint> {
  const started = await startDocEndpoint();

  cleanup.push(() => started.stop());

  return started;
}

async function host(target: Target, collabDirectory: string, docs: FixtureDocEndpoint, journal: boolean): Promise<RunningServer> {
  const server = await startServer({
    command: binary(target),
    args: [
      '--listen', '127.0.0.1:0',
      '--auth', 'none',
      '--storage-dir', '',
      '--rate-limit', '0',
      '--collab',
      '--collab-dir', collabDirectory,
      '--doc-endpoint', docs.url,
      ...(journal ? ['--conformance-journal'] : []),
    ],
  });
  let stopped = false;

  cleanup.push(async () => {
    if (!stopped) {
      await server.kill();
    }
  });

  return {
    ...server,
    stop: async () => {
      stopped = true;
      await server.stop();
    },
    kill: async () => {
      stopped = true;
      await server.kill();
    },
  };
}

interface Answer {
  status: number;
  headers: Record<string, string>;
  text: string;
}

const post = (server: RunningServer, path: string, key: string, body: string): Promise<Answer> =>
  sendRequest('POST', new URL(path, server.baseUrl), { headers: { [KEY]: key }, body });

const get = (server: RunningServer, path: string): Promise<Answer> =>
  sendRequest('GET', new URL(path, server.baseUrl));

/** A state answer without the export's own clock stamp, as text. */
const content = (answer: Answer): string => {
  const body = JSON.parse(answer.text) as Record<string, unknown>;

  delete body.time;

  return JSON.stringify(body);
};

/** The parts of the history list that do not depend on the clock. */
const historyShape = (text: string): unknown => {
  const body = JSON.parse(text) as {
    lineages: { lineage: string; epoch: number; format: number; current: boolean }[];
    versions: { lineage: string; sequence: number }[];
  };

  return {
    lineages: body.lineages.map(({ lineage, epoch, format, current }) => ({ lineage, epoch, format, current })),
    versions: body.versions.map(({ lineage, sequence }) => ({ lineage, sequence })),
  };
};

describe.each(pairs.length > 0 ? pairs : [['csharp', 'go'], ['go', 'csharp']] as [Target, Target][])('a journal %s wrote, served by %s', (writer, reader) => {
  it('keeps the document, its history and its edit receipts', async () => {
    const collabDirectory = await directory();
    const docs = await endpoint();

    docs.serve('doc', { blocks: [{ id: 'seed', type: 'paragraph', data: { text: 'from the host' } }] });

    const first = await host(writer, collabDirectory, docs, true);
    const one = await post(first, '/sync/doc/edit', 'k1', insertBody('b1', 'one'));
    const two = await post(first, '/sync/doc/edit', 'k2', updateBody('b1', 'two'));

    expect([one.status, one.headers['blok-doc-sequence'], two.status, two.headers['blok-doc-sequence']])
      .toEqual([204, '1', 204, '2']);

    const lineage = one.headers['blok-doc-lineage'];
    const stateBefore = await get(first, '/sync/doc/state');
    const historyBefore = await get(first, '/sync/doc/history');
    const pointBefore = await get(first, `/sync/doc/history/${lineage}/1`);

    await first.stop();

    const second = await host(reader, collabDirectory, docs, true);
    const stateAfter = await get(second, '/sync/doc/state');

    expect(stateAfter.status).toBe(200);
    expect(content(stateAfter)).toBe(content(stateBefore));
    expect(stateAfter.headers.etag).toBe(`"${lineage}:2"`);
    expect(historyShape((await get(second, '/sync/doc/history')).text)).toEqual(historyShape(historyBefore.text));

    const pointAfter = await get(second, `/sync/doc/history/${lineage}/1`);

    expect(pointAfter.text).toBe(pointBefore.text);

    // The digest the writer stored is the one the reader computes: a retry
    // gets its first receipt, and another body under the key is a conflict.
    const retry = await post(second, '/sync/doc/edit', 'k1', insertBody('b1', 'one'));
    const conflict = await post(second, '/sync/doc/edit', 'k1', insertBody('b1', 'other'));
    const three = await post(second, '/sync/doc/edit', 'k3', updateBody('b1', 'three'));

    expect([retry.status, retry.headers['blok-doc-lineage'], retry.headers['blok-doc-sequence']])
      .toEqual([204, lineage, '1']);
    expect(conflict.status).toBe(409);
    expect([three.status, three.headers['blok-doc-lineage'], three.headers['blok-doc-sequence']])
      .toEqual([204, lineage, '3']);

    const stateThree = await get(second, '/sync/doc/state');

    await second.stop();

    // And back again: the writer reads what the reader appended.
    const third = await host(writer, collabDirectory, docs, true);

    expect(content(await get(third, '/sync/doc/state'))).toBe(content(stateThree));
    expect((await post(third, '/sync/doc/edit', 'k3', updateBody('b1', 'three'))).headers['blok-doc-sequence']).toBe('3');

    await third.stop();
  }, TIMEOUT_MS);

  it('replays the tail a hard kill left behind', async () => {
    const collabDirectory = await directory();
    const docs = await endpoint();
    const first = await host(writer, collabDirectory, docs, true);

    await post(first, '/sync/doc/edit', 'k1', insertBody('b1', 'one'));
    await post(first, '/sync/doc/edit', 'k2', insertBody('b2', 'two'));

    const stateBefore = await get(first, '/sync/doc/state');

    await first.kill();

    const second = await host(reader, collabDirectory, docs, true);

    expect(content(await get(second, '/sync/doc/state'))).toBe(content(stateBefore));
    expect((await post(second, '/sync/doc/edit', 'k2', insertBody('b2', 'two'))).headers['blok-doc-sequence']).toBe('2');

    await second.stop();
  }, TIMEOUT_MS);

  // Kestrel keeps an escape that is not valid UTF-8 as written, so this id
  // is "d%FF". Read as the byte 0xFF, it would hash to another directory.
  it('finds a document whose id has an escape that is not UTF-8', async () => {
    const collabDirectory = await directory();
    const docs = await endpoint();
    const first = await host(writer, collabDirectory, docs, true);

    expect((await post(first, '/sync/d%FF/edit', 'k1', insertBody('b1', 'kept'))).status).toBe(204);

    const stateBefore = await get(first, '/sync/d%FF/state');

    await first.stop();

    const second = await host(reader, collabDirectory, docs, true);
    const stateAfter = await get(second, '/sync/d%FF/state');

    expect(content(stateAfter)).toBe(content(stateBefore));
    expect(stateAfter.headers.etag).toBe(stateBefore.headers.etag);

    await second.stop();
  }, TIMEOUT_MS);

  it('serves a working set the other wrote without a journal', async () => {
    const collabDirectory = await directory();
    const docs = await endpoint();
    const first = await host(writer, collabDirectory, docs, false);

    expect((await post(first, '/sync/doc/edit', 'k1', insertBody('b1', 'kept'))).status).toBe(204);

    const stateBefore = await get(first, '/sync/doc/state');

    await first.kill();
    // The endpoint never got the edit: only the working set holds it.
    docs.serve('doc', null);

    const second = await host(reader, collabDirectory, docs, false);

    expect(content(await get(second, '/sync/doc/state'))).toBe(content(stateBefore));

    await second.stop();
  }, TIMEOUT_MS);
});

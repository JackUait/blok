// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it as baseIt } from 'vitest';

import { startDocEndpoint, type FixtureDocEndpoint } from './doc-endpoint';
import { startFakeS3 } from './fake-s3';
import { sendRequest } from './http-client';
import { startServer, type RunningServer } from './run-against';

/**
 * The collab HTTP routes beside the sync door, black-box against the built
 * server: POST /sync/{doc}/edit, GET /sync/{doc}/state, POST
 * /sync/{doc}/reset and the five history routes. The same cases run against
 * the C# and the Go binary (scripts/test-server-conformance.mjs --target).
 */
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const it = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER'));
const suite = describe.skipIf(unset('BLOK_CONFORMANCE_SERVER'));

const ALLOWED_ORIGIN = 'https://app.example.com';
const KEY = 'Blok-Idempotency-Key';
const MAX_MESSAGE_BYTES = 1 << 20;
const LINEAGE = /^[0-9a-f]{32}$/;

interface Answer {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

/** Repeated header names go out as repeated lines. */
async function send(
  baseUrl: string,
  method: string,
  path: string,
  headers: [string, string][] = [],
  body?: Buffer | string,
): Promise<Answer> {
  const grouped: Record<string, string[]> = {};

  for (const [name, value] of headers) {
    (grouped[name] ??= []).push(value);
  }

  const answer = await sendRequest(method, new URL(path, baseUrl), {
    headers: Object.fromEntries(Object.entries(grouped).map(([name, values]) => [name, values.length === 1 ? values[0] : values])),
    body,
  });

  return { status: answer.status, headers: answer.headers, body: answer.text };
}

const insertBody = (id: string, text: string): string => JSON.stringify({
  ops: [{ op: 'insert', id, block: { type: 'paragraph', data: { text } } }],
});

const updateBody = (id: string, text: string): string => JSON.stringify({
  ops: [{ op: 'update', id, data: { text } }],
});

interface ParseCase {
  name: string;
  body?: string;
  error?: string;
}

const digestFixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/canonical-edit-digest.json', import.meta.url)),
  'utf8',
)) as { parse: ParseCase[] };

/** Every captured parser refusal small enough to send. */
const refusals = digestFixture.parse.filter((entry): entry is Required<Pick<ParseCase, 'name' | 'body' | 'error'>> & ParseCase =>
  entry.body !== undefined && entry.error !== undefined && Buffer.byteLength(entry.body) <= MAX_MESSAGE_BYTES);

interface Host {
  server: RunningServer;
  endpoint: FixtureDocEndpoint;
  directory: string;
}

async function startHost(journal: boolean, shared?: Host): Promise<Host> {
  const directory = shared?.directory ?? await mkdtemp(join(tmpdir(), 'blok-collab-http-'));
  const endpoint = shared?.endpoint ?? await startDocEndpoint();
  const server = await startServer({
    args: [
      '--listen', '127.0.0.1:0',
      '--auth', 'none',
      '--storage-dir', '',
      '--rate-limit', '0',
      '--allow-origin', ALLOWED_ORIGIN,
      '--collab',
      '--collab-dir', directory,
      '--doc-endpoint', endpoint.url,
      ...(journal ? ['--conformance-journal'] : []),
    ],
  });

  return { server, endpoint, directory };
}

async function stopHost(host: Host | undefined): Promise<void> {
  if (host === undefined) {
    return;
  }
  await host.server.stop();
  await host.endpoint.stop();
  await rm(host.directory, { recursive: true, force: true });
}

type Text = string | { text: string }[] | undefined;

/** A rich field exports as segments; the plain text is what these cases compare. */
const plain = (text: Text): string | undefined =>
  Array.isArray(text) ? text.map((segment) => segment.text).join('') : text;

const blocksOf = (body: string): { id: string; text: string | undefined }[] =>
  (JSON.parse(body) as { blocks: { id: string; data: { text?: Text } }[] }).blocks
    .map((block) => ({ id: block.id, text: plain(block.data.text) }));

suite('collab HTTP routes without a journal', () => {
  let host: Host | undefined;
  let base = '';

  beforeAll(async () => {
    host = await startHost(false);
    base = host.server.baseUrl;
  }, 60_000);

  afterAll(async () => {
    await stopHost(host);
  });

  it('refuses a document id that is not one path segment before anything else', async () => {
    const answer = await send(base, 'POST', '/sync/a%2Fb/edit', [], insertBody('b1', 'x'));

    expect(answer.status).toBe(400);
    expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(answer.body).toBe('document ids must be a single path segment\n');
  });

  it.each([
    ['no key', []],
    ['an empty key', [[KEY, '']]],
    ['two key lines', [[KEY, 'a'], [KEY, 'b']]],
    ['a key past 128 characters', [[KEY, 'k'.repeat(129)]]],
  ] as [string, [string, string][]][])('answers 400 for %s', async (_name, headers) => {
    const answer = await send(base, 'POST', '/sync/doc-keys/edit', headers, insertBody('b1', 'x'));

    expect(answer.status).toBe(400);
    expect(answer.body).toBe(`a valid ${KEY} header is required\n`);
  });

  it.each(['*', 'W/"0123456789abcdef0123456789abcdef:1"', '"0123456789abcdef0123456789abcdef:01"',
    '"0123456789abcdef0123456789abcdef:1", "0123456789abcdef0123456789abcdef:2"', '"0123456789ABCDEF0123456789abcdef:1"'])(
    'answers 400 for If-Match %s', async (tag) => {
      const answer = await send(base, 'POST', '/sync/doc-if-match/edit', [[KEY, 'k1'], ['If-Match', tag]], insertBody('b1', 'x'));

      expect(answer.status).toBe(400);
      expect(answer.body).toBe('If-Match must be one quoted "<lineage>:<sequence>" tag\n');
    },
  );

  it('counts the body, not Content-Length, against the message cap', async () => {
    const answer = await send(base, 'POST', '/sync/doc-big/edit', [[KEY, 'k1']], 'x'.repeat(MAX_MESSAGE_BYTES + 1));

    expect(answer.status).toBe(413);
    expect(answer.body).toBe(`an edit request is at most ${MAX_MESSAGE_BYTES} bytes\n`);
  });

  it('answers every captured parser refusal with 422 and the parser\'s words', async () => {
    for (const refusal of refusals) {
      const answer = await send(base, 'POST', '/sync/doc-parse/edit', [[KEY, 'k1']], Buffer.from(refusal.body, 'utf8'));

      expect({ name: refusal.name, status: answer.status, body: answer.body })
        .toEqual({ name: refusal.name, status: 422, body: `${refusal.error}\n` });
    }
  });

  it('answers 428 for If-Match on a server with no journal, before any seed', async () => {
    const answer = await send(base, 'POST', '/sync/doc-428/edit',
      [[KEY, 'k1'], ['If-Match', '"0123456789abcdef0123456789abcdef:1"']], insertBody('b1', 'x'));

    expect(answer.status).toBe(428);
    expect(answer.body).toBe('If-Match needs the operation journal, and this server keeps none\n');
    expect(host?.endpoint.puts.filter((put) => put.docId === 'doc-428')).toEqual([]);
  });

  it('applies an edit with no head, and /state serves it with no-store and no ETag', async () => {
    const edit = await send(base, 'POST', '/sync/doc-plain/edit', [[KEY, 'k1']], insertBody('b1', 'hello'));

    expect(edit.status).toBe(204);
    expect(edit.headers['blok-doc-lineage']).toBeUndefined();
    expect(edit.headers['blok-doc-sequence']).toBeUndefined();

    const state = await send(base, 'GET', '/sync/doc-plain/state');

    expect(state.status).toBe(200);
    expect(state.headers['content-type']).toBe('application/json');
    expect(state.headers['cache-control']).toBe('no-store');
    expect(state.headers.etag).toBeUndefined();
    expect(blocksOf(state.body).map((block) => [block.id, block.text])).toEqual([['b1', 'hello']]);
  });

  it('answers 501 on every history route, with no-store', async () => {
    const lineage = '0123456789abcdef0123456789abcdef';

    for (const [method, path] of [
      ['GET', '/sync/doc-plain/history'],
      ['GET', `/sync/doc-plain/history/${lineage}/0`],
      ['GET', `/sync/doc-plain/history/${lineage}/0/changes`],
      ['DELETE', `/sync/doc-plain/history/${lineage}`],
    ]) {
      const answer = await send(base, method, path);

      expect({ path, status: answer.status, body: answer.body, cache: answer.headers['cache-control'] })
        .toEqual({ path, status: 501, body: 'history needs a journal that keeps it\n', cache: 'no-store' });
    }

    const restore = await send(base, 'POST', `/sync/doc-plain/history/${lineage}/0/restore`, [[KEY, 'r1']]);

    expect([restore.status, restore.body]).toEqual([501, 'history needs a journal that keeps it\n']);
  });

  it('resets a document: 204, and the next state is the endpoint\'s again', async () => {
    host?.endpoint.serve('doc-reset', { blocks: [{ id: 'seed', type: 'paragraph', data: { text: 'from the host' } }] });

    const reset = await send(base, 'POST', '/sync/doc-reset/reset');

    expect([reset.status, reset.body]).toEqual([204, '']);

    const state = await send(base, 'GET', '/sync/doc-reset/state');

    expect(blocksOf(state.body).map((block) => block.id)).toEqual(['seed']);
  });
});

suite('collab HTTP routes on a journal', () => {
  let host: Host | undefined;
  let base = '';

  beforeAll(async () => {
    host = await startHost(true);
    base = host.server.baseUrl;
  }, 60_000);

  afterAll(async () => {
    await stopHost(host);
  });

  it('answers an edit with its head, a retry with the same receipt, and another body under the key with 409', async () => {
    const first = await send(base, 'POST', '/sync/doc-keys/edit', [[KEY, 'k1']], insertBody('b1', 'one'));

    expect(first.status).toBe(204);
    expect(first.headers['blok-doc-lineage']).toMatch(LINEAGE);
    expect(first.headers['blok-doc-sequence']).toBe('1');

    const retry = await send(base, 'POST', '/sync/doc-keys/edit', [[KEY, 'k1']], insertBody('b1', 'one'));

    expect([retry.status, retry.headers['blok-doc-lineage'], retry.headers['blok-doc-sequence']])
      .toEqual([204, first.headers['blok-doc-lineage'], '1']);

    const conflict = await send(base, 'POST', '/sync/doc-keys/edit', [[KEY, 'k1']], insertBody('b1', 'two'));

    expect([conflict.status, conflict.body]).toEqual([409, 'the idempotency key was already used for a different edit\n']);
  });

  it('serves state with an ETag an If-Match accepts, 412 on a stale head, and exposes the head to a CORS page', async () => {
    await send(base, 'POST', '/sync/doc-head/edit', [[KEY, 'k1']], insertBody('b1', 'one'));

    const state = await send(base, 'GET', '/sync/doc-head/state', [['Origin', ALLOWED_ORIGIN]]);
    const lineage = state.headers['blok-doc-lineage'];

    expect(state.status).toBe(200);
    expect(lineage).toMatch(LINEAGE);
    expect(state.headers['blok-doc-sequence']).toBe('1');
    expect(state.headers.etag).toBe(`"${String(lineage)}:1"`);
    expect(state.headers['cache-control']).toBe('no-store');
    expect(state.headers['access-control-expose-headers']).toBe('Blok-Doc-Lineage, Blok-Doc-Sequence, ETag');

    const stale = await send(base, 'POST', '/sync/doc-head/edit',
      [[KEY, 'k2'], ['If-Match', `"${String(lineage)}:0"`]], updateBody('b1', 'two'));

    expect([stale.status, stale.body, stale.headers['blok-doc-sequence']])
      .toEqual([412, 'the document is no longer at the If-Match head\n', '1']);

    const guarded = await send(base, 'POST', '/sync/doc-head/edit',
      [[KEY, 'k3'], ['If-Match', String(state.headers.etag)]], updateBody('b1', 'two'));

    expect([guarded.status, guarded.headers['blok-doc-sequence']]).toEqual([204, '2']);
  });

  it('answers an edit that changes nothing with the current head and records nothing under its key', async () => {
    await send(base, 'POST', '/sync/doc-noop/edit', [[KEY, 'k1']], insertBody('b1', 'same'));

    const noop = await send(base, 'POST', '/sync/doc-noop/edit', [[KEY, 'k2']], updateBody('b1', 'same'));

    expect([noop.status, noop.headers['blok-doc-sequence']]).toEqual([204, '1']);

    // The key was not recorded, so another body under it is applied, not a 409.
    const reuse = await send(base, 'POST', '/sync/doc-noop/edit', [[KEY, 'k2']], updateBody('b1', 'changed'));

    expect([reuse.status, reuse.headers['blok-doc-sequence']]).toEqual([204, '2']);
  });

  describe('history', () => {
    let lineage = '';

    beforeAll(async () => {
      await send(base, 'POST', '/sync/doc-history/edit', [[KEY, 'h1']], insertBody('b1', 'first'));
      await send(base, 'POST', '/sync/doc-history/edit', [[KEY, 'h2']], insertBody('b2', 'second'));

      const third = await send(base, 'POST', '/sync/doc-history/edit', [[KEY, 'h3']], updateBody('b1', 'first, edited'));

      lineage = String(third.headers['blok-doc-lineage']);
    });

    it('lists the lineage and its versions, newest first, with the baseline last', async () => {
      const answer = await send(base, 'GET', '/sync/doc-history/history');
      const body = JSON.parse(answer.body) as {
        lineages: { lineage: string; epoch: number; format: number; createdAt: number | null; current: boolean }[];
        versions: { lineage: string; sequence: number; startedAt: number | null; savedAt: number | null; actors: string[] }[];
      };

      expect(answer.status).toBe(200);
      expect(answer.headers['content-type']).toBe('application/json');
      expect(answer.headers['cache-control']).toBe('no-store');
      expect(Object.keys(body)).toEqual(['lineages', 'versions']);
      expect(body.lineages.map((entry) => [entry.lineage, entry.epoch, entry.format, entry.current]))
        .toEqual([[lineage, 0, 2, true]]);
      expect(Object.keys(body.lineages[0])).toEqual(['lineage', 'epoch', 'format', 'createdAt', 'current']);
      expect(body.versions.map((version) => [version.lineage, version.sequence, version.actors]))
        .toEqual([[lineage, 3, []], [lineage, 0, []]]);
      expect(Object.keys(body.versions[0])).toEqual(['lineage', 'sequence', 'startedAt', 'savedAt', 'actors']);
      expect(typeof body.versions[0].savedAt).toBe('number');
    });

    it.each(['0', '7', '', '+1', '01x'])('refuses group=%s', async (group) => {
      const answer = await send(base, 'GET', `/sync/doc-history/history?group=${group}`);

      expect([answer.status, answer.body]).toEqual([400, 'group must be 1, 15 or 60\n']);
    });

    it('refuses a repeated group', async () => {
      const answer = await send(base, 'GET', '/sync/doc-history/history?group=1&group=1');

      expect([answer.status, answer.body]).toEqual([400, 'group must be 1, 15 or 60\n']);
    });

    // ASP.NET's query: '&' splits pairs (';' is data), names match ignoring
    // case, a bad escape stays as written, and ulong.TryParse takes trailing NULs.
    it.each(['GROUP=7', 'group=1&Group=15', 'group=1;x=1', 'group=%zz', 'group=1%00x'])(
      'reads the group query like ASP.NET: refuses ?%s',
      async (query) => {
        const answer = await send(base, 'GET', `/sync/doc-history/history?${query}`);

        expect([answer.status, answer.body]).toEqual([400, 'group must be 1, 15 or 60\n']);
      },
    );

    it.each(['GROUP=15', 'group=%31', 'group=1%00', 'group=60%00%00'])('reads the group query like ASP.NET: accepts ?%s', async (query) => {
      const answer = await send(base, 'GET', `/sync/doc-history/history?${query}`);

      expect(answer.status).toBe(200);
    });

    it('reads one point with its own time and the history head', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/${lineage}/1`, [['Origin', ALLOWED_ORIGIN]]);
      const body = JSON.parse(answer.body) as { time: number };

      expect(answer.status).toBe(200);
      expect(answer.headers['blok-history-lineage']).toBe(lineage);
      expect(answer.headers['blok-history-sequence']).toBe('1');
      expect(answer.headers.etag).toBeUndefined();
      expect(answer.headers['access-control-expose-headers']).toBe('Blok-History-Lineage, Blok-History-Sequence');
      expect(typeof body.time).toBe('number');
      expect(blocksOf(answer.body).map((block) => [block.id, block.text])).toEqual([['b1', 'first']]);
    });

    it.each([
      ['a sequence with a sign', '+1', 400, 'the sequence must be a whole number\n'],
      ['a sequence past the head', '9', 404, 'no such version\n'],
    ])('answers %s', async (_name, sequence, status, text) => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/${lineage}/${sequence}`);

      expect([answer.status, answer.body]).toEqual([status, text]);
    });

    it('answers 404 for a lineage that is not one, and for one the journal never held', async () => {
      for (const other of ['not-a-lineage', 'ffffffffffffffffffffffffffffffff']) {
        const answer = await send(base, 'GET', `/sync/doc-history/history/${other}/0`);

        expect([answer.status, answer.body]).toEqual([404, 'no such version\n']);
      }
    });

    it('lists each record\'s changes in the window, oldest first', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/${lineage}/3/changes?since=1`);
      const body = JSON.parse(answer.body) as {
        changes: { sequence: number; actor: string | null; blocks: { id: string; type: string; kind: string }[] }[];
        truncated?: boolean;
      };

      expect(answer.status).toBe(200);
      expect(answer.headers['blok-history-sequence']).toBe('3');
      expect(body.truncated).toBeUndefined();
      expect(body.changes.map((change) => [change.sequence, change.actor, change.blocks.map((block) => [block.id, block.type, block.kind])]))
        .toEqual([[2, null, [['b2', 'paragraph', 'added']]], [3, null, [['b1', 'paragraph', 'changed']]]]);
    });

    it('refuses since past the sequence', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/${lineage}/1/changes?since=2`);

      expect([answer.status, answer.body]).toEqual([400, 'since must be a whole number no greater than the sequence\n']);
    });

    it('answers an empty window when since is the sequence itself', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/${lineage}/3/changes?since=3`);

      expect([answer.status, answer.body]).toEqual([200, '{"changes":[]}']);
    });

    it.each(['SINCE=5', 'since=0;x', 'since=0&Since=0', 'since=%zz'])('reads the since query like ASP.NET: refuses ?%s', async (query) => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/${lineage}/1/changes?${query}`);

      expect([answer.status, answer.body]).toEqual([400, 'since must be a whole number no greater than the sequence\n']);
    });

    it.each(['SINCE=1', 'since=1%00'])('reads the since query like ASP.NET: accepts ?%s', async (query) => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/${lineage}/3/changes?${query}`);
      const body = JSON.parse(answer.body) as { changes: { sequence: number }[] };

      expect([answer.status, body.changes.map((change) => change.sequence)]).toEqual([200, [2, 3]]);
    });

    it('restores a point as one journalled edit, needs the key, and dedupes a retry', async () => {
      const missing = await send(base, 'POST', `/sync/doc-history/history/${lineage}/1/restore`);

      expect([missing.status, missing.body]).toEqual([400, `a valid ${KEY} header is required\n`]);

      const restore = await send(base, 'POST', `/sync/doc-history/history/${lineage}/1/restore`, [[KEY, 'r1']]);

      expect([restore.status, restore.headers['blok-doc-sequence']]).toEqual([204, '4']);

      const retry = await send(base, 'POST', `/sync/doc-history/history/${lineage}/1/restore`, [[KEY, 'r1']]);

      expect([retry.status, retry.headers['blok-doc-sequence']]).toEqual([204, '4']);

      const state = await send(base, 'GET', '/sync/doc-history/state');

      expect(blocksOf(state.body).map((block) => [block.id, block.text])).toEqual([['b1', 'first']]);
    });

    it('refuses to delete the current lineage, deletes an old one after a reset, then finds nothing', async () => {
      const current = await send(base, 'DELETE', `/sync/doc-history/history/${lineage}`);

      expect([current.status, current.body]).toEqual([409, 'the document is on this lineage; it cannot be deleted\n']);

      expect((await send(base, 'POST', '/sync/doc-history/reset')).status).toBe(204);

      const deleted = await send(base, 'DELETE', `/sync/doc-history/history/${lineage}`);

      expect([deleted.status, deleted.body]).toEqual([204, '']);

      const again = await send(base, 'DELETE', `/sync/doc-history/history/${lineage}`);

      expect([again.status, again.body]).toEqual([404, 'no such version\n']);
    });
  });
});

/** One journal record's header is 38 bytes: int32 body length, version, source, SHA-256. */
const RECORD_HEADER_BYTES = 38;

async function journalFile(directory: string, docId: string): Promise<string> {
  const journal = join(directory, `${createHash('sha256').update(docId, 'utf8').digest('hex')}.journal`);
  const names = (await readdir(journal)).filter((name) => name.startsWith('journal.'));

  if (names.length !== 1) {
    throw new Error(`${journal} holds ${names.length} journal files`);
  }

  return join(journal, names[0]);
}

function recordOffsets(journal: Buffer): number[] {
  const offsets: number[] = [];

  for (let at = 0; at < journal.length; at += RECORD_HEADER_BYTES + journal.readInt32LE(at)) {
    offsets.push(at);
  }

  return offsets;
}

suite('collab HTTP routes on a shared or damaged journal', () => {
  it('answers 503 on the edit, state and reset doors while another server holds the document, and still lists its history', async () => {
    const holder = await startHost(true);
    let other: Host | undefined;

    try {
      const edit = await send(holder.server.baseUrl, 'POST', '/sync/doc-held/edit', [[KEY, 'k1']], insertBody('b1', 'one'));

      expect(edit.status).toBe(204);
      other = await startHost(true, holder);

      const base = other.server.baseUrl;
      const unavailable = [503, 'the document is unavailable, retry\n'];

      const state = await send(base, 'GET', '/sync/doc-held/state');

      expect([state.status, state.body]).toEqual(unavailable);

      const refusedEdit = await send(base, 'POST', '/sync/doc-held/edit', [[KEY, 'k2']], insertBody('b2', 'two'));

      expect([refusedEdit.status, refusedEdit.body]).toEqual(unavailable);

      const reset = await send(base, 'POST', '/sync/doc-held/reset');

      expect([reset.status, reset.body]).toEqual(unavailable);

      // History reads take no lock.
      const history = await send(base, 'GET', '/sync/doc-held/history');
      const versions = (JSON.parse(history.body) as { versions: { sequence: number }[] }).versions;

      expect([history.status, versions.map((version) => version.sequence)]).toEqual([200, [1, 0]]);
    } finally {
      await other?.server.stop();
      await stopHost(holder);
    }
  }, 60_000);

  it('answers 500 on history and refuses state when a middle record is corrupt', async () => {
    const first = await startHost(true);
    let restarted: Host | undefined;

    try {
      for (const [key, body] of [['k1', insertBody('b1', 'one')], ['k2', insertBody('b2', 'two')], ['k3', updateBody('b1', 'three')]]) {
        expect((await send(first.server.baseUrl, 'POST', '/sync/doc-corrupt/edit', [[KEY, key]], body)).status).toBe(204);
      }

      const lineage = String((await send(first.server.baseUrl, 'GET', '/sync/doc-corrupt/state')).headers['blok-doc-lineage']);

      await first.server.kill();

      const journal = await journalFile(first.directory, 'doc-corrupt');
      const bytes = await readFile(journal);
      const offsets = recordOffsets(bytes);

      expect(offsets).toHaveLength(3);
      bytes[offsets[1] + RECORD_HEADER_BYTES + 4] ^= 0xff;
      await writeFile(journal, bytes);

      restarted = await startHost(true, first);

      const base = restarted.server.baseUrl;
      const corrupt = [500, 'a stored version could not be read\n'];
      const list = await send(base, 'GET', '/sync/doc-corrupt/history');

      expect([list.status, list.body]).toEqual(corrupt);

      const point = await send(base, 'GET', `/sync/doc-corrupt/history/${lineage}/3`);

      expect([point.status, point.body]).toEqual(corrupt);

      const changes = await send(base, 'GET', `/sync/doc-corrupt/history/${lineage}/3/changes`);

      expect([changes.status, changes.body]).toEqual(corrupt);

      const state = await send(base, 'GET', '/sync/doc-corrupt/state');

      expect([state.status, state.body]).toEqual([503, 'the document could not be loaded\n']);
    } finally {
      await restarted?.server.stop();
      await stopHost(first);
    }
  }, 60_000);
});

suite('collab history past its limits', () => {
  let host: Host | undefined;
  let base = '';

  beforeAll(async () => {
    host = await startHost(true);
    base = host.server.baseUrl;
  }, 60_000);

  afterAll(async () => {
    await stopHost(host);
  });

  it('keeps the newest 200 records of a longer window and says it truncated', async () => {
    let lineage = '';

    expect((await send(base, 'POST', '/sync/doc-many/edit', [[KEY, 'k0']], insertBody('b1', 'v0'))).status).toBe(204);

    for (let edit = 1; edit <= 201; edit++) {
      const answer = await send(base, 'POST', '/sync/doc-many/edit', [[KEY, `k${edit}`]], updateBody('b1', `v${edit}`));

      expect(answer.status).toBe(204);
      lineage = String(answer.headers['blok-doc-lineage']);
    }

    const answer = await send(base, 'GET', `/sync/doc-many/history/${lineage}/202/changes`);
    const body = JSON.parse(answer.body) as { changes: { sequence: number }[]; truncated?: boolean };
    const sequences = body.changes.map((change) => change.sequence);

    expect([answer.status, body.truncated, sequences.length, sequences[0], sequences.at(-1)])
      .toEqual([200, true, 200, 3, 202]);
    expect(Object.keys(body)).toEqual(['changes', 'truncated']);
  }, 120_000);

  it('keeps the newest records that fit 4 MiB, and always at least one', async () => {
    const big = (edit: number): string => `${String(edit).padStart(4, '0')}${'x'.repeat(30_000)}`;
    let lineage = '';

    expect((await send(base, 'POST', '/sync/doc-wide/edit', [[KEY, 'k0']], insertBody('b1', big(0)))).status).toBe(204);

    for (let edit = 1; edit <= 80; edit++) {
      const answer = await send(base, 'POST', '/sync/doc-wide/edit', [[KEY, `k${edit}`]], updateBody('b1', big(edit)));

      expect(answer.status).toBe(204);
      lineage = String(answer.headers['blok-doc-lineage']);
    }

    const answer = await send(base, 'GET', `/sync/doc-wide/history/${lineage}/81/changes`);
    const body = JSON.parse(answer.body) as { changes: { sequence: number }[]; truncated?: boolean };
    const sequences = body.changes.map((change) => change.sequence);

    expect([answer.status, body.truncated, sequences.at(-1)]).toEqual([200, true, 81]);
    expect(Buffer.byteLength(answer.body)).toBeLessThanOrEqual(4 << 20);
    expect(sequences).toEqual(Array.from({ length: 69 }, (_, index) => 13 + index));

    const one = await send(base, 'GET', `/sync/doc-wide/history/${lineage}/81/changes?since=80`);

    expect((JSON.parse(one.body) as { changes: { sequence: number }[] }).changes.map((change) => change.sequence))
      .toEqual([81]);
  }, 120_000);

  it('refuses to restore a point whose update would pass the message cap', async () => {
    const text = (block: number): string => `${String(block).padStart(4, '0')}${'y'.repeat(20_000)}`;
    const ids: string[] = [];
    let lineage = '';
    let sequence = '';

    for (let batch = 0; batch < 3; batch++) {
      const ops = Array.from({ length: 20 }, (_, index) => {
        const id = `b${batch * 20 + index}`;

        ids.push(id);

        return { op: 'insert', id, block: { type: 'paragraph', data: { text: text(batch * 20 + index) } } };
      });
      const answer = await send(base, 'POST', '/sync/doc-huge/edit', [[KEY, `k${batch}`]], JSON.stringify({ ops }));

      expect(answer.status).toBe(204);
      lineage = String(answer.headers['blok-doc-lineage']);
      sequence = String(answer.headers['blok-doc-sequence']);
    }

    const removeAll = await send(base, 'POST', '/sync/doc-huge/edit', [[KEY, 'gone']],
      JSON.stringify({ ops: ids.map((id) => ({ op: 'remove', id })) }));

    expect(removeAll.status).toBe(204);

    const restore = await send(base, 'POST', `/sync/doc-huge/history/${lineage}/${sequence}/restore`, [[KEY, 'r1']]);

    expect([restore.status, restore.body]).toEqual([413, 'collab: the restore is larger than one update may be.\n']);
  }, 120_000);
});

suite('collab working set in S3', () => {
  it('keeps the working set under the prefix and serves it again after a restart', async () => {
    const bucket = await startFakeS3(200, { stateful: true });
    const endpoint = await startDocEndpoint();
    const key = `/media/collab/${createHash('sha256').update('doc-s3', 'utf8').digest('hex')}`;
    const start = (): Promise<RunningServer> => startServer({
      args: [
        '--listen', '127.0.0.1:0',
        '--auth', 'none',
        '--storage-dir', '',
        '--rate-limit', '0',
        '--s3-endpoint', bucket.baseUrl,
        '--s3-region', 'eu-central-1',
        '--s3-bucket', 'media',
        '--s3-bucket-url', 'https://cdn.example.com/media',
        '--s3-addressing', 'path',
        '--collab',
        '--collab-s3-prefix', '/collab/',
        '--doc-endpoint', endpoint.url,
      ],
      env: { BLOK_S3_ACCESS_KEY: 'AKIAEXAMPLE', BLOK_S3_SECRET_KEY: 'conformance-secret-key' },
    });

    try {
      const first = await start();

      try {
        expect((await send(first.baseUrl, 'POST', '/sync/doc-s3/edit', [[KEY, 'k1']], insertBody('b1', 'kept'))).status)
          .toBe(204);
      } finally {
        await first.stop();
      }

      const written = bucket.requests.filter((request) => request.method === 'PUT' && request.path === key);

      expect(written.length).toBeGreaterThan(0);
      expect(written.at(-1)?.body.subarray(0, 4).toString('latin1')).toBe('BKW2');
      expect(bucket.requests.every((request) => request.path === key)).toBe(true);

      // The doc endpoint never kept the export, so only the bucket can hold the edit.
      const second = await start();

      try {
        const state = await send(second.baseUrl, 'GET', '/sync/doc-s3/state');

        expect([state.status, blocksOf(state.body)]).toEqual([200, [{ id: 'b1', text: 'kept' }]]);
      } finally {
        await second.stop();
      }
    } finally {
      await endpoint.stop();
      await bucket.stop();
    }
  }, 60_000);
});

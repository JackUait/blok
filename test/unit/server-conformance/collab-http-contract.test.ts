// @vitest-environment node

import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it as baseIt } from 'vitest';

import { startDocEndpoint, type FixtureDocEndpoint } from './doc-endpoint';
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

async function startHost(journal: boolean): Promise<Host> {
  const directory = await mkdtemp(join(tmpdir(), 'blok-collab-http-'));
  const endpoint = await startDocEndpoint();
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

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
  bodyHex?: string;
  error?: string;
}

const digestFixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/canonical-edit-digest.json', import.meta.url)),
  'utf8',
)) as { parse: ParseCase[] };

/** Every captured parser refusal small enough to send. */
const refusals = digestFixture.parse.filter((entry): entry is Required<Pick<ParseCase, 'name' | 'body' | 'error'>> & ParseCase =>
  entry.body !== undefined && entry.error !== undefined && Buffer.byteLength(entry.body) <= MAX_MESSAGE_BYTES);

/** The refusals whose body is not valid UTF-8, so the fixture keeps the bytes as hex. */
const hexRefusals = digestFixture.parse.filter((entry): entry is Required<Pick<ParseCase, 'name' | 'bodyHex' | 'error'>> & ParseCase =>
  entry.bodyHex !== undefined && entry.error !== undefined);

interface Host {
  server: RunningServer;
  endpoint: FixtureDocEndpoint;
  directory: string;
}

async function startHost(journal: boolean, shared?: Host, extra: string[] = []): Promise<Host> {
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
      ...extra,
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

  it('answers every captured raw-bytes parser refusal with 422 and the parser\'s words', async () => {
    expect(hexRefusals.length).toBeGreaterThan(0);

    for (const refusal of hexRefusals) {
      const answer = await send(base, 'POST', '/sync/doc-parse/edit', [[KEY, 'k1']], Buffer.from(refusal.bodyHex, 'hex'));

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
      ['GET', '/sync/doc-plain/history/at?time=2026-10-07T12:00:00Z'],
      ['GET', '/sync/doc-plain/history/changes'],
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

  it('refuses an HTML field past 32768 characters with 413 and writes nothing, and takes one at the cap', async () => {
    const tooLarge = await send(base, 'POST', '/sync/doc-html-cap/edit', [[KEY, 'k1']], insertBody('big', 'x'.repeat(32769)));

    expect([tooLarge.status, tooLarge.body, tooLarge.headers['retry-after']]).toEqual([
      413,
      'collab: rich text field "paragraph.text" holds 32769 HTML characters; an edit may send at most 32768.\n',
      undefined,
    ]);

    const untouched = await send(base, 'GET', '/sync/doc-html-cap/state');

    expect(blocksOf(untouched.body)).toEqual([]);

    // Sequence 1 proves the refused edit journalled nothing.
    const atCap = await send(base, 'POST', '/sync/doc-html-cap/edit', [[KEY, 'k2']], insertBody('big', 'x'.repeat(32768)));

    expect([atCap.status, atCap.headers['blok-doc-sequence']]).toEqual([204, '1']);
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

    const LONG_AGO = '2000-01-01T00:00:00Z';
    const FAR_AHEAD = '2999-01-01T00:00:00Z';

    it('reads the point at a time as JSON when the caller accepts JSON', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/at?time=${FAR_AHEAD}`, [['Accept', 'text/html, Application/JSON;q=0.9']]);
      const body = JSON.parse(answer.body) as { lineage: string; sequence: number; committedAt: number };

      expect([answer.status, answer.headers['content-type'], answer.headers['cache-control']])
        .toEqual([200, 'application/json', 'no-store']);
      expect(Object.keys(body)).toEqual(['lineage', 'sequence', 'committedAt']);
      expect([body.lineage, body.sequence, typeof body.committedAt]).toEqual([lineage, 3, 'number']);
      expect([answer.headers['blok-history-lineage'], answer.headers['blok-history-sequence']]).toEqual([lineage, '3']);
    });

    it('redirects to the point at a time, relative to the history route', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/at?time=${FAR_AHEAD}`, [['Accept', '*/*']]);

      expect([answer.status, answer.headers.location, answer.body]).toEqual([302, `${lineage}/3`, '']);
    });

    it('answers 404 not_found as JSON for a time before the history starts', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/at?time=${LONG_AGO}`, [['Accept', 'application/json']]);

      expect([answer.status, answer.headers['content-type'], answer.body])
        .toEqual([404, 'application/json', '{"reason":"not_found"}']);
    });

    it('reads the time of a record as that record, and an offset sent as %2B', async () => {
      const list = await send(base, 'GET', `/sync/doc-history/history/${lineage}/3/changes`);
      const second = (JSON.parse(list.body) as { changes: { sequence: number; committedAt: number }[] }).changes[1];
      const rows = (JSON.parse(list.body) as { changes: { sequence: number; committedAt: number }[] }).changes;
      // committedAt is whole milliseconds, so X.9999999 is past every record whose millisecond is X and
      // before every later one: the point is the newest record whose committedAt is at most X.
      const at = `${new Date(second.committedAt).toISOString().slice(0, -1)}9999%2B00:00`;
      const expected = Math.max(...rows.filter((row) => row.committedAt <= second.committedAt).map((row) => row.sequence));
      const answer = await send(base, 'GET', `/sync/doc-history/history/at?time=${at}`, [['Accept', 'application/json']]);

      expect([answer.status, JSON.parse(answer.body)]).toEqual([200, {
        lineage,
        sequence: expected,
        committedAt: rows.find((row) => row.sequence === expected)?.committedAt,
      }]);
    });

    it('reads one millisecond before the first record as the baseline', async () => {
      const list = await send(base, 'GET', `/sync/doc-history/history/${lineage}/3/changes`);
      const first = (JSON.parse(list.body) as { changes: { committedAt: number }[] }).changes[0];
      const history = JSON.parse((await send(base, 'GET', '/sync/doc-history/history')).body) as { lineages: { createdAt: number }[] };
      const at = new Date(first.committedAt - 1).toISOString();
      const answer = await send(base, 'GET', `/sync/doc-history/history/at?time=${at}`, [['Accept', 'application/json']]);

      // Only meaningful when the lineage began before that millisecond.
      expect(history.lineages[0].createdAt).toBeLessThan(first.committedAt - 1);
      expect([answer.status, (JSON.parse(answer.body) as { sequence: number }).sequence]).toEqual([200, 0]);
    });

    it('pins the 24-hour default at its edge', async () => {
      const list = await send(base, 'GET', `/sync/doc-history/history/${lineage}/3/changes`);
      const first = (JSON.parse(list.body) as { changes: { sequence: number; committedAt: number }[] }).changes[0];
      const day = 24 * 60 * 60 * 1000;
      const sequencesUpTo = async (to: number): Promise<number[]> =>
        (JSON.parse((await send(base, 'GET', `/sync/doc-history/history/changes?to=${new Date(to).toISOString()}`)).body) as {
          changes: { sequence: number }[];
        }).changes.map((change) => change.sequence);

      // from = to - 24 h. Record 1 sits in [X, X + 1 ms) where X is its committedAt.
      expect(await sequencesUpTo(first.committedAt + day)).toContain(first.sequence);
      expect(await sequencesUpTo(first.committedAt + 1 + day)).not.toContain(first.sequence);
    });

    it('answers the literal at and changes paths as GET routes: preflight, and DELETE still finds no version', async () => {
      for (const path of ['/sync/doc-history/history/at', '/sync/doc-history/history/changes']) {
        const preflight = await send(base, 'OPTIONS', path, [['Origin', ALLOWED_ORIGIN], ['Access-Control-Request-Method', 'GET']]);
        const deleted = await send(base, 'DELETE', path);

        expect([path, preflight.status, preflight.headers['access-control-allow-methods']]).toEqual([path, 204, 'GET, OPTIONS']);
        expect([path, deleted.status, deleted.body]).toEqual([path, 404, 'no such version\n']);
      }
    });

    it('redirects to the same point with or without a trailing slash', async () => {
      for (const path of ['/sync/doc-history/history/at', '/sync/doc-history/history/at/']) {
        const answer = await send(base, 'GET', `${path}?time=${FAR_AHEAD}`);

        expect([path, answer.status, new URL(String(answer.headers.location), new URL(path, base)).pathname])
          .toEqual([path, 302, `/sync/doc-history/history/${lineage}/3`]);
      }
    });

    it.each([
      ['no time', ''],
      ['no offset', '?time=2026-10-07T12:00:00'],
      ['an offset sent as a raw +, which reads as a space', '?time=2026-10-07T12:00:00+03:00'],
      ['a repeated time', `?time=${FAR_AHEAD}&time=${FAR_AHEAD}`],
      ['a number', '?time=1791552000000'],
    ])('refuses at with %s', async (_name, query) => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/at${query}`);

      expect([answer.status, answer.body]).toEqual([400, 'time must be an ISO 8601 time with an offset\n']);
    });

    it('lists the changes in a time range newest first, each with its lineage', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/changes?from=${LONG_AGO}&to=${FAR_AHEAD}`);
      const body = JSON.parse(answer.body) as {
        changes: { lineage: string; sequence: number; blocks: { id: string; kind: string }[] }[];
        truncated?: boolean;
      };

      expect([answer.status, answer.headers['cache-control'], Object.keys(body)]).toEqual([200, 'no-store', ['changes']]);
      expect(body.changes.map((change) => [change.lineage, change.sequence, change.blocks.map((block) => [block.id, block.kind])]))
        .toEqual([[lineage, 3, [['b1', 'changed']]], [lineage, 2, [['b2', 'added']]], [lineage, 1, [['b1', 'added']]]]);
      expect(Object.keys(body.changes[0])).toEqual(['lineage', 'sequence', 'committedAt', 'actor', 'blocks']);
    });

    it('defaults the range to the last 24 hours', async () => {
      const answer = await send(base, 'GET', '/sync/doc-history/history/changes');
      const recent = await send(base, 'GET', `/sync/doc-history/history/changes?to=${LONG_AGO}`);

      expect((JSON.parse(answer.body) as { changes: { sequence: number }[] }).changes.map((change) => change.sequence))
        .toEqual([3, 2, 1]);
      expect([recent.status, recent.body]).toEqual([200, '{"changes":[]}']);
    });

    it('takes before as an exclusive point', async () => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/changes?from=${LONG_AGO}&before=${lineage}:3`);

      expect((JSON.parse(answer.body) as { changes: { sequence: number }[] }).changes.map((change) => change.sequence))
        .toEqual([2, 1]);
    });

    it('answers 404 for a before lineage the journal never held', async () => {
      const answer = await send(base, 'GET', '/sync/doc-history/history/changes?before=ffffffffffffffffffffffffffffffff:1');

      expect([answer.status, answer.body]).toEqual([404, 'no such version\n']);
    });

    it.each([
      ['from after to', `?from=${FAR_AHEAD}&to=${LONG_AGO}`],
      ['from with no offset', '?from=2026-10-07T12:00:00'],
      ['a repeated to', `?to=${FAR_AHEAD}&to=${FAR_AHEAD}`],
    ])('refuses a range with %s', async (_name, query) => {
      const answer = await send(base, 'GET', `/sync/doc-history/history/changes${query}`);

      expect([answer.status, answer.body])
        .toEqual([400, 'from and to must be ISO 8601 times with an offset, from no later than to\n']);
    });

    it.each(['x', 'not-a-lineage:1', '0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef:+1'])(
      'refuses before=%s',
      async (before) => {
        const answer = await send(base, 'GET', `/sync/doc-history/history/changes?before=${before}`);

        expect([answer.status, answer.body]).toEqual([400, 'before must be one <lineage>:<sequence>\n']);
      },
    );

    it('breaks database edits down by property, schema entry and view with detail=properties', async () => {
      const title = { id: 'title', name: 'Name', type: 'title', position: 'a' };
      const status = { id: 'st', name: 'Status', type: 'status', position: 'b' };
      const view = { id: 'v1', name: 'Table', type: 'table', position: 'a', sorts: [], filters: [] };
      const database = (schema: object[], views: object[]): object => ({ schema, views, activeViewId: 'v1' });
      const edit = async (key: string, ops: object[]): Promise<string> => {
        const answer = await send(base, 'POST', '/sync/doc-database/edit', [[KEY, key]], JSON.stringify({ ops }));

        expect(answer.status).toBe(204);

        return String(answer.headers['blok-doc-lineage']);
      };

      await edit('d1', [
        { op: 'insert', id: 'db', block: { type: 'database', data: database([title], [view]) } },
        { op: 'insert', id: 'r1', parent: 'db', block: { type: 'database-row', data: { properties: { st: 'todo' } } } },
      ]);
      await edit('d2', [{ op: 'update', id: 'r1', data: { properties: { st: 'done' } } }]);
      const dbLineage = await edit('d3', [{ op: 'update', id: 'db', data: database([title, status], [{ ...view, name: 'All' }]) }]);

      type Block = { id: string; properties?: unknown; schema?: unknown; views?: unknown };
      const read = async (path: string): Promise<Block[][]> =>
        (JSON.parse((await send(base, 'GET', path)).body) as { changes: { blocks: Block[] }[] }).changes.map((change) => change.blocks);

      const plain = await read(`/sync/doc-database/history/${dbLineage}/3/changes?since=1`);

      expect(plain.flat().map((block) => Object.keys(block).filter((key) => ['properties', 'schema', 'views'].includes(key))))
        .toEqual([[], []]);

      const detailed = await read(`/sync/doc-database/history/${dbLineage}/3/changes?since=1&detail=properties`);

      expect(detailed.map((blocks) => blocks.map(({ id, properties, schema, views }) => ({ id, properties, schema, views })))).toEqual([
        [{ id: 'r1', properties: [{ id: 'st', before: 'todo', after: 'done' }], schema: undefined, views: undefined }],
        [{ id: 'db', properties: undefined, schema: [{ id: 'st', name: 'Status', action: 'created' }], views: [{ id: 'v1', action: 'updated' }] }],
      ]);

      const ignored = await read(`/sync/doc-database/history/${dbLineage}/3/changes?since=1&detail=all`);

      expect(ignored).toEqual(plain);

      const ranged = await read('/sync/doc-database/history/changes?from=2000-01-01T00:00:00Z&detail=properties');

      expect(ranged[1].map((block) => block.properties)).toEqual([[{ id: 'st', before: 'todo', after: 'done' }]]);
    });

    it.each(['detail=', 'detail=all', 'detail=properties&detail=properties'])('refuses ?%s on the range route only', async (query) => {
      const range = await send(base, 'GET', `/sync/doc-history/history/changes?${query}`);
      // The shipped route ignored unknown query keys before detail existed, and still does.
      const shipped = await send(base, 'GET', `/sync/doc-history/history/${lineage}/3/changes?${query}`);

      expect([range.status, range.body]).toEqual([400, 'detail must be properties\n']);
      expect(shipped.status).toBe(200);
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

const GUARDED_DOC = 'doc-guards';
const CONFIRM = 'X-Blok-Restore-Confirm';

/** Sequence 1 has a public form; sequence 2 locks the database and closes the form to the workspace. */
async function seedGuardedDoc(base: string): Promise<string> {
  const created = await send(base, 'POST', `/sync/${GUARDED_DOC}/edit`, [[KEY, 'g1']], JSON.stringify({
    ops: [{ op: 'insert', id: 'db', block: { type: 'database', data: {
      schema: [{ id: 't', type: 'title' }], views: [{ id: 'v1', type: 'table', form: { public: true } }],
    } } }],
  }));

  expect([created.status, created.body]).toEqual([204, '']);

  const locked = await send(base, 'POST', `/sync/${GUARDED_DOC}/edit`, [[KEY, 'g2']], JSON.stringify({
    ops: [{ op: 'update', id: 'db', data: {
      schema: [{ id: 't', type: 'title', databaseLocked: true }], views: [{ id: 'v1', type: 'table' }],
    } }],
  }));

  expect([locked.status, locked.headers['blok-doc-sequence'], locked.body]).toEqual([204, '2', '']);

  return String(locked.headers['blok-doc-lineage']);
}

const UNLOCK_AND_SHARE = [{ kind: 'unlock', blockId: 'db' }, { kind: 'share', blockId: 'db', viewId: 'v1' }];

suite('collab restore guards, off by default', () => {
  let host: Host | undefined;
  let base = '';
  let lineage = '';

  // The first edit warms the server's rich text reader: seed where the time limit is a minute.
  beforeAll(async () => {
    host = await startHost(true);
    base = host.server.baseUrl;
    lineage = await seedGuardedDoc(base);
  }, 60_000);

  afterAll(async () => {
    await stopHost(host);
  });

  it('restores a version that unlocks a database and brings back a public form, unasked', async () => {
    const restore = await send(base, 'POST', `/sync/${GUARDED_DOC}/history/${lineage}/1/restore`, [[KEY, 'r1']]);

    expect([restore.status, restore.headers['blok-doc-sequence']]).toEqual([204, '3']);
  });
});

const TRASH_DOC = 'doc-trash';

/** Sequence 1 holds paragraph a; sequence 2 adds a sub-page pointer after it. */
async function seedPagePointerDoc(base: string): Promise<string> {
  const first = await send(base, 'POST', `/sync/${TRASH_DOC}/edit`, [[KEY, 't1']], JSON.stringify({
    ops: [{ op: 'insert', id: 'a', block: { type: 'paragraph', data: { text: 'a' } } }],
  }));

  expect([first.status, first.body]).toEqual([204, '']);

  const second = await send(base, 'POST', `/sync/${TRASH_DOC}/edit`, [[KEY, 't2']], JSON.stringify({
    ops: [{ op: 'insert', id: 'pg', after: 'a', block: { type: 'page', data: { pageId: 'sub' } } }],
  }));

  expect([second.status, second.headers['blok-doc-sequence'], second.body]).toEqual([204, '2', '']);

  return String(second.headers['blok-doc-lineage']);
}

const pointerAfterRestore = async (base: string, lineage: string): Promise<Record<string, unknown> | undefined> => {
  const restore = await send(base, 'POST', `/sync/${TRASH_DOC}/history/${lineage}/1/restore`, [[KEY, 'tr1']]);

  expect([restore.status, restore.headers['blok-doc-sequence']]).toEqual([204, '3']);

  const state = JSON.parse((await send(base, 'GET', `/sync/${TRASH_DOC}/state`)).body) as {
    blocks: { id: string; data: Record<string, unknown> }[];
  };

  return state.blocks.find((block) => block.id === 'pg')?.data;
};

suite('collab restore of a later page pointer, off by default', () => {
  let host: Host | undefined;
  let base = '';
  let lineage = '';

  beforeAll(async () => {
    host = await startHost(true);
    base = host.server.baseUrl;
    lineage = await seedPagePointerDoc(base);
  }, 60_000);

  afterAll(async () => {
    await stopHost(host);
  });

  it('removes the pointer, as before', async () => {
    expect(await pointerAfterRestore(base, lineage)).toBeUndefined();
  });
});

suite('collab restore of a later page pointer, trashing on', () => {
  let host: Host | undefined;
  let base = '';
  let lineage = '';

  beforeAll(async () => {
    host = await startHost(true, undefined, ['--conformance-restore-trashes-pages']);
    base = host.server.baseUrl;
    lineage = await seedPagePointerDoc(base);
  }, 60_000);

  afterAll(async () => {
    await stopHost(host);
  });

  it('previews the pointer as changed, not removed', async () => {
    const answer = await send(base, 'POST', `/sync/${TRASH_DOC}/history/${lineage}/1/restore/preview`);
    const preview = JSON.parse(answer.body) as { wouldUndo: { blocks: { id: string; kind: string }[] }; fits: boolean };

    expect(answer.status).toBe(200);
    expect(preview.wouldUndo.blocks.map(({ id, kind }) => ({ id, kind }))).toEqual([{ id: 'pg', kind: 'changed' }]);
    expect(preview.fits).toBe(true);
  });

  it('keeps the pointer in place and sets trashed on it', async () => {
    const data = await pointerAfterRestore(base, lineage);
    const trashed = data?.trashed as Record<string, unknown> | undefined;

    expect(data?.pageId).toBe('sub');
    expect(trashed).toMatchObject({ formerParentId: null, formerIndex: 1 });
    expect(Number.isInteger(trashed?.at)).toBe(true);
    expect(Object.keys(trashed ?? {}).sort()).toEqual(['at', 'by', 'formerIndex', 'formerParentId']);
  });
});

suite('collab restore guards, enforced', () => {
  let host: Host | undefined;
  let base = '';
  let lineage = '';

  beforeAll(async () => {
    host = await startHost(true, undefined, ['--conformance-restore-guards']);
    base = host.server.baseUrl;
    lineage = await seedGuardedDoc(base);
  }, 60_000);

  afterAll(async () => {
    await stopHost(host);
  });

  const restore = (sequence: number, headers: [string, string][], body?: string): Promise<Answer> =>
    send(base, 'POST', `/sync/${GUARDED_DOC}/history/${lineage}/${sequence}/restore`, headers, body);

  const head = async (): Promise<string | undefined> =>
    (await send(base, 'GET', `/sync/${GUARDED_DOC}/state`)).headers['blok-doc-sequence'];

  it('refuses with 409, a JSON body naming every guard and the refusal header, and changes nothing', async () => {
    const answer = await restore(1, [[KEY, 'k-refused']]);

    expect(answer.status).toBe(409);
    expect(answer.headers['content-type']).toBe('application/json');
    expect(answer.headers['x-blok-restore-refusal']).toBe('confirmation_required');
    expect(answer.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(answer.body)).toEqual({ error: 'confirmation_required', guards: UNLOCK_AND_SHARE });
    expect(await head()).toBe('2');
  });

  it('still refuses when the confirm leaves out one kind present', async () => {
    const answer = await restore(1, [[KEY, 'k-partial'], [CONFIRM, 'share']]);

    expect([answer.status, answer.headers['x-blok-restore-refusal']]).toEqual([409, 'confirmation_required']);
    expect(await head()).toBe('2');
  });

  it('ignores kinds it does not know and a body that does not parse', async () => {
    const answer = await restore(1, [[KEY, 'k-unknown'], [CONFIRM, 'everything']], '{not json');

    expect([answer.status, answer.headers['x-blok-restore-refusal']]).toEqual([409, 'confirmation_required']);
  });

  it.each([
    ['an array', '[]'],
    ['a number', '5'],
    ['a repeated key', '{"confirm":["share","unlock"],"confirm":["share"]}'],
  ])('confirms nothing with a body that is %s, and still answers the JSON refusal', async (_name, body) => {
    const answer = await restore(1, [[KEY, 'k-odd-body'], [CONFIRM, 'share']], body);

    expect([answer.status, answer.headers['x-blok-restore-refusal']]).toEqual([409, 'confirmation_required']);
    expect(JSON.parse(answer.body)).toEqual({ error: 'confirmation_required', guards: UNLOCK_AND_SHARE });
  });

  it('restores once every kind is confirmed, under the key a refusal did not consume', async () => {
    const answer = await restore(1, [[KEY, 'k-refused'], [CONFIRM, 'unlock'], [CONFIRM, ' share ,lockedReshape']]);

    expect([answer.status, answer.headers['blok-doc-sequence']]).toEqual([204, '3']);
  });

  it('takes the confirm from a JSON body', async () => {
    // Back to sequence 2's state, locked with the form closed: closing the form is a share change too.
    const back = await restore(2, [[KEY, 'k-back'], [CONFIRM, 'share']]);

    expect([back.status, back.headers['blok-doc-sequence']]).toEqual([204, '4']);

    const answer = await restore(1, [[KEY, 'k-body']], JSON.stringify({ confirm: ['share', 'unlock'] }));

    expect([answer.status, answer.headers['blok-doc-sequence']]).toEqual([204, '5']);
  });

  it('names a removed locked database as lockedReshape', async () => {
    expect((await restore(2, [[KEY, 'k-relock'], [CONFIRM, 'share']])).status).toBe(204);

    const answer = await restore(0, [[KEY, 'k-empty']]);

    expect(answer.status).toBe(409);
    expect(JSON.parse(answer.body)).toEqual({ error: 'confirmation_required', guards: [{ kind: 'lockedReshape', blockId: 'db' }] });
  });

  it('keeps the key-reuse 409 plain text, without the refusal header', async () => {
    const answer = await restore(0, [[KEY, 'k-body']]);

    expect(answer.status).toBe(409);
    expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(answer.headers['x-blok-restore-refusal']).toBeUndefined();
    expect(answer.body).toBe('the idempotency key was already used for a different edit\n');
  });

  it('a retry of a committed restore gets its receipt without a confirm', async () => {
    const answer = await restore(1, [[KEY, 'k-refused']]);

    expect([answer.status, answer.headers['blok-doc-sequence']]).toEqual([204, '3']);
  });

  it('a restore that raises no guard needs no confirm', async () => {
    // Sequence 6 is k-relock (locked, form closed); restoring it over itself changes nothing a guard sees.
    const answer = await restore(6, [[KEY, 'k-same']]);

    expect(answer.status).toBe(204);
  });
});

interface Preview {
  wouldUndo: { blocks: { id: string; type: string | null; kind: string }[]; page: string[] };
  guards: { kind: string; blockId: string; viewId?: string }[];
  fits: boolean;
  frameBytes: number;
  limitBytes: number;
  expectRevision: string;
}

suite('collab restore dry run', () => {
  let host: Host | undefined;
  let base = '';
  let lineage = '';
  const DOC = 'doc-preview';

  beforeAll(async () => {
    host = await startHost(true);
    base = host.server.baseUrl;
    await send(base, 'POST', `/sync/${DOC}/edit`, [[KEY, 'p1']], insertBody('a', 'first'));
    await send(base, 'POST', `/sync/${DOC}/edit`, [[KEY, 'p2']], insertBody('b', 'second'));

    const third = await send(base, 'POST', `/sync/${DOC}/edit`, [[KEY, 'p3']], updateBody('a', 'first, edited'));

    expect([third.status, third.headers['blok-doc-sequence']]).toEqual([204, '3']);
    lineage = String(third.headers['blok-doc-lineage']);
  }, 60_000);

  afterAll(async () => {
    await stopHost(host);
  });

  const head = async (): Promise<string | undefined> =>
    (await send(base, 'GET', `/sync/${DOC}/state`)).headers['blok-doc-sequence'];

  it('answers the plan, its guards, its size and the head, writes nothing, and needs no key', async () => {
    const answer = await send(base, 'POST', `/sync/${DOC}/history/${lineage}/1/restore/preview`);

    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('application/json');
    expect(answer.headers['cache-control']).toBe('no-store');

    const preview = JSON.parse(answer.body) as Preview;

    expect(preview.wouldUndo).toEqual({
      blocks: [{ id: 'a', type: 'paragraph', kind: 'changed' }, { id: 'b', type: 'paragraph', kind: 'removed' }],
      page: [],
    });
    expect(preview.guards).toEqual([]);
    expect(preview.fits).toBe(true);
    expect(preview.frameBytes).toBeGreaterThan(0);
    expect(preview.limitBytes).toBe(MAX_MESSAGE_BYTES);
    expect(preview.expectRevision).toBe(`${lineage}:3`);
    expect(Object.keys(preview)).toEqual(['wouldUndo', 'guards', 'fits', 'frameBytes', 'limitBytes', 'expectRevision']);
    expect(await head()).toBe('3');
  });

  it('names the same blocks and kinds the real restore journals', async () => {
    const preview = JSON.parse((await send(base, 'POST', `/sync/${DOC}/history/${lineage}/1/restore/preview`)).body) as Preview;
    const restore = await send(base, 'POST', `/sync/${DOC}/history/${lineage}/1/restore`,
      [[KEY, 'p-restore'], ['If-Match', `"${preview.expectRevision}"`]]);

    expect([restore.status, restore.headers['blok-doc-sequence']]).toEqual([204, '4']);

    const changes = JSON.parse((await send(base, 'GET', `/sync/${DOC}/history/${lineage}/4/changes?since=3`)).body) as
      { changes: { blocks: { id: string; type: string | null; kind: string }[]; page?: string[] }[] };

    expect(changes.changes).toHaveLength(1);
    expect(changes.changes[0].blocks.map(({ id, type, kind }) => ({ id, type, kind }))).toEqual(preview.wouldUndo.blocks);
    expect(changes.changes[0].page ?? []).toEqual(preview.wouldUndo.page);
  });

  it('answers the guards it would raise, enforced or not', async () => {
    const seeded = await seedGuardedDoc(base);
    const answer = await send(base, 'POST', `/sync/${GUARDED_DOC}/history/${seeded}/1/restore/preview`);

    expect(answer.status).toBe(200);
    expect((JSON.parse(answer.body) as Preview).guards).toEqual(UNLOCK_AND_SHARE);
  });

  it('answers 412 with the head when If-Match is stale', async () => {
    const answer = await send(base, 'POST', `/sync/${DOC}/history/${lineage}/1/restore/preview`,
      [['If-Match', `"${lineage}:1"`]]);

    expect([answer.status, answer.headers['blok-doc-sequence']]).toEqual([412, '4']);
  });

  it('answers 404 for a point that is not there', async () => {
    const answer = await send(base, 'POST', `/sync/${DOC}/history/${lineage}/99/restore/preview`);

    expect([answer.status, answer.body]).toEqual([404, 'no such version\n']);
  });

  it('leaves the restore route as it was: a dryRun query is a real restore, which needs a key', async () => {
    const answer = await send(base, 'POST', `/sync/${DOC}/history/${lineage}/1/restore?dryRun=1`);

    expect([answer.status, answer.body]).toEqual([400, `a valid ${KEY} header is required\n`]);
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
    expect(Object.keys(body)).toEqual(['changes', 'truncated', 'olderEnd']);

    const olderEnd = (body as unknown as { olderEnd: { lineage: string; sequence: number; committedAt: number } }).olderEnd;

    expect([olderEnd.lineage, olderEnd.sequence, typeof olderEnd.committedAt]).toEqual([lineage, 3, 'number']);

    // The rest of the shipped route's window is the point before olderEnd.
    const rest = await send(base, 'GET', `/sync/doc-many/history/${lineage}/${olderEnd.sequence - 1}/changes`);
    const restBody = JSON.parse(rest.body) as { changes: { sequence: number }[]; truncated?: boolean };

    expect([restBody.truncated, restBody.changes.map((change) => change.sequence)]).toEqual([undefined, [1, 2]]);

    // Following olderEnd on the range route until it is gone reads every record once.
    const seen: number[] = [];
    let query = '?from=2000-01-01T00:00:00Z';

    for (let page = 0; page < 5; page++) {
      const next = JSON.parse((await send(base, 'GET', `/sync/doc-many/history/changes${query}`)).body) as {
        changes: { sequence: number }[];
        olderEnd?: { lineage: string; sequence: number };
      };

      seen.push(...next.changes.map((change) => change.sequence));

      if (next.olderEnd === undefined) {
        break;
      }
      query = `?from=2000-01-01T00:00:00Z&before=${next.olderEnd.lineage}:${next.olderEnd.sequence}`;
    }

    expect(seen).toEqual(Array.from({ length: 202 }, (_, index) => 202 - index));
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
    expect((body as unknown as { olderEnd: { sequence: number } }).olderEnd.sequence).toBe(13);

    const one = await send(base, 'GET', `/sync/doc-wide/history/${lineage}/81/changes?since=80`);

    expect((JSON.parse(one.body) as { changes: { sequence: number }[] }).changes.map((change) => change.sequence))
      .toEqual([81]);
  }, 120_000);

  it('answers rows that fit 4 MiB whole, with no room kept for an olderEnd it does not need', async () => {
    const MAX = 4 << 20;
    const block = (record: number, index: number, length: number): object =>
      ({ op: 'insert', id: `r${record}b${String(index).padStart(2, '0')}`, block: { type: 'paragraph', data: { text: 'x'.repeat(length) } } });
    const insert = async (record: number, lengths: number[]): Promise<string> => {
      const answer = await send(base, 'POST', '/sync/doc-edge/edit', [[KEY, `e${record}`]],
        JSON.stringify({ ops: lengths.map((length, index) => block(record, index, length)) }));

      expect(answer.status).toBe(204);

      return String(answer.headers['blok-doc-lineage']);
    };
    const BLOCK = 20_000;
    const full = Array.from({ length: 25 }, () => BLOCK);
    let lineage = '';

    for (let record = 1; record <= 7; record++) {
      lineage = await insert(record, full);
    }

    const before = await send(base, 'GET', `/sync/doc-edge/history/${lineage}/7/changes`);
    const rows = (JSON.parse(before.body) as { changes: { blocks: object[] }[]; truncated?: boolean });

    expect(rows.truncated).toBeUndefined();

    // Every row here is the same shape, so one block entry and one row overhead price the next row.
    const entry = Buffer.byteLength(JSON.stringify(rows.changes[6].blocks[0]));
    const overhead = Buffer.byteLength(JSON.stringify(rows.changes[6])) - 25 * entry - 24;
    // The old cut fits a body of MAX - 19 bytes; aim 69 under it, well inside the 125-byte reserve.
    const room = MAX - 69 - Buffer.byteLength(before.body) - 1 - overhead;
    const fullBlocks = Math.ceil(Math.max(0, room - entry) / (entry + 1));
    const last = room - fullBlocks * (entry + 1) - (entry - BLOCK);

    expect([last >= 1, last <= 30_000]).toEqual([true, true]);
    await insert(8, [...Array.from({ length: fullBlocks }, () => BLOCK), last]);

    const answer = await send(base, 'GET', `/sync/doc-edge/history/${lineage}/8/changes`);
    const body = JSON.parse(answer.body) as { changes: { sequence: number }[]; truncated?: boolean };

    expect(Buffer.byteLength(answer.body)).toBe(MAX - 69);
    expect([body.truncated, body.changes.map((change) => change.sequence)]).toEqual([undefined, [1, 2, 3, 4, 5, 6, 7, 8]]);
  }, 120_000);

  it('reads at most 8 lineages per range answer, and pages across lineages with no skips and no repeats', async () => {
    const lineages: string[] = [];

    for (let lineage = 0; lineage < 9; lineage++) {
      if (lineage > 0) {
        expect((await send(base, 'POST', '/sync/doc-lineages/reset')).status).toBe(204);
      }

      const answer = await send(base, 'POST', '/sync/doc-lineages/edit', [[KEY, `l${lineage}`]], insertBody(`b${lineage}`, `v${lineage}`));

      expect(answer.status).toBe(204);
      lineages.push(String(answer.headers['blok-doc-lineage']));
    }

    type Page = { changes: { lineage: string; sequence: number }[]; truncated?: boolean; olderEnd?: { lineage: string; sequence: number } };
    const page = async (query: string): Promise<Page> =>
      JSON.parse((await send(base, 'GET', `/sync/doc-lineages/history/changes?from=2000-01-01T00:00:00Z${query}`)).body) as Page;

    const first = await page('');

    expect([first.truncated, first.changes.length, first.olderEnd]).toEqual([true, 8, { ...first.olderEnd, lineage: lineages[1], sequence: 1 }]);

    const second = await page(`&before=${first.olderEnd?.lineage}:${first.olderEnd?.sequence}`);

    expect([second.truncated, second.olderEnd]).toEqual([undefined, undefined]);
    expect([...first.changes, ...second.changes].map((change) => change.lineage)).toEqual([...lineages].reverse());
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

    const preview = await send(base, 'POST', `/sync/doc-huge/history/${lineage}/${sequence}/restore/preview`);
    const planned = JSON.parse(preview.body) as { fits: boolean; frameBytes: number; limitBytes: number };

    expect(preview.status).toBe(200);
    expect(planned.fits).toBe(false);
    expect(planned.limitBytes).toBe(MAX_MESSAGE_BYTES);
    expect(planned.frameBytes).toBeGreaterThan(planned.limitBytes);

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

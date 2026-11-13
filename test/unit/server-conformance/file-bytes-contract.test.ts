// @vitest-environment node

// GET /file-bytes and the opt-in CORS on stored files, pinned by
// fixtures/file-bytes-responses.json. Every server must answer each case the
// same and make the same requests to the origin, in order: the PDF check,
// its cache and the forwarded Range are part of the contract.
//
// One answer carries at most 1 MiB and is read whole before it is written,
// so a client that stops reading never holds a shared fetch slot. A larger
// answer is 413 "range too large": the editor asks for ranges.

import { readFileSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it as baseIt } from 'vitest';

import { createServerRangeSource, SERVER_CHUNK_BYTES } from '../../../src/tools/file/pdf/pdf-server-transport';
import { fixturePdf, startFixtureOrigin, type FixtureOrigin } from './fixture-origin';
import { startServer, type RunningServer } from './run-against';
import type { HttpResponse } from './http-client';

const it = baseIt.skipIf(process.env.BLOK_CONFORMANCE_SERVER === undefined ||
  process.env.BLOK_CONFORMANCE_SERVER === '');

const EDITOR = 'https://editor.example.com';
const PUBLIC_URL = 'https://uploads.example.com/files/';
const SECRET = 'file-bytes-conformance-secret-0123456789';
const MODIFIED_SECONDS = Date.UTC(2026, 0, 2, 3, 4, 5) / 1000;

const STORED = {
  pdf: { key: `${'1'.repeat(32)}.pdf`, body: fixturePdf(1500) },
  text: { key: `${'2'.repeat(32)}.txt`, body: 'plain text, not a pdf\n' },
  big: { key: `${'3'.repeat(32)}.pdf`, body: fixturePdf(3000) },
  mibPlusOne: { key: `${'5'.repeat(32)}.pdf`, body: fixturePdf(2 ** 20 + 1) },
} as const;
const MISSING_KEY = `${'4'.repeat(32)}.pdf`;

// Each server the cases run against, by the name a case gives.
type ServerName = 'off' | 'on' | 'default-cap' | 'ticket' | 'rate' | 'probe-rate' | 'files-cors';

function serverArgs(name: ServerName, storage: string, origin: string): string[] {
  const local = ['--storage-dir', storage, '--public-url', PUBLIC_URL];
  const outbound = ['--conformance-origin', origin];
  const enabled = ['--conformance-file-bytes', '--conformance-file-bytes-max-bytes=2048'];

  switch (name) {
    case 'off':
      return [...local, ...outbound, '--allow-origin', EDITOR];
    case 'on':
      return [...local, ...outbound, ...enabled, '--allow-origin', EDITOR];
    case 'default-cap':
      return [...local, ...outbound, '--conformance-file-bytes'];
    case 'ticket':
      return ['--auth', 'ticket', '--storage-dir', '', ...outbound, ...enabled, '--allow-origin', EDITOR];
    case 'rate':
    case 'probe-rate':
      return ['--storage-dir', '', ...outbound, ...enabled, '--rate-limit', '1'];
    case 'files-cors':
      return [...local, '--conformance-files-cors', '--allow-origin', EDITOR];
  }
}

interface FileBytesCase {
  name: string;
  server: ServerName;
  method: string;
  /** The request path; `url`, when set, is added as ?url=, encoded. */
  path: string;
  /** `<origin>` stands for the fixture origin. */
  url?: string;
  headers: Record<string, string>;
}

interface OriginRequest {
  path: string;
  headers: Record<string, string>;
}

interface FileBytesGolden extends FileBytesCase {
  response: { status: number; headers: Record<string, string[]>; body: string };
  origin: OriginRequest[];
}

const pdfCase = (
  name: string,
  url: string | undefined,
  headers: Record<string, string> = {},
  server: ServerName = 'on',
): FileBytesCase => ({ name, server, method: 'GET', path: '/file-bytes', ...(url === undefined ? {} : { url }), headers });

const filesCase = (name: string, key: string, headers: Record<string, string>, server: ServerName): FileBytesCase =>
  ({ name, server, method: 'GET', path: `/files/${key}`, headers });

const CASES: FileBytesCase[] = [
  pdfCase('off: the route is not mapped', '<origin>/pdf/doc.pdf', {}, 'off'),
  pdfCase('no url', undefined),
  pdfCase('origin not allowed', '<origin>/pdf/doc.pdf', { Origin: 'https://evil.example' }),
  {
    name: 'preflight for Range',
    server: 'on',
    method: 'OPTIONS',
    path: '/file-bytes',
    headers: { Origin: EDITOR, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
  },
  pdfCase('remote: whole file, no cookie or authorization forwarded', '<origin>/pdf/doc.pdf', {
    Origin: EDITOR, Cookie: 'session=1', Authorization: 'Bearer x',
  }),
  pdfCase('remote: a range of a checked url goes straight through', '<origin>/pdf/doc.pdf', { Range: 'bytes=1000-1099' }),
  pdfCase('remote: an open range', '<origin>/pdf/doc.pdf', { Range: 'bytes=1400-' }),
  pdfCase('remote: a new url read from 0 is checked by its own bytes', '<origin>/pdf/doc.pdf?first=zero', {
    Range: 'bytes=0-99',
  }),
  pdfCase('remote: a new url read past 0 fetches its first 1024 bytes', '<origin>/pdf/doc.pdf?first=middle', {
    Range: 'bytes=1000-1099',
  }),
  pdfCase('remote: two ranges are not forwarded', '<origin>/pdf/doc.pdf', { Range: 'bytes=0-1,5-6' }),
  pdfCase('remote: a suffix range is not forwarded', '<origin>/pdf/doc.pdf', { Range: 'bytes=-5' }),
  pdfCase('remote: %PDF- ending at byte 1023', '<origin>/pdf/magic-1019.pdf'),
  pdfCase('remote: %PDF- starting at byte 1020', '<origin>/pdf/magic-1020.pdf'),
  pdfCase('remote: an html page', '<origin>/metadata/final/page.html'),
  pdfCase('remote: a redirect to a pdf', '<origin>/pdf/redirect', { Range: 'bytes=0-9' }),
  pdfCase('remote: upstream 404', '<origin>/pdf/missing.pdf'),
  pdfCase('remote: past the size cap', '<origin>/pdf/big.pdf'),
  pdfCase('remote: an origin that ignores Range', '<origin>/pdf/no-ranges.pdf', { Range: 'bytes=1000-1099' }),
  pdfCase('remote: a content-encoding', '<origin>/pdf/gzip.pdf'),
  pdfCase('remote: not an http url', 'javascript:alert(1)'),
  pdfCase('stored: whole file, no outbound fetch', `${PUBLIC_URL}${STORED.pdf.key}`, { Origin: EDITOR }),
  pdfCase('stored: a range', `${PUBLIC_URL}${STORED.pdf.key}`, { Range: 'bytes=1000-1099' }),
  pdfCase('stored: a query is ignored', `${PUBLIC_URL}${STORED.pdf.key}?download=1`, { Range: 'bytes=0-9' }),
  pdfCase('stored: a range past the end', `${PUBLIC_URL}${STORED.pdf.key}`, { Range: 'bytes=1500-' }),
  pdfCase('stored: not a pdf', `${PUBLIC_URL}${STORED.text.key}`),
  pdfCase('stored: past the size cap', `${PUBLIC_URL}${STORED.big.key}`),
  pdfCase('stored: missing key', `${PUBLIC_URL}${MISSING_KEY}`),
  filesCase('files: no CORS without the option', STORED.pdf.key, { Origin: EDITOR, Range: 'bytes=0-9' }, 'on'),
  pdfCase('answer cap: a remote answer over 1 MiB', '<origin>/pdf/mib-plus-one.pdf', {}, 'default-cap'),
  pdfCase('answer cap: a stored answer over 1 MiB', `${PUBLIC_URL}${STORED.mibPlusOne.key}`, {}, 'default-cap'),
  pdfCase('ticket: no pass', '<origin>/pdf/doc.pdf', { Origin: EDITOR }, 'ticket'),
  pdfCase('rate: the first request', undefined, {}, 'rate'),
  pdfCase('rate: the second request', undefined, {}, 'rate'),
  // The probe is a second fetch, charged like a redirect hop.
  pdfCase('rate: the PDF check fetch is charged', '<origin>/pdf/doc.pdf?first=rate', {
    Range: 'bytes=1000-1099',
  }, 'probe-rate'),
  filesCase('files CORS: an allowed origin', STORED.pdf.key, { Origin: EDITOR, Range: 'bytes=0-9' }, 'files-cors'),
  filesCase('files CORS: another origin', STORED.pdf.key, { Origin: 'https://evil.example', Range: 'bytes=0-9' }, 'files-cors'),
  filesCase('files CORS: no origin', STORED.pdf.key, { Range: 'bytes=0-9' }, 'files-cors'),
  filesCase('files CORS: missing key', MISSING_KEY, { Origin: EDITOR }, 'files-cors'),
];

function fixturePath(): string {
  return fileURLToPath(new URL('./fixtures/file-bytes-responses.json', import.meta.url));
}

function golden(response: HttpResponse): FileBytesGolden['response'] {
  const headers = Object.fromEntries(
    Object.entries(response.rawHeaders)
      // The wall clock, and the product name.
      .filter(([name]) => name !== 'date' && name !== 'server')
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return { status: response.status, headers, body: response.text };
}

function originRequests(origin: FixtureOrigin, from: number): OriginRequest[] {
  return origin.received.slice(from).map(({ path, headers }) => ({
    path,
    headers: Object.fromEntries(Object.entries(headers)
      .map(([name, value]): [string, string] => [name, name === 'host' ? '<origin host>' : String(value)])
      .sort(([left], [right]) => left.localeCompare(right))),
  }));
}

async function seed(directory: string): Promise<void> {
  for (const { key, body } of Object.values(STORED)) {
    const path = join(directory, key);

    await writeFile(path, body);
    await utimes(path, MODIFIED_SECONDS, MODIFIED_SECONDS);
  }
}

it('serves PDF bytes and stored-file CORS the same on every server', async () => {
  const origin = await startFixtureOrigin();
  const storage = await mkdtemp(join(tmpdir(), 'blok-file-bytes-'));
  const actual: FileBytesGolden[] = [];
  const servers = new Map<ServerName, RunningServer>();
  const serverFor = async (name: ServerName): Promise<RunningServer> => {
    const started = servers.get(name) ?? await startServer({
      args: ['--listen', '127.0.0.1:0', ...serverArgs(name, storage, origin.baseUrl)],
      env: { BLOK_SECRET: SECRET },
    });

    servers.set(name, started);

    return started;
  };

  try {
    await seed(storage);
    for (const testCase of CASES) {
      const server = await serverFor(testCase.server);
      const url = testCase.url?.split('<origin>').join(origin.baseUrl);
      const path = url === undefined ? testCase.path : `${testCase.path}?url=${encodeURIComponent(url)}`;
      const before = origin.received.length;
      const response = await server.request(testCase.method, path, { headers: testCase.headers });

      actual.push({ ...testCase, response: golden(response), origin: originRequests(origin, before) });
    }
  } finally {
    await Promise.all([...servers.values()].map((server) => server.stop()));
    await origin.stop();
    await rm(storage, { recursive: true, force: true });
  }

  const expected = JSON.parse(readFileSync(fixturePath(), 'utf8')) as FileBytesGolden[];
  const inputs = (entries: FileBytesGolden[]): FileBytesCase[] =>
    entries.map(({ response: _response, origin: _origin, ...input }) => input);

  // A case the fixture lacks would otherwise pass without an answer.
  expect(inputs(actual)).toEqual(inputs(expected));
  for (const [index, entry] of actual.entries()) {
    expect.soft(entry, entry.name).toEqual(expected[index]);
  }
}, 120_000);

// The editor's side of the contract: the preview's range reader against the
// real server. Every full chunk is exactly the 1 MiB answer cap.
it('lets the editor read a PDF over 1 MiB in ranges the server accepts', async () => {
  const origin = await startFixtureOrigin();
  const storage = await mkdtemp(join(tmpdir(), 'blok-file-bytes-reader-'));
  const key = `${'6'.repeat(32)}.pdf`;
  const stored = Buffer.from(Array.from({ length: 2 * SERVER_CHUNK_BYTES + 4321 }, (_, index) => index % 251));
  stored.write('%PDF-1.7', 0, 'latin1');
  await writeFile(join(storage, key), stored);
  const server = await startServer({
    args: ['--listen', '127.0.0.1:0', ...serverArgs('default-cap', storage, origin.baseUrl)],
    env: { BLOK_SECRET: SECRET },
  });
  const readAll = async (url: string): Promise<Buffer> => {
    const source = await createServerRangeSource(`${server.baseUrl}/file-bytes`, url, undefined, new AbortController().signal);
    if (source?.kind !== 'transport') {
      throw new Error(`expected a range transport, got ${source?.kind ?? 'null'}`);
    }

    return Buffer.concat([source.reader.initial, await source.reader.read(SERVER_CHUNK_BYTES, source.reader.length)]);
  };

  try {
    expect((await readAll(`${PUBLIC_URL}${key}`)).equals(stored)).toBe(true);
    expect((await readAll(`${origin.baseUrl}/pdf/mib-plus-one.pdf`)).toString('latin1')).toBe(fixturePdf(2 ** 20 + 1));
  } finally {
    await server.stop();
    await origin.stop();
    await rm(storage, { recursive: true, force: true });
  }
}, 120_000);

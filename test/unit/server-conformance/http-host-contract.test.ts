// @vitest-environment node

// HTTP host behaviour pinned by goldens captured from the C# host, the
// reference. Capture: BLOK_WRITE_FIXTURES=1 node scripts/test-server-conformance.mjs
// --target csharp --suite http-host-contract. Any other run compares.

import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it as baseIt } from 'vitest';

import { startFixtureOrigin } from './fixture-origin';
import { startServer, type RunningServer } from './run-against';
import type { HttpResponse } from './http-client';

const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const it = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER'));

const capturing = process.env.BLOK_WRITE_FIXTURES === '1' &&
  process.env.BLOK_CONFORMANCE_TARGET === 'csharp';

// Headers left out of a golden, each with why.
const VOLATILE_HEADERS = new Set([
  // The wall clock.
  'date',
  // Kestrel names itself; the product name is not part of the contract.
  'server',
]);

interface GoldenResponse {
  body: string;
  headers: Record<string, string[]>;
  status: number;
}

interface LocalFileCase {
  file: string;
  headers: Record<string, string | string[]>;
  method: string;
  name: string;
}

interface LocalFileGolden extends LocalFileCase {
  response: GoldenResponse;
}

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

function golden(response: HttpResponse): GoldenResponse {
  const contentType = response.headers['content-type'] ?? '';
  const boundary = /boundary=([0-9a-f]+)/.exec(contentType)?.[1];
  const normalize = (value: string): string =>
    boundary === undefined ? value : value.split(boundary).join('<boundary>');
  const headers = Object.fromEntries(
    Object.entries(response.rawHeaders)
      .filter(([name]) => !VOLATILE_HEADERS.has(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, values]) => [name, values.map(normalize)]),
  );

  return { status: response.status, headers, body: normalize(response.text) };
}

// Last-Modified truncates to the second, so the half second must not show.
const MODIFIED_SECONDS = Date.UTC(2026, 0, 2, 3, 4, 5) / 1000 + 0.5;
const TEXT = '0123456789abcdefghij';

const FILES = {
  text: '0123456789abcdef0123456789abcdef.txt',
  empty: 'fedcba9876543210fedcba9876543210.txt',
  missing: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt',
  directory: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.txt',
  unreadable: 'cccccccccccccccccccccccccccccccc.txt',
  unknownType: 'dddddddddddddddddddddddddddddddd.blokunknown',
} as const;

type FileName = keyof typeof FILES;

const EXACT = 'Fri, 02 Jan 2026 03:04:05 GMT';
const EARLIER = 'Fri, 02 Jan 2026 03:04:04 GMT';
const LATER = 'Fri, 02 Jan 2026 03:04:06 GMT';

const DATE_SPELLINGS: Record<string, string> = {
  'rfc1123': EXACT,
  'rfc850': 'Friday, 02-Jan-26 03:04:05 GMT',
  'asctime': 'Fri Jan  2 03:04:05 2026',
  'no weekday': '02 Jan 2026 03:04:05 GMT',
  'wrong weekday': 'Mon, 02 Jan 2026 03:04:05 GMT',
  'UTC zone': 'Fri, 02 Jan 2026 03:04:05 UTC',
  'numeric zone': 'Fri, 02 Jan 2026 03:04:05 +0000',
  'other zone': 'Fri, 02 Jan 2026 04:04:05 +0100',
  'lowercase': 'fri, 02 jan 2026 03:04:05 gmt',
  'single digit day': 'Fri, 2 Jan 2026 03:04:05 GMT',
  'surrounding spaces': `  ${EXACT}  `,
  'no zone': 'Fri, 02 Jan 2026 03:04:05',
  'iso': '2026-01-02T03:04:05Z',
  'garbage': 'yesterday',
};

function textCase(name: string, headers: Record<string, string | string[]>, method = 'GET'): LocalFileCase {
  return { name, method, file: 'text', headers };
}

function buildCases(): LocalFileCase[] {
  const cases: LocalFileCase[] = [
    textCase('plain GET', {}),
    textCase('plain HEAD', {}, 'HEAD'),
    { name: 'missing key', method: 'GET', file: 'missing', headers: {} },
    { name: 'directory at a generated key', method: 'GET', file: 'directory', headers: {} },
    { name: 'unknown extension', method: 'GET', file: 'unknownType', headers: {} },
    { name: 'empty file', method: 'GET', file: 'empty', headers: {} },
    { name: 'empty file, start past the end', method: 'GET', file: 'empty', headers: { Range: 'bytes=0-' } },
    { name: 'empty file, suffix', method: 'GET', file: 'empty', headers: { Range: 'bytes=-5' } },
    { name: 'empty file, bad unit', method: 'GET', file: 'empty', headers: { Range: 'items=0-1' } },
  ];

  if (process.getuid?.() !== 0) {
    cases.push({ name: 'unreadable file', method: 'GET', file: 'unreadable', headers: {} });
  }

  const ranges: Record<string, string | string[]> = {
    'first byte': 'bytes=0-0',
    'middle': 'bytes=5-9',
    'open end': 'bytes=15-',
    'end past the length': 'bytes=15-100',
    'suffix': 'bytes=-3',
    'suffix past the length': 'bytes=-100',
    'zero suffix': 'bytes=-0',
    'plus sign': 'bytes=+5-+9',
    'minus zero start': 'bytes=-0-3',
    'spaces inside': 'bytes= 2 - 4 ',
    'start past the end': 'bytes=20-',
    'start past the end with a good one': 'bytes=20-,0-1',
    'start after end': 'bytes=5-4',
    'no dash': 'bytes=5',
    'empty specs': 'bytes=,,0-1,,',
    'only commas': 'bytes=,',
    'bad unit': 'items=0-1',
    'uppercase unit': 'Bytes=0-1',
    'space before equals': 'bytes =0-1',
    'not a number': 'bytes=a-b',
    'end not a number': 'bytes=0-x',
    'double suffix sign': 'bytes=--3',
    'overflow': 'bytes=0-9223372036854775808',
    'two ranges': 'bytes=0-1,5-6',
    'overlapping ranges': 'bytes=0-5,3-8',
    'ranges past the sum guard': 'bytes=0-15,0-15',
    'ranges at the sum limit': 'bytes=0-9,10-19',
    'sixteen ranges': `bytes=${Array.from({ length: 16 }, (_, index) => `${index}-${index}`).join(',')}`,
    'seventeen ranges': `bytes=${Array.from({ length: 17 }, (_, index) => `${index}-${index}`).join(',')}`,
    'seventeen with empties': 'bytes=0-0,,,,,,,,,,,,,,,,',
    'two Range lines': ['bytes=0-1', '5-6'],
  };

  for (const [name, range] of Object.entries(ranges)) {
    cases.push(textCase(`range: ${name}`, { Range: range }));
  }

  for (const name of ['middle', 'two ranges', 'bad unit', 'start past the end']) {
    cases.push(textCase(`range HEAD: ${name}`, { Range: ranges[name] }, 'HEAD'));
  }

  const preconditions: Record<string, Record<string, string | string[]>> = {
    'If-Match star': { 'If-Match': '*' },
    'If-Match tag': { 'If-Match': '"abc"' },
    'If-Match list with star': { 'If-Match': '"abc", *' },
    'If-Match star and later If-Unmodified-Since earlier': { 'If-Match': '*', 'If-Unmodified-Since': EARLIER },
    'If-Unmodified-Since earlier': { 'If-Unmodified-Since': EARLIER },
    'If-Unmodified-Since exact': { 'If-Unmodified-Since': EXACT },
    'If-Unmodified-Since later': { 'If-Unmodified-Since': LATER },
    'If-None-Match star': { 'If-None-Match': '*' },
    'If-None-Match tag': { 'If-None-Match': '"abc"' },
    'If-None-Match tag beats If-Modified-Since': { 'If-None-Match': '"abc"', 'If-Modified-Since': LATER },
    'If-Modified-Since earlier': { 'If-Modified-Since': EARLIER },
    'If-Modified-Since exact': { 'If-Modified-Since': EXACT },
    'If-Modified-Since later': { 'If-Modified-Since': LATER },
    'If-Match tag and If-None-Match star': { 'If-Match': '"abc"', 'If-None-Match': '*' },
    'If-Match star and If-None-Match star': { 'If-Match': '*', 'If-None-Match': '*' },
    'If-Modified-Since exact with a range': { 'If-Modified-Since': EXACT, Range: 'bytes=0-1' },
  };

  for (const [name, headers] of Object.entries(preconditions)) {
    cases.push(textCase(`precondition: ${name}`, headers));
  }

  cases.push(textCase('precondition HEAD: If-Modified-Since exact', { 'If-Modified-Since': EXACT }, 'HEAD'));

  for (const [name, date] of Object.entries(DATE_SPELLINGS)) {
    cases.push(textCase(`If-Modified-Since date: ${name}`, { 'If-Modified-Since': date }));
    cases.push(textCase(`If-Range date: ${name}`, { 'If-Range': date, Range: 'bytes=0-1' }));
  }

  cases.push(textCase('If-Range earlier', { 'If-Range': EARLIER, Range: 'bytes=0-1' }));
  cases.push(textCase('If-Range later', { 'If-Range': LATER, Range: 'bytes=0-1' }));
  cases.push(textCase('If-Range entity tag', { 'If-Range': '"abc"', Range: 'bytes=0-1' }));
  cases.push(textCase('If-Range without Range', { 'If-Range': EARLIER }));
  cases.push(textCase('If-Range mismatch with a bad range', { 'If-Range': EARLIER, Range: 'items=0-1' }));
  cases.push(textCase('If-Range empty', { 'If-Range': '', Range: 'bytes=0-1' }));
  cases.push(textCase('If-Range on two lines', { 'If-Range': [EXACT, EXACT], Range: 'bytes=0-1' }));
  cases.push(textCase('If-Modified-Since on two lines', { 'If-Modified-Since': [EXACT, EXACT] }));
  cases.push(textCase('If-Match on two lines', { 'If-Match': ['"abc"', '*'] }));
  cases.push(textCase('If-None-Match empty', { 'If-None-Match': '', 'If-Modified-Since': EXACT }));

  return cases;
}

async function seedStorage(directory: string): Promise<void> {
  const text = join(directory, FILES.text);
  const empty = join(directory, FILES.empty);
  const unknown = join(directory, FILES.unknownType);
  const unreadable = join(directory, FILES.unreadable);

  await writeFile(text, TEXT);
  await writeFile(empty, '');
  await writeFile(unknown, TEXT);
  await writeFile(unreadable, TEXT);
  await chmod(unreadable, 0o000);
  await mkdir(join(directory, FILES.directory));

  for (const path of [text, empty, unknown]) {
    await utimes(path, MODIFIED_SECONDS, MODIFIED_SECONDS);
  }
}

async function withLocalFileServer(run: (server: RunningServer) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-files-'));

  try {
    await seedStorage(directory);
    const server = await startServer({
      args: ['--listen', '127.0.0.1:0', '--storage-dir', directory, '--public-url', 'https://uploads.example.com/files/'],
    });

    try {
      await run(server);
    } finally {
      await server.stop();
    }
  } finally {
    await chmod(join(directory, FILES.unreadable), 0o600).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

async function withServer(
  args: string[],
  run: (server: RunningServer) => Promise<void>,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const server = await startServer({
    args: ['--listen', '127.0.0.1:0', ...args],
    env,
  });

  try {
    await run(server);
  } finally {
    await server.stop();
  }
}

// Writes the golden on a C# capture run; otherwise the inputs must match the
// golden's, so a case the golden lacks cannot pass without a C# answer.
function compareGolden<T extends { name: string; response: unknown }>(name: string, actual: T[]): void {
  if (capturing) {
    writeGolden(name, actual);
    return;
  }

  const expected = readGolden<T[]>(name);

  expect(actual.map(({ response: _response, ...input }) => input))
    .toEqual(expected.map(({ response: _response, ...input }) => input));

  for (const [index, entry] of actual.entries()) {
    expect.soft(entry, entry.name).toEqual(expected[index]);
  }
}

function readGolden<T>(name: string): T {
  return JSON.parse(readFileSync(fixturePath(name), 'utf8')) as T;
}

function writeGolden(name: string, value: unknown): void {
  writeFileSync(fixturePath(name), `${JSON.stringify(value, null, 2)}\n`);
}

it('serves local files with the C# preconditions, ranges and failures', async () => {
  const cases = buildCases();
  const actual: LocalFileGolden[] = [];

  await withLocalFileServer(async (server) => {
    for (const testCase of cases) {
      const response = await server.request(
        testCase.method,
        `/files/${FILES[testCase.file as FileName]}`,
        { headers: testCase.headers },
      );

      actual.push({ ...testCase, response: golden(response) });
    }
  });

  if (capturing) {
    writeGolden('local-file-responses.json', actual);
    return;
  }

  // Root reads a mode-000 file, so that case only runs as a normal user.
  const expected = readGolden<LocalFileGolden[]>('local-file-responses.json')
    .filter((entry) => process.getuid?.() !== 0 || entry.file !== 'unreadable');

  // A case the golden lacks would otherwise pass without a C# answer.
  expect(actual.map(({ response: _response, ...input }) => input))
    .toEqual(expected.map(({ response: _response, ...input }) => input));

  for (const [index, entry] of actual.entries()) {
    expect.soft(entry, entry.name).toEqual(expected[index]);
  }
}, 60_000);

interface QueryGolden {
  name: string;
  query: string;
  response: GoldenResponse;
}

it('reads the unfurl url from the query the way ASP.NET does', async () => {
  const origin = await startFixtureOrigin();
  const page = `${origin.baseUrl}/metadata/final/page.html`;
  // Each query goes on the wire as written.
  const queries: Record<string, string> = {
    'encoded url': `url=${encodeURIComponent(`${page}?from=redirect`)}`,
    'raw url': `url=${page}?from=redirect`,
    'semicolon in the value': `url=${page}?from=redirect;x`,
    'semicolon before the key': `a=1;url=${page}`,
    'upper-case key': `URL=${page}`,
    'mixed-case key': `Url=${page}`,
    'encoded key': `%75rl=${page}`,
    'bad escape in the value': `url=${page}?q=%zz`,
    'bad escape in another pair': `x=%zz&url=${page}`,
    'plus in the value': `url=${page}?q=a+b`,
    'empty first value': `url=&url=${page}`,
    'bare key first': `url&url=${page}`,
    'two values': `url=${page}&url=${page}?second=1`,
    'lead question mark': `?url=${page}`,
    'empty pairs': `&&url=${page}&&`,
    'no url': 'x=1',
    'empty query': '',
  };
  const actual: QueryGolden[] = [];

  try {
    await withServer(['--storage-dir', '', '--conformance-origin', origin.baseUrl], async (server) => {
      for (const [name, query] of Object.entries(queries)) {
        const response = await server.request('GET', `/unfurl?${query}`);
        const recorded = golden(response);
        const portable = (value: string): string => value
          .split(encodeURIComponent(origin.baseUrl)).join('<origin>')
          .split(origin.baseUrl).join('<origin>');

        recorded.body = portable(recorded.body);
        // The body carries the origin's port, so its length is not stable.
        delete recorded.headers['content-length'];
        actual.push({ name, query: portable(query), response: recorded });
      }
    });
  } finally {
    await origin.stop();
  }

  compareGolden('unfurl-queries.json', actual);
}, 60_000);

interface DeleteGolden {
  name: string;
  response: GoldenResponse & { keyExistsAfter: boolean };
}

it('deletes local blobs with the C# failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-delete-'));
  const storage = join(directory, 'storage');
  const publicUrl = 'https://uploads.example.com/files/';
  const key = (letter: string): string => `${letter.repeat(32)}.txt`;
  const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
  // Each step stages the storage, then deletes one key. The last ones break
  // the storage directory itself.
  const steps: Array<{ name: string; key: string; stage: () => Promise<void> }> = [
    { name: 'a stored file', key: key('a'), stage: () => writeFile(join(storage, key('a')), 'x') },
    { name: 'a missing file', key: key('b'), stage: async () => undefined },
    { name: 'an empty directory at the key', key: key('c'), stage: () => mkdir(join(storage, key('c'))) },
    {
      name: 'a full directory at the key',
      key: key('d'),
      stage: async () => {
        await mkdir(join(storage, key('d')));
        await writeFile(join(storage, key('d'), 'inner'), 'x');
      },
    },
    { name: 'a missing storage directory', key: key('e'), stage: () => rm(storage, { recursive: true }) },
    { name: 'a file where the storage directory was', key: key('f'), stage: () => writeFile(storage, 'x') },
  ];
  const actual: DeleteGolden[] = [];

  try {
    await mkdir(storage);
    await withServer(['--storage-dir', storage, '--public-url', publicUrl], async (server) => {
      for (const step of steps) {
        await step.stage();
        const response = await server.request('POST', '/delete', {
          body: JSON.stringify({ url: `${publicUrl}${step.key}` }),
          headers: { 'Content-Type': 'application/json' },
        });

        actual.push({
          name: step.name,
          response: { ...golden(response), keyExistsAfter: await exists(join(storage, step.key)) },
        });
      }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  compareGolden('local-delete-responses.json', actual);
}, 60_000);

const BOUNDARY = 'blok-http-host-boundary';

function filePart(name: string, bytes: string): string {
  return `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: text/plain\r\n\r\n${bytes}\r\n`;
}

function fieldPart(index: number): string {
  return `--${BOUNDARY}\r\nContent-Disposition: form-data; name="f${index}"\r\n\r\nv\r\n`;
}

function multipart(parts: string[]): string {
  return `${parts.join('')}--${BOUNDARY}--\r\n`;
}

interface UploadGolden {
  name: string;
  response: GoldenResponse;
}

it('caps an upload at 1000 multipart sections', async () => {
  const fields = (count: number): string[] => Array.from({ length: count }, (_, index) => fieldPart(index));
  const bodies: Record<string, string> = {
    'file then 999 fields': multipart([filePart('a.txt', 'one'), ...fields(999)]),
    'file then 1000 fields': multipart([filePart('a.txt', 'one'), ...fields(1000)]),
    '999 fields then the file': multipart([...fields(999), filePart('a.txt', 'one')]),
    '1000 fields then the file': multipart([...fields(1000), filePart('a.txt', 'one')]),
  };
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-sections-'));
  const actual: UploadGolden[] = [];

  try {
    await withServer(['--storage-dir', directory, '--public-url', 'https://uploads.example.com/files/'], async (server) => {
      for (const [name, body] of Object.entries(bodies)) {
        const response = golden(await server.request('POST', '/upload', {
          body,
          headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
        }));

        response.body = response.body.replace(/[0-9a-f]{32}/g, '<key>');
        actual.push({ name, response });
      }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  compareGolden('upload-section-limit.json', actual);
}, 60_000);

// End to end over the shared file-name fixture: decode, sanitize, JSON.
const FILE_NAME_PARAMETERS = [
  "filename*=iso-8859-1''caf%E9.txt",
  "filename*=us-ascii''abc%80.txt",
  "filename*=utf-16''a%00.txt",
  "filename*=utf-8''%F0%9F%98%80%ED%A0%80.txt",
  "filename*=utf-8''a%C3.txt",
  "filename*=utf-8''a%22%5C%0D.txt",
  "filename*=utf-7''a.txt",
  'filename*=utf-7\'\'a.txt; filename="b.txt"',
  "filename*=utf-8''a'b.txt",
];

it('reads filename* with every charset .NET knows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-filename-'));
  const actual: UploadGolden[] = [];

  try {
    await withServer(['--storage-dir', directory, '--public-url', 'https://uploads.example.com/files/'], async (server) => {
      for (const parameters of FILE_NAME_PARAMETERS) {
        const body = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; ${parameters}\r\n` +
          `Content-Type: text/plain\r\n\r\none\r\n--${BOUNDARY}--\r\n`;
        const response = golden(await server.request('POST', '/upload', {
          body,
          headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
        }));

        response.body = response.body.replace(/[0-9a-f]{32}/g, '<key>');
        actual.push({ name: parameters, response });
      }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  compareGolden('upload-file-names.json', actual);
}, 60_000);

const SPOOL_NAME = /^\.blok-upload-[0-9a-f]{32}$/;

async function spoolFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.startsWith('.blok-upload-'));
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  let value = await read();

  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = await read();
  }

  return value;
}

async function uploadWhileWatchingTheSpool(baseUrl: string, temp: string, ending: 'abort' | 'finish'): Promise<void> {
  const head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\n` +
    'x'.repeat(100_000);
  const request = httpRequest(new URL('/upload', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
  });
  const answered = new Promise<number>((resolve, reject) => {
    request.once('response', (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', (error) => (ending === 'abort' ? resolve(0) : reject(error)));
  });

  request.write(head);

  const during = await waitFor(() => spoolFiles(temp), (names) => names.length > 0);

  expect(during, ending).toHaveLength(1);
  expect(during[0]).toMatch(SPOOL_NAME);
  expect((await stat(join(temp, during[0]))).mode & 0o777, ending).toBe(0o600);

  if (ending === 'finish') {
    request.end(`\r\n--${BOUNDARY}--\r\n`);
    expect(await answered).toBe(200);
  } else {
    request.destroy();
    await answered;
  }

  expect(await waitFor(() => spoolFiles(temp), (names) => names.length === 0), ending).toEqual([]);
}

it('spools an upload to a private temp file and removes it after', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'blok-http-host-spool-'));
  const storage = await mkdtemp(join(tmpdir(), 'blok-http-host-spool-store-'));

  try {
    const server = await startServer({
      args: ['--listen', '127.0.0.1:0', '--storage-dir', storage],
      env: { ...process.env, TMPDIR: temp },
    });

    try {
      await uploadWhileWatchingTheSpool(server.baseUrl, temp, 'finish');
      await uploadWhileWatchingTheSpool(server.baseUrl, temp, 'abort');
    } finally {
      await server.stop();
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
    await rm(storage, { recursive: true, force: true });
  }
}, 60_000);

const ENCODINGS = [
  'gzip', 'upper-gzip', 'br', 'deflate', 'raw-deflate', 'identity', 'empty', 'two-in-one',
  'two-lines', 'unknown', 'compress', 'corrupt-gzip', 'trailing-garbage', 'bomb', 'spaced',
  'truncated-gzip', 'truncated-deflate', 'truncated-br', 'two-gzip-members', 'gzip-zero-padding',
  'gzip-then-bad-member', 'gzip-then-one-magic-byte', 'gzip-bad-crc', 'deflate-bad-adler',
  'deflate-trailing-garbage', 'br-trailing-garbage', 'empty-gzip-body', 'empty-br-body', 'empty-deflate-body',
];

it('decodes outbound bodies by the C# content-encoding rules', async () => {
  const origin = await startFixtureOrigin();
  const actual: Array<{ name: string; response: GoldenResponse }> = [];

  try {
    await withServer(['--storage-dir', '', '--conformance-origin', origin.baseUrl], async (server) => {
      for (const name of ENCODINGS) {
        const target = `${origin.baseUrl}/encoded/${name}`;
        const recorded = golden(await server.request('GET', `/unfurl?url=${encodeURIComponent(target)}`));

        recorded.body = recorded.body.split(origin.baseUrl).join('<origin>');
        // The body carries the origin's port, so its length is not stable.
        delete recorded.headers['content-length'];
        actual.push({ name, response: recorded });
      }
    });
  } finally {
    await origin.stop();
  }

  compareGolden('outbound-encodings.json', actual);
}, 60_000);

it('sends only the C# request headers to an outbound origin', async () => {
  const origin = await startFixtureOrigin();
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-headers-'));
  const actual: Array<{ name: string; response: Record<string, unknown> }> = [];

  try {
    await withServer(['--storage-dir', directory, '--conformance-origin', origin.baseUrl], async (server) => {
      await server.request('GET', `/unfurl?url=${encodeURIComponent(`${origin.baseUrl}/metadata/redirect`)}`, {
        headers: { Cookie: 'session=1', Authorization: 'Bearer x', 'Accept-Encoding': 'gzip' },
      });
      await server.request('POST', '/upload-by-url', {
        body: JSON.stringify({ url: origin.mediaRedirectUrl }),
        headers: { 'Content-Type': 'application/json', Cookie: 'session=1' },
      });
    });
  } finally {
    await origin.stop();
    await rm(directory, { recursive: true, force: true });
  }

  for (const [index, request] of origin.received.entries()) {
    const headers = Object.fromEntries(Object.entries(request.headers)
      .map(([name, value]) => [name, name === 'host' ? '<origin host>' : value])
      .sort(([left], [right]) => String(left).localeCompare(String(right))));

    actual.push({ name: `${index} ${request.path}`, response: headers });
  }

  compareGolden('outbound-request-headers.json', actual);
}, 60_000);

it('follows five outbound redirects and refuses the sixth', async () => {
  const origin = await startFixtureOrigin();
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-redirects-'));
  const actual: Array<{ name: string; response: GoldenResponse }> = [];

  try {
    await withServer(['--storage-dir', directory, '--conformance-origin', origin.baseUrl], async (server) => {
      for (const hops of [5, 6]) {
        const page = golden(await server.request('GET', `/unfurl?url=${encodeURIComponent(`${origin.baseUrl}/chain/${hops}/page.html`)}`));
        const media = golden(await server.request('POST', '/upload-by-url', {
          body: JSON.stringify({ url: `${origin.baseUrl}/chain/${hops}/photo.png` }),
          headers: { 'Content-Type': 'application/json' },
        }));

        for (const recorded of [page, media]) {
          recorded.body = recorded.body.split(origin.baseUrl).join('<origin>').split(server.baseUrl).join('<server>')
            .replace(/[0-9a-f]{32}/g, '<key>');
          delete recorded.headers['content-length'];
        }
        actual.push({ name: `unfurl after ${hops} redirects`, response: page });
        actual.push({ name: `upload-by-url after ${hops} redirects`, response: media });
      }
    });
  } finally {
    await origin.stop();
    await rm(directory, { recursive: true, force: true });
  }

  compareGolden('outbound-redirect-cap.json', actual);
}, 60_000);

it('shares four outbound fetches between unfurl and upload-by-url', async () => {
  const origin = await startFixtureOrigin();
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-permits-'));

  try {
    await withServer(['--storage-dir', directory, '--conformance-origin', origin.baseUrl], async (server) => {
      const requests = [0, 1, 2].flatMap((index) => [
        server.request('GET', `/unfurl?url=${encodeURIComponent(`${origin.baseUrl}/hold/page-${index}`)}`),
        server.request('POST', '/upload-by-url', {
          body: JSON.stringify({ url: `${origin.baseUrl}/hold/photo-${index}.png` }),
          headers: { 'Content-Type': 'application/json' },
        }),
      ]);

      await waitFor(async () => origin.held.current, (current) => current >= 4);
      // Give a fifth fetch the time to arrive if the server would let it.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(origin.held.peak).toBe(4);

      while (origin.received.length < 6) {
        origin.held.release();
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      origin.held.release();

      const statuses = (await Promise.all(requests)).map((response) => response.status);

      expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    });
  } finally {
    await origin.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

// Program.cs:136 sets RequestHeadersTimeout to 10 s.
it('drops a connection whose request headers stall for 10 seconds', async () => {
  await withServer([], async (server) => {
    const { hostname, port } = new URL(server.baseUrl);
    const socket = connect(Number(port), hostname);
    const started = Date.now();
    const chunks: Buffer[] = [];

    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.write('GET /health HTTP/1.1\r\nHost: x\r\n');
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
    });

    const elapsed = Date.now() - started;
    const answer = Buffer.concat(chunks).toString('latin1')
      .replace(/^Date: .*\r\n/m, 'Date: <date>\r\n')
      .replace(/^Server: .*\r\n/m, '');

    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(15_000);
    compareGolden('header-timeout.json', [{ name: 'stalled headers', response: answer }]);
  });
}, 30_000);

async function rawExchange(baseUrl: string, request: Buffer): Promise<string> {
  const { hostname, port } = new URL(baseUrl);
  const socket = connect(Number(port), hostname);
  const chunks: Buffer[] = [];

  socket.on('data', (chunk: Buffer) => chunks.push(chunk));
  socket.setTimeout(5_000, () => socket.destroy());
  // Kestrel drops a request whose sender half-closes, so write, not end.
  socket.write(request);
  await new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
  });

  // Header order is not part of the contract.
  const [head = '', ...body] = Buffer.concat(chunks).toString('latin1').split('\r\n\r\n');
  const [status = '', ...lines] = head.split('\r\n');
  const headers = lines
    .map((line) => line.replace(/^([^:]+):/, (name) => name.toLowerCase()))
    .filter((line) => !/^(date|server):/.test(line))
    .sort();

  return [status, ...headers, '', body.join('\r\n\r\n')].join('\n');
}

// Origins compare with .NET OrdinalIgnoreCase: simple upper case per char,
// but U+0131 and U+017F keep their case. Kestrel decodes header bytes as
// UTF-8 and refuses invalid ones; an echoed non-ASCII origin is a 500.
const ORIGIN_SPELLINGS: Record<string, string> = {
  'ascii exact': 'http://k.example',
  'ascii upper': 'HTTP://K.EXAMPLE',
  'kelvin sign': 'http://\u212a.example',
  'long s': 'http://\u017f.example',
  'dotless i': 'http://\u0131.example',
  'dotted capital I': 'http://\u0130.example',
  'capital I': 'http://I.example',
  'e acute': 'http://\u00e9.example',
  'capital E acute': 'http://\u00c9.example',
  'sharp s': 'http://\u00df.example',
  'capital sharp s': 'http://\u1e9e.example',
  'SS': 'http://SS.example',
  'final sigma': 'http://\u03c2.example',
  'capital sigma': 'http://\u03a3.example',
  'micro sign': 'http://\u00b5.example',
  'capital mu': 'http://\u039c.example',
  'emoji': 'http://\u{1F600}.example',
};

it('matches request origins the way OrdinalIgnoreCase does', async () => {
  const actual: Array<{ name: string; response: string }> = [];
  const allowed = ['http://k.example', 'http://s.example', 'http://i.example', 'http://\u00e9.example',
    'http://\u00df.example', 'http://\u03c3.example', 'http://\u03bc.example'];

  await withServer(['--auth', 'ticket', '--allow-origin', allowed.join(','), '--storage-dir', ''], async (server) => {
    for (const [name, origin] of Object.entries(ORIGIN_SPELLINGS)) {
      actual.push({
        name: `preflight ${name}`,
        response: await rawExchange(server.baseUrl, Buffer.concat([
          Buffer.from('OPTIONS /unfurl HTTP/1.1\r\nHost: x\r\nOrigin: '),
          Buffer.from(origin, 'utf8'),
          Buffer.from('\r\nAccess-Control-Request-Method: GET\r\nConnection: close\r\n\r\n'),
        ])),
      });
    }
    // The requested headers are echoed too, so they face the same check.
    actual.push({
      name: 'preflight with non-ASCII requested headers',
      response: await rawExchange(server.baseUrl, Buffer.concat([
        Buffer.from('OPTIONS /unfurl HTTP/1.1\r\nHost: x\r\nOrigin: http://k.example\r\n' +
          'Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: x-'),
        Buffer.from('\u00e9', 'utf8'),
        Buffer.from('\r\nConnection: close\r\n\r\n'),
      ])),
    });
    for (const [name, origin] of [['e acute', 'http://\u00e9.example'], ['kelvin sign', 'http://\u212a.example']]) {
      actual.push({
        name: `guarded GET ${name}`,
        response: await rawExchange(server.baseUrl, Buffer.concat([
          Buffer.from('GET /unfurl?url=x HTTP/1.1\r\nHost: x\r\nOrigin: '),
          Buffer.from(origin, 'utf8'),
          Buffer.from('\r\nConnection: close\r\n\r\n'),
        ])),
      });
    }
  }, { BLOK_SECRET: 's3cret-value-at-least-32-chars-long!' });

  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-fetch-site-'));

  await withServer(['--auth', 'none', '--storage-dir', directory, '--no-unfurl'], async (server) => {
    for (const site of ['cross-site', 'CROSS-SITE', 'cro\u017f\u017f-site', 'same-site']) {
      actual.push({
        name: `Sec-Fetch-Site ${site}`,
        response: await rawExchange(server.baseUrl, Buffer.concat([
          Buffer.from('POST /delete HTTP/1.1\r\nHost: x\r\nSec-Fetch-Site: '),
          Buffer.from(site, 'utf8'),
          Buffer.from('\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'),
        ])),
      });
    }
  }).finally(() => rm(directory, { recursive: true, force: true }));

  compareGolden('origin-case-fold.json', actual);
}, 60_000);

const PROXY_VARIABLES = [
  'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy',
  'GATEWAY_INTERFACE', 'REQUEST_METHOD',
];

// The S3 endpoint must be https off loopback, and its name never resolves,
// so the only sign of a proxy is the CONNECT it receives. The proxy refuses
// the tunnel, so every upload fails; the golden pins who was asked.
// Captured on macOS with no system proxy set.
const PROXY_CASES: Record<string, (proxy: string) => Record<string, string>> = {
  'no proxy variables': () => ({}),
  'HTTPS_PROXY': (proxy) => ({ HTTPS_PROXY: proxy }),
  'https_proxy': (proxy) => ({ https_proxy: proxy }),
  'HTTPS_PROXY without a scheme': (proxy) => ({ HTTPS_PROXY: proxy.replace('http://', '') }),
  'only HTTP_PROXY': (proxy) => ({ HTTP_PROXY: proxy }),
  'ALL_PROXY': (proxy) => ({ ALL_PROXY: proxy }),
  'all_proxy': (proxy) => ({ all_proxy: proxy }),
  'NO_PROXY names the host': (proxy) => ({ HTTPS_PROXY: proxy, NO_PROXY: 's3.blok-proxy.invalid' }),
  'NO_PROXY names the domain': (proxy) => ({ HTTPS_PROXY: proxy, NO_PROXY: '.blok-proxy.invalid' }),
  'NO_PROXY bare domain': (proxy) => ({ HTTPS_PROXY: proxy, NO_PROXY: 'blok-proxy.invalid' }),
  'NO_PROXY star': (proxy) => ({ HTTPS_PROXY: proxy, NO_PROXY: '*' }),
  'no_proxy names the host': (proxy) => ({ HTTPS_PROXY: proxy, no_proxy: 's3.blok-proxy.invalid' }),
  'empty no_proxy beside NO_PROXY': (proxy) => ({ HTTPS_PROXY: proxy, no_proxy: '', NO_PROXY: 's3.blok-proxy.invalid' }),
  'empty https_proxy beside HTTPS_PROXY': (proxy) => ({ https_proxy: '', HTTPS_PROXY: proxy }),
  'HTTPS_PROXY beside ALL_PROXY': (proxy) => ({ HTTPS_PROXY: proxy, ALL_PROXY: 'http://127.0.0.1:9' }),
  'HTTPS_PROXY with a path after the port': (proxy) => ({ HTTPS_PROXY: `${proxy}/ignored` }),
  'HTTPS_PROXY in upper case scheme': (proxy) => ({ HTTPS_PROXY: proxy.replace('http://', 'HTTP://') }),
  'HTTPS_PROXY with an empty port': (proxy) => ({ HTTPS_PROXY: `${proxy.replace(/:\d+$/, '')}:`, ALL_PROXY: proxy }),
  'NO_PROXY list with spaces and case': (proxy) => ({ HTTPS_PROXY: proxy, NO_PROXY: ' other.example , S3.Blok-Proxy.Invalid ' }),
  'NO_PROXY dot entry names the host itself': (proxy) => ({ HTTPS_PROXY: proxy, NO_PROXY: '.s3.blok-proxy.invalid' }),
  'HTTPS_PROXY under CGI': (proxy) => ({ HTTPS_PROXY: proxy, GATEWAY_INTERFACE: 'CGI/1.1' }),
  // The proxy is also the endpoint: an absolute-form target means proxied.
  'loopback http endpoint with HTTP_PROXY': (proxy) => ({ HTTP_PROXY: proxy, ENDPOINT: proxy }),
  'loopback http endpoint with no proxy': (proxy) => ({ ENDPOINT: proxy }),
  'loopback http endpoint with HTTP_PROXY under CGI': (proxy) => ({ HTTP_PROXY: proxy, GATEWAY_INTERFACE: 'CGI/1.1', ENDPOINT: proxy }),
  'loopback http endpoint with http_proxy under CGI': (proxy) => ({ http_proxy: proxy, GATEWAY_INTERFACE: 'CGI/1.1', ENDPOINT: proxy }),
};

interface ProxyGolden {
  name: string;
  response: { status: number; text: string; proxied: { method: string; target: string; host: string }[] };
}

async function uploadThroughS3(variables: Record<string, string>): Promise<HttpResponse> {
  // Undefined unsets a variable in the child. An empty one is not unset
  // for .NET: an empty no_proxy hides NO_PROXY.
  const env: NodeJS.ProcessEnv = { BLOK_S3_ACCESS_KEY: 'AKIAEXAMPLE', BLOK_S3_SECRET_KEY: 'secret' };

  for (const variable of PROXY_VARIABLES) {
    env[variable] = undefined;
  }
  const { ENDPOINT: endpoint = 'https://s3.blok-proxy.invalid', ...set } = variables;
  const server = await startServer({
    args: [
      '--listen', '127.0.0.1:0', '--s3-endpoint', endpoint, '--s3-region', 'us-east-1',
      '--s3-bucket', 'media', '--s3-bucket-url', 'https://cdn.example.com/media', '--s3-addressing', 'path',
    ],
    env: { ...env, ...set },
  });

  try {
    return await server.request('POST', '/upload', {
      body: multipart([filePart('a.txt', 'one')]),
      headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
    });
  } finally {
    await server.stop();
  }
}

it('sends S3 requests through the environment proxy the way .NET does', async () => {
  const seen: { method: string; target: string; host: string }[] = [];
  const proxy = createServer((request, response) => {
    seen.push({
      method: request.method ?? '',
      target: (request.url ?? '').replace(/[0-9a-f]{32}/, '<key>').replace(/127\.0\.0\.1:\d+/, '<proxy>'),
      host: (request.headers.host ?? '').replace(/127\.0\.0\.1:\d+/, '<proxy>'),
    });
    request.resume();
    response.writeHead(502, { 'Content-Length': '0' });
    response.end();
  });

  proxy.on('connect', (request: IncomingMessage, socket: Duplex) => {
    seen.push({ method: request.method ?? '', target: request.url ?? '', host: request.headers.host ?? '' });
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
  });

  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  const proxyUrl = typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : '';
  const actual: ProxyGolden[] = [];

  try {
    for (const [name, variables] of Object.entries(PROXY_CASES)) {
      seen.length = 0;
      const response = await uploadThroughS3(variables(proxyUrl));

      actual.push({ name, response: { status: response.status, text: response.text, proxied: [...seen] } });
    }
  } finally {
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }

  compareGolden('s3-proxy.json', actual);
}, 120_000);

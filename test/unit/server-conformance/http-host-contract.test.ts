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

import { encodedContentEncoding, startFixtureOrigin } from './fixture-origin';
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
  // ASP.NET's table holds this extension in upper case.
  ivf: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.ivf',
  // Files in the storage directory that no upload named. Only generated
  // keys are served, so these must stay 404.
  dotFile: '.env',
  plainName: 'config.json',
  uploadTemp: '.blok-upload-0123456789abcdef0123456789abcdef',
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
    { name: 'extension in upper case in the table', method: 'GET', file: 'ivf', headers: {} },
    { name: 'empty file', method: 'GET', file: 'empty', headers: {} },
    { name: 'empty file, start past the end', method: 'GET', file: 'empty', headers: { Range: 'bytes=0-' } },
    { name: 'empty file, suffix', method: 'GET', file: 'empty', headers: { Range: 'bytes=-5' } },
    { name: 'empty file, bad unit', method: 'GET', file: 'empty', headers: { Range: 'items=0-1' } },
    { name: 'dot file outside the key grammar', method: 'GET', file: 'dotFile', headers: {} },
    { name: 'plain name outside the key grammar', method: 'GET', file: 'plainName', headers: {} },
    { name: 'upload temp file', method: 'GET', file: 'uploadTemp', headers: {} },
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
  const ivf = join(directory, FILES.ivf);
  const unreadable = join(directory, FILES.unreadable);

  await writeFile(text, TEXT);
  await writeFile(ivf, TEXT);
  await writeFile(empty, '');
  await writeFile(unknown, TEXT);
  await writeFile(unreadable, TEXT);
  for (const name of [FILES.dotFile, FILES.plainName, FILES.uploadTemp]) {
    await writeFile(join(directory, name), TEXT);
  }
  await chmod(unreadable, 0o000);
  await mkdir(join(directory, FILES.directory));

  for (const path of [text, empty, unknown, ivf]) {
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
  'param', 'quoted', 'two-words', 'slash', 'parens', 'good-then-bad-item', 'bad-line-then-good-line',
  'trailing-comma', 'only-commas', 'tab-spaced', 'gzip-long-name', 'gzip-long-comment',
];

it('decodes outbound bodies by the C# content-encoding rules', async () => {
  const origin = await startFixtureOrigin();
  // Go's internal/outbound reads `encoding` from the golden.
  const actual: Array<{ name: string; encoding: string[]; response: GoldenResponse }> = [];

  try {
    await withServer(['--storage-dir', '', '--conformance-origin', origin.baseUrl], async (server) => {
      for (const name of ENCODINGS) {
        const target = `${origin.baseUrl}/encoded/${name}`;
        const recorded = golden(await server.request('GET', `/unfurl?url=${encodeURIComponent(target)}`));

        recorded.body = recorded.body.split(origin.baseUrl).join('<origin>');
        // The body carries the origin's port, so its length is not stable.
        delete recorded.headers['content-length'];
        actual.push({ name, encoding: encodedContentEncoding(name) ?? [], response: recorded });
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

// .NET's SocketsHttpHandler defaults to 64 KiB of response head; Go is set to match.
it('refuses an outbound response head over 64 KiB', async () => {
  const origin = await startFixtureOrigin();
  const actual: Array<{ name: string; response: GoldenResponse }> = [];

  try {
    await withServer(['--storage-dir', '', '--conformance-origin', origin.baseUrl], async (server) => {
      for (const kib of [16, 48, 80, 256]) {
        const target = `${origin.baseUrl}/big-header/${kib}`;
        const recorded = golden(await server.request('GET', `/unfurl?url=${encodeURIComponent(target)}`));

        recorded.body = recorded.body.split(origin.baseUrl).join('<origin>');
        delete recorded.headers['content-length'];
        actual.push({ name: `a ${kib} KiB header`, response: recorded });
      }
    });
  } finally {
    await origin.stop();
  }

  compareGolden('outbound-header-size.json', actual);
}, 60_000);

// The guard counts the request; each redirect hop takes one more from the same budget.
it('counts every outbound redirect hop against the rate limit', async () => {
  const origin = await startFixtureOrigin();
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-hops-'));

  try {
    await withServer(['--storage-dir', directory, '--conformance-origin', origin.baseUrl, '--rate-limit', '3'], async (server) => {
      const page = await server.request('GET', `/unfurl?url=${encodeURIComponent(`${origin.baseUrl}/chain/5/page.html`)}`);

      expect(origin.received.map((request) => request.path)).toEqual([
        '/chain/5/page.html', '/chain/4/page.html', '/chain/3/page.html',
      ]);
      expect([page.status, page.text]).toEqual([200, '{"success":0}\n']);

      const refused = await server.request('GET', `/unfurl?url=${encodeURIComponent(`${origin.baseUrl}/chain/0/page.html`)}`);

      expect([refused.status, refused.text]).toEqual([429, 'rate limit exceeded\n']);
      expect(origin.received).toHaveLength(3);
    });
    await withServer(['--storage-dir', directory, '--conformance-origin', origin.baseUrl, '--rate-limit', '2'], async (server) => {
      origin.received.length = 0;
      const media = await server.request('POST', '/upload-by-url', {
        body: JSON.stringify({ url: `${origin.baseUrl}/chain/5/photo.png` }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(origin.received.map((request) => request.path)).toEqual(['/chain/5/photo.png', '/chain/4/photo.png']);
      expect([media.status, media.text]).toEqual([400, 'the URL could not be fetched\n']);
    });
  } finally {
    await origin.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

const FRAME_PAGES = [
  'plain', 'xfo-deny', 'xfo-sameorigin', 'xfo-allowall', 'xfo-allowall-and-invalid-lines',
  'xfo-invalid-and-invalid-lines', 'xfo-allow-from', 'csp-none', 'csp-two-lines', 'csp-comma-policies',
  'csp-duplicate-directive', 'csp-report-only', 'csp-overrides-xfo', 'csp-http-embedder',
  'csp-https-embedder', 'csp-self', 'redirect', 'oembed-full', 'oembed-escaped', 'oembed-http-thumbnail',
  'oembed-html-only', 'oembed-not-json', 'oembed-missing', 'oembed-redirect', 'oembed-blocked', 'oembed-oversized',
];

// Conformance pages are http, so an allowed page reads "insecure"; "blocked" wins over it.
it('rates whether an outbound page lets the editor frame it', async () => {
  const origin = await startFixtureOrigin();
  const editor = 'http://editor.example';
  const actual: Array<{ name: string; response: GoldenResponse }> = [];
  const record = (name: string, response: HttpResponse): void => {
    const recorded = golden(response);

    recorded.body = recorded.body.split(origin.baseUrl).join('<origin>');
    delete recorded.headers['content-length'];
    actual.push({ name, response: recorded });
  };

  try {
    await withServer(['--storage-dir', '', '--conformance-origin', origin.baseUrl, '--allow-origin', editor], async (server) => {
      const check = (target: string, headers: Record<string, string> = { Origin: editor }): Promise<HttpResponse> =>
        server.request('GET', `/frame-check?url=${encodeURIComponent(target)}`, { headers });

      for (const page of FRAME_PAGES) {
        record(`${page} for the editor`, await check(`${origin.baseUrl}/frame/${page}`));
      }
      // csp-self blocks every embedder but the page's own origin, so a used
      // embedder reads "blocked" and none reads "insecure".
      const claim = (embedder: string, headers: Record<string, string>): Promise<HttpResponse> =>
        server.request('GET', `/frame-check?url=${encodeURIComponent(`${origin.baseUrl}/frame/csp-self`)}` +
          `&embedder=${encodeURIComponent(embedder)}`, { headers });
      const sameOrigin = { 'Sec-Fetch-Site': 'same-origin' };
      const claims: Array<[string, Promise<HttpResponse>, string]> = [
        ['same-origin with its own embedder', claim(server.baseUrl, sameOrigin), 'blocked'],
        ['same-origin with another embedder', claim('http://other.example', sameOrigin), 'insecure'],
        ['same-site with its own embedder', claim(server.baseUrl, { 'Sec-Fetch-Site': 'same-site' }), 'insecure'],
        ['its own embedder with no Sec-Fetch-Site', claim(server.baseUrl, {}), 'insecure'],
        ['an allowed embedder with no Origin', claim(editor, {}), 'blocked'],
        ['a refused embedder with no Origin', claim('http://other.example', {}), 'insecure'],
      ];

      for (const [name, pending, verdict] of claims) {
        const response = await pending;

        expect([name, response.status, JSON.parse(response.text).verdict]).toEqual([name, 200, verdict]);
        record(name, response);
      }
      record('xfo-deny with no Origin', await check(`${origin.baseUrl}/frame/xfo-deny`, {}));
      record('plain with no Origin', await check(`${origin.baseUrl}/frame/plain`, {}));
      record('a refused Origin', await check(`${origin.baseUrl}/frame/plain`, { Origin: 'http://other.example' }));
      record('a 503 page', await check(origin.errorUrl));
      record('a blocked destination', await check('http://127.0.0.2/'));
      record('six redirects', await check(`${origin.baseUrl}/chain/6/page.html`));
      record('no url', await server.request('GET', '/frame-check', { headers: { Origin: editor } }));
      record('a preflight', await server.request('OPTIONS', '/frame-check', {
        headers: { Origin: editor, 'Access-Control-Request-Method': 'GET' },
      }));
      record('a POST', await server.request('POST', '/frame-check', { headers: { Origin: editor } }));
    });
  } finally {
    await origin.stop();
  }

  compareGolden('frame-check-responses.json', actual);
}, 60_000);

// The oEmbed fetch is one more outbound GET, so it takes one more from the rate limit.
it('charges the oEmbed fetch to the rate limit', async () => {
  const origin = await startFixtureOrigin();
  const page = `${origin.baseUrl}/frame/oembed-full`;

  try {
    for (const [limit, oembed] of [['1', false], ['2', true]] as const) {
      origin.received.length = 0;
      await withServer(['--storage-dir', '', '--conformance-origin', origin.baseUrl, '--rate-limit', limit], async (server) => {
        const response = await server.request('GET', `/frame-check?url=${encodeURIComponent(page)}`);

        expect(response.status).toBe(200);
        expect(response.text.includes('"oembed"')).toBe(oembed);
        expect(origin.received.map((request) => request.path))
          .toEqual(oembed ? ['/frame/oembed-full', '/oembed/full'] : ['/frame/oembed-full']);
      });
    }
  } finally {
    await origin.stop();
  }
}, 60_000);

it('keeps frame-check closed when unfurl is off', async () => {
  await withServer(['--storage-dir', '', '--no-unfurl'], async (server) => {
    const response = await server.request('GET', '/frame-check?url=http%3A%2F%2Fexample.com%2F');

    expect(response.status).toBe(404);
  });
}, 60_000);

// Uploads have their own four fetches, so a long download never makes a
// short check wait.
it('gives unfurl and upload-by-url four outbound fetches each', async () => {
  const origin = await startFixtureOrigin();
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-permits-'));

  try {
    await withServer(['--storage-dir', directory, '--conformance-origin', origin.baseUrl], async (server) => {
      const requests = [0, 1, 2, 3, 4].flatMap((index) => [
        server.request('GET', `/unfurl?url=${encodeURIComponent(`${origin.baseUrl}/hold/page-${index}`)}`),
        server.request('POST', '/upload-by-url', {
          body: JSON.stringify({ url: `${origin.baseUrl}/hold/photo-${index}.png` }),
          headers: { 'Content-Type': 'application/json' },
        }),
      ]);

      await waitFor(async () => origin.held.current, (current) => current >= 8);
      // Give a ninth fetch the time to arrive if the server would let it.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(origin.held.peak).toBe(8);
      expect(origin.received.filter((request) => request.path.endsWith('.png'))).toHaveLength(4);

      while (origin.received.length < 10) {
        origin.held.release();
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      origin.held.release();

      const statuses = (await Promise.all(requests)).map((response) => response.status);

      expect(statuses).toEqual(Array.from({ length: 10 }, () => 200));
    });
  } finally {
    await origin.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

// With the rate limit on, one caller runs at most two fetches at once in each
// pool. A third waits for one of its own, within its own deadline, while the
// pool's other slots stay free.
it('makes a third concurrent outbound fetch from one caller wait for its own slot', async () => {
  const origin = await startFixtureOrigin();
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-caller-lane-'));

  try {
    await withServer(['--storage-dir', directory, '--conformance-origin', origin.baseUrl, '--rate-limit', '60'], async (server) => {
      const upload = (path: string): Promise<HttpResponse> => server.request('POST', '/upload-by-url', {
        body: JSON.stringify({ url: `${origin.baseUrl}${path}` }),
        headers: { 'Content-Type': 'application/json' },
      });
      const held = [
        upload('/hold/photo-0.png'),
        upload('/hold/photo-1.png'),
        server.request('GET', `/unfurl?url=${encodeURIComponent(`${origin.baseUrl}/hold/page-0`)}`),
        server.request('GET', `/frame-check?url=${encodeURIComponent(`${origin.baseUrl}/hold/page-1`)}`),
      ];

      await waitFor(async () => origin.held.current, (current) => current >= 4);

      const third = [
        upload('/hold/photo-2.png'),
        server.request('GET', `/unfurl?url=${encodeURIComponent(`${origin.baseUrl}/hold/page-2`)}`),
      ];

      // Give the third fetches the time to arrive if the server would let them.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(origin.received).toHaveLength(4);

      const until = Date.now() + 10_000;

      while (origin.received.length < 6 && Date.now() < until) {
        origin.held.release();
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      origin.held.release();

      const statuses = (await Promise.all([...held, ...third])).map((response) => response.status);

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
    const raw = Buffer.concat(chunks).toString('latin1');
    expect(raw).toMatch(/\r\nServer: Kestrel\r\n/);
    const answer = raw
      .replace(/^Date: .*\r\n/m, 'Date: <date>\r\n')
      .replace(/^Server: .*\r\n/m, '');

    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(15_000);
    compareGolden('header-timeout.json', [{ name: 'stalled headers', response: answer }]);
  });
}, 30_000);

// The goldens leave Server out; this pins it. Kestrel's AddServerHeader
// default names it on handler answers and on its own bare refusals.
it('names itself Server: Kestrel on every answer', async () => {
  const requests: Record<string, string> = {
    'health': 'GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    'catch-all 404': 'GET /missing HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    'method not allowed': 'PUT /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    'bad request line': 'GARBAGE\r\n\r\n',
    'bad version': 'GET / HTTP/1.2\r\nHost: x\r\n\r\n',
  };

  await withServer(['--auth', 'none', '--storage-dir', ''], async (server) => {
    const { hostname, port } = new URL(server.baseUrl);

    for (const [name, request] of Object.entries(requests)) {
      const socket = connect(Number(port), hostname);
      const chunks: Buffer[] = [];

      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.setTimeout(5_000, () => socket.destroy());
      socket.write(request);
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
      });
      const head = Buffer.concat(chunks).toString('latin1').split('\r\n\r\n')[0] ?? '';

      expect.soft(head.split('\r\n').filter((line) => /^server:/i.test(line)), name)
        .toEqual(['Server: Kestrel']);
    }
  });
});

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
// UTF-8 and refuses invalid ones. A non-ASCII origin is never allowed, even
// when listed: Kestrel could not echo it, and a browser sends punycode.
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
  // Upper and lower case differ in UTF-8 length here.
  'capital turned a': 'http://\u2c6f.example',
  'capital a with stroke': 'http://\u023a.example',
};

it('matches request origins the way OrdinalIgnoreCase does', async () => {
  const actual: Array<{ name: string; response: string }> = [];
  const allowed = ['http://k.example', 'http://s.example', 'http://i.example', 'http://\u00e9.example',
    'http://\u00df.example', 'http://\u03c3.example', 'http://\u03bc.example', 'http://\u0250.example',
    'http://\u2c65.example'];

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
    // Control bytes and DEL pass the request parser but not the response's.
    for (const [name, byte] of [['control byte', 0x01], ['DEL', 0x7f]] as const) {
      actual.push({
        name: `preflight with a ${name} in the requested headers`,
        response: await rawExchange(server.baseUrl, Buffer.concat([
          Buffer.from('OPTIONS /unfurl HTTP/1.1\r\nHost: x\r\nOrigin: http://k.example\r\n' +
            'Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: x-a'),
          Buffer.from([byte]),
          Buffer.from('b\r\nConnection: close\r\n\r\n'),
        ])),
      });
    }
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
          Buffer.from('POST /delete HTTP/1.1\r\nHost: 127.0.0.1\r\nSec-Fetch-Site: '),
          Buffer.from(site, 'utf8'),
          Buffer.from('\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'),
        ])),
      });
    }
  }).finally(() => rm(directory, { recursive: true, force: true }));

  compareGolden('origin-case-fold.json', actual);
}, 60_000);

// A DNS-rebinding page sends a same-origin GET under its own name. The
// standalone host answers only loopback names and its configured ones.
it('refuses a guarded GET under a foreign Host on a loopback host', async () => {
  const frameCheck = (host: string): Buffer => Buffer.from(
    `GET /frame-check HTTP/1.1\r\nHost: ${host}\r\nSec-Fetch-Site: same-origin\r\nConnection: close\r\n\r\n`,
  );
  const statusAndBody = (answer: string): string => {
    const lines = answer.split('\n');

    return `${lines[0]} ${answer.includes('host not allowed') ? 'host not allowed' : ''}`.trim();
  };
  const actual: Record<string, string> = {};

  await withServer(['--auth', 'none', '--storage-dir', '', '--allow-origin', 'https://app.example.com'], async (server) => {
    for (const host of ['attacker.example:4000', 'localhost.attacker.example', 'localhost', '127.0.0.1:4000', '[::1]', 'app.example.com']) {
      actual[host] = statusAndBody(await rawExchange(server.baseUrl, frameCheck(host)));
    }
  });

  expect(actual).toEqual({
    'attacker.example:4000': 'HTTP/1.1 421 Misdirected Request host not allowed',
    'localhost.attacker.example': 'HTTP/1.1 421 Misdirected Request host not allowed',
    'localhost': 'HTTP/1.1 400 Bad Request',
    '127.0.0.1:4000': 'HTTP/1.1 400 Bad Request',
    '[::1]': 'HTTP/1.1 400 Bad Request',
    'app.example.com': 'HTTP/1.1 400 Bad Request',
  });
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

// Kestrel's defaults (Program.cs sets neither): an 8192-byte request line
// with its line end, 32768 header bytes plus the blank line, 100 headers.
// Every case closes at once, so the 5 s exchange timeout never runs.
const CLOSE = 'Connection: close\r\n';
const headWith = (headers: string): string => `GET /health HTTP/1.1\r\nHost: x\r\n${headers}${CLOSE}\r\n`;
const numbered = (count: number): string =>
  Array.from({ length: count }, (_, index) => `X${index}: v\r\n`).join('');
const bytes = (...parts: Array<string | number[]>): Buffer =>
  Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));

const REQUEST_HEADS: Record<string, Buffer> = {
  // Host: x, X: <n>, Connection: close and the blank line take n + 35 bytes.
  'header block at the limit': bytes(headWith(`X: ${'a'.repeat(32_735)}\r\n`)),
  'header block one byte over': bytes(headWith(`X: ${'a'.repeat(32_736)}\r\n`)),
  'header block over with bare LF': bytes(`GET /health HTTP/1.1\nHost: x\nX: ${'a'.repeat(32_740)}\n${CLOSE}\n`),
  'header block over before its line end': bytes(`GET /health HTTP/1.1\r\nHost: x\r\nX: ${'a'.repeat(33_000)}`),
  'request line at the limit': bytes(`GET /health?${'a'.repeat(8_169)} HTTP/1.1\r\nHost: x\r\n${CLOSE}\r\n`),
  'request line one byte over': bytes(`GET /health?${'a'.repeat(8_170)} HTTP/1.1\r\nHost: x\r\n${CLOSE}\r\n`),
  'request line at the limit with bare LF': bytes(`GET /health?${'a'.repeat(8_170)} HTTP/1.1\nHost: x\n${CLOSE}\n`),
  'request line over before its line end': bytes(`GET /health?${'a'.repeat(8_300)}`),
  'long method': bytes(`${'G'.repeat(8_300)} / HTTP/1.1\r\nHost: x\r\n${CLOSE}\r\n`),
  '100 headers': bytes(headWith(numbered(98))),
  '101 headers': bytes(headWith(numbered(99))),
  '101 headers after a kept-alive request': bytes(`GET /health HTTP/1.1\r\nHost: x\r\n\r\n${headWith(numbered(99))}`),
  'invalid UTF-8 in a value': bytes('GET /health HTTP/1.1\r\nHost: x\r\nX-A: ', [0xe9], `\r\n${CLOSE}\r\n`),
  'valid UTF-8 in a value': bytes('GET /health HTTP/1.1\r\nHost: x\r\nX-A: ', [0xc3, 0xa9], `\r\n${CLOSE}\r\n`),
  'DEL in a value': bytes(headWith('X-A: a\x7fb\r\n')),
  'control byte in a value': bytes(headWith('X-A: a\x01b\r\n')),
  'tab in a value': bytes(headWith('X-A: a\tb\r\n')),
  'NUL in a value': bytes(headWith('X-A: a\x00b\r\n')),
  'CR in a value': bytes(headWith('X-A: a\rb\r\n')),
  'folded line': bytes(headWith('X-A: a\r\n b\r\n')),
  'first header line folded': bytes(`GET /health HTTP/1.1\r\n Host: x\r\n${CLOSE}\r\n`),
  'quote in a name': bytes(headWith('X"A: a\r\n')),
  'control byte in a name': bytes(headWith('X\x01A: a\r\n')),
  'space before the colon': bytes(headWith('X-A : a\r\n')),
  'no colon': bytes(headWith('NoColon\r\n')),
  'empty name': bytes(headWith(': v\r\n')),
  'no Host': bytes(`GET /health HTTP/1.1\r\n${CLOSE}\r\n`),
  'two Host headers': bytes(`GET /health HTTP/1.1\r\nHost: a\r\nHost: b\r\n${CLOSE}\r\n`),
  'malformed Host': bytes(`GET /health HTTP/1.1\r\nHost: a b\r\n${CLOSE}\r\n`),
  'empty Host': bytes(`GET /health HTTP/1.1\r\nHost:\r\n${CLOSE}\r\n`),
  'bare LF line ends': bytes(`GET /health HTTP/1.1\nHost: x\n${CLOSE}\n`),
  'blank lines before the request line': bytes(`\r\n\r\n\n\r${headWith('')}`),
  'HTTP/0.9 request line': bytes('GET /health\r\n\r\n'),
  'HTTP/3 version': bytes(`GET /health HTTP/3\r\nHost: x\r\n${CLOSE}\r\n`),
  'bad method byte': bytes(`G@T /health HTTP/1.1\r\nHost: x\r\n${CLOSE}\r\n`),
  'two spaces after the method': bytes(`GET  /health HTTP/1.1\r\nHost: x\r\n${CLOSE}\r\n`),
  'two Content-Length values': bytes(`POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1\r\nContent-Length: 2\r\n${CLOSE}\r\nxx`),
  'HTTP/2 prior-knowledge preface': bytes('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'),
  // The version is the rest of the line: 8 bytes, or 9 ending in CR, or 400.
  // Kestrel answers it from the request line alone.
  'HTTP/1.2 version': bytes(`GET /health HTTP/1.2\r\nHost: x\r\n${CLOSE}\r\n`),
  'HTTP/2.0 version': bytes(`GET /health HTTP/2.0\r\nHost: x\r\n${CLOSE}\r\n`),
  'HTTP/0.9 version': bytes(`GET /health HTTP/0.9\r\nHost: x\r\n${CLOSE}\r\n`),
  'lower-case version': bytes(`GET /health http/1.1\r\nHost: x\r\n${CLOSE}\r\n`),
  'seven-byte version': bytes(`GET /health HTTP/1.\r\nHost: x\r\n${CLOSE}\r\n`),
  'HTTP/1.10 version': bytes(`GET /health HTTP/1.10\r\nHost: x\r\n${CLOSE}\r\n`),
  'HTTP/1.2 with bare LF': bytes(`GET /health HTTP/1.2\nHost: x\n${CLOSE}\n`),
  'HTTP/1.2 line alone': bytes('GET /health HTTP/1.2\r\n'),
  'HTTP/1.2 with a bad method': bytes(`G@T /health HTTP/1.2\r\nHost: x\r\n${CLOSE}\r\n`),
  'HTTP/1.2 after a kept-alive request': bytes(`GET /health HTTP/1.1\r\nHost: x\r\n\r\nGET /health HTTP/1.2\r\n`),
  // Kestrel refuses a second Content-Length line, even an equal one.
  'two equal Content-Length values': bytes(`POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nContent-Length: 2\r\n${CLOSE}\r\n{}`),
  'two Content-Length values beside chunked': bytes(`POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nContent-Length: 1\r\nContent-Length: 1\r\n${CLOSE}\r\n0\r\n\r\n`),
  // Kestrel takes any codings whose last is chunked, and refuses the rest
  // with 400. A 415 here is /delete's answer to the type.
  ...Object.fromEntries(Object.entries({
    'identity': 'Transfer-Encoding: identity\r\n',
    'gzip': 'Transfer-Encoding: gzip\r\n',
    'gzip, chunked': 'Transfer-Encoding: gzip, chunked\r\n',
    'chunked, gzip': 'Transfer-Encoding: chunked, gzip\r\n',
    'upper-case chunked': 'Transfer-Encoding: CHUNKED\r\n',
    'spaces and commas around chunked': 'Transfer-Encoding:  , chunked , \r\n',
    'two lines, chunked last': 'Transfer-Encoding: gzip\r\ntransfer-encoding: chunked\r\n',
    'two lines, chunked first': 'Transfer-Encoding: chunked\r\nTransfer-Encoding: gzip\r\n',
    'an empty line after chunked': 'Transfer-Encoding: chunked\r\nTransfer-Encoding:\r\n',
    'a tab before chunked': 'Transfer-Encoding: gzip,\tchunked\r\n',
    'chunked with a parameter': 'Transfer-Encoding: chunked;x\r\n',
    'an empty value': 'Transfer-Encoding:\r\n',
    'a control byte in an earlier coding': 'Transfer-Encoding: g\x01zip, chunked\r\n',
    // A codings value follows the value grammar: NUL, CR and invalid
    // UTF-8 are refused even before a chunked that would be taken.
    'NUL in an earlier coding': 'Transfer-Encoding: g\x00zip, chunked\r\n',
    'NUL in an earlier line': 'Transfer-Encoding: \x00\r\nTransfer-Encoding: chunked\r\n',
    'CR in an earlier coding': 'Transfer-Encoding: g\rzip, chunked\r\n',
    'CR in an earlier line': 'Transfer-Encoding: a\rb\r\nTransfer-Encoding: chunked\r\n',
    'invalid UTF-8 in an earlier coding': 'Transfer-Encoding: g\xe9zip, chunked\r\n',
    'valid UTF-8 in an earlier coding': 'Transfer-Encoding: g\xc3\xa9zip, chunked\r\n',
    'DEL in an earlier coding': 'Transfer-Encoding: g\x7fzip, chunked\r\n',
    'a control byte in an earlier line': 'Transfer-Encoding: \x01\r\nTransfer-Encoding: chunked\r\n',
    'non-token bytes in an earlier coding': 'Transfer-Encoding: g"z(i)p, chunked\r\n',
    'empty items': 'Transfer-Encoding: ,,gzip,,chunked,,\r\n',
    'chunked, chunked': 'Transfer-Encoding: chunked, chunked\r\n',
    'chunked;x=1': 'Transfer-Encoding: chunked;x=1\r\n',
    'gzip;x=1, chunked': 'Transfer-Encoding: gzip;x=1, chunked\r\n',
    'gzip, and chunked on the next line': 'Transfer-Encoding: gzip,\r\nTransfer-Encoding: chunked\r\n',
    'folded onto a second line': 'Transfer-Encoding: gzip,\r\n chunked\r\n',
    'with a space before the colon': 'Transfer-Encoding : chunked\r\n',
  }).map(([name, te]) => [`Transfer-Encoding ${name}`,
    bytes(`POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\n${te}${CLOSE}\r\n0\r\n\r\n`)])),
  'Transfer-Encoding gzip on HTTP/1.0': bytes('POST /delete HTTP/1.0\r\nTransfer-Encoding: gzip\r\n\r\n'),
  // Kestrel reads one sign before a Content-Length: "+" before digits, "-"
  // only before zeros.
  ...Object.fromEntries(['+47', '+047', '-0', '+0', '-00', '-47', '+', '++47', '+ 47', '9223372036854775808'].map(
    (length) => [`Content-Length ${length}`, bytes(
      `POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\n${CLOSE}\r\n` +
      '{"url":"/0123456789abcdef0123456789abcdef.txt"}',
    )],
  )),
  // An absolute target's authority must be the Host, as System.Uri prints
  // it: host in lower case, no userinfo, the default port optional.
  ...Object.fromEntries(Object.entries({
    'for another host': ['http://y/health', 'x'],
    'for the Host': ['http://x/health', 'x'],
    'in upper case': ['http://X/health', 'x'],
    'with the default port': ['http://x:80/health', 'x'],
    'and a Host with the default port': ['http://x/health', 'x:80'],
    'with another port': ['http://x:81/health', 'x'],
    'with a leading-zero port': ['http://x:080/health', 'x:080'],
    'with an empty port': ['http://x:/health', 'x'],
    'over https with a Host on 443': ['https://x/health', 'x:443'],
    'over https with a Host on 80': ['https://x/health', 'x:80'],
    'and a Host in upper case': ['http://x/health', 'X'],
    'with userinfo': ['http://u:p@x/health', 'x'],
    'and a Host with userinfo': ['http://u@x/health', 'u@x'],
    'with IPv6 in upper case': ['http://[::A]/health', '[::A]'],
    'with IPv6 and a port': ['http://[::1]:8080/health', '[::1]:8080'],
    'with an upper-case scheme': ['Http://x/health', 'x'],
    // Kestrel refuses any "#" in a target (since .NET 10.0.15). It routes a
    // control byte or a bad escape in the path (no route), and a control
    // byte in the query.
    'with a fragment': ['http://x/health#f', 'x'],
    'with a query and a fragment': ['http://x/health?a#f', 'x'],
    'with a fragment and no path': ['http://x:80#f', 'x'],
    'with a control byte in the fragment': ['http://x/health#\x01%zz', 'x'],
    'with a control byte in the path': ['http://x/hea\x01lth', 'x'],
    'with a bad escape in the path': ['http://x/health%zz', 'x'],
    'with DEL in the query': ['http://x/health?\x7f', 'x'],
    'with NUL in the fragment': ['http://x/health#\x00', 'x'],
  }).map(([name, [target, host]]) => [`absolute target ${name}`,
    bytes(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\n${CLOSE}\r\n`)])),
  'absolute target for another host on HTTP/1.0': bytes('GET http://y/health HTTP/1.0\r\nHost: x\r\n\r\n'),
  // Kestrel refuses these from the request line alone.
  'absolute target with a port over 65535': bytes('GET http://x:65536/health HTTP/1.1\r\n'),
  'absolute target with no host': bytes('GET http:///health HTTP/1.1\r\n'),
  'absolute target with a percent in the host': bytes('GET http://%78/health HTTP/1.1\r\n'),
  'authority target': bytes('GET x:80 HTTP/1.1\r\n'),
  'authority target with a slash': bytes('GET a/b HTTP/1.1\r\n'),
  'authority target with an underscore': bytes('GET a_b HTTP/1.1\r\n'),
  'asterisk target with GET': bytes('GET * HTTP/1.1\r\n'),
  'asterisk and more': bytes('GET *x HTTP/1.1\r\n'),
  // Kestrel 10.0.15 refuses a "#" in any target, after the line's length and version.
  'target with a fragment': bytes('GET /health#f HTTP/1.1\r\n'),
  'target with a fragment after the query': bytes('GET /health?a#f HTTP/1.1\r\n'),
  'target with a fragment on HTTP/1.0': bytes('GET /health#f HTTP/1.0\r\n'),
  'target with a fragment on CONNECT': bytes('CONNECT /health#f HTTP/1.1\r\n'),
  'target with an escaped fragment mark': bytes(`GET /health?a=%23 HTTP/1.1\r\nHost: x\r\n${CLOSE}\r\n`),
  'target with a fragment and an unknown version': bytes('GET /health#f HTTP/1.2\r\n'),
  'target with a fragment past the line limit': bytes(`GET /#${'a'.repeat(8192)} HTTP/1.1\r\n`),
  // Kestrel answers HTTP/1.0 with an HTTP/1.1 status line. It closes after
  // an answer of unknown length, and says so.
  'HTTP/1.0 request': bytes('GET /health HTTP/1.0\r\n\r\n'),
  'HTTP/1.0 request with no route': bytes('GET /nope HTTP/1.0\r\n\r\n'),
  'HTTP/1.0 keep-alive with an answer of unknown length': bytes('GET /health HTTP/1.0\r\nConnection: keep-alive\r\n\r\n'),
  'HTTP/1.0 keep-alive HEAD, then a refused head': bytes('HEAD /health HTTP/1.0\r\nConnection: keep-alive\r\n\r\nGET /health HTTP/1.2\r\n'),
  'HTTP/1.0 POST': bytes('POST /delete HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}'),
  'absolute target on HTTP/1.0 with no Host': bytes('GET http://y/health HTTP/1.0\r\n\r\n'),
  // Kestrel reads a chunked body on HTTP/1.0 too, before Content-Length.
  // Read any other way, the chunks would be the next request.
  ...Object.fromEntries(Object.entries({
    '': '',
    ', kept alive': 'Connection: keep-alive\r\n',
    ' and a Content-Length': 'Content-Length: 2\r\n',
  }).map(([name, headers]) => [`HTTP/1.0 chunked body${name}`, bytes(
    `POST /delete HTTP/1.0\r\nContent-Type: application/json\r\n${headers}Transfer-Encoding: chunked\r\n\r\n` +
    `2f\r\n{"url":"/0123456789abcdef0123456789abcdef.txt"}\r\n0\r\n\r\nGET /health HTTP/1.2\r\n\r\n`,
  )])),
  // Kestrel answers before it reads a body the route left, so the answer
  // never says Connection: close for it. Past the cap it then just closes.
  'unread body, then a refused head': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nContent-Length: 10\r\n\r\n0123456789GET /health HTTP/1.2\r\n'),
  'unread body over the cap, kept alive': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nContent-Length: 30000001\r\n\r\n'),
  'POST /upload with an unread body, then a refused head': bytes('POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nxxGET /health HTTP/1.2\r\n'),
  // Kestrel sends 100 Continue only for a first Expect line of
  // 100-continue, ignores any other expectation, and treats a body the
  // route left as any unread body.
  'Expect: 100-continue, unread body, then a refused head': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nExpect: 100-continue\r\nContent-Length: 2\r\n\r\nxxGET /health HTTP/1.2\r\n'),
  ...Object.fromEntries(Object.entries({
    'another expectation': 'Expect: foo\r\n',
    '100-continue in a list': 'Expect: 100-continue, foo\r\n',
    'an empty line before 100-continue': 'Expect:\r\nExpect: 100-continue\r\n',
    // The body came with the head, so no read waits and no 100 goes out.
    '100-continue with the body': 'Expect: 100-continue\r\n',
  }).map(([name, expect]) => [`Expect: ${name}`, bytes(
    `POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n${expect}Content-Length: 47\r\n${CLOSE}\r\n` +
    '{"url":"/0123456789abcdef0123456789abcdef.txt"}',
  )])),
  'POST /upload over its cap, kept alive': bytes('POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=b\r\nContent-Length: 33554433\r\n\r\n'),
  // Heads after a chunked body keep Kestrel's limits and grammar.
  'chunked body, then 101 headers': bytes(`POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n${headWith(numbered(99))}`),
  'chunked body with data and an extension, then a refused head': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n2;e=1\r\n{}\r\n0\r\n\r\nGET /health HTTP/1.2\r\n'),
  'gzip, chunked body, then a refused head': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: gzip, chunked\r\n\r\n0\r\n\r\nGET /health HTTP/1.2\r\n'),
  // Trailer lines follow the head's grammar, and count with the head's
  // lines and bytes (79 bytes and 3 lines here).
  ...Object.fromEntries(Object.entries({
    'then a refused head': 'X-T: 1\r\n\r\n',
    'ended by a bare LF': 'X-T: 1\r\n\n',
    'with a control byte and a quote': 'X"T: a\x01b\r\n\r\n',
    'of 97 lines': `${numbered(97)}\r\n`,
    'of 98 lines': `${numbered(98)}\r\n`,
    'at the byte limit': `X: ${'a'.repeat(32_684)}\r\n\r\n`,
    'one byte over': `X: ${'a'.repeat(32_685)}\r\n\r\n`,
    'with no colon': 'XT\r\n\r\n',
    'folded': 'X: a\r\n b\r\n\r\n',
    'with a space before the colon': 'X : 1\r\n\r\n',
    'with CR in a value': 'X: a\rb\r\n\r\n',
    'with NUL in a value': 'X: a\x00b\r\n\r\n',
    'with invalid UTF-8 in a value': 'X: a\xe9b\r\n\r\n',
    // Kestrel takes a bare LF in a trailer: a front proxy that reads it
    // otherwise can be desynced from this host.
    'with a bare-LF line': 'X-T: 1\n\r\n',
    'of only a bare LF': '\n',
  }).map(([name, trailer]) => [`chunked trailer ${name}`, bytes(
    `POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n${trailer}GET /health HTTP/1.2\r\n`,
  )])),
  // Chunk lines need CRLF.
  'bare LF after chunk data': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\n0\r\n\r\nGET /health HTTP/1.2\r\n'),
  'bare LF after a chunk size': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n2\n{}\r\n0\r\n\r\nGET /health HTTP/1.2\r\n'),
  'bare LF after the last chunk size': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n0\n\r\nGET /health HTTP/1.2\r\n'),
  'chunked trailer with no colon on a body the route left': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nXT\r\n\r\nGET /health HTTP/1.2\r\n'),
  // After an upgrade the route did not take, the next head keeps
  // Kestrel's limits and grammar.
  'upgrade not taken, then a refused head': bytes('GET /health HTTP/1.1\r\nHost: x\r\nUpgrade: foo\r\nConnection: upgrade\r\n\r\nGET /health HTTP/1.2\r\n'),
  'upgrade not taken, then 101 headers': bytes(`GET /health HTTP/1.1\r\nHost: x\r\nUpgrade: foo\r\n\r\n${headWith(numbered(99))}`),
  'upgrade with a body not taken, then a refused head': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nUpgrade: foo\r\nConnection: upgrade\r\nContent-Length: 2\r\n\r\n{}GET /health HTTP/1.2\r\n'),
  // A head with both framings is read as chunked and the connection then
  // closes, so bytes a Content-Length reader would take as a body are never
  // read as a request.
  'chunked with a Content-Length, then a pipelined head': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n0\r\n\r\nGET /health HTTP/1.1\r\nHost: localhost\r\n\r\n'),
  'HTTP/1.0 keep-alive, chunked with a Content-Length, then a pipelined head': bytes('POST /delete HTTP/1.0\r\nHost: localhost\r\nConnection: keep-alive\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n0\r\n\r\nGET /health HTTP/1.1\r\nHost: localhost\r\n\r\n'),
  'chunk extension that ends in a bare LF': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\n2;a\n{}\r\n0\r\n\r\n'),
  'chunk extension with control bytes': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\n2;e=\x01\x7f\r\n{}\r\n0\r\n\r\n'),
  'chunk data holding a semicolon': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\nd\r\n{"url":"a;b"}\r\n0\r\n\r\n'),
  'chunk data starting with a semicolon': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\n4\r\n;abc\r\n0\r\n\r\n'),
  'Host with an empty port': bytes(`GET /health HTTP/1.1\r\nHost: a:\r\n${CLOSE}\r\n`),
  'Host with only a port': bytes(`GET /health HTTP/1.1\r\nHost: :80\r\n${CLOSE}\r\n`),
  'Host with an unclosed bracket': bytes(`GET /health HTTP/1.1\r\nHost: [::1\r\n${CLOSE}\r\n`),
  'Host with a percent escape': bytes(`GET /health HTTP/1.1\r\nHost: a%41\r\n${CLOSE}\r\n`),
  'Host with a word port': bytes(`GET /health HTTP/1.1\r\nHost: a:b\r\n${CLOSE}\r\n`),
  'Host with text after the bracket': bytes(`GET /health HTTP/1.1\r\nHost: [::1]x\r\n${CLOSE}\r\n`),
  'Host with two ports': bytes(`GET /health HTTP/1.1\r\nHost: a:80:80\r\n${CLOSE}\r\n`),
  'Host with a port past 65535': bytes(`GET /health HTTP/1.1\r\nHost: a:65536\r\n${CLOSE}\r\n`),
  'Expect with an unknown token': bytes(`POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nExpect: foo\r\nContent-Length: 2\r\n${CLOSE}\r\n{}`),
  'chunk size not hex': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\nzz\r\n'),
  'chunk shorter than its size': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\n5\r\nab\r\n0\r\n\r\n'),
  'chunk size past 64 bits': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\nfffffffffffffffffff\r\n'),
  'chunk data with no line end': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\n2\r\n{}0\r\n\r\n'),
  'chunk lines with bare LF': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\n2\n{}\n0\n\n'),
  'chunk size with a space': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\n2 \r\n{}\r\n0\r\n\r\n'),
  'negative chunk size': bytes('POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n' + CLOSE + '\r\n-2\r\n{}\r\n0\r\n\r\n'),
};

it('refuses request heads at Kestrel\'s limits and grammar', async () => {
  const actual: Array<{ name: string; response: string }> = [];
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-heads-'));

  await withServer(['--auth', 'none', '--storage-dir', directory], async (server) => {
    for (const [name, request] of Object.entries(REQUEST_HEADS)) {
      // rawExchange drops Date and Server only from the first answer.
      const response = (await rawExchange(server.baseUrl, request)).replace(/^(date|server): [^\r\n]*\r?\n/gim, '');

      actual.push({ name, response });
    }
    // Kestrel's reason phrase for 416, which net/http words differently.
    const upload = await server.request('POST', '/upload', {
      body: multipart([filePart('a.txt', 'hello')]),
      headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
    });
    const { pathname } = new URL((JSON.parse(upload.text) as { url: string }).url);

    actual.push({
      name: 'range past the end of a file',
      response: await rawExchange(server.baseUrl, bytes(`GET ${pathname} HTTP/1.1\r\nHost: x\r\nRange: bytes=99-\r\n${CLOSE}\r\n`)),
    });
  }).finally(() => rm(directory, { recursive: true, force: true }));

  compareGolden('request-heads.json', actual);
}, 120_000);

// Kestrel's MaxRequestBodySize is 30,000,000 bytes on every route but
// /upload, and it answers when the handler first reads the body. A
// Content-Length exactly at the cap only waits for the body, so it is a
// unit test in Go, not a case here.
const OVER_CAP = 'Content-Length: 30000001\r\n';
const JSON_TYPE = 'Content-Type: application/json\r\n';

// Kestrel counts every byte of a chunked body against the cap: size lines,
// extensions and CRLFs, and the last CRLF unless a trailer comes first.
// The trailer's lines are not counted. Each pair is at the cap and one
// byte over (a 1000-byte /upload cap).
function chunkedUpload(size: number, chunks: number, extension = '', trailer = ''): Buffer {
  const head = '--b\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n\r\n';
  const tail = '\r\n--b--\r\n';
  const body = head + 'x'.repeat(size - head.length - tail.length) + tail;
  const step = Math.ceil(body.length / chunks);
  let framed = '';

  for (let at = 0; at < body.length; at += step) {
    const part = body.slice(at, at + step);

    framed += `${part.length.toString(16)}${at === 0 ? extension : ''}\r\n${part}\r\n`;
  }

  return bytes(
    'POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=b\r\n' +
    `Transfer-Encoding: chunked\r\n${CLOSE}\r\n${framed}0\r\n${trailer}\r\n`,
  );
}

it('counts a chunked body\'s framing against the body cap', async () => {
  const actual: Array<{ name: string; response: string }> = [];
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-chunk-cap-'));
  const cases: Record<string, [number, number, string?, string?]> = {
    'one chunk': [988, 1],
    'a one-byte extension': [987, 1, ';'],
    'a 101-byte extension': [887, 1, `;${'e'.repeat(100)}`],
    'ten chunks': [935, 10],
    'a trailer': [990, 1, '', 'X-T: 1\r\n'],
  };

  await withServer(['--auth', 'none', '--storage-dir', directory, '--max-upload', '1000'], async (server) => {
    for (const [name, [size, chunks, extension, trailer]] of Object.entries(cases)) {
      for (const [label, data] of [['at the cap', size], ['one byte over', size + 1]] as const) {
        const response = await rawExchange(server.baseUrl, chunkedUpload(data, chunks, extension, trailer));

        // The stored name is random, and the port changes.
        actual.push({
          name: `${name}, ${label}`,
          response: response.split(server.baseUrl).join('<origin>').replace(/[0-9a-f]{32}/g, '<key>'),
        });
      }
    }
  }).finally(() => rm(directory, { recursive: true, force: true }));

  compareGolden('chunked-body-cap.json', actual);
}, 60_000);

it('caps a request body at 30,000,000 bytes off /upload', async () => {
  const actual: Array<{ name: string; response: string }> = [];
  const directory = await mkdtemp(join(tmpdir(), 'blok-http-host-body-'));
  const endpoint = createServer((_request, response) => {
    response.writeHead(500);
    response.end();
  });

  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
  const address = endpoint.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Could not allocate a doc-endpoint port');
  }

  const cases: Record<string, string> = {
    'POST /delete': `POST /delete HTTP/1.1\r\nHost: localhost\r\n${JSON_TYPE}${OVER_CAP}${CLOSE}\r\n`,
    'POST /delete with Expect: 100-continue': `POST /delete HTTP/1.1\r\nHost: localhost\r\n${JSON_TYPE}Expect: 100-continue\r\n${OVER_CAP}${CLOSE}\r\n`,
    'POST /delete with some of the body': `POST /delete HTTP/1.1\r\nHost: localhost\r\n${JSON_TYPE}${OVER_CAP}${CLOSE}\r\n{"url":"x"}${' '.repeat(9_000)}`,
    'POST /delete with the wrong type': `POST /delete HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\n${OVER_CAP}${CLOSE}\r\n`,
    'POST /upload-by-url': `POST /upload-by-url HTTP/1.1\r\nHost: localhost\r\n${JSON_TYPE}${OVER_CAP}${CLOSE}\r\n`,
    'GET /health never reads the body': `GET /health HTTP/1.1\r\nHost: x\r\n${OVER_CAP}${CLOSE}\r\n`,
    'POST to no route': `POST /nope HTTP/1.1\r\nHost: localhost\r\n${OVER_CAP}${CLOSE}\r\n`,
    'POST /sync/{doc}/edit': `POST /sync/d/edit HTTP/1.1\r\nHost: localhost\r\n${JSON_TYPE}Blok-Idempotency-Key: k\r\n${OVER_CAP}${CLOSE}\r\n`,
    'POST /sync/{doc}/reset': `POST /sync/d/reset HTTP/1.1\r\nHost: localhost\r\n${JSON_TYPE}${OVER_CAP}${CLOSE}\r\n`,
    // /upload answers its own cap (32 MiB here) with Kestrel's reason phrase.
    'POST /upload over its cap': `POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=b\r\nContent-Length: 33554433\r\n${CLOSE}\r\n`,
  };

  try {
    await withServer([
      '--auth', 'none', '--storage-dir', join(directory, 'files'), '--rate-limit', '0',
      '--collab', '--collab-dir', join(directory, 'collab'),
      '--doc-endpoint', `http://127.0.0.1:${address.port}/docs`,
    ], async (server) => {
      for (const [name, request] of Object.entries(cases)) {
        actual.push({ name, response: await rawExchange(server.baseUrl, Buffer.from(request, 'latin1')) });
      }
    });
  } finally {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }

  compareGolden('request-body-cap.json', actual);
}, 120_000);

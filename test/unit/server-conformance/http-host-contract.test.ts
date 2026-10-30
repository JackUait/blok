// @vitest-environment node

// HTTP host behaviour pinned by goldens captured from the C# host, the
// reference. Capture: BLOK_WRITE_FIXTURES=1 node scripts/test-server-conformance.mjs
// --target csharp --suite http-host-contract. Any other run compares.

import { readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
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

async function withServer(args: string[], run: (server: RunningServer) => Promise<void>): Promise<void> {
  const server = await startServer({ args: ['--listen', '127.0.0.1:0', ...args] });

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

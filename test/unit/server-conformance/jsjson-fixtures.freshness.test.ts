// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pins fixtures/jsjson. js.json comes from node alone, so it is regenerated
 * here and compared byte for byte. dotnet.json is captured from System.Text.Json
 * by `dotnet fsi`; this test cannot run dotnet, so it checks only that its
 * cases are the ones the generator asks for. Blok.Server.Tests recomputes the
 * dotnet outputs live (JsJsonFixtureTests).
 */
const TIMEOUT_MS = 60_000;
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = join(REPO_ROOT, 'scripts', 'generate-jsjson-fixtures.mjs');
const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/jsjson', import.meta.url));

interface DotnetCase {
  name: string;
  [field: string]: unknown;
}

interface DotnetFixture {
  documents: DotnetCase[];
  strings: DotnetCase[];
}

const INPUT_FIELDS = ['name', 'text', 'hex', 'maxDepth', 'refuseDuplicates', 'units'];

/** A case without the fields dotnet fills in. */
const inputsOf = (entry: DotnetCase): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entry).filter(([key]) => INPUT_FIELDS.includes(key)));

const run = (args: string[]): string => {
  try {
    return execFileSync(process.execPath, [GENERATOR, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: TIMEOUT_MS,
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? '';

    throw new Error(`${GENERATOR} failed:\n${stderr}`, { cause: error });
  }
};

let tempDir = '';

describe('jsjson fixtures', () => {
  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'blok-jsjson-fixtures-'));
    run(['--out', tempDir, '--skip-dotnet']);
  }, TIMEOUT_MS);

  afterAll(() => {
    if (tempDir !== '') {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('js.json is byte-identical to a fresh generation', () => {
    const committed = readFileSync(join(FIXTURE_ROOT, 'js.json'), 'utf8');
    const regenerated = readFileSync(join(tempDir, 'js.json'), 'utf8');

    expect(regenerated === committed).toBe(true);
  });

  it('dotnet.json holds exactly the cases the generator asks for', () => {
    const committed = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'dotnet.json'), 'utf8')) as DotnetFixture;
    const asked = JSON.parse(run(['--print-dotnet-inputs'])) as DotnetFixture;

    expect(committed.documents.map(inputsOf)).toStrictEqual(asked.documents);
    expect(committed.strings.map(inputsOf)).toStrictEqual(asked.strings);
  }, TIMEOUT_MS);

  it('every dotnet case has its captured outputs', () => {
    const committed = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'dotnet.json'), 'utf8')) as DotnetFixture;

    expect(committed.documents.filter((entry) => !('parse' in entry)).map((entry) => entry.name)).toStrictEqual([]);
    expect(committed.strings.filter((entry) => !('json' in entry)).map((entry) => entry.name)).toStrictEqual([]);
  });
});

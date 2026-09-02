// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Lockstep pin for the managed-Yjs-engine fixtures
 * (`fixtures/yjs-engine/`), which the C# `Blok.Server.Yjs` conformance tests
 * consume byte-for-byte. The files are generated ONLY by
 * `scripts/generate-yjs-engine-fixtures.mjs`; this test regenerates them into a
 * temp directory and fails the moment the committed bytes drift from what the
 * installed yjs/lib0 produce.
 *
 * Only manifest-listed files are compared. `yrs-compat.json` lives in the same
 * directory but is CAPTURED from YDotNet, not generated, so it is deliberately
 * absent from the manifest and must not make this test red.
 */
const TIMEOUT_MS = 120_000;
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = join(REPO_ROOT, 'scripts', 'generate-yjs-engine-fixtures.mjs');
const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/yjs-engine', import.meta.url));

const require = createRequire(import.meta.url);

interface EngineFixtureManifest {
  files: Array<{ description: string; path: string }>;
  versions: { lib0: string; yjs: string };
}

function isManifest(value: unknown): value is EngineFixtureManifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { files, versions } = value as Record<string, unknown>;

  if (typeof versions !== 'object' || versions === null) {
    return false;
  }

  const { lib0, yjs } = versions as Record<string, unknown>;

  return typeof lib0 === 'string' &&
    typeof yjs === 'string' &&
    Array.isArray(files) &&
    files.every((entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).path === 'string' &&
      typeof (entry as Record<string, unknown>).description === 'string');
}

function readManifest(directory: string): EngineFixtureManifest {
  const path = join(directory, 'manifest.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (!isManifest(parsed)) {
    throw new Error(`${path} has an invalid shape`);
  }

  return parsed;
}

/** Relative POSIX paths of everything under a directory, sorted. */
function listFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).split('\\').join('/'))
    .sort();
}

const committedManifest = readManifest(FIXTURE_ROOT);
const committedPaths = committedManifest.files.map((entry) => entry.path);

let tempDir = '';

describe('yjs engine fixtures', () => {
  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'blok-yjs-engine-fixtures-'));

    try {
      execFileSync(process.execPath, [GENERATOR, '--out', tempDir], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        timeout: TIMEOUT_MS,
      });
    } catch (error) {
      // execFileSync's own message is just "Command failed"; the generator's
      // stack lives on stderr and is what actually names the broken case.
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';

      throw new Error(`${GENERATOR} failed:\n${stderr}`, { cause: error });
    }
  }, TIMEOUT_MS);

  afterAll(() => {
    if (tempDir !== '') {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('pins the installed yjs and lib0 versions in manifest.json', () => {
    expect(committedManifest.versions).toStrictEqual({
      lib0: (require('lib0/package.json') as { version: string }).version,
      yjs: (require('yjs/package.json') as { version: string }).version,
    });
  }, TIMEOUT_MS);

  it('lists exactly the files the generator writes', () => {
    expect(listFiles(tempDir)).toStrictEqual([...committedPaths].sort());
  }, TIMEOUT_MS);

  it.each(committedPaths)('%s is byte-identical to a fresh generation', (path) => {
    const committed = readFileSync(join(FIXTURE_ROOT, path));
    const regenerated = readFileSync(join(tempDir, path));

    expect(regenerated.equals(committed)).toBe(true);
  }, TIMEOUT_MS);
});

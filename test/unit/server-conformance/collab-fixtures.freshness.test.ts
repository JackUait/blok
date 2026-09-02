// @vitest-environment node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../types/data-formats/output-data';

/**
 * Lockstep pin for the collab fixtures (`fixtures/collab/<case>/`), which the
 * C# YDocConverter conformance tests consume byte-for-byte. The fixtures are
 * generated ONLY by `scripts/generate-collab-fixtures.mjs` from the real
 * client code; this test is what turns a client-side change into a red run
 * here, in the same commit, instead of a silent server-side drift.
 *
 * Always on — no BLOK_CONFORMANCE gate — because it needs no built server.
 *
 * Every SUBDIRECTORY of fixtures/collab is a case and must be listed in
 * manifest.json (files beside them are not ours and are ignored).
 */
const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/collab', import.meta.url));

interface CollabFixtureManifest {
  cases: Array<{ description: string; name: string }>;
}

interface CollabFixtureCase {
  canonical: OutputBlockData[];
  input: OutputBlockData[];
  name: string;
  update: Uint8Array;
}

function isObjectArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'object' && entry !== null);
}

/**
 * input.json deliberately carries malformed records (numeric ids, a null
 * parent, and — in `lenient-seed` — entries that are not objects at all)
 * because `fromJSON` tolerates them at runtime, so only the ARRAY shape is
 * checked. canonical.json is always well-formed and gets the stricter check.
 */
function readBlocks(path: string, requireObjects: boolean): OutputBlockData[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (requireObjects ? !isObjectArray(parsed) : !Array.isArray(parsed)) {
    throw new Error(`${path} must hold an array of block objects`);
  }

  return parsed as OutputBlockData[];
}

function isManifest(value: unknown): value is CollabFixtureManifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const cases = (value as Record<string, unknown>).cases;

  return isObjectArray(cases) &&
    cases.every((entry) => typeof entry.name === 'string' && typeof entry.description === 'string');
}

function readManifest(): CollabFixtureManifest {
  const path = join(FIXTURE_ROOT, 'manifest.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (!isManifest(parsed)) {
    throw new Error(`${path} has an invalid shape`);
  }

  return parsed;
}

function listCaseDirectories(): string[] {
  if (!existsSync(FIXTURE_ROOT)) {
    return [];
  }

  return readdirSync(FIXTURE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readCase(name: string): CollabFixtureCase {
  const directory = join(FIXTURE_ROOT, name);
  const base64 = readFileSync(join(directory, 'update.b64'), 'utf8').replace(/\s+/g, '');

  return {
    name,
    input: readBlocks(join(directory, 'input.json'), false),
    canonical: readBlocks(join(directory, 'canonical.json'), true),
    update: new Uint8Array(Buffer.from(base64, 'base64')),
  };
}

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

const caseNames = listCaseDirectories();

describe('collab lockstep fixtures', () => {
  it('has at least one generated case', () => {
    expect(caseNames.length).toBeGreaterThan(0);
  });

  it('lists exactly the committed case directories in manifest.json', () => {
    const manifest = readManifest();

    expect(manifest.cases.map((entry) => entry.name).sort()).toEqual(caseNames);
  });

  describe.each(caseNames)('%s', (name) => {
    const fixture = readCase(name);

    it('replays update.b64 into a fresh store as canonical.json (the doc the C# side reads)', () => {
      const store = createStore();

      store.applyRemoteUpdate(fixture.update);

      expect(store.toJSON()).toEqual(fixture.canonical);
    });

    it('serializes fromJSON(input.json) as canonical.json (the JSON the C# side seeds from)', () => {
      const store = createStore();

      store.fromJSON(fixture.input);

      expect(store.toJSON()).toEqual(fixture.canonical);
    });

    it('round-trips canonical.json through fromJSON/toJSON unchanged', () => {
      const store = createStore();

      store.fromJSON(fixture.canonical);

      expect(store.toJSON()).toEqual(fixture.canonical);
    });
  });
});

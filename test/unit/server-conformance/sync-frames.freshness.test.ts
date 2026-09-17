// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Lockstep pin for `fixtures/sync-frames.json`, the wire-frame fixture BOTH
 * sides read: `sync-wire.test.ts` in TypeScript and `SyncWireFramingTests.cs` +
 * `CollabRoomTestSupport.cs` in C#. Because both only ever READ it, a wire
 * change whose author forgets to re-run the generator leaves all three
 * implementations agreeing with each other against stale bytes, and nothing
 * anywhere goes red.
 *
 * Regenerating is the only honest check: the frames come from the reference
 * encoders (y-protocols/lib0/yjs) plus hand-spliced negative cases, so there is
 * no importable `src/` API to recompute them from.
 *
 * Always on — no BLOK_CONFORMANCE gate — because the generator needs no built
 * server and runs in well under a second.
 */
const TIMEOUT_MS = 30_000;
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = join(REPO_ROOT, 'scripts', 'generate-sync-frames.mjs');
const FIXTURE_NAME = 'sync-frames.json';
const FIXTURE = fileURLToPath(new URL(`./fixtures/${FIXTURE_NAME}`, import.meta.url));
const REGENERATE = 'node scripts/generate-sync-frames.mjs';

const require = createRequire(import.meta.url);

/**
 * Both consumers ENUMERATE these lists — `SyncWireFramingTests.cs` feeds them
 * to `[MemberData]`, `sync-wire.test.ts` iterates them — so dropping a case
 * from the generator and regenerating deletes test cases on both sides with
 * every gate green. Regeneration alone cannot catch that; only naming the set
 * here can.
 */
const V1_FRAMES = [
  'syncStep1',
  'syncStep2',
  'update',
  'awareness',
  'permissionDenied',
  'queryAwareness',
  'blokControl',
  'blokLimits',
  'activity',
  'identities',
];

const V2_FRAMES = [
  'operation',
  'acknowledgement',
  'acknowledgementMaxSequence',
  'acknowledgementKeysOutOfOrder',
  'rejection:lineage-mismatch',
  'rejection:read-only',
  'rejection:not-synced',
  'rejection:invalid-update',
  'rejection:oversized-update',
  'rejection:operation-id-conflict',
  'rejectionUnrecognisedCode',
  'rejectionCodeMaxLength',
];

const V2_NEGATIVE = [
  'operationUppercaseLineage',
  'operationShortOperationId',
  'operationMissingOperationId',
  'operationExtraKey',
  'operationEscapedDuplicateKey',
  'operationWhitespaceDuplicateKey',
  'operationMetadataNotJson',
  'operationMetadataArray',
  'operationEmptyUpdate',
  'operationInvalidUtf8Metadata',
  'operationMissingUpdateSection',
  'operationTruncatedUpdate',
  'operationHugeUpdateLength',
  'operationUnterminatedUpdateLength',
  'operationTrailingByte',
  'acknowledgementUppercaseOperationId',
  'acknowledgementDuplicateKey',
  'acknowledgementNumericServerSequence',
  'acknowledgementLeadingZeroServerSequence',
  'acknowledgementZeroSequence',
  'acknowledgementNegativeServerSequence',
  'acknowledgementOverRangeServerSequence',
  'acknowledgementMissingServerSequence',
  'acknowledgementTrailingByte',
  'rejectionShortLineage',
  'rejectionEscapedCode',
  'rejectionCodeEmpty',
  'rejectionCodeUppercase',
  'rejectionCodeUnderscore',
  'rejectionCodeLeadingDigit',
  'rejectionCodeLeadingHyphen',
  'rejectionCodeOverLength',
  'identitiesValueNotAnArray',
  'identitiesEntryMissingActorId',
  'identitiesEntryStringClientId',
  'identitiesEntryEmptyActorId',
  'identitiesEntryNotAnObject',
  'identitiesDuplicateTopLevelKey',
  'identitiesDuplicateClientIdInEntry',
  'identitiesClientIdPastSafeInteger',
  'identitiesDuplicateActorIdInEntry',
  'outerVarUintTooLong',
  'unknownOuterType',
];

interface NamedCase {
  name: string;
}

interface SyncFramesFixture {
  frames: NamedCase[];
  generator: Record<string, string>;
  v2: { frames: NamedCase[]; negative: NamedCase[] };
}

function names(cases: NamedCase[]): string[] {
  return cases.map((entry) => entry.name);
}

function readFixture(): SyncFramesFixture {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as SyncFramesFixture;
}

let tempDir = '';

describe('sync frame fixtures', () => {
  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'blok-sync-frames-'));

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

  it('is identical to a fresh generation', () => {
    // Compared as text, not Buffers: the fixture is pretty-printed JSON, so a
    // string mismatch prints the offending frame instead of "false".
    const regenerated = readFileSync(join(tempDir, FIXTURE_NAME), 'utf8');

    expect(regenerated, `${FIXTURE_NAME} is stale — run: ${REGENERATE}`)
      .toBe(readFileSync(FIXTURE, 'utf8'));
  }, TIMEOUT_MS);

  it('carries every case the consumers enumerate', () => {
    const fixture = readFixture();

    expect(names(fixture.frames)).toStrictEqual(V1_FRAMES);
    expect(names(fixture.v2.frames)).toStrictEqual(V2_FRAMES);
    expect(names(fixture.v2.negative)).toStrictEqual(V2_NEGATIVE);
  }, TIMEOUT_MS);

  it('writes exactly one file', () => {
    // A second output added later would otherwise never be compared at all.
    expect(readdirSync(tempDir).sort()).toStrictEqual([FIXTURE_NAME]);
  }, TIMEOUT_MS);

  it('pins the installed yjs, y-protocols and lib0 versions', () => {
    // The versions are written into the fixture, so a bump already fails the
    // comparison above; this one names the package that moved.
    expect(readFixture().generator).toStrictEqual({
      'lib0': (require('lib0/package.json') as { version: string }).version,
      'y-protocols': (require('y-protocols/package.json') as { version: string }).version,
      yjs: (require('yjs/package.json') as { version: string }).version,
    });
  }, TIMEOUT_MS);
});

// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nodeContractRevisions } from '../mcp-conformance/contract-revision';

const fixturesDir = resolve(__dirname, '../mcp-conformance/fixtures');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every string under a "contractRevision" key, variants included, with where it is. */
const revisionsIn = (value: unknown, path: string): Array<{ path: string; value: string }> => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => revisionsIn(item, `${path}/${index}`));
  }
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, inner]) => (key === 'contractRevision' && typeof inner === 'string'
    ? [{ path: `${path}/${key}`, value: inner }]
    : revisionsIn(inner, `${path}/${key}`)));
};

// contractRevision hashes the Blok version, so a literal in a fixture breaks on every release.
describe('MCP conformance contract revision law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records every contractRevision as a placeholder, never a literal hash', () => {
    const files = readdirSync(fixturesDir).filter((name) => name.endsWith('.json'));
    const found = files.flatMap((name) => revisionsIn(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')), name));
    const literal = found.filter((entry) => !/^\$\{(?:contractRevision|liveContractRevision)\}$/.test(entry.value));

    expect(found.length).toBeGreaterThan(0);
    expect(literal).toEqual([]);
  });

  it('works out a different revision for another Blok version, as a release makes', async () => {
    const at = async (version: string): Promise<unknown> => nodeContractRevisions({ argv: [], env: {}, cwd: fixturesDir, version });

    expect(await at('2.0.0')).not.toEqual(await at('2.1.0'));
  });

  it('gives a live handle its own revision, and none when Node would not start', async () => {
    const revisions = await nodeContractRevisions({ argv: [], env: {}, cwd: fixturesDir, version: '2.1.0' });
    const refused = await nodeContractRevisions({ argv: ['--page-titles', 'nope'], env: {}, cwd: fixturesDir, version: '2.1.0' });

    expect(revisions?.stored).toMatch(/^[0-9a-f]{8}$/);
    expect(revisions?.live).toMatch(/^[0-9a-f]{8}$/);
    expect(revisions?.live).not.toBe(revisions?.stored);
    expect(refused).toBeUndefined();
  });
});

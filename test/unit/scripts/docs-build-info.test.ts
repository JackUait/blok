// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contentManifest,
  createBuildInfo,
  proofPath,
  writeBuildInfo,
} from '../../../scripts/docs-build-info.mjs';

const SCRIPT = join(__dirname, '../../../scripts/docs-build-info.mjs');

const write = (root: string, path: string, content: string): void => {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

describe('docs build info', () => {
  let site: string;

  beforeEach(() => {
    vi.clearAllMocks();
    site = mkdtempSync(join(tmpdir(), 'build-info-'));
    write(site, 'index.html', '<h1>Home</h1>');
    write(site, 'docs/table/index.html', '<h1>Table</h1>');
    write(site, 'docs/table.md', '# Table');
    write(site, 'assets/client-abc.js', 'console.log(1)');
  });

  afterEach(() => {
    rmSync(site, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('hashes every deployed file, assets and crawl files included', () => {
    const before = contentManifest(site);

    expect(before.files).toBe(4);
    expect(before.hash).toMatch(/^[a-f0-9]{64}$/);

    write(site, 'assets/client-abc.js', 'console.log(2)');
    const afterAsset = contentManifest(site).hash;
    expect(afterAsset).not.toBe(before.hash);

    write(site, 'sitemap.xml', '<urlset/>');
    write(site, 'robots.txt', 'User-agent: *');
    expect(contentManifest(site)).toEqual({ hash: expect.not.stringMatching(afterAsset), files: 6 });
  });

  it('leaves out only its own output at the site root', () => {
    const before = contentManifest(site);

    write(site, 'build-info.json', '{}');
    write(site, 'build-info/anything.json', '{}');
    expect(contentManifest(site)).toEqual(before);

    // Same names deeper down are ordinary site files.
    write(site, 'next/build-info.json', '{}');
    expect(contentManifest(site).hash).not.toBe(before.hash);
  });

  it('changes the hash when a page body changes', () => {
    const before = contentManifest(site).hash;

    write(site, 'docs/table/index.html', '<h1>Table v2</h1>');

    expect(contentManifest(site).hash).not.toBe(before);
  });

  it('changes the hash when a page moves, even with the same bytes', () => {
    const before = contentManifest(site).hash;

    rmSync(join(site, 'docs/table.md'));
    write(site, 'docs/grid.md', '# Table');

    expect(contentManifest(site).hash).not.toBe(before);
  });

  it('ignores its own output, so writing it does not change the hash it records', () => {
    const info = createBuildInfo({ dir: site, sha: 'a'.repeat(40), version: '1.2.3', builtAt: '2026-10-05T00:00:00.000Z' });

    writeBuildInfo(site, info);

    expect(contentManifest(site).hash).toBe(info.manifestHash);
  });

  it('records the source, release family, root snapshot and run', () => {
    write(site, 'versions.json', JSON.stringify({ latest: '1.15', versions: [] }));

    expect(createBuildInfo({
      dir: site,
      sha: 'b'.repeat(40),
      version: '1.16.0',
      runId: '123',
      builtAt: '2026-10-05T00:00:00.000Z',
    })).toEqual({
      sha: 'b'.repeat(40),
      version: '1.16.0',
      root: '1.15',
      manifestHash: contentManifest(site).hash,
      files: 5,
      builtAt: '2026-10-05T00:00:00.000Z',
      runId: '123',
      runAttempt: null,
      rootTag: null,
      rootCommit: null,
      nextCommit: 'b'.repeat(40),
      archiveTags: [],
      proof: proofPath({
        sha: 'b'.repeat(40),
        manifestHash: contentManifest(site).hash,
        runId: '123',
        runAttempt: null,
        builtAt: '2026-10-05T00:00:00.000Z',
      }),
    });
  });

  // The root and archives are release snapshots built from their tags, not
  // from this commit; only /next/ comes from the commit that assembled them.
  it('records which release and commit each snapshot came from', () => {
    const info = createBuildInfo({
      dir: site,
      sha: 'b'.repeat(40),
      version: '1.16.0',
      builtAt: 'now',
      sources: { rootTag: 'v1.16.0', rootCommit: 'c'.repeat(40), archiveTags: ['v1.15.2', 'v1.14.0'] },
    });

    expect(info).toMatchObject({
      rootTag: 'v1.16.0',
      rootCommit: 'c'.repeat(40),
      nextCommit: 'b'.repeat(40),
      archiveTags: ['v1.15.2', 'v1.14.0'],
    });
  });

  it('writes null for the fields a local build does not have', () => {
    const info = createBuildInfo({ dir: site, sha: 'c'.repeat(40), version: '1.0.0', builtAt: 'now' });

    expect(info.root).toBeNull();
    expect(info.runId).toBeNull();
    expect(info.runAttempt).toBeNull();
    expect(info.rootTag).toBeNull();
    expect(info.rootCommit).toBeNull();
    expect(info.archiveTags).toEqual([]);
  });

  it('writes build-info.json at the site root', () => {
    const info = createBuildInfo({ dir: site, sha: 'd'.repeat(40), version: '1.0.0', builtAt: 'now' });

    writeBuildInfo(site, info);

    expect(JSON.parse(readFileSync(join(site, 'build-info.json'), 'utf8'))).toEqual(info);
  });

  it('writes the proof file under a name unique to this build, and no manifest-named copy', () => {
    const info = createBuildInfo({ dir: site, sha: 'e'.repeat(40), version: '1.0.0', runId: '9', runAttempt: '1', builtAt: 'now' });

    writeBuildInfo(site, info);

    expect(info.proof).toMatch(/^\/build-info\/[a-f0-9]{64}\.json$/);
    expect(JSON.parse(readFileSync(join(site, info.proof.slice(1)), 'utf8'))).toEqual(info);
    // A manifest-named file is shared by every deploy with the same bytes, so a CDN can serve an old one.
    expect(existsSync(join(site, 'build-info', `${info.manifestHash}.json`))).toBe(false);
    // Writing the proof must not change the hash it records.
    expect(contentManifest(site).hash).toBe(info.manifestHash);
  });

  it('names a different proof file for every build, even with identical pages', () => {
    const base = { sha: 'a'.repeat(40), manifestHash: 'f'.repeat(64), runId: '100', runAttempt: '1', builtAt: 't1' };

    expect(proofPath(base)).toBe(proofPath({ ...base }));
    expect(proofPath({ ...base, sha: 'b'.repeat(40) })).not.toBe(proofPath(base));
    expect(proofPath({ ...base, manifestHash: 'e'.repeat(64) })).not.toBe(proofPath(base));
    expect(proofPath({ ...base, runId: '101' })).not.toBe(proofPath(base));
    expect(proofPath({ ...base, runAttempt: '2' })).not.toBe(proofPath(base));
  });

  it('falls back to the build time for a local build that has no run', () => {
    const local = { sha: 'a'.repeat(40), manifestHash: 'f'.repeat(64), runId: null, runAttempt: null };

    expect(proofPath({ ...local, builtAt: 't1' })).not.toBe(proofPath({ ...local, builtAt: 't2' }));
  });

  it('hands the workflow exactly the sha and manifest outputs it reads', () => {
    const output = join(site, 'github-output');

    const sources = join(site, '..', `${site.split('/').pop() ?? ''}-sources.json`);
    writeFileSync(sources, JSON.stringify({ rootTag: 'v1.16.0', rootCommit: 'c'.repeat(40), archiveTags: ['v1.15.2'] }));

    execFileSync(process.execPath, [SCRIPT, site, '--sources', sources], {
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_ID: '7', GITHUB_RUN_ATTEMPT: '3' },
      stdio: 'pipe',
    });
    rmSync(sources);

    const lines = readFileSync(output, 'utf8').trim().split('\n');
    const outputs = Object.fromEntries(lines.map((line): [string, string] => {
      const [key = '', value = ''] = line.split('=');
      return [key, value];
    }));
    const written = JSON.parse(readFileSync(join(site, 'build-info.json'), 'utf8')) as {
      sha: string; manifestHash: string; proof: string; runId: string; runAttempt: string; rootTag: string;
    };

    // deploy-docs.yml reads steps.build-info.outputs.sha / .manifest / .proof / .root_tag (pinned in docs-deploy-law).
    expect(Object.keys(outputs)).toEqual(['sha', 'manifest', 'proof', 'root_tag']);
    expect(outputs).toEqual({ sha: written.sha, manifest: written.manifestHash, proof: written.proof, root_tag: 'v1.16.0' });
    expect(written).toMatchObject({ runId: '7', runAttempt: '3', rootTag: 'v1.16.0', rootCommit: 'c'.repeat(40), archiveTags: ['v1.15.2'] });
    expect(existsSync(join(site, written.proof.slice(1)))).toBe(true);
  });

  it('refuses a SHA that is not a full commit id', () => {
    expect(() => createBuildInfo({ dir: site, sha: 'HEAD', version: '1.0.0', builtAt: 'now' })).toThrow(/sha/i);
  });
});

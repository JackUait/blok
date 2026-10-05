// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contentAddressedPath,
  contentManifest,
  createBuildInfo,
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

  it('hashes only the HTML and markdown files', () => {
    const before = contentManifest(site);

    write(site, 'assets/client-abc.js', 'console.log(2)');

    expect(contentManifest(site)).toEqual(before);
    expect(before.files).toBe(3);
    expect(before.hash).toMatch(/^[a-f0-9]{64}$/);
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
      files: 3,
      builtAt: '2026-10-05T00:00:00.000Z',
      runId: '123',
    });
  });

  it('writes null for the fields a local build does not have', () => {
    const info = createBuildInfo({ dir: site, sha: 'c'.repeat(40), version: '1.0.0', builtAt: 'now' });

    expect(info.root).toBeNull();
    expect(info.runId).toBeNull();
  });

  it('writes build-info.json at the site root', () => {
    const info = createBuildInfo({ dir: site, sha: 'd'.repeat(40), version: '1.0.0', builtAt: 'now' });

    writeBuildInfo(site, info);

    expect(JSON.parse(readFileSync(join(site, 'build-info.json'), 'utf8'))).toEqual(info);
  });

  it('also writes a copy named by the manifest hash, which no CDN has cached yet', () => {
    const info = createBuildInfo({ dir: site, sha: 'e'.repeat(40), version: '1.0.0', builtAt: 'now' });

    writeBuildInfo(site, info);

    expect(contentAddressedPath(info.manifestHash)).toBe(`/build-info/${info.manifestHash}.json`);
    expect(JSON.parse(readFileSync(join(site, 'build-info', `${info.manifestHash}.json`), 'utf8'))).toEqual(info);
    // Writing the copy must not change the hash it is named after.
    expect(contentManifest(site).hash).toBe(info.manifestHash);
  });

  it('hands the workflow exactly the sha and manifest outputs it reads', () => {
    const output = join(site, 'github-output');

    execFileSync(process.execPath, [SCRIPT, site], {
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_ID: '7' },
      stdio: 'pipe',
    });

    const lines = readFileSync(output, 'utf8').trim().split('\n');
    const outputs = Object.fromEntries(lines.map((line): [string, string] => {
      const [key = '', value = ''] = line.split('=');
      return [key, value];
    }));
    const written = JSON.parse(readFileSync(join(site, 'build-info.json'), 'utf8')) as { sha: string; manifestHash: string };

    // deploy-docs.yml reads steps.build-info.outputs.sha / .manifest (pinned in docs-deploy-law).
    expect(Object.keys(outputs)).toEqual(['sha', 'manifest']);
    expect(outputs).toEqual({ sha: written.sha, manifest: written.manifestHash });
    expect(existsSync(join(site, 'build-info', `${written.manifestHash}.json`))).toBe(true);
  });

  it('refuses a SHA that is not a full commit id', () => {
    expect(() => createBuildInfo({ dir: site, sha: 'HEAD', version: '1.0.0', builtAt: 'now' })).toThrow(/sha/i);
  });
});

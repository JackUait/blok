// The module lives in docs/scripts/ (a build step), but vitest only collects src/**.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveEntriesConfined,
  buildVersionsManifest,
  injectNoindex,
  listPages,
  pruneToBudget,
  relocateBuild,
  selectSnapshots,
} from '../../scripts/docs-versions.mjs';
import { parseVersionsManifest } from './versions';

describe('selectSnapshots', () => {
  it('takes the newest patch per minor, skips prereleases and never duplicates the latest minor', () => {
    const selection = selectSnapshots(['v1.15.0', 'v1.15.2', 'v1.16.0-beta.1', 'v1.14.0', 'v1.6.2', 'v1.7.0']);
    expect(selection.root).toEqual({ tag: 'v1.15.2', minor: '1.15' });
    expect(selection.archives).toEqual([
      { tag: 'v1.14.0', minor: '1.14' },
      { tag: 'v1.7.0', minor: '1.7' },
    ]);
  });

  it('sorts minors numerically, not as strings', () => {
    const selection = selectSnapshots(['v1.9.0', 'v1.10.1', 'v1.8.0']);
    expect(selection.root.minor).toBe('1.10');
    expect(selection.archives.map((a) => a.minor)).toEqual(['1.9', '1.8']);
  });

  it('fails loudly when there is no stable release', () => {
    expect(() => selectSnapshots(['v2.0.0-beta.1'])).toThrow(/stable/);
  });
});

describe('buildVersionsManifest', () => {
  it('lists next, then the root release, then archives', () => {
    const manifest = buildVersionsManifest({
      root: { tag: 'v1.15.2', minor: '1.15' },
      archives: [{ tag: 'v1.14.0', minor: '1.14' }],
    });
    expect(manifest).toEqual({
      latest: '1.15',
      versions: [
        { id: 'next', label: 'Next', path: '/next/' },
        { id: '1.15', label: '1.15', path: '/' },
        { id: '1.14', label: '1.14', path: '/v/1.14/' },
      ],
    });
  });

  it('writes paths the docs app accepts', () => {
    const manifest = buildVersionsManifest(selectSnapshots(['v1.15.2', 'v1.14.0', 'v1.7.3']));
    expect(parseVersionsManifest(manifest)).toEqual(manifest);
  });
});

describe('file steps', () => {
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'docs-versions-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const file = (path: string, body = '<html><head><title>x</title></head></html>') => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  };

  it('moves assets under the base and drops the SPA fallback', () => {
    file('v/1.14/docs/table/index.html');
    file('assets/client-abc.js', 'js');
    file('favicon.ico', 'ico');
    file('index.html');
    relocateBuild(dir, '/v/1.14/');
    expect(existsSync(join(dir, 'v/1.14/assets/client-abc.js'))).toBe(true);
    expect(existsSync(join(dir, 'v/1.14/favicon.ico'))).toBe(true);
    expect(existsSync(join(dir, 'index.html'))).toBe(false);
    expect(existsSync(join(dir, 'assets'))).toBe(false);
  });

  it('lists served pages without the 404 page', () => {
    file('index.html');
    file('docs/table/index.html');
    file('ru/index.html');
    file('404/index.html');
    expect(listPages(dir)).toEqual(['/', '/docs/table', '/ru']);
  });

  it('marks every page noindex once', () => {
    file('docs/table/index.html');
    expect(injectNoindex(dir)).toBe(1);
    expect(injectNoindex(dir)).toBe(0);
    expect(readFileSync(join(dir, 'docs/table/index.html'), 'utf8')).toContain(
      '<head><meta name="robots" content="noindex, follow">',
    );
  });
});

describe('pruneToBudget', () => {
  it('drops the oldest minors first until the site fits', () => {
    const mb = 1024 ** 2;
    const keep = pruneToBudget(
      [
        { minor: '1.14', bytes: 300 * mb },
        { minor: '1.13', bytes: 300 * mb },
        { minor: '1.12', bytes: 300 * mb },
      ],
      100 * mb,
    );
    expect(keep).toEqual(['1.14', '1.13']);
  });
});

describe('archiveEntriesConfined', () => {
  it('accepts an archive whose entries all sit under its own /v/<minor>/', () => {
    expect(archiveEntriesConfined(['./', './v/', './v/1.14/', './v/1.14/index.html', './v/1.14/assets/a.js'], '1.14')).toBe(true);
  });

  it('rejects an entry outside /v/<minor>/', () => {
    expect(archiveEntriesConfined(['./', './v/1.14/index.html', './index.html'], '1.14')).toBe(false);
    expect(archiveEntriesConfined(['./v/1.13/index.html'], '1.14')).toBe(false);
    expect(archiveEntriesConfined(['./v/1.140/index.html'], '1.14')).toBe(false);
  });

  it('rejects an entry that climbs out through ..', () => {
    expect(archiveEntriesConfined(['./v/1.14/../../index.html'], '1.14')).toBe(false);
  });
});

describe('assemble-site', () => {
  // jsdom swaps the global URL class, which node's fileURLToPath rejects.
  const docsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'assemble-site-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const tgz = (srcDir: string, out: string) => execFileSync('tar', ['-czf', out, '-C', srcDir, '.']);

  const page = (srcName: string, path: string, html: string) => {
    const target = join(dir, 'src', srcName, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, html);
  };

  const fixtures = () => {
    const releases = join(dir, 'releases');
    mkdirSync(join(releases, 'v1.15.2'), { recursive: true });
    mkdirSync(join(releases, 'v1.14.0'), { recursive: true });
    page('root', 'index.html', 'ROOT');
    tgz(join(dir, 'src', 'root'), join(releases, 'v1.15.2', 'docs-root.tgz'));
    page('arch', 'v/1.14/index.html', 'OLD');
    tgz(join(dir, 'src', 'arch'), join(releases, 'v1.14.0', 'docs-v1.14.tgz'));
    page('next', 'next/index.html', 'NEXT');
    tgz(join(dir, 'src', 'next'), join(dir, 'next.tgz'));
    return releases;
  };

  const assemble = (releases: string, out: string) =>
    spawnSync(
      'node',
      [
        'scripts/assemble-site.mjs',
        '--next',
        join(dir, 'next.tgz'),
        '--out',
        out,
        '--local-dir',
        releases,
        '--tags',
        'v1.15.2,v1.14.0',
      ],
      { cwd: docsDir, encoding: 'utf8' },
    );

  it('assembles root, next and archives from release tarballs', () => {
    const releases = fixtures();
    const out = join(dir, 'site');
    const result = assemble(releases, out);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe('ROOT');
    expect(readFileSync(join(out, 'next', 'index.html'), 'utf8')).toBe('NEXT');
    expect(readFileSync(join(out, 'v', '1.14', 'index.html'), 'utf8')).toBe('OLD');
    expect(JSON.parse(readFileSync(join(out, 'versions.json'), 'utf8'))).toEqual(
      buildVersionsManifest(selectSnapshots(['v1.15.2', 'v1.14.0'])),
    );
  });

  it('refuses an archive that would write outside its /v/<minor>/ and keeps the root', () => {
    const releases = fixtures();
    page('bad', 'index.html', 'EVIL');
    page('bad', 'v/1.14/index.html', 'OLD');
    tgz(join(dir, 'src', 'bad'), join(releases, 'v1.14.0', 'docs-v1.14.tgz'));
    const out = join(dir, 'site');
    const result = assemble(releases, out);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('v1.14.0');
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe('ROOT');
  });

  it('fails naming the tag whose snapshot is missing', () => {
    const releases = fixtures();
    rmSync(join(releases, 'v1.14.0', 'docs-v1.14.tgz'));
    const result = assemble(releases, join(dir, 'site'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('v1.14.0');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReleaseNotes, gprPublishCommand, publishPackagePair, releaseGitTags } from '../../../scripts/release.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('release.mjs GitHub release sequencing', () => {
  it('creates a draft that the server workflow publishes after its assets', () => {
    const source = readFileSync(resolve(repositoryRoot, 'scripts/release.mjs'), 'utf8');

    expect(source).toMatch(/gh release create \$\{gitTag\}[^\n]* --draft/);
  });
});

describe('release.mjs Go module tag', () => {
  const goMod = (modulePath: string): string => `module ${modulePath}\n\ngo 1.27.1\n`;
  const modulePath = 'github.com/JackUait/blok/packages/server/go';
  const releaseSource = (): string => readFileSync(resolve(repositoryRoot, 'scripts/release.mjs'), 'utf8');

  // A module in a subdirectory is versioned only by tags under that
  // directory; a root v1.2.3 tag does not version it.
  it('tags the Go module under its directory beside the family tag', () => {
    expect(releaseGitTags('1.17.0', goMod(modulePath))).toEqual({
      gitTag: 'v1.17.0',
      goModuleTag: 'packages/server/go/v1.17.0',
    });
    expect(releaseGitTags('1.17.0-beta.1', goMod(modulePath)).goModuleTag)
      .toBe('packages/server/go/v1.17.0-beta.1');
  });

  // The proxy keeps a tag forever, so a v2 tag on a path without /v2 can
  // never be taken back.
  it('refuses a major version the module path does not carry', () => {
    expect(() => releaseGitTags('2.0.0', goMod(modulePath))).toThrow(
      `Go module path ${modulePath} cannot take version 2.0.0; it must end in packages/server/go/v2`,
    );
    expect(() => releaseGitTags('1.17.0', goMod(`${modulePath}/v2`))).toThrow(
      `Go module path ${modulePath}/v2 cannot take version 1.17.0; it must end in packages/server/go`,
    );
    expect(releaseGitTags('2.0.0', goMod(`${modulePath}/v2`)).goModuleTag)
      .toBe('packages/server/go/v2.0.0');
    expect(() => releaseGitTags('1.17.0', 'go 1.27.1\n')).toThrow('packages/server/go/go.mod has no module line');
  });

  it('accepts the family version with the go.mod on disk', () => {
    const { version } = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as { version: string };
    const onDisk = readFileSync(resolve(repositoryRoot, 'packages/server/go/go.mod'), 'utf8');

    expect(releaseGitTags(version, onDisk).goModuleTag).toBe(`packages/server/go/v${version}`);
  });

  it('checks the Go tag before publishing and pushes it before the family tag', () => {
    const source = releaseSource();
    const check = source.indexOf('releaseGitTags(version, readFileSync(');
    const versionBump = source.indexOf('run(`npm version ${version}');
    const familyTag = source.indexOf('run(`git tag ${gitTag}`)');
    const goTag = source.indexOf('run(`git tag ${goModuleTag}`)');
    const goPush = source.indexOf('run(`git push origin ${goModuleTag}`)');
    const familyPush = source.indexOf('run(`git push origin ${gitTag}`)');

    expect(check).toBeGreaterThan(-1);
    expect(versionBump).toBeGreaterThan(check);
    expect(familyTag).toBeGreaterThan(versionBump);
    expect(goTag).toBeGreaterThan(familyTag);
    // The family tag starts the release workflows, so it goes last.
    expect(goPush).toBeGreaterThan(goTag);
    expect(familyPush).toBeGreaterThan(goPush);
  });
});

describe('release.mjs gprPublishCommand', () => {
  it('builds publish command from pack JSON and directory', () => {
    const packJson = JSON.stringify([{ filename: 'jackuait-blok-cli-1.0.0.tgz' }]);
    const cmd = gprPublishCommand({ packJson, packDir: '/tmp', tag: 'latest' });

    expect(cmd).toBe('npm publish /tmp/jackuait-blok-cli-1.0.0.tgz --tag latest');
  });

  it('handles beta tags', () => {
    const packJson = JSON.stringify([{ filename: 'jackuait-blok-cli-1.0.0-beta.1.tgz' }]);
    const cmd = gprPublishCommand({ packJson, packDir: '/tmp', tag: 'beta' });

    expect(cmd).toBe('npm publish /tmp/jackuait-blok-cli-1.0.0-beta.1.tgz --tag beta');
  });
});

const MAIN_CHANGELOG = `# Changelog

## [1.2.0](https://github.com/JackUait/blok/compare/v1.1.0...v1.2.0) (2026-04-07)

### Features

- **drag & drop** — Rewrote drag and drop ([#10](https://github.com/JackUait/blok/pull/10))

### Bug Fixes

- **toolbar** — Fixed hover behavior

## [1.1.0](https://github.com/JackUait/blok/compare/v1.0.0...v1.1.0) (2026-03-01)

### Features

- **undo/redo** — Added keyboard shortcuts
`;

const CLI_CHANGELOG = `# Changelog

## [1.2.0](https://github.com/JackUait/blok/compare/v1.1.0...v1.2.0) (2026-04-07)

### Features

- **html-to-json** — Added \`--output\` flag

## [1.1.0](https://github.com/JackUait/blok/compare/v1.0.0...v1.1.0) (2026-03-01)

### Features

- **init command** — Added \`blok-cli init\` command
`;

describe('release.mjs buildReleaseNotes', () => {
  it('extracts the matching version section from both changelogs', () => {
    const notes = buildReleaseNotes('1.2.0', MAIN_CHANGELOG, CLI_CHANGELOG);

    expect(notes).toContain('drag & drop');
    expect(notes).toContain('toolbar');
    expect(notes).toContain('html-to-json');
  });

  it('does not include content from other versions', () => {
    const notes = buildReleaseNotes('1.2.0', MAIN_CHANGELOG, CLI_CHANGELOG);

    expect(notes).not.toContain('undo/redo');
    expect(notes).not.toContain('init command');
  });

  it('labels the cli section as blok-cli', () => {
    const notes = buildReleaseNotes('1.2.0', MAIN_CHANGELOG, CLI_CHANGELOG);

    expect(notes).toContain('blok-cli');
  });

  it('returns only main notes when cli changelog has no matching version', () => {
    const notes = buildReleaseNotes('9.9.9', MAIN_CHANGELOG, CLI_CHANGELOG);

    expect(notes).toBe('');
  });

  it('returns only cli notes when main changelog has no matching version', () => {
    const cliOnly = `# Changelog\n\n## [9.9.9](https://example.com) (2026-01-01)\n\n### Features\n\n- **cli-only** — Something\n`;
    const notes = buildReleaseNotes('9.9.9', MAIN_CHANGELOG, cliOnly);

    expect(notes).toContain('cli-only');
    expect(notes).toContain('blok-cli');
  });

  it('handles a beta version', () => {
    const changelog = `# Changelog\n\n## [1.0.0-beta.1](https://example.com) (2026-01-01)\n\n### Features\n\n- **beta feature** — Something\n`;
    const notes = buildReleaseNotes('1.0.0-beta.1', changelog, '');

    expect(notes).toContain('beta feature');
  });
});

describe('release.mjs publishPackagePair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls publish and gpr callbacks in order', async () => {
    const publishToNpm = vi.fn();
    const publishToGpr = vi.fn();
    const restoreName = vi.fn();

    await publishPackagePair({ publishToNpm, publishToGpr, restoreName });

    expect(publishToNpm).toHaveBeenCalledOnce();
    expect(publishToGpr).toHaveBeenCalledOnce();
    expect(restoreName).toHaveBeenCalledOnce();
  });

  it('restores name even when npm publish throws', async () => {
    const publishToNpm = vi.fn().mockImplementation(() => { throw new Error('npm auth failed'); });
    const publishToGpr = vi.fn();
    const restoreName = vi.fn();

    await expect(publishPackagePair({ publishToNpm, publishToGpr, restoreName })).rejects.toThrow('npm auth failed');
    expect(restoreName).toHaveBeenCalledOnce();
  });

  it('restores name even when gpr publish throws', async () => {
    const publishToNpm = vi.fn();
    const publishToGpr = vi.fn().mockImplementation(() => { throw new Error('gpr auth failed'); });
    const restoreName = vi.fn();

    await expect(publishPackagePair({ publishToNpm, publishToGpr, restoreName })).rejects.toThrow('gpr auth failed');
    expect(restoreName).toHaveBeenCalledOnce();
  });

  it('propagates the error so the caller can abort the release', async () => {
    const publishToNpm = vi.fn().mockImplementation(() => { throw new Error('publish failed'); });
    const publishToGpr = vi.fn();
    const restoreName = vi.fn();

    const result = publishPackagePair({ publishToNpm, publishToGpr, restoreName });

    await expect(result).rejects.toThrow('publish failed');
  });
});

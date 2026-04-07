import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gprPublishCommand, buildReleaseNotes, publishPackagePair } from '../../../scripts/release.mjs';

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

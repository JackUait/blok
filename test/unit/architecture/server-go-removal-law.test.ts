import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

const isHistoricalPlan = (path: string): boolean => path.startsWith('docs/plans/');

describe('server implementation removal law', () => {
  it('has no tracked Go implementation or module files', () => {
    const forbiddenFiles = trackedFiles.filter((path) => {
      if (isHistoricalPlan(path)) {
        return false;
      }

      const releaseConfig = ['.gore', 'leaser.yaml'].join('');

      return path.endsWith('.go') ||
        path === 'go.mod' ||
        path.endsWith('/go.mod') ||
        path === 'go.sum' ||
        path.endsWith('/go.sum') ||
        path === releaseConfig ||
        path.endsWith(`/${releaseConfig}`);
    });

    expect(forbiddenFiles).toEqual([]);
  });

  it('has no active Go build or release references', () => {
    // Split the patterns so the law does not flag itself.
    const forbiddenReferencePattern = [
      ['actions/setup-', 'go'].join(''),
      ['go ', '(build|test|vet)'].join(''),
      ['gore', 'leaser'].join(''),
      ['CGO_', 'ENABLED'].join(''),
      ['\\.gore', 'leaser-dist'].join(''),
    ].join('|');
    const result = spawnSync(
      'git',
      ['grep', '-n', '-E', forbiddenReferencePattern, '--', ':!docs/plans/**'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect([0, 1], result.stderr).toContain(result.status);
    expect(result.stdout).toBe('');
  });

  it('has no Go target branch in the conformance harness', () => {
    const source = readFileSync(
      resolve(repoRoot, 'scripts/test-server-conformance.mjs'),
      'utf8',
    );
    const forbiddenMarkers = [
      ['--target ', 'go'].join(''),
      ["target === '", "go'"].join(''),
      ["target !== '", "go'"].join(''),
      ["run('", "go'"].join(''),
    ];

    expect(forbiddenMarkers.filter((marker) => source.includes(marker))).toEqual([]);
  });
});
